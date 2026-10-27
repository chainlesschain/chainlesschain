import { describe, expect, it, vi } from "vitest";
import {
  buildSkillSearchDescriptors,
  loadSkillSearchFixture,
  runSkillSearchBenchmark,
} from "../../scripts/skill-search-benchmark.mjs";

describe("File-backed multilingual skill search baseline", () => {
  it("binds fixed queries to descriptors and bounds catalog generation", () => {
    const fixture = loadSkillSearchFixture();
    const descriptors = buildSkillSearchDescriptors(50);
    const names = new Set(descriptors.map((item) => item.id));
    expect(names.size).toBe(50);
    expect(fixture.queries).toHaveLength(17);
    for (const item of fixture.queries) {
      if (item.expectedId !== null)
        expect(names.has(item.expectedId)).toBe(true);
    }
    for (const count of [0, 25, 50.5, 10001, NaN]) {
      expect(() => buildSkillSearchDescriptors(count)).toThrow();
    }
  });

  it("measures production discovery without provider calls or premature body materialization", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected provider call"));
    try {
      const report = await runSkillSearchBenchmark({
        sizes: [50],
        repetitions: 1,
      });
      expect(report).toMatchObject({
        providerCalls: 0,
        providerUsageMeasured: false,
        billingVerified: false,
        taskQualityVerified: false,
        fixtureDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        tiers: [
          {
            skillCount: 50,
            positiveCases: 13,
            negativeCases: 4,
            recallAt5: 1,
            wrongSelectionCount: 0,
            firstPageCount: 20,
            bodiesBeforeSearch: 0,
            bodiesAfterSearch: 0,
            bodiesAfterSelection: 1,
            omittedSkillsSearchPassed: true,
            latency: { sampleCount: 17 },
          },
        ],
      });
      expect(report.tiers[0].fullDirectoryEstimatedTokens).toBeGreaterThan(
        report.tiers[0].firstPageEstimatedTokens,
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
