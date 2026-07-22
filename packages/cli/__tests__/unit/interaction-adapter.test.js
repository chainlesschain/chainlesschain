import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InteractionAdapter,
  TerminalInteractionAdapter,
  WebSocketInteractionAdapter,
} from "../../src/lib/interaction-adapter.js";

describe("InteractionAdapter (base class)", () => {
  it("askInput throws not implemented", async () => {
    const adapter = new InteractionAdapter();
    await expect(adapter.askInput("What?")).rejects.toThrow(
      "askInput not implemented",
    );
  });

  it("askSelect throws not implemented", async () => {
    const adapter = new InteractionAdapter();
    await expect(adapter.askSelect("Pick one", [])).rejects.toThrow(
      "askSelect not implemented",
    );
  });

  it("askConfirm throws not implemented", async () => {
    const adapter = new InteractionAdapter();
    await expect(adapter.askConfirm("Sure?")).rejects.toThrow(
      "askConfirm not implemented",
    );
  });

  it("emit is a no-op and does not throw", () => {
    const adapter = new InteractionAdapter();
    expect(() => adapter.emit("event", { foo: 1 })).not.toThrow();
  });
});

describe("TerminalInteractionAdapter", () => {
  let adapter;
  let mockPrompts;

  beforeEach(() => {
    adapter = new TerminalInteractionAdapter();
    mockPrompts = {
      askInput: vi.fn().mockResolvedValue("user input"),
      askSelect: vi.fn().mockResolvedValue("option-a"),
      askConfirm: vi.fn().mockResolvedValue(true),
    };
    // Inject mock prompts to skip dynamic import
    adapter._prompts = mockPrompts;
  });

  it("loads prompts lazily on first call", async () => {
    const fresh = new TerminalInteractionAdapter();
    expect(fresh._prompts).toBeNull();
    // After injecting, _loadPrompts returns the existing value
    fresh._prompts = mockPrompts;
    const loaded = await fresh._loadPrompts();
    expect(loaded).toBe(mockPrompts);
  });

  it("askInput delegates to prompts.askInput", async () => {
    const result = await adapter.askInput("Name?", { default: "Alice" });
    expect(mockPrompts.askInput).toHaveBeenCalledWith("Name?", "Alice");
    expect(result).toBe("user input");
  });

  it("askInput passes empty default when none provided", async () => {
    await adapter.askInput("Name?");
    expect(mockPrompts.askInput).toHaveBeenCalledWith("Name?", "");
  });

  it("askSelect delegates to prompts.askSelect", async () => {
    const choices = [
      { name: "A", value: "a" },
      { name: "B", value: "b" },
    ];
    const result = await adapter.askSelect("Pick:", choices);
    expect(mockPrompts.askSelect).toHaveBeenCalledWith("Pick:", choices);
    expect(result).toBe("option-a");
  });

  it("askConfirm delegates to prompts.askConfirm", async () => {
    const result = await adapter.askConfirm("Sure?", false);
    expect(mockPrompts.askConfirm).toHaveBeenCalledWith("Sure?", false);
    expect(result).toBe(true);
  });

  it("emit is a no-op", () => {
    expect(() => adapter.emit("some-event", { data: 1 })).not.toThrow();
  });
});

