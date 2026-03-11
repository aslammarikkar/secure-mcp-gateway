import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { createApp } from "../src/app.ts";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

const ENV_KEYS = [
  "TENANT_ID",
  "MCP_RESOURCE_APP_ID",
  "MCP_SCOPE",
  "RESOURCE_SERVER_URL",
  "ALLOWED_ORIGINS",
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

async function startTestServer() {
  const { app } = createApp({
    pkg: {
      name: "test-server",
      version: "0.0.0-test",
    },
  });

  const listener = await new Promise<import("node:http").Server>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });

  const { port } = listener.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        listener.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

test("protected resource metadata route returns normalized metadata", async () => {
  const snapshot = snapshotEnv();

  try {
    process.env.TENANT_ID = "tenant-123";
    process.env.MCP_RESOURCE_APP_ID = "app-456";
    process.env.MCP_SCOPE = "access_as_user";
    process.env.RESOURCE_SERVER_URL = "https://example.com///";

    const server = await startTestServer();

    try {
      const response = await fetch(`${server.baseUrl}/.well-known/oauth-protected-resource`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("pragma"), "no-cache");
      assert.deepEqual(body, {
        resource: "https://example.com",
        bearer_methods_supported: ["header"],
        authorization_servers: [
          "https://login.microsoftonline.com/tenant-123/v2.0",
        ],
        scopes_supported: ["api://app-456/access_as_user"],
      });
    } finally {
      await server.close();
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("protected resource metadata route reports missing env", async () => {
  const snapshot = snapshotEnv();

  try {
    delete process.env.TENANT_ID;
    delete process.env.MCP_RESOURCE_APP_ID;
    delete process.env.RESOURCE_SERVER_URL;
    delete process.env.MCP_SCOPE;

    const server = await startTestServer();

    try {
      const response = await fetch(`${server.baseUrl}/.well-known/oauth-protected-resource`);
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.deepEqual(body, {
        error: "missing_env",
        missing: ["RESOURCE_SERVER_URL", "TENANT_ID", "MCP_RESOURCE_APP_ID"],
      });
    } finally {
      await server.close();
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("mcp route answers CORS preflight using configured allowed origins", async () => {
  const snapshot = snapshotEnv();

  try {
    process.env.ALLOWED_ORIGINS = "https://client.example";

    const server = await startTestServer();

    try {
      const response = await fetch(`${server.baseUrl}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://client.example",
          "Access-Control-Request-Method": "POST",
        },
      });

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        "https://client.example"
      );
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    } finally {
      await server.close();
    }
  } finally {
    restoreEnv(snapshot);
  }
});