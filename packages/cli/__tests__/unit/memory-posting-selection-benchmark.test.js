import { describe, expect, it } from "vitest";
import {
  createMemoryPostingFixture,
  runMemoryPostingSelectionBenchmark,
} from "../../scripts/memory-posting-selection-benchmark.mjs";

describe("Memory posting selection benchmark", () => {
  it("checks selective, union, cursor, empty and unfiltered pages against a full scan", () => {
    const report = runMemoryPostingSelectionBenchmark({
      counts: [100],
      samples: 3,
    });
    expect(report).toMatchObject({
      providerCalls: 0,
      fullStoreSloVerified: false,
      samplesPerCase: 3,
      tiers: [{ recordCount: 100 }],
    });
    expect(report.tiers[0].cases).toHaveLength(5);
    for (const item of report.tiers[0].cases) {
      expect(item.fullScanEqual).toBe(true);
      expect(item.eager.sampleCount).toBe(3);
      expect(item.selective.sampleCount).toBe(3);
      expect(item.resultDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });

  it("rejects unbounded fixtures and sampling", () => {
    for (const count of [0, 99, 1.5, 100001])
      expect(() => createMemoryPostingFixture(count)).toThrow();
    for (const samples of [0, 1.5, 1001])
      expect(() =>
        runMemoryPostingSelectionBenchmark({ counts: [100], samples }),
      ).toThrow();
  });
});
