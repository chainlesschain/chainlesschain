import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveModelCapabilityProfile,
  resolveModelServiceTier,
} from "../../src/lib/model-capabilities.js";
import {
  createOpenAIResponsesBody,
  createOpenAIResponsesReasoning,
  normalizeOpenAIResponsesResponse,
  normalizeOpenAIResponsesUsage,
} from "../../src/lib/openai-responses.js";
import {
  estimateCost,
  lookupRate,
  priceRollup,
  normalizePricingTerms,
} from "../../src/lib/llm-pricing.js";
import { reviewModelCatalog } from "../../src/lib/model-catalog-review.js";
import { projectUsagePricingContext } from "../../src/lib/usage-pricing-context.js";
import { projectRuntimeTokenUsage } from "../../src/lib/runtime-usage-ledger.js";
import { aggregateUsage } from "../../src/lib/session-usage.js";
import { CostBudget } from "../../src/lib/cost-budget.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";
import { projectVerifiedSession } from "../../src/lib/causal-observability.js";
import {
  normalizeLlmProbeUsage,
  priceLlmProbeUsage,
  llmProbeReceipt,
} from "../../src/lib/llm-connection-probe.js";
import { prepareCanonicalProviderContext } from "../../src/lib/context-memory-kernel/provider-context.js";

const identity = { provider: "openai", model: "gpt-6.1-terra" };
const profile = resolveModelCapabilityProfile(identity);
const rawUsage = () => ({
  input_tokens: 12000,
  output_tokens: 1000,
  input_tokens_details: {
    cached_tokens: 4000,
    cache_write_tokens: 7000,
    cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 },
  },
});
const record = () => ({
  ...identity,
  usage: normalizeOpenAIResponsesUsage(rawUsage()),
});

