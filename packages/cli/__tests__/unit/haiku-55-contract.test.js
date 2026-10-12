import { describe, it, expect } from "vitest";
import { resolveModelCapabilityProfile } from "../../src/lib/model-capabilities.js";
import { haiku55ThinkingParams } from "../../src/lib/provider-options.js";
import {
  estimateCost,
  lookupRate,
  priceRollup,
} from "../../src/lib/llm-pricing.js";
import {
  aggregateUsage,
  allSessionsUsage,
  _deps,
} from "../../src/lib/session-usage.js";
import { CostBudget } from "../../src/lib/cost-budget.js";
import { _accumulateAnthropicStream } from "../../src/runtime/provider-stream-state.js";

const identity = { provider: "anthropic", model: "claude-haiku-5-5" };
const event = (usage) => ({
  type: "token_usage",
  data: { ...identity, usage },
});
const usage = (input = 1000) => ({
  inference_geo: "global",
  input_tokens: input,
  output_tokens: 1000,
  cache_read_input_tokens: 98000,
  cache_creation_input_tokens: 1000,
  cache_creation: {
    ephemeral_5m_input_tokens: 600,
    ephemeral_1h_input_tokens: 400,
  },
});

describe("Haiku 5.5 documented request and pricing contract (offline)", () => {
  it("uses exact official model metadata and preserves custom endpoint uncertainty", () => {
    expect(resolveModelCapabilityProfile(identity)).toMatchObject({
      contextWindowTokens: 1000000,
      advertisedMaxOutputTokens: 128000,
      requestMaxOutputTokens: 4096,
      defaultReasoningEffort: "medium",
      adaptiveThinkingDefault: true,
      runtimeVerified: false,
    });
    expect(
      resolveModelCapabilityProfile({
        ...identity,
        baseUrl: "https://example.com/v1",
      }),
    ).toMatchObject({ windowAssumed: true, advertisedMaxOutputTokens: null });
    expect(lookupRate("bedrock", identity.model)).toBeNull();
    expect(
      resolveModelCapabilityProfile({ ...identity, maxOutputTokens: 100000 })
        .requestMaxOutputTokens,
    ).toBe(100000);
    expect(
      resolveModelCapabilityProfile({ ...identity, maxOutputTokens: 300000 })
        .requestMaxOutputTokens,
    ).toBe(128000);
    for (const model of [
      "claude-haiku-5-5-future",
      "claude-haiku-6",
      "anthropic.claude-haiku-5-5",
      "haiku-5-5",
    ])
      expect(lookupRate("anthropic", model)).toBeNull();
    expect(lookupRate("anthropic", "claude-haiku-4-5-20251001")).toMatchObject({
      in: 1,
      out: 5,
    });
  });
  it("only emits adaptive thinking, validates effort, and rejects legacy budgets", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(
        haiku55ThinkingParams(identity.model, { thinkingEffort: effort }),
      ).toEqual({ thinking: { type: "adaptive" }, output_config: { effort } });
    }
    expect(haiku55ThinkingParams(identity.model).output_config.effort).toBe(
      "medium",
    );
    expect(haiku55ThinkingParams(identity.model, { thinking: false })).toEqual({
      thinking: { type: "disabled" },
      output_config: { effort: "medium" },
    });
    expect(() =>
      haiku55ThinkingParams(identity.model, {
        thinking: false,
        thinkingEffort: "max",
      }),
    ).toThrow(/cannot disable/);
    expect(
      haiku55ThinkingParams(identity.model, { thinking: true }).output_config
        .effort,
    ).toBe("high");
    expect(
      haiku55ThinkingParams(identity.model, { thinking: "ultrathink" })
        .output_config.effort,
    ).toBe("xhigh");
    expect(() =>
      haiku55ThinkingParams(identity.model, { thinkingEffort: "none" }),
    ).toThrow();
    expect(() =>
      haiku55ThinkingParams(identity.model, { thinkingBudget: 1000 }),
    ).toThrow();
    expect(haiku55ThinkingParams("claude-haiku-4-5")).toBeNull();
  });
  it("prices the whole request across the strict 100K boundary including both cache TTLs", () => {
    const short = new CostBudget();
    const long = new CostBudget();
    short.add({ ...identity, usage: usage() });
    long.add({ ...identity, usage: usage(1001) });
    // 1000*.1 + 98000*.01 + 600*.125 + 400*.2 + 1000*.5, per million.
    expect(short.spentUsd).toBeCloseTo(0.001735, 12);
    expect(long.spentUsd).toBeCloseTo(0.0086755, 12);
    expect(
      estimateCost({ ...identity, inputTokens: 100000, outputTokens: 1000 })
        .totalCost,
    ).toBeCloseTo(0.0105, 12);
    expect(
      estimateCost({ ...identity, inputTokens: 100001, outputTokens: 1000 })
        .totalCost,
    ).toBeCloseTo(0.0525005, 12);
    expect(
      estimateCost({
        ...identity,
        inputTokens: 100000,
        outputTokens: 1000,
        regionalProcessing: true,
      }).totalCost,
    ).toBeCloseTo(0.01155, 12);
    expect(
      estimateCost({ ...identity, serviceTier: "batch", inputTokens: 100 })
        .matched,
    ).toBe(false);
  });
  it("retains request tiers across session and global rollups", () => {
    const records = [
      event(usage()),
      event(usage(1001)),
      event({ input_tokens: 80000, output_tokens: 0, inference_geo: "global" }),
    ];
    const priced = priceRollup(aggregateUsage(records));
    expect(priced.cost.totalCost).toBeCloseTo(0.001735 + 0.0086755 + 0.008, 12);
    expect(priced.cost.unpricedCount).toBe(0);
    const saved = { ..._deps };
    try {
      _deps.listJsonlSessions = () => [{ id: "a" }, { id: "b" }];
      _deps.readEvents = (id) =>
        id === "a" ? records.slice(0, 1) : records.slice(1);
      expect(priceRollup(allSessionsUsage()).cost.totalCost).toBeCloseTo(
        priced.cost.totalCost,
        12,
      );
    } finally {
      Object.assign(_deps, saved);
    }
  });
  it("keeps absent or contradictory TTL evidence unpriced without changing older models", () => {
    for (const broken of [
      { ...usage(), cache_creation: undefined },
      {
        ...usage(),
        cache_creation: {
          ephemeral_5m_input_tokens: 600,
          ephemeral_1h_input_tokens: 399,
        },
      },
      {
        ...usage(),
        cache_creation: {
          ephemeral_5m_input_tokens: -1,
          ephemeral_1h_input_tokens: 1001,
        },
      },
    ]) {
      const budget = new CostBudget({ limitUsd: 1 });
      expect(budget.add({ ...identity, usage: broken }).matched).toBe(false);
      expect(budget.sawUnpriced).toBe(true);
      expect(
        priceRollup(aggregateUsage([event(broken)])).cost.unpricedCount,
      ).toBe(1);
    }
    expect(
      estimateCost({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        cacheCreationTokens: 1000,
      }).totalCost,
    ).toBeCloseTo(0.00375, 12);
    expect(
      priceRollup({
        byModel: [
          { ...identity, inputTokens: 160000, totalTokens: 160000, calls: 2 },
        ],
      }).cost.unpricedCount,
    ).toBe(1);
    const conflict = { ...usage(), cacheCreationTokens: 999 };
    expect(new CostBudget().add({ ...identity, usage: conflict }).matched).toBe(
      false,
    );
    expect(
      priceRollup(
        aggregateUsage([
          event({
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 1000,
          }),
        ]),
      ).cost.unpricedCount,
    ).toBe(1);
  });
  it("preserves stream TTL and region evidence through budget and session accounting", () => {
    const result = _accumulateAnthropicStream([
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { ...usage(), inference_geo: "us" } } })}`,
      `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 1000 } })}`,
    ]);
    expect(result.usage).toMatchObject({
      cacheCreation5mTokens: 600,
      cacheCreation1hTokens: 400,
      regional_processing: true,
    });
    const budget = new CostBudget();
    budget.add({ ...identity, usage: result.usage });
    expect(budget.spentUsd).toBeCloseTo(0.001735 * 1.1, 12);
    expect(
      priceRollup(aggregateUsage([event(result.usage)])).cost.totalCost,
    ).toBeCloseTo(budget.spentUsd, 12);
  });
  it("prices official inference_geo and fails closed on missing, unknown or conflicting geography", () => {
    for (const inference_geo of [undefined, "eu", null]) {
      const raw = { ...usage(), inference_geo };
      if (inference_geo === undefined) delete raw.inference_geo;
      expect(new CostBudget().add({ ...identity, usage: raw }).matched).toBe(
        false,
      );
      expect(priceRollup(aggregateUsage([event(raw)])).cost.unpricedCount).toBe(
        1,
      );
    }
    expect(() =>
      new CostBudget().add({
        ...identity,
        usage: { ...usage(), inference_geo: "us", regional_processing: false },
      }),
    ).toThrow(/conflicts/);
  });
  it("normalizes validated streaming write-count aliases without losing TTL evidence", () => {
    const raw = { ...usage(), cache_creation_tokens: 1000 };
    delete raw.cache_creation_input_tokens;
    const stream = (input) =>
      _accumulateAnthropicStream([
        `data: ${JSON.stringify({ type: "message_start", message: { usage: input } })}`,
        `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 1000 } })}`,
      ]);
    const valid = stream(raw);
    expect(valid.usage.cacheCreation1hTokens).toBe(400);
    expect(
      new CostBudget().add({ ...identity, usage: valid.usage }).totalCost,
    ).toBeCloseTo(0.001735, 12);
    expect(
      stream({ ...raw, cache_creation_input_tokens: 999 }).usage,
    ).toBeUndefined();
  });
});
