import type { Permission } from "../auth/authorization.js";
import type { ToolExecutionContext } from "../types/auth-context.js";

export type ToolContent =
  | string
  | {
      type: string;
      text: string;
    };

export type ToolResult = {
  content: ToolContent[];
  structuredContent?: unknown;
};

export type ToolDefinition = {
  name: string;
  description: string;
  requiredPermissions: Permission[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  execute: (args: any, context?: ToolExecutionContext) => Promise<ToolResult>;
};