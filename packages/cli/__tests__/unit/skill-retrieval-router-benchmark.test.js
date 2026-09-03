import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { runSkillRetrievalBenchmark } from "../../src/lib/skill-retrieval-router-benchmark.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function corpus() {
  const skills = Array.from({ length: 50 }, (_, index) => {
    const key = String(index).padStart(2, "0");
    return {
      id: `skill-${key}`,
      displayName: `Domain ${key} specialist`,
      description: `handle domain${key} action${key} workflow reliably`,
      category: "benchmark",
      source: "workspace",
      version: "1.0.0",
      tags: ["benchmark"],
      paths: [],
      os: [],
      capabilities: ["workspace.read"],
      executionIdentity: { contentDigest: D(`skill-${key}`) },
    };
  });
  const cases = skills.flatMap((skill, index) => {
    const key = String(index).padStart(2, "0");
    return Array.from({ length: 10 }, (_, variant) => ({
      query: `please handle domain${key} action${key} workflow variant${variant}`,
      expectedDigest: skill.executionIdentity.contentDigest,
    }));
  });
  return { skills, cases };
}

describe("Skill retrieval router preregistered benchmark", () => {
  it("meets Recall@5, false invocation and local p95 gates across 500 prompts", () => {
    const report = runSkillRetrievalBenchmark({
      ...corpus(),
      thresholds: {
        recallAt5: 0.95,
        falseInvocationRate: 0.02,
        p95Ms: 100,
      },
    });
    expect(report.plan.caseCount).toBe(500);
    expect(report.metrics.recallAt5).toBeGreaterThanOrEqual(0.95);
    expect(report.metrics.falseInvocationRate).toBeLessThan(0.02);
    expect(report.metrics.p95Ms).toBeLessThan(100);
    expect(report.passed).toBe(true);
    expect(report.reportDigest).toMatch(/^sha256:/u);
  });

  it("fails a preregistered gate instead of changing its thresholds after the run", () => {
    let tick = 0;
    const report = runSkillRetrievalBenchmark({
      ...corpus(),
      thresholds: {
        recallAt5: 0.95,
        falseInvocationRate: 0.02,
        p95Ms: 1,
      },
      clock: () => {
        tick += 2;
        return tick;
      },
    });
    expect(report.metrics.p95Ms).toBe(2);
    expect(report.passed).toBe(false);
    expect(report.plan.thresholds.p95Ms).toBe(1);
  });

  it("rejects invalid expected digests before routing", () => {
    const input = corpus();
    input.cases[0].expectedDigest = "mutable-name";
    expect(() =>
      runSkillRetrievalBenchmark({
        ...input,
        thresholds: {
          recallAt5: 0.95,
          falseInvocationRate: 0.02,
          p95Ms: 100,
        },
      }),
    ).toThrow("benchmark case 0");
  });

  it("rejects a valid digest that is absent from the fixed corpus", () => {
    const input = corpus();
    input.cases[0].expectedDigest = D("not-in-corpus");
    expect(() =>
      runSkillRetrievalBenchmark({
        ...input,
        thresholds: {
          recallAt5: 0.95,
          falseInvocationRate: 0.02,
          p95Ms: 100,
        },
      }),
    ).toThrow("absent from the corpus");
  });
});
