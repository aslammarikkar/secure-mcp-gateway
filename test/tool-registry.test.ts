import test from "node:test";
import assert from "node:assert/strict";

import { Permission } from "../src/auth/authorization.ts";
import { getToolByName, TodoTools } from "../src/mcp/tool-registry.ts";

test("tool registry exposes expected tool names", () => {
  assert.deepEqual(
    TodoTools.map((tool) => tool.name),
    [
      "add_todo",
      "list_todos",
      "complete_todo",
      "delete_todo",
      "updateTodoText",
      "get_my_profile",
    ]
  );
});

test("tool registry resolves tools by name", () => {
  const tool = getToolByName("get_my_profile");

  assert.ok(tool);
  assert.equal(tool.name, "get_my_profile");
  assert.deepEqual(tool.requiredPermissions, [Permission.READ_PROFILE]);
});

test("every tool declares at least one required permission", () => {
  for (const tool of TodoTools) {
    assert.ok(tool.requiredPermissions.length > 0, `${tool.name} must declare permissions`);
  }
});

test("unknown tools resolve to undefined", () => {
  assert.equal(getToolByName("does_not_exist"), undefined);
});