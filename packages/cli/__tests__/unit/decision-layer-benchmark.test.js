import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { runSkillDecisionBenchmark } from "../../src/lib/decision-layer/benchmark.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function candidate(id) {
  return {
    id,
    displayName: id,
    description: `${id} description`,
    category: "test",
    digest: D(id),
    tags: [],
  };
}

describe("Skill decision benchmark", () => {
  it("supports no-match and multiple acceptable Skill labels", async () => {
    const results = [
      { status: "suggestion", selectedDigest: D("a") },
      { status: "no-match", selectedDigest: null },
    ];
    let index = 0;
    let tick = 0;
    const report = await runSkillDecisionBenchmark({
      runtime: { suggest: async () => results[index++] },
      cases: [
        {
          query: "use either implementation",
          candidates: [candidate("a"), candidate("b")],
          acceptableDigests: [D("a"), D("b")],
        },
        {
          query: "ordinary conversation",
          candidates: [candidate("a")],
          acceptableDigests: [],
        },
      ],
      thresholds: {
        acceptedSuggestionErrorRate: 0.05,
        noMatchFalseSuggestionRate: 0.02,
        affirmativeCoverage: 0.5,
        p95Ms: 10,
      },
      clock: () => ++tick,
    });
    expect(report.metrics).toMatchObject({
      acceptedSuggestionErrorRate: 0,
      noMatchFalseSuggestionRate: 0,
      affirmativeCoverage: 1,
      p95Ms: 1,
    });
    expect(report.counts).toMatchObject({
      accepted: 1,
      acceptedErrors: 0,
      noMatches: 1,
      noMatchFalseSuggestions: 0,
    });
    expect(report.oneSided95Upper.acceptedSuggestionErrorRate).toBeCloseTo(
      0.95,
    );
    expect(report.passed).toBe(false);
  });

  it("uses exact one-sided bounds instead of point rates for the quality gate", async () => {
    const cases = [
      ...Array.from({ length: 100 }, (_, index) => ({
        query: `positive ${index}`,
        candidates: [candidate("a"), candidate("b")],
        acceptableDigests: [D("a")],
      })),
      ...Array.from({ length: 160 }, (_, index) => ({
        query: `no match ${index}`,
        candidates: [candidate("a")],
        acceptableDigests: [],
      })),
    ];
    let index = 0;
    const runtime = {
      suggest: async () => {
        const current = index++;
        return current < 100
          ? { status: "suggestion", selectedDigest: D("a") }
          : { status: "no-match", selectedDigest: null };
      },
    };
    const thresholds = {
      acceptedSuggestionErrorRate: 0.05,
      noMatchFalseSuggestionRate: 0.02,
      affirmativeCoverage: 0.5,
      p95Ms: 10,
    };
    const clock = () => 0;
    const report = await runSkillDecisionBenchmark({
      runtime,
      cases,
      thresholds,
      clock,
    });
    expect(report.oneSided95Upper.acceptedSuggestionErrorRate).toBeCloseTo(
      1 - Math.pow(0.05, 1 / 100),
    );
    expect(report.oneSided95Upper.noMatchFalseSuggestionRate).toBeLessThan(
      0.02,
    );
    expect(report.passed).toBe(true);

    index = 0;
    const withOneFalseSuggestion = {
      suggest: async () => {
        const current = index++;
        return current < 100 || current === 100
          ? { status: "suggestion", selectedDigest: D("a") }
          : { status: "no-match", selectedDigest: null };
      },
    };
    const failed = await runSkillDecisionBenchmark({
      runtime: withOneFalseSuggestion,
      cases,
      thresholds,
      clock,
    });
    expect(failed.metrics.noMatchFalseSuggestionRate).toBeLessThan(0.02);
    expect(failed.oneSided95Upper.noMatchFalseSuggestionRate).toBeGreaterThan(
      0.02,
    );
    const upper = failed.oneSided95Upper.noMatchFalseSuggestionRate;
    expect((1 - upper) ** 160 + 160 * upper * (1 - upper) ** 159).toBeCloseTo(
      0.05,
      8,
    );
    expect(failed.passed).toBe(false);
  });

  it("keeps missing denominators inconclusive", async () => {
    const report = await runSkillDecisionBenchmark({
      runtime: { suggest: async () => ({ status: "abstain" }) },
      cases: [
        {
          query: "ordinary conversation",
          candidates: [candidate("a")],
          acceptableDigests: [],
        },
      ],
      thresholds: {
        acceptedSuggestionErrorRate: 0.05,
        noMatchFalseSuggestionRate: 0.02,
        affirmativeCoverage: 0,
        p95Ms: 10,
      },
      clock: () => 0,
    });
    expect(report.oneSided95Upper.acceptedSuggestionErrorRate).toBeNull();
    expect(report.passed).toBe(false);
  });

  it("rejects truth labels outside the supplied candidate set", async () => {
    await expect(
      runSkillDecisionBenchmark({
        runtime: { suggest: async () => ({ status: "no-match" }) },
        cases: [
          {
            query: "task",
            candidates: [candidate("a")],
            acceptableDigests: [D("missing")],
          },
        ],
        thresholds: {
          acceptedSuggestionErrorRate: 0,
          noMatchFalseSuggestionRate: 0,
          affirmativeCoverage: 0,
          p95Ms: 10,
        },
      }),
    ).rejects.toThrow("truth outside the candidates");
  });
});
