import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getAccessTokenOnBehalfOf } from "../../../auth/obo.js";
import type { ToolExecutionContext } from "../../../types/auth-context.js";
import type { KnowledgeProvider } from "../../../capabilities/knowledge/knowledge-provider.js";
import { getSharePointConfig } from "../../../config/provider-config.js";
import type {
  GetKnowledgeItemInput,
  GetKnowledgeItemResult,
  KnowledgeItem,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
} from "../../../capabilities/knowledge/types.js";

type FetchLike = typeof fetch;

type SharePointSearchResponse = {
  value?: Array<{
    hitsContainers?: Array<{
      hits?: Array<{
        summary?: string;
        resource?: {
          name?: string;
          webUrl?: string;
        };
      }>;
    }>;
  }>;
};

type SharePointDriveItemResponse = {
  name?: string;
  webUrl?: string;
  description?: string;
};

const SAMPLE_ITEMS: KnowledgeItem[] = [
  {
    id: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/welcome.docx",
    title: "Welcome to the Secure MCP Gateway template",
    snippet:
      "Use this SharePoint-shaped provider as a starter example and replace it with your tenant-specific retrieval logic.",
    sourceType: "sharepoint",
    sourceUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/welcome.docx",
  },
  {
    id: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/onboarding-notes.docx",
    title: "Onboarding architecture notes",
    snippet:
      "The template keeps the MCP layer capability-oriented and the provider layer backend-specific.",
    sourceType: "sharepoint",
    sourceUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/onboarding-notes.docx",
  },
  {
    id: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/security-checklist.docx",
    title: "Security rollout checklist",
    snippet:
      "Validate OAuth metadata, delegated scopes, and downstream ACL enforcement before production rollout.",
    sourceType: "sharepoint",
    sourceUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/security-checklist.docx",
  },
];

