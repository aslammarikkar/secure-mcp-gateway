import type { Express, Request, Response } from "express";
import { trace } from "@opentelemetry/api";
import { logger } from "../helpers/logs.js";
import { markSpanError, markSpanOk } from "../helpers/tracing.js";

type PackageInfo = {
  name?: string;
  version?: string;
};

type RegisterHealthRouteOptions = {
  app: Express;
  endpoint: string;
  pkg: PackageInfo;
};

const log = logger("health-route");

export function registerHealthRoute({ app, endpoint, pkg }: RegisterHealthRouteOptions) {
  app.get("/", (req: Request, res: Response) => {
    const tracer = trace.getTracer("http-server");
    const span = tracer.startSpan("http.health_check", {
      attributes: {
        "http.method": req.method,
        "http.route": "/",
        "http.user_agent": req.get("user-agent") || "unknown",
        "http.remote_addr": req.ip || "unknown",
      },
    });

    try {
      const now = new Date();
      const uptime = Math.round(process.uptime());
      const memoryUsage = process.memoryUsage();

      const healthData = {
        status: "ok",
        name: pkg.name || "mcp-server",
        version: pkg.version || "unknown",
        endpoint,
        uptimeSeconds: uptime,
        timestamp: now.toISOString(),
        environment: process.env.NODE_ENV || "development",
        pid: process.pid,
        memory: {
          rss: memoryUsage.rss,
          heapUsed: memoryUsage.heapUsed,
        },
      };

      span.setAttributes({
        "health.status": healthData.status,
        "health.uptime_seconds": uptime,
        "health.memory_rss": memoryUsage.rss,
        "health.memory_heap_used": memoryUsage.heapUsed,
        "health.pid": process.pid,
        "http.response.status_code": 200,
      });

      span.addEvent("health.check_completed", {
        "uptime_seconds": uptime,
        "memory_usage_mb": Math.round(memoryUsage.heapUsed / 1024 / 1024),
      });

      markSpanOk(span, "Health check successful");

      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(healthData);
    } catch (error) {
      markSpanError(span, error, "health.check_error");
      log.error("Health check error:", error);
      res.status(500).json({ error: "Health check failed" });
    } finally {
      span.end();
    }
  });
}