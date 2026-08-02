/**
 * --replay-user-messages (echo stdin user events) and --max-budget-usd
 * (session-wide spend cap) in the streaming-input headless runner.
 * agentLoop / bootstrap / stdin are injected.
 */
import { describe, it, expect, vi } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

const baseDeps = (over = {}) => {
  const lines = [];
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: (s) => lines.push(s),
    writeErr: () => {},
    _lines: lines,
    ...over,
  };
};
async function* input(...objs) {
  yield objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
}
const parse = (lines) =>
  lines
    .join("")
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("runAgentHeadlessStream --replay-user-messages", () => {
  it("echoes each accepted user message as a `user` event", async () => {
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "hello" }, { text: "world" }),
    });
    await runAgentHeadlessStream(
      { expandFileRefs: false, replayUserMessages: true },
      deps,
    );
    const events = parse(deps._lines);
    const echoes = events.filter((e) => e.type === "user");
    expect(echoes).toHaveLength(2);
    expect(echoes[0].message).toEqual({ role: "user", content: "hello" });
    expect(echoes[1].message).toEqual({ role: "user", content: "world" });
  }, 15000);

  it("does not echo without the flag", async () => {
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({ agentLoop, input: input({ text: "hi" }) });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    expect(parse(deps._lines).some((e) => e.type === "user")).toBe(false);
  });
});

