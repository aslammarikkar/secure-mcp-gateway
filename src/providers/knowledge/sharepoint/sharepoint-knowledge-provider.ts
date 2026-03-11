import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { ToolExecutionContext } from "../../../types/auth-context.js";
import type { KnowledgeProvider } from "../../../capabilities/knowledge/knowledge-provider.js";
import type {
  GetKnowledgeItemInput,
  GetKnowledgeItemResult,
  KnowledgeItem,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
} from "../../../capabilities/knowledge/types.js";

const SAMPLE_ITEMS: KnowledgeItem[] = [
  {
    id: "sharepoint-welcome",
    title: "Welcome to the Secure MCP Gateway template",
    snippet:
      "Use this SharePoint-shaped provider as a starter example and replace it with your tenant-specific retrieval logic.",
    sourceType: "sharepoint",
    sourceUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/welcome.docx",
  },
  {
    id: "sharepoint-onboarding",
    title: "Onboarding architecture notes",
    snippet:
      "The template keeps the MCP layer capability-oriented and the provider layer backend-specific.",
    sourceType: "sharepoint",
    sourceUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/onboarding-notes.docx",
  },
  {
    id: "sharepoint-security",
    title: "Security rollout checklist",
    snippet:
      "Validate OAuth metadata, delegated scopes, and downstream ACL enforcement before production rollout.",
    sourceType: "sharepoint",
    sourceUrl: "https://contoso.sharepoint.com/sites/knowledge/Shared%20Documents/security-checklist.docx",
  },
];

export class SharePointKnowledgeProvider implements KnowledgeProvider {
  readonly providerId = "sharepoint-example";

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
      const normalizedQuery = input.query.trim().toLowerCase();
      const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
      const items = SAMPLE_ITEMS.filter((item) => {
        const haystack = `${item.title} ${item.snippet ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      }).slice(0, limit);

      span.setAttributes({
        "knowledge.result_count": items.length,
      });
      span.setStatus({
        code: SpanStatusCode.OK,
        message: "Knowledge search completed",
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
      const item = SAMPLE_ITEMS.find((candidate) => candidate.id === input.id) ?? null;

      span.setAttributes({
        "knowledge.found": !!item,
      });
      span.setStatus({
        code: SpanStatusCode.OK,
        message: item ? "Knowledge item found" : "Knowledge item not found",
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