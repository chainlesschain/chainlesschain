import { describe, it, expect } from "vitest";
import {
  evaluateMcpSearchFixture,
  runMcpToolSearchBenchmark,
} from "../../scripts/mcp-tool-search-benchmark.mjs";

describe("offline MCP discovery measurement", () => {
  it("measures recall as a fraction and keeps negative recall separate from execution quality", () => {
    const measured = evaluateMcpSearchFixture(
      {
        queries: [
          {
            id: "positive",
            group: "fixture",
            query: "find",
            relevant: ["a", "b", "c"],
          },
          { id: "negative", group: "fixture", query: "missing", relevant: [] },
        ],
      },
      (query) => [{ name: query === "find" ? "b" : "unrelated" }],
    );
    expect(measured.recallAt5).toBeCloseTo(1 / 3);
    expect(measured.mrr).toBe(1);
    expect(measured.precisionAmongReturned).toBe(1);
    expect(measured.negativeQueryFalseRecallCount).toBe(1);
  });

  it("compares the same catalog without loading schemas or claiming provider savings", () => {
    const report = runMcpToolSearchBenchmark({ sizes: [24], samples: 22 });
    expect(report).toMatchObject({
      providerCalls: 0,
      providerUsageMeasured: false,
      billingVerified: false,
      taskQualityVerified: false,
      semanticRecallMeasured: false,
      catalogMode: "per-tool-stubs",
    });
    const tier = report.tiers[0];
    expect(tier).toMatchObject({
      catalogUnchanged: true,
      schemasLoadedBySearchOnly: 0,
    });
    expect(tier.current).toMatchObject({
      positiveQueryCount: 18,
      negativeQueryCount: 4,
      recallAt5: 1,
      mrr: 1,
      negativeQueryFalseRecallCount: 0,
    });
    expect(tier.current.latency.sampleCount).toBe(22);
    expect(tier.legacySubstring.recallAt5).toBeCloseTo(5 / 18);
    expect(
      tier.current.queries.find((query) => query.id === "fullwidth").ranked,
    ).toHaveLength(3);
    expect(tier.estimatedCatalogTokens.stubs).toBeGreaterThan(0);
    expect(tier.estimatedCatalogTokens.full).toBeGreaterThan(
      tier.estimatedCatalogTokens.stubs,
    );
  });

  it("rejects unbounded or incomplete benchmark inputs", () => {
    expect(() => runMcpToolSearchBenchmark({ sizes: [1] })).toThrow();
    expect(() => runMcpToolSearchBenchmark({ sizes: [20000] })).toThrow();
    expect(() => runMcpToolSearchBenchmark({ samples: 0 })).toThrow();
  });
});
