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

  // ─── reconnect-safe command idempotency (Phase 5) ───────────────────
  it("runs a command without a commandId directly every time (back-compat)", async () => {
    const server = createServerStub();
    server._executeCommand = vi.fn();
    const dispatcher = createWsMessageDispatcher(server);
    const msg = { id: "1", type: "execute", command: { cmd: "x" } };
    await dispatcher.dispatch("client-1", {}, msg);
    await dispatcher.dispatch("client-1", {}, msg);
    expect(server._executeCommand).toHaveBeenCalledTimes(2);
    // No ledger is created when nothing carries a commandId.
    expect(server._commandLedger).toBeUndefined();
  });

  it("executes a commandId-carrying command once and REPLAYS a re-delivery", async () => {
    const server = createServerStub();
    server._executeCommand = vi.fn(async () => "ran");
    const dispatcher = createWsMessageDispatcher(server);
    const msg = {
      id: "1",
      type: "execute",
      command: { cmd: "x" },
      commandId: "c1",
      deviceId: "web",
    };
    await dispatcher.dispatch("client-1", {}, msg);
    await dispatcher.dispatch("client-1", {}, msg); // client re-sends after a lost ACK
    expect(server._executeCommand).toHaveBeenCalledTimes(1);
    expect(server._send).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ type: "replayed", commandId: "c1" }),
    );
  });

  it("coalesces CONCURRENT re-deliveries of the same commandId to one execution", async () => {
    const server = createServerStub();
    let release;
    const gate = new Promise((r) => (release = r));
    let calls = 0;
    server._executeCommand = vi.fn(async () => {
      calls += 1;
      await gate; // hold both deliveries in-flight together
      return "ran";
    });
    const dispatcher = createWsMessageDispatcher(server);
    const msg = {
      id: "1",
      type: "execute",
      command: { cmd: "x" },
      commandId: "c-race",
      deviceId: "web",
    };
    // Fire both on the same tick — the second must not build its own ledger and
    // run a second time (regression guard for the lazy-import race).
    const both = Promise.all([
      dispatcher.dispatch("client-1", {}, msg),
      dispatcher.dispatch("client-1", {}, msg),
    ]);
    release();
    await both;
    expect(calls).toBe(1);
  });

  it("rejects a command from a revoked device without executing it", async () => {
    const { RemoteCommandLedger } =
      await import("../../src/harness/remote-command-ledger.js");
    const server = createServerStub();
    server._executeCommand = vi.fn();
    server._commandLedger = new RemoteCommandLedger({
      revokedDevices: ["stolen"],
    });
    const dispatcher = createWsMessageDispatcher(server);
    await dispatcher.dispatch(
      "client-1",
      {},
      {
        id: "9",
        type: "execute",
        command: {},
        commandId: "c9",
        deviceId: "stolen",
      },
    );
    expect(server._executeCommand).not.toHaveBeenCalled();
    expect(server._send).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ code: "COMMAND_REJECTED" }),
    );
  });

  // ─── dynamic feature-map routing (post-refactor regression) ─────────
  // After dropping the per-message route-table rebuild, each feature handler
  // map must still be reached on demand. The bare stub lacks the real handler
  // deps, so a routed handler typically answers with its category error code —
  // any reply that is NOT UNKNOWN_TYPE proves the route resolved to the map.
  const codesSent = (server) =>
    server._send.mock.calls.map((c) => c[1] && c[1].code);

  it.each([
    ["session-core request route", "sessions.list"],
    ["video request route", "video.assets.list"],
    ["personal-data-hub request route", "personal-data-hub.ask"],
  ])(
    "routes a %s to its feature handler (not UNKNOWN_TYPE)",
    async (_label, type) => {
      const server = createServerStub();
      const dispatcher = createWsMessageDispatcher(server);
      await dispatcher.dispatch("client-1", {}, { id: "d1", type });
      const codes = codesSent(server);
      expect(server._send).toHaveBeenCalled();
      expect(codes).not.toContain("UNKNOWN_TYPE");
    },
  );

  it("a feature handler map can NOT shadow a core static route (ping stays core)", async () => {
    // ping is a static route; the refactor checks static routes BEFORE any
    // feature map, so even if a map ever defined "ping" the core handler wins.
    const server = createServerStub();
    const dispatcher = createWsMessageDispatcher(server);
    const ws = {};
    await dispatcher.dispatch("client-1", ws, { id: "p1", type: "ping" });
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({ id: "p1", type: "pong" }),
    );
  });
});
