const DEFAULT_MCP_SCOPE = "access_as_user";
const DEFAULT_GRAPH_SCOPE = "https://graph.microsoft.com/User.Read";
const TOKEN_EXCHANGE_SCOPE = "api://AzureADTokenExchange/.default";

type RequiredAuthEnv = "TENANT_ID" | "MCP_RESOURCE_APP_ID";

export type OAuthConfig = {
  tenantId: string;
  resourceAppId: string;
  scopeRequired: string;
  issuers: string[];
  audiences: string[];
};

export type ProtectedResourceMetadataConfig = {
  resource: string;
  tenantId: string;
  resourceAppId: string;
  scope: string;
};

export type OboConfig = {
  tenantId: string;
  clientId: string;
  managedIdentityClientId: string;
  graphScope: string;
  tokenExchangeScope: string;
};

function getTrimmedEnv(name: string): string | undefined {
  return process.env[name]?.trim();
}

function getRequiredEnv(name: string): string {
  const value = getTrimmedEnv(name);

  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

export function getOAuthConfig(): OAuthConfig {
  const tenantId = getRequiredEnv("TENANT_ID");
  const resourceAppId = getRequiredEnv("MCP_RESOURCE_APP_ID");
  const scopeRequired = getTrimmedEnv("MCP_SCOPE") || DEFAULT_MCP_SCOPE;

  return {
    tenantId,
    resourceAppId,
    scopeRequired,
    issuers: [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ],
    audiences: [resourceAppId, `api://${resourceAppId}`],
  };
}

export function getProtectedResourceMetadataConfig(): ProtectedResourceMetadataConfig {
  return {
    resource: getRequiredEnv("RESOURCE_SERVER_URL").replace(/\/+$/, ""),
    tenantId: getRequiredEnv("TENANT_ID"),
    resourceAppId: getRequiredEnv("MCP_RESOURCE_APP_ID"),
    scope: getTrimmedEnv("MCP_SCOPE") || DEFAULT_MCP_SCOPE,
  };
}

export function getProtectedResourceMetadataMissingEnv(): string[] {
  const required: Array<"RESOURCE_SERVER_URL" | RequiredAuthEnv> = [
    "RESOURCE_SERVER_URL",
    "TENANT_ID",
    "MCP_RESOURCE_APP_ID",
  ];

  return required.filter((name) => !getTrimmedEnv(name));
}

export function getOboConfig(): OboConfig {
  return {
    tenantId: getRequiredEnv("TENANT_ID"),
    clientId: getRequiredEnv("MCP_RESOURCE_APP_ID"),
    managedIdentityClientId: getRequiredEnv("AZURE_CLIENT_ID"),
    graphScope: getTrimmedEnv("GRAPH_OBO_SCOPE") || DEFAULT_GRAPH_SCOPE,
    tokenExchangeScope: TOKEN_EXCHANGE_SCOPE,
  };
}