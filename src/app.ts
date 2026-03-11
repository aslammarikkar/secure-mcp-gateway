import express from "express";
import { StreamableHTTPServer } from "./server.js";
import { createSecurityMiddlewares } from "./server-middlewares.js";
import { registerHealthRoute } from "./routes/health-route.js";
import { registerMcpRoute } from "./routes/mcp-route.js";
import { registerProtectedResourceRoute } from "./routes/protected-resource-route.js";

export const MCP_ENDPOINT = "/mcp";

type PackageInfo = {
  name?: string;
  version?: string;
};

type CreateAppOptions = {
  server?: StreamableHTTPServer;
  pkg?: PackageInfo;
};

export function createApp(options: CreateAppOptions = {}) {
  const server = options.server ?? new StreamableHTTPServer();
  const pkg = options.pkg ?? {};
  const app = express();
  const router = express.Router();

  // The MCP endpoint gets the stricter middleware stack because it carries
  // authenticated tool traffic, while the metadata and health routes stay lightweight.
  app.use(MCP_ENDPOINT, createSecurityMiddlewares());

  registerHealthRoute({ app, endpoint: MCP_ENDPOINT, pkg });
  registerProtectedResourceRoute(app);
  registerMcpRoute({ router, endpoint: MCP_ENDPOINT, server });

  // Keep route mounting centralized here so tests can build the full HTTP surface
  // without going through process startup in index.ts.
  app.use("/", router);

  return { app, server };
}