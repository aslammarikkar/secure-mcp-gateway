import { trace, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Permission } from "../../auth/authorization.js";
import { KnowledgeService } from "../../capabilities/knowledge/knowledge-service.js";
import { SharePointKnowledgeProvider } from "../../providers/knowledge/sharepoint/sharepoint-knowledge-provider.js";
import type { ToolExecutionContext } from "../../types/auth-context.js";
import { jsonResult } from "../tool-helpers.js";
import type { ToolDefinition } from "../tool-types.js";

const SearchKnowledgeInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});

const GetKnowledgeItemInputSchema = z.object({
  id: z.string().min(1),
});

const KnowledgeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  sourceType: z.literal("sharepoint"),
  sourceUrl: z.string().optional(),
});

const SearchKnowledgeOutputSchema = z.object({
  items: z.array(KnowledgeItemSchema),
  provider: z.string(),
});

const GetKnowledgeItemOutputSchema = z.object({
  item: KnowledgeItemSchema.nullable(),
  provider: z.string(),
});

const knowledgeService = new KnowledgeService(new SharePointKnowledgeProvider());

async function executeWithTrace<TArgs>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  operation: (args: TArgs, context: ToolExecutionContext) => Promise<unknown>,
  args: TArgs,
  context?: ToolExecutionContext
) {
  const tracer = trace.getTracer("knowledge-tools");
  const span = tracer.startSpan(spanName, { attributes });

  try {
    if (!context) {
      throw new Error("Tool execution context is required");
    }

    const structuredContent = await operation(args, context);
    span.setStatus({
      code: SpanStatusCode.OK,
      message: `${spanName} completed successfully`,
    });
    return jsonResult(structuredContent);
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

export const knowledgeTools: ToolDefinition[] = [
  {
    name: "search_knowledge",
    description:
      "Search a knowledge source the signed-in user is allowed to access. This template ships with a SharePoint-shaped example provider that you can replace with your own retrieval implementation.",
    requiredPermissions: [Permission.SEARCH_KNOWLEDGE],
    inputSchema: zodToJsonSchema(SearchKnowledgeInputSchema),
    outputSchema: zodToJsonSchema(SearchKnowledgeOutputSchema),
    async execute(args: { query: string; limit?: number }, context?: ToolExecutionContext) {
      return executeWithTrace(
        "search_knowledge",
        {
          "knowledge.query": args.query,
          "knowledge.limit": args.limit ?? 5,
        },
        (input, executionContext) => knowledgeService.searchKnowledge(input, executionContext),
        args,
        context
      );
    },
  },
  {
    name: "get_knowledge_item",
    description:
      "Get a single knowledge item by id from the configured provider. Use this as the template seam for provider-specific retrieval logic.",
    requiredPermissions: [Permission.READ_KNOWLEDGE],
    inputSchema: zodToJsonSchema(GetKnowledgeItemInputSchema),
    outputSchema: zodToJsonSchema(GetKnowledgeItemOutputSchema),
    async execute(args: { id: string }, context?: ToolExecutionContext) {
      return executeWithTrace(
        "get_knowledge_item",
        {
          "knowledge.id": args.id,
        },
        (input, executionContext) => knowledgeService.getKnowledgeItem(input, executionContext),
        args,
        context
      );
    },
  },
];