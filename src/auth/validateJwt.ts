import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import {
  Permission,
  type AuthenticatedUser,
  UserRole,
} from "./authorization.js";
import type { RequestAuthContext } from "../types/auth-context.js";
import { getOAuthConfig } from "../config/auth-config.js";

let cachedTenantId: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(tenantId: string) {
  // JWKS discovery is tenant-specific, so keep one cache entry per tenant and
  // refresh it only when configuration changes.
  if (!cachedJwks || cachedTenantId !== tenantId) {
    cachedTenantId = tenantId;
    cachedJwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
  }

  return cachedJwks;
}

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [type, token] = h.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function hasRequiredAccess(payload: JWTPayload, requiredScope: string): boolean {
  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((value): value is string => typeof value === "string")
    : [];

  return scopes.includes(requiredScope) || roles.includes(requiredScope);
}

function buildAuthenticatedUser(payload: JWTPayload): AuthenticatedUser {
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((value): value is string => typeof value === "string")
    : [];

  const isReadOnly = roles.some((role) => ["readonly", "MCP.ReadOnly"].includes(role));
  const isAdmin = roles.some((role) => ["admin", "MCP.Admin"].includes(role));

  return {
    id:
      (typeof payload.oid === "string" && payload.oid) ||
      (typeof payload.sub === "string" && payload.sub) ||
      "unknown-user",
    email:
      (typeof payload.preferred_username === "string" && payload.preferred_username) ||
      (typeof payload.upn === "string" && payload.upn) ||
      (typeof payload.email === "string" && payload.email) ||
      "unknown@example.com",
    role: isReadOnly
      ? UserRole.READONLY
      : isAdmin
        ? UserRole.ADMIN
        : UserRole.USER,
    permissions: isReadOnly
      ? [Permission.READ_TODOS, Permission.READ_PROFILE, Permission.LIST_TOOLS]
      : Object.values(Permission),
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

export async function validateJwt(req: Request, res: Response, next: NextFunction) {
  try {
    // This middleware is the single entry point for bearer-token auth. Downstream
    // route and MCP runtime code assume req.user and req.mcpAuth are already set.
    const oauthConfig = getOAuthConfig();
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "missing_bearer_token",
      });
    }

    const { payload } = await jwtVerify(token, getJwks(oauthConfig.tenantId), {
      issuer: oauthConfig.issuers,
      audience: oauthConfig.audiences,
      algorithms: ["RS256"],
    });

    if (!hasRequiredAccess(payload, oauthConfig.scopeRequired)) {
      return res.status(403).json({
        error: "insufficient_scope",
        required: oauthConfig.scopeRequired,
      });
    }

    const user = buildAuthenticatedUser(payload);

  // Preserve both the normalized user shape and the raw token/payload so tool
  // execution can make authorization decisions and perform downstream OBO calls.
    const auth: RequestAuthContext = { payload, accessToken: token, user };
    req.user = user;
    req.mcpAuth = auth;
    next();
  } catch (error) {
    return res.status(401).json({
      error: "invalid_token",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
