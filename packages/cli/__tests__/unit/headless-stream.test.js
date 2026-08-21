/**
 * Unit tests for the streaming-input headless runner (--input-format stream-json).
 * The agent loop, bootstrap, approval gate, and stdin are all injected, so the
 * multi-turn orchestration is tested without a real model, DB, or pipe.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  parseInputEvent,
  readJsonLines,
  runAgentHeadlessStream,
} from "../../src/runtime/headless-stream.js";
import { TurnBindingLog } from "../../src/lib/turn-binding.js";
import { TURN_BINDING_EVENT } from "../../src/lib/turn-binding-store.js";
import { currentHostHooksV2WorkspaceRoot } from "../../src/lib/hooks-v2-workspace-context.js";

function verifiedResume(messages, sessionId) {
  return {
    snapshot: {
      schema: "chainlesschain.session-host-snapshot/v1",
      schemaVersion: 1,
      sessionId,
      verified: true,
      revision: `sha256:${"a".repeat(64)}`,
    },
    messages,
    recovery: {
      sessionId,
      records: [],
      unsettled: [],
      incidents: [],
      adjudications: [],
      replayDenied: [],
      verified: true,
      headHash: "b".repeat(64),
      recoveryDigest: `sha256:${"c".repeat(64)}`,
      remediation: null,
    },
  };
}

describe("parseInputEvent", () => {
  it("returns null for blank lines", () => {
    expect(parseInputEvent("")).toBeNull();
    expect(parseInputEvent("   ")).toBeNull();
  });

  it("flags invalid JSON", () => {
    const r = parseInputEvent("{not json");
    expect(r.error).toMatch(/invalid JSON/);
  });

  it("parses {type:user, message:{content:'..'}}", () => {
    expect(
      parseInputEvent('{"type":"user","message":{"content":"hi"}}'),
    ).toEqual({
      text: "hi",
    });
  });

  it("parses content blocks array", () => {
    const line =
      '{"type":"user","message":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}';
    expect(parseInputEvent(line)).toEqual({ text: "ab" });
  });

  it("parses shorthand {text} and {prompt} and {role,content}", () => {
    expect(parseInputEvent('{"text":"x"}')).toEqual({ text: "x" });
    expect(parseInputEvent('{"prompt":"y"}')).toEqual({ text: "y" });
    expect(parseInputEvent('{"role":"user","content":"z"}')).toEqual({
      text: "z",
    });
  });

  it("returns null when content is empty/whitespace", () => {
    expect(parseInputEvent('{"text":"   "}')).toBeNull();
  });
});

describe("readJsonLines", () => {
  async function* src(...chunks) {
    for (const c of chunks) yield c;
  }
  it("splits a single chunk on newlines", async () => {
    const out = [];
    for await (const l of readJsonLines(src("a\nb\nc\n"))) out.push(l);
    expect(out).toEqual(["a", "b", "c"]);
  });
  it("reassembles lines spanning chunk boundaries", async () => {
    const out = [];
    for await (const l of readJsonLines(src("he", "llo\nwor", "ld\n")))
      out.push(l);
    expect(out).toEqual(["hello", "world"]);
  });
  it("flushes a trailing line with no final newline", async () => {
    const out = [];
    for await (const l of readJsonLines(src("a\nb"))) out.push(l);
    expect(out).toEqual(["a", "b"]);
  });
  it("reassembles a multi-byte UTF-8 char split across Buffer chunks (no mojibake)", async () => {
    // process.stdin yields Buffers; a 3-byte Chinese char split at a chunk
    // boundary must not corrupt into U+FFFD. `你` = bytes 9..11 of this line;
    // cut=10 splits it mid-character.
    const line = Buffer.from('{"text":"你好"}\n', "utf-8");
    const a = line.subarray(0, 10);
    const b = line.subarray(10);
    const out = [];
    for await (const l of readJsonLines(src(a, b))) out.push(l);
    expect(out).toEqual(['{"text":"你好"}']);
  });

  it("caps an over-long unterminated line instead of buffering it without bound", async () => {
    // A producer that streams a huge line with no newline must NOT accumulate
    // the whole thing in memory (OOM). With a tiny cap, the monster line is
    // truncated to a short head (surfaced as an invalid-JSON error by the
    // caller), not the full multi-chunk payload.
    const huge = "x".repeat(50);
    const out = [];
    for await (const l of readJsonLines(src(huge, huge, huge), {
      maxLineLength: 10,
    })) {
      out.push(l);
    }
    // Only the 200-char head is ever materialized (here ≤ the 150 chars sent).
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeLessThanOrEqual(200);
    expect(out[0]).toMatch(/^x+$/);
  });

  it("resyncs to the next well-formed line after an over-long line is dropped", async () => {
    // First chunk is an UNTERMINATED monster line → triggers overflow + head
    // emission. The newline that ends it (plus the next clean line) arrive in a
    // later chunk: the overflow tail is discarded up to that newline and the
    // follow-up line is parsed normally — the stream is not permanently wedged.
    const out = [];
    for await (const l of readJsonLines(
      src("x".repeat(50), 'tail-of-monster\n{"text":"ok"}\n'),
      { maxLineLength: 10 },
    )) {
      out.push(l);
    }
    // head of the monster line, then the clean follow-up line (its discarded
    // tail "tail-of-monster" never surfaces).
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^x+$/);
    expect(out[1]).toBe('{"text":"ok"}');
  });

  it("does not emit a dangling over-long line when the stream ends mid-overflow", async () => {
    const out = [];
    for await (const l of readJsonLines(src("x".repeat(50)), {
      maxLineLength: 10,
    })) {
      out.push(l);
    }
    // The 200-char head is emitted once; no second (final-flush) emission of the
    // unterminated remainder.
    expect(out).toHaveLength(1);
  });

  it("honors CC_MAX_INPUT_LINE_BYTES env when no explicit cap is given", async () => {
    const prev = process.env.CC_MAX_INPUT_LINE_BYTES;
    process.env.CC_MAX_INPUT_LINE_BYTES = "10";
    try {
      const out = [];
      for await (const l of readJsonLines(src("y".repeat(40)))) out.push(l);
      expect(out).toHaveLength(1);
      expect(out[0].length).toBeLessThanOrEqual(200);
    } finally {
      if (prev === undefined) delete process.env.CC_MAX_INPUT_LINE_BYTES;
      else process.env.CC_MAX_INPUT_LINE_BYTES = prev;
    }
  });
});

describe("runAgentHeadlessStream", () => {
  const baseDeps = (over = {}) => {
    const lines = [];
    return {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      _lines: lines,
      ...over,
    };
  };

  async function* input(...jsonObjs) {
    yield jsonObjs.map((o) => JSON.stringify(o)).join("\n") + "\n";
  }

  const parseEmitted = (lines) =>
    lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("wakes idle input and disconnects MCP after EPIPE", async () => {
    const previousExitCode = process.exitCode;
    const disconnectAll = vi.fn(async () => {});
    const disposePipeSafety = vi.fn();
    let closePipe;
    const liveInput = new PassThrough();
    liveInput.write(`${JSON.stringify({ type: "user", text: "go" })}\n`);
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
      queueMicrotask(closePipe);
    };
    const deps = baseDeps({
      agentLoop,
      input: liveInput,
      installPipeSafety: vi.fn((_streams, onEpipe) => {
        closePipe = onEpipe;
        return disposePipeSafety;
      }),
      resolveAgentMcp: async () => ({
        mcpClient: { callTool: vi.fn(), disconnectAll },
        connected: [],
        extraToolDefinitions: [],
        externalToolExecutors: {},
        externalToolDescriptors: {},
      }),
    });

    try {
      const outcome = await runAgentHeadlessStream(
        { expandFileRefs: false, settingsHooks: {} },
        deps,
      );

      expect(outcome).toEqual({ exitCode: 0, turns: 1 });
      expect(disconnectAll).toHaveBeenCalledOnce();
      expect(disposePipeSafety).toHaveBeenCalledOnce();
      expect(liveInput.destroyed).toBe(true);
      expect(parseEmitted(deps._lines).at(-1)).not.toMatchObject({
        type: "system",
        subtype: "end",
      });
    } finally {
      process.exitCode = previousExitCode;
    }
  }, 45_000);

  it("runs top-level cleanup when MCP post-connect setup throws", async () => {
    const liveInput = new PassThrough();
    const disconnectAll = vi.fn(async () => {
      throw new Error("disconnect also failed");
    });
    const runObserveHooks = vi.fn();
    const flush = vi.fn();
    const deps = baseDeps({
      input: liveInput,
      runObserveHooks,
      streamCoalescer: { emit: vi.fn(), flush },
      resolveAgentMcp: async () => ({
        mcpClient: {
          callTool: vi.fn(),
          disconnectAll,
          on: vi.fn(),
          setElicitationHandler() {
            throw new Error("elicitation setup failed");
          },
        },
        connected: [],
        extraToolDefinitions: [],
        externalToolExecutors: {},
        externalToolDescriptors: {},
      }),
    });

    await expect(
      runAgentHeadlessStream(
        {
          expandFileRefs: false,
          interactiveQuestions: true,
          settingsHooks: {},
        },
        deps,
      ),
    ).rejects.toThrow("elicitation setup failed");

    expect(liveInput.destroyed).toBe(true);
    expect(flush).toHaveBeenCalledOnce();
    expect(disconnectAll).toHaveBeenCalledOnce();
    expect(runObserveHooks).toHaveBeenCalledWith(
      {},
      "SessionEnd",
      expect.objectContaining({ reason: "error" }),
      expect.any(Object),
    );
  }, 15_000);

  it("bounds a hung cleanup step and still starts later disposers", async () => {
    const runObserveHooks = vi.fn();
    const cleanupReports = [];
    const disconnectAll = vi.fn(() => new Promise(() => {}));
    const deps = baseDeps({
      input: input(),
      cleanupDeadlineMs: 20,
      onCleanupReport: (report) => cleanupReports.push(report),
      runObserveHooks,
      resolveAgentMcp: async () => ({
        mcpClient: { callTool: vi.fn(), disconnectAll },
        connected: [],
        extraToolDefinitions: [],
        externalToolExecutors: {},
        externalToolDescriptors: {},
      }),
    });

    await expect(
      runAgentHeadlessStream(
        { expandFileRefs: false, settingsHooks: {} },
        deps,
      ),
    ).rejects.toMatchObject({
      code: "CC_CLEANUP_DEADLINE_EXCEEDED",
      timeoutMs: 20,
      timedOutSteps: expect.arrayContaining(["mcp"]),
    });

    expect(disconnectAll).toHaveBeenCalledOnce();
    expect(runObserveHooks).toHaveBeenCalledWith(
      {},
      "SessionEnd",
      expect.objectContaining({ reason: "stdin_closed" }),
      expect.any(Object),
    );
    expect(cleanupReports).toHaveLength(1);
    expect(cleanupReports[0]).toMatchObject({
      label: "headless-stream-cleanup",
      timeoutMs: 20,
      timedOut: true,
    });
  });

  it("keeps a primary setup failure when cleanup also times out", async () => {
    const cleanupReports = [];
    const deps = baseDeps({
      input: input(),
      cleanupDeadlineMs: 15,
      onCleanupReport: (report) => cleanupReports.push(report),
      resolveAgentMcp: async () => ({
        mcpClient: {
          callTool: vi.fn(),
          disconnectAll: vi.fn(() => new Promise(() => {})),
          on: vi.fn(),
          setElicitationHandler() {
            throw new Error("primary elicitation failure");
          },
        },
        connected: [],
        extraToolDefinitions: [],
        externalToolExecutors: {},
        externalToolDescriptors: {},
      }),
    });

    await expect(
      runAgentHeadlessStream(
        { expandFileRefs: false, interactiveQuestions: true },
        deps,
      ),
    ).rejects.toThrow("primary elicitation failure");
    expect(cleanupReports).toHaveLength(1);
    expect(cleanupReports[0].timedOut).toBe(true);
  });

  it("retains remote approval ownership when pairing output throws", async () => {
    const close = vi.fn(async () => {});
    const emitted = [];
    const approvalGate = {
      setSessionPolicy: vi.fn(),
      setConfirmer: vi.fn(),
      setAuthorizationConsumer: vi.fn(),
      consumeAuthorization: vi.fn(async () => true),
    };
    const deps = baseDeps({
      input: input(),
      getApprovalGate: async () => approvalGate,
      resolveAgentMcp: async () => null,
      startHeadlessRemoteApproval: vi.fn(async () => ({
        pairing: {
          uri: "cc://pair/test",
          remoteSessionId: "remote-1",
          expiresAt: 123,
        },
        confirmer: vi.fn(),
        consumeAuthorization: vi.fn(async () => true),
        close,
      })),
      writeOut(line) {
        const event = JSON.parse(line);
        if (event.type === "remote_control" && event.subtype === "pairing") {
          throw new Error("pairing sink failed");
        }
        emitted.push(event);
      },
    });

    const outcome = await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        remoteControl: true,
        remoteControlAllowLan: true,
        settingsHooks: {},
      },
      deps,
    );

    expect(outcome).toEqual({ exitCode: 0, turns: 0 });
    expect(close).toHaveBeenCalledOnce();
    expect(deps.startHeadlessRemoteApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        allowLan: true,
      }),
    );
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "remote_control",
        subtype: "unavailable",
        error: "pairing sink failed",
      }),
    );
  }, 35_000);

  it("binds lifecycle hooks to the streaming CLI host cwd", async () => {
    const trustedRoot = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "stream-host-workspace-")),
    );
    const observedRoots = [];
    const agentLoop = async function* () {
      await Promise.resolve();
      observedRoots.push(currentHostHooksV2WorkspaceRoot());
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
      executeHooksV2Event: vi.fn(async () => {
        await Promise.resolve();
        observedRoots.push(currentHostHooksV2WorkspaceRoot());
        return {
          success: true,
          blocked: false,
          decision: "continue",
          results: [],
        };
      }),
    });

    try {
      const outcome = await runAgentHeadlessStream(
        { cwd: trustedRoot, expandFileRefs: false },
        deps,
      );

      expect(outcome).toEqual({ exitCode: 0, turns: 1 });
      expect(observedRoots.length).toBeGreaterThan(1);
      expect(new Set(observedRoots)).toEqual(new Set([trustedRoot]));
      expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
    } finally {
      rmSync(trustedRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("runs one turn per event, emitting init + per-turn result + end", async () => {
    const seen = [];
    const agentLoop = async function* (messages) {
      seen.push(messages.map((m) => m.role));
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      yield { type: "response-complete", content: "reply:" + lastUser.content };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input(
        { type: "user", message: { content: "first" } },
        { type: "user", text: "second" },
      ),
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      deps,
    );

    const events = parseEmitted(deps._lines);
    expect(events[0]).toMatchObject({
      type: "system",
      subtype: "init",
      input_format: "stream-json",
    });
    const results = events.filter((e) => e.type === "result");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      turn: 1,
      subtype: "success",
      result: "reply:first",
    });
    expect(results[1]).toMatchObject({
      turn: 2,
      subtype: "success",
      result: "reply:second",
    });
    expect(events.at(-1)).toMatchObject({
      type: "system",
      subtype: "end",
      turns: 2,
    });
    expect(outcome).toEqual({ exitCode: 0, turns: 2 });
  }, 15000);

  it("fails before the model when a persisted user turn hits EROFS", async () => {
    const agentLoop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
      yield { type: "run-ended", reason: "complete" };
    });
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {
        throw Object.assign(new Error("private path"), { code: "EROFS" });
      },
      appendAssistantMessage: () => {},
      appendEvent: () => {},
      readEvents: () => [],
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { sessionId: "stream-disk-erofs", expandFileRefs: false },
      deps,
    );

    expect(agentLoop).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      exitCode: 1,
      turns: 1,
      persistence: {
        fs_code: "EROFS",
        phase: "before-model",
        commit_state: "not-committed",
        retryable: false,
      },
    });
    const failure = parseEmitted(deps._lines).find(
      (event) => event.subtype === "error_persistence",
    );
    expect(failure).toMatchObject({
      is_error: true,
      persistence: {
        code: "CC_SESSION_PERSISTENCE_FAILED",
        fs_code: "EROFS",
        commit_state: "not-committed",
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private path");
  });

  it("reports unknown durability when assistant persistence hits ENOSPC", async () => {
    const agentLoop = vi.fn(async function* () {
      yield { type: "response-complete", content: "answer survives" };
      yield { type: "run-ended", reason: "complete" };
    });
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {
        throw Object.assign(new Error("private path"), { code: "ENOSPC" });
      },
      appendEvent: () => {},
      readEvents: () => [],
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { sessionId: "stream-disk-full", expandFileRefs: false },
      deps,
    );

    expect(outcome).toMatchObject({
      exitCode: 1,
      turns: 1,
      persistence: {
        fs_code: "ENOSPC",
        phase: "after-model",
        commit_state: "unknown",
        retryable: false,
      },
    });
    const failure = parseEmitted(deps._lines).find(
      (event) => event.subtype === "error_persistence",
    );
    expect(failure).toMatchObject({
      is_error: true,
      result: "answer survives",
      persistence: {
        code: "CC_SESSION_PERSISTENCE_FAILED",
        fs_code: "ENOSPC",
        commit_state: "unknown",
        retryable: false,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private path");
  });

  it("terminates the stream when a call-ledger append fails", async () => {
    let calls = 0;
    const agentLoop = async function* () {
      calls += 1;
      yield {
        type: "model-usage-started",
        callId: `call-${calls}`,
        provider: "openai",
        model: "gpt-4o",
        source: "model",
      };
      yield { type: "response-complete", content: "must not continue" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "first" }, { text: "second" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendEvent: (_id, type) => {
        if (type === "model_usage_started") {
          throw Object.assign(new Error("private path"), { code: "ENOSPC" });
        }
      },
      readEvents: () => [],
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { sessionId: "stream-ledger-full", expandFileRefs: false },
      deps,
    );

    expect(calls).toBe(1);
    expect(outcome).toMatchObject({
      exitCode: 1,
      turns: 1,
      persistence: { fs_code: "ENOSPC", phase: "after-model" },
    });
    const failure = parseEmitted(deps._lines).find(
      (event) => event.subtype === "error_persistence",
    );
    expect(JSON.stringify(failure)).not.toContain("private path");
  });

  it("persists child settlements synchronously and does not replay their writes", async () => {
    const usageWrites = [];
    const eventWrites = [];
    const agentLoop = async function* (_messages, options) {
      const known = {
        type: "token-usage",
        callId: "stream-child-known-1",
        provider: "openai",
        model: "gpt-4o-mini",
        source: "subagent",
        usage: { input_tokens: 13, output_tokens: 5 },
        attribution: { origin: "subagent", subagentId: "sub-stream-1" },
      };
      const unknown = {
        type: "model-usage-unknown",
        callId: "stream-child-unknown-1",
        provider: "openai",
        model: "gpt-4o-mini",
        source: "subagent",
        code: "provider_usage_missing",
      };
      options.onUsageSettlement(known);
      yield { ...known, ledgerPersisted: true };
      options.onUsageSettlement(unknown);
      yield { ...unknown, ledgerPersisted: true };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendTokenUsage: (...args) => usageWrites.push(args),
      appendEvent: (...args) => eventWrites.push(args),
      readEvents: () => [],
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { sessionId: "stream-child-settlement", expandFileRefs: false },
      deps,
    );

    expect(outcome).toEqual({ exitCode: 0, turns: 1 });
    expect(usageWrites).toEqual([
      [
        "stream-child-settlement",
        expect.objectContaining({ callId: "stream-child-known-1" }),
      ],
    ]);
    expect(
      eventWrites.filter(([, type]) => type === "model_usage_unknown"),
    ).toEqual([
      [
        "stream-child-settlement",
        "model_usage_unknown",
        expect.objectContaining({
          callId: "stream-child-unknown-1",
          code: "provider_usage_missing",
        }),
      ],
    ]);
    expect(
      parseEmitted(deps._lines).filter((event) => event.type === "token_usage"),
    ).toHaveLength(1);
  });

  it("threads autoCheckpoint into the loop options, keyed by sessionId", async () => {
    const captured = [];
    const agentLoop = async function* (_messages, loopOptions) {
      captured.push(loopOptions);
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        autoCheckpoint: true,
        sessionId: "sess-x",
        ephemeral: true,
      },
      deps,
    );
    expect(captured[0].autoCheckpoint).toBe(true);
    // agent-core falls back to sessionId, so the panel can `cc checkpoint
    // list -s <sessionId>` to find these snapshots.
    expect(captured[0].checkpointSession).toBe("sess-x");
  });

  it("auto-checkpoint stays OFF when not requested (no behavior change)", async () => {
    const captured = [];
    const agentLoop = async function* (_messages, loopOptions) {
      captured.push(loopOptions);
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    expect(captured[0].autoCheckpoint).toBe(false);
  });

  it("carries conversation history across turns", async () => {
    const seen = [];
    const agentLoop = async function* (messages) {
      seen.push(messages.map((m) => m.role));
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "one" }, { text: "two" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);

    // Turn 1: [system, user]. Turn 2: prior assistant + new user appended.
    expect(seen[0]).toEqual(["system", "user"]);
    expect(seen[1]).toEqual(["system", "user", "assistant", "user"]);
  });

  it("persists plugin/version attribution for extension-tier tool results", async () => {
    const compactCalls = [];
    const agentLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "custom_plugin_tool",
        args: { value: "x" },
      };
      yield {
        type: "tool-result",
        tool: "custom_plugin_tool",
        result: {
          ok: true,
          toolAttribution: {
            source: "plugin:review-suite",
            version: "1.4.0",
          },
        },
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "go" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendToolCallCompact: (_sessionId, record) => compactCalls.push(record),
      appendEvent: () => {},
      readEvents: () => [],
      rebuildMessages: () => [],
      loadSideEffectLedger: () => null,
    });

    await runAgentHeadlessStream(
      {
        sessionId: "stream-plugin-attribution",
        expandFileRefs: false,
      },
      deps,
    );

    expect(compactCalls).toEqual([
      expect.objectContaining({
        tool: "custom_plugin_tool",
        isError: false,
        plugin: "review-suite",
        pluginVersion: "1.4.0",
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("emits an error result for an invalid JSON line and keeps going", async () => {
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    async function* rawInput() {
      yield '{bad json\n{"text":"good"}\n';
    }
    const deps = baseDeps({ agentLoop, input: rawInput() });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      deps,
    );

    const events = parseEmitted(deps._lines);
    const errors = events.filter((e) => e.type === "result" && e.is_error);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/invalid JSON/);
    // the good line still produced a successful turn
    expect(
      events.some((e) => e.type === "result" && e.subtype === "success"),
    ).toBe(true);
    expect(outcome.exitCode).toBe(1); // a parse error → non-zero exit
  });

  it("reports max_turns when a turn exhausts its iteration budget", async () => {
    const agentLoop = async function* () {
      yield { type: "iteration-budget-exhausted", budget: 1 };
      yield { type: "run-ended", reason: "budget-exhausted" };
    };
    const deps = baseDeps({ agentLoop, input: input({ text: "go" }) });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, maxTurns: 1 },
      deps,
    );
    const events = parseEmitted(deps._lines);
    const result = events.find((e) => e.type === "result");
    expect(result).toMatchObject({
      subtype: "error_max_turns",
      is_error: true,
    });
    expect(outcome.exitCode).toBe(1);
  });

  it("expands @file refs in a streamed user event when enabled", async () => {
    const agentLoop = async function* (messages) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      yield { type: "response-complete", content: lastUser.content };
      yield { type: "run-ended", reason: "complete" };
    };
    const expandFileRefs = vi.fn(() => ({
      prompt: "look @x.js\n<file>injected</file>",
      refs: [{ rel: "x.js" }],
      warnings: [],
    }));
    const deps = baseDeps({
      agentLoop,
      expandFileRefs,
      input: input({ text: "look @x.js" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(expandFileRefs).toHaveBeenCalledOnce();
    const events = parseEmitted(deps._lines);
    const result = events.find((e) => e.type === "result");
    expect(result.result).toContain("injected");
  });
});

describe("runAgentHeadlessStream — custom slash-command macros (panel parity)", () => {
  const baseDeps = (over = {}) => {
    const lines = [];
    return {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      _lines: lines,
      ...over,
    };
  };
  async function* input(...objs) {
    yield objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
  }
  const captureUser = () => {
    const seen = [];
    const opts = [];
    return {
      seen,
      opts,
      agentLoop: async function* (messages, options) {
        seen.push(
          [...messages].reverse().find((m) => m.role === "user").content,
        );
        opts.push(options);
        yield { type: "response-complete", content: "ok" };
        yield { type: "run-ended", reason: "complete" };
      },
    };
  };
  const matchedMacro = (over = {}) => ({
    matched: true,
    promptText: "command body",
    warnings: [],
    name: "c",
    scope: "project",
    model: null,
    allowedTools: null,
    ...over,
  });

  it("expands a resolved /name macro and skips the @file pass for that turn", async () => {
    const { seen, agentLoop } = captureUser();
    const resolveSlashMacro = vi.fn(async () => ({
      matched: true,
      promptText: "EXPANDED: review the diff",
      warnings: [],
      name: "git:review",
      scope: "project",
    }));
    const expandFileRefs = vi.fn(async (p) => ({
      prompt: p + " [@]",
      warnings: [],
    }));
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro,
      expandFileRefs,
      input: input({ type: "user", text: "/git:review HEAD" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(resolveSlashMacro).toHaveBeenCalledOnce();
    expect(seen[0]).toBe("EXPANDED: review the diff"); // expanded, no @file suffix
    expect(expandFileRefs).not.toHaveBeenCalled();
  });

  it("leaves a non-slash turn untouched and still runs @file expansion", async () => {
    const { seen, agentLoop } = captureUser();
    const resolveSlashMacro = vi.fn();
    const expandFileRefs = vi.fn(async (p) => ({
      prompt: p + " [@]",
      warnings: [],
    }));
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro,
      expandFileRefs,
      input: input({ type: "user", text: "plain question" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(resolveSlashMacro).not.toHaveBeenCalled(); // not a /token
    expect(seen[0]).toBe("plain question [@]");
  });

  it("slashMacros:false disables expansion (literal /name reaches the loop)", async () => {
    const { seen, agentLoop } = captureUser();
    const resolveSlashMacro = vi.fn();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro,
      expandFileRefs: async (p) => ({ prompt: p, warnings: [] }),
      input: input({ type: "user", text: "/git:review" }),
    });
    await runAgentHeadlessStream({ slashMacros: false }, deps);
    expect(resolveSlashMacro).not.toHaveBeenCalled();
    expect(seen[0]).toBe("/git:review");
  });

  it("an unmatched /token falls through to @file expansion", async () => {
    const { seen, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () => ({
        matched: false,
        promptText: "/etc/hosts",
        warnings: [],
      }),
      expandFileRefs: async (p) => ({ prompt: p + " [@]", warnings: [] }),
      input: input({ type: "user", text: "/etc/hosts is broken" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(seen[0]).toBe("/etc/hosts is broken [@]");
  });

  it("applies a command's model: frontmatter to that turn's loopOptions", async () => {
    const { opts, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () => matchedMacro({ model: "claude-opus-4-8" }),
      input: input({ type: "user", text: "/deploy" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(opts[0].model).toBe("claude-opus-4-8");
  });

  it("applies a command's allowed-tools: frontmatter to that turn's loopOptions", async () => {
    const { opts, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () =>
        matchedMacro({ allowedTools: "read_file, search_files" }),
      input: input({ type: "user", text: "/audit" }),
    });
    await runAgentHeadlessStream({}, deps);
    expect(opts[0].enabledToolNames).toEqual(["read_file", "search_files"]);
  });

  it("a non-frontmatter turn keeps the base model/tools (no override)", async () => {
    const { opts, agentLoop } = captureUser();
    const deps = baseDeps({
      agentLoop,
      resolveSlashMacro: async () => matchedMacro(), // matched, no model/tools
      input: input({ type: "user", text: "/plain" }),
    });
    await runAgentHeadlessStream({ model: "base-model" }, deps);
    expect(opts[0].model).toBe("base-model"); // unchanged
    expect(opts[0].enabledToolNames).toBeNull(); // base (no allow-list)
  });

  // ── Additive protocol-v1 stream fields (PROTOCOL.md §1.2.1) ───────────────

  const parseEmitted = (lines) =>
    lines
      .join("")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("stamps every output line with a strictly monotonic 1-based seq", async () => {
    const agentLoop = async function* () {
      yield { type: "tool-executing", tool: "read_file", args: { path: "a" } };
      yield { type: "tool-result", tool: "read_file", result: { ok: true } };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);

    const events = parseEmitted(deps._lines);
    // init … tool_use / tool_result / result … system end — EVERY line.
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.map((e) => e.seq)).toEqual(
      events.map((_, i) => i + 1), // 1, 2, 3, … with no gaps or repeats
    );
  });

  it("stamps a caller-supplied trace_id (sanitized) on every output line", async () => {
    const agentLoop = async function* () {
      yield { type: "tool-executing", tool: "read_file", args: { path: "a" } };
      yield { type: "tool-result", tool: "read_file", result: { ok: true } };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    // An IDE threads its own correlation id; an unsafe char is sanitized so the
    // NDJSON stays one token per line.
    await runAgentHeadlessStream(
      { expandFileRefs: false, traceId: "ide run\n42" },
      deps,
    );
    const events = parseEmitted(deps._lines);
    expect(events.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(events.map((e) => e.trace_id));
    expect(ids).toEqual(new Set(["iderun42"])); // one id, whole run
  });

  it("mints a per-run trace_id when none is supplied (uniform, tr- prefix)", async () => {
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    const events = parseEmitted(deps._lines);
    const ids = new Set(events.map((e) => e.trace_id));
    expect(ids.size).toBe(1); // same id on every line
    expect([...ids][0]).toMatch(/^tr-/);
  });

  it("pairs tool_use and tool_result with the same session-unique tu-<n> id", async () => {
    const agentLoop = async function* (messages) {
      const turn = messages.filter((m) => m.role === "user").length;
      yield {
        type: "tool-executing",
        tool: "read_file",
        args: { path: `f${turn}` },
      };
      yield { type: "tool-result", tool: "read_file", result: { ok: turn } };
      yield {
        type: "tool-executing",
        tool: "run_shell",
        args: { command: "ls" },
      };
      yield {
        type: "tool-result",
        tool: "run_shell",
        error: "exit 1",
        result: null,
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input(
        { type: "user", text: "one" },
        { type: "user", text: "two" },
      ),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);

    const events = parseEmitted(deps._lines);
    const uses = events.filter((e) => e.type === "tool_use");
    const dones = events.filter((e) => e.type === "tool_result");
    expect(uses).toHaveLength(4); // 2 tools × 2 turns
    expect(dones).toHaveLength(4);
    // Each result carries the id of the tool_use it settles…
    expect(uses.map((u) => u.id)).toEqual(dones.map((d) => d.id));
    // …and ids are session-unique across turns (counter never resets).
    expect(uses.map((u) => u.id)).toEqual(["tu-1", "tu-2", "tu-3", "tu-4"]);
  });

  it("preserves provider tool_use_id instead of synthesizing a stream id", async () => {
    const agentLoop = async function* () {
      yield {
        type: "tool-executing",
        tool: "read_file",
        args: { path: "a" },
        tool_use_id: "provider-call-9",
      };
      yield {
        type: "tool-result",
        tool: "read_file",
        result: { ok: true },
        tool_use_id: "provider-call-9",
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);

    const events = parseEmitted(deps._lines);
    expect(events.find((event) => event.type === "tool_use")?.id).toBe(
      "provider-call-9",
    );
    expect(events.find((event) => event.type === "tool_result")?.id).toBe(
      "provider-call-9",
    );
  });

  it("pairs interleaved tool latency by provider id", async () => {
    const compactCalls = [];
    const ticks = [0, 10, 20, 50, 80];
    const agentLoop = async function* () {
      yield {
        type: "tool-executing",
        tool_use_id: "parallel-a",
        tool: "read_file",
        args: { path: "a" },
      };
      yield {
        type: "tool-executing",
        tool_use_id: "parallel-b",
        tool: "list_dir",
        args: { path: "." },
      };
      yield {
        type: "tool-result",
        tool_use_id: "parallel-a",
        tool: "read_file",
        result: { ok: true },
      };
      yield {
        type: "tool-result",
        tool_use_id: "parallel-b",
        tool: "list_dir",
        result: { ok: true },
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ type: "user", text: "go" }),
      now: () => ticks.shift(),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendToolCallCompact: (_sessionId, record) => compactCalls.push(record),
      appendEvent: () => {},
      readEvents: () => [],
      rebuildMessages: () => [],
      loadSideEffectLedger: () => null,
    });

    await runAgentHeadlessStream(
      { sessionId: "stream-parallel-tools", expandFileRefs: false },
      deps,
    );

    expect(compactCalls).toEqual([
      expect.objectContaining({
        id: "parallel-a",
        tool: "read_file",
        durationMs: 40,
      }),
      expect.objectContaining({
        id: "parallel-b",
        tool: "list_dir",
        durationMs: 60,
      }),
    ]);
  });

  it("persists stream turn bindings with provider ids and tool-free coverage", async () => {
    const snapshots = [];
    let turn = 0;
    const agentLoop = async function* () {
      turn += 1;
      if (turn === 1) {
        yield {
          type: "tool-executing",
          tool: "read_file",
          args: { path: "a" },
          tool_use_id: "provider-stream-call-1",
        };
        yield {
          type: "tool-result",
          tool: "read_file",
          result: { ok: true },
          tool_use_id: "provider-stream-call-1",
        };
      }
      yield { type: "response-complete", content: `done-${turn}` };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input(
        { type: "user", text: "one" },
        { type: "user", text: "two" },
      ),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      rebuildMessages: () => [],
      readEvents: () => [],
      appendEvent: (sessionId, type, data) =>
        snapshots.push({ sessionId, type, data }),
      loadSideEffectLedger: () => null,
    });

    await runAgentHeadlessStream(
      {
        sessionId: "stream-binding-session",
        expandFileRefs: false,
      },
      deps,
    );

    const turnBindingSnapshots = snapshots.filter(
      (entry) => entry.type === TURN_BINDING_EVENT,
    );
    expect(turnBindingSnapshots).toHaveLength(2);
    expect(
      turnBindingSnapshots.every((entry) => entry.type === TURN_BINDING_EVENT),
    ).toBe(true);
    const turns = TurnBindingLog.fromJSON(
      turnBindingSnapshots.at(-1).data,
    ).list();
    expect(turns).toHaveLength(2);
    expect(turns[0].toolCallIds).toEqual(["provider-stream-call-1"]);
    expect(turns[1].toolCallIds).toEqual([]);
    expect(turns[1].coverage).toBe("full");
  });

  it("stops the stream when a critical turn-binding snapshot cannot persist", async () => {
    const deps = baseDeps({
      agentLoop: async function* () {
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
      input: input({ type: "user", text: "one" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      rebuildMessages: () => [],
      readEvents: () => [],
      appendEvent: (_sessionId, type) => {
        if (type === TURN_BINDING_EVENT) {
          throw new Error("binding lock unavailable");
        }
      },
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      {
        sessionId: "stream-binding-session",
        expandFileRefs: false,
      },
      deps,
    );

    expect(outcome.exitCode).toBe(1);
    const events = parseEmitted(deps._lines);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "recovery_degraded",
          component: "turn_binding",
          error: expect.stringMatching(/binding lock unavailable/),
        }),
        expect.objectContaining({
          type: "result",
          subtype: "error",
          is_error: true,
          error: expect.stringMatching(/binding lock unavailable/),
        }),
      ]),
    );
  });

  it("does not start a turn when persisted turn bindings cannot be read", async () => {
    let loopStarted = false;
    const deps = baseDeps({
      agentLoop: async function* () {
        loopStarted = true;
        yield { type: "response-complete", content: "must-not-run" };
      },
      input: input({ type: "user", text: "one" }),
      sessionExists: () => true,
      readSessionHostResumeState: () =>
        verifiedResume([], "stream-binding-session"),
      readEvents: () => {
        throw new Error("binding transcript unreadable");
      },
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      {
        sessionId: "stream-binding-session",
        expandFileRefs: false,
      },
      deps,
    );

    expect(outcome.exitCode).toBe(1);
    expect(loopStarted).toBe(false);
    expect(
      parseEmitted(deps._lines).find(
        (event) =>
          event.type === "recovery_degraded" &&
          event.component === "turn_binding",
      )?.error,
    ).toMatch(/binding transcript unreadable/);
  });
});
