/**
 * --replay-user-messages (echo stdin user events) and --max-budget-usd
 * (session-wide spend cap) in the streaming-input headless runner.
 * agentLoop / bootstrap / stdin are injected.
 */
import { describe, it, expect } from "vitest";
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
  });

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
  // Each turn's loop emits one $15 call (anthropic opus, 1M input).
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
      // two turns offered; cap $20 → first turn ($15) ok, second would exceed,
      // but the cap is folded per call: turn 1 spends $15 (< $20, completes);
      // turn 2 spends another $15 → total $30 ≥ $20 → stop.
      input: input({ text: "one" }, { text: "two" }),
    });
    const outcome = await runAgentHeadlessStream(
      { expandFileRefs: false, maxCostUsd: 20 },
      deps,
    );
    const events = parse(deps._lines);
    expect(events.some((e) => e.type === "cost_budget_exhausted")).toBe(true);
    const results = events.filter((e) => e.type === "result");
    expect(results.at(-1)).toMatchObject({ subtype: "error_max_budget" });
    expect(outcome.exitCode).toBe(1);
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
