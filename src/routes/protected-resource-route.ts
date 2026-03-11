import type { Express, Request, Response } from "express";
import {
  getProtectedResourceMetadataConfig,
  getProtectedResourceMetadataMissingEnv,
} from "../config/auth-config.js";

export function registerProtectedResourceRoute(app: Express) {
  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");

    const missingEnv = getProtectedResourceMetadataMissingEnv();
    if (missingEnv.length > 0) {
      return res.status(500).json({
        error: "missing_env",
        missing: missingEnv,
      });
    }

    const metadataConfig = getProtectedResourceMetadataConfig();

    return res.json({
      resource: metadataConfig.resource,
      bearer_methods_supported: ["header"],
      authorization_servers: [
        `https://login.microsoftonline.com/${metadataConfig.tenantId}/v2.0`,
      ],
      scopes_supported: [
        `api://${metadataConfig.resourceAppId}/${metadataConfig.scope}`,
      ],
    });
  });
}