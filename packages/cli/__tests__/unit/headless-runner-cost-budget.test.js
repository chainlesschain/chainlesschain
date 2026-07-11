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

describe("runAgentHeadless --max-budget-usd", () => {
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
    // stopped before the second call / final response
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
  });

  it("no cap → unchanged completion", async () => {
    const { deps, out } = makeDeps(twoExpensiveCalls);
    const res = await runAgentHeadless(
      { prompt: "do work", outputFormat: "json", expandFileRefs: false },
      deps,
    );
    expect(res.isError).toBe(false);
    expect(envelope(out).subtype).toBe("success");
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
    expect(events.some((e) => e.type === "cost_budget_exhausted")).toBe(true);
    expect(events.at(-1)).toMatchObject({ subtype: "error_max_budget" });
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
