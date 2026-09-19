import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  assertPmExplorationTrainingSources,
  buildPmExplorationEffectPlan,
  buildPmExplorationEffectReport,
  buildPmExplorationLaunchProfile,
  buildPmExplorationRoundPlan,
  buildPmExplorationSuite,
  inspectPmExplorationEnvironment,
  projectPmExplorationTrainingView,
  verifyPmExplorationEffectReport,
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

function evalPolicy() {
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
  });
}

function effectPlan(overrides = {}) {
  return buildPmExplorationEffectPlan({
    experimentId: "pm-equal-budget-v1",
    suite: buildPmExplorationSuite(input()),
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
    minimumScoreDelta: 0.05,
    ...overrides,
  });
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
    passed: score >= 0.5,
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

function effectRuns() {
  return [101, 202, 303].map((seed) => ({
    runId: `run-${seed}`,
    seed,
    phases: { baseline: phases(), candidate: phases(true) },
    cases: [
      {
        taskId: "pm-test",
        baseline: arm(`baseline-${seed}`, 0.5),
        candidate: arm(`candidate-${seed}`, 0.75),
      },
    ],
  }));
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
  it("freezes both versions, protocol digests, seeds and one equal arm budget", () => {
    const plan = effectPlan();
    expect(plan).toMatchObject({
      testTaskIds: ["pm-test"],
      seeds: [101, 202, 303],
      equalBudget: true,
      promotionAuthority: false,
      bootstrapSamples: 1_000,
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
      pairedObservationCount: 3,
      evidenceDecision: "threshold-met",
      budgetViolationCount: 0,
      requiresIndependentPilotApproval: true,
      qualifiesForPromotion: false,
      baseline: {
        meanScore: 0.5,
        usage: { tokens: 300 },
      },
      candidate: {
        meanScore: 0.75,
        usage: { tokens: 390 },
      },
      pairedScoreDelta: {
        mean: 0.25,
        bootstrap95Ci: [0.25, 0.25],
      },
    });
    expect(verifyPmExplorationEffectReport({ plan, report })).toEqual(report);
    expect(Object.isFrozen(report.runs[0].cases[0].candidate)).toBe(true);
  });

  it("fails closed on safety regression or an exceeded arm budget", () => {
    const plan = effectPlan();
    const unsafe = effectRuns();
    unsafe[1].cases[0].candidate.permissionViolations = 1;
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
    report.candidate.meanScore = 1;
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
