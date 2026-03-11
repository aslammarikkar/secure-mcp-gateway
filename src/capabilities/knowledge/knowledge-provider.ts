import type { ToolExecutionContext } from "../../types/auth-context.js";
import type {
  GetKnowledgeItemInput,
  GetKnowledgeItemResult,
  SearchKnowledgeInput,
  SearchKnowledgeResult,
} from "./types.js";

export interface KnowledgeProvider {
  readonly providerId: string;
  searchKnowledge(
    input: SearchKnowledgeInput,
    context: ToolExecutionContext
  ): Promise<SearchKnowledgeResult>;
  getKnowledgeItem(
    input: GetKnowledgeItemInput,
    context: ToolExecutionContext
  ): Promise<GetKnowledgeItemResult>;
}