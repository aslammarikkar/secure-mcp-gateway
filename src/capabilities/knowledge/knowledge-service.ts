import type { ToolExecutionContext } from "../../types/auth-context.js";
import type { KnowledgeProvider } from "./knowledge-provider.js";
import type {
  GetKnowledgeItemInput,
  GetKnowledgeItemResult,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
} from "./types.js";

export class KnowledgeService {
  constructor(private readonly provider: KnowledgeProvider) {}

  async searchKnowledge(
    input: SearchKnowledgeInput,
    context: ToolExecutionContext
  ): Promise<SearchKnowledgeResult> {
    if (!context.user) {
      throw new Error("Authenticated user context is required");
    }

    return this.provider.searchKnowledge(input, context);
  }

  async getKnowledgeItem(
    input: GetKnowledgeItemInput,
    context: ToolExecutionContext
  ): Promise<GetKnowledgeItemResult> {
    if (!context.user) {
      throw new Error("Authenticated user context is required");
    }

    return this.provider.getKnowledgeItem(input, context);
  }
}