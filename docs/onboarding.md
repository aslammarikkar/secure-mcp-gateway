# Onboarding Guide

This repository is a template for a remote MCP gateway built with Node.js, TypeScript, Express, and the MCP SDK. It exposes a stateless HTTP MCP endpoint, validates Microsoft Entra access tokens, and can exchange the incoming user token for a downstream Microsoft Graph token by using a managed identity in Azure Container Apps.

Use this document when you need to understand what the code does, where to change behavior safely, and which parts define the current secure path.

## What This Project Does

- Hosts an MCP server over HTTP at `/mcp`.
- Exposes a health endpoint at `/`.
- Exposes RFC 9728 OAuth protected resource metadata at `/.well-known/oauth-protected-resource`.
- Includes capability-oriented MCP tools for knowledge retrieval backed by a SharePoint-shaped example provider.
- Includes a reference implementation of delegated Microsoft Graph access through On-Behalf-Of with the `get_my_profile` tool.

## Current Security Model

The active authentication model is Microsoft Entra access tokens only. The earlier demo JWT path has been removed from the source tree.

Request flow:

1. A client sends a bearer token to `/mcp`.
2. [src/auth/validateJwt.ts](../src/auth/validateJwt.ts) validates the token against Entra JWKS.
3. The middleware maps claims into `req.user` and `req.mcpAuth`.
4. [src/server.ts](../src/server.ts) creates a request-scoped MCP server instance, authorizes tool access, and executes the requested tool.
5. The example knowledge tools call the capability layer, which delegates backend work to a provider implementation.
6. `get_my_profile` uses [src/auth/obo.ts](../src/auth/obo.ts) to exchange the incoming token for a Microsoft Graph token, then calls `GET /me`.

Important implementation detail:

- The validator accepts both Entra v2 issuer format and the Azure CLI v1 issuer format because `az account get-access-token --resource api://...` may return a v1 token.
- The MCP server is intentionally request-scoped. Do not store user identity or bearer tokens on a singleton service instance.

## High-Value Files

- [src/index.ts](../src/index.ts): Express entrypoint, health route, RFC 9728 metadata route, `/mcp` route wiring.
- [src/app.ts](../src/app.ts): Express app composition, separated from process startup so routes can be tested without bootstrapping the full runtime.
- [src/routes/health-route.ts](../src/routes/health-route.ts): Health endpoint implementation.
- [src/routes/protected-resource-route.ts](../src/routes/protected-resource-route.ts): RFC 9728 protected resource metadata endpoint.
- [src/routes/mcp-route.ts](../src/routes/mcp-route.ts): Authenticated MCP HTTP route.
- [src/server-middlewares.ts](../src/server-middlewares.ts): Security middleware factory for CORS, rate limiting, parsing, and timeout policy.
- [src/server.ts](../src/server.ts): MCP server wrapper, protocol checks, tool listing, permission enforcement, tool execution.
- [src/config/auth-config.ts](../src/config/auth-config.ts): Single source of truth for OAuth/OBO environment parsing and auth-related runtime configuration.
- [src/config/http-config.ts](../src/config/http-config.ts): Single source of truth for HTTP middleware policy such as allowed origins and rate limiting defaults.
- [src/tools.ts](../src/tools.ts): Compatibility barrel for the tool layer.
- [src/mcp/tool-registry.ts](../src/mcp/tool-registry.ts): Tool registry used by the MCP server.
- [src/mcp/tools/knowledge-tools.ts](../src/mcp/tools/knowledge-tools.ts): Knowledge-related MCP tool definitions and schemas.
- [src/mcp/tools/profile-tools.ts](../src/mcp/tools/profile-tools.ts): Graph/OBO-backed profile tool implementations.
- [src/capabilities/knowledge/knowledge-service.ts](../src/capabilities/knowledge/knowledge-service.ts): Capability layer that sits between MCP tools and provider implementations.
- [src/capabilities/knowledge/knowledge-provider.ts](../src/capabilities/knowledge/knowledge-provider.ts): Provider interface that future backends should implement.
- [src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts](../src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts): SharePoint-shaped example provider shipped with the template.
- [src/auth/validateJwt.ts](../src/auth/validateJwt.ts): Entra JWT validation and request auth context creation.
- [src/auth/obo.ts](../src/auth/obo.ts): Managed-identity-based OBO helper for downstream APIs.
- [src/auth/authorization.ts](../src/auth/authorization.ts): Roles and permissions.
- [infra/main.bicep](../infra/main.bicep): Subscription-scope deployment and resource group creation.
- [infra/resources.bicep](../infra/resources.bicep): Container App, managed identity, env vars, registry, monitoring.
- [azure.yaml](../azure.yaml): `azd` orchestration.
- [README.md](../README.md): Primary setup and deployment flow.