describe("runAgentHeadlessStream --max-budget-usd", () => {
  // Each turn's loop emits one $5 call (anthropic opus 4.x, 1M input @ $5/M).
  const expensiveLoop = async function* () {
    yield {
      type: "token-usage",
      provider: "anthropic",
      model: "claude-opus",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    };
    yield { type: "response-complete", content: "done" };
    yield { type: "run-ended", reason: "complete" };
  };

  it("ends the session once the session-wide cap is reached", async () => {
    const deps = baseDeps({
      agentLoop: expensiveLoop,
      // two turns offered; cap $8, folded per call across the session: turn 1
      // spends $5 (< $8, completes); turn 2 spends another $5 → total $10 ≥ $8
      // → stop with a budget-exhausted result.
      input: input({ text: "one" }, { text: "two" }),
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, maxCostUsd: 8 },
      deps,
    );
    const events = parse(deps._lines);
    expect(events.some((e) => e.type === "cost_budget_exhausted")).toBe(true);
    const results = events.filter((e) => e.type === "result");
    expect(results.at(-1)).toMatchObject({ subtype: "error_max_budget" });
    expect(outcome.exitCode).toBe(1);
  });

  it("charges and labels semantic compaction usage", async () => {
    const compactionLoop = async function* () {
      yield {
        type: "token-usage",
        provider: "anthropic",
        model: "claude-opus",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
        source: "semantic-compaction",
      };
      yield { type: "response-complete", content: "should-not-finish" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop: compactionLoop,
      input: input({ text: "one" }),
    });

    await runAgentHeadlessStream(
      { expandFileRefs: false, maxCostUsd: 4 },
      deps,
    );
    const events = parse(deps._lines);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "token_usage",
        source: "semantic-compaction",
      }),
    );
    expect(
      events.filter((event) => event.type === "result").at(-1),
    ).toMatchObject({ subtype: "error_max_budget" });
  });

  it("no cap → both turns complete", async () => {
    const deps = baseDeps({
      agentLoop: expensiveLoop,
      input: input({ text: "one" }, { text: "two" }),
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      deps,
    );
    const results = parse(deps._lines).filter((e) => e.type === "result");
    expect(results).toHaveLength(2);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("runAgentHeadlessStream MCP recovery authority", () => {
  it("keeps the default synchronous wrapper on the verified projection path", async () => {
    const headHash = "a".repeat(64);
    const readVerifiedEvents = vi.fn(() => {
      throw new Error("legacy all-event reader must not run");
    });
    const readVerifiedProjection = vi.fn((_sessionId, createProjection) => {
      const projection = createProjection();
      projection.accept({
        type: "session_start",
        timestamp: 1,
        data: { title: "streamed" },
        prevHash: null,
        hash: headHash,
      });
      return projection.finish({
        headHash,
        eventCount: 1,
        readMessages: () => [],
      });
    });
    const deps = baseDeps({
      agentLoop: async function* () {
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
      input: input({ text: "continue" }),
      sessionExists: () => true,
      rebuildMessages: () => [],
      readEvents: () => [],
      readVerifiedEvents,
      readVerifiedProjection,
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendEvent: () => true,
      appendAuthorityEvent: () => true,
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, sessionId: "durable-session" },
      deps,
    );

    expect(outcome.exitCode).toBe(0);
    expect(readVerifiedProjection).toHaveBeenCalledTimes(1);
    expect(readVerifiedEvents).not.toHaveBeenCalled();
  });

  it("refuses the entire stream host when verified reading fails", async () => {
    const error = new Error("anchored transcript mismatch");
    error.code = "SESSION_TRANSCRIPT_UNVERIFIED";
    const agentLoop = vi.fn();
    const bootstrap = vi.fn(async () => ({ db: null }));
    const resolveAgentMcp = vi.fn(async () => null);
    const appendUserMessage = vi.fn();
    const deps = baseDeps({
      agentLoop,
      bootstrap,
      resolveAgentMcp,
      input: input({ text: "PRIVATE_UNVERIFIED_STREAM_INPUT" }),
      sessionExists: () => true,
      readEvents: () => [],
      readVerifiedEvents: () => {
        throw error;
      },
      appendUserMessage,
      appendAssistantMessage: () => {},
      appendEvent: () => true,
      appendAuthorityEvent: () => true,
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, sessionId: "durable-session" },
      deps,
    );

    expect(outcome).toEqual({ exitCode: 1, turns: 0 });
    expect(parse(deps._lines)).toContainEqual(
      expect.objectContaining({
        type: "result",
        subtype: "error_session_resume",
        code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
        session_id: "durable-session",
      }),
    );
    expect(JSON.stringify(parse(deps._lines))).not.toContain(
      "PRIVATE_UNVERIFIED_STREAM_INPUT",
    );
    expect(agentLoop).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(resolveAgentMcp).not.toHaveBeenCalled();
    expect(appendUserMessage).not.toHaveBeenCalled();
  });

  it("fails closed when session discovery fails before verified recovery", async () => {
    const agentLoop = vi.fn();
    const resolveAgentMcp = vi.fn(async () => null);
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "continue" }),
      resolveAgentMcp,
      sessionExists: () => {
        throw new Error("session index unavailable");
      },
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendAuthorityEvent: () => true,
      loadSideEffectLedger: () => null,
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, sessionId: "unknown-session" },
      deps,
    );

    expect(outcome.exitCode).toBe(1);
    expect(parse(deps._lines)).toContainEqual(
      expect.objectContaining({
        type: "result",
        subtype: "error_session_resume",
        code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
      }),
    );
    expect(agentLoop).not.toHaveBeenCalled();
    expect(resolveAgentMcp).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "sessionExists throws",
      store: {
        sessionExists: () => {
          throw new Error("session index unavailable");
        },
      },
    },
    {
      name: "sessionExists returns a rejected Promise",
      store: {
        sessionExists: () => Promise.reject(new Error("async discovery")),
      },
    },
    {
      name: "readVerifiedEvents throws",
      store: {
        readVerifiedEvents: () => {
          throw new Error("verified transcript unavailable");
        },
      },
    },
    {
      name: "readVerifiedEvents returns a rejected Promise",
      store: {
        readVerifiedEvents: () =>
          Promise.reject(new Error("async verified transcript")),
      },
    },
    {
      name: "verified projection returns a rejected Promise",
      store: {
        readVerifiedProjection: () =>
          Promise.reject(new Error("async verified projection")),
      },
    },
    {
      name: "verified projection readMessages throws",
      store: {
        readVerifiedProjection: (_sessionId, createProjection) => {
          const projection = createProjection();
          const headHash = "a".repeat(64);
          projection.accept({
            type: "session_start",
            timestamp: 1,
            data: { title: "broken projection" },
            prevHash: null,
            hash: headHash,
          });
          return projection.finish({
            headHash,
            eventCount: 1,
            readMessages: () => {
              throw new Error("message projection unavailable");
            },
          });
        },
      },
    },
    {
      name: "resume state returns a rejected Promise",
      store: {
        readSessionHostResumeState: () =>
          Promise.reject(new Error("async resume state")),
      },
    },
    {
      name: "resume state returns a Proxy",
      store: { readSessionHostResumeState: () => new Proxy({}, {}) },
    },
    {
      name: "resume state returns malformed messages",
      store: {
        readSessionHostResumeState: () => ({
          snapshot: {
            schema: "chainlesschain.session-host-snapshot/v1",
            schemaVersion: 1,
            verified: true,
            revision: "sha256:test",
          },
          messages: {},
          recovery: { unsettled: [], incidents: [] },
        }),
      },
    },
  ])("refuses the whole host when $name", async ({ store }) => {
    const agentLoop = vi.fn();
    const bootstrap = vi.fn(async () => ({ db: null }));
    const resolveAgentMcp = vi.fn(async () => null);
    const appendUserMessage = vi.fn();
    const deps = baseDeps({
      agentLoop,
      bootstrap,
      resolveAgentMcp,
      input: input({ text: "continue" }),
      sessionExists: () => true,
      readEvents: () => [],
      readVerifiedEvents: () => [],
      appendUserMessage,
      appendAssistantMessage: () => {},
      appendEvent: () => true,
      appendAuthorityEvent: () => true,
      loadSideEffectLedger: () => null,
      ...store,
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, sessionId: "durable-session" },
      deps,
    );

    expect(outcome).toEqual({ exitCode: 1, turns: 0 });
    expect(parse(deps._lines)).toContainEqual(
      expect.objectContaining({
        type: "result",
        subtype: "error_session_resume",
        code: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
      }),
    );
    expect(agentLoop).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(resolveAgentMcp).not.toHaveBeenCalled();
    expect(appendUserMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "startSession throws",
      store: {
        startSession: () => {
          throw new Error("session creation unavailable");
        },
      },
    },
    {
      name: "startSession returns a rejected Promise",
      store: {
        startSession: () => Promise.reject(new Error("async session creation")),
      },
    },
  ])("refuses model and MCP when $name", async ({ store }) => {
    const agentLoop = vi.fn();
    const resolveAgentMcp = vi.fn(async () => null);
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "continue" }),
      resolveAgentMcp,
      sessionExists: () => false,
      startSession: () => "durable-session",
      readEvents: () => [],
      readVerifiedEvents: () => [],
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendEvent: () => true,
      appendAuthorityEvent: () => true,
      loadSideEffectLedger: () => null,
      ...store,
    });

    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, sessionId: "durable-session" },
      deps,
    );

    expect(outcome.exitCode).toBe(1);
    expect(parse(deps._lines)).toContainEqual(
      expect.objectContaining({
        type: "result",
        subtype: "error_session_persistence",
        code: "CC_SESSION_PERSISTENCE_START_FAILED",
      }),
    );
    expect(agentLoop).not.toHaveBeenCalled();
    expect(resolveAgentMcp).not.toHaveBeenCalled();
  });
});

