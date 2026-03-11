import test from "node:test";
import assert from "node:assert/strict";

import { UserRole } from "../src/auth/authorization.ts";
import { SharePointKnowledgeProvider } from "../src/providers/knowledge/sharepoint/sharepoint-knowledge-provider.ts";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

const ENV_KEYS = [
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

test("sharepoint provider searches Microsoft Graph results", async () => {
  const snapshot = snapshotEnv();

  try {
    process.env.SHAREPOINT_PROVIDER_MODE = "graph";
    process.env.SHAREPOINT_GRAPH_SCOPE = "https://graph.microsoft.com/Sites.Read.All";

    const provider = new SharePointKnowledgeProvider(
      async (_input, init) => {
        const headers = init?.headers as Record<string, string>;

        assert.equal(init?.method, "POST");
        assert.equal(headers.Authorization, "Bearer graph-token");

        return new Response(
          JSON.stringify({
            value: [
              {
                hitsContainers: [
                  {
                    hits: [
                      {
                        summary: "Architecture notes for the secure MCP template.",
                        resource: {
                          name: "Onboarding architecture notes",
                          webUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/onboarding-notes.docx",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
      async () => "graph-token"
    );

    const result = await provider.searchKnowledge(
      { query: "architecture", limit: 5 },
      {
        accessToken: "user-token",
        user: { id: "user-1", email: "user@example.com", role: UserRole.USER },
      }
    );

    assert.equal(result.provider, "sharepoint");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "Onboarding architecture notes");
    assert.equal(result.items[0].id, result.items[0].sourceUrl);
  } finally {
    restoreEnv(snapshot);
  }
});

test("sharepoint provider retrieves an item by webUrl through Graph shares API", async () => {
  const snapshot = snapshotEnv();

  try {
    process.env.SHAREPOINT_PROVIDER_MODE = "graph";

    const provider = new SharePointKnowledgeProvider(
      async (input) => {
        assert.match(String(input), /\/shares\/u!/);

        return new Response(
          JSON.stringify({
            name: "Security rollout checklist",
            webUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/security-checklist.docx",
            description: "Checklist used before rolling out secure MCP access.",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
      async () => "graph-token"
    );

    const result = await provider.getKnowledgeItem(
      {
        id: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/security-checklist.docx",
      },
      {
        accessToken: "user-token",
        user: { id: "user-1", email: "user@example.com", role: UserRole.USER },
      }
    );

    assert.equal(result.provider, "sharepoint");
    assert.equal(result.item?.title, "Security rollout checklist");
    assert.equal(
      result.item?.sourceUrl,
      "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/security-checklist.docx"
    );
  } finally {
    restoreEnv(snapshot);
  }
});