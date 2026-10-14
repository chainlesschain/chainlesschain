import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveModelCapabilityProfile,
  resolveModelServiceTier,
} from "../../src/lib/model-capabilities.js";
import {
  createOpenAIResponsesBody,
  normalizeOpenAIResponsesResponse,
} from "../../src/lib/openai-responses.js";
import { estimateCost, priceModelEntry } from "../../src/lib/llm-pricing.js";
import {
  projectUsagePricingContext,
  preserveRequestedServiceTierEvidence,
  projectEnvelopePricingContext,
} from "../../src/lib/usage-pricing-context.js";
import { reviewModelCatalog } from "../../src/lib/model-catalog-review.js";
import { readFileSync } from "node:fs";

describe("reviewed live service tiers", () => {
  afterEach(() => vi.unstubAllGlobals());
  const profile = (model = "gpt-6.1-sol", baseUrl) =>
    resolveModelCapabilityProfile({ provider: "openai", model, baseUrl });
  it("sends the explicit reviewed tier while keeping runtime and account availability unverified", () => {
    const p = profile();
    expect(p.reviewedAt).toBe("2026-10-15");
    expect(resolveModelServiceTier(p, "ultrafast")).toMatchObject({
      effectiveServiceTier: null,
      accountVerified: false,
    });
    expect(
      createOpenAIResponsesBody({
        model: p.model,
        modelProfile: p,
        messages: [{ role: "user", content: "test" }],
        tools: [],
        serviceTier: "ultrafast",
      }).service_tier,
    ).toBe("ultrafast");
    expect(
      createOpenAIResponsesBody({
        model: p.model,
        modelProfile: p,
        messages: [],
        tools: [],
      }),
    ).not.toHaveProperty("service_tier");
  });
  it.each(["gpt-6-sol", "gpt-6-luna", "gpt-6.2-sol"])(
    "does not inherit Ultrafast for %s",
    (model) => {
      expect(() =>
        resolveModelServiceTier(profile(model), "ultrafast"),
      ).toThrow(/Unsupported service tier/);
      expect(
        estimateCost({
          provider: "openai",
          model,
          inputTokens: 1000,
          outputTokens: 100,
          serviceTier: "ultrafast",
        }).matched,
      ).toBe(false);
    },
  );
  it("does not certify custom gateways or accept batch as a live tier", () => {
    expect(() =>
      resolveModelServiceTier(
        profile("gpt-6.1-sol", "https://gateway.example/v1"),
        "ultrafast",
      ),
    ).toThrow();
    expect(() => resolveModelServiceTier(profile(), "batch")).toThrow();
    expect(() => resolveModelServiceTier(profile(), " ultrafast")).toThrow();
  });
  it("preserves actual tier evidence and applies short/long, cache and regional rates per request", () => {
    const response = normalizeOpenAIResponsesResponse({
      status: "completed",
      service_tier: "ultrafast",
      output: [],
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 500 },
      },
    });
    expect(projectUsagePricingContext(response.usage).service_tier).toBe(
      "ultrafast",
    );
    const cost = estimateCost({
      provider: "openai",
      model: "gpt-6.1-sol",
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 500,
      serviceTier: "ultrafast",
    });
    expect(cost.totalCost).toBeCloseTo(0.0123, 10);
    const long = estimateCost({
      provider: "openai",
      model: "gpt-6.1-sol",
      inputTokens: 300000,
      outputTokens: 1000,
      serviceTier: "ultrafast",
      regionalProcessing: true,
    });
    expect(long.totalCost).toBeCloseTo(8.019, 10);
    expect(
      estimateCost({
        provider: "openai",
        model: "gpt-6.1-sol",
        inputTokens: 1,
        outputTokens: 1,
        serviceTier: "unrecognized",
      }),
    ).toMatchObject({ matched: false, free: false });
  });
  it("reviews newly supported tier and review-date drift", () => {
    const review = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/model-catalog-review-2026-10-15.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(reviewModelCatalog(review).localContractPassed).toBe(true);
    review.models[0].supportedServiceTiers = ["standard"];
    expect(
      reviewModelCatalog(review).mismatches.some(
        (row) => row.field === "supportedServiceTiers",
      ),
    ).toBe(true);
  });
  it("keeps absent or conflicting actual tier evidence unpriced", () => {
    const usage = preserveRequestedServiceTierEvidence(
      { input_tokens: 100, output_tokens: 10 },
      "ultrafast",
    );
    expect(usage.pricingContextInvalid).toBe(true);
    expect(
      projectEnvelopePricingContext(
        { service_tier: "fast" },
        { service_tier: "ultrafast" },
      ),
    ).toMatchObject({ service_tier: "ultrafast", pricingContextInvalid: true });
    expect(
      preserveRequestedServiceTierEvidence(
        { service_tier: "default" },
        "ultrafast",
      ),
    ).toEqual({ service_tier: "default" });
  });
  it("does not assume standard rates for an undeclared tier on third-party providers", () => {
    expect(
      estimateCost({
        provider: "volcengine",
        model: "deepseek-v4-flash-ga-260731",
        inputTokens: 100,
        outputTokens: 10,
        serviceTier: "unknown",
      }),
    ).toMatchObject({ matched: false, free: false });
    expect(
      estimateCost({
        provider: "volcengine",
        model: "deepseek-v4-flash-ga-260731",
        inputTokens: 100,
        outputTokens: 10,
        serviceTier: "default",
      }).matched,
    ).toBe(true);
  });
  it("rejects unsupported tiers before request admission or network calls", async () => {
    const { chatWithTools } = await import("../../src/runtime/agent-core.js");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const onProviderCallStart = vi.fn();
    await expect(
      chatWithTools([{ role: "user", content: "test" }], {
        provider: "volcengine",
        model: "deepseek-v4-flash-ga-260731",
        serviceTier: "ultrafast",
        onProviderCallStart,
      }),
    ).rejects.toMatchObject({ code: "CC_MODEL_SERVICE_TIER_UNSUPPORTED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(onProviderCallStart).not.toHaveBeenCalled();
  });
  it("rejects an unsupported tier before the Agent loop can emit a usage boundary or compact", async () => {
    const { agentLoop } = await import("../../src/runtime/agent-core.js");
    const chatFn = vi.fn();
    const compactionLlmQuery = vi.fn();
    const loop = agentLoop([{ role: "user", content: "test" }], {
      provider: "volcengine",
      model: "deepseek-v4-flash-ga-260731",
      serviceTier: "ultrafast",
      chatFn,
      compactionLlmQuery,
    });
    await expect(loop.next()).rejects.toMatchObject({
      code: "CC_MODEL_SERVICE_TIER_UNSUPPORTED",
    });
    expect(chatFn).not.toHaveBeenCalled();
    expect(compactionLlmQuery).not.toHaveBeenCalled();
  });
  it("forwards the requested tier through production transport and settles using the response tier", async () => {
    const { chatWithTools } = await import("../../src/runtime/agent-core.js");
    let body;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, request) => {
        body = JSON.parse(request.body);
        return new Response(
          JSON.stringify({
            status: "completed",
            service_tier: "default",
            output: [],
            usage: { input_tokens: 100, output_tokens: 10 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const result = await chatWithTools([{ role: "user", content: "test" }], {
      provider: "openai",
      model: "gpt-6.1-sol",
      apiKey: "fixture-key",
      serviceTier: "ultrafast",
      enabledToolNames: [],
      hermeticExecution: true,
      contextMemorySkipPlanning: true,
    });
    expect(body.service_tier).toBe("ultrafast");
    expect(result.usage.service_tier).toBe("default");
    expect(result.usage.pricingContextInvalid).not.toBe(true);
  });
});