describe("runAgentHeadlessStream /compact (manual compaction, IDE parity)", () => {
  it("emits a compaction event when a {type:'compact'} control event arrives", async () => {
    const agentLoop = async function* () {
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      // one real turn, then a compact control event between turns
      input: input({ text: "hello" }, { type: "compact" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    const events = parse(deps._lines);
    const compaction = events.find((e) => e.type === "compaction");
    expect(compaction).toBeTruthy();
    expect(compaction.stats).toMatchObject({
      trimmed: expect.any(Number),
      saved: expect.any(Number),
    });
    expect(typeof compaction.messages_before).toBe("number");
    expect(typeof compaction.messages_after).toBe("number");
    // compaction never grows the history
    expect(compaction.messages_after).toBeLessThanOrEqual(
      compaction.messages_before,
    );
  });

  it("a compact event does not end the conversation (turns can follow)", async () => {
    let turns = 0;
    const agentLoop = async function* () {
      turns++;
      yield { type: "response-complete", content: `turn ${turns}` };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "one" }, { type: "compact" }, { text: "two" }),
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false },
      deps,
    );
    const results = parse(deps._lines).filter((e) => e.type === "result");
    expect(results).toHaveLength(2); // both user turns ran, compact between them
    expect(turns).toBe(2);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("runAgentHeadlessStream stream_retry (auto-retry notice, 2.1.181)", () => {
  it("emits a stream_retry event when the turn's model call auto-retries", async () => {
    // The real auto-retry happens inside chatWithTools (below the agentLoop
    // seam); here the injected loop stands in for it by invoking the
    // onStreamRetry hook the runner wired into the turn options.
    const agentLoop = async function* (_messages, options) {
      options.onStreamRetry?.(1);
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({ agentLoop, input: input({ text: "hi" }) });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    const retry = parse(deps._lines).find((e) => e.type === "stream_retry");
    expect(retry).toBeTruthy();
    expect(retry.attempt).toBe(1);
    expect(retry.message).toMatch(/retrying/i);
  });

  it("persists secret-free retry telemetry for a durable IDE session", async () => {
    const retries = [];
    const agentLoop = async function* (_messages, options) {
      const error = Object.assign(new Error("proxy secret=do-not-store"), {
        code: "ETIMEDOUT",
      });
      options.onStreamRetry?.(1, error, {
        durationMs: 4321,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop,
      input: input({ text: "hi" }),
      sessionExists: () => false,
      startSession: () => {},
      appendUserMessage: () => {},
      appendAssistantMessage: () => {},
      appendToolCallCompact: () => {},
      appendEvent: () => {},
      readEvents: () => [],
      rebuildMessages: () => [],
      appendLlmRetryCompact: (sessionId, record) =>
        retries.push({ sessionId, record }),
    });
    await runAgentHeadlessStream(
      {
        expandFileRefs: false,
        sessionId: "durable-session",
      },
      deps,
    );
    expect(retries).toEqual([
      {
        sessionId: "durable-session",
        record: {
          attempt: 1,
          durationMs: 4321,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          reason: "timeout",
        },
      },
    ]);
    expect(JSON.stringify(retries)).not.toContain("do-not-store");
  });
});

describe("runAgentHeadlessStream — prompt-cache tokens in result usage", () => {
  it("accumulates cache read/write tokens into the turn result envelope", async () => {
    const cacheLoop = async function* () {
      yield {
        type: "token-usage",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 1800,
          cache_creation_input_tokens: 200,
        },
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({
      agentLoop: cacheLoop,
      input: input({ text: "hi" }),
    });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    const result = parse(deps._lines)
      .filter((e) => e.type === "result")
      .at(-1);
    expect(result.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 1800,
      cache_creation_input_tokens: 200,
    });
    // The per-event token_usage carries the raw cache fields too.
    const tu = parse(deps._lines).find((e) => e.type === "token_usage");
    expect(tu.usage.cache_read_input_tokens).toBe(1800);
  });
});
