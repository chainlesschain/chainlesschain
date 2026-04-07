import { describe, it, expect, vi } from "vitest";
import { createWsMessageDispatcher } from "../../src/gateways/ws/message-dispatcher.js";

function createServerStub() {
  return {
    token: null,
    clients: new Map([["client-1", { authenticated: true }]]),
    _send: vi.fn(),
    _handleAuth: vi.fn(),
    _executeCommand: vi.fn(),
    _cancelRequest: vi.fn(),
    _handleSessionCreate: vi.fn(),
    _handleSessionResume: vi.fn(),
    _handleSessionMessage: vi.fn(),
    _handleSessionPolicyUpdate: vi.fn(),
    _handleSessionList: vi.fn(),
    _handleSessionClose: vi.fn(),
    _handleSlashCommand: vi.fn(),
    _handleSessionAnswer: vi.fn(),
    _handleHostToolResult: vi.fn(),
    _handleOrchestrate: vi.fn(),
    _handleTasksList: vi.fn(),
    _handleTasksStop: vi.fn(),
    _handleTaskDetail: vi.fn(),
    _handleTaskHistory: vi.fn(),
    _handleWorktreeDiff: vi.fn(),
    _handleWorktreeMerge: vi.fn(),
    _handleWorktreeList: vi.fn(),
    _handleCompressionStats: vi.fn(),
  };
}

describe("ws message dispatcher", () => {
  it("returns MISSING_ID when message id is absent", async () => {
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);

    await dispatcher.dispatch("client-1", {}, { type: "ping" });

    expect(server._send).toHaveBeenCalledWith(
      {},
      {
        type: "error",
        code: "MISSING_ID",
        message: 'Message must include an "id" field',
      },
    );
  });

  it("returns AUTH_REQUIRED when token is enabled and client is unauthenticated", async () => {
    const server = createServerStub();
    server.token = "secret";
    server.clients.set("client-1", { authenticated: false });
    const dispatcher = createWsMessageDispatcher(server);

    await dispatcher.dispatch("client-1", {}, { id: "1", type: "execute" });

    expect(server._send).toHaveBeenCalledWith(
      {},
      {
        id: "1",
        type: "error",
        code: "AUTH_REQUIRED",
        message: "Authentication required. Send an auth message first.",
      },
    );
  });

  it("routes task history messages to the task handler", async () => {
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);
    const ws = {};
    const message = { id: "7", type: "tasks-history", taskId: "task-1" };

    await dispatcher.dispatch("client-1", ws, message);

    expect(server._handleTaskHistory).toHaveBeenCalledWith("7", ws, message);
  });

  it("routes session creation messages to the session handler", async () => {
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);
    const ws = {};
    const message = { id: "3", type: "session-create", sessionType: "agent" };

    await dispatcher.dispatch("client-1", ws, message);

    expect(server._handleSessionCreate).toHaveBeenCalledWith("3", ws, message);
  });

  it("routes session policy updates to the session policy handler", async () => {
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);
    const ws = {};
    const message = {
      id: "4",
      type: "session-policy-update",
      sessionId: "sess-1",
      hostManagedToolPolicy: {
        tools: {
          run_shell: { allowed: false, decision: "require_confirmation" },
        },
      },
    };

    await dispatcher.dispatch("client-1", ws, message);

    expect(server._handleSessionPolicyUpdate).toHaveBeenCalledWith(
      "4",
      ws,
      message,
    );
  });

  it("routes host tool results to the host tool handler", async () => {
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);
    const ws = {};
    const message = {
      id: "5",
      type: "host-tool-result",
      sessionId: "sess-1",
      requestId: "host-tool-1",
      success: true,
      result: { ok: true },
    };

    await dispatcher.dispatch("client-1", ws, message);

    expect(server._handleHostToolResult).toHaveBeenCalledWith("5", ws, message);
  });

  it("returns UNKNOWN_TYPE for unsupported message types", async () => {
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);

    await dispatcher.dispatch("client-1", {}, { id: "404", type: "wat" });

    expect(server._send).toHaveBeenCalledWith(
      {},
      {
        id: "404",
        type: "error",
        code: "UNKNOWN_TYPE",
        message: "Unknown message type: wat",
      },
    );
  });
});
