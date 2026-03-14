/**
 * Integration tests for WebSocket session workflow
 *
 * Tests the ws-server session message routing by calling _handleMessage
 * directly with a mock WebSocket object. Covers session-create, session-message,
 * session-resume, session-list, session-close, slash-command, and session-answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChainlessChainWSServer } from "../../src/lib/ws-server.js";

/** Create a mock WebSocket object */
function mockWs() {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  };
}

/** Parse the last JSON sent via ws.send */
function lastSent(ws) {
  const calls = ws.send.mock.calls;
  if (calls.length === 0) return null;
  return JSON.parse(calls[calls.length - 1][0]);
}

/** Create a mock session manager with controllable returns */
function mockSessionManager(overrides = {}) {
  return {
    db: null,
    createSession: vi.fn().mockReturnValue({ sessionId: "test-session-1" }),
    getSession: vi.fn().mockReturnValue({
      id: "test-session-1",
      type: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
      projectRoot: "/tmp/project",
      messages: [
        { role: "system", content: "You are an assistant." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
      interaction: null,
    }),
    resumeSession: vi.fn().mockReturnValue({
      id: "test-session-1",
      type: "agent",
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Previous message" },
      ],
      provider: "ollama",
      model: "qwen2.5:7b",
    }),
    listSessions: vi.fn().mockReturnValue([
      {
        id: "test-session-1",
        type: "agent",
        status: "active",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]),
    closeSession: vi.fn(),
    persistMessages: vi.fn(),
    ...overrides,
  };
}

describe("Integration: WebSocket Session Workflow", () => {
  /** @type {ChainlessChainWSServer} */
  let server;
  let ws;

  beforeEach(() => {
    ws = mockWs();
  });

  afterEach(async () => {
    if (server) {
      // Clear heartbeat timer to avoid leaks
      if (server._heartbeatTimer) {
        clearInterval(server._heartbeatTimer);
        server._heartbeatTimer = null;
      }
      server = null;
    }
  });

  /**
   * Helper: set up server with a pre-authenticated client so session
   * messages are not rejected by the auth check.
   */
  function setupServer(sessionManager = mockSessionManager()) {
    server = new ChainlessChainWSServer({ sessionManager });
    // Register a client as authenticated
    server.clients.set("client-1", {
      ws,
      authenticated: true,
      connectedAt: Date.now(),
      ip: "127.0.0.1",
      alive: true,
    });
    return server;
  }

  // ─── session-create ────────────────────────────────────────────────

  it("session-create returns sessionId", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-1",
      type: "session-create",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("session-created");
    expect(resp.sessionId).toBe("test-session-1");
    expect(resp.id).toBe("req-1");
  });

  it("session-create with agent type", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-2",
      type: "session-create",
      sessionType: "agent",
    });

    expect(sm.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent" }),
    );
    const resp = lastSent(ws);
    expect(resp.type).toBe("session-created");
    expect(resp.sessionType).toBe("agent");
  });

  it("session-create with chat type", async () => {
    const sm = mockSessionManager();
    sm.getSession.mockReturnValue({
      id: "test-session-1",
      type: "chat",
      provider: "ollama",
      model: "qwen2.5:7b",
      projectRoot: "/tmp/project",
      messages: [],
      interaction: null,
    });
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-3",
      type: "session-create",
      sessionType: "chat",
    });

    expect(sm.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chat" }),
    );
    const resp = lastSent(ws);
    expect(resp.type).toBe("session-created");
    expect(resp.sessionType).toBe("chat");
  });

  // ─── session-message ───────────────────────────────────────────────

  it("session-message sends to agent handler", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // First create a session to register a handler
    await server._handleMessage("client-1", ws, {
      id: "req-create",
      type: "session-create",
    });

    // Override the handler with a mock
    const mockHandler = {
      handleMessage: vi.fn().mockResolvedValue(undefined),
      handleSlashCommand: vi.fn(),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    server._handleMessage("client-1", ws, {
      id: "req-msg",
      type: "session-message",
      sessionId: "test-session-1",
      content: "Hello agent",
    });

    expect(mockHandler.handleMessage).toHaveBeenCalledWith(
      "Hello agent",
      "req-msg",
    );
  });

  // ─── session-resume ────────────────────────────────────────────────

  it("session-resume loads from memory", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-resume",
      type: "session-resume",
      sessionId: "test-session-1",
    });

    expect(sm.resumeSession).toHaveBeenCalledWith("test-session-1");
    const resp = lastSent(ws);
    expect(resp.type).toBe("session-resumed");
    expect(resp.sessionId).toBe("test-session-1");
    expect(resp.history).toBeInstanceOf(Array);
    // System messages should be filtered out
    expect(resp.history.some((m) => m.role === "system")).toBe(false);
  });

  // ─── session-list ──────────────────────────────────────────────────

  it("session-list returns sessions", () => {
    const sm = mockSessionManager();
    setupServer(sm);

    server._handleMessage("client-1", ws, {
      id: "req-list",
      type: "session-list",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("session-list-result");
    expect(resp.sessions).toBeInstanceOf(Array);
    expect(resp.sessions.length).toBe(1);
    expect(resp.sessions[0].id).toBe("test-session-1");
  });

  // ─── session-close ─────────────────────────────────────────────────

  it("session-close removes session", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // Create session first
    await server._handleMessage("client-1", ws, {
      id: "req-create",
      type: "session-create",
    });

    // Now close it
    server._handleMessage("client-1", ws, {
      id: "req-close",
      type: "session-close",
      sessionId: "test-session-1",
    });

    expect(sm.closeSession).toHaveBeenCalledWith("test-session-1");
    const resp = lastSent(ws);
    expect(resp.type).toBe("result");
    expect(resp.success).toBe(true);
    expect(server.sessionHandlers.has("test-session-1")).toBe(false);
  });

  // ─── slash-command ─────────────────────────────────────────────────

  it("slash-command routes to handler", () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // Register a mock handler
    const mockHandler = {
      handleMessage: vi.fn().mockResolvedValue(undefined),
      handleSlashCommand: vi.fn(),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    server._handleMessage("client-1", ws, {
      id: "req-slash",
      type: "slash-command",
      sessionId: "test-session-1",
      command: "/plan create a REST API",
    });

    expect(mockHandler.handleSlashCommand).toHaveBeenCalledWith(
      "/plan create a REST API",
      "req-slash",
    );
  });

  // ─── session-answer ────────────────────────────────────────────────

  it("session-answer resolves pending question", () => {
    const resolveAnswer = vi.fn();
    const sm = mockSessionManager({
      getSession: vi.fn().mockReturnValue({
        id: "test-session-1",
        interaction: { resolveAnswer },
      }),
    });
    setupServer(sm);

    server._handleMessage("client-1", ws, {
      id: "req-answer",
      type: "session-answer",
      sessionId: "test-session-1",
      requestId: "q-1",
      answer: "yes",
    });

    expect(resolveAnswer).toHaveBeenCalledWith("q-1", "yes");
  });

  // ─── ws-server handles session messages in switch ───────────────────

  it("ws-server handles session messages in switch", () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // Send a session-message for a non-existent session handler
    server._handleMessage("client-1", ws, {
      id: "req-orphan",
      type: "session-message",
      sessionId: "no-such-session",
      content: "Hello?",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("SESSION_NOT_FOUND");
    expect(resp.message).toContain("no-such-session");
  });

  // ─── ws-server session cleanup ─────────────────────────────────────

  it("ws-server cleans up sessions on stop", async () => {
    const sm = mockSessionManager();
    server = new ChainlessChainWSServer({ sessionManager: sm });

    // Manually add a session handler (no real WebSocket)
    server.sessionHandlers.set("test-session-1", { destroy: vi.fn() });

    await server.stop();

    expect(sm.closeSession).toHaveBeenCalledWith("test-session-1");
    expect(server.sessionHandlers.size).toBe(0);
  });

  // ─── ws-server rejects session when no session manager ─────────────

  it("ws-server rejects session when no session manager", () => {
    server = new ChainlessChainWSServer({}); // No sessionManager
    server.clients.set("client-1", {
      ws,
      authenticated: true,
      connectedAt: Date.now(),
      ip: "127.0.0.1",
      alive: true,
    });

    server._handleMessage("client-1", ws, {
      id: "req-nosm",
      type: "session-create",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("NO_SESSION_SUPPORT");
  });

  // ─── session-resume creates handler ──────────────────────────────

  it("session-resume creates handler for resumed session", async () => {
    const sm = mockSessionManager({
      resumeSession: vi.fn().mockReturnValue({
        id: "resumed-session-1",
        type: "agent",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Previous message" },
          { role: "assistant", content: "Previous reply" },
        ],
        provider: "ollama",
        model: "qwen2.5:7b",
        projectRoot: "/tmp/project",
        interaction: null,
      }),
    });
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-resume",
      type: "session-resume",
      sessionId: "resumed-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("session-resumed");
    expect(resp.sessionId).toBe("resumed-session-1");
    // System messages should be filtered from history
    expect(resp.history.some((m) => m.role === "system")).toBe(false);
    expect(resp.history.length).toBe(2);
    // Handler should have been created for the resumed session
    expect(server.sessionHandlers.has("resumed-session-1")).toBe(true);
  });

  // ─── agent session handles run_code tool call ─────────────────────

  it("agent session routes run_code tool call via session-message", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // Create a session
    await server._handleMessage("client-1", ws, {
      id: "req-create-rc",
      type: "session-create",
      sessionType: "agent",
    });

    // Override handler with mock that simulates run_code
    const mockHandler = {
      handleMessage: vi.fn().mockImplementation(async (content, reqId) => {
        // Simulate handler sending back tool events
        const response = JSON.stringify({
          id: reqId,
          type: "session-event",
          sessionId: "test-session-1",
          event: "tool-executing",
          tool: "run_code",
          args: { language: "python", code: "print('hi')" },
        });
        ws.send(response);
      }),
      handleSlashCommand: vi.fn(),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    // Send message that should trigger run_code
    server._handleMessage("client-1", ws, {
      id: "req-rc",
      type: "session-message",
      sessionId: "test-session-1",
      content: "run some python code",
    });

    expect(mockHandler.handleMessage).toHaveBeenCalledWith(
      "run some python code",
      "req-rc",
    );

    // Verify the handler sent a tool-executing event
    const sentCalls = ws.send.mock.calls;
    const toolEvent = sentCalls
      .map((c) => JSON.parse(c[0]))
      .find((m) => m.event === "tool-executing");
    expect(toolEvent).toBeDefined();
    expect(toolEvent.tool).toBe("run_code");
  });

  // ─── agent session forwards tool-executing events ────────────────

  it("agent session forwards tool-executing events to WebSocket client", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // Create session
    await server._handleMessage("client-1", ws, {
      id: "req-create-te",
      type: "session-create",
      sessionType: "agent",
    });

    // Override handler to simulate tool-executing and tool-result
    const mockHandler = {
      handleMessage: vi.fn().mockImplementation(async (content, reqId) => {
        // Simulate forwarding multiple events
        ws.send(
          JSON.stringify({
            id: reqId,
            type: "session-event",
            sessionId: "test-session-1",
            event: "tool-executing",
            tool: "read_file",
            args: { path: "README.md" },
          }),
        );
        ws.send(
          JSON.stringify({
            id: reqId,
            type: "session-event",
            sessionId: "test-session-1",
            event: "tool-result",
            tool: "read_file",
            result: { content: "# Hello" },
          }),
        );
        ws.send(
          JSON.stringify({
            id: reqId,
            type: "session-event",
            sessionId: "test-session-1",
            event: "response-complete",
            content: "File read successfully.",
          }),
        );
      }),
      handleSlashCommand: vi.fn(),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    server._handleMessage("client-1", ws, {
      id: "req-te",
      type: "session-message",
      sessionId: "test-session-1",
      content: "read README.md",
    });

    // Parse all sent messages
    const sentMessages = ws.send.mock.calls.map((c) => JSON.parse(c[0]));

    // Filter to session events (exclude session-created from setup)
    const sessionEvents = sentMessages.filter(
      (m) => m.type === "session-event",
    );

    expect(sessionEvents.length).toBeGreaterThanOrEqual(3);

    const toolExec = sessionEvents.find((e) => e.event === "tool-executing");
    expect(toolExec).toBeDefined();
    expect(toolExec.tool).toBe("read_file");

    const toolResult = sessionEvents.find((e) => e.event === "tool-result");
    expect(toolResult).toBeDefined();
    expect(toolResult.result.content).toBe("# Hello");

    const responseComplete = sessionEvents.find(
      (e) => e.event === "response-complete",
    );
    expect(responseComplete).toBeDefined();
    expect(responseComplete.content).toContain("File read successfully");
  });

  // ─── full create → message → close workflow ────────────────────────

  it("full session lifecycle: create → message → close", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    // Step 1: Create session
    await server._handleMessage("client-1", ws, {
      id: "req-create",
      type: "session-create",
      sessionType: "agent",
    });
    expect(lastSent(ws).type).toBe("session-created");

    // Step 2: Register a mock handler
    const mockHandler = {
      handleMessage: vi.fn().mockResolvedValue(undefined),
      handleSlashCommand: vi.fn(),
      destroy: vi.fn(),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    // Step 3: Send message
    server._handleMessage("client-1", ws, {
      id: "req-msg",
      type: "session-message",
      sessionId: "test-session-1",
      content: "Hello world",
    });
    expect(mockHandler.handleMessage).toHaveBeenCalledWith(
      "Hello world",
      "req-msg",
    );

    // Step 4: Close session
    server._handleMessage("client-1", ws, {
      id: "req-close",
      type: "session-close",
      sessionId: "test-session-1",
    });
    expect(sm.closeSession).toHaveBeenCalledWith("test-session-1");
    expect(mockHandler.destroy).toHaveBeenCalled();
    expect(server.sessionHandlers.has("test-session-1")).toBe(false);
  });
});
