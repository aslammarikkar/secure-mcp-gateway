import helmet from "helmet";
import timeout from "connect-timeout";
import cors from "cors";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import express, { NextFunction, Request, Response } from "express";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { logger } from "./helpers/logs.js";
import { getErrorMessage, markSpanError, markSpanOk } from "./helpers/tracing.js";
import {
  getHttpMiddlewareConfig,
  type HttpMiddlewareConfig,
} from "./config/http-config.js";

const log = logger("middleware");

function createRateLimiterMiddleware(config: HttpMiddlewareConfig) {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    message: {
      error: "Too many requests from this IP",
      retryAfter: Math.round(config.rateLimitWindowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req: Request, res: Response, _next: NextFunction, options) => {
      log.info("ip", req.ip);
      log.info("user-agent", req.get("user-agent"));
      log.info("request.url", req.originalUrl);

      const tracer = trace.getTracer("rate_limiter");
      const span = tracer.startSpan("middleware.rate_limiter", {
        attributes: {
          "request.method": req.method || "unknown",
          "request.url": req.originalUrl || req.url || "unknown",
          "rate_limiter.max_requests": (options.limit as number) || config.rateLimitMaxRequests,
          "rate_limiter.window_ms": options.windowMs || config.rateLimitWindowMs,
        },
      });

      try {
        span.addEvent("rate_limiter.request_blocked", {
          "rate_limiter.message": options.message
            ? JSON.stringify(options.message)
            : "Too many requests",
        });
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Too many requests from this IP",
        });
        log.warn("Rate limit exceeded", { ip: req.ip });
        res.status(429).json(
          options.message || {
            error: "Too many requests from this IP",
            retryAfter: Math.round((options.windowMs || config.rateLimitWindowMs) / 1000),
          }
        );
      } catch (error) {
        markSpanError(span, error, "rate_limiter.handler_error");
        throw error;
      } finally {
        span.end();
      }
    },
  });
}

function createCorsMiddleware(config: HttpMiddlewareConfig) {
  return cors({
    origin: config.allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
}

function createHelmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });
}

function createJsonMiddleware(config: HttpMiddlewareConfig) {
  return [
    (req: Request, res: Response, next: NextFunction) => {
      const tracer = trace.getTracer("middleware");
      const span = tracer.startSpan("middleware.json_parsing", {
        attributes: {
          "request.method": req.method || "unknown",
          "request.content_type": req.get("content-type") || "unknown",
        },
      });

      const startTime = Date.now();

      express.json({
        limit: config.jsonBodyLimit,
        verify: (req, res, buf) => {
          const bodySize = buf.length;
          span.setAttributes({
            "request.body_size_bytes": bodySize,
          });

          if (bodySize > 10 * 1024 * 1024) {
            span.addEvent("request.body_too_large", {
              body_size_bytes: bodySize,
              limit_bytes: 10 * 1024 * 1024,
            });
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Request body too large",
            });
            throw new Error("Request body too large");
          }
        },
      })(req, res, (err) => {
        const processingTime = Date.now() - startTime;

        span.setAttributes({
          processing_time_ms: processingTime,
        });

        if (err) {
          span.addEvent("json.parsing_error", {
            "error.message": err.message,
            processing_time_ms: processingTime,
          });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          });
        } else {
          span.addEvent("json.parsing_success", {
            processing_time_ms: processingTime,
          });
          markSpanOk(span, "JSON parsing completed");
        }

        span.end();
        next(err);
      });
    },
  ];
}

function createUrlencodedMiddleware(config: HttpMiddlewareConfig) {
  return express.urlencoded({
    extended: true,
    limit: config.jsonBodyLimit,
    parameterLimit: 1000,
  });
}

function createTimeoutMiddleware(config: HttpMiddlewareConfig) {
  return [
    timeout(config.requestTimeout),
    (req: Request, res: Response, next: NextFunction) => {
      const tracer = trace.getTracer("middleware");
      const span = tracer.startSpan("middleware.timeout_check", {
        attributes: {
          "request.method": req.method || "unknown",
          "request.url": req.originalUrl || req.url || "unknown",
          "request.timeout_ms": 30000,
        },
      });

      try {
        if (req.timedout) {
          span.addEvent("request.timeout_occurred", {
            timeout_duration_ms: 30000,
          });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Request timeout",
          });
          log.warn("Request timed out");
        } else {
          span.addEvent("request.within_timeout");
          markSpanOk(span, "Request within timeout limits");
        }

        if (!req.timedout) next();
      } catch (error) {
        markSpanError(span, error, "middleware.timeout_error");
        throw error;
      } finally {
        span.end();
      }
    },
  ];
}

// Middleware to validate JSON-RPC requests
const validationMiddleware = [
  body("jsonrpc").equals("2.0"),
  body("method").isString().isLength({ min: 1, max: 100 }),
  body("params").isObject(),
  body("id").optional().isString(),
  (req: Request, res: Response, next: NextFunction) => {
    const tracer = trace.getTracer("middleware");
    const span = tracer.startSpan("middleware.validation", {
      attributes: {
        "request.method": req.method || "unknown",
        "request.url": req.originalUrl || req.url || "unknown",
        "validation.type": "json_rpc",
      },
    });

    try {
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        const errorDetails = errors.array();

        span.addEvent("validation.failed", {
          "error.count": errorDetails.length,
          "error.fields": errorDetails
            .map((err) => (err as any).path || (err as any).param || "unknown")
            .join(","),
        });

        span.setAttributes({
          "validation.success": false,
          "validation.error_count": errorDetails.length,
        });

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "JSON-RPC validation failed",
        });

        log.warn("JSON-RPC validation failed:", errorDetails);

        return res.status(400).json({
          error: "Validation failed",
          details: errorDetails,
        });
      }

      span.addEvent("validation.success");
      span.setAttributes({
        "validation.success": true,
      });

      markSpanOk(span, "JSON-RPC validation passed");

      next();
    } catch (error) {
      markSpanError(span, error, "middleware.validation_error");
      throw error;
    } finally {
      span.end();
    }
  },
];

export function createSecurityMiddlewares(
  config: HttpMiddlewareConfig = getHttpMiddlewareConfig()
) {
  return [
    createCorsMiddleware(config),
    createHelmetMiddleware(),
    ...createJsonMiddleware(config),
    createUrlencodedMiddleware(config),
    ...createTimeoutMiddleware(config),
    createRateLimiterMiddleware(config),

    // Optional:
    // ...validationMiddleware,
  ];
}

export const securityMiddlewares = createSecurityMiddlewares();