## Local Versus Azure Behavior

Local development:

- Works for the core MCP server and Entra JWT validation.
- Knowledge tools can run in `sample` mode locally, or against real SharePoint content through Microsoft Graph when delegated Graph permissions are configured.
- `get_my_profile` is not expected to work locally in the current design because OBO depends on the Azure managed identity attached to the deployed Container App.

Azure deployment:

- Uses `azd up` to provision and deploy.
- Injects the Entra and resource settings through Bicep.
- Attaches a user-assigned managed identity to the Container App.
- Uses that managed identity to obtain the assertion required for OBO.
- For the SharePoint provider, the app registration also needs delegated Microsoft Graph `Sites.Read.All` plus a federated credential whose subject matches the current Container App managed identity `principalId`.
- The repo ships a helper command, `npm run sync:sharepoint-auth`, to align those Entra settings after deployment.

## Required Environment Variables

Application auth settings:

- `TENANT_ID`: Entra tenant ID.
- `MCP_RESOURCE_APP_ID`: App registration client ID for the MCP resource API.
- `RESOURCE_SERVER_URL`: Base URL of the MCP server, for example `http://localhost:3000` or the ACA URL.
- `MCP_SCOPE`: Delegated scope required by the API. Default is `access_as_user`.
- `GRAPH_OBO_SCOPE`: Downstream Graph scope. Default is `https://graph.microsoft.com/User.Read`.
- `SHAREPOINT_GRAPH_SCOPE`: Delegated Graph scope used for SharePoint retrieval. Default is `https://graph.microsoft.com/Sites.Read.All`.

Template-only override:

- `SHAREPOINT_PROVIDER_MODE`: Use `sample` to keep the shipped example provider local-only and deterministic during smoke testing. Default is `graph`.

Azure-only setting:

- `AZURE_CLIENT_ID`: Client ID of the user-assigned managed identity attached to the Container App.

## End-to-End Request Model

The server expects standard MCP-over-HTTP behavior plus authentication-specific details.

For successful remote requests:

- Send `Authorization: Bearer <access-token>`.
- Send `Accept: application/json, text/event-stream`.
- It is useful to send `mcp-protocol-version: 2025-06-18`.

If token validation fails, the server returns `401 invalid_token` or `403 insufficient_scope` from [src/auth/validateJwt.ts](../src/auth/validateJwt.ts).

## How To Extend The Server Safely

To add a new tool:

1. Add the tool implementation in the appropriate module under [src/mcp/tools](../src/mcp/tools).
2. Declare its `requiredPermissions` on the tool definition itself.
3. Add its required permission in [src/auth/authorization.ts](../src/auth/authorization.ts) only if it should not reuse an existing permission.
4. Export the tool from [src/mcp/tool-registry.ts](../src/mcp/tool-registry.ts).
5. If the tool needs backend-specific retrieval logic, put that logic behind a capability/provider seam rather than directly in the tool module.
6. If the tool needs downstream API access, prefer reusing [src/auth/obo.ts](../src/auth/obo.ts) instead of adding client secrets.
7. Build and test with `npm run build` and an authenticated MCP request.

To change auth behavior:

