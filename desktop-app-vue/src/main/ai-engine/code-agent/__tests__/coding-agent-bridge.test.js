import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const bridgeModule = require("../coding-agent-bridge.js");
const { CodingAgentBridge, _deps } = bridgeModule;

// Wait for the bridge's `await ensureReady()` microtask to flush so the
// underlying _send() actually pushes into mockWs.sent before tests inspect it.
async function flushSend(mockWs) {
  for (let i = 0; i < 5 && mockWs.sent.length === 0; i += 1) {
    await Promise.resolve();
  }
}

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  constructor() {
    super();
    this.readyState = MockWebSocket.OPEN;
    this.sent = [];
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }
  triggerOpen() {
    this.emit("open");
  }
  triggerMessage(message) {
    this.emit("message", JSON.stringify(message));
  }
}

class MockChildProcess extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
  kill() {
    this.killed = true;
    this.emit("exit", 0, null);
  }
}

describe("CodingAgentBridge", () => {
  let originalDeps;
  let mockWs;
  let mockProcess;

  beforeEach(() => {
    originalDeps = { ..._deps };
    mockWs = new MockWebSocket();
    mockProcess = new MockChildProcess();
    _deps.WebSocket = function (url) {
      mockWs.url = url;
      // Simulate async open on next tick.
      setImmediate(() => mockWs.triggerOpen());
      return mockWs;
    };
    _deps.WebSocket.OPEN = MockWebSocket.OPEN;
    _deps.spawn = vi.fn(() => mockProcess);
    _deps.findAvailablePort = vi.fn(async () => 4399);
    _deps.wait = vi.fn(async () => undefined);
  });

  afterEach(() => {
    Object.assign(_deps, originalDeps);
  });

  it("starts the CLI server and connects via websocket", async () => {
    const bridge = new CodingAgentBridge({
      cwd: "/repo",
      projectRoot: "/repo/proj",
      cliEntry: "/repo/packages/cli/bin/chainlesschain.js",
    });
    const startingEvents = [];
    const readyEvents = [];
    bridge.on("server-starting", (e) => startingEvents.push(e));
    bridge.on("server-ready", (e) => readyEvents.push(e));

    const ready = await bridge.ensureReady();

    expect(ready).toEqual({ host: "127.0.0.1", port: 4399 });
    expect(_deps.spawn).toHaveBeenCalledTimes(1);
    expect(_deps.findAvailablePort).toHaveBeenCalledTimes(1);
    expect(startingEvents).toHaveLength(1);
    expect(readyEvents).toHaveLength(1);
    expect(bridge.connected).toBe(true);
  });

  it("memoizes ensureReady and avoids restart when already connected", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();
    _deps.spawn.mockClear();
    const second = await bridge.ensureReady();
    expect(second).toEqual({ host: "127.0.0.1", port: 4399 });
    expect(_deps.spawn).not.toHaveBeenCalled();
  });

  it("resolves request() when matching message arrives", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const promise = bridge.request("session-create", { provider: "openai" }, [
      "session-created",
    ]);

    await flushSend(mockWs);
    // Find the sent payload to extract id.
    expect(mockWs.sent).toHaveLength(1);
    const sent = JSON.parse(mockWs.sent[0]);
    expect(sent.type).toBe("session-create");
    expect(sent.provider).toBe("openai");

    mockWs.triggerMessage({
      id: sent.id,
      type: "session-created",
      sessionId: "abc",
    });

    const result = await promise;
    expect(result.sessionId).toBe("abc");
    expect(bridge.pending.size).toBe(0);
  });

  it("rejects request() when matching message has type=error", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const promise = bridge.request("session-create", {}, ["session-created"]);
    await flushSend(mockWs);
    const sent = JSON.parse(mockWs.sent[0]);

    mockWs.triggerMessage({
      id: sent.id,
      type: "error",
      message: "boom",
    });

    await expect(promise).rejects.toThrow("boom");
    expect(bridge.pending.size).toBe(0);
  });

  it("ignores messages whose type is not in awaitTypes (still pending)", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const promise = bridge.request("session-create", {}, ["session-created"]);
    await flushSend(mockWs);
    const sent = JSON.parse(mockWs.sent[0]);

    // Send an unrelated message that shares id but wrong type.
    mockWs.triggerMessage({ id: sent.id, type: "ack" });
    expect(bridge.pending.size).toBe(1);

    // Now the real one.
    mockWs.triggerMessage({ id: sent.id, type: "session-created" });
    await promise;
    expect(bridge.pending.size).toBe(0);
  });

  it("Bug fix: cleans pending entry when _send throws", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    // Force the next send to throw.
    mockWs.send = () => {
      throw new Error("write failed");
    };

    await expect(
      bridge.request("session-create", {}, ["session-created"]),
    ).rejects.toThrow("write failed");

    expect(bridge.pending.size).toBe(0);
  });

  it("Bug fix: rejects all pending requests when websocket closes", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const p1 = bridge.request("session-create", {}, ["session-created"]);
    const p2 = bridge.request("session-list", {}, ["session-list-result"]);
    // Wait for both microtask chains to register pending entries.
    for (let i = 0; i < 5 && bridge.pending.size < 2; i += 1) {
      await Promise.resolve();
    }
    expect(bridge.pending.size).toBe(2);

    mockWs.close();

    await expect(p1).rejects.toThrow(/closed before response/);
    await expect(p2).rejects.toThrow(/closed before response/);
    expect(bridge.pending.size).toBe(0);
    expect(bridge.connected).toBe(false);
  });

  it("Bug fix: rejects pending requests when CLI server process exits unexpectedly", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const p1 = bridge.request("session-create", {}, ["session-created"]);
    const p2 = bridge.request("session-message", {}, ["response-complete"]);
    for (let i = 0; i < 5 && bridge.pending.size < 2; i += 1) {
      await Promise.resolve();
    }
    expect(bridge.pending.size).toBe(2);

    // Simulate the CLI server crashing mid-flight (NOT a graceful ws close).
    // The process exit handler must reject pending requests so callers do not
    // hang on a dead bridge.
    mockProcess.emit("exit", 137, "SIGKILL");

    await expect(p1).rejects.toThrow(/CLI server exited/);
    await expect(p2).rejects.toThrow(/CLI server exited/);
    expect(bridge.pending.size).toBe(0);
    expect(bridge.connected).toBe(false);
  });

  it("fire-and-forget request (no awaitTypes) returns id immediately", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const result = await bridge.request("session-message", {
      sessionId: "abc",
      content: "hi",
    });
    expect(result.id).toMatch(/^session-message-/);
    await flushSend(mockWs);
    const sent = JSON.parse(mockWs.sent[0]);
    expect(sent.id).toBe(result.id);
    expect(bridge.pending.size).toBe(0);
  });

  it("createSession forwards options to the underlying request", async () => {
    const bridge = new CodingAgentBridge({
      cwd: "/repo",
      projectRoot: "/proj",
    });
    await bridge.ensureReady();

    const promise = bridge.createSession({
      provider: "openai",
      model: "gpt-4o-mini",
      worktreeIsolation: true,
    });
    await flushSend(mockWs);
    const sent = JSON.parse(mockWs.sent[0]);
    expect(sent.type).toBe("session-create");
    expect(sent.provider).toBe("openai");
    expect(sent.model).toBe("gpt-4o-mini");
    expect(sent.worktreeIsolation).toBe(true);
    expect(sent.projectRoot).toBe("/proj");
    expect(sent.sessionType).toBe("agent");

    mockWs.triggerMessage({
      id: sent.id,
      type: "session-created",
      sessionId: "s-1",
    });
    const result = await promise;
    expect(result.sessionId).toBe("s-1");
  });

  it("updateSessionPolicy forwards the host-managed tool policy payload", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const promise = bridge.updateSessionPolicy("session-1", {
      toolDefinitions: [
        {
          type: "function",
          function: {
            name: "mcp_weather_get_forecast",
            description: "Get weather forecast",
          },
        },
      ],
      tools: {
        mcp_weather_get_forecast: {
          allowed: true,
          source: "mcp:weather",
          riskLevel: "low",
          requiresPlanApproval: false,
        },
      },
      toolsBySource: {
        "mcp:weather": ["mcp_weather_get_forecast"],
      },
    });

    await flushSend(mockWs);
    const sent = JSON.parse(mockWs.sent[0]);
    expect(sent).toMatchObject({
      type: "session-policy-update",
      sessionId: "session-1",
      hostManagedToolPolicy: {
        toolDefinitions: [
          expect.objectContaining({
            function: expect.objectContaining({
              name: "mcp_weather_get_forecast",
            }),
          }),
        ],
        tools: {
          mcp_weather_get_forecast: expect.objectContaining({
            allowed: true,
            source: "mcp:weather",
            riskLevel: "low",
          }),
        },
        toolsBySource: {
          "mcp:weather": ["mcp_weather_get_forecast"],
        },
      },
    });

    mockWs.triggerMessage({
      id: sent.id,
      type: "session-policy-updated",
      success: true,
      sessionId: "session-1",
    });

    await expect(promise).resolves.toMatchObject({
      success: true,
      sessionId: "session-1",
    });
  });

  it("worktree helpers send the correct message types", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    bridge.listWorktrees().catch(() => undefined);
    bridge
      .diffWorktree("agent/foo", { baseBranch: "main" })
      .catch(() => undefined);
    bridge
      .mergeWorktree("agent/foo", { strategy: "rebase" })
      .catch(() => undefined);
    bridge
      .previewWorktreeMerge("agent/foo", { strategy: "merge" })
      .catch(() => undefined);
    bridge
      .applyWorktreeAutomationCandidate("agent/foo", {
        filePath: "src/a.js",
        candidateId: "auto-1",
      })
      .catch(() => undefined);

    for (let i = 0; i < 10 && mockWs.sent.length < 5; i += 1) {
      await Promise.resolve();
    }
    const types = mockWs.sent.map((raw) => JSON.parse(raw).type);
    expect(types).toEqual([
      "worktree-list",
      "worktree-diff",
      "worktree-merge",
      "worktree-merge-preview",
      "worktree-automation-apply",
    ]);
  });

  it("sub-agent helpers send the correct message types and scope payloads", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    bridge.listSubAgents("session-abc").catch(() => undefined);
    bridge.listSubAgents().catch(() => undefined);
    bridge.getSubAgent("sub-xyz", "session-abc").catch(() => undefined);
    bridge.getSubAgent("sub-only").catch(() => undefined);

    for (let i = 0; i < 15 && mockWs.sent.length < 4; i += 1) {
      await Promise.resolve();
    }
    const parsed = mockWs.sent.map((raw) => JSON.parse(raw));
    const types = parsed.map((m) => m.type);
    expect(types).toEqual([
      "sub-agent-list",
      "sub-agent-list",
      "sub-agent-get",
      "sub-agent-get",
    ]);
    // Scoped list carries sessionId; global list omits it entirely.
    expect(parsed[0].sessionId).toBe("session-abc");
    expect(parsed[1].sessionId).toBeUndefined();
    // get with session hint attaches both ids; bare get only sends subAgentId.
    expect(parsed[2]).toEqual(
      expect.objectContaining({
        subAgentId: "sub-xyz",
        sessionId: "session-abc",
      }),
    );
    expect(parsed[3]).toEqual(
      expect.objectContaining({ subAgentId: "sub-only" }),
    );
    expect(parsed[3].sessionId).toBeUndefined();
  });

  it("review helpers send the correct message types and payloads", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    bridge
      .enterReview("session-rv", {
        reason: "gate",
        checklist: [{ id: "a", title: "Item A" }],
      })
      .catch(() => undefined);
    bridge
      .submitReviewComment("session-rv", {
        comment: { author: "alice", content: "looks good" },
      })
      .catch(() => undefined);
    bridge
      .resolveReview("session-rv", { decision: "approved", summary: "Ship it" })
      .catch(() => undefined);
    bridge.getReviewState("session-rv").catch(() => undefined);

    for (let i = 0; i < 15 && mockWs.sent.length < 4; i += 1) {
      await Promise.resolve();
    }
    const parsed = mockWs.sent.map((raw) => JSON.parse(raw));
    expect(parsed.map((m) => m.type)).toEqual([
      "review-enter",
      "review-submit",
      "review-resolve",
      "review-status",
    ]);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-rv",
        reason: "gate",
        blocking: true,
      }),
    );
    expect(parsed[0].checklist).toEqual([{ id: "a", title: "Item A" }]);
    expect(parsed[1].comment).toEqual({
      author: "alice",
      content: "looks good",
    });
    expect(parsed[2]).toEqual(
      expect.objectContaining({
        decision: "approved",
        summary: "Ship it",
      }),
    );
    expect(parsed[3].sessionId).toBe("session-rv");
  });

  it("patch helpers send the correct message types and payloads", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    bridge
      .proposePatch("session-pt", {
        origin: "tool",
        reason: "add helper",
        files: [{ path: "a.js", op: "create", after: "hi" }],
      })
      .catch(() => undefined);
    bridge
      .applyPatch("session-pt", "patch-1", { note: "ok" })
      .catch(() => undefined);
    bridge
      .rejectPatch("session-pt", "patch-2", { reason: "risky" })
      .catch(() => undefined);
    bridge.getPatchSummary("session-pt").catch(() => undefined);

    for (let i = 0; i < 15 && mockWs.sent.length < 4; i += 1) {
      await Promise.resolve();
    }
    const parsed = mockWs.sent.map((raw) => JSON.parse(raw));
    expect(parsed.map((m) => m.type)).toEqual([
      "patch-propose",
      "patch-apply",
      "patch-reject",
      "patch-summary",
    ]);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-pt",
        origin: "tool",
        reason: "add helper",
      }),
    );
    expect(parsed[0].files).toEqual([
      { path: "a.js", op: "create", after: "hi" },
    ]);
    expect(parsed[1]).toEqual(
      expect.objectContaining({
        sessionId: "session-pt",
        patchId: "patch-1",
        note: "ok",
      }),
    );
    expect(parsed[2]).toEqual(
      expect.objectContaining({
        patchId: "patch-2",
        reason: "risky",
      }),
    );
    expect(parsed[3]).toEqual(
      expect.objectContaining({ sessionId: "session-pt" }),
    );
  });

  it("proposePatch unwraps the patch.proposed envelope", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const pending = bridge.proposePatch("session-pt", {
      files: [{ path: "a.js", after: "hi" }],
    });
    for (let i = 0; i < 10 && mockWs.sent.length === 0; i += 1) {
      await Promise.resolve();
    }
    const requestId = JSON.parse(mockWs.sent[0]).id;

    mockWs.triggerMessage({
      version: "1.0",
      eventId: "evt-pt-1",
      type: "patch.proposed",
      requestId,
      sessionId: "session-pt",
      payload: {
        sessionId: "session-pt",
        patch: {
          patchId: "patch-1",
          status: "pending",
          files: [
            {
              index: 0,
              path: "a.js",
              op: "create",
              stats: { added: 1, removed: 0 },
            },
          ],
          stats: { fileCount: 1, added: 1, removed: 0 },
        },
      },
    });

    const result = await pending;
    expect(result.type).toBe("patch.proposed");
    expect(result.patch.patchId).toBe("patch-1");
    expect(result.patch.status).toBe("pending");
  });

  it("enterReview unwraps the review.requested envelope", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const pending = bridge.enterReview("session-rv", { reason: "check" });
    for (let i = 0; i < 10 && mockWs.sent.length === 0; i += 1) {
      await Promise.resolve();
    }
    const requestId = JSON.parse(mockWs.sent[0]).id;

    mockWs.triggerMessage({
      version: "1.0",
      eventId: "evt-rv-1",
      type: "review.requested",
      requestId,
      sessionId: "session-rv",
      payload: {
        sessionId: "session-rv",
        reviewState: {
          reviewId: "review-1",
          status: "pending",
          blocking: true,
          comments: [],
          checklist: [],
        },
      },
    });

    const result = await pending;
    expect(result.type).toBe("review.requested");
    expect(result.reviewState.status).toBe("pending");
    expect(result.reviewState.reviewId).toBe("review-1");
  });

  it("listSubAgents unwraps the sub-agent.list envelope", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const pending = bridge.listSubAgents("session-xyz");
    for (let i = 0; i < 10 && mockWs.sent.length === 0; i += 1) {
      await Promise.resolve();
    }
    const requestId = JSON.parse(mockWs.sent[0]).id;

    mockWs.triggerMessage({
      version: "1.0",
      eventId: "evt-1",
      type: "sub-agent.list",
      requestId,
      sessionId: "session-xyz",
      payload: {
        sessionId: "session-xyz",
        active: [{ id: "sub-1", parentId: "session-xyz", status: "active" }],
        history: [],
        stats: { active: 1, completed: 0 },
      },
    });

    const result = await pending;
    expect(result.type).toBe("sub-agent.list");
    expect(result.active).toEqual([
      { id: "sub-1", parentId: "session-xyz", status: "active" },
    ]);
    expect(result.history).toEqual([]);
  });

  it("task graph helpers send the correct message types and payloads", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    bridge
      .createTaskGraph("session-tg", {
        title: "Plan",
        nodes: [{ id: "a" }, { id: "b", dependsOn: ["a"] }],
      })
      .catch(() => undefined);
    bridge
      .addTaskNode("session-tg", { id: "c", dependsOn: ["b"] })
      .catch(() => undefined);
    bridge
      .updateTaskNode("session-tg", "a", { status: "completed" })
      .catch(() => undefined);
    bridge.advanceTaskGraph("session-tg").catch(() => undefined);
    bridge.getTaskGraph("session-tg").catch(() => undefined);

    for (let i = 0; i < 15 && mockWs.sent.length < 5; i += 1) {
      await Promise.resolve();
    }
    const parsed = mockWs.sent.map((raw) => JSON.parse(raw));
    expect(parsed.map((m) => m.type)).toEqual([
      "task-graph-create",
      "task-graph-add-node",
      "task-graph-update-node",
      "task-graph-advance",
      "task-graph-state",
    ]);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-tg",
        title: "Plan",
      }),
    );
    expect(parsed[0].nodes).toEqual([
      { id: "a" },
      { id: "b", dependsOn: ["a"] },
    ]);
    expect(parsed[1].node).toEqual({ id: "c", dependsOn: ["b"] });
    expect(parsed[2]).toEqual(
      expect.objectContaining({
        sessionId: "session-tg",
        nodeId: "a",
        updates: { status: "completed" },
      }),
    );
    expect(parsed[3].sessionId).toBe("session-tg");
    expect(parsed[4].sessionId).toBe("session-tg");
  });

  it("createTaskGraph unwraps the task-graph.created envelope", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const pending = bridge.createTaskGraph("session-tg", {
      nodes: [{ id: "a" }],
    });
    for (let i = 0; i < 10 && mockWs.sent.length === 0; i += 1) {
      await Promise.resolve();
    }
    const requestId = JSON.parse(mockWs.sent[0]).id;

    mockWs.triggerMessage({
      version: "1.0",
      eventId: "evt-tg-1",
      type: "task-graph.created",
      requestId,
      sessionId: "session-tg",
      payload: {
        sessionId: "session-tg",
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a"],
          nodes: { a: { id: "a", status: "pending", dependsOn: [] } },
        },
      },
    });

    const result = await pending;
    expect(result.type).toBe("task-graph.created");
    expect(result.graph.graphId).toBe("graph-1");
    expect(result.graph.order).toEqual(["a"]);
  });

  it("updateTaskNode accepts task-graph.node.completed envelope", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const pending = bridge.updateTaskNode("session-tg", "a", {
      status: "completed",
    });
    for (let i = 0; i < 10 && mockWs.sent.length === 0; i += 1) {
      await Promise.resolve();
    }
    const requestId = JSON.parse(mockWs.sent[0]).id;

    mockWs.triggerMessage({
      version: "1.0",
      eventId: "evt-tg-2",
      type: "task-graph.node.completed",
      requestId,
      sessionId: "session-tg",
      payload: {
        sessionId: "session-tg",
        nodeId: "a",
        graph: {
          graphId: "graph-1",
          status: "active",
          order: ["a", "b"],
          nodes: {
            a: { id: "a", status: "completed", dependsOn: [] },
            b: { id: "b", status: "pending", dependsOn: ["a"] },
          },
        },
      },
    });

    const result = await pending;
    expect(result.type).toBe("task-graph.node.completed");
    expect(result.nodeId).toBe("a");
    expect(result.graph.nodes.a.status).toBe("completed");
  });

  it("background task helpers send the correct message types", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    bridge.listBackgroundTasks().catch(() => undefined);
    bridge.getBackgroundTask("task-1").catch(() => undefined);
    bridge
      .getBackgroundTaskHistory("task-1", { limit: 20, offset: 0 })
      .catch(() => undefined);
    bridge.stopBackgroundTask("task-1").catch(() => undefined);

    for (let i = 0; i < 10 && mockWs.sent.length < 4; i += 1) {
      await Promise.resolve();
    }
    const types = mockWs.sent.map((raw) => JSON.parse(raw).type);
    expect(types).toEqual([
      "tasks-list",
      "tasks-detail",
      "tasks-history",
      "tasks-stop",
    ]);
  });

  it("shutdown rejects pending and kills the server process", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();

    const pending = bridge.request("session-create", {}, ["session-created"]);
    for (let i = 0; i < 5 && bridge.pending.size === 0; i += 1) {
      await Promise.resolve();
    }
    expect(bridge.pending.size).toBe(1);

    await bridge.shutdown();

    await expect(pending).rejects.toThrow(/shutting down/);
    expect(bridge.pending.size).toBe(0);
    expect(bridge.connected).toBe(false);
    expect(mockProcess.killed).toBe(true);
  });

  it("invalid websocket payload emits an error event", async () => {
    const bridge = new CodingAgentBridge({ cwd: "/repo" });
    await bridge.ensureReady();
    const errors = [];
    bridge.on("error", (e) => errors.push(e));

    mockWs.emit("message", "not-json");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("INVALID_WS_MESSAGE");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Unified envelope protocol v1.0 — added with envelope migration
  // ─────────────────────────────────────────────────────────────────────

  describe("unified envelope protocol v1.0", () => {
    it("detects envelope, correlates by requestId, and unwraps payload", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.request("session-create", {}, [
        "session.started",
        "session-created",
      ]);
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-abc-123",
        type: "session.started",
        requestId: sent.id,
        sessionId: "sess-1",
        source: "cli-runtime",
        payload: {
          sessionId: "sess-1",
          sessionType: "agent",
          record: { id: "sess-1", status: "created" },
        },
      });

      const result = await promise;
      // Payload spread into flat shape
      expect(result.sessionId).toBe("sess-1");
      expect(result.sessionType).toBe("agent");
      expect(result.record).toEqual({ id: "sess-1", status: "created" });
      // Type from envelope.type, id reconstructed from requestId
      expect(result.type).toBe("session.started");
      expect(result.id).toBe(sent.id);
      // Original envelope preserved under _envelope
      expect(result._envelope).toBeDefined();
      expect(result._envelope.eventId).toBe("evt-abc-123");
      expect(result._envelope.source).toBe("cli-runtime");
      expect(bridge.pending.size).toBe(0);
    });

    it("rejects with payload.message when envelope has type=error", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.request("session-create", {}, ["session.started"]);
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-err-1",
        type: "error",
        requestId: sent.id,
        sessionId: null,
        source: "cli-runtime",
        payload: {
          code: "SESSION_CREATE_FAILED",
          message: "provider not configured",
        },
      });

      await expect(promise).rejects.toThrow("provider not configured");
      expect(bridge.pending.size).toBe(0);
    });

    it("falls back to error code when envelope error has no message", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.request("session-create", {}, ["session.started"]);
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-err-2",
        type: "error",
        requestId: sent.id,
        source: "cli-runtime",
        payload: { code: "NO_SESSION_SUPPORT" },
      });

      await expect(promise).rejects.toThrow("NO_SESSION_SUPPORT");
    });

    it("dual awaitTypes — accepts unified type when CLI emits envelope", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.listSessions();
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-list-1",
        type: "session.list",
        requestId: sent.id,
        source: "cli-runtime",
        payload: { sessions: [{ id: "s-1" }, { id: "s-2" }] },
      });

      const result = await promise;
      expect(result.sessions).toHaveLength(2);
      expect(result.type).toBe("session.list");
    });

    it("dual awaitTypes — accepts legacy type for graceful migration", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.listSessions();
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      // Legacy raw shape (no envelope)
      mockWs.triggerMessage({
        id: sent.id,
        type: "session-list-result",
        sessions: [{ id: "legacy-1" }],
      });

      const result = await promise;
      expect(result.sessions).toEqual([{ id: "legacy-1" }]);
      expect(result.type).toBe("session-list-result");
      // Legacy shape — no _envelope wrapper
      expect(result._envelope).toBeUndefined();
    });

    it("ignores envelope whose type is NOT in awaitTypes (stays pending)", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.request("session-create", {}, ["session.started"]);
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      // Envelope arrives with mismatched type
      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-other",
        type: "assistant.delta",
        requestId: sent.id,
        source: "cli-runtime",
        payload: { delta: "..." },
      });
      expect(bridge.pending.size).toBe(1);

      // Real one
      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-real",
        type: "session.started",
        requestId: sent.id,
        source: "cli-runtime",
        payload: { sessionId: "ok" },
      });
      const result = await promise;
      expect(result.sessionId).toBe("ok");
      expect(bridge.pending.size).toBe(0);
    });

    it("malformed envelope (missing eventId) falls back to legacy id correlation", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();

      const promise = bridge.request("session-create", {}, ["session-created"]);
      await flushSend(mockWs);
      const sent = JSON.parse(mockWs.sent[0]);

      // version=1.0 + payload but missing eventId → not detected as envelope,
      // falls back to legacy correlation by `id`
      mockWs.triggerMessage({
        version: "1.0",
        type: "session-created",
        id: sent.id,
        sessionId: "fallback-1",
        payload: { ignored: true },
      });

      const result = await promise;
      expect(result.sessionId).toBe("fallback-1");
      expect(result._envelope).toBeUndefined();
    });

    it("envelope without matching pending entry only emits message event", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();
      const seen = [];
      bridge.on("message", (m) => seen.push(m));

      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-orphan",
        type: "assistant.final",
        requestId: "no-such-request",
        sessionId: "sess-x",
        source: "cli-runtime",
        payload: { content: "hello" },
      });

      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe("assistant.final");
      expect(bridge.pending.size).toBe(0);
    });

    it("orphan error envelope (no pending) does not throw — only emits", async () => {
      const bridge = new CodingAgentBridge({ cwd: "/repo" });
      await bridge.ensureReady();
      const seen = [];
      bridge.on("message", (m) => seen.push(m));

      // Should NOT throw or reject anything
      mockWs.triggerMessage({
        version: "1.0",
        eventId: "evt-err-orphan",
        type: "error",
        requestId: "no-pending",
        source: "cli-runtime",
        payload: { code: "BAD", message: "no listener" },
      });

      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe("error");
    });
  });
});
