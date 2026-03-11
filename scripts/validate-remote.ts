import { execFileSync } from "node:child_process";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

type JsonRpcEnvelope = {
  jsonrpc: string;
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type ToolListResult = {
  tools: Array<{ name: string }>;
};

type SearchKnowledgeResult = {
  structuredContent?: {
    items?: Array<{
      id: string;
      title: string;
      sourceUrl?: string;
    }>;
    provider?: string;
  };
};

type GetKnowledgeItemResult = {
  structuredContent?: {
    item?: {
      id: string;
      title: string;
      sourceUrl?: string;
    } | null;
    provider?: string;
  };
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

function getAccessToken(): string {
  const explicitToken = process.env.ACCESS_TOKEN?.trim();
  if (explicitToken) {
    return explicitToken;
  }

  const resourceAppId = getRequiredEnv("MCP_RESOURCE_APP_ID");
  return runAzCli([
      "account",
      "get-access-token",
      "--resource",
      `api://${resourceAppId}`,
      "--query",
      "accessToken",
      "-o",
      "tsv",
    ]);
}

function parseMcpResponse(text: string): JsonRpcEnvelope {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Empty response from MCP endpoint");
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpcEnvelope;
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));

  if (dataLines.length === 0) {
    throw new Error(`Unable to parse MCP response: ${trimmed}`);
  }

  const lastEvent = JSON.parse(dataLines[dataLines.length - 1]) as {
    result?: JsonRpcEnvelope;
  };

  if (!lastEvent.result) {
    throw new Error(`MCP event did not contain a result envelope: ${trimmed}`);
  }

  return lastEvent.result;
}

async function invokeMcp(method: string, params: Record<string, unknown>) {
  const endpoint = `${getRequiredEnv("RESOURCE_SERVER_URL").replace(/\/+$/, "")}/mcp`;
  const token = getAccessToken();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const text = await response.text();
  const envelope = parseMcpResponse(text);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  if (envelope.error) {
    throw new Error(`${method} failed: ${envelope.error.message}`);
  }

  return envelope.result ?? envelope;
}

async function main() {
  const query = process.argv[2] || "sharepoint";
  const explicitItemId = process.argv[3];

  console.log(`Validating remote MCP endpoint for query: ${query}`);

  const listResult = await invokeMcp("tools/list", {}) as ToolListResult;
  const toolNames = listResult.tools.map((tool) => tool.name).sort();
  console.log("Available tools:", toolNames.join(", "));

  const searchResult = await invokeMcp("tools/call", {
    name: "search_knowledge",
    arguments: {
      query,
      limit: 3,
    },
  }) as SearchKnowledgeResult;

  const items = searchResult.structuredContent?.items ?? [];
  console.log(`search_knowledge returned ${items.length} item(s).`);
  for (const item of items) {
    console.log(`- ${item.title}: ${item.sourceUrl ?? item.id}`);
  }

  const itemId = explicitItemId || items[0]?.id;
  if (!itemId) {
    console.log("No item id available for get_knowledge_item validation.");
    return;
  }

  const getResult = await invokeMcp("tools/call", {
    name: "get_knowledge_item",
    arguments: {
      id: itemId,
    },
  }) as GetKnowledgeItemResult;

  const item = getResult.structuredContent?.item;
  if (!item) {
    throw new Error(`get_knowledge_item returned no item for id ${itemId}`);
  }

  console.log(`get_knowledge_item returned: ${item.title} (${item.sourceUrl ?? item.id})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});