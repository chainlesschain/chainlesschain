import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildWikiSkillBenchmarkReport,
  createWikiSkillBenchmarkPlan,
  executeWikiSkillBenchmark,
  projectWikiSkillBenchmarkClaim,
  signWikiSkillBenchmarkReport,
  verifyWikiSkillBenchmarkPlan,
  verifyWikiSkillBenchmarkReport,
} from "../../src/lib/evolution/wikiskill-benchmark.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function makePlan() {
  return createWikiSkillBenchmarkPlan({
    gitCommit: "a".repeat(40),
    runnerDigest: D("runner"),
    model: { checkpoint: "example/model@revision", digest: D("model") },
    inference: { temperature: 0, topP: 1, maxTokens: 1024 },
    environment: {
      containerDigest: D("container"),
      vllmVersion: "0.10.1",
      hardware: "gpu-example",
    },
    datasets: Array.from({ length: 5 }, (_, index) => ({
      id: `dataset-${index}`,
      version: "1.0.0",
      digest: D(`dataset-${index}`),
      splitIds: ["case-a", "case-b"],
    })),
    toolDigest: D("tools"),
    apiDigest: D("api"),
    promptDigest: D("prompt"),
    skillDigest: D("skill"),
    wikiDigest: D("wiki"),
    seedSchedule: [11, 22, 33],
    bootstrapSamples: 1_000,
  });
}

function arm(label, score, overrides = {}) {
  return {
    score,
    traceDigest: D(`${label}-trace`),
    graderReceiptDigest: D(`${label}-grader`),
    failureClass: "none",
    tokens: 10,
    cost: 0.01,
    latencyMs: 100,
    ...overrides,
  };
}

function makeRuns(plan) {
  return plan.seedSchedule.map((seed) => ({
    runId: `run-${seed}`,
    seed,
    cases: plan.datasets.flatMap((dataset) =>
      dataset.splitIds.map((splitId) => ({
        datasetId: dataset.id,
        splitId,
        baseline: arm(`${seed}-${dataset.id}-${splitId}-baseline`, 0.5),
        skill: arm(`${seed}-${dataset.id}-${splitId}-skill`, 0.75),
      })),
    ),
  }));
}

