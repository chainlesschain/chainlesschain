/**
 * Integration: --max-budget-usd hard spend cap in runAgentHeadless.
 * A fake agentLoop emits token-usage events; the runner must stop before the
 * next paid call once the running cost crosses the cap and surface
 * subtype:error_max_budget. Bootstrap / approval gate / MCP are injected.
 */
import { describe, it, expect } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

function makeDeps(agentLoop) {
  const out = [];
  const err = [];
  return {
    deps: {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      resolveAgentMcp: async () => null,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      agentLoop,
    },
    out,
    err,
  };
}

const envelope = (out) => JSON.parse(out.join("").trim());

// $15 per call (anthropic opus = $15 / 1M input tokens).
async function* twoExpensiveCalls() {
  yield { type: "run-started", runId: "r" };
  yield {
    type: "token-usage",
    provider: "anthropic",
    model: "claude-opus",
    usage: { input_tokens: 1_000_000, output_tokens: 0 },
  };
  // If the cap worked, the runner stops before consuming anything below.
  yield {
    type: "token-usage",
    provider: "anthropic",
    model: "claude-opus",
    usage: { input_tokens: 1_000_000, output_tokens: 0 },
  };
  yield { type: "response-complete", content: "should-not-finish" };
  yield { type: "run-ended", runId: "r", reason: "complete" };
}

async function* expensiveCompactionThenReply() {
  yield {
    type: "token-usage",
    provider: "anthropic",
    model: "claude-opus",
    usage: { input_tokens: 1_000_000, output_tokens: 0 },
    source: "semantic-compaction",
  };
  yield { type: "response-complete", content: "should-not-finish" };
  yield { type: "run-ended", reason: "complete" };
}

async function* degradedCompaction() {
  yield {
    type: "compaction-degraded",
    reason: "invalid_llm_summary:invalid_json",
    summaryMode: "extractive-fallback",
  };
  yield { type: "response-complete", content: "fallback answer" };
  yield { type: "run-ended", reason: "complete" };
}

describe("runAgentHeadless --max-budget-usd", { timeout: 20_000 }, () => {
  it("stops at the cap with error_max_budget", async () => {
    const { deps, out } = makeDeps(twoExpensiveCalls);
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        maxCostUsd: 10, // first $15 call trips it
        expandFileRefs: false,
      },
      deps,
    );
    expect(res.isError).toBe(true);
    // Exit-code taxonomy (gap 2026-07-11): cost-cap stop → 4, not 1.
    expect(res.exitCode).toBe(4);
    const env = envelope(out);
    expect(env.subtype).toBe("error_max_budget");
    expect(env.total_cost_usd).toBeGreaterThan(0);
    // stopped before the second call / final response
    expect(env.result).not.toBe("should-not-finish");
  });

  it("charges semantic compaction usage before the next model call", async () => {
    const { deps, out } = makeDeps(expensiveCompactionThenReply);
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        maxCostUsd: 4,
        expandFileRefs: false,
      },
      deps,
    );

    expect(res.exitCode).toBe(4);
    const env = envelope(out);
    expect(env.subtype).toBe("error_max_budget");
    expect(env.usage.input_tokens).toBe(1_000_000);
    expect(env.result).not.toBe("should-not-finish");
  });

  it("does not trip when the cap is generous", async () => {
    const { deps, out } = makeDeps(twoExpensiveCalls);
    const res = await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "json",
        maxCostUsd: 1000,
        expandFileRefs: false,
      },
      deps,
    );
    expect(res.isError).toBe(false);
    const env = envelope(out);
    expect(env.subtype).toBe("success");
    expect(env.result).toBe("should-not-finish");
    expect(env.total_cost_usd).toBeGreaterThan(0);
  });

  it("no cap → unchanged completion", async () => {
    const { deps, out } = makeDeps(twoExpensiveCalls);
    const res = await runAgentHeadless(
      { prompt: "do work", outputFormat: "json", expandFileRefs: false },
      deps,
    );
    expect(res.isError).toBe(false);
    expect(envelope(out)).toMatchObject({ subtype: "success" });
    expect(envelope(out).total_cost_usd).toBeGreaterThan(0);
  });

  it("emits a stream cost_budget_exhausted event in stream-json", async () => {
    const { deps, out } = makeDeps(twoExpensiveCalls);
    await runAgentHeadless(
      {
        prompt: "do work",
        outputFormat: "stream-json",
        maxCostUsd: 10,
        expandFileRefs: false,
      },
      deps,
    );
    const events = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const exhausted = events.find((e) => e.type === "cost_budget_exhausted");
    expect(exhausted).toBeTruthy();
    expect(events.at(-1)).toMatchObject({ subtype: "error_max_budget" });
    expect(events.at(-1).total_cost_usd).toBe(exhausted.spent_usd);
  });

  it("emits priced DeepSeek V4 cost evidence in the stream result", async () => {
    async function* deepseekCall() {
      yield {
        type: "token-usage",
        provider: "volcengine",
        model: "deepseek-v4-flash-260425",
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      };
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    }
    const { deps, out } = makeDeps(deepseekCall);
    await runAgentHeadless(
      {
        prompt: "x",
        outputFormat: "stream-json",
        maxCostUsd: 10,
        expandFileRefs: false,
      },
      deps,
    );
    const events = out
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events.at(-1)).toMatchObject({
      type: "result",
      subtype: "success",
    });
    expect(events.at(-1).total_cost_usd).toBeCloseTo(0.42, 12);
  });

  it("warns (cost_warning) when the model is unpriced/free", async () => {
    async function* freeCall() {
      yield {
        type: "token-usage",
        provider: "ollama",
        model: "qwen2.5",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      };
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    }
    const { deps, out } = makeDeps(freeCall);
    await runAgentHeadless(
      {
        prompt: "x",
        outputFormat: "stream-json",
        maxCostUsd: 5,
        expandFileRefs: false,
      },
      deps,
    );
    const events = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(events.some((e) => e.type === "cost_warning")).toBe(true);
    // free model never trips the cap → still a success
    expect(events.at(-1)).toMatchObject({ subtype: "success" });
  });
});

describe("semantic compaction degradation visibility", () => {
  it("surfaces degradation on stderr in text mode", async () => {
    const { deps, out, err } = makeDeps(degradedCompaction);
    await runAgentHeadless(
      { prompt: "x", outputFormat: "text", expandFileRefs: false },
      deps,
    );

    expect(out.join("")).toContain("fallback answer");
    expect(err.join("")).toContain(
      "Semantic compaction degraded to extractive-fallback",
    );
  });

  it("includes degradation in the JSON result envelope", async () => {
    const { deps, out } = makeDeps(degradedCompaction);
    await runAgentHeadless(
      { prompt: "x", outputFormat: "json", expandFileRefs: false },
      deps,
    );

    expect(envelope(out).compaction_degradations).toEqual([
      {
        reason: "invalid_llm_summary:invalid_json",
        summary_mode: "extractive-fallback",
      },
    ]);
  });

  it("emits degradation and annotates the stream result", async () => {
    const { deps, out } = makeDeps(degradedCompaction);
    await runAgentHeadless(
      { prompt: "x", outputFormat: "stream-json", expandFileRefs: false },
      deps,
    );
    const events = out
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction-degraded",
        summaryMode: "extractive-fallback",
      }),
    );
    expect(events.at(-1).compaction_degradations).toHaveLength(1);
  });
});
