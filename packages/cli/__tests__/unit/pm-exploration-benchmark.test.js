import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  assertPmExplorationTrainingSources,
  buildPmExplorationEffectPlan,
  buildPmExplorationEffectReport,
  buildPmExplorationEffectSlotManifest,
  buildPmExplorationLaunchProfile,
  buildPmExplorationRoundPlan,
  buildPmExplorationSuite,
  inspectPmExplorationEnvironment,
  inspectPmExplorationEffectPlan,
  projectPmExplorationTrainingView,
  verifyPmExplorationEffectReport,
  verifyPmExplorationEffectPlan,
  verifyPmExplorationEffectSlotManifest,
} from "../../src/lib/evolution/pm-exploration-benchmark.js";
import {
  buildEvolutionEvalPolicy,
  buildEvolutionEvalSuite,
  computeEvolutionEvalTrainingPartitionDigest,
  verifyEvolutionEvalSuite,
} from "../../src/lib/evolution/evolution-eval-gate.js";

const budget = { maxTokens: 10000, maxToolCalls: 40, maxWallClockMs: 60000 };
const hash = (text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

function evalPolicy(overrides = {}) {
  return buildEvolutionEvalPolicy({
    policyId: "pm-effect-v1",
    minTrainingTasks: 30,
    minValidationTasks: 20,
    minTestTasks: 20,
    seeds: [101, 202, 303],
    minimumAbsoluteImprovement: 0.05,
    minimumEfficiencyImprovement: 0.1,
    confidenceZ: 1.96,
    maxAverageTokens: 10_000,
    maxAverageLatencyMs: 60_000,
    maxAverageToolCalls: 100,
    maxTotalTokens: 1_000_000,
    maxTotalLatencyMs: 10_000_000,
    maxTotalToolCalls: 100_000,
    maxTotalCostMicrounits: 1_000_000,
    maxExecutions: 240,
    maxWallClockMs: 30_000,
    portReceiptTtlMs: 60_000,
    receiptTtlMs: 60_000,
    ...overrides,
  });
}

function effectPlanInput(overrides = {}) {
  return {
    experimentId: "pm-equal-budget-v1",
    suite: effectSuite(),
    policy: evalPolicy(),
    baselineVersion: {
      id: "baseline-memory-v1",
      artifactDigest: hash("baseline-memory-v1"),
    },
    candidateVersion: {
      id: "candidate-memory-v2",
      artifactDigest: hash("candidate-memory-v2"),
    },
    actorConfigDigest: hash("actor-config"),
    modelConfigDigest: hash("model-config"),
    toolPolicyDigest: hash("tool-policy"),
    permissionPolicyDigest: hash("permission-policy"),
    environmentDigest: hash("environment"),
    resetProtocolDigest: hash("reset-protocol"),
    seeds: [101, 202, 303],
    budgetPerArmPerSeed: {
      maxTokens: 10_000,
      maxToolCalls: 100,
      maxWallClockMs: 60_000,
      maxCostMicrounits: 100_000,
    },
    minimumPassRateDelta: 0.05,
    minimumIndependentGroups: 2,
    ...overrides,
  };
}

function effectPlan(overrides = {}) {
  return buildPmExplorationEffectPlan(effectPlanInput(overrides));
}

const zeroUsage = () => ({
  receiptDigest: null,
  tokens: 0,
  toolCalls: 0,
  wallClockMs: 0,
  costMicrounits: 0,
});

const phases = (candidate = false) =>
  [
    "exploration",
    "curriculum-planning",
    "memory-distillation",
    "failure-retry",
    "environment-reset",
  ].map((phase, index) => ({
    phase,
    usage:
      candidate && index < 3
        ? {
            receiptDigest: hash(`${phase}-receipt`),
            tokens: 10,
            toolCalls: 1,
            wallClockMs: 5,
            costMicrounits: 2,
          }
        : zeroUsage(),
  }));

function arm(label, score, overrides = {}) {
  return {
    outcomeReceiptDigest: hash(`${label}-outcome`),
    graderReceiptDigest: hash(`${label}-grader`),
    score,
    passed: score === 1,
    usage: {
      receiptDigest: hash(`${label}-usage`),
      tokens: 100,
      toolCalls: 2,
      wallClockMs: 50,
      costMicrounits: 20,
    },
    securityViolations: 0,
    permissionViolations: 0,
    failureClass: "none",
    ...overrides,
  };
}

function effectRuns(seeds = [101, 202, 303]) {
  return seeds.map((seed) => ({
    runId: `run-${seed}`,
    seed,
    phases: { baseline: phases(), candidate: phases(true) },
    cases: ["pm-test", "pm-test-other"].map((taskId) => ({
      taskId,
      baseline: arm(`baseline-${taskId}-${seed}`, 0.5),
      candidate: arm(`candidate-${taskId}-${seed}`, 1),
    })),
  }));
}

function effectSuite() {
  return buildPmExplorationSuite(effectSuiteInput());
}

function effectSuiteInput() {
  const source = input();
  const second = structuredClone(source.tasks[2]);
  second.id = "pm-test-other";
  for (const key of Object.keys(second.groups)) second.groups[key] += "-other";
  source.tasks.push(second);
  return source;
}

function input() {
  return {
    suiteId: "pm-pilot",
    datasetVersion: "v1",
    tasks: ["training", "validation", "test"].map((split) => ({
      id: `pm-${split}`,
      split,
      groups: {
        template: `${split}-workflow-family`,
        project: `${split}-project`,
        principal: `${split}-principal`,
        timeWindow: `${split}-time-window`,
      },
      prompt: `Complete the ${split} project lifecycle`,
      expected: {
        kind: "project-state",
        id: `private-${split}`,
        name: `private-name-${split}`,
        status: "completed",
      },
    })),
  };
}

describe("PM exploration suite", () => {
  it("reuses immutable Eval Gate tasks and the exact training partition binding", () => {
    const source = input();
    const suite = buildPmExplorationSuite(source);
    expect(verifyEvolutionEvalSuite(suite)).toEqual(suite);
    expect(Object.isFrozen(suite.tasks[0].privateExpected)).toBe(true);
    const view = projectPmExplorationTrainingView(suite);
    expect(view.tasks).toEqual([
      { id: "pm-training", publicInput: { prompt: source.tasks[0].prompt } },
    ]);
    expect(Object.isFrozen(view.tasks)).toBe(true);
    expect(view.trainingPartitionDigest).toBe(
      computeEvolutionEvalTrainingPartitionDigest(suite),
    );
    source.tasks[0].expected.name = "changed-after-build";
    expect(suite.tasks[0].privateExpected.name).toBe("private-name-training");
    const serialized = JSON.stringify(view);
    for (const forbidden of [
      "private-",
      "pm-test",
      "pm-validation",
      "privateExpected",
      "graderId",
      "groupKeys",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it.each(["template", "project", "principal", "timeWindow"])(
    "rejects cross-partition %s reuse even when names differ",
    (group) => {
      const source = input();
      source.tasks[2].groups[group] = source.tasks[0].groups[group];
      expect(() => buildPmExplorationSuite(source)).toThrow(/crosses/);
    },
  );

  it("rejects identical public input across splits", () => {
    const source = input();
    source.tasks[2].prompt = source.tasks[0].prompt;
    expect(() => buildPmExplorationSuite(source)).toThrow(
      /identical public input/,
    );
  });

  it("rejects missing partitions and duplicate IDs", () => {
    const source = input();
    source.tasks[2].split = "validation";
    expect(() => buildPmExplorationSuite(source)).toThrow(
      /all three partitions/,
    );
    source.tasks[2].split = "test";
    source.tasks[2].id = source.tasks[0].id;
    expect(() => buildPmExplorationSuite(source)).toThrow(/duplicate/);
  });

  it("rejects a tampered suite before deriving any binding or view", () => {
    const suite = structuredClone(buildPmExplorationSuite(input()));
    suite.tasks[2].privateExpected.name = "tampered";
    expect(() => projectPmExplorationTrainingView(suite)).toThrow(/digest/);
    expect(() => computeEvolutionEvalTrainingPartitionDigest(suite)).toThrow(
      /digest/,
    );
  });

  it("binds only explicitly listed training sources", () => {
    const suite = buildPmExplorationSuite(input());
    const { trainingPartitionDigest } = projectPmExplorationTrainingView(suite);
    expect(
      assertPmExplorationTrainingSources(suite, {
        trainingPartitionDigest,
        sourceTaskIds: ["pm-training"],
      }).sourceTaskIds,
    ).toEqual(["pm-training"]);
    for (const sourceTaskIds of [
      ["pm-test"],
      ["pm-validation"],
      ["unknown"],
      [],
      ["pm-training", "pm-training"],
    ])
      expect(() =>
        assertPmExplorationTrainingSources(suite, {
          trainingPartitionDigest,
          sourceTaskIds,
        }),
      ).toThrow();
    expect(() =>
      assertPmExplorationTrainingSources(suite, {
        trainingPartitionDigest: hash("another-partition"),
        sourceTaskIds: ["pm-training"],
      }),
    ).toThrow(/binding mismatch/);
  });

  it("invalidates the training binding when the frozen suite changes", () => {
    const source = input();
    const before = projectPmExplorationTrainingView(
      buildPmExplorationSuite(source),
    );
    source.datasetVersion = "v2";
    const after = projectPmExplorationTrainingView(
      buildPmExplorationSuite(source),
    );
    expect(after.trainingPartitionDigest).not.toBe(
      before.trainingPartitionDigest,
    );
  });

  it("derives the round protocol task allowlist from the verified training view", () => {
    const suite = buildPmExplorationSuite(input());
    const training = projectPmExplorationTrainingView(suite);
    const plan = buildPmExplorationRoundPlan(suite, {
      planId: "pm-pilot-rounds",
      environmentDigest: hash("desktop-readiness"),
      initialMemoryDigest: hash("memory-initial"),
      broadBranchIds: ["workflow", "permissions"],
      maxRounds: 8,
      maxTokens: budget.maxTokens,
      maxToolCalls: budget.maxToolCalls,
      maxWallClockMs: budget.maxWallClockMs,
      maxConsecutiveNoGain: 3,
    });
    expect(plan.suiteDigest).toBe(suite.suiteDigest);
    expect(plan.trainingPartitionDigest).toBe(training.trainingPartitionDigest);
    expect(plan.trainingTaskIds).toEqual(["pm-training"]);
    expect(JSON.stringify(plan)).not.toContain("pm-validation");
    expect(JSON.stringify(plan)).not.toContain("pm-test");

    const tampered = structuredClone(suite);
    tampered.tasks[0].publicInput.prompt = "changed after signing";
    expect(() =>
      buildPmExplorationRoundPlan(tampered, {
        planId: "pm-pilot-rounds",
        environmentDigest: hash("desktop-readiness"),
        initialMemoryDigest: hash("memory-initial"),
        broadBranchIds: ["workflow"],
        maxRounds: 4,
        maxTokens: 100,
        maxToolCalls: 10,
        maxWallClockMs: 1000,
        maxConsecutiveNoGain: 2,
      }),
    ).toThrow(/digest/);
  });

  it("supports bounded file-export expectations, not executable grader code", () => {
    const source = input();
    source.tasks[0].expected = {
      kind: "file-export",
      relativePath: "out/requirements.md",
      sha256: hash("requirements"),
    };
    expect(buildPmExplorationSuite(source).tasks[0].taskType).toBe("file");
    source.tasks[0].expected.code = "return true";
    expect(() => buildPmExplorationSuite(source)).toThrow();
  });

  it("rejects extra input fields, accessor properties and foreign canonical suites", () => {
    const source = input();
    source.tasks[0].hiddenAnswer = "must not be public";
    expect(() => buildPmExplorationSuite(source)).toThrow(/fields/);
    const accessed = input();
    Object.defineProperty(accessed.tasks[0], "prompt", {
      enumerable: true,
      get() {
        throw new Error("getter executed");
      },
    });
    expect(() => buildPmExplorationSuite(accessed)).toThrow(/fields/);
    const canonical = buildPmExplorationSuite(input());
    const foreign = buildEvolutionEvalSuite({
      suiteId: canonical.suiteId,
      datasetVersion: canonical.datasetVersion,
      tasks: canonical.tasks.map((entry) => {
        const task = { ...entry, graderId: "other-grader" };
        delete task.schema;
        delete task.taskDigest;
        return task;
      }),
    });
    expect(() => projectPmExplorationTrainingView(foreign)).toThrow(/not a PM/);
  });
});

describe("PM equal-budget effect evidence", () => {
  it("reads historical v1 bytes without upgrading the metric or rewriting digests", () => {
    const { plan, report } = JSON.parse(
      readFileSync(
        new URL("../fixtures/pm-exploration-effect-v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(verifyPmExplorationEffectPlan(plan)).toEqual(plan);
    expect(verifyPmExplorationEffectReport({ plan, report })).toEqual(report);
    expect(report.schema).toBe(
      "chainlesschain.pm-exploration-effect-report/v1",
    );
    expect(report.pairedPassRateDelta).toBeUndefined();
    expect(report.qualifiesForPromotion).toBe(false);
    expect(() =>
      verifyPmExplorationEffectReport({ plan: effectPlan(), report }),
    ).toThrow();
  });

  it("freezes both versions, protocol digests, seeds and one equal arm budget", () => {
    const plan = effectPlan();
    expect(plan).toMatchObject({
      schema: "chainlesschain.pm-exploration-effect-plan/v2",
      testTaskIds: ["pm-test", "pm-test-other"],
      seeds: [101, 202, 303],
      equalBudget: true,
      promotionAuthority: false,
      bootstrapSamples: 1_000,
      primaryMetric: "strict-completion-rate",
      resamplingUnit: "task-group-component",
      minimumIndependentGroups: 2,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.budgetPerArmPerSeed)).toBe(true);
    expect(() => effectPlan({ seeds: [101, 202, 404] })).toThrow(
      /policy seeds/,
    );
  });

  it("recomputes paired outcomes and accounts for all preparation phases", () => {
    const plan = effectPlan();
    const report = buildPmExplorationEffectReport({
      plan,
      runs: effectRuns(),
    });
    expect(report).toMatchObject({
      runCount: 3,
      pairedObservationCount: 6,
      evidenceDecision: "threshold-met",
      budgetViolationCount: 0,
      requiresIndependentPilotApproval: true,
      qualifiesForPromotion: false,
      baseline: {
        meanScore: 0.5,
        passCount: 0,
        failureCount: 6,
        failureCounts: { incomplete: 6 },
        usage: { tokens: 600 },
      },
      candidate: {
        meanScore: 1,
        passCount: 6,
        failureCount: 0,
        usage: { tokens: 690 },
      },
      pairedScoreDelta: {
        mean: 0.5,
        bootstrap95Ci: [0.5, 0.5],
      },
      independentGroupCount: 2,
      pairedPassRateDelta: { mean: 1, bootstrap95Ci: [1, 1] },
    });
    expect(verifyPmExplorationEffectReport({ plan, report })).toEqual(report);
    expect(Object.isFrozen(report.runs[0].cases[0].candidate)).toBe(true);
  });

  it("fails closed on safety regression or an exceeded arm budget", () => {
    const plan = effectPlan();
    const unsafe = effectRuns();
    unsafe[1].cases[0].candidate.permissionViolations = 1;
    unsafe[1].cases[0].candidate.passed = false;
    unsafe[1].cases[0].candidate.failureClass = "permission";
    expect(
      buildPmExplorationEffectReport({ plan, runs: unsafe }).evidenceDecision,
    ).toBe("threshold-not-met");

    const overBudget = effectRuns();
    overBudget[0].cases[0].candidate.usage.tokens = 10_001;
    const report = buildPmExplorationEffectReport({
      plan,
      runs: overBudget,
    });
    expect(report.budgetViolationCount).toBe(1);
    expect(report.evidenceDecision).toBe("threshold-not-met");
  });

  it("does not accept higher partial scores as a completion-rate improvement", () => {
    const runs = effectRuns();
    for (const run of runs) {
      for (const item of run.cases) {
        item.candidate.score = 0.99;
        item.candidate.passed = false;
      }
    }
    const report = buildPmExplorationEffectReport({ plan: effectPlan(), runs });
    expect(report.pairedScoreDelta.mean).toBeCloseTo(0.49);
    expect(report.pairedPassRateDelta).toEqual({
      mean: 0,
      bootstrap95Ci: [0, 0],
    });
    expect(report.evidenceDecision).toBe("threshold-not-met");
    expect(
      buildPmExplorationEffectReport({
        plan: effectPlan({ minimumPassRateDelta: 0 }),
        runs,
      }).evidenceDecision,
    ).toBe("threshold-not-met");
  });

  it.each([
    { score: 0.99 },
    { failureClass: "timeout" },
    { permissionViolations: 1 },
    { securityViolations: 1 },
  ])("rejects contradictory complete passes: %j", (changes) => {
    const runs = effectRuns();
    Object.assign(runs[0].cases[0].candidate, changes);
    expect(() =>
      buildPmExplorationEffectReport({ plan: effectPlan(), runs }),
    ).toThrow(/complete, safe outcome/);
  });

  it.each(["setup", "timeout", "grader", "cancelled"])(
    "counts ungraded %s failures in the full denominator and keeps their cost",
    (failureClass) => {
      const runs = effectRuns();
      for (const run of runs)
        for (const item of run.cases) {
          Object.assign(item.candidate, {
            passed: false,
            score: 0,
            failureClass,
            graderReceiptDigest: null,
          });
        }
      const report = buildPmExplorationEffectReport({
        plan: effectPlan(),
        runs,
      });
      expect(report.candidate).toMatchObject({
        sampleCount: 6,
        passCount: 0,
        failureCount: 6,
        passRate: 0,
        failureCounts: { [failureClass]: 6 },
        usage: { tokens: 690 },
      });
      expect(report.evidenceDecision).toBe("threshold-not-met");
      expect(() => {
        runs[0].cases[0].candidate.outcomeReceiptDigest = null;
        buildPmExplorationEffectReport({ plan: effectPlan(), runs });
      }).toThrow(/outcomeReceiptDigest/);
    },
  );

  it("requires grader evidence for passes and nonzero partial scores", () => {
    const runs = effectRuns();
    runs[0].cases[0].candidate.graderReceiptDigest = null;
    expect(() =>
      buildPmExplorationEffectReport({ plan: effectPlan(), runs }),
    ).toThrow(/graderReceiptDigest/);
    Object.assign(runs[0].cases[0].candidate, {
      score: 0.5,
      passed: false,
      failureClass: "grader",
    });
    expect(() =>
      buildPmExplorationEffectReport({ plan: effectPlan(), runs }),
    ).toThrow(/graderReceiptDigest/);
  });

  it("blocks a contaminated baseline even when the candidate passes safely", () => {
    const runs = effectRuns();
    runs[0].cases[0].baseline.securityViolations = 1;
    expect(
      buildPmExplorationEffectReport({ plan: effectPlan(), runs })
        .evidenceDecision,
    ).toBe("threshold-not-met");
  });

  it("keeps seed repetitions inside task clusters instead of narrowing uncertainty", () => {
    const compare = (seeds) => {
      const plan = effectPlan({ seeds, policy: evalPolicy({ seeds }) });
      const runs = effectRuns(seeds);
      for (const run of runs) {
        run.cases[1].baseline = arm(`baseline-loss-${run.seed}`, 1);
        run.cases[1].candidate = arm(`candidate-loss-${run.seed}`, 0);
      }
      return buildPmExplorationEffectReport({ plan, runs });
    };
    const first = compare([101, 202, 303]);
    const repeated = compare([101, 202, 303, 404, 505, 606]);
    expect(first.pairedPassRateDelta).toEqual({
      mean: 0,
      bootstrap95Ci: [-1, 1],
    });
    expect(repeated.pairedPassRateDelta).toEqual(first.pairedPassRateDelta);
    expect(repeated.independentGroupCount).toBe(2);
    expect(repeated.pairedObservationCount).toBe(12);
  });

  it("joins transitive shared groups and reports insufficient independent evidence", () => {
    const source = effectSuiteInput();
    const third = structuredClone(source.tasks[3]);
    third.id = "pm-test-third";
    for (const key of Object.keys(third.groups)) third.groups[key] += "-third";
    source.tasks[3].groups.template = source.tasks[2].groups.template;
    third.groups.project = source.tasks[3].groups.project;
    source.tasks.push(third);
    const plan = effectPlan({ suite: buildPmExplorationSuite(source) });
    const runs = effectRuns();
    for (const run of runs)
      run.cases.push({
        taskId: third.id,
        baseline: arm(`baseline-third-${run.seed}`, 0),
        candidate: arm(`candidate-third-${run.seed}`, 1),
      });
    const report = buildPmExplorationEffectReport({ plan, runs });
    expect(report).toMatchObject({
      independentGroupCount: 1,
      pairedPassRateDelta: { mean: 1, bootstrap95Ci: null },
      evidenceDecision: "insufficient-evidence",
      qualifiesForPromotion: false,
    });
    expect(verifyPmExplorationEffectReport({ plan, report })).toEqual(report);
  });

  it("honors the preregistered independent-group minimum", () => {
    const report = buildPmExplorationEffectReport({
      plan: effectPlan({ minimumIndependentGroups: 3 }),
      runs: effectRuns(),
    });
    expect(report.independentGroupCount).toBe(2);
    expect(report.evidenceDecision).toBe("insufficient-evidence");
    expect(() => effectPlan({ minimumIndependentGroups: 1 })).toThrow();
  });

  it("keeps unequal-size clusters task-weighted and never counts their tasks independently", () => {
    const source = effectSuiteInput();
    const third = structuredClone(source.tasks[2]);
    third.id = "pm-test-same-family";
    source.tasks.push(third);
    const plan = effectPlan({ suite: buildPmExplorationSuite(source) });
    const runs = effectRuns();
    for (const run of runs) {
      run.cases[1].baseline = arm(`baseline-loss-${run.seed}`, 1);
      run.cases[1].candidate = arm(`candidate-loss-${run.seed}`, 0);
      run.cases.push({
        taskId: third.id,
        baseline: arm(`baseline-third-${run.seed}`, 0),
        candidate: arm(`candidate-third-${run.seed}`, 1),
      });
    }
    const report = buildPmExplorationEffectReport({ plan, runs });
    expect(report.independentGroupCount).toBe(2);
    expect(report.pairedPassRateDelta).toEqual({
      mean: 1 / 3,
      bootstrap95Ci: [-1, 1],
    });
    expect(report.evidenceDecision).toBe("threshold-not-met");
  });

  it.each(["principal", "timeWindow"])(
    "clusters shared %s keys as well as workflow families",
    (key) => {
      const source = effectSuiteInput();
      source.tasks[3].groups[key] = source.tasks[2].groups[key];
      const report = buildPmExplorationEffectReport({
        plan: effectPlan({ suite: buildPmExplorationSuite(source) }),
        runs: effectRuns(),
      });
      expect(report.independentGroupCount).toBe(1);
      expect(report.evidenceDecision).toBe("insufficient-evidence");
    },
  );

  it("does not hide a known safety failure behind insufficient sample size", () => {
    const runs = effectRuns();
    runs[0].cases[0].baseline.permissionViolations = 1;
    const report = buildPmExplorationEffectReport({
      plan: effectPlan({ minimumIndependentGroups: 3 }),
      runs,
    });
    expect(report.evidenceDecision).toBe("threshold-not-met");
  });

  it("detects tampering with the primary metric and independent group count", () => {
    const plan = effectPlan();
    const report = structuredClone(
      buildPmExplorationEffectReport({ plan, runs: effectRuns() }),
    );
    report.pairedPassRateDelta.mean = 0.9;
    expect(() => verifyPmExplorationEffectReport({ plan, report })).toThrow(
      /digest mismatch/,
    );
    report.pairedPassRateDelta.mean = 1;
    report.independentGroupCount = 3;
    expect(() => verifyPmExplorationEffectReport({ plan, report })).toThrow(
      /digest mismatch/,
    );
  });

  it("binds grouping into the plan and refuses result-time regrouping", () => {
    const plan = structuredClone(effectPlan());
    plan.taskGroups[1].groupKeys = [...plan.taskGroups[0].groupKeys];
    expect(() => verifyPmExplorationEffectPlan(plan)).toThrow(
      /digest mismatch/,
    );
    plan.taskGroups[1].taskId = plan.taskGroups[0].taskId;
    expect(() => verifyPmExplorationEffectPlan(plan)).toThrow(/group binding/);
  });

  it("canonicalizes task and seed ordering and rejects duplicated run IDs", () => {
    const plan = effectPlan();
    const runs = effectRuns();
    const report = buildPmExplorationEffectReport({ plan, runs });
    runs.reverse();
    runs.forEach((run) => run.cases.reverse());
    expect(buildPmExplorationEffectReport({ plan, runs })).toEqual(report);
    runs[0].runId = runs[1].runId;
    expect(() => buildPmExplorationEffectReport({ plan, runs })).toThrow(
      /runId is duplicated/,
    );
  });

  it("refuses usage totals that cannot be represented exactly", () => {
    const runs = effectRuns();
    runs[0].cases[0].candidate.usage.tokens = Number.MAX_SAFE_INTEGER;
    expect(() =>
      buildPmExplorationEffectReport({ plan: effectPlan(), runs }),
    ).toThrow(/safe integer/);
  });

  it("does not invoke array accessors in effect plans or runs", () => {
    const getter = vi.fn(() => 101);
    const plan = structuredClone(effectPlan());
    Object.defineProperty(plan.seeds, "0", { enumerable: true, get: getter });
    expect(() => verifyPmExplorationEffectPlan(plan)).toThrow(/accessor/);
    const runs = effectRuns();
    Object.defineProperty(runs, "0", { enumerable: true, get: getter });
    expect(() =>
      buildPmExplorationEffectReport({ plan: effectPlan(), runs }),
    ).toThrow(/accessor/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects incomplete pairs, duplicate seeds, phase omissions and tampering", () => {
    const plan = effectPlan();
    const missing = effectRuns();
    missing[0].cases = [];
    expect(() =>
      buildPmExplorationEffectReport({ plan, runs: missing }),
    ).toThrow(/every test task/);

    const duplicateSeed = effectRuns();
    duplicateSeed[1].seed = duplicateSeed[0].seed;
    expect(() =>
      buildPmExplorationEffectReport({ plan, runs: duplicateSeed }),
    ).toThrow(/absent or duplicated/);

    const omittedPhase = effectRuns();
    omittedPhase[0].phases.candidate.pop();
    expect(() =>
      buildPmExplorationEffectReport({ plan, runs: omittedPhase }),
    ).toThrow(/every cost phase/);

    const report = structuredClone(
      buildPmExplorationEffectReport({ plan, runs: effectRuns() }),
    );
    report.candidate.meanScore = 0.25;
    expect(() => verifyPmExplorationEffectReport({ plan, report })).toThrow(
      /digest mismatch/,
    );

    const accessorReport = structuredClone(
      buildPmExplorationEffectReport({ plan, runs: effectRuns() }),
    );
    const getter = vi.fn(() => 1);
    Object.defineProperty(accessorReport.candidate, "meanScore", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      verifyPmExplorationEffectReport({ plan, report: accessorReport }),
    ).toThrow(/accessor/);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("PM launch profile and preflight", () => {
  it("pins both guards to enforce and retains real persistence/init", () => {
    const profile = buildPmExplorationLaunchProfile(budget);
    expect(profile.environment).toMatchObject({
      NODE_ENV: "production",
      CC_IPC_ACTOR_GUARD: "enforce",
      CC_IPC_RBAC_GUARD: "enforce",
      MOCK_LLM: "false",
      CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: "0",
      SKIP_SLOW_INIT: "false",
    });
    expect(Object.isFrozen(profile.environment)).toBe(true);
    expect(profile.productionQualified).toBe(false);
  });

  it.each([0, -1, NaN, Infinity, 1.5, "100", Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid budget %s",
    (value) => {
      expect(() =>
        buildPmExplorationLaunchProfile({ ...budget, maxTokens: value }),
      ).toThrow();
    },
  );

  it("never authorizes launch from configuration or caller-supplied readiness flags", () => {
    const environment = {
      ...buildPmExplorationLaunchProfile(budget).environment,
      authenticated: true,
      ready: true,
    };
    expect(inspectPmExplorationEnvironment(environment)).toMatchObject({
      configurationCompatible: true,
      status: "requires-host-verification",
      launchAllowed: false,
      runtimeVerified: false,
      productionQualified: false,
    });
  });

  it.each([
    ["MOCK_LLM", "true"],
    ["MOCK_HARDWARE", "true"],
    ["CC_IPC_ACTOR_GUARD", "off"],
    ["CC_IPC_RBAC_GUARD", "report"],
    ["CC_IPC_RBAC_GUARD", undefined],
    ["CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE", "1"],
    ["SKIP_SLOW_INIT", "true"],
  ])("rejects incompatible %s without echoing raw values", (key, value) => {
    const environment = {
      ...buildPmExplorationLaunchProfile(budget).environment,
      [key]: value,
      API_KEY: "never-echo-this",
    };
    const result = inspectPmExplorationEnvironment(environment);
    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.variable === key)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("never-echo-this");
  });

  it("does not invoke environment getters", () => {
    const environment = Object.defineProperty({}, "MOCK_LLM", {
      get() {
        throw new Error("called");
      },
    });
    expect(inspectPmExplorationEnvironment(environment).status).toBe("blocked");
  });
});

describe("PM effect planning diagnostics", () => {
  it("reports the frozen schedule and actual groups without runtime approval", () => {
    const plan = effectPlan();
    const inspection = inspectPmExplorationEffectPlan(plan);
    expect(inspection).toMatchObject({
      planDigest: plan.planDigest,
      status: "group-count-satisfied",
      testTaskCount: 2,
      plannedRunCount: 3,
      plannedPairedObservationCount: 6,
      plannedArmObservationCount: 12,
      independentGroupCount: 2,
      independentGroups: [["pm-test"], ["pm-test-other"]],
      runtimeVerified: false,
      evidenceAuthenticated: false,
      qualifiesForPromotion: false,
    });
    expect(Object.isFrozen(inspection.independentGroups[0])).toBe(true);
    expect(inspection.independentGroupCount).toBe(
      buildPmExplorationEffectReport({ plan, runs: effectRuns() })
        .independentGroupCount,
    );
  });

  it("reveals transitive dependencies before any observations exist", () => {
    const source = effectSuiteInput();
    const third = structuredClone(source.tasks[3]);
    third.id = "pm-test-third";
    source.tasks.push(third);
    source.tasks[3].groups.template = source.tasks[2].groups.template;
    const inspection = inspectPmExplorationEffectPlan(
      effectPlan({ suite: buildPmExplorationSuite(source) }),
    );
    expect(inspection.status).toBe("insufficient-independent-groups");
    expect(inspection.independentGroups).toEqual([
      ["pm-test", "pm-test-other", "pm-test-third"],
    ]);
    expect(inspection.plannedPairedObservationCount).toBe(9);
  });

  it("does not reinterpret historical plans as current completion plans", () => {
    const legacy = JSON.parse(
      readFileSync(
        new URL("../fixtures/pm-exploration-effect-v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(() => inspectPmExplorationEffectPlan(legacy.plan)).toThrow(/v2/);
  });
});

describe("PM effect workflow script", () => {
  const script = fileURLToPath(
    new URL("../../scripts/pm-exploration-effect.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
  function withFiles(test) {
    const root = mkdtempSync(path.join(tmpdir(), "pm effect workflow "));
    const write = (name, value) => {
      const target = path.join(root, name);
      writeFileSync(
        target,
        Buffer.isBuffer(value) ? value : JSON.stringify(value),
      );
      return target;
    };
    try {
      test(write, root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("freezes, inspects, reports and verifies using actual UTF-8 files", () => {
    withFiles((write) => {
      const input = effectPlanInput();
      const sourceBytes = Buffer.from(`\ufeff${JSON.stringify(input)}`);
      const source = write("private input.json", sourceBytes);
      const frozen = run("plan", "--input", source);
      expect(frozen.status).toBe(0);
      const plan = JSON.parse(frozen.stdout);
      expect(plan).toEqual(effectPlan());
      expect(frozen.stdout).not.toContain("privateExpected");
      expect(frozen.stdout).not.toContain("Complete the");
      const planFile = write("frozen plan.json", plan);
      const inspection = run("inspect", "--plan", planFile);
      expect(inspection.status).toBe(0);
      expect(JSON.parse(inspection.stdout).plannedArmObservationCount).toBe(12);
      const runs = effectRuns();
      const runsFile = write("observations.json", runs);
      const reported = run(
        "report",
        "--plan",
        planFile,
        "--plan-digest",
        plan.planDigest,
        "--runs",
        runsFile,
      );
      expect(reported.status).toBe(0);
      expect(reported.stderr).toContain("not authenticated");
      const report = JSON.parse(reported.stdout);
      expect(report).toEqual(buildPmExplorationEffectReport({ plan, runs }));
      expect(report.qualifiesForPromotion).toBe(false);
      const reportFile = write("report.json", report);
      const verified = run(
        "verify",
        "--plan",
        planFile,
        "--plan-digest",
        plan.planDigest,
        "--report",
        reportFile,
      );
      expect(verified.status).toBe(0);
      expect(JSON.parse(verified.stdout)).toEqual(report);
      expect(readFileSync(source)).toEqual(sourceBytes);
      expect(JSON.parse(readFileSync(runsFile, "utf8"))).toEqual(runs);
      expect(JSON.parse(readFileSync(planFile, "utf8"))).toEqual(plan);
    });
  });

  it("freezes and verifies a slot manifest using actual UTF-8 files", () => {
    withFiles((write) => {
      const plan = effectPlan();
      const planFile = write("frozen plan.json", plan);
      const slotInput = {
        cohortId: "pm-cohort-1",
        slotIds: ["run-a", "run-b"],
      };
      const slotFile = write("slot input.json", slotInput);
      const frozen = run(
        "slots",
        "--plan",
        planFile,
        "--plan-digest",
        plan.planDigest,
        "--slots",
        slotFile,
      );
      expect(frozen.status).toBe(0);
      const manifest = JSON.parse(frozen.stdout);
      expect(manifest).toEqual(
        buildPmExplorationEffectSlotManifest({ plan, ...slotInput }),
      );
      expect(verifyPmExplorationEffectSlotManifest({ plan, manifest })).toEqual(
        manifest,
      );
      expect(manifest.plannedTestObservationsPerArm).toBe(12);
      const manifestFile = write("slot manifest.json", manifest);
      const verified = run(
        "verify-slots",
        "--plan",
        planFile,
        "--plan-digest",
        plan.planDigest,
        "--manifest",
        manifestFile,
      );
      expect(verified.status).toBe(0);
      expect(JSON.parse(verified.stdout)).toEqual(manifest);
      expect(readFileSync(slotFile, "utf8")).toBe(JSON.stringify(slotInput));
      expect(readFileSync(manifestFile, "utf8")).toBe(JSON.stringify(manifest));
    });
  });

  it("rejects slot schedule reduction, altered manifests and plan replacement", () => {
    withFiles((write) => {
      const plan = effectPlan();
      const planFile = write("plan.json", plan);
      const slotInput = {
        cohortId: "pm-cohort-1",
        slotIds: ["run-a", "run-b"],
      };
      const manifest = buildPmExplorationEffectSlotManifest({
        plan,
        ...slotInput,
      });
      const otherPlan = effectPlan({ minimumPassRateDelta: 0 });
      const cases = [
        [
          "slots",
          "--slots",
          { ...slotInput, slotIds: ["run-a", "run-a"] },
          planFile,
          plan.planDigest,
        ],
        [
          "slots",
          "--slots",
          { ...slotInput, plan: otherPlan },
          planFile,
          plan.planDigest,
        ],
        [
          "slots",
          "--slots",
          slotInput,
          write("other plan.json", otherPlan),
          plan.planDigest,
        ],
        [
          "verify-slots",
          "--manifest",
          { ...manifest, slotIds: ["run-a"] },
          planFile,
          plan.planDigest,
        ],
        [
          "verify-slots",
          "--manifest",
          manifest,
          planFile,
          otherPlan.planDigest,
        ],
      ];
      for (const [mode, flag, value, frozenPlan, digest] of cases) {
        const result = run(
          mode,
          "--plan",
          frozenPlan,
          "--plan-digest",
          digest,
          flag,
          write("candidate.json", value),
        );
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
      }
      const legacy = JSON.parse(
        readFileSync(
          new URL("../fixtures/pm-exploration-effect-v1.json", import.meta.url),
          "utf8",
        ),
      );
      expect(
        run(
          "slots",
          "--plan",
          write("legacy plan.json", legacy.plan),
          "--plan-digest",
          legacy.plan.planDigest,
          "--slots",
          write("slot input.json", slotInput),
        ).status,
      ).toBe(1);
    });
  });

  it.each(["report", "verify"])(
    "rejects a valid replacement plan in %s mode",
    (mode) => {
      withFiles((write) => {
        const original = effectPlan();
        const changed = effectPlan({ minimumPassRateDelta: 0 });
        const result = run(
          mode,
          "--plan",
          write("plan.json", changed),
          "--plan-digest",
          original.planDigest,
          mode === "report" ? "--runs" : "--report",
          "unused-missing-input.json",
        );
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
      });
    },
  );

  it.each([
    ["threshold-not-met", 3, 2],
    ["insufficient-evidence", 2, 3],
  ])(
    "distinguishes %s with exit %i",
    (decision, exitCode, minimumIndependentGroups) => {
      withFiles((write) => {
        const plan = effectPlan({ minimumIndependentGroups });
        const runs = effectRuns();
        if (decision === "threshold-not-met") {
          for (const item of runs.flatMap((item) => item.cases))
            item.candidate = structuredClone(item.baseline);
        }
        const result = run(
          "report",
          "--plan",
          write("plan.json", plan),
          "--plan-digest",
          plan.planDigest,
          "--runs",
          write("runs.json", runs),
        );
        expect(result.status).toBe(exitCode);
        expect(JSON.parse(result.stdout).evidenceDecision).toBe(decision);
      });
    },
  );

  it("detects insufficient groups before collection", () => {
    withFiles((write) => {
      const result = run(
        "inspect",
        "--plan",
        write("plan.json", effectPlan({ minimumIndependentGroups: 3 })),
      );
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).status).toBe(
        "insufficient-independent-groups",
      );
    });
  });

  it("rejects missing tasks and tampered computed reports", () => {
    withFiles((write) => {
      const plan = effectPlan();
      const planFile = write("plan.json", plan);
      const runs = effectRuns();
      const report = structuredClone(
        buildPmExplorationEffectReport({ plan, runs }),
      );
      runs[0].cases.pop();
      report.candidate.passCount += 1;
      for (const [mode, option, value] of [
        ["report", "--runs", runs],
        ["verify", "--report", report],
      ]) {
        const result = run(
          mode,
          "--plan",
          planFile,
          "--plan-digest",
          plan.planDigest,
          option,
          write("data.json", value),
        );
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
      }
    });
  });

  it("reads v1 without upgrading it or allowing new legacy reports", () => {
    withFiles((write) => {
      const legacy = JSON.parse(
        readFileSync(
          new URL("../fixtures/pm-exploration-effect-v1.json", import.meta.url),
          "utf8",
        ),
      );
      const planFile = write("plan.json", legacy.plan);
      const reportFile = write("report.json", legacy.report);
      const result = run(
        "verify",
        "--plan",
        planFile,
        "--plan-digest",
        legacy.plan.planDigest,
        "--report",
        reportFile,
      );
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual(legacy.report);
      expect(result.stderr).toContain("Historical v1");
      expect(
        run(
          "report",
          "--plan",
          planFile,
          "--plan-digest",
          legacy.plan.planDigest,
          "--runs",
          reportFile,
        ).status,
      ).toBe(1);
    });
  });

  it.each([
    [],
    ["report", "--plan", "missing.json", "--runs", "missing.json"],
    ["inspect", "--plan", "one.json", "--plan", "two.json"],
    ["inspect", "--plan", "one.json", "--runs", "two.json"],
    ["plan", "--help"],
    ["constructor", "--input", "one.json"],
  ])("rejects ambiguous or missing CLI options: %j", (...args) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("rejects damaged UTF-8, oversized files, directories and malformed JSON", () => {
    withFiles((write, root) => {
      for (const file of [
        root,
        write("invalid.json", Buffer.from('{"secret-prompt":')),
        write("encoding.json", Buffer.from([0xff, 0xfe, 0x7b, 0x7d])),
        write("large.json", Buffer.alloc(16 * 1024 * 1024 + 1, 32)),
      ]) {
        const result = run("plan", "--input", file);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).not.toContain("secret-prompt");
        expect(result.stderr).not.toContain(root);
      }
    });
  });
});

describe("PM preflight script", () => {
  const script = fileURLToPath(
    new URL("../../scripts/pm-exploration-preflight.mjs", import.meta.url),
  );
  function run(args, env = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      cwd: path.dirname(script),
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 15000,
    });
  }
  it("prints a profile only with explicit budgets", () => {
    const result = run([
      "--profile",
      "--max-tokens",
      "5000",
      "--max-tool-calls",
      "30",
      "--max-wall-clock-ms",
      "60000",
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).budget.maxTokens).toBe(5000);
    expect(run(["--profile"]).status).toBe(1);
    expect(run(["--max-tokens", "5000"]).status).toBe(1);
  });
  it("returns insufficient evidence even with a compatible environment", () => {
    const result = run([], buildPmExplorationLaunchProfile(budget).environment);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).status).toBe("requires-host-verification");
    expect(JSON.parse(result.stdout).launchAllowed).toBe(false);
  });
});
