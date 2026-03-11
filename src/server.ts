import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  JSONRPCError,
  JSONRPCNotification,
  ListToolsRequestSchema,
  LoggingMessageNotification,
  Notification,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  context,
  ContextAPI,
  Span,
  trace,
  TraceAPI,
} from "@opentelemetry/api";
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  AuthenticatedUser,
  hasPermission,
  Permission,
} from "./auth/authorization.js";
import { logger } from "./helpers/logs.js";
import {
  markSpanError,
  markSpanErrorMessage,
  markSpanOk,
} from "./helpers/tracing.js";
import { getToolByName, registeredTools, type ToolDefinition } from "./tools.js";

const log = logger("server");
const JSON_RPC = "2.0";
const JSON_RPC_ERROR = -32603;
const SERVER_INFO = {
  name: "secure-mcp-gateway",
  version: "1.0.0",
} as const;

type RequestExecutionContext = {
  user: AuthenticatedUser | null;
  accessToken: string | null;
};

type ActiveSession = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

export class StreamableHTTPServer {
  private activeSessions = new Set<ActiveSession>();

  async close() {
    const tracer = trace.getTracer("mcp-server");
    const span = tracer.startSpan("server.close");

    try {
      log.info("Closing active MCP sessions...");

      span.addEvent("server.closing_started");

      const closeStart = Date.now();
      await Promise.allSettled(
        Array.from(this.activeSessions, (session) => this.disposeSession(session))
      );
      const closeTime = Date.now() - closeStart;

      span.setAttributes({
        "server.close_time_ms": closeTime,
        "server.close_success": true,
      });

      span.addEvent("server.closed_successfully", {
        close_time_ms: closeTime,
      });

      markSpanOk(span, "Active sessions closed successfully");

      log.success("MCP server sessions closed successfully");
    } catch (error) {
      markSpanError(span, error, "server.close_error");
      log.error("Error closing MCP server:", error);
      throw error;
    } finally {
      span.end();
    }
  }

  async handleStreamableHTTP(req: Request, res: Response) {
    log.info(
      `${req.method} ${req.originalUrl} (${req.ip}) - payload:`,
      req.body || "{}"
    );

    const requestContext = this.createRequestContext(req);

  // Each HTTP request gets its own MCP server + transport pair so auth state
  // and tool execution context never leak across concurrent requests.
    const session = this.createSession(requestContext);
    let cleanedUp = false;

    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      await this.disposeSession(session);
    };

    this.activeSessions.add(session);
    res.once("close", () => {
      log.success("Request closed by client");
      void cleanup();
    });

    try {
      log.info("Connecting transport to server...");

      await session.server.connect(session.transport);
      log.success("Transport connected. Handling request...");

      await session.transport.handleRequest(req, res, req.body);

      await this.sendConnectionMessage(session.server);
      log.success(
        `${req.method} request handled successfully (status=${res.statusCode})`
      );
    } catch (error) {
      log.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res
          .status(500)
          .json(this.createRPCErrorResponse("Internal server error."));
        log.error("Responded with 500 Internal Server Error");
      }

