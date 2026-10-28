import { describe, expect, it } from "vitest";
import { estimateCost, priceRollup } from "../../src/lib/llm-pricing.js";
import { mergeUsagePricingBucket } from "../../src/lib/usage-pricing-context.js";

// Engineering regression coverage added after reviewing the unsuccessful
// VERIFY-04 diagnostic. This is not the original model candidate or evidence.
const identity = { provider: "openai", model: "gpt-6-astra" };
const tokenFields = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
  "totalTokens",
];

function request(values) {
  const usage = {
    inputTokens: 0,
    outputTokens: 1000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...values,
  };
  usage.totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens;
  // These controlled samples write only the default 30-minute cache.
  if (usage.cacheCreationTokens) {
    usage.cacheCreation30mTokens = usage.cacheCreationTokens;
    usage.cacheCreation12hTokens = 0;
  }
  return usage;
}

function aggregate(requests) {
  const row = {
    ...identity,
    ...Object.fromEntries(tokenFields.map((field) => [field, 0])),
    calls: 0,
  };
  for (const usage of requests) {
    for (const field of tokenFields) row[field] += usage[field];
    row.calls++;
    mergeUsagePricingBucket(row, usage);
  }
  return row;
}

function price(row) {
  return priceRollup({ byModel: [row] });
}

describe("request-level pricing aggregation", () => {
  it("charges different prices for equal token totals distributed across different request lengths", () => {
    const short = aggregate([
      request({ inputTokens: 200000, outputTokens: 10000 }),
      request({ inputTokens: 200000, outputTokens: 10000 }),
    ]);
    const mixed = aggregate([
      request({ inputTokens: 100000, outputTokens: 10000 }),
      request({ inputTokens: 300000, outputTokens: 10000 }),
    ]);
    expect(short.totalTokens).toBe(420000);
    for (const field of [...tokenFields, "calls"])
      expect(short[field]).toBe(mixed[field]);
    // $10/M input and $50/M output; long requests cost 2x input, 1.5x output.
    expect(price(short).cost.totalCost).toBeCloseTo(5, 10);
    expect(price(mixed).cost.totalCost).toBeCloseTo(8.25, 10);
    expect(short.pricingBuckets).toHaveLength(1);
    expect(mixed.pricingBuckets).toHaveLength(2);
  });

  it.each([
    {
      label: "uncached input",
      exact: { inputTokens: 272000 },
      beyond: { inputTokens: 272001 },
      exactCost: 2.77,
      beyondCost: 5.51502,
    },
    {
      label: "cache reads",
      exact: { inputTokens: 100000, cacheReadTokens: 172000 },
      beyond: { inputTokens: 100000, cacheReadTokens: 172001 },
      exactCost: 1.222,
      beyondCost: 2.419002,
    },
    {
      label: "cache creation",
      exact: { inputTokens: 100000, cacheCreationTokens: 172000 },
      beyond: { inputTokens: 100000, cacheCreationTokens: 172001 },
      exactCost: 3.2,
      beyondCost: 6.375025,
    },
  ])(
    "counts $label at the inclusive 272000-token standard boundary",
    ({ exact, beyond, exactCost, beyondCost }) => {
      const requests = [request(exact), request(beyond)];
      expect(price(aggregate([requests[0]])).cost.totalCost).toBeCloseTo(
        exactCost,
        10,
      );
      expect(price(aggregate([requests[1]])).cost.totalCost).toBeCloseTo(
        beyondCost,
        10,
      );
      const row = aggregate(requests);
      expect(
        row.pricingBuckets.map((bucket) => bucket.requestInputTokens),
      ).toEqual([272000, 272001]);
      expect(price(row).cost.totalCost).toBeCloseTo(exactCost + beyondCost, 10);
    },
  );

  it.each(["forward", "reverse"])(
    "preserves the sum of every per-request cost component in %s order",
    (order) => {
      const requests = [
        request({ inputTokens: 150000, cacheReadTokens: 10000 }),
        request({ inputTokens: 150000, cacheCreationTokens: 10000 }),
        request({
          inputTokens: 200000,
          cacheReadTokens: 70000,
          cacheCreationTokens: 2001,
        }),
        request({
          inputTokens: 300000,
          cacheReadTokens: 10000,
          cacheCreationTokens: 5000,
        }),
        request({ inputTokens: 100000, serviceTier: "batch" }),
        request({ inputTokens: 100000, regionalProcessing: true }),
      ];
      if (order === "reverse") requests.reverse();
      const row = aggregate(requests);
      const result = price(row);
      const individual = requests.map((usage) =>
        estimateCost({ ...identity, ...usage }),
      );
      expect(row.pricingBuckets).toHaveLength(5);
      expect(result.byModel[0].matched).toBe(true);
      for (const field of [
        "inputCost",
        "outputCost",
        "cacheReadCost",
        "cacheCreationCost",
      ]) {
        expect(result.byModel[0][field]).toBeCloseTo(
          individual.reduce((sum, cost) => sum + cost[field], 0),
          10,
        );
      }
      expect(result.cost.totalCost).toBeCloseTo(
        individual.reduce((sum, cost) => sum + cost.totalCost, 0),
        10,
      );
    },
  );
});
