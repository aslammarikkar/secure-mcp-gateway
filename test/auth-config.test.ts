import test from "node:test";
import assert from "node:assert/strict";

import {
  getOboConfig,
  getOAuthConfig,
  getProtectedResourceMetadataConfig,
  getProtectedResourceMetadataMissingEnv,
} from "../src/config/auth-config.ts";
import { getSharePointConfig } from "../src/config/provider-config.ts";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

const ENV_KEYS = [
  "TENANT_ID",
  "MCP_RESOURCE_APP_ID",
  "MCP_SCOPE",
  "RESOURCE_SERVER_URL",
  "GRAPH_OBO_SCOPE",
  "AZURE_CLIENT_ID",
  "SHAREPOINT_PROVIDER_MODE",
  "SHAREPOINT_GRAPH_SCOPE",
  "SHAREPOINT_SEARCH_ENTITY_TYPES",
] as const;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("getOAuthConfig returns normalized OAuth settings", () => {
  const snapshot = snapshotEnv();

  try {
    process.env.TENANT_ID = "tenant-123";
    process.env.MCP_RESOURCE_APP_ID = "app-456";
    process.env.MCP_SCOPE = "custom.scope";

    const config = getOAuthConfig();

    assert.deepEqual(config, {
      tenantId: "tenant-123",
      resourceAppId: "app-456",
      scopeRequired: "custom.scope",
      issuers: [
        "https://login.microsoftonline.com/tenant-123/v2.0",
        "https://sts.windows.net/tenant-123/",
      ],
      audiences: ["app-456", "api://app-456"],
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("getProtectedResourceMetadataConfig trims trailing slashes and applies defaults", () => {
  const snapshot = snapshotEnv();

  try {
    process.env.TENANT_ID = "tenant-123";
    process.env.MCP_RESOURCE_APP_ID = "app-456";
    process.env.RESOURCE_SERVER_URL = "https://example.com///";
    delete process.env.MCP_SCOPE;

    const config = getProtectedResourceMetadataConfig();

    assert.deepEqual(config, {
      resource: "https://example.com",
      tenantId: "tenant-123",
      resourceAppId: "app-456",
      scope: "access_as_user",
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("getProtectedResourceMetadataMissingEnv reports all missing values", () => {
  const snapshot = snapshotEnv();

  try {
    delete process.env.RESOURCE_SERVER_URL;
    delete process.env.TENANT_ID;
    delete process.env.MCP_RESOURCE_APP_ID;

    assert.deepEqual(getProtectedResourceMetadataMissingEnv(), [
      "RESOURCE_SERVER_URL",
      "TENANT_ID",
      "MCP_RESOURCE_APP_ID",
    ]);
  } finally {
    restoreEnv(snapshot);
  }
});

test("getOboConfig returns managed identity and graph defaults", () => {
  const snapshot = snapshotEnv();

  try {
    process.env.TENANT_ID = "tenant-123";
    process.env.MCP_RESOURCE_APP_ID = "app-456";
    process.env.AZURE_CLIENT_ID = "mi-789";
    delete process.env.GRAPH_OBO_SCOPE;

    const config = getOboConfig();

    assert.deepEqual(config, {
      tenantId: "tenant-123",
      clientId: "app-456",
      managedIdentityClientId: "mi-789",
      graphScope: "https://graph.microsoft.com/User.Read",
      tokenExchangeScope: "api://AzureADTokenExchange/.default",
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("getOAuthConfig throws when required auth env is missing", () => {
  const snapshot = snapshotEnv();

  try {
    delete process.env.TENANT_ID;
    process.env.MCP_RESOURCE_APP_ID = "app-456";

    assert.throws(() => getOAuthConfig(), {
      message: "TENANT_ID environment variable is required",
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("getSharePointConfig returns graph defaults", () => {
  const snapshot = snapshotEnv();

  try {
    delete process.env.SHAREPOINT_PROVIDER_MODE;
    delete process.env.SHAREPOINT_GRAPH_SCOPE;
    delete process.env.SHAREPOINT_SEARCH_ENTITY_TYPES;

    assert.deepEqual(getSharePointConfig(), {
      providerMode: "graph",
      graphScope: "https://graph.microsoft.com/Sites.Read.All",
      entityTypes: ["driveItem"],
    });
  } finally {
    restoreEnv(snapshot);
  }
});

test("getSharePointConfig parses sample mode and entity types", () => {
  const snapshot = snapshotEnv();

  try {
    process.env.SHAREPOINT_PROVIDER_MODE = "sample";
    process.env.SHAREPOINT_GRAPH_SCOPE = "https://graph.microsoft.com/Files.Read.All";
    process.env.SHAREPOINT_SEARCH_ENTITY_TYPES = "driveItem,listItem";

    assert.deepEqual(getSharePointConfig(), {
      providerMode: "sample",
      graphScope: "https://graph.microsoft.com/Files.Read.All",
      entityTypes: ["driveItem", "listItem"],
    });
  } finally {
    restoreEnv(snapshot);
  }
});