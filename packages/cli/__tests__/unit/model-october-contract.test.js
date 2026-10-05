import { describe, expect, it } from "vitest";
import { resolveModelCapabilityProfile } from "../../src/lib/model-capabilities.js";
import {
  estimateCost,
  lookupRate,
  mergePricing,
} from "../../src/lib/llm-pricing.js";
import {
  createOpenAIResponsesBody,
  createOpenAIResponsesReasoning,
} from "../../src/lib/openai-responses.js";
import { CostBudget } from "../../src/lib/cost-budget.js";

const profile = () =>
  resolveModelCapabilityProfile({ provider: "openai", model: "gpt-6.1-sol" });
describe("October model contracts from reviewed official documentation", () => {
  it("routes GPT-6.1 tools through Responses and rejects unsupported reasoning/output before transport", () => {
    const resolved = profile();
    expect(resolved).toMatchObject({
      runtimeProtocol: "openai-responses",
      contextWindowTokens: 1050000,
      advertisedMaxOutputTokens: 128000,
      runtimeVerified: false,
    });
    for (const effort of ["none", "minimal", "invalid"]) {
      expect(() =>
        createOpenAIResponsesReasoning(
          { thinking: true, thinkingEffort: effort },
          resolved,
        ),
      ).toThrow(/Unsupported reasoning/);
    }
    expect(
      createOpenAIResponsesReasoning(
        { thinking: true, thinkingEffort: "max" },
        resolved,
      ),
    ).toEqual({ effort: "max", summary: "auto" });
    expect(createOpenAIResponsesReasoning({}, resolved)).toBeNull();
    expect(() =>
      createOpenAIResponsesBody({
        model: resolved.model,
        messages: [],
        tools: [],
        maxOutputTokens: 128001,
        modelProfile: resolved,
      }),
    ).toThrow(/documented limit/);
    expect(
      createOpenAIResponsesBody({
        model: resolved.model,
        messages: [],
        tools: [],
        maxOutputTokens: 128000,
        modelProfile: resolved,
      }).max_output_tokens,
    ).toBe(128000);
  });
  it("isolates new model metadata from custom endpoints and future aliases", () => {
    for (const [provider, model, window] of [
      ["openai", "gpt-6.1-sol", 128000],
      ["anthropic", "claude-sonnet-5-5", 200000],
    ]) {
      expect(
        resolveModelCapabilityProfile({
          provider,
          model,
          baseUrl: "https://gateway.example/v1",
        }),
      ).toMatchObject({ windowAssumed: true, contextWindowTokens: window });
      expect(lookupRate(provider, model + "-future")).toBeNull();
    }
    expect(
      resolveModelCapabilityProfile({
        provider: "anthropic",
        model: "claude-sonnet-5-5",
      }),
    ).toMatchObject({ contextWindowTokens: 1000000, windowAssumed: false });
    expect(lookupRate("anthropic", "claude-sonnet-6")).toBeNull();
  });
  it("uses each model's actual cache-read price instead of the prior family rate", () => {
    for (const [provider, model, cost] of [
      ["openai", "gpt-6.1-sol", 0.01],
      ["openai", "gpt-6-sol", 0.02],
      ["anthropic", "claude-sonnet-5-5", 0.02],
      ["anthropic", "claude-opus-5-5", 0.02],
    ]) {
      expect(
        estimateCost({ provider, model, cacheReadTokens: 100000 })
          .cacheReadCost,
      ).toBeCloseTo(cost, 12);
    }
    expect(
      estimateCost({
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        inputTokens: 1000,
        outputTokens: 100,
      }).totalCost,
    ).toBeCloseTo(0.003, 12);
  });
  it("applies cache, long-context and service rates at each request and budget boundary", () => {
    const options = {
      provider: "openai",
      model: "gpt-6.1-sol",
      cacheReadTokens: 100000,
      inputTokens: 172000,
      outputTokens: 1000,
    };
    expect(estimateCost(options).totalCost).toBeCloseTo(0.364, 12);
    expect(
      estimateCost({ ...options, inputTokens: 172001 }).totalCost,
    ).toBeCloseTo(0.723004, 12);
    expect(
      estimateCost({
        ...options,
        serviceTier: "fast",
        regionalProcessing: true,
      }).totalCost,
    ).toBeCloseTo(0.364 * 2 * 1.1, 12);
    expect(
      estimateCost({ ...options, serviceTier: "flex" }).totalCost,
    ).toBeCloseTo(0.182, 12);
    expect(estimateCost({ ...options, serviceTier: "unknown" }).matched).toBe(
      false,
    );
    const budget = new CostBudget({ limitUsd: 1 });
    budget.add({
      provider: options.provider,
      model: options.model,
      usage: {
        input_tokens: 172000,
        cache_read_input_tokens: 100000,
        output_tokens: 1000,
      },
    });
    expect(budget.spentUsd).toBeCloseTo(0.364, 12);
  });
  it("retains explicit new-model terms, exact matching and independent copies", () => {
    const terms = {
      cacheReadMultiplier: 0.05,
      cacheWriteMultiplier: 1.25,
      longContext: {
        threshold: 272000,
        inputMultiplier: 2,
        outputMultiplier: 1.5,
      },
      serviceMultipliers: { standard: 1, fast: 2 },
    };
    const table = mergePricing({
      openai: [{ match: "custom-model", in: 2, out: 10, exact: true, terms }],
    });
    terms.serviceMultipliers.standard = 99;
    expect(lookupRate("openai", "custom-model-future", table)).toBeNull();
    expect(
      estimateCost({
        provider: "openai",
        model: "custom-model",
        cacheReadTokens: 100000,
        table,
      }).totalCost,
    ).toBeCloseTo(0.01, 12);
    expect(
      estimateCost({
        provider: "openai",
        model: "custom-model",
        cacheReadTokens: 300000,
        table,
      }).totalCost,
    ).toBeCloseTo(0.06, 12);
  });
  it("rejects unrecognized service tiers, symbols and non-plain pricing objects", () => {
    for (const terms of [
      { serviceMultipliers: { madeUp: 1 } },
      { [Symbol("unexpected")]: 1 },
      Object.create({ cacheReadMultiplier: 0 }),
    ]) {
      expect(() =>
        mergePricing({ openai: [{ match: "custom", in: 2, out: 10, terms }] }),
      ).toThrow(/Invalid pricing terms/);
    }
  });
  it.each([
    null,
    [],
    { cacheReadMultiplier: -1 },
    { cacheReadMultiplier: Infinity },
    { cacheReadMultiplier: "0.05" },
    { unknown: 1 },
    {
      longContext: { threshold: 0, inputMultiplier: 2, outputMultiplier: 1.5 },
    },
    { serviceMultipliers: {} },
    { serviceMultipliers: { standard: NaN } },
  ])(
    "rejects malformed terms rather than quietly mispricing an override: %j",
    (terms) => {
      expect(() =>
        mergePricing({ openai: [{ match: "custom", in: 2, out: 10, terms }] }),
      ).toThrow(/Invalid pricing terms/);
    },
  );
});
