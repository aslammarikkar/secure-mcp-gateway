import { profileTools } from "./tools/profile-tools.js";
import { todoTools } from "./tools/todo-tools.js";
import type { ToolDefinition } from "./tool-types.js";

// This registry is the single place that decides which tools are exposed by the server.
export const TodoTools: ToolDefinition[] = [...todoTools, ...profileTools];

export function getToolByName(toolName: string): ToolDefinition | undefined {
  return TodoTools.find((tool) => tool.name === toolName);
}

export type { ToolDefinition } from "./tool-types.js";