import { describe, it, expect } from "vitest";
import { runCompactCatalogBenchmark } from "../../scripts/mcp-compact-catalog-benchmark.mjs";

describe("compact MCP catalog offline measurement", () => {
  it("measures the provider projection without shrinking the host capability inventory", () => {
    const report = runCompactCatalogBenchmark({ sizes: [24, 48] });
    expect(report).toMatchObject({
      providerCalls: 0,
      providerUsageMeasured: false,
      billingVerified: false,
      taskQualityVerified: false,
    });
    for (const tier of report.tiers) {
      expect(tier.initialStubs.visibleExtraToolCount).toBe(tier.toolCount + 1);
      expect(tier.initialCompact.visibleExtraToolCount).toBe(1);
      expect(tier.hostDefinitionCount).toBe(tier.toolCount + 1);
      expect(tier.afterFiveSchemas.loadedSchemaCount).toBe(5);
      expect(tier.afterFiveSchemas.visibleExtraToolCount).toBe(6);
      expect(tier.lexicalResultsUnchanged).toBe(true);
      expect(tier.estimatedInitialReductionRatio).toBeGreaterThan(0);
    }
    expect(report.tiers[0].initialCompact.estimatedExtraToolTokens).toBe(
      report.tiers[1].initialCompact.estimatedExtraToolTokens,
    );
    expect(report.tiers[0].afterFiveSchemas.estimatedExtraToolTokens).toBe(
      report.tiers[1].afterFiveSchemas.estimatedExtraToolTokens,
    );
    expect(
      report.tiers[1].initialStubs.estimatedExtraToolTokens,
    ).toBeGreaterThan(report.tiers[0].initialStubs.estimatedExtraToolTokens);
  });

  it("rejects measurements beyond the bounded fixture range", () => {
    expect(() => runCompactCatalogBenchmark({ sizes: [1] })).toThrow();
    expect(() => runCompactCatalogBenchmark({ sizes: [20000] })).toThrow();
  });
});