1. Keep [src/auth/validateJwt.ts](../src/auth/validateJwt.ts) as the single entry point for bearer token validation.
2. Keep auth-related environment parsing in [src/config/auth-config.ts](../src/config/auth-config.ts), not spread across routes and helpers.
3. Keep request-scoped auth data in the Express request object, not global state.
4. Avoid reintroducing local demo tokens or parallel auth paths unless there is a concrete need, because they increase drift and documentation cost.

## First Customization Targets

For teams adopting this template, the usual replacement order is:

1. Replace or extend the example provider in [src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts](../src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts).
2. Update roles and permissions in [src/auth/authorization.ts](../src/auth/authorization.ts).
3. Replace or extend the downstream API behavior in [src/auth/obo.ts](../src/auth/obo.ts) and [src/mcp/tools/profile-tools.ts](../src/mcp/tools/profile-tools.ts) if Microsoft Graph is not your target API.
4. Rename deployment and telemetry identifiers in [azure.yaml](../azure.yaml) and [src/helpers/otel.ts](../src/helpers/otel.ts).
5. Revisit environment defaults and protected resource metadata wiring before the first production deployment.

## Replication Checklist

If you want to reproduce this setup in another repo or environment, keep these pieces together:

1. An Entra app registration representing the MCP resource API.
2. A delegated scope such as `access_as_user` exposed by that app.
3. A protected resource metadata endpoint that points clients to the right authorization server and scope.
4. Bearer token validation against Entra JWKS.
5. A managed identity attached to the workload.
6. A federated credential on the app registration trusting that managed identity for `api://AzureADTokenExchange`.
7. Delegated Microsoft Graph permission like `User.Read`, with admin consent when required.
8. For SharePoint retrieval through Graph, delegated Microsoft Graph `Sites.Read.All` with consent, plus a federated credential subject that matches the active managed identity principal id for the deployed Container App.

## Maintenance Notes

- The shipped SharePoint provider is example functionality. Treat it as scaffolding to replace, not the intended long-term product surface.
- The server is request-scoped and stateless from the MCP transport perspective.
- The most likely drift points are documentation, Entra app registration settings, and Bicep environment variable wiring. If behavior changes, update those three areas together.
- Service renames can invalidate app-registration federation. If OBO fails with `AADSTS700213` or `AADSTS70025`, compare the federated credential subject with the current user-assigned managed identity principal id on the Container App.
- The `sync:sharepoint-auth` helper is intentionally separate from `azd` hooks because not every deploy identity can modify app registrations or grant tenant-wide admin consent.
- Runtime-facing identifiers now use `secure-mcp-gateway` as the default service name. Replace that if your organization standardizes on a different name.
- Use `npm test` for the lightweight regression suite that covers the auth config boundary and MCP tool registry.
- Keep MCP tools capability-oriented and backend adapters provider-oriented so future integrations remain additive instead of leaking backend details into the protocol layer.
- Keep route composition in [src/app.ts](../src/app.ts) and startup side effects in [src/index.ts](../src/index.ts) so HTTP behavior stays testable.
- Keep route implementations in small modules under [src/routes](../src/routes) so [src/app.ts](../src/app.ts) remains composition-focused.
- Keep HTTP middleware policy in [src/config/http-config.ts](../src/config/http-config.ts) and construct middleware through [src/server-middlewares.ts](../src/server-middlewares.ts) rather than hard-coding env access inline.

## First Places To Read

If you are new to this repo, read in this order:

1. [README.md](../README.md)
2. [docs/onboarding.md](../docs/onboarding.md)
3. [src/index.ts](../src/index.ts)
4. [src/auth/validateJwt.ts](../src/auth/validateJwt.ts)
5. [src/config/auth-config.ts](../src/config/auth-config.ts)
6. [src/server.ts](../src/server.ts)
7. [src/mcp/tool-registry.ts](../src/mcp/tool-registry.ts)
8. [src/mcp/tools/knowledge-tools.ts](../src/mcp/tools/knowledge-tools.ts)
9. [src/mcp/tools/profile-tools.ts](../src/mcp/tools/profile-tools.ts)
10. [src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts](../src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts)
11. [infra/resources.bicep](../infra/resources.bicep)