describe("WebSocketInteractionAdapter", () => {
  let ws;
  let adapter;

  beforeEach(() => {
    ws = {
      readyState: 1,
      OPEN: 1,
      send: vi.fn(),
    };
    adapter = new WebSocketInteractionAdapter(ws, "session-123");
  });

  afterEach(() => {
    // Clear any pending timeouts
    adapter._pending.clear();
  });

  it("constructor sets ws and sessionId", () => {
    expect(adapter.ws).toBe(ws);
    expect(adapter.sessionId).toBe("session-123");
    expect(adapter._pending).toBeInstanceOf(Map);
    expect(adapter._pending.size).toBe(0);
  });

  it("askInput sends question message and waits for answer", async () => {
    const promise = adapter.askInput("Your name?", { default: "Bob" });

    // ws.send should have been called with a JSON question message
    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("question");
    expect(sent.sessionId).toBe("session-123");
    expect(sent.questionType).toBe("input");
    expect(sent.question).toBe("Your name?");
    expect(sent.default).toBe("Bob");

    // Resolve the pending question
    const requestId = sent.requestId;
    adapter.resolveAnswer(requestId, "Alice");

    const result = await promise;
    expect(result).toBe("Alice");
  });

  it("askElicitation sends schema metadata and accepts structured answers", async () => {
    const promise = adapter.askElicitation({
      server: "forms",
      requestId: 42,
      message: "Choose a color",
      requestedSchema: {
        type: "object",
        properties: { color: { type: "string" } },
      },
    });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("elicitation");
    expect(sent.metadata).toMatchObject({
      kind: "mcp_elicitation",
      server: "forms",
      requestId: 42,
    });
    expect(sent.requestedSchema.type).toBe("object");

    adapter.resolveAnswer(sent.requestId, { color: "blue" });
    await expect(promise).resolves.toEqual({ color: "blue" });
  });

  it("askSelect sends question with choices", async () => {
    const choices = [
      { name: "Red", value: "red" },
      { name: "Blue", value: "blue" },
    ];
    const promise = adapter.askSelect("Color?", choices);

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("select");
    expect(sent.choices).toEqual(choices);

    adapter.resolveAnswer(sent.requestId, "red");
    const result = await promise;
    expect(result).toBe("red");
  });

  it("askConfirm normalizes string 'true' to boolean true", async () => {
    const promise = adapter.askConfirm("Proceed?");

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("confirm");

    adapter.resolveAnswer(sent.requestId, "true");
    const result = await promise;
    expect(result).toBe(true);
  });

  it("askConfirm normalizes string 'yes' to boolean true", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, "yes");
    expect(await promise).toBe(true);
  });

  it("askConfirm normalizes string 'y' to boolean true", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, "y");
    expect(await promise).toBe(true);
  });

  it("askConfirm returns false for non-truthy string", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, "no");
    expect(await promise).toBe(false);
  });

  it("askConfirm passes through boolean value directly", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, false);
    expect(await promise).toBe(false);
  });

  // Approval binding (authority §"权限来源"): a request raised WITH a binding
  // rejects an approve whose echoed binding doesn't match — fail closed.
  it("rides the binding out on the request when supplied", async () => {
    const promise = adapter._request(
      { type: "question", questionType: "confirm", question: "Run?" },
      { kind: "question", binding: "ab_correct" },
    );
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.binding).toBe("ab_correct");
    adapter.resolveAnswer(sent.requestId, true, "ab_correct");
    expect(await promise).toBe(true);
  });

  it("rejects an approve whose echoed binding mismatches (→ deny)", async () => {
    const promise = adapter._request(
      { type: "question", questionType: "confirm", question: "Run?" },
      { kind: "question", binding: "ab_correct" },
    );
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, true, "ab_TAMPERED");
    expect(await promise).toBe(false); // forced deny, not the approve it claimed
  });

  it("honors an approve with no echoed binding (backward compatible)", async () => {
    const promise = adapter._request(
      { type: "question", questionType: "confirm", question: "Run?" },
      { kind: "question", binding: "ab_correct" },
    );
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    adapter.resolveAnswer(sent.requestId, true); // no binding echoed → unchanged
    expect(await promise).toBe(true);
  });

  it("adds no binding field to a plain question (byte-identical)", async () => {
    const promise = adapter.askConfirm("Proceed?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect("binding" in sent).toBe(false);
    adapter.resolveAnswer(sent.requestId, true);
    expect(await promise).toBe(true);
  });

  // askConfirm object-form: the public producer surface for permission gates —
  // rides the binding + structured extras out without reaching into _request.
  it("askConfirm object-form rides binding + approval context out", async () => {
    const promise = adapter.askConfirm("Approve run_shell: ls?", {
      default: false,
      binding: "ab_from_gate",
      approval: { tool: "run_shell", command: "ls", risk: "medium" },
    });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.questionType).toBe("confirm");
    expect(sent.default).toBe(false);
    expect(sent.binding).toBe("ab_from_gate");
    expect(sent.approval).toEqual({
      tool: "run_shell",
      command: "ls",
      risk: "medium",
    });
    // mismatched echo on the approve → forced deny (fail closed)
    adapter.resolveAnswer(sent.requestId, true, "ab_TAMPERED");
    expect(await promise).toBe(false);
  });

  it("askConfirm object-form without binding stays binding-free", async () => {
    const promise = adapter.askConfirm("Proceed?", { default: true });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect("binding" in sent).toBe(false);
    expect(sent.default).toBe(true);
    adapter.resolveAnswer(sent.requestId, true);
    expect(await promise).toBe(true);
  });

  it("resolveAnswer resolves pending promise", async () => {
    const promise = adapter.askInput("Q?");
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(adapter._pending.size).toBe(1);

    adapter.resolveAnswer(sent.requestId, "answer");
    await promise;
    expect(adapter._pending.size).toBe(0);
  });

  it("resolveAnswer ignores unknown requestId", () => {
    // Should not throw
    adapter.resolveAnswer("unknown-request-id", "answer");
    expect(adapter._pending.size).toBe(0);
  });

  // ─── host-tool requests + cross-type resolution guard ───────────────

  it("requestHostTool sends a host-tool-call and resolveHostTool settles it", async () => {
    const promise = adapter.requestHostTool("openDiff", { path: "a.js" });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("host-tool-call");
    expect(sent.toolName).toBe("openDiff");
    adapter.resolveHostTool(sent.requestId, { outcome: "accepted" });
    expect(await promise).toEqual({ outcome: "accepted" });
    expect(adapter._pending.size).toBe(0);
  });

  it("resolveAnswer does NOT settle a host-tool request (kind guard)", async () => {
    let settled = false;
    const promise = adapter.requestHostTool("openDiff", {}).then((v) => {
      settled = true;
      return v;
    });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    // A question-answer carrying the host-tool's requestId must be ignored…
    adapter.resolveAnswer(sent.requestId, "malicious-string");
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(adapter._pending.size).toBe(1); // still pending
    // …and the correct resolver still settles it with the real payload.
    adapter.resolveHostTool(sent.requestId, { outcome: "rejected" });
    expect(await promise).toEqual({ outcome: "rejected" });
  });

  it("resolveHostTool does NOT settle a question request (kind guard)", async () => {
    let settled = false;
    const promise = adapter.askInput("Name?").then((v) => {
      settled = true;
      return v;
    });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    // A host-tool payload carrying the question's requestId must be ignored…
    adapter.resolveHostTool(sent.requestId, { outcome: "accepted" });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(adapter._pending.size).toBe(1);
    // …the real answer (a string) still resolves it.
    adapter.resolveAnswer(sent.requestId, "Alice");
    expect(await promise).toBe("Alice");
  });

  it("rejectAllPending rejects both questions and host-tool calls + clears timers", async () => {
    const q = adapter.askInput("Q?").catch((e) => e);
    const h = adapter.requestHostTool("openDiff", {}).catch((e) => e);
    expect(adapter._pending.size).toBe(2);
    adapter.rejectAllPending(new Error("session closed"));
    expect(adapter._pending.size).toBe(0);
    expect((await q).message).toMatch(/session closed/);
    expect((await h).message).toMatch(/session closed/);
  });

  it("emit sends non-coding-agent events as raw shape (backward compat)", () => {
    adapter.emit("progress", { percent: 50 });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("progress");
    expect(sent.sessionId).toBe("session-123");
    expect(sent.percent).toBe(50);
    // Raw shape — no envelope fields
    expect(sent.version).toBeUndefined();
    expect(sent.eventId).toBeUndefined();
  });

  it("emit wraps coding-agent legacy types as unified envelope with cli-runtime source", () => {
    adapter.emit("tool-executing", {
      requestId: "req-42",
      tool: "edit_file",
      args: { path: "foo.js" },
      display: "edit_file foo.js",
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.version).toBe("1.0");
    expect(sent.type).toBe("tool.call.started");
    expect(sent.source).toBe("cli-runtime");
    expect(sent.sessionId).toBe("session-123");
    expect(sent.requestId).toBe("req-42");
    expect(sent.eventId).toEqual(expect.any(String));
    expect(sent.sequence).toBe(1);
    expect(sent.payload).toEqual({
      tool: "edit_file",
      args: { path: "foo.js" },
      display: "edit_file foo.js",
    });
    // Envelope should NOT contain raw top-level fields
    expect(sent.tool).toBeUndefined();
    expect(sent.args).toBeUndefined();
  });

  it("emit wraps coding-agent dot-case unified types as envelope", () => {
    adapter.emit("assistant.delta", {
      requestId: "req-7",
      text: "正在分析…",
    });

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe("assistant.delta");
    expect(sent.source).toBe("cli-runtime");
    expect(sent.requestId).toBe("req-7");
    expect(sent.payload).toEqual({ text: "正在分析…" });
  });

  it("Phase 5 envelope: opt-in flag doubles emission with run.* canonical shape", () => {
    const ws2 = {
      readyState: 1,
      OPEN: 1,
      send: vi.fn(),
    };
    const adapter2 = new WebSocketInteractionAdapter(ws2, "sess-p5", {
      enablePhase5Envelopes: true,
    });
    adapter2.emit("tool-executing", {
      requestId: "req-p5",
      tool: "read_file",
      args: { path: "a.txt" },
    });
    expect(ws2.send).toHaveBeenCalledTimes(2);
    const legacy = JSON.parse(ws2.send.mock.calls[0][0]);
    const env = JSON.parse(ws2.send.mock.calls[1][0]);
    expect(legacy.source).toBe("cli-runtime");
    expect(env.v).toBe(1);
    expect(env.type).toBe("run.tool_call");
    expect(env.sessionId).toBe("sess-p5");
    expect(env.requestId).toBe("req-p5");
  });

  it("Phase 5 envelope: default off — no extra ws.send", () => {
    adapter.emit("tool-executing", {
      requestId: "req-off",
      tool: "read_file",
      args: {},
    });
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("Phase 5 envelope: run-started / run-ended bookends map to run.started / run.ended", () => {
    const ws3 = { readyState: 1, OPEN: 1, send: vi.fn() };
    const adapter3 = new WebSocketInteractionAdapter(ws3, "sess-bookend", {
      enablePhase5Envelopes: true,
    });
    adapter3.emit("run-started", { runId: "r-1" });
    adapter3.emit("run-ended", { runId: "r-1", reason: "complete" });
    // Each bookend produces: legacy raw-shape send + Phase 5 envelope send.
    expect(ws3.send).toHaveBeenCalledTimes(4);
    const envs = ws3.send.mock.calls
      .map((c) => JSON.parse(c[0]))
      .filter((m) => m.v === 1);
    expect(envs).toHaveLength(2);
    expect(envs[0]).toMatchObject({
      v: 1,
      type: "run.started",
      sessionId: "sess-bookend",
      runId: "r-1",
    });
    expect(envs[1]).toMatchObject({
      v: 1,
      type: "run.ended",
      sessionId: "sess-bookend",
      runId: "r-1",
    });
    expect(envs[1].payload).toMatchObject({ reason: "complete" });
  });

  it("Phase 5 envelope: run-started bookend default off — legacy-only", () => {
    adapter.emit("run-started", { runId: "r-off" });
    // One legacy raw-shape send, no envelope
    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.v).toBeUndefined();
    expect(sent.type).toBe("run-started");
  });

  it("emit issues monotonically increasing sequences per requestId on same instance", () => {
    adapter.emit("tool-executing", { requestId: "req-A", tool: "x" });
    adapter.emit("tool-result", { requestId: "req-A", result: "ok" });
    adapter.emit("response-complete", { requestId: "req-A", content: "done" });
    adapter.emit("tool-executing", { requestId: "req-B", tool: "y" });

    const calls = ws.send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(calls[0].sequence).toBe(1);
    expect(calls[1].sequence).toBe(2);
    expect(calls[2].sequence).toBe(3);
    expect(calls[3].sequence).toBe(1); // new requestId resets sequence
  });

  it("emit falls back to adapter sessionId when payload omits it", () => {
    adapter.emit("response-complete", { content: "hi" });
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.sessionId).toBe("session-123");
    expect(sent.type).toBe("assistant.final");
  });

  it("_sendWs handles closed connection by not sending", () => {
    ws.readyState = 3; // CLOSED
    adapter._sendWs({ type: "test" });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("_sendWs handles send throwing without propagating", () => {
    ws.send.mockImplementation(() => {
      throw new Error("Connection reset");
    });
    // Should not throw
    expect(() => adapter._sendWs({ type: "test" })).not.toThrow();
  });

  it("question times out after 5 minutes", async () => {
    vi.useFakeTimers();

    const promise = adapter.askInput("Q?");

    // Advance time past 5 minute timeout
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(promise).rejects.toThrow("Question timed out");
    expect(adapter._pending.size).toBe(0);

    vi.useRealTimers();
  });
});
