import type { ToolResult } from "./tool-types.js";

export function jsonTextContent(value: unknown) {
  return {
    type: "text",
    text: JSON.stringify(value, null, 2),
  };
}

export function jsonResult(structuredContent: unknown): ToolResult {
  return {
    content: [jsonTextContent(structuredContent)],
    structuredContent,
  };
}