export class SharePointKnowledgeProvider implements KnowledgeProvider {
  readonly providerId = "sharepoint";

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly acquireAccessToken: typeof getAccessTokenOnBehalfOf = getAccessTokenOnBehalfOf
  ) {}

  private useSampleMode() {
    return getSharePointConfig().providerMode === "sample";
  }

  private requireUserAccessToken(context: ToolExecutionContext) {
    if (!context.accessToken) {
      throw new Error("No incoming user access token available for SharePoint retrieval");
    }

    return context.accessToken;
  }

  private async getGraphToken(context: ToolExecutionContext) {
    const accessToken = this.requireUserAccessToken(context);
    const sharePointConfig = getSharePointConfig();
    return this.acquireAccessToken(accessToken, [sharePointConfig.graphScope]);
  }

  private async searchSampleKnowledge(input: SearchKnowledgeInput): Promise<SearchKnowledgeResult> {
    const normalizedQuery = input.query.trim().toLowerCase();
    const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
    const items = SAMPLE_ITEMS.filter((item) => {
      const haystack = `${item.title} ${item.snippet ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    }).slice(0, limit);

    return {
      items,
      provider: "sharepoint-sample",
    };
  }

  private async getSampleKnowledgeItem(input: GetKnowledgeItemInput): Promise<GetKnowledgeItemResult> {
    return {
      item: SAMPLE_ITEMS.find((candidate) => candidate.id === input.id) ?? null,
      provider: "sharepoint-sample",
    };
  }

  private mapSearchResponse(response: SharePointSearchResponse, limit: number): KnowledgeItem[] {
    const hits = response.value?.flatMap((entry) =>
      entry.hitsContainers?.flatMap((container) => container.hits ?? []) ?? []
    ) ?? [];
    const items: KnowledgeItem[] = [];

    for (const hit of hits) {
      const webUrl = hit.resource?.webUrl;
      if (!webUrl) {
        continue;
      }

      items.push({
          id: webUrl,
          title: hit.resource?.name ?? "Untitled SharePoint item",
          snippet: hit.summary,
          sourceType: "sharepoint" as const,
          sourceUrl: webUrl,
      });

      if (items.length >= limit) {
        break;
      }
    }

    return items;
  }

  private encodeSharingUrl(webUrl: string): string {
    const base64 = Buffer.from(webUrl, "utf8")
      .toString("base64")
      .replace(/\//g, "_")
      .replace(/\+/g, "-")
      .replace(/=+$/g, "");

    return `u!${base64}`;
  }

  async searchKnowledge(
    input: SearchKnowledgeInput,
    context: ToolExecutionContext
  ): Promise<SearchKnowledgeResult> {
    const tracer = trace.getTracer("knowledge-provider");
    const span = tracer.startSpan("sharepoint.searchKnowledge", {
      attributes: {
        "knowledge.query": input.query,
        "knowledge.limit": input.limit ?? 5,
        "user.id": context.user?.id ?? "unknown",
      },
    });

    try {
      if (this.useSampleMode()) {
        const result = await this.searchSampleKnowledge(input);

        span.setAttributes({
          "knowledge.provider_mode": "sample",
          "knowledge.result_count": result.items.length,
        });
        span.setStatus({
          code: SpanStatusCode.OK,
          message: "Knowledge search completed in sample mode",
        });

        return result;
      }

      const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
      const graphToken = await this.getGraphToken(context);
      const sharePointConfig = getSharePointConfig();
      const response = await this.fetchImpl("https://graph.microsoft.com/v1.0/search/query", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${graphToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              entityTypes: sharePointConfig.entityTypes,
              query: {
                queryString: input.query,
              },
              from: 0,
              size: limit,
              fields: ["name", "webUrl"],
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`SharePoint search failed (${response.status}): ${body}`);
      }

      const payload = await response.json() as SharePointSearchResponse;
      const items = this.mapSearchResponse(payload, limit);

      span.setAttributes({
        "knowledge.provider_mode": "graph",
        "knowledge.result_count": items.length,
      });
      span.setStatus({
        code: SpanStatusCode.OK,
        message: "Knowledge search completed against Microsoft Graph",
      });

      return {
        items,
        provider: this.providerId,
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }

  async getKnowledgeItem(
    input: GetKnowledgeItemInput,
    context: ToolExecutionContext
  ): Promise<GetKnowledgeItemResult> {
    const tracer = trace.getTracer("knowledge-provider");
    const span = tracer.startSpan("sharepoint.getKnowledgeItem", {
      attributes: {
        "knowledge.id": input.id,
        "user.id": context.user?.id ?? "unknown",
      },
    });

    try {
      if (this.useSampleMode()) {
        const result = await this.getSampleKnowledgeItem(input);

        span.setAttributes({
          "knowledge.provider_mode": "sample",
          "knowledge.found": !!result.item,
        });
        span.setStatus({
          code: SpanStatusCode.OK,
          message: result.item ? "Knowledge item found in sample mode" : "Knowledge item not found in sample mode",
        });

        return result;
      }

      const graphToken = await this.getGraphToken(context);
      const encodedSharingUrl = this.encodeSharingUrl(input.id);
      const response = await this.fetchImpl(
        `https://graph.microsoft.com/v1.0/shares/${encodedSharingUrl}/driveItem?$select=name,webUrl,description`,
        {
          headers: {
            Authorization: `Bearer ${graphToken}`,
          },
        }
      );

      if (response.status === 404) {
        return {
          item: null,
          provider: this.providerId,
        };
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`SharePoint item lookup failed (${response.status}): ${body}`);
      }

      const payload = await response.json() as SharePointDriveItemResponse;
      const item = payload.webUrl
        ? {
            id: payload.webUrl,
            title: payload.name ?? "Untitled SharePoint item",
            snippet: payload.description,
            sourceType: "sharepoint" as const,
            sourceUrl: payload.webUrl,
          }
        : null;

      span.setAttributes({
        "knowledge.provider_mode": "graph",
        "knowledge.found": !!item,
      });
      span.setStatus({
        code: SpanStatusCode.OK,
        message: item ? "Knowledge item found in Microsoft Graph" : "Knowledge item not found in Microsoft Graph",
      });

      return {
        item,
        provider: this.providerId,
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }
}