/**
 * Prompt-cache token cost accounting (Anthropic caching).
 *
 * When prompt caching is active, Anthropic splits input into uncached
 * `input_tokens` + `cache_read_input_tokens` (~10% of input price) +
 * `cache_creation_input_tokens` (~125%). This verifies the full pipeline —
 * extractUsage → aggregateUsage → estimateCost/priceRollup — tracks and prices
 * those tokens, while non-caching usage is priced exactly as before.
 */

import { describe, it, expect } from "vitest";
import { extractUsage, aggregateUsage } from "../../src/lib/session-usage.js";
import {
  estimateCost,
  priceRollup,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
} from "../../src/lib/llm-pricing.js";

describe("extractUsage — cache token capture", () => {
  it("reads cache read/creation tokens from an Anthropic usage event", () => {
    const u = extractUsage({
      type: "token_usage",
      timestamp: 1,
      data: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          cache_read_input_tokens: 1800,
          cache_creation_input_tokens: 400,
        },
      },
    });
    expect(u).toMatchObject({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 1800,
      cacheCreationTokens: 400,
    });
  });

  it("defaults cache tokens to 0 when absent (non-caching providers)", () => {
    const u = extractUsage({
      type: "token_usage",
      timestamp: 1,
      data: { provider: "openai", model: "gpt-5", usage: { input_tokens: 10 } },
    });
    expect(u.cacheReadTokens).toBe(0);
    expect(u.cacheCreationTokens).toBe(0);
  });
});

describe("aggregateUsage — cache token roll-up", () => {
  it("sums cache tokens into total and the per-model row", () => {
    const agg = aggregateUsage([
      {
        type: "token_usage",
        timestamp: 1,
        data: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 100,
          },
        },
      },
      {
        type: "token_usage",
        timestamp: 2,
        data: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 50,
            output_tokens: 10,
            cache_read_input_tokens: 950,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ]);
    expect(agg.total.cacheReadTokens).toBe(1850);
    expect(agg.total.cacheCreationTokens).toBe(100);
    expect(agg.byModel[0].cacheReadTokens).toBe(1850);
    expect(agg.byModel[0].cacheCreationTokens).toBe(100);
  });
});

describe("estimateCost — cache token pricing", () => {
  it("prices cache reads at ~10% and writes at ~125% of the input rate", () => {
    // sonnet input rate = $3 / 1M.
    const est = estimateCost({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    expect(est.inputCost).toBeCloseTo(3, 6);
    expect(est.cacheReadCost).toBeCloseTo(3 * CACHE_READ_MULTIPLIER, 6); // 0.30
    expect(est.cacheCreationCost).toBeCloseTo(3 * CACHE_WRITE_MULTIPLIER, 6); // 3.75
    expect(est.totalCost).toBeCloseTo(3 + 0.3 + 3.75, 6);
  });

  it("is byte-identical to the prior shape when no cache tokens are given", () => {
    const est = estimateCost({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // haiku: in=1, out=5
    expect(est.cacheReadCost).toBe(0);
    expect(est.cacheCreationCost).toBe(0);
    expect(est.totalCost).toBeCloseTo(1 + 5, 6);
  });

  it("caching is cheaper: a cached read costs ~10% of re-sending uncached", () => {
    const cached = estimateCost({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      cacheReadTokens: 1_000_000,
    }).totalCost;
    const uncached = estimateCost({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
    }).totalCost;
    expect(cached).toBeLessThan(uncached);
    expect(cached).toBeCloseTo(uncached * CACHE_READ_MULTIPLIER, 6);
  });
});

describe("priceRollup — cache costs flow into byModel rows", () => {
  it("includes cacheReadCost/cacheCreationCost per row and in the total", () => {
    const priced = priceRollup({
      total: {},
      byModel: [
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 2_000_000,
          cacheReadTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
        },
      ],
    });
    const row = priced.byModel[0];
    expect(row.cacheReadCost).toBeCloseTo(0.3, 6);
    expect(row.cacheCreationCost).toBeCloseTo(3.75, 6);
    expect(priced.cost.totalCost).toBeCloseTo(0.3 + 3.75, 6);
  });
});

describe("estimateCost — per-provider cache-read multipliers", () => {
  it("prices OpenAI cached reads at ~50% of the input rate", () => {
    // gpt-4o input rate = $2.5 / 1M.
    const est = estimateCost({
      provider: "openai",
      model: "gpt-4o",
      cacheReadTokens: 1_000_000,
    });
    expect(est.cacheReadCost).toBeCloseTo(2.5 * 0.5, 6); // 1.25
  });

  it("prices DeepSeek cache hits at ~25% of the input rate", () => {
    // deepseek-chat input rate = $0.27 / 1M.
    const est = estimateCost({
      provider: "deepseek",
      model: "deepseek-chat",
      cacheReadTokens: 1_000_000,
    });
    expect(est.cacheReadCost).toBeCloseTo(0.27 * 0.25, 6);
  });

  it("keeps Anthropic cached reads at ~10% (default)", () => {
    const est = estimateCost({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      cacheReadTokens: 1_000_000,
    });
    expect(est.cacheReadCost).toBeCloseTo(3 * 0.1, 6); // 0.30
  });
});
