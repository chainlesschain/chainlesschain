import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { resolveModelCapabilityProfile } from "../../src/lib/model-capabilities.js";
import {
  estimateCost,
  lookupRate,
  mergePricing,
  priceRollup,
} from "../../src/lib/llm-pricing.js";
import {
  calculateCost,
  recordUsage,
  getUsageStats,
  getCostBreakdown,
} from "../../src/lib/token-tracker.js";
import {
  aggregateUsage,
  allSessionsUsage,
  _deps,
} from "../../src/lib/session-usage.js";
import { CostBudget } from "../../src/lib/cost-budget.js";
import { normalizeOpenAIResponsesResponse } from "../../src/lib/openai-responses.js";
import { projectRuntimeTokenUsage } from "../../src/lib/runtime-usage-ledger.js";
import { projectVerifiedSession } from "../../src/lib/causal-observability.js";
import { SessionResourceBudget } from "../../src/lib/session-resource-budget.js";

afterEach(() => vi.restoreAllMocks());

describe("September model release contracts", () => {
  it("preserves request pricing through durable projection, budget and Eval", () => {
    const records = [200000, 200000, 300000].map((input, index) =>
      projectRuntimeTokenUsage({
        provider: "openai",
        model: "gpt-6-sol",
        callId: `call-${index}`,
        usage: {
          input_tokens: input,
          output_tokens: 1000,
          service_tier: index === 1 ? "flex" : "fast",
          regional_processing: true,
        },
      }),
    );
    const events = [
      {
        type: "session_start",
        timestamp: 1,
        data: {
          observabilityScope: { workspaceId: "w", teamId: "t", policyId: "p" },
        },
      },
      ...records.map((data) => ({ type: "token_usage", data })),
    ];
    const budget = new CostBudget({ limitUsd: 100 });
    for (const record of records) budget.add(record);
    const observed = projectVerifiedSession("session-a", events, {
      headHash: "a".repeat(64),
      eventCount: events.length,
    });
    expect(observed.usage.estimatedUsd).toBeCloseTo(budget.spentUsd, 10);
    expect(priceRollup(aggregateUsage(events)).cost.totalCost).toBeCloseTo(
      budget.spentUsd,
      10,
    );
    expect(observed.usage.byModel[0].pricingBuckets).toHaveLength(3);
    expect(records[0].usage.service_tier).toBe("fast");
    expect(
      projectRuntimeTokenUsage({
        ...records[0],
        usage: {
          ...records[0].usage,
          service_tier: "sensitive arbitrary text",
        },
      }).usage.service_tier,
    ).toBe("unknown");
  });

  it("preserves pricing conditions in crash-recovery settlements", () => {
    const source = new SessionResourceBudget({ maxUsd: 100 });
    const pending = source.beginUsageSettlement({ id: "call-a" });
    source.markUsageUnknown({ callId: pending.id });
    const snapshot = source.snapshot();
    source.dispose();
    const resumed = SessionResourceBudget.restore(snapshot);
    const record = {
      provider: "openai",
      model: "gpt-6-sol",
      usage: {
        input_tokens: 300000,
        output_tokens: 1000,
        service_tier: "fast",
        regional_processing: true,
      },
    };
    try {
      const recovery = resumed.adjudicateRecovery({
        settled: [{ authorityId: pending.authorityId, ...record }],
      });
      const budget = new CostBudget({ limitUsd: 100 });
      budget.add(record);
      expect(recovery.adjudication.spentUsdDelta).toBeCloseTo(
        budget.spentUsd,
        10,
      );
      expect(resumed.cost.spentUsd).toBeCloseTo(budget.spentUsd, 10);
    } finally {
      resumed.dispose();
    }
  });
  it.each(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"])(
    "resolves %s only at the official endpoint",
    (model) => {
      const profile = resolveModelCapabilityProfile({
        provider: "openai",
        model,
      });
      expect(profile).toMatchObject({
        contextWindowTokens: 1050000,
        advertisedMaxOutputTokens: 128000,
        runtimeProtocol: "openai-responses",
        windowAssumed: false,
        runtimeVerified: false,
      });
      expect(profile.reasoningEfforts).toContain("high");
      for (const baseUrl of [
        "https://gateway.example/v1",
        "https://api.openai.com.evil/v1",
      ]) {
        expect(
          resolveModelCapabilityProfile({ provider: "openai", model, baseUrl }),
        ).toMatchObject({
          windowAssumed: true,
          runtimeProtocol: "chat-completions",
          advertisedMaxOutputTokens: null,
        });
      }
      expect(
        resolveModelCapabilityProfile({
          provider: "openai",
          model: `${model}-future`,
        }).windowAssumed,
      ).toBe(true);
      expect(lookupRate("openai", `${model}-future`)).toBeNull();
    },
  );

  it("resolves Opus 5.5 without changing a custom gateway's assumptions", () => {
    expect(
      resolveModelCapabilityProfile({
        provider: "anthropic",
        model: "claude-opus-5-5",
        baseUrl: "https://api.anthropic.com/v1",
      }),
    ).toMatchObject({
      contextWindowTokens: 1000000,
      windowAssumed: false,
      advertisedMaxOutputTokens: null,
    });
    expect(
      resolveModelCapabilityProfile({
        provider: "anthropic",
        model: "claude-opus-5-5",
        baseUrl: "https://gateway.example/v1",
      }).windowAssumed,
    ).toBe(true);
    expect(lookupRate("anthropic", "claude-opus-5-5")).toMatchObject({
      in: 4,
      out: 20,
    });
    expect(lookupRate("anthropic", "claude-opus-6")).toBeNull();
    expect(lookupRate("anthropic", "claude-opus-10")).toBeNull();
    expect(
      lookupRate(
        "anthropic",
        "claude-opus-10",
        mergePricing({ anthropic: [{ match: "opus", in: 5, out: 25 }] }),
      ),
    ).toMatchObject({ in: 5, out: 25 });
    expect(lookupRate("anthropic", "claude-opus-5-5-custom")).toBeNull();
  });

  it("prices cached tokens and long prompts at the request boundary", () => {
    const base = {
      provider: "openai",
      model: "gpt-6-sol",
      inputTokens: 272000,
      outputTokens: 1000,
    };
    expect(estimateCost(base).totalCost).toBeCloseTo(0.554, 9);
    expect(
      estimateCost({ ...base, inputTokens: 272001 }).totalCost,
    ).toBeCloseTo(1.103004, 9);
    const cached = estimateCost({
      ...base,
      inputTokens: 200000,
      cacheReadTokens: 73000,
    });
    expect(cached.inputCost).toBeCloseTo(0.8, 9);
    expect(cached.cacheReadCost).toBeCloseTo(0.0292, 9);
    expect(cached.outputCost).toBeCloseTo(0.015, 9);
    expect(
      estimateCost({ ...base, serviceTier: "fast" }).totalCost,
    ).toBeCloseTo(1.108, 9);
    expect(
      estimateCost({ ...base, serviceTier: "flex" }).totalCost,
    ).toBeCloseTo(0.277, 9);
    expect(estimateCost({ ...base, serviceTier: "unknown" }).matched).toBe(
      false,
    );
    expect(estimateCost({ ...base, serviceTier: "constructor" }).matched).toBe(
      false,
    );
    const table = mergePricing({
      openai: [{ match: "gpt-6-sol", in: 4, out: 20 }],
    });
    expect(
      estimateCost({ ...base, table, cacheReadTokens: 1 }).cacheReadCost,
    ).toBeCloseTo(0.0000008, 12);
  });

  it("keeps separate request tiers when aggregating one or many sessions", () => {
    const event = (input) => ({
      type: "token_usage",
      data: {
        provider: "openai",
        model: "gpt-6-sol",
        usage: { input_tokens: input, output_tokens: 1000 },
      },
    });
    const events = [event(200000), event(200000), event(300000)];
    const budget = new CostBudget({ limitUsd: 100 });
    for (const event of events) budget.add(event.data);
    const aggregate = aggregateUsage(events);
    expect(aggregate.byModel[0].pricingBuckets).toHaveLength(2);
    expect(priceRollup(aggregate).cost.totalCost).toBeCloseTo(2.035, 9);
    expect(priceRollup(aggregate).cost.totalCost).toBeCloseTo(
      budget.spentUsd,
      9,
    );
    vi.spyOn(_deps, "listJsonlSessions").mockReturnValue([
      { id: "one" },
      { id: "two" },
    ]);
    vi.spyOn(_deps, "readEvents").mockImplementation((id) =>
      id === "one" ? events.slice(0, 2) : events.slice(2),
    );
    expect(priceRollup(allSessionsUsage()).cost.totalCost).toBeCloseTo(
      budget.spentUsd,
      9,
    );
    const { pricingBuckets, ...legacy } = aggregate.byModel[0];
    expect(priceRollup({ byModel: [legacy] }).cost.unpricedCount).toBe(1);
  });

  it("preserves response service tier for budget settlement", () => {
    expect(
      normalizeOpenAIResponsesResponse({
        status: "completed",
        output: [],
        service_tier: "flex",
        usage: { input_tokens: 100, output_tokens: 20 },
      }).usage.service_tier,
    ).toBe("flex");
  });

  it("uses the same prices in the legacy database, preserving unknown as NULL", () => {
    const db = new Database(":memory:");
    try {
      for (const model of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
        const args = {
          provider: "openai",
          model,
          inputTokens: 300000,
          outputTokens: 1000,
        };
        expect(
          calculateCost(
            args.provider,
            model,
            args.inputTokens,
            args.outputTokens,
          ),
        ).toBe(estimateCost(args).totalCost);
      }
      const known = recordUsage(db, {
        provider: "anthropic",
        model: "claude-opus-5-5",
        inputTokens: 1000,
        outputTokens: 1000,
      });
      const unknown = recordUsage(db, {
        provider: "openai",
        model: "future-model",
        inputTokens: 1000,
      });
      expect(known.costUsd).toBeCloseTo(0.024, 9);
      expect(unknown).toMatchObject({ costUsd: null, priced: false });
      expect(getUsageStats(db)).toMatchObject({
        total_calls: 2,
        unpriced_calls: 1,
      });
      expect(
        getCostBreakdown(db).find((row) => row.model === "future-model"),
      ).toMatchObject({ cost_usd: null, unpriced_calls: 1 });
    } finally {
      db.close();
    }
  });
});
