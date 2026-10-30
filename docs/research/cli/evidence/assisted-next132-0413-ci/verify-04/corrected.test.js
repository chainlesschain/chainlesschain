import { describe, it, expect } from "vitest";
import {
  mergeUsagePricingBucket,
  projectUsagePricingContext,
} from "../src/lib/usage-pricing-context.js";

const LONG_THRESHOLD = 272000;

// Minimal per-model aggregation entry, matching the shape session-usage
// builds before delegating to mergeUsagePricingBucket.
const makeEntry = () => ({
  provider: "openai",
  model: "gpt-6-sol",
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  calls: 0,
});

// Sum the numeric token fields a bucket tracks so tests can assert the
// aggregated totals independently of how requests were distributed.
// `calls` is intentionally excluded: the whole point of this suite is that
// the same token totals can be carried by different call distributions.
const bucketTokenTotals = (entry) =>
  (entry.pricingBuckets || []).reduce(
    (acc, b) => ({
      inputTokens: acc.inputTokens + b.inputTokens,
      outputTokens: acc.outputTokens + b.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + b.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + b.cacheCreationTokens,
      totalTokens: acc.totalTokens + b.totalTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
    },
  );

describe("request-level pricing context (verify-04)", () => {
  it("prices identical total tokens differently when the long-context boundary is crossed per request", () => {
    // Two short requests vs one long request carry the SAME total tokens.
    const short = makeEntry();
    for (let i = 0; i < 2; i += 1) {
      mergeUsagePricingBucket(short, {
        inputTokens: 200000,
        outputTokens: 1000,
        totalTokens: 201000,
      });
    }
    const long = makeEntry();
    mergeUsagePricingBucket(long, {
      inputTokens: 400000,
      outputTokens: 2000,
      totalTokens: 402000,
    });

    // Identical aggregate token totals, so any cost difference is purely a
    // consequence of request distribution (the per-request contract).
    expect(bucketTokenTotals(long)).toEqual(bucketTokenTotals(short));

    expect(short.pricingBuckets).toHaveLength(1);
    expect(short.pricingBuckets[0].requestInputTokens).toBe(200000);
    expect(short.pricingBuckets[0].requestInputTokens > LONG_THRESHOLD).toBe(false);
    expect(short.pricingBuckets[0].calls).toBe(2);

    expect(long.pricingBuckets).toHaveLength(1);
    expect(long.pricingBuckets[0].requestInputTokens).toBe(400000);
    expect(long.pricingBuckets[0].requestInputTokens > LONG_THRESHOLD).toBe(true);
    expect(long.pricingBuckets[0].calls).toBe(1);
  });

  it("keeps a long request and a short request of equal size in separate buckets", () => {
    const entry = makeEntry();
    mergeUsagePricingBucket(entry, {
      inputTokens: 200000,
      cacheReadTokens: 73000, // promptTokens = 273000 -> long
    });
    mergeUsagePricingBucket(entry, {
      inputTokens: 273000, // promptTokens = 273000 -> long, same prompt size
    });
    mergeUsagePricingBucket(entry, {
      inputTokens: 200000, // promptTokens = 200000 -> short
    });

    expect(entry.pricingBuckets).toHaveLength(2);
    const longBucket = entry.pricingBuckets.find(
      (b) => b.requestInputTokens > LONG_THRESHOLD,
    );
    const shortBucket = entry.pricingBuckets.find(
      (b) => b.requestInputTokens <= LONG_THRESHOLD,
    );
    expect(longBucket.calls).toBe(2);
    expect(longBucket.inputTokens).toBe(200000 + 273000);
    // Cache-read tokens ride along with the long request but are tracked
    // separately from charged input tokens.
    expect(longBucket.cacheReadTokens).toBe(73000);
    expect(shortBucket.calls).toBe(1);
    expect(shortBucket.inputTokens).toBe(200000);
  });

  it("splits buckets by service tier and regional processing", () => {
    const entry = makeEntry();
    mergeUsagePricingBucket(entry, {
      inputTokens: 1000,
      service_tier: "fast",
      regional_processing: true,
    });
    mergeUsagePricingBucket(entry, {
      inputTokens: 1000,
      service_tier: "flex",
      regional_processing: false,
    });

    expect(entry.pricingBuckets).toHaveLength(2);
    const fast = entry.pricingBuckets.find((b) => b.serviceTier === "fast");
    const flex = entry.pricingBuckets.find((b) => b.serviceTier === "flex");
    expect(fast.regionalProcessing).toBe(true);
    expect(fast.inputTokens).toBe(1000);
    expect(flex.regionalProcessing).toBe(false);
    expect(flex.inputTokens).toBe(1000);
  });

  it("ignores non-OpenAI providers and undocumented models (no buckets)", () => {
    const providerEntry = makeEntry();
    providerEntry.provider = "anthropic";
    mergeUsagePricingBucket(providerEntry, { inputTokens: 300000 });
    expect(providerEntry.pricingBuckets).toBeUndefined();

    const modelEntry = makeEntry();
    modelEntry.model = "future-model";
    mergeUsagePricingBucket(modelEntry, { inputTokens: 300000 });
    expect(modelEntry.pricingBuckets).toBeUndefined();
  });

  it("projects only bounded, non-conflicting pricing labels", () => {
    expect(projectUsagePricingContext({ service_tier: "flex" })).toEqual({
      service_tier: "flex",
    });
    expect(
      projectUsagePricingContext({ service_tier: "arbitrary text" }),
    ).toEqual({ service_tier: "unknown" });
    expect(projectUsagePricingContext({ regional_processing: true })).toEqual({
      regional_processing: true,
    });
    expect(() =>
      projectUsagePricingContext({
        service_tier: "fast",
        serviceTier: "standard",
      }),
    ).toThrow(TypeError);
    expect(() =>
      projectUsagePricingContext({ regional_processing: "yes" }),
    ).toThrow(TypeError);
  });

  it("rejects non-integer or negative token counts when merging a bucket", () => {
    const entry = makeEntry();
    expect(() =>
      mergeUsagePricingBucket(entry, { inputTokens: 1.5 }),
    ).toThrow(TypeError);
    expect(() =>
      mergeUsagePricingBucket(entry, { inputTokens: -1 }),
    ).toThrow(TypeError);
    // The first invalid request creates a zero-valued bucket before validation.
    // The second rejection must not charge tokens or increment its call count.
    expect(entry.pricingBuckets).toEqual([
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        calls: 0,
        serviceTier: "standard",
        regionalProcessing: false,
        requestInputTokens: 1.5,
      },
    ]);
  });
});
