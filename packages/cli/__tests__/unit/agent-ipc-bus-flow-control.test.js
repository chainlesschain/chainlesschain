import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _deps,
  AGENT_IPC_DEFAULT_LIMITS,
  AgentIPCBus,
} from "../../src/lib/agent-ipc-bus.js";

const originalSpawn = _deps.spawn;

afterEach(() => {
  _deps.spawn = originalSpawn;
  vi.useRealTimers();
});

function fakeChild({ write = () => true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.destroyed = false;
  child.stdin.writableEnded = false;
  child.stdin.write = vi.fn(write);
  child.kill = vi.fn();
  child.exitCode = null;
  return child;
}

function initialize(child, id = "init-1") {
  child.stdout.emit(
    "data",
    Buffer.from(
      `${JSON.stringify({ jsonrpc: "2.0", id, method: "initialize" })}\n`,
    ),
  );
}

describe("AgentIPCBus bounded flow control", () => {
  it("publishes finite defaults and rejects invalid limits", () => {
    const bus = new AgentIPCBus();
    expect(bus.flowControlStatus()).toMatchObject({
      limits: AGENT_IPC_DEFAULT_LIMITS,
      activeAgents: 0,
      registeredAgents: 0,
      pendingInteractions: 0,
      pendingAgentRequests: 0,
      childTransports: [],
    });
    expect(() => new AgentIPCBus({ maxPendingInteractions: 0 })).toThrow(
      /positive safe integer/,
    );
  });

  it("bounds registered agents while allowing an in-place resolver refresh", () => {
    const bus = new AgentIPCBus({ maxAgents: 1 });
    const refreshed = vi.fn();
    bus.registerAgent("agent-a", vi.fn());
    bus.registerAgent("agent-a", refreshed);
    expect(bus.flowControlStatus().registeredAgents).toBe(1);
    let overload;
    try {
      bus.registerAgent("agent-b", vi.fn());
    } catch (error) {
      overload = error;
    }
    expect(overload).toMatchObject({
      code: "OVERLOADED",
      data: { resource: "registered_agents", limit: 1 },
    });
    bus.unregisterAgent("agent-a");
  });

  it("applies maxAgents across registered and starting child agents", async () => {
    _deps.spawn = vi.fn();
    const bus = new AgentIPCBus({ maxAgents: 1 });
    bus.registerAgent("agent-a", vi.fn());

    await expect(
      bus.spawnAgentProcess("agent", [], { agentId: "agent-b" }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      data: { resource: "active_agents", limit: 1 },
    });
    expect(_deps.spawn).not.toHaveBeenCalled();
    expect(bus.flowControlStatus().activeAgents).toBe(1);
    bus.unregisterAgent("agent-a");
  });

  it("bounds pending interactions globally and per agent", async () => {
    const bus = new AgentIPCBus({
      maxPendingInteractions: 2,
      maxPendingInteractionsPerAgent: 1,
    });
    const first = bus.requestInteraction("agent-a", {
      prompt: "first",
      timeoutMs: 10_000,
    });

    await expect(
      bus.requestInteraction("agent-a", {
        prompt: "same producer",
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      data: { resource: "pending_interactions_per_agent" },
    });

    const second = bus.requestInteraction("agent-b", {
      prompt: "second",
      timeoutMs: 10_000,
    });
    await expect(
      bus.requestInteraction("agent-c", {
        prompt: "global overflow",
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      data: { resource: "pending_interactions" },
    });

    const requests = bus.getPendingRequests();
    expect(requests).toHaveLength(2);
    bus.respond(requests[0].requestId, "one");
    bus.respond(requests[1].requestId, "two");
    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
    expect(bus.pendingCount).toBe(0);
  });

  it("clamps interaction timeouts to the configured finite maximum", async () => {
    const bus = new AgentIPCBus({
      interactionTimeoutMs: 50,
      maxInteractionTimeoutMs: 100,
    });
    const pending = bus.requestInteraction("agent-a", {
      prompt: "bounded timeout",
      timeoutMs: 10_000,
    });
    const request = bus.getPendingRequests()[0];

    expect(request.timeoutMs).toBe(100);
    bus.cancel(request.requestId);
    await expect(pending).rejects.toThrow(/cancelled/i);
  });

  it("bounds outbound requests and resolves them without listener growth", async () => {
    const sent = [];
    const child = fakeChild();
    const bus = new AgentIPCBus({
      maxPendingAgentRequests: 2,
      maxPendingAgentRequestsPerAgent: 1,
    });
    bus.registerAgent("agent-a", (message) => sent.push(message));

    const first = bus.sendRequest("agent-a", "inspect", {}, 10_000);
    await expect(
      bus.sendRequest("agent-a", "overflow", {}, 10_000),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      data: { resource: "pending_agent_requests_per_agent" },
    });
    expect(bus.listenerCount("agent:response")).toBe(0);
    expect(bus.flowControlStatus().pendingAgentRequests).toBe(1);

    bus._handleIncomingMessage(
      "agent-a",
      { jsonrpc: "2.0", id: sent[0].id, result: { ok: true } },
      child,
    );
    await expect(first).resolves.toEqual({ ok: true });
    expect(bus.flowControlStatus().pendingAgentRequests).toBe(0);
    bus.unregisterAgent("agent-a");
  });

  it("rejects pending outbound requests when an agent disconnects", async () => {
    const bus = new AgentIPCBus();
    bus.registerAgent("agent-a", () => {});
    const pending = bus.sendRequest("agent-a", "inspect", {}, 10_000);
    bus.unregisterAgent("agent-a");
    await expect(pending).rejects.toThrow(
      /disconnected while handling inspect/,
    );
    expect(bus.flowControlStatus().pendingAgentRequests).toBe(0);
  });

  it("fences outbound responses to the agent that owns the request", async () => {
    const sent = [];
    const child = fakeChild();
    const bus = new AgentIPCBus();
    bus.registerAgent("agent-a", (message) => sent.push(message));
    bus.registerAgent("agent-b", vi.fn());

    const pending = bus.sendRequest("agent-a", "inspect", {}, 10_000);
    bus._handleIncomingMessage(
      "agent-b",
      { jsonrpc: "2.0", id: sent[0].id, result: "wrong" },
      child,
    );
    expect(bus.flowControlStatus().pendingAgentRequests).toBe(1);
    bus._handleIncomingMessage(
      "agent-a",
      { jsonrpc: "2.0", id: sent[0].id, result: "right" },
      child,
    );

    await expect(pending).resolves.toBe("right");
    bus.unregisterAgent("agent-a");
    bus.unregisterAgent("agent-b");
  });

  it("kills a child before an incomplete stdout line exceeds its byte cap", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus({ maxStdoutLineBytes: 8 });
    const errors = [];
    bus.on("protocol:error", (event) => errors.push(event));

    const pending = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
    });
    child.stdout.emit("data", Buffer.from("123456789"));

    await expect(pending).rejects.toMatchObject({ code: "OVERLOADED" });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(errors[0]).toMatchObject({
      agentId: "agent-a",
      observedBytes: 9,
      error: { code: "OVERLOADED" },
    });
    expect(bus.flowControlStatus().childTransports).toEqual([]);
  });

  it("parses a JSON line when a multibyte code point is split across chunks", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();
    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
      heartbeatMs: 60_000,
    });
    const frame = Buffer.from(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "init-emoji",
        method: "initialize",
        label: "😀",
      })}\n`,
    );
    const emojiOffset = frame.indexOf(Buffer.from("😀"));

    child.stdout.emit("data", frame.subarray(0, emojiOffset + 1));
    child.stdout.emit("data", frame.subarray(emojiOffset + 1));
    await expect(spawned).resolves.toMatchObject({ agentId: "agent-a" });
    child.exitCode = 0;
    child.emit("exit", 0, null);
  });

  it("bounds stderr diagnostics while continuously draining the child pipe", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus({ maxStderrChunkBytes: 4 });
    const diagnostics = [];
    bus.on("agent:stderr", (event) => diagnostics.push(event));

    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
      captureStderr: false,
    });
    child.stderr.emit("data", Buffer.from("diagnostic"));
    initialize(child);
    await spawned;

    expect(diagnostics).toEqual([
      {
        agentId: "agent-a",
        data: "diag",
        observedBytes: 10,
        truncated: true,
      },
    ]);
    child.exitCode = 0;
    child.emit("exit", 0, null);
  });

  it("clamps initialization and heartbeat timers to finite configured maxima", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus({
      agentInitTimeoutMs: 10,
      maxAgentInitTimeoutMs: 20,
      agentHeartbeatMs: 10,
      maxAgentHeartbeatMs: 20,
    });
    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: Number.MAX_SAFE_INTEGER,
      heartbeatMs: Number.MAX_SAFE_INTEGER,
    });

    await vi.advanceTimersByTimeAsync(19);
    expect(child.kill).not.toHaveBeenCalled();
    initialize(child);
    await spawned;
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(19);
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.stdin.write).toHaveBeenCalledTimes(2);

    child.exitCode = 0;
    child.emit("exit", 0, null);
  });

  it("does not initialize from an invalid JSON-RPC notification", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();
    const pending = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 1,
    });
    child.stdout.emit(
      "data",
      Buffer.from(`${JSON.stringify({ method: "initialize" })}\n`),
    );
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).rejects.toThrow(/initialization timed out/);
    expect(bus.isAgentRegistered("agent-a")).toBe(false);
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it("terminates a child whose stdout stream fails", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();

    const pending = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
    });
    child.stdout.emit("error", new Error("stdout failed"));

    await expect(pending).rejects.toThrow(/stdout failed/);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(bus.flowControlStatus().childTransports).toEqual([]);
  });

  it("rejects and cleans up when a child exits before initialization", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();

    const pending = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
    });
    child.exitCode = 7;
    child.emit("exit", 7, null);

    await expect(pending).rejects.toThrow(/exited before initialization/);
    expect(bus.isAgentRegistered("agent-a")).toBe(false);
    expect(bus.flowControlStatus().childTransports).toEqual([]);
  });

  it("does not treat stdin close after process exit as overload", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();
    const errors = [];
    bus.on("protocol:error", (event) => errors.push(event));

    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
    });
    initialize(child);
    await spawned;
    child.exitCode = 0;
    child.stdin.emit("close");
    await Promise.resolve();
    child.emit("exit", 0, null);

    expect(child.kill).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("keeps a timed-out child fenced from late initialization", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus();
    const errors = [];
    bus.on("protocol:error", (event) => errors.push(event));

    const pending = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 1,
    });
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).rejects.toThrow(/initialization timed out/);
    initialize(child);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(bus.isAgentRegistered("agent-a")).toBe(false);
    expect(bus.flowControlStatus().childTransports).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("bounds queued stdin while a child applies backpressure", async () => {
    const child = fakeChild({
      write: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
    });
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus({
      maxStdinFrameBytes: 1024,
      maxStdinQueueMessages: 1,
      maxStdinQueueBytes: 1024,
    });
    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
      heartbeatMs: 60_000,
    });
    initialize(child);
    await spawned;

    const first = bus.sendRequest("agent-a", "first", {}, 10_000);
    const firstOutcome = first.catch((error) => error);
    expect(bus.flowControlStatus().childTransports[0]).toMatchObject({
      blocked: true,
      queuedMessages: 1,
    });

    await expect(
      bus.sendRequest("agent-a", "second", {}, 10_000),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      data: { resource: "stdin_queue_messages" },
    });
    await expect(firstOutcome).resolves.toMatchObject({
      message: expect.stringMatching(/disconnected while handling first/),
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(bus.flowControlStatus().childTransports).toEqual([]);
  });

  it("rejects an individual stdin frame before it enters Node's buffer", async () => {
    const child = fakeChild();
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus({ maxStdinFrameBytes: 8 });
    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
    });
    initialize(child);

    await expect(spawned).rejects.toMatchObject({
      code: "OVERLOADED",
      data: { resource: "stdin_frame_bytes", limit: 8 },
    });
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(bus.isAgentRegistered("agent-a")).toBe(false);
  });

  it("flushes a bounded stdin queue on drain", async () => {
    const child = fakeChild({
      write: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
    });
    _deps.spawn = vi.fn(() => child);
    const bus = new AgentIPCBus({ maxStdinQueueMessages: 2 });
    const spawned = bus.spawnAgentProcess("agent", [], {
      agentId: "agent-a",
      initTimeoutMs: 10_000,
      heartbeatMs: 60_000,
    });
    initialize(child);
    await spawned;

    const pending = bus.sendRequest("agent-a", "inspect", {}, 10_000);
    expect(bus.flowControlStatus().childTransports[0].queuedMessages).toBe(1);
    child.stdin.emit("drain");
    expect(bus.flowControlStatus().childTransports[0]).toMatchObject({
      blocked: false,
      queuedMessages: 0,
      queuedBytes: 0,
    });

    const request = JSON.parse(child.stdin.write.mock.calls[1][0]);
    bus._handleIncomingMessage(
      "agent-a",
      { jsonrpc: "2.0", id: request.id, result: "ok" },
      child,
    );
    await expect(pending).resolves.toBe("ok");
    child.exitCode = 0;
    child.emit("exit", 0, null);
    expect(child.stdin.listenerCount("drain")).toBe(0);
    expect(child.stdin.listenerCount("error")).toBe(0);
    expect(child.stdin.listenerCount("close")).toBe(0);
  });
});
