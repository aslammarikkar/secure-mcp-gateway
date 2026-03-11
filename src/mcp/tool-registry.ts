import { profileTools } from "./tools/profile-tools.js";
import { knowledgeTools } from "./tools/knowledge-tools.js";
import type { ToolDefinition } from "./tool-types.js";

// This registry is the single place that decides which tools are exposed by the server.
export const registeredTools: ToolDefinition[] = [...knowledgeTools, ...profileTools];

export function getToolByName(toolName: string): ToolDefinition | undefined {
  return registeredTools.find((tool) => tool.name === toolName);
}

export type { ToolDefinition } from "./tool-types.js";