describe("WikiSkill reproducible benchmark truth gate", () => {
  it("binds five datasets and at least three independent seeds into one immutable plan", () => {
    const plan = makePlan();

    expect(plan.datasets).toHaveLength(5);
    expect(plan.seedSchedule).toEqual([11, 22, 33]);
    expect(plan.bootstrapSamples).toBe(1_000);
    expect(
      plan.datasets.every((dataset) =>
        dataset.splitDigest.startsWith("sha256:"),
      ),
    ).toBe(true);
    expect(plan.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => {
      plan.seedSchedule.push(44);
    }).toThrow();
  });

  it("recomputes equal-dataset metrics, paired delta, CI, cost, latency and failure classes", () => {
    const plan = makePlan();
    const runs = makeRuns(plan);
    runs[0].cases[0].skill.failureClass = "tool";
    runs[0].cases[0].skill.latencyMs = 250;

    const report = buildWikiSkillBenchmarkReport({ plan, runs });

    expect(report.runCount).toBe(3);
    expect(report.pairedObservationCount).toBe(30);
    expect(report.perDataset).toHaveLength(5);
    expect(report.metrics.equalWeightBaseline).toBe(0.5);
    expect(report.metrics.equalWeightSkill).toBe(0.75);
    expect(report.metrics.delta).toBe(0.25);
    expect(report.metrics.pairedBootstrap95Ci).toEqual([0.25, 0.25]);
    expect(report.metrics.bootstrapSamples).toBe(1_000);
    expect(report.metrics.tokens).toBe(600);
    expect(report.metrics.cost).toBeCloseTo(0.6);
    expect(report.metrics.latencyMs.p99).toBeGreaterThan(100);
    expect(report.failureCounts.tool).toBe(1);
    expect(report.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("runs every no-skill/skill pair from zero with the exact preregistered inputs", async () => {
    const plan = makePlan();
    const requests = [];
    const report = await executeWikiSkillBenchmark({
      plan,
      runner: async (request) => {
        requests.push(request);
        return arm(
          `${request.seed}-${request.dataset.id}-${request.dataset.splitId}-${request.arm}`,
          request.arm === "skill" ? 0.75 : 0.5,
        );
      },
    });

    expect(requests).toHaveLength(60);
    expect(requests[0]).toMatchObject({
      planDigest: plan.planDigest,
      seed: 11,
      arm: "no-skill",
      skillDigest: null,
      wikiDigest: null,
    });
    expect(requests[1]).toMatchObject({
      planDigest: plan.planDigest,
      seed: 11,
      arm: "skill",
      skillDigest: plan.skillDigest,
      wikiDigest: plan.wikiDigest,
    });
    expect(report.runCount).toBe(3);
    expect(report.metrics.delta).toBe(0.25);
  });

  it("does not emit a report when the external runner returns incomplete evidence", async () => {
    const plan = makePlan();
    await expect(
      executeWikiSkillBenchmark({
        plan,
        runner: async (request) => {
          const result = arm(
            "incomplete",
            request.arm === "skill" ? 0.75 : 0.5,
          );
          if (request.seed === 22 && request.arm === "skill") {
            delete result.graderReceiptDigest;
          }
          return result;
        },
      }),
    ).rejects.toThrow("unexpected or missing fields");
  });

  it("fails closed when a run omits a split or reuses a seed", () => {
    const plan = makePlan();
    const missing = makeRuns(plan);
    missing[0].cases.pop();
    expect(() =>
      buildWikiSkillBenchmarkReport({ plan, runs: missing }),
    ).toThrow("does not cover every split");

    const duplicate = makeRuns(plan);
    duplicate[1].seed = duplicate[0].seed;
    expect(() =>
      buildWikiSkillBenchmarkReport({ plan, runs: duplicate }),
    ).toThrow("absent or duplicated");
  });

  it("rejects drift in a preregistered plan", () => {
    const plan = { ...makePlan(), runnerDigest: D("substituted-runner") };
    expect(() =>
      buildWikiSkillBenchmarkReport({ plan, runs: makeRuns(makePlan()) }),
    ).toThrow("plan digest mismatch");
  });

  it("revalidates exact plan structure and every derived report field", () => {
    const plan = makePlan();
    const report = buildWikiSkillBenchmarkReport({
      plan,
      runs: makeRuns(plan),
    });

    expect(verifyWikiSkillBenchmarkPlan(plan)).toEqual(plan);
    expect(verifyWikiSkillBenchmarkReport({ plan, report })).toEqual(report);
    expect(() =>
      verifyWikiSkillBenchmarkPlan({
        ...plan,
        datasets: plan.datasets.map((dataset, index) =>
          index === 0 ? { ...dataset, splitDigest: D("forged") } : dataset,
        ),
      }),
    ).toThrow("digest mismatch");
    expect(() =>
      verifyWikiSkillBenchmarkReport({
        plan,
        report: {
          ...report,
          metrics: { ...report.metrics, delta: report.metrics.delta + 0.1 },
        },
      }),
    ).toThrow("report digest mismatch");
  });

  it("keeps public claims on HOLD until an immutable report has a trusted signature", async () => {
    await expect(projectWikiSkillBenchmarkClaim()).resolves.toEqual({
      provenance: "external-paper-only",
      status: "HOLD",
      reportDigest: null,
      metrics: null,
    });

    const secret = "benchmark-test-authority";
    const report = buildWikiSkillBenchmarkReport({
      plan: makePlan(),
      runs: makeRuns(makePlan()),
    });
    const envelope = await signWikiSkillBenchmarkReport({
      report,
      attestor: async (reportDigest) => ({
        authority: "benchmark-ci",
        signature: createHmac("sha256", secret)
          .update(reportDigest)
          .digest("hex"),
      }),
    });
    const claim = await projectWikiSkillBenchmarkClaim({
      envelope,
      verifyAttestation: async ({ digest, attestation }) =>
        attestation.authority === "benchmark-ci" &&
        attestation.signature ===
          createHmac("sha256", secret).update(digest).digest("hex"),
    });

    expect(claim.provenance).toBe("chainlesschain-measured");
    expect(claim.status).toBe("VERIFIED");
    expect(claim.reportDigest).toBe(report.reportDigest);
  });

  it("rejects a substituted report even when the old attestation is retained", async () => {
    const report = buildWikiSkillBenchmarkReport({
      plan: makePlan(),
      runs: makeRuns(makePlan()),
    });
    const envelope = await signWikiSkillBenchmarkReport({
      report,
      attestor: async () => ({ authority: "benchmark-ci", signature: "test" }),
    });
    const tampered = {
      ...envelope,
      report: {
        ...envelope.report,
        metrics: { ...envelope.report.metrics, delta: 1 },
      },
    };

    await expect(
      projectWikiSkillBenchmarkClaim({
        envelope: tampered,
        verifyAttestation: async () => true,
      }),
    ).rejects.toThrow("report digest mismatch");
  });
});
