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
        acceptedSuggestionErrorRate: 0,
        noMatchFalseSuggestionRate: 0,
        affirmativeCoverage: 1,
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
    expect(report.passed).toBe(true);
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
