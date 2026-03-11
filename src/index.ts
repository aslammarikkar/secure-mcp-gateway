import "dotenv/config";
import { initializeTelemetry } from "./helpers/otel.js";
initializeTelemetry();

import { createRequire } from "node:module";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { StreamableHTTPServer } from "./server.js";
import { logger } from "./helpers/logs.js";
import { createApp, MCP_ENDPOINT } from "./app.js";

const log = logger("index");
const server = new StreamableHTTPServer();

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const { app } = createApp({ server, pkg });

const PORT = process.env.PORT || 3000;
const tracer = trace.getTracer('http-server');
const serverSpan = tracer.startSpan('http.server_startup', {
  attributes: {
    'server.port': Number(PORT),
    'server.endpoint': MCP_ENDPOINT,
    'server.name': pkg.name || 'mcp-server',
    'server.version': pkg.version || 'unknown',
  },
});

try {
  app.listen(PORT, () => {
    log.success(`MCP Stateless Streamable HTTP Server`);
    log.success(`MCP endpoint: http://localhost:${PORT}${MCP_ENDPOINT}`);
    log.success(`Health check: http://localhost:${PORT}/`);
    log.success(`Press Ctrl+C to stop the server`);
  });
} catch (error) {
  serverSpan.addEvent('server.startup_error', {
    'error.message': error instanceof Error ? error.message : String(error),
  });
  serverSpan.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
  log.error('Server startup error:', error);
  throw error;
} finally {
  serverSpan.end();
}

process.on("SIGINT", async () => {
  const shutdownSpan = tracer.startSpan('http.server_shutdown', {
    attributes: {
      'shutdown.signal': 'SIGINT',
      'server.uptime_seconds': Math.round(process.uptime()),
    },
  });
  
  try {
    log.error("Shutting down server...");
    
    shutdownSpan.addEvent('shutdown.started', {
      'uptime_seconds': Math.round(process.uptime()),
    });
    
    const shutdownStart = Date.now();
    await server.close();
    const shutdownTime = Date.now() - shutdownStart;
    
    shutdownSpan.setAttributes({
      'shutdown.success': true,
      'shutdown.time_ms': shutdownTime,
    });
    
    shutdownSpan.addEvent('shutdown.completed', {
      'shutdown_time_ms': shutdownTime,
    });
    
    shutdownSpan.setStatus({
      code: SpanStatusCode.OK,
      message: 'Server shutdown completed',
    });
    
    log.success('Server shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    shutdownSpan.addEvent('shutdown.error', {
      'error.message': error instanceof Error ? error.message : String(error),
    });
    shutdownSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    log.error('Error during shutdown:', error);
    process.exit(1);
  } finally {
    shutdownSpan.end();
  }
});
