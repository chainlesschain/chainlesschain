import { describe, it, expect } from "vitest";
import {
  lookupRate,
  estimateCost,
  priceRollup,
  mergePricing,
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

  it("resolves the GPT-5 family without shadowing (5.5 not caught by 5)", () => {
    expect(lookupRate("openai", "gpt-5.5-pro").pattern).toBe("gpt-5.5-pro");
    expect(lookupRate("openai", "gpt-5.5-instant").pattern).toBe("gpt-5.5");
    expect(lookupRate("openai", "gpt-5.5-2026-04-23")).toMatchObject({
      in: 5,
      out: 30,
    });
    expect(lookupRate("openai", "gpt-5-mini").pattern).toBe("gpt-5-mini");
    expect(lookupRate("openai", "gpt-5-nano")).toMatchObject({
      in: 0.05,
      out: 0.4,
    });
    expect(lookupRate("openai", "gpt-5")).toMatchObject({ in: 1.25, out: 10 });
  });

  it("uses current Opus pricing ($5/$25) and prices Fable 5 / Opus 4.x snapshots", () => {
    // The Opus tier dropped to $5/$25 with Opus 4.5 — the table must NOT bill
    // the old $15/$75 for current Opus, or cc cost / /cost overcounts 3x.
    expect(lookupRate("anthropic", "claude-opus-4-8")).toMatchObject({
      in: 5,
      out: 25,
    });
    expect(lookupRate("anthropic", "claude-opus-4-7")).toMatchObject({
      in: 5,
      out: 25,
    });
    expect(lookupRate("anthropic", "claude-opus-4-6")).toMatchObject({
      in: 5,
      out: 25,
    });
    expect(lookupRate("anthropic", "claude-opus-4-5-20251101")).toMatchObject({
      in: 5,
      out: 25,
    });
    // bare "opus" defaults to the current price, not the retired $15/$75
    expect(lookupRate("anthropic", "claude-opus")).toMatchObject({
      in: 5,
      out: 25,
    });
    // the one deprecated-but-live $15/$75 snapshot keeps its real rate
    expect(lookupRate("anthropic", "claude-opus-4-1-20250805")).toMatchObject({
      in: 15,
      out: 75,
    });
    // Fable 5 ($10/$50) was previously unpriced
    expect(lookupRate("anthropic", "claude-fable-5")).toMatchObject({
      in: 10,
      out: 50,
    });
    // Sonnet / Haiku unchanged
    expect(lookupRate("anthropic", "claude-sonnet-4-6")).toMatchObject({
      in: 3,
      out: 15,
    });
    expect(lookupRate("anthropic", "claude-haiku-4-5")).toMatchObject({
      in: 1,
      out: 5,
    });
  });

  it("prices Doubao Seed 2.0 above the generic seed fallback", () => {
    // doubao-seed-2-0-lite-260215 must hit the 2.0 lite rate (out 0.5), not the
    // generic "seed" 0.28 that underprices 2.0 output by ~2x.
    expect(
      lookupRate("volcengine", "doubao-seed-2-0-lite-260215"),
    ).toMatchObject({ in: 0.08, out: 0.5 });
    expect(
      lookupRate("volcengine", "doubao-seed-2-0-mini-260215"),
    ).toMatchObject({ in: 0.03, out: 0.3 });
    expect(
      lookupRate("volcengine", "doubao-seed-2-0-pro-260215"),
    ).toMatchObject({ in: 0.5, out: 2.5 });
    // older 1.6 vision id still resolves to its own rate
    expect(
      lookupRate("volcengine", "doubao-seed-1-6-vision-250815").pattern,
    ).toBe("seed-1-6");
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

  it("threads a custom table through priceRollup", () => {
    const table = mergePricing({ mystery: [{ match: "x", in: 10, out: 0 }] });
    const r = priceRollup(
      {
        total: {},
        byModel: [
          {
            provider: "mystery",
            model: "x-1",
            inputTokens: 1_000_000,
            outputTokens: 0,
            totalTokens: 1_000_000,
            calls: 1,
          },
        ],
      },
      { table },
    );
    expect(r.cost.totalCost).toBeCloseTo(10, 6);
    expect(r.cost.unpricedCount).toBe(0);
  });
});

describe("llm-pricing — mergePricing (config overrides)", () => {
  it("adds a brand-new provider rate usable by lookupRate", () => {
    const table = mergePricing({
      myprovider: [{ match: "custom", in: 2, out: 8 }],
    });
    expect(lookupRate("myprovider", "custom-v1", table)).toEqual({
      in: 2,
      out: 8,
      pattern: "custom",
    });
    // built-in providers still present
    expect(lookupRate("openai", "gpt-4o", table).pattern).toBe("gpt-4o");
  });

  it("normalizes a mixed-case provider key so the override applies", () => {
    // lookupRate lowercases the provider; an override under "Anthropic"
    // must merge into the lowercase "anthropic" table, not a dead key.
    const table = mergePricing({
      Anthropic: [{ match: "claude-opus", in: 4, out: 20 }],
    });
    expect(lookupRate("anthropic", "claude-opus-4", table)).toMatchObject({
      in: 4,
      out: 20,
    });
    // and the original built-in table is untouched
    expect(lookupRate("anthropic", "claude-opus-4")).not.toMatchObject({
      in: 4,
      out: 20,
    });
  });

  it("a user entry replaces a built-in pattern of the same match", () => {
    const before = lookupRate("openai", "gpt-4o");
    expect(before).toMatchObject({ in: 2.5, out: 10 });
    const table = mergePricing({
      openai: [{ match: "gpt-4o", in: 99, out: 1 }],
    });
    expect(lookupRate("openai", "gpt-4o", table)).toMatchObject({
      in: 99,
      out: 1,
    });
    // does not mutate the built-in table (default lookup unchanged)
    expect(lookupRate("openai", "gpt-4o")).toMatchObject({ in: 2.5, out: 10 });
  });

  it("skips malformed override entries without throwing", () => {
    const table = mergePricing({
      openai: [
        { match: "", in: 1, out: 1 }, // empty match
        { match: "good", in: 5, out: 6 },
        { match: "bad", in: "NaN", out: 2 }, // non-numeric
        null,
      ],
    });
    expect(lookupRate("openai", "good-1", table)).toMatchObject({
      in: 5,
      out: 6,
    });
    expect(lookupRate("openai", "bad-1", table)).toBeNull();
  });

  it("rejects negative and Infinity rates (a price can't be < 0 or unbounded)", () => {
    const table = mergePricing({
      anthropic: [
        { match: "haiku", in: -5, out: 10 }, // negative input rate
        { match: "neg-out", in: 2, out: -1 }, // negative output rate
        { match: "inf", in: Infinity, out: 1 }, // unbounded
        { match: "ok", in: 4, out: 8 }, // valid → kept
      ],
    });
    // The negative haiku override is dropped → the built-in haiku rate stands.
    expect(lookupRate("anthropic", "claude-haiku", table)).toMatchObject({
      in: 1,
      out: 5,
    });
    // Other invalid entries never enter the table…
    expect(lookupRate("anthropic", "neg-out-x", table)).toBeNull();
    expect(lookupRate("anthropic", "inf-x", table)).toBeNull();
    // …and the one valid override does apply.
    expect(lookupRate("anthropic", "ok-x", table)).toMatchObject({
      in: 4,
      out: 8,
    });
  });

  it("returns the base table untouched when overrides are absent/invalid", () => {
    expect(lookupRate("openai", "gpt-4o", mergePricing()).pattern).toBe(
      "gpt-4o",
    );
    expect(lookupRate("openai", "gpt-4o", mergePricing("nope")).pattern).toBe(
      "gpt-4o",
    );
  });
});
