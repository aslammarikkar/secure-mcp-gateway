import type { Router, Request, Response } from "express";
import { trace } from "@opentelemetry/api";
import { validateJwt } from "../auth/validateJwt.js";
import { logger } from "../helpers/logs.js";
import { markSpanError, markSpanOk } from "../helpers/tracing.js";
import type { StreamableHTTPServer } from "../server.js";

type RegisterMcpRouteOptions = {
  router: Router;
  endpoint: string;
  server: StreamableHTTPServer;
};

const log = logger("mcp-route");

export function registerMcpRoute({ router, endpoint, server }: RegisterMcpRouteOptions) {
  // JWT validation runs before the transport handoff so the lower-level MCP server
  // can assume req.user and req.mcpAuth already represent an authenticated caller.
  router.all(endpoint, validateJwt, async (req: Request, res: Response) => {
    const tracer = trace.getTracer("http-server");
    const span = tracer.startSpan("http.mcp_request", {
      attributes: {
        "http.method": req.method,
        "http.route": endpoint,
        "http.user_agent": req.get("user-agent") || "unknown",
        "http.remote_addr": req.ip || "unknown",
        "http.content_type": req.get("content-type") || "unknown",
        "http.content_length": req.get("content-length") || 0,
      },
    });

    try {
      const startTime = Date.now();

      span.addEvent("mcp.request_started", {
        "request.method": req.method,
        "request.content_type": req.get("content-type") || "unknown",
      });

      await server.handleStreamableHTTP(req, res);

      const processingTime = Date.now() - startTime;

      span.setAttributes({
        "http.processing_time_ms": processingTime,
        "http.response.status_code": res.statusCode,
        "mcp.request_success": true,
      });

      span.addEvent("mcp.request_completed", {
        "processing_time_ms": processingTime,
        "response_status": res.statusCode,
      });

      markSpanOk(span, "MCP request processed successfully");
    } catch (error) {
      markSpanError(span, error, "mcp.request_error");
      span.setAttribute(
        "error.name",
        error instanceof Error ? error.name : "unknown"
      );
      log.error("MCP request error:", error);

      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    } finally {
      span.end();
    }
  });
}