/**
 * `/cost` REPL command — live in-memory token spend + estimated $ (Claude-Code
 * parity). Covers the accumulator (addUsage), the aggregate snapshot, and the
 * priced renderer (reusing llm-pricing, with config override support).
 */
import { describe, it, expect } from "vitest";
import {
  newCostStore,
  addUsage,
  costAggregate,
  renderSessionCost,
} from "../../src/repl/session-cost.js";

const ev = (provider, model, input, output) => ({
  provider,
  model,
  usage: { input_tokens: input, output_tokens: output },
});

describe("addUsage / costAggregate", () => {
  it("accumulates per provider/model across turns", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1000, 200)]);
    addUsage(s, [ev("anthropic", "claude-opus", 500, 100)]);
    addUsage(s, [ev("openai", "gpt-4o", 300, 50)]);
    const agg = costAggregate(s);
    expect(agg.total.calls).toBe(3);
    expect(agg.total.inputTokens).toBe(1800);
    expect(agg.total.outputTokens).toBe(350);
    // sorted by totalTokens desc → opus (1800) before gpt-4o (350)
    expect(agg.byModel[0].model).toBe("claude-opus");
    expect(agg.byModel[0].calls).toBe(2);
    expect(agg.byModel[0].inputTokens).toBe(1500);
    expect(agg.byModel[1].model).toBe("gpt-4o");
  });

  it("ignores zero-token events and supports token aliases", () => {
    const s = newCostStore();
    addUsage(s, [
      {
        provider: "x",
        model: "y",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
    addUsage(s, [
      {
        provider: "x",
        model: "y",
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
    ]);
    const agg = costAggregate(s);
    expect(agg.total.calls).toBe(1);
    expect(agg.total.inputTokens).toBe(10);
    expect(agg.total.outputTokens).toBe(4);
  });

  it("tolerates malformed / missing usage", () => {
    const s = newCostStore();
    addUsage(s, [{ provider: "a", model: "b" }, null, { usage: null }]);
    addUsage(s, undefined);
    expect(costAggregate(s).total.calls).toBe(0);
  });
});

describe("renderSessionCost", () => {
  it("reports nothing before any LLM call", () => {
    expect(renderSessionCost(newCostStore())).toContain("no LLM calls yet");
  });

  it("prices a known model (anthropic opus: 15/75 per 1M)", () => {
    const s = newCostStore();
    addUsage(s, [ev("anthropic", "claude-opus", 1_000_000, 1_000_000)]);
    const out = renderSessionCost(s);
    expect(out).toContain("Session cost (estimated):");
    // 1M in × $15 + 1M out × $75 = $90.0000
    expect(out).toContain("$90.0000");
    expect(out).toContain("anthropic");
    expect(out).toContain("in=1000000 out=1000000");
  });

  it("marks local providers free and unknown models unpriced", () => {
    const s = newCostStore();
    addUsage(s, [ev("ollama", "qwen2.5:7b", 500, 500)]);
    addUsage(s, [ev("mystery", "who-knows", 1000, 1000)]);
    const out = renderSessionCost(s);
    expect(out).toContain("free (local)");
    expect(out).toContain("unpriced");
    expect(out).toContain("no rate");
  });

  it("honors config.llm.pricing overrides", () => {
    const s = newCostStore();
    addUsage(s, [ev("mystery", "who-knows", 1_000_000, 0)]);
    const out = renderSessionCost(s, {
      pricingOverrides: { mystery: [{ match: "who-knows", in: 2, out: 8 }] },
    });
    expect(out).toContain("$2.0000"); // 1M input × $2
    expect(out).not.toContain("unpriced");
  });
});
