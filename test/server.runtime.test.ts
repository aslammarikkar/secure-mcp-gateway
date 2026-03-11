import assert from "node:assert/strict";
import test from "node:test";

import {
  Permission,
  UserRole,
  type AuthenticatedUser,
} from "../src/auth/authorization.ts";
import { StreamableHTTPServer } from "../src/server.ts";

type RegisteredHandler = (request?: any) => Promise<any>;

type FakeSdkServer = {
  handlers: RegisteredHandler[];
  notifications: any[];
  setRequestHandler: (schema: unknown, handler: RegisteredHandler) => void;
  notification: (payload: unknown) => Promise<void>;
};

function createFakeSdkServer(): FakeSdkServer {
  return {
    handlers: [],
    notifications: [],
    setRequestHandler(_schema, handler) {
      this.handlers.push(handler);
    },
    async notification(payload) {
      this.notifications.push(payload);
    },
  };
}

function createUser(role: UserRole, permissions?: Permission[]): AuthenticatedUser {
  return {
    id: `${role}-user`,
    email: `${role}@example.com`,
    role,
    permissions,
  };
}

function registerHandlers(requestContext: {
  user: AuthenticatedUser | null;
  accessToken: string | null;
}) {
  const runtime = new StreamableHTTPServer() as any;
  const fakeServer = createFakeSdkServer();

  runtime.setupServerRequestHandlers(fakeServer, requestContext);

  const [listToolsHandler, callToolHandler, setLevelHandler] = fakeServer.handlers;

  return {
    fakeServer,
    listToolsHandler,
    callToolHandler,
    setLevelHandler,
  };
}

test("listTools returns only tools allowed for a readonly user", async () => {
  const { listToolsHandler } = registerHandlers({
    user: createUser(UserRole.READONLY),
    accessToken: "token-readonly",
  });

  const response = await listToolsHandler();
  const toolNames = response.tools.map((tool: { name: string }) => tool.name).sort();

  assert.deepEqual(toolNames, ["get_my_profile", "search_knowledge"]);
});

test("callTool returns an authentication error when no user context exists", async () => {
  const { callToolHandler } = registerHandlers({
    user: null,
    accessToken: null,
  });

  const response = await callToolHandler({
    params: {
      name: "search_knowledge",
      arguments: { query: "template" },
    },
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.error.message, "Authentication required");
});

test("callTool returns a permission error when the user cannot invoke the tool", async () => {
  const { callToolHandler } = registerHandlers({
    user: createUser(UserRole.READONLY),
    accessToken: "token-readonly",
  });

  const response = await callToolHandler({
    params: {
      name: "get_knowledge_item",
      arguments: {
        id: "sharepoint-welcome",
      },
    },
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(
    response.error.message,
    "Insufficient permissions to call tool: get_knowledge_item"
  );
});

test("callTool executes an allowed tool and returns its result payload", async () => {
  const { callToolHandler } = registerHandlers({
    user: createUser(UserRole.USER),
    accessToken: "token-user",
  });

  const response = await callToolHandler({
    params: {
      name: "search_knowledge",
      arguments: { query: "sharepoint" },
    },
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(Array.isArray(response.content));
  assert.ok(response.structuredContent);
  assert.ok(Array.isArray(response.structuredContent.items));
});

test("setLevel handler emits a notification message", async () => {
  const { fakeServer, setLevelHandler } = registerHandlers({
    user: createUser(UserRole.ADMIN),
    accessToken: "token-admin",
  });

  const response = await setLevelHandler({
    params: {
      level: "debug",
    },
  });

  assert.deepEqual(response, {});
  assert.equal(fakeServer.notifications.length, 1);
  assert.deepEqual(fakeServer.notifications[0], {
    method: "notifications/message",
    params: {
      level: "debug",
      logger: "test-server",
      data: "Logging level set to: debug",
    },
  });
});