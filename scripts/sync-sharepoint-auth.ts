import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
const TOKEN_EXCHANGE_AUDIENCE = "api://AzureADTokenExchange";
const FEDERATED_CREDENTIAL_NAME = "aca-mcp-obo";
const SITES_READ_ALL = "Sites.Read.All";

type RequestedPermission = {
  resourceAppId: string;
  resourceAccess?: Array<{
    id: string;
    type: string;
  }>;
};

type FederatedCredential = {
  id: string;
  name: string;
  issuer: string;
  subject: string;
  audiences: string[];
};

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function runAzCli(args: string[]): string {
  const executables = process.platform === "win32" ? ["az.cmd", "az"] : ["az"];
  let lastError: unknown;

  for (const executable of executables) {
    try {
      return execFileSync(executable, args, { encoding: "utf8" }).trim();
    } catch (error) {
      lastError = error;
    }
  }

  if (process.platform === "win32") {
    const command = ["az", ...args.map((arg) => (arg.includes(" ") ? `'${arg}'` : arg))].join(" ");
    try {
      return execFileSync("pwsh", ["-NoProfile", "-Command", command], {
        encoding: "utf8",
      }).trim();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Azure CLI executable not found");
}

function parseJson<T>(value: string): T {
  if (!value.trim()) {
    throw new Error("Expected JSON output from Azure CLI but received an empty response");
  }

  return JSON.parse(value) as T;
}

function getContainerAppName(): string {
  const resourceId = getRequiredEnv("AZURE_RESOURCE_SECURE_MCP_GATEWAY_ID");
  const parts = resourceId.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

function getContainerManagedIdentityClientId(): string {
  const resourceGroup = getRequiredEnv("AZURE_RESOURCE_GROUP");
  const appName = getContainerAppName();
  const containerApp = parseJson<{
    properties?: {
      template?: {
        containers?: Array<{
          env?: Array<{ name?: string; value?: string }>;
        }>;
      };
    };
  }>(runAzCli([
    "containerapp",
    "show",
    "--name",
    appName,
    "--resource-group",
    resourceGroup,
    "-o",
    "json",
  ]));
  const envEntries = containerApp.properties?.template?.containers?.[0]?.env ?? [];

  const output = envEntries.find((entry) => entry.name === "AZURE_CLIENT_ID")?.value;

  if (!output) {
    throw new Error("AZURE_CLIENT_ID was not found on the deployed Container App");
  }

  return output;
}

function getManagedIdentityPrincipalId(clientId: string): string {
  const resourceGroup = getRequiredEnv("AZURE_RESOURCE_GROUP");
  const identities = parseJson<Array<{ clientId?: string; principalId?: string }>>(runAzCli([
    "identity",
    "list",
    "--resource-group",
    resourceGroup,
    "-o",
    "json",
  ]));
  const output = identities.find((identity) => identity.clientId === clientId)?.principalId;

  if (!output) {
    throw new Error(`Managed identity principalId not found for clientId ${clientId}`);
  }

  return output;
}

function getSitesReadAllScopeId(): string {
  const servicePrincipal = parseJson<{ oauth2PermissionScopes?: Array<{ value?: string; id?: string }> }>(runAzCli([
    "ad",
    "sp",
    "show",
    "--id",
    GRAPH_APP_ID,
    "-o",
    "json",
  ]));
  const output = servicePrincipal.oauth2PermissionScopes?.find(
    (scope) => scope.value === SITES_READ_ALL
  )?.id;

  if (!output) {
    throw new Error(`Unable to resolve Microsoft Graph delegated scope id for ${SITES_READ_ALL}`);
  }

  return output;
}

function ensureSitesReadAllPermission(appId: string, scopeId: string) {
  const requested = parseJson<RequestedPermission[]>(
    runAzCli(["ad", "app", "permission", "list", "--id", appId])
  );

  const graphPermission = requested.find((entry) => entry.resourceAppId === GRAPH_APP_ID);
  const alreadyRequested = !!graphPermission?.resourceAccess?.some(
    (permission) => permission.id === scopeId && permission.type === "Scope"
  );

  if (!alreadyRequested) {
    console.log(`Adding delegated Microsoft Graph permission ${SITES_READ_ALL}`);
    runAzCli([
      "ad",
      "app",
      "permission",
      "add",
      "--id",
      appId,
      "--api",
      GRAPH_APP_ID,
      "--api-permissions",
      `${scopeId}=Scope`,
    ]);
  } else {
    console.log(`Delegated Microsoft Graph permission ${SITES_READ_ALL} already requested`);
  }
}

function grantSitesReadAll(appId: string) {
  console.log(`Granting delegated Microsoft Graph permission ${SITES_READ_ALL}`);
  runAzCli([
    "ad",
    "app",
    "permission",
    "grant",
    "--id",
    appId,
    "--api",
    GRAPH_APP_ID,
    "--scope",
    SITES_READ_ALL,
  ]);
}

function adminConsent(appId: string, skipAdminConsent: boolean) {
  if (skipAdminConsent) {
    console.log("Skipping admin consent because --skip-admin-consent was provided");
    return;
  }

  console.log("Attempting tenant admin consent for the app registration");
  runAzCli(["ad", "app", "permission", "admin-consent", "--id", appId]);
}

function syncFederatedCredential(appId: string, tenantId: string, principalId: string) {
  const current = parseJson<FederatedCredential[]>(
    runAzCli(["ad", "app", "federated-credential", "list", "--id", appId])
  );
  const credential = current.find((entry) => entry.name === FEDERATED_CREDENTIAL_NAME);
  const desiredIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const desiredAudience = TOKEN_EXCHANGE_AUDIENCE;

  const matches =
    credential &&
    credential.issuer === desiredIssuer &&
    credential.subject === principalId &&
    credential.audiences.includes(desiredAudience);

  if (matches) {
    console.log(`Federated credential ${FEDERATED_CREDENTIAL_NAME} is already aligned`);
    return;
  }

  if (credential) {
    console.log(`Deleting stale federated credential ${FEDERATED_CREDENTIAL_NAME}`);
    runAzCli([
      "ad",
      "app",
      "federated-credential",
      "delete",
      "--id",
      appId,
      "--federated-credential-id",
      credential.id,
    ]);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "secure-mcp-fic-"));
  const payloadPath = join(tempDir, "credential.json");

  try {
    writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          name: FEDERATED_CREDENTIAL_NAME,
          issuer: desiredIssuer,
          subject: principalId,
          audiences: [desiredAudience],
          description: "Trust the Container App managed identity for secretless OBO",
        },
        null,
        2
      ),
      "utf8"
    );

    console.log(`Creating federated credential ${FEDERATED_CREDENTIAL_NAME}`);
    runAzCli([
      "ad",
      "app",
      "federated-credential",
      "create",
      "--id",
      appId,
      "--parameters",
      payloadPath,
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const skipAdminConsent = process.argv.includes("--skip-admin-consent");
  const appId = getRequiredEnv("MCP_RESOURCE_APP_ID");
  const tenantId = getRequiredEnv("TENANT_ID");
  const clientId = getContainerManagedIdentityClientId();
  const principalId = getManagedIdentityPrincipalId(clientId);
  const sitesReadAllScopeId = getSitesReadAllScopeId();

  console.log(`Container App managed identity clientId: ${clientId}`);
  console.log(`Container App managed identity principalId: ${principalId}`);

  ensureSitesReadAllPermission(appId, sitesReadAllScopeId);
  grantSitesReadAll(appId);
  adminConsent(appId, skipAdminConsent);
  syncFederatedCredential(appId, tenantId, principalId);

  console.log("SharePoint Entra configuration is aligned with the deployed Container App.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});