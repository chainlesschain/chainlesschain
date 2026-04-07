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
});