      await cleanup();
    }
  }

  private createRequestContext(req: Request): RequestExecutionContext {
    return {
      user: req.user ?? null,
      accessToken: req.mcpAuth?.accessToken ?? null,
    };
  }

  private createSession(requestContext: RequestExecutionContext): ActiveSession {
    const server = new Server(SERVER_INFO, {
      capabilities: {
        tools: {},
        logging: {
          level: "info",
        },
      },
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Handlers close over the request-scoped auth context captured above.
    this.setupServerRequestHandlers(server, requestContext);

    return { server, transport };
  }

  private async disposeSession(session: ActiveSession) {
    this.activeSessions.delete(session);
    session.transport.close();
    await session.server.close();
  }

  private listTools(
    requestContext: RequestExecutionContext,
    parentSpan: Span,
    traceApi: TraceAPI,
    contextApi: ContextAPI
  ) {
    const ctx = traceApi.setSpan(contextApi.active(), parentSpan);
    const tracer = trace.getTracer("mcp-server");
    const span = tracer.startSpan("listTools", undefined, ctx);

    const user = requestContext.user;
    span.setAttribute("user.id", user?.id || "anonymous");
    span.setAttribute("user.role", user?.role || "none");

    // Check if user has permission to list tools
    if (!user || !hasPermission(user, Permission.LIST_TOOLS)) {
      log.warn(`User ${user?.id || "unknown"} denied permission to list tools`);
      span.addEvent("authorization.denied", { reason: "missing LIST_TOOLS" });
      markSpanErrorMessage(span, "Permission denied");
      const resp = this.createRPCErrorResponse(
        "Insufficient permissions to list tools"
      );
      span.end();
      return resp;
    }

    // Filter tools based on user permissions
    const filterSpan = tracer.startSpan("authorization.filterTools");
    const allowedTools = registeredTools.filter((tool) => {
      const allowed = tool.requiredPermissions.some((permission) =>
        hasPermission(user, permission)
      );
      if (allowed) {
        filterSpan.addEvent("tool.allowed", { tool: tool.name });
      } else {
        filterSpan.addEvent("tool.denied", { tool: tool.name });
      }
      return allowed;
    });
    filterSpan.setAttribute("tools.allowed.count", allowedTools.length);
    filterSpan.end();

    log.info(`User ${user.id} listed ${allowedTools.length} available tools`);
    span.setAttribute("tools.returned", allowedTools.length);
    markSpanOk(span, "Tools listed successfully");
    span.end();
    return {
      jsonrpc: JSON_RPC,
      tools: allowedTools,
    };
  }

  private setupServerRequestHandlers(
    server: Server,
    requestContext: RequestExecutionContext
  ) {
    // The MCP SDK dispatches by schema. Register all request handlers in one place
    // so the server's exposed capabilities stay easy to audit.
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tracer = trace.getTracer("mcp-server");
      const parentSpan = tracer.startSpan("main");
      return this.listTools(requestContext, parentSpan, trace, context);
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tracer = trace.getTracer("mcp-server");
      const span = tracer.startSpan("callTool", {
        attributes: {
          "tool.name": request.params.name,
          "tool.arguments": JSON.stringify(request.params.arguments),
        },
      });

      const args = request.params.arguments;
      const toolName = request.params.name;
      const user = requestContext.user;
      const tool = getToolByName(toolName);

      // Add user context to span
      if (user) {
        span.setAttributes({
          "user.id": user.id,
          "user.role": user.role,
          "user.email": user.email || "unknown",
        });
      }

      log.info(
        `User ${user?.id || "unknown"} attempting to call tool: ${toolName}`
      );

      try {
        if (!user) {
          span.addEvent("authentication.failed", {
            reason: "no_user_context",
          });
          markSpanErrorMessage(span, "Authentication required");
          log.warn(`Unauthenticated user attempted to call tool: ${toolName}`);
          return this.createRPCErrorResponse("Authentication required");
        }

        if (!tool) {
          span.addEvent("tool.not_found", {
            "tool.name": toolName,
          });
          markSpanErrorMessage(span, "Tool not found");
          log.error(`Tool ${toolName} not found.`);
          return this.createRPCErrorResponse(`Tool ${toolName} not found.`);
        }

        // Check tool-specific permissions
        const hasRequiredPermission = tool.requiredPermissions.some(
          (permission) => hasPermission(user, permission)
        );

        span.setAttributes({
          "authorization.required_permissions": tool.requiredPermissions.join(","),
          "authorization.has_permission": hasRequiredPermission,
        });

        if (!hasRequiredPermission) {
          span.addEvent("authorization.denied", {
            "user.id": user.id,
            "tool.name": toolName,
            required_permissions: tool.requiredPermissions.join(","),
          });
          markSpanErrorMessage(span, "Insufficient permissions");
          log.warn(
            `User ${user.id} denied permission to call tool: ${toolName}`
          );
          return this.createRPCErrorResponse(
            `Insufficient permissions to call tool: ${toolName}`
          );
        }

        log.info(`Executing tool ${toolName} with arguments:`, args);
        span.addEvent("tool.execution_started", {
          "tool.name": toolName,
          "arguments.count": args ? Object.keys(args).length : 0,
        });

        const executionStart = Date.now();
        const result = await tool.execute(args as any, {
          accessToken: requestContext.accessToken,
          user,
        });
        const executionTime = Date.now() - executionStart;

        span.setAttributes({
          "tool.execution_time_ms": executionTime,
          "tool.result_type": typeof result,
        });

        span.addEvent("tool.execution_completed", {
          execution_time_ms: executionTime,
          result_content_items: result.content?.length || 0,
        });

        markSpanOk(span, "Tool executed successfully");

        log.success(
          `User ${user.id} successfully executed tool ${toolName}. Result:`,
          result
        );
        return {
          jsonrpc: JSON_RPC,
          ...result,
        };
      } catch (error) {
        span.setAttribute(
          "error.name",
          error instanceof Error ? error.name : "unknown"
        );
        markSpanError(span, error, "tool.execution_error");
        log.error(
          `Error executing tool ${toolName} for user ${user?.id || "unknown"}:`,
          error
        );
        return this.createRPCErrorResponse(
          `Error executing tool ${toolName}: ${error}`
        );
      } finally {
        span.end();
      }
    });

    server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      const { level } = request.params;
      log.info(`Setting log level to: ${level}`);

      // Demonstrate different log levels
      await server.notification({
        method: "notifications/message",
        params: {
          level: "debug",
          logger: "test-server",
          data: `Logging level set to: ${level}`,
        },
      });

      return {};
    });
  }

  private async sendConnectionMessage(server: Server) {
    const tracer = trace.getTracer("mcp-server");
    const span = tracer.startSpan("server.sendMessages");

    try {
      const message: LoggingMessageNotification = {
        method: "notifications/message",
        params: { level: "info", data: "Connection established" },
      };

      span.addEvent("message.created", {
        "message.method": message.method,
        "message.level": message.params.level,
      });

      log.info("Sending connection established notification.");
      await this.sendNotification(server, message);

      span.addEvent("message.sent_successfully");
      markSpanOk(span, "Messages sent successfully");
    } catch (error) {
      markSpanError(span, error, "message.send_error");
      throw error;
    } finally {
      span.end();
    }
  }

  private async sendNotification(server: Server, notification: Notification) {
    const tracer = trace.getTracer("mcp-server");
    const span = tracer.startSpan("server.sendNotification", {
      attributes: {
        "notification.method": notification.method,
      },
    });

    try {
      // The SDK expects JSON-RPC notifications, so this is the narrow place where
      // domain notifications are translated into wire-format messages.
      const rpcNotificaiton: JSONRPCNotification = {
        ...notification,
        jsonrpc: JSON_RPC,
      };

      span.setAttributes({
        "rpc.jsonrpc_version": JSON_RPC,
        "rpc.method": notification.method,
      });

      span.addEvent("notification.sending", {
        method: notification.method,
      });

      log.info(`Sending notification: ${notification.method}`);
      const startTime = Date.now();
      await server.notification(rpcNotificaiton);
      const sendTime = Date.now() - startTime;

      span.setAttributes({
        "notification.send_time_ms": sendTime,
      });

      span.addEvent("notification.sent", {
        method: notification.method,
        send_time_ms: sendTime,
      });

      markSpanOk(span, "Notification sent successfully");
    } catch (error) {
      span.setAttribute("notification.method", notification.method);
      markSpanError(span, error, "notification.send_error");
      throw error;
    } finally {
      span.end();
    }
  }

  private createRPCErrorResponse(message: string): JSONRPCError {
    return {
      jsonrpc: JSON_RPC,
      error: {
        code: JSON_RPC_ERROR,
        message: message,
      },
      id: randomUUID(),
    };
  }
}
