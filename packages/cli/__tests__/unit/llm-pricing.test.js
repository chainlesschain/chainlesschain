import { describe, it, expect } from "vitest";
import {
  lookupRate,
  estimateCost,
  priceRollup,
  FREE_PROVIDERS,
} from "../../src/lib/llm-pricing.js";

describe("llm-pricing — lookupRate", () => {
  it("treats local providers as free", () => {
    for (const p of FREE_PROVIDERS) {
      expect(lookupRate(p, "anything")).toEqual({
        in: 0,
        out: 0,
        pattern: "free",
      });
    }
  });

  it("matches the most specific pattern first (gpt-4o-mini before gpt-4o)", () => {
    expect(lookupRate("openai", "gpt-4o-mini-2024").pattern).toBe(
      "gpt-4o-mini",
    );
    expect(lookupRate("openai", "gpt-4o-2024").pattern).toBe("gpt-4o");
  });

  it("is case-insensitive on provider and model", () => {
    expect(lookupRate("Anthropic", "Claude-3-OPUS").pattern).toBe("opus");
  });

  it("returns null for an unknown provider or model", () => {
    expect(lookupRate("mystery", "x")).toBeNull();
    expect(lookupRate("openai", "totally-unknown")).toBeNull();
  });
});

describe("llm-pricing — estimateCost", () => {
  it("computes input/output cost from MTok rates", () => {
    // sonnet = in 3 / out 15 per 1M
    const c = estimateCost({
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c.matched).toBe(true);
    expect(c.inputCost).toBeCloseTo(3, 6);
    expect(c.outputCost).toBeCloseTo(15, 6);
    expect(c.totalCost).toBeCloseTo(18, 6);
    expect(c.currency).toBe("USD");
  });

  it("local model costs nothing but is matched+free", () => {
    const c = estimateCost({
      provider: "ollama",
      model: "qwen2.5:7b",
      inputTokens: 5000,
      outputTokens: 5000,
    });
    expect(c.matched).toBe(true);
    expect(c.free).toBe(true);
    expect(c.totalCost).toBe(0);
  });

  it("unknown model → unmatched, zero cost (never guessed)", () => {
    const c = estimateCost({
      provider: "openai",
      model: "ghost-model",
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(c.matched).toBe(false);
    expect(c.totalCost).toBe(0);
    expect(c.rate).toBeNull();
  });
});

describe("llm-pricing — priceRollup", () => {
  it("sums priced rows and lists unpriced ones separately", () => {
    const aggregate = {
      total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
      byModel: [
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet",
          inputTokens: 1_000_000,
          outputTokens: 0,
          totalTokens: 1_000_000,
          calls: 1,
        },
        {
          provider: "openai",
          model: "ghost-model",
          inputTokens: 500,
          outputTokens: 500,
          totalTokens: 1000,
          calls: 1,
        },
      ],
    };
    const r = priceRollup(aggregate);
    expect(r.cost.totalCost).toBeCloseTo(3, 6); // only the sonnet row
    expect(r.cost.unpricedCount).toBe(1);
    expect(r.unpriced).toEqual([
      { provider: "openai", model: "ghost-model", totalTokens: 1000 },
    ]);
    // does not mutate input
    expect(aggregate.byModel[0].cost).toBeUndefined();
  });

  it("handles an empty aggregate", () => {
    const r = priceRollup({ total: {}, byModel: [] });
    expect(r.cost.totalCost).toBe(0);
    expect(r.byModel).toEqual([]);
    expect(r.unpriced).toEqual([]);
  });
});
