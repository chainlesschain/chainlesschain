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

/** Parse the last JSON sent via ws.send. Unified envelopes (the v1.0
 *  protocol the CLI runtime now emits) are unwrapped into a flat shape so
 *  existing assertions like `resp.sessionId` / `resp.record` keep working.
 *  The `id` field is reconstructed from the envelope's `requestId`. */
function lastSent(ws) {
  const calls = ws.send.mock.calls;
  if (calls.length === 0) return null;
  const raw = JSON.parse(calls[calls.length - 1][0]);
  if (
    raw &&
    raw.version === "1.0" &&
    typeof raw.eventId === "string" &&
    raw.payload &&
    typeof raw.payload === "object"
  ) {
    return {
      ...raw.payload,
      type: raw.type,
      id: raw.requestId,
      _envelope: raw,
    };
  }
  return raw;
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
    expect(resp.type).toBe("session.started");
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
    expect(resp.type).toBe("session.started");
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
    expect(resp.type).toBe("session.started");
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
    expect(resp.type).toBe("session.resumed");
    expect(resp.sessionId).toBe("test-session-1");
    expect(resp.history).toBeInstanceOf(Array);
    // System messages should be filtered out
    expect(resp.history.some((m) => m.role === "system")).toBe(false);
  });

  it("session-resume returns policy and plan metadata in the record", async () => {
    const sm = mockSessionManager({
      resumeSession: vi.fn().mockReturnValue({
        id: "test-session-1",
        type: "agent",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "Previous message" },
        ],
        provider: "ollama",
        model: "qwen2.5:7b",
        projectRoot: "/repo/.worktrees/test-session-1",
        baseProjectRoot: "/repo",
        hostManagedToolPolicy: {
          tools: {
            git: {
              allowed: false,
              decision: "require_confirmation",
              planModeBehavior: "readonly-conditional",
            },
          },
        },
        worktreeIsolation: true,
        worktree: {
          branch: "coding-agent/test-session-1",
          path: "/repo/.worktrees/test-session-1",
          baseProjectRoot: "/repo",
        },
        planManager: { state: "approved" },
        interaction: null,
      }),
    });
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-resume-record",
      type: "session-resume",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("session.resumed");
    expect(resp.record).toEqual(
      expect.objectContaining({
        id: "test-session-1",
        type: "agent",
        planModeState: "approved",
        hasHostManagedToolPolicy: true,
        worktreeIsolation: true,
        baseProjectRoot: "/repo",
        worktree: expect.objectContaining({
          branch: "coding-agent/test-session-1",
          path: "/repo/.worktrees/test-session-1",
        }),
      }),
    );
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
    expect(resp.type).toBe("session.list");
    expect(resp.sessions).toBeInstanceOf(Array);
    expect(resp.sessions.length).toBe(1);
    expect(resp.sessions[0].id).toBe("test-session-1");
    expect(resp.sessions[0].record).toEqual(
      expect.objectContaining({
        id: "test-session-1",
        type: "agent",
        status: "active",
        messageCount: 0,
      }),
    );
  });

  it("session-create includes host policy and worktree metadata in the session record", async () => {
    const hostManagedToolPolicy = {
      tools: {
        git: {
          allowed: false,
          decision: "require_confirmation",
          planModeBehavior: "readonly-conditional",
        },
      },
    };
    const sm = mockSessionManager({
      getSession: vi.fn().mockReturnValue({
        id: "test-session-1",
        type: "agent",
        provider: "ollama",
        model: "qwen2.5:7b",
        projectRoot: "/repo/.worktrees/test-session-1",
        baseProjectRoot: "/repo",
        messages: [{ role: "system", content: "You are an assistant." }],
        hostManagedToolPolicy,
        worktreeIsolation: true,
        worktree: {
          branch: "coding-agent/test-session-1",
          path: "/repo/.worktrees/test-session-1",
          baseProjectRoot: "/repo",
        },
        planManager: { state: "analyzing" },
        interaction: null,
      }),
    });
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-create-record",
      type: "session-create",
      sessionType: "agent",
      projectRoot: "/repo",
      hostManagedToolPolicy,
      worktreeIsolation: true,
    });

    expect(sm.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent",
        projectRoot: "/repo",
        hostManagedToolPolicy,
        worktreeIsolation: true,
      }),
    );

    const resp = lastSent(ws);
    expect(resp.type).toBe("session.started");
    expect(resp.record).toEqual(
      expect.objectContaining({
        id: "test-session-1",
        type: "agent",
        projectRoot: "/repo/.worktrees/test-session-1",
        baseProjectRoot: "/repo",
        planModeState: "analyzing",
        hasHostManagedToolPolicy: true,
        worktreeIsolation: true,
        worktree: expect.objectContaining({
          branch: "coding-agent/test-session-1",
          path: "/repo/.worktrees/test-session-1",
        }),
      }),
    );
  });

  it("session-policy-update persists host-managed policy changes", () => {
    const updatedPolicy = {
      tools: {
        git: {
          allowed: false,
          decision: "require_confirmation",
          planModeBehavior: "readonly-conditional",
        },
      },
    };
    const sm = mockSessionManager({
      updateSessionPolicy: vi.fn().mockReturnValue({
        id: "test-session-1",
        hostManagedToolPolicy: updatedPolicy,
      }),
    });
    setupServer(sm);

    server._handleMessage("client-1", ws, {
      id: "req-policy-update",
      type: "session-policy-update",
      sessionId: "test-session-1",
      hostManagedToolPolicy: updatedPolicy,
    });

    expect(sm.updateSessionPolicy).toHaveBeenCalledWith(
      "test-session-1",
      updatedPolicy,
    );
    expect(lastSent(ws)).toEqual(
      expect.objectContaining({
        id: "req-policy-update",
        type: "command.response",
        success: true,
        sessionId: "test-session-1",
      }),
    );
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
    expect(resp.type).toBe("command.response");
    expect(resp.success).toBe(true);
    expect(server.sessionHandlers.has("test-session-1")).toBe(false);
  });

  it("session-interrupt routes to the handler without closing the session", async () => {
    const sm = mockSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-create",
      type: "session-create",
    });

    const mockHandler = {
      handleMessage: vi.fn().mockResolvedValue(undefined),
      handleSlashCommand: vi.fn(),
      interrupt: vi.fn().mockResolvedValue({
        sessionId: "test-session-1",
        interrupted: true,
        wasProcessing: true,
        interruptedRequestId: "req-msg",
      }),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    await server._handleMessage("client-1", ws, {
      id: "req-interrupt",
      type: "session-interrupt",
      sessionId: "test-session-1",
    });

    expect(mockHandler.interrupt).toHaveBeenCalled();
    expect(sm.closeSession).not.toHaveBeenCalled();
    expect(lastSent(ws)).toEqual(
      expect.objectContaining({
        id: "req-interrupt",
        type: "session.interrupted",
        sessionId: "test-session-1",
        interrupted: true,
        wasProcessing: true,
        interruptedRequestId: "req-msg",
      }),
    );
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
    expect(resp.type).toBe("session.resumed");
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
    expect(lastSent(ws).type).toBe("session.started");

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

  // ─── sub-agent-list / sub-agent-get ────────────────────────────────

  it("sub-agent-list scopes to a parent session", async () => {
    const { SubAgentRegistry } =
      await import("../../src/lib/sub-agent-registry.js");
    SubAgentRegistry.resetInstance();
    const registry = SubAgentRegistry.getInstance();

    // Seed the registry with two children on our session plus one foreign child
    const makeCtx = (id, parentId, role) => ({
      id,
      parentId,
      role,
      task: `task for ${id}`,
      status: "active",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      _tokenCount: 0,
      _toolsUsed: [],
      _iterationCount: 0,
      toJSON() {
        return {
          id: this.id,
          parentId: this.parentId,
          role: this.role,
          task: this.task,
          status: this.status,
        };
      },
      forceComplete() {
        this.status = "completed";
      },
    });
    registry.register(makeCtx("sub-a", "test-session-1", "review"));
    registry.register(makeCtx("sub-b", "test-session-1", "search"));
    registry.register(makeCtx("sub-c", "other-session", "review"));
    // Move one child into history
    registry.complete("sub-b", { summary: "done", tokenCount: 0 });

    setupServer(mockSessionManager());

    await server._handleMessage("client-1", ws, {
      id: "req-sublist",
      type: "sub-agent-list",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("sub-agent.list");
    expect(resp.id).toBe("req-sublist");
    expect(resp.sessionId).toBe("test-session-1");
    expect(resp.active.map((a) => a.id)).toEqual(["sub-a"]);
    expect(resp.history.map((h) => h.id)).toEqual(["sub-b"]);
    // Foreign session leaks are guarded
    expect(resp.active.concat(resp.history).some((a) => a.id === "sub-c")).toBe(
      false,
    );

    SubAgentRegistry.resetInstance();
  });

  it("sub-agent-get returns a single snapshot", async () => {
    const { SubAgentRegistry } =
      await import("../../src/lib/sub-agent-registry.js");
    SubAgentRegistry.resetInstance();
    const registry = SubAgentRegistry.getInstance();

    registry.register({
      id: "sub-one",
      parentId: "test-session-1",
      role: "summarizer",
      task: "summarize",
      status: "active",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      _tokenCount: 0,
      _toolsUsed: [],
      _iterationCount: 0,
      toJSON() {
        return { id: this.id, parentId: this.parentId, status: this.status };
      },
      forceComplete() {
        this.status = "completed";
      },
    });

    setupServer(mockSessionManager());

    await server._handleMessage("client-1", ws, {
      id: "req-subget",
      type: "sub-agent-get",
      sessionId: "test-session-1",
      subAgentId: "sub-one",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("sub-agent.list");
    expect(resp.id).toBe("req-subget");
    expect(resp.subAgent).toEqual(
      expect.objectContaining({ id: "sub-one", parentId: "test-session-1" }),
    );

    SubAgentRegistry.resetInstance();
  });

  it("sub-agent-get returns an error for unknown id", async () => {
    const { SubAgentRegistry } =
      await import("../../src/lib/sub-agent-registry.js");
    SubAgentRegistry.resetInstance();

    setupServer(mockSessionManager());

    await server._handleMessage("client-1", ws, {
      id: "req-subget-missing",
      type: "sub-agent-get",
      sessionId: "test-session-1",
      subAgentId: "sub-nope",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("SUB_AGENT_NOT_FOUND");
    expect(resp.id).toBe("req-subget-missing");

    SubAgentRegistry.resetInstance();
  });

  it("sub-agent-get rejects missing subAgentId", async () => {
    setupServer(mockSessionManager());

    await server._handleMessage("client-1", ws, {
      id: "req-subget-bare",
      type: "sub-agent-get",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("MISSING_SUB_AGENT_ID");
  });

  // ─── review-enter / review-submit / review-resolve / review-status ──

  function reviewSessionManager() {
    const state = { reviewState: null };
    const session = {
      id: "test-session-1",
      type: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
      messages: [],
      interaction: null,
      get reviewState() {
        return state.reviewState;
      },
    };
    return mockSessionManager({
      getSession: vi.fn().mockReturnValue(session),
      enterReview: vi.fn((sessionId, opts = {}) => {
        if (state.reviewState && state.reviewState.status === "pending") {
          return state.reviewState;
        }
        state.reviewState = {
          reviewId: "review-abc",
          status: "pending",
          reason: opts.reason || null,
          requestedBy: opts.requestedBy || "user",
          requestedAt: "2026-04-08T00:00:00Z",
          resolvedAt: null,
          resolvedBy: null,
          decision: null,
          blocking: opts.blocking !== false,
          comments: [],
          checklist: Array.isArray(opts.checklist) ? opts.checklist : [],
        };
        return state.reviewState;
      }),
      submitReviewComment: vi.fn((sessionId, update = {}) => {
        if (!state.reviewState || state.reviewState.status !== "pending") {
          return null;
        }
        if (update.comment) {
          state.reviewState.comments.push({
            id: "c-1",
            author: update.comment.author || "user",
            content: update.comment.content || "",
            timestamp: "2026-04-08T00:00:01Z",
          });
        }
        if (update.checklistItemId) {
          const item = state.reviewState.checklist.find(
            (c) => c.id === update.checklistItemId,
          );
          if (item) {
            if (typeof update.checklistItemDone === "boolean") {
              item.done = update.checklistItemDone;
            }
            if (update.checklistItemNote !== undefined) {
              item.note = update.checklistItemNote;
            }
          }
        }
        return state.reviewState;
      }),
      resolveReview: vi.fn((sessionId, payload = {}) => {
        if (!state.reviewState || state.reviewState.status !== "pending") {
          return state.reviewState;
        }
        state.reviewState.status = payload.decision || "approved";
        state.reviewState.decision = payload.decision || "approved";
        state.reviewState.resolvedBy = payload.resolvedBy || "user";
        state.reviewState.resolvedAt = "2026-04-08T00:00:02Z";
        state.reviewState.blocking = false;
        if (payload.summary) state.reviewState.summary = payload.summary;
        return state.reviewState;
      }),
      isReviewBlocking: vi.fn(() => {
        return (
          !!state.reviewState &&
          state.reviewState.status === "pending" &&
          state.reviewState.blocking === true
        );
      }),
      getReviewState: vi.fn(() => state.reviewState),
    });
  }

  it("review-enter creates a pending review and emits the envelope", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-renter",
      type: "review-enter",
      sessionId: "test-session-1",
      reason: "gate",
      checklist: [{ id: "a", title: "Item A" }],
    });

    expect(sm.enterReview).toHaveBeenCalledWith(
      "test-session-1",
      expect.objectContaining({ reason: "gate", blocking: true }),
    );
    // review-enter emits a response envelope AND an event envelope,
    // so grab the first (response) send explicitly.
    const firstRaw = JSON.parse(ws.send.mock.calls[0][0]);
    const resp = {
      ...firstRaw.payload,
      type: firstRaw.type,
      id: firstRaw.requestId,
    };
    expect(resp.type).toBe("review.requested");
    expect(resp.id).toBe("req-renter");
    expect(resp.sessionId).toBe("test-session-1");
    expect(resp.reviewState).toEqual(
      expect.objectContaining({ status: "pending", reviewId: "review-abc" }),
    );
  });

  it("session-message is blocked with REVIEW_BLOCKING while review is pending", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);

    // Register a handler so we get past the SESSION_NOT_FOUND guard
    const mockHandler = {
      handleMessage: vi.fn().mockResolvedValue(undefined),
      handleSlashCommand: vi.fn(),
    };
    server.sessionHandlers.set("test-session-1", mockHandler);

    // Enter review first
    sm.enterReview("test-session-1", { reason: "block" });

    await server._handleMessage("client-1", ws, {
      id: "req-blocked",
      type: "session-message",
      sessionId: "test-session-1",
      content: "hi",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("REVIEW_BLOCKING");
    expect(mockHandler.handleMessage).not.toHaveBeenCalled();
  });

  it("review-submit appends a comment", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);
    sm.enterReview("test-session-1", { reason: "check" });

    await server._handleMessage("client-1", ws, {
      id: "req-rsubmit",
      type: "review-submit",
      sessionId: "test-session-1",
      comment: { author: "alice", content: "looks good" },
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("review.updated");
    expect(resp.reviewState.comments).toHaveLength(1);
    expect(resp.reviewState.comments[0]).toEqual(
      expect.objectContaining({ author: "alice", content: "looks good" }),
    );
  });

  it("review-submit returns REVIEW_NOT_PENDING if there is no active review", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-rsubmit-err",
      type: "review-submit",
      sessionId: "test-session-1",
      comment: { content: "nope" },
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("REVIEW_NOT_PENDING");
  });

  it("review-resolve unblocks the session and records the decision", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);
    sm.enterReview("test-session-1", { reason: "check" });
    expect(sm.isReviewBlocking("test-session-1")).toBe(true);

    await server._handleMessage("client-1", ws, {
      id: "req-rresolve",
      type: "review-resolve",
      sessionId: "test-session-1",
      decision: "approved",
      summary: "Ship it",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("review.resolved");
    expect(resp.reviewState.status).toBe("approved");
    expect(resp.reviewState.decision).toBe("approved");
    expect(resp.reviewState.summary).toBe("Ship it");
    expect(sm.isReviewBlocking("test-session-1")).toBe(false);
  });

  it("review-status returns the current review state", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);
    sm.enterReview("test-session-1", { reason: "inspect" });

    await server._handleMessage("client-1", ws, {
      id: "req-rstatus",
      type: "review-status",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("review.state");
    expect(resp.reviewState).toEqual(
      expect.objectContaining({ status: "pending", reason: "inspect" }),
    );
  });

  it("review-status returns null when no review is active", async () => {
    const sm = reviewSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-rstatus-null",
      type: "review-status",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("review.state");
    expect(resp.reviewState).toBeNull();
  });

  it("review-enter returns SESSION_NOT_FOUND for unknown session", async () => {
    const sm = reviewSessionManager();
    sm.getSession.mockReturnValueOnce(null);
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-rbad",
      type: "review-enter",
      sessionId: "ghost",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("SESSION_NOT_FOUND");
  });

  // ─── patch-propose / patch-apply / patch-reject / patch-summary ──

  function patchSessionManager() {
    const session = {
      id: "test-session-1",
      type: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
      messages: [],
      interaction: null,
    };
    const pending = new Map();
    const history = [];
    let nextId = 1;
    return mockSessionManager({
      getSession: vi.fn().mockReturnValue(session),
      proposePatch: vi.fn((sessionId, payload = {}) => {
        if (!Array.isArray(payload.files) || payload.files.length === 0) {
          return null;
        }
        const patchId = `patch-${nextId++}`;
        const patch = {
          patchId,
          status: "pending",
          origin: payload.origin || "tool",
          reason: payload.reason || null,
          requestId: payload.requestId || null,
          proposedAt: "2026-04-08T00:00:00Z",
          resolvedAt: null,
          resolvedBy: null,
          files: payload.files.map((f, i) => ({
            index: i,
            path: f.path,
            op: f.op || "modify",
            before: f.before || null,
            after: f.after || null,
            diff: f.diff || null,
            stats: { added: 1, removed: 0 },
          })),
          stats: { fileCount: payload.files.length, added: 1, removed: 0 },
        };
        pending.set(patchId, patch);
        return patch;
      }),
      applyPatch: vi.fn((sessionId, patchId, opts = {}) => {
        const patch = pending.get(patchId);
        if (!patch) return null;
        patch.status = "applied";
        patch.resolvedBy = opts.resolvedBy || "user";
        patch.resolvedAt = "2026-04-08T00:00:01Z";
        if (opts.note) patch.note = opts.note;
        pending.delete(patchId);
        history.push(patch);
        return patch;
      }),
      rejectPatch: vi.fn((sessionId, patchId, opts = {}) => {
        const patch = pending.get(patchId);
        if (!patch) return null;
        patch.status = "rejected";
        patch.resolvedBy = opts.resolvedBy || "user";
        patch.resolvedAt = "2026-04-08T00:00:02Z";
        if (opts.reason) patch.rejectionReason = opts.reason;
        pending.delete(patchId);
        history.push(patch);
        return patch;
      }),
      getPatchSummary: vi.fn(() => ({
        pending: Array.from(pending.values()),
        history,
        totals: {
          fileCount: pending.size + history.length,
          added: pending.size + history.length,
          removed: 0,
        },
      })),
    });
  }

  it("patch-propose records a pending patch and emits the envelope", async () => {
    const sm = patchSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-propose",
      type: "patch-propose",
      sessionId: "test-session-1",
      origin: "tool",
      reason: "add helper",
      files: [{ path: "src/a.js", op: "create", after: "console.log('hi')" }],
    });

    expect(sm.proposePatch).toHaveBeenCalledWith(
      "test-session-1",
      expect.objectContaining({
        origin: "tool",
        reason: "add helper",
      }),
    );
    // First send is response envelope, second is event fan-out
    const firstRaw = JSON.parse(ws.send.mock.calls[0][0]);
    const resp = {
      ...firstRaw.payload,
      type: firstRaw.type,
      id: firstRaw.requestId,
    };
    expect(resp.type).toBe("patch.proposed");
    expect(resp.id).toBe("req-propose");
    expect(resp.patch).toEqual(
      expect.objectContaining({
        patchId: "patch-1",
        status: "pending",
      }),
    );
  });

  it("patch-propose rejects empty files arrays with INVALID_PAYLOAD", async () => {
    const sm = patchSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-propose-bad",
      type: "patch-propose",
      sessionId: "test-session-1",
      files: [],
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("INVALID_PAYLOAD");
  });

  it("patch-apply moves a pending patch to applied status", async () => {
    const sm = patchSessionManager();
    setupServer(sm);
    sm.proposePatch("test-session-1", {
      files: [{ path: "a.js", after: "x" }],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-apply",
      type: "patch-apply",
      sessionId: "test-session-1",
      patchId: "patch-1",
      resolvedBy: "user",
      note: "approved",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("patch.applied");
    expect(resp.patch.status).toBe("applied");
    expect(resp.patch.note).toBe("approved");
  });

  it("patch-apply returns PATCH_NOT_FOUND for unknown patchId", async () => {
    const sm = patchSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-apply-bad",
      type: "patch-apply",
      sessionId: "test-session-1",
      patchId: "nope",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("PATCH_NOT_FOUND");
  });

  it("patch-apply requires a patchId", async () => {
    const sm = patchSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-apply-bad2",
      type: "patch-apply",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("INVALID_PAYLOAD");
  });

  it("patch-reject discards a pending patch with reason", async () => {
    const sm = patchSessionManager();
    setupServer(sm);
    sm.proposePatch("test-session-1", {
      files: [{ path: "a.js", after: "x" }],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-reject",
      type: "patch-reject",
      sessionId: "test-session-1",
      patchId: "patch-1",
      reason: "risky",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("patch.rejected");
    expect(resp.patch.status).toBe("rejected");
    expect(resp.patch.rejectionReason).toBe("risky");
  });

  it("patch-summary returns pending + history + totals", async () => {
    const sm = patchSessionManager();
    setupServer(sm);
    sm.proposePatch("test-session-1", {
      files: [{ path: "a.js", after: "x" }],
    });
    sm.proposePatch("test-session-1", {
      files: [{ path: "b.js", after: "y" }],
    });
    sm.applyPatch("test-session-1", "patch-1");

    await server._handleMessage("client-1", ws, {
      id: "req-summary",
      type: "patch-summary",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("patch.summary");
    expect(resp.summary.pending).toHaveLength(1);
    expect(resp.summary.history).toHaveLength(1);
    expect(resp.summary.totals.fileCount).toBe(2);
  });

  it("patch-propose returns SESSION_NOT_FOUND for unknown session", async () => {
    const sm = patchSessionManager();
    sm.getSession.mockReturnValueOnce(null);
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-nopatch",
      type: "patch-propose",
      sessionId: "ghost",
      files: [{ path: "a.js" }],
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("SESSION_NOT_FOUND");
  });

  // ─── task-graph-* lifecycle ──────────────────────────────────────

  function taskGraphSessionManager() {
    const session = {
      id: "test-session-1",
      type: "agent",
      provider: "ollama",
      model: "qwen2.5:7b",
      messages: [],
      interaction: null,
    };
    let graph = null;
    const clone = (g) => (g ? JSON.parse(JSON.stringify(g)) : null);

    return mockSessionManager({
      getSession: vi.fn().mockReturnValue(session),
      createTaskGraph: vi.fn((sessionId, payload = {}) => {
        const now = "2026-04-08T00:00:00Z";
        const nodes = {};
        const order = [];
        for (const raw of payload.nodes || []) {
          if (!raw || !raw.id) continue;
          nodes[raw.id] = {
            id: raw.id,
            title: raw.title || raw.id,
            status: raw.status || "pending",
            dependsOn: raw.dependsOn || [],
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
            result: null,
            error: null,
            metadata: raw.metadata || {},
          };
          order.push(raw.id);
        }
        graph = {
          graphId: payload.graphId || "graph-1",
          title: payload.title || null,
          description: payload.description || null,
          status: "active",
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          nodes,
          order,
        };
        return clone(graph);
      }),
      addTaskNode: vi.fn((sessionId, node) => {
        if (!graph || !node || !node.id || graph.nodes[node.id]) return null;
        graph.nodes[node.id] = {
          id: node.id,
          title: node.title || node.id,
          status: "pending",
          dependsOn: node.dependsOn || [],
          createdAt: "2026-04-08T00:00:00Z",
          updatedAt: "2026-04-08T00:00:00Z",
          startedAt: null,
          completedAt: null,
          result: null,
          error: null,
          metadata: {},
        };
        graph.order.push(node.id);
        return clone(graph);
      }),
      updateTaskNode: vi.fn((sessionId, nodeId, updates = {}) => {
        if (!graph || !graph.nodes[nodeId]) return null;
        const node = graph.nodes[nodeId];
        if (updates.status) node.status = updates.status;
        if (updates.result !== undefined) node.result = updates.result;
        if (updates.error !== undefined) node.error = updates.error;
        node.updatedAt = "2026-04-08T00:00:01Z";
        const allDone = Object.values(graph.nodes).every((n) =>
          ["completed", "failed", "skipped"].includes(n.status),
        );
        if (allDone) {
          graph.status = Object.values(graph.nodes).some(
            (n) => n.status === "failed",
          )
            ? "failed"
            : "completed";
          graph.completedAt = "2026-04-08T00:00:02Z";
        }
        return clone(graph);
      }),
      advanceTaskGraph: vi.fn(() => {
        if (!graph) return null;
        const becameReady = [];
        for (const node of Object.values(graph.nodes)) {
          if (node.status !== "pending") continue;
          const blocked = (node.dependsOn || []).some((depId) => {
            const dep = graph.nodes[depId];
            return !dep || dep.status !== "completed";
          });
          if (!blocked) {
            node.status = "ready";
            becameReady.push(node.id);
          }
        }
        return { graph: clone(graph), becameReady };
      }),
      getTaskGraph: vi.fn(() => clone(graph)),
    });
  }

  it("task-graph-create stores the graph and emits the envelope", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-graph",
      type: "task-graph-create",
      sessionId: "test-session-1",
      title: "Release",
      nodes: [
        { id: "a", title: "Build" },
        { id: "b", title: "Ship", dependsOn: ["a"] },
      ],
    });

    expect(sm.createTaskGraph).toHaveBeenCalledWith(
      "test-session-1",
      expect.objectContaining({ title: "Release" }),
    );
    const resp = lastSent(ws);
    expect(resp.type).toBe("task-graph.created");
    expect(resp.graph.order).toEqual(["a", "b"]);
    expect(resp.graph.nodes.a.status).toBe("pending");
  });

  it("task-graph-create rejects missing nodes array", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-graph-bad",
      type: "task-graph-create",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("INVALID_PAYLOAD");
  });

  it("task-graph-add-node appends a new node", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);
    sm.createTaskGraph("test-session-1", {
      nodes: [{ id: "a", title: "Build" }],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-add",
      type: "task-graph-add-node",
      sessionId: "test-session-1",
      node: { id: "b", title: "Ship", dependsOn: ["a"] },
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("task-graph.node.added");
    expect(resp.graph.order).toEqual(["a", "b"]);
    expect(resp.nodeId).toBe("b");
  });

  it("task-graph-add-node fails on duplicate id", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);
    sm.createTaskGraph("test-session-1", {
      nodes: [{ id: "a", title: "Build" }],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-add-dup",
      type: "task-graph-add-node",
      sessionId: "test-session-1",
      node: { id: "a", title: "Dup" },
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("TASK_GRAPH_ADD_FAILED");
  });

  it("task-graph-update-node emits node.completed on completion", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);
    sm.createTaskGraph("test-session-1", {
      nodes: [
        { id: "a", title: "Build" },
        { id: "b", title: "Ship" },
      ],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-update",
      type: "task-graph-update-node",
      sessionId: "test-session-1",
      nodeId: "a",
      updates: { status: "completed", result: { ok: true } },
    });

    // First send is the envelopeResponse with the node event type.
    const firstRaw = JSON.parse(ws.send.mock.calls[0][0]);
    const resp = { ...firstRaw.payload, type: firstRaw.type };
    expect(resp.type).toBe("task-graph.node.completed");
    expect(resp.graph.nodes.a.result).toEqual({ ok: true });
  });

  it("task-graph-update-node emits node.failed on failure", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);
    sm.createTaskGraph("test-session-1", {
      nodes: [
        { id: "a", title: "Build" },
        { id: "b", title: "Ship" },
      ],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-fail",
      type: "task-graph-update-node",
      sessionId: "test-session-1",
      nodeId: "a",
      updates: { status: "failed", error: "boom" },
    });

    const firstRaw = JSON.parse(ws.send.mock.calls[0][0]);
    const resp = { ...firstRaw.payload, type: firstRaw.type };
    expect(resp.type).toBe("task-graph.node.failed");
  });

  it("task-graph-update-node rejects missing nodeId", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-update-bad",
      type: "task-graph-update-node",
      sessionId: "test-session-1",
      updates: { status: "completed" },
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("INVALID_PAYLOAD");
  });

  it("task-graph-advance promotes ready nodes", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);
    sm.createTaskGraph("test-session-1", {
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B", dependsOn: ["a"] },
      ],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-advance",
      type: "task-graph-advance",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("task-graph.advanced");
    expect(resp.becameReady).toEqual(["a"]);
    expect(resp.graph.nodes.a.status).toBe("ready");
  });

  it("task-graph-advance returns TASK_GRAPH_NOT_FOUND when no graph exists", async () => {
    const sm = taskGraphSessionManager();
    sm.advanceTaskGraph.mockReturnValueOnce(null);
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-advance-none",
      type: "task-graph-advance",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("TASK_GRAPH_NOT_FOUND");
  });

  it("task-graph-state returns the current graph", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);
    sm.createTaskGraph("test-session-1", {
      nodes: [{ id: "a", title: "A" }],
    });

    await server._handleMessage("client-1", ws, {
      id: "req-state",
      type: "task-graph-state",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("task-graph.state");
    expect(resp.graph.nodes.a.title).toBe("A");
  });

  it("task-graph-state returns null graph when unset", async () => {
    const sm = taskGraphSessionManager();
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-state-empty",
      type: "task-graph-state",
      sessionId: "test-session-1",
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("task-graph.state");
    expect(resp.graph).toBeNull();
  });

  it("task-graph-create returns SESSION_NOT_FOUND for unknown session", async () => {
    const sm = taskGraphSessionManager();
    sm.getSession.mockReturnValueOnce(null);
    setupServer(sm);

    await server._handleMessage("client-1", ws, {
      id: "req-graph-ghost",
      type: "task-graph-create",
      sessionId: "ghost",
      nodes: [{ id: "a" }],
    });

    const resp = lastSent(ws);
    expect(resp.type).toBe("error");
    expect(resp.code).toBe("SESSION_NOT_FOUND");
  });
});