describe("Terra documented contract and cache-write settlement", () => {
  it.each([undefined, 128000])(
    "limits planned input independently of output reserve %s",
    async (maxOutputTokens) => {
      const directory = mkdtempSync(join(tmpdir(), "cc-terra-input-"));
      try {
        const prepared = await prepareCanonicalProviderContext(
          [{ role: "user", content: "Inspect README" }],
          {
            ...identity,
            maxOutputTokens,
            contextMemoryEnv: {
              CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
            },
            contextMemoryFilePath: join(directory, "memory.json"),
            contextMemorySelectedToolNames: [],
          },
        );
        expect(prepared.plan.inputBudget).toBe(
          maxOutputTokens ? 869500 : 922000,
        );
        expect(prepared.modelCapabilities.contextWindowTokens).toBe(1050000);
        expect(prepared.messages).toEqual([
          { role: "user", content: "Inspect README" },
        ]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it("uses the exact official API profile without asserting account access", () => {
    expect(profile).toMatchObject({
      catalogVersion: "2026-10-29",
      reviewedAt: "2026-10-29",
      runtimeProtocol: "openai-responses",
      contextWindowTokens: 1050000,
      advertisedMaxOutputTokens: 128000,
      advertisedMaxInputTokens: 922000,
      defaultReasoningEffort: "medium",
      runtimeVerified: false,
      windowAssumed: false,
    });
    expect(profile.reasoningEfforts).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(lookupRate("openai", "gpt-6.1-terra")).toMatchObject({
      in: 1,
      out: 5,
    });
    for (const model of ["gpt-6.1-terra-future", "gpt-6.2-terra"]) {
      expect(
        resolveModelCapabilityProfile({ ...identity, model }).windowAssumed,
      ).toBe(true);
      expect(lookupRate("openai", model)).toBeNull();
    }
  });

  it.each([
    "https://gateway.example/v1",
    "https://api.openai.com.example/v1",
    "https://api.openai.com/custom",
  ])("does not certify the endpoint %s", (baseUrl) => {
    const custom = resolveModelCapabilityProfile({ ...identity, baseUrl });
    expect(custom).toMatchObject({
      runtimeProtocol: "chat-completions",
      windowAssumed: true,
      runtimeVerified: false,
    });
    expect(custom.sources).toEqual([]);
    expect(() => resolveModelServiceTier(custom, "fast")).toThrow();
  });

  it.each(["none", "low", "medium", "high", "xhigh", "max"])(
    "preserves explicit reasoning %s",
    (effort) => {
      const reasoning = createOpenAIResponsesReasoning(
        { thinkingEffort: effort },
        profile,
      );
      expect(reasoning.effort).toBe(effort);
      const body = createOpenAIResponsesBody({
        model: identity.model,
        modelProfile: profile,
        messages: [],
        reasoning,
        maxOutputTokens: 128000,
      });
      expect(body.reasoning.effort).toBe(effort);
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("top_p");
    },
  );

  it("sends explicit none instead of silently using the server's medium default", () => {
    for (const thinking of [false, "off", "none"])
      expect(createOpenAIResponsesReasoning({ thinking }, profile)).toEqual({
        effort: "none",
      });
    expect(createOpenAIResponsesReasoning({}, profile)).toBeNull();
    expect(() =>
      createOpenAIResponsesReasoning({ thinkingEffort: "ultra" }, profile),
    ).toThrow();
    expect(() =>
      createOpenAIResponsesBody({
        model: identity.model,
        modelProfile: profile,
        messages: [],
        maxOutputTokens: 128001,
      }),
    ).toThrow();
  });

  it.each(["ultrafast", "batch"])(
    "rejects unsupported live tier %s",
    (serviceTier) => {
      expect(() =>
        createOpenAIResponsesBody({
          model: identity.model,
          modelProfile: profile,
          messages: [],
          serviceTier,
        }),
      ).toThrow();
      if (serviceTier === "ultrafast")
        expect(
          estimateCost({ ...identity, serviceTier, inputTokens: 1000 }),
        ).toMatchObject({ matched: false, free: false });
    },
  );

  it("prices short and long requests with cache, service and regional terms", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 4000,
      cacheCreationTokens: 7000,
      cacheCreation30mTokens: 3000,
      cacheCreation12hTokens: 4000,
    };
    expect(estimateCost({ ...identity, ...usage }).totalCost).toBeCloseTo(
      0.01995,
      12,
    );
    expect(
      estimateCost({ ...identity, ...usage, serviceTier: "flex" }).totalCost,
    ).toBeCloseTo(0.009975, 12);
    expect(
      estimateCost({
        ...identity,
        ...usage,
        serviceTier: "fast",
        regionalProcessing: true,
      }).totalCost,
    ).toBeCloseTo(0.04389, 12);
    expect(
      estimateCost({ ...identity, inputTokens: 272000, outputTokens: 1000 })
        .totalCost,
    ).toBeCloseTo(0.277, 12);
    expect(
      estimateCost({ ...identity, inputTokens: 272001, outputTokens: 1000 })
        .totalCost,
    ).toBeCloseTo(0.551502, 12);
  });

  it("removes reads and both write lifetimes from ordinary input exactly once", () => {
    expect(record().usage).toEqual({
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 7000,
      cacheCreation30mTokens: 3000,
      cacheCreation12hTokens: 4000,
    });
    const cost = new CostBudget({ limitUsd: 0.019 });
    cost.add(record());
    expect(cost.spentUsd).toBeCloseTo(0.01995, 12);
    expect(cost.exceeded()).toBe(true);
    const probe = normalizeLlmProbeUsage(
      "openai",
      { usage: rawUsage(), service_tier: "fast" },
      "openai-responses",
    );
    expect(priceLlmProbeUsage(identity, probe)).toBeCloseTo(0.0399, 12);
    expect(
      llmProbeReceipt(identity, { usage: probe }).totalCostUsd,
    ).toBeCloseTo(0.0399, 12);
  });

  it.each([
    undefined,
    null,
    {},
    { ttl_30m_tokens: 7000 },
    { ttl_30m_tokens: 3000, ttl_12h_tokens: 3999 },
    { ttl_30m_tokens: "3000", ttl_12h_tokens: 4000 },
  ])("keeps incomplete or conflicting TTL evidence unpriced: %j", (split) => {
    const raw = rawUsage();
    raw.input_tokens_details.cache_write_tokens_details = split;
    const usage = normalizeOpenAIResponsesUsage(raw);
    expect(usage.cacheCreationInvalid).toBe(true);
    const cost = new CostBudget({ limitUsd: 1 });
    expect(cost.add({ ...identity, usage })).toMatchObject({
      matched: false,
      free: false,
    });
    expect(cost.sawUnpriced).toBe(true);
    const events = [{ type: "token_usage", data: { ...identity, usage } }];
    expect(priceRollup(aggregateUsage(events)).cost.unpricedCount).toBe(1);
  });

  it.each([-1, "7000", 9000, Number.MAX_SAFE_INTEGER])(
    "rejects invalid/overlapping aggregate writes %s",
    (writes) => {
      const raw = rawUsage();
      raw.input_tokens_details.cache_write_tokens = writes;
      expect(normalizeOpenAIResponsesUsage(raw)).toBeNull();
    },
  );

  it("does not confuse Anthropic one-hour writes with OpenAI twelve-hour writes", () => {
    expect(
      estimateCost({
        ...identity,
        cacheCreationTokens: 100,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 100,
      }).matched,
    ).toBe(false);
    expect(
      projectUsagePricingContext({
        ...record().usage,
        cacheCreation1hTokens: 7000,
        cacheCreation5mTokens: 0,
      }),
    ).toEqual({ cacheCreationInvalid: true });
    expect(
      estimateCost({ ...identity, cacheCreationTokens: 100 }).matched,
    ).toBe(false);
    expect(normalizePricingTerms({ cacheWrite12hMultiplier: 2.5 })).toEqual({
      cacheWrite12hMultiplier: 2.5,
    });
  });

  it("preserves mixed TTLs, per-request thresholds and tier evidence through ledger, Eval and cost rollup", () => {
    const records = [12000, 300000].map((input, index) =>
      projectRuntimeTokenUsage({
        ...identity,
        callId: `terra-${index}`,
        usage: normalizeOpenAIResponsesResponse({
          status: "completed",
          output: [],
          service_tier: index ? "fast" : "default",
          regional_processing: true,
          usage: { ...rawUsage(), input_tokens: input },
        }).usage,
      }),
    );
    const events = [
      {
        type: "session_start",
        data: {
          observabilityScope: { workspaceId: "w", teamId: "t", policyId: "p" },
        },
      },
      ...records.map((data) => ({ type: "token_usage", data })),
    ];
    const budget = new CostBudget({ limitUsd: 10 });
    records.forEach((r) => budget.add(r));
    const rollup = priceRollup(aggregateUsage(events));
    expect(rollup.byModel[0].pricingBuckets).toHaveLength(2);
    expect(rollup.cost.unpricedCount).toBe(0);
    expect(rollup.cost.totalCost).toBeCloseTo(budget.spentUsd, 12);
    const observed = projectVerifiedSession("terra", events, {
      headHash: "a".repeat(64),
      eventCount: events.length,
    });
    expect(observed.usage.estimatedUsd).toBeCloseTo(budget.spentUsd, 12);
  });

  it("keeps TTL evidence through restored budget settlement", () => {
    const source = new SessionResourceBudget({ maxUsd: 10 });
    const pending = source.beginUsageSettlement({ id: "terra-call" });
    source.markUsageUnknown({ callId: pending.id });
    const snapshot = source.snapshot();
    source.dispose();
    const resumed = SessionResourceBudget.restore(snapshot);
    try {
      resumed.adjudicateRecovery({
        settled: [{ authorityId: pending.authorityId, ...record() }],
      });
      expect(resumed.cost.spentUsd).toBeCloseTo(0.01995, 12);
    } finally {
      resumed.dispose();
    }
  });

  it("checks reviewed API fields and identifies price drift without changing upstream acceptance", () => {
    const review = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/model-catalog-review-2026-10-29.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(reviewModelCatalog(review).localContractPassed).toBe(true);
    expect(review.upstream).toEqual({ codex: "0.160.0", claude: "2.1.289" });
    review.models[0].pricing.cacheWrite12hMultiplier = 2;
    expect(reviewModelCatalog(review).mismatches).toContainEqual({
      model: identity.model,
      field: "cacheWrite12hMultiplier",
      expected: 2,
      actual: 2.5,
    });
  });
});
