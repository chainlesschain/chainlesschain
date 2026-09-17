import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  completePmExplorationRound,
  createPmExplorationJournal,
  createPmExplorationPlan,
  enterPmExplorationDeepStage,
  exportPmExplorationRecoverySnapshot,
  freezePmExplorationMemory,
  inspectPmExplorationJournal,
  mergePmExplorationBroadBranches,
  restorePmExplorationJournal,
  startPmExplorationRound,
  verifyPmExplorationPlan,
} from "../../src/lib/evolution/pm-exploration-rounds.js";

const sha = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function planInput(overrides = {}) {
  return {
    planId: "pm-exploration-pilot",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training-partition"),
    trainingTaskIds: ["train-create", "train-permissions", "train-export"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("memory-initial"),
    broadBranchIds: ["workflow", "permissions"],
    maxRounds: 8,
    maxTokens: 10_000,
    maxToolCalls: 100,
    maxWallClockMs: 60_000,
    maxConsecutiveNoGain: 3,
    ...overrides,
  };
}

function newJournal(overrides = {}) {
  const plan = createPmExplorationPlan(planInput(overrides));
  return { plan, journal: createPmExplorationJournal(plan) };
}

function startBroad(journal, roundId, branchId, taskId = "train-create") {
  const projection = inspectPmExplorationJournal(journal);
  const head = projection.branchHeads.find(
    (branch) => branch.branchId === branchId,
  ).memoryDigest;
  return startPmExplorationRound(journal, {
    roundId,
    stage: "broad",
    branchId,
    taskId,
    inputMemoryDigest: head,
  });
}

function settle(journal, round, suffix, overrides = {}) {
  return completePmExplorationRound(journal, round, {
    executionReceiptDigest: sha(`execution-${suffix}`),
    graderReceiptDigest: sha(`grader-${suffix}`),
    outputMemoryDigest: sha(`memory-${suffix}`),
    decision: "accept",
    metrics: { tokens: 100, toolCalls: 2, wallClockMs: 500 },
    ...overrides,
  });
}

function finishBroad(journal) {
  const workflow = settle(
    journal,
    startBroad(journal, "round-workflow", "workflow"),
    "workflow",
  );
  const permissions = settle(
    journal,
    startBroad(journal, "round-permissions", "permissions"),
    "permissions",
  );
  return { workflow, permissions };
}

function mergeBroad(journal) {
  return mergePmExplorationBroadBranches(journal, {
    mergeId: "merge-broad",
    outputMemoryDigest: sha("memory-merged"),
    conflictResolutionReceiptDigest: sha("merge-receipt"),
  });
}

describe("PM exploration round protocol", () => {
  it("creates an immutable digest-bound plan and verifies only exact envelopes", () => {
    const input = planInput();
    const plan = createPmExplorationPlan(input);
    expect(verifyPmExplorationPlan(plan)).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.trainingTaskIds)).toBe(true);
    expect(Object.isFrozen(plan.broadBranchIds)).toBe(true);

    input.trainingTaskIds[0] = "changed-after-build";
    expect(plan.trainingTaskIds[0]).toBe("train-create");

    expect(() => verifyPmExplorationPlan({ ...plan, maxRounds: 7 })).toThrow(
      /digest mismatch/,
    );
    expect(() => verifyPmExplorationPlan({ ...plan, extra: true })).toThrow(
      /unexpected/,
    );
    expect(() => verifyPmExplorationPlan(new Proxy(plan, {}))).toThrow(
      /plain object/,
    );
  });

  it("rejects sparse, accessor-backed, duplicate, and oversized identifier lists", () => {
    const sparse = planInput();
    sparse.trainingTaskIds = new Array(2);
    sparse.trainingTaskIds[1] = "train-create";
    expect(() => createPmExplorationPlan(sparse)).toThrow(/holes/);

    const accessor = planInput();
    Object.defineProperty(accessor.broadBranchIds, "0", {
      enumerable: true,
      get: () => "workflow",
    });
    expect(() => createPmExplorationPlan(accessor)).toThrow(/accessor/);

    expect(() =>
      createPmExplorationPlan(
        planInput({ broadBranchIds: ["workflow", "workflow"] }),
      ),
    ).toThrow(/unique/);
  });

  it("snapshots a verified mutable plan before opening the journal", () => {
    const original = createPmExplorationPlan(planInput());
    const mutable = structuredClone(original);
    const journal = createPmExplorationJournal(mutable);
    mutable.trainingTaskIds[0] = "outside-task";
    mutable.broadBranchIds[0] = "changed-branch";

    expect(() =>
      startBroad(journal, "round-snapshot", "workflow"),
    ).not.toThrow();
    expect(() =>
      startPmExplorationRound(journal, {
        roundId: "round-outside",
        stage: "broad",
        branchId: "permissions",
        taskId: "outside-task",
        inputMemoryDigest: original.initialMemoryDigest,
      }),
    ).toThrow(/outside the bound training partition/);
  });

  it("allows broad branches in parallel but only one active round per branch", () => {
    const { journal, plan } = newJournal();
    const workflow = startBroad(journal, "round-workflow", "workflow");
    const permissions = startBroad(
      journal,
      "round-permissions",
      "permissions",
      "train-permissions",
    );
    expect(() =>
      startPmExplorationRound(journal, {
        roundId: "round-workflow-two",
        stage: "broad",
        branchId: "workflow",
        taskId: "train-export",
        inputMemoryDigest: plan.initialMemoryDigest,
      }),
    ).toThrow(/active round/);

    const rejected = settle(journal, permissions, "permissions", {
      decision: "reject",
    });
    const accepted = settle(journal, workflow, "workflow");
    expect(rejected.effectiveMemoryDigest).toBe(plan.initialMemoryDigest);
    expect(accepted.effectiveMemoryDigest).toBe(sha("memory-workflow"));
    expect(inspectPmExplorationJournal(journal).activeRoundCount).toBe(0);
  });

  it("enforces training-task membership and current memory heads", () => {
    const { journal, plan } = newJournal();
    expect(() =>
      startPmExplorationRound(journal, {
        roundId: "round-hidden-test",
        stage: "broad",
        branchId: "workflow",
        taskId: "test-hidden",
        inputMemoryDigest: plan.initialMemoryDigest,
      }),
    ).toThrow(/outside the bound training partition/);
    expect(() =>
      startPmExplorationRound(journal, {
        roundId: "round-wrong-head",
        stage: "broad",
        branchId: "workflow",
        taskId: "train-create",
        inputMemoryDigest: sha("unbound-memory"),
      }),
    ).toThrow(/current checkpoint/);
    expect(inspectPmExplorationJournal(journal).activeRoundCount).toBe(0);
  });

  it("keeps rejected and unsafe memory candidates out of subsequent inputs", () => {
    const { journal, plan } = newJournal();
    const rejected = settle(
      journal,
      startBroad(journal, "round-rejected", "workflow"),
      "rejected",
      { decision: "reject" },
    );
    const unsafe = settle(
      journal,
      startBroad(journal, "round-unsafe", "permissions"),
      "unsafe",
      { decision: "unsafe" },
    );
    expect(rejected.accepted).toBe(false);
    expect(unsafe.accepted).toBe(false);
    expect(rejected.effectiveMemoryDigest).toBe(plan.initialMemoryDigest);
    expect(unsafe.effectiveMemoryDigest).toBe(plan.initialMemoryDigest);
    expect(rejected.qualifiesForPromotion).toBe(false);
  });

  it("does not consume a round capability on a correctable invalid completion", () => {
    const { journal, plan } = newJournal();
    const round = startBroad(journal, "round-retry", "workflow");
    expect(() =>
      settle(journal, round, "same-memory", {
        outputMemoryDigest: plan.initialMemoryDigest,
      }),
    ).toThrow(/new memory digest/);
    expect(settle(journal, round, "retry").accepted).toBe(true);
    expect(() => settle(journal, round, "reused")).toThrow(/already settled/);
  });

  it("binds round capabilities to one journal", () => {
    const first = newJournal();
    const second = newJournal({ planId: "pm-exploration-second" });
    const round = startBroad(first.journal, "round-owned", "workflow");
    expect(() => settle(second.journal, round, "foreign")).toThrow(
      /does not belong/,
    );
    expect(settle(first.journal, round, "owned").accepted).toBe(true);
  });

  it("requires every broad branch and every active round before merging", () => {
    const { journal } = newJournal();
    const workflow = startBroad(journal, "round-workflow", "workflow");
    expect(() => mergeBroad(journal)).toThrow(/Active rounds/);
    settle(journal, workflow, "workflow");
    expect(() => mergeBroad(journal)).toThrow(/has no completed checkpoint/);
    settle(
      journal,
      startBroad(journal, "round-permissions", "permissions"),
      "permissions",
    );
    const merge = mergeBroad(journal);
    expect(merge.branchCheckpoints).toHaveLength(2);
    expect(merge.authenticated).toBe(false);
    expect(merge.qualifiesForPromotion).toBe(false);
    expect(() => mergeBroad(journal)).toThrow(/cannot be merged/);
  });

  it("binds Deep entry to the merge and runs Deep rounds sequentially", () => {
    const { journal } = newJournal();
    finishBroad(journal);
    const merge = mergeBroad(journal);
    expect(() =>
      enterPmExplorationDeepStage(journal, sha("wrong-merge")),
    ).toThrow(/binding mismatch/);
    const entry = enterPmExplorationDeepStage(journal, merge.mergeDigest);
    expect(entry.inputMemoryDigest).toBe(merge.outputMemoryDigest);
    const deep = startPmExplorationRound(journal, {
      roundId: "round-deep-one",
      stage: "deep",
      branchId: null,
      taskId: "train-export",
      inputMemoryDigest: entry.inputMemoryDigest,
    });
    expect(() =>
      startPmExplorationRound(journal, {
        roundId: "round-deep-two",
        stage: "deep",
        branchId: null,
        taskId: "train-create",
        inputMemoryDigest: entry.inputMemoryDigest,
      }),
    ).toThrow(/sequential/);
    expect(settle(journal, deep, "deep-one").stage).toBe("deep");
  });

  it("freezes only the current Deep checkpoint and remains non-promotable", () => {
    const { journal } = newJournal();
    finishBroad(journal);
    const merge = mergeBroad(journal);
    const entry = enterPmExplorationDeepStage(journal, merge.mergeDigest);
    const deep = startPmExplorationRound(journal, {
      roundId: "round-deep-freeze",
      stage: "deep",
      branchId: null,
      taskId: "train-export",
      inputMemoryDigest: entry.inputMemoryDigest,
    });
    const checkpoint = settle(journal, deep, "deep-final");
    expect(() =>
      freezePmExplorationMemory(journal, {
        finalMemoryDigest: sha("not-current"),
        evaluatorReceiptDigest: sha("evaluator"),
      }),
    ).toThrow(/current Deep checkpoint/);
    const frozen = freezePmExplorationMemory(journal, {
      finalMemoryDigest: checkpoint.effectiveMemoryDigest,
      evaluatorReceiptDigest: sha("evaluator"),
    });
    expect(frozen.finalCheckpointDigest).toBe(checkpoint.checkpointDigest);
    expect(frozen.authenticated).toBe(false);
    expect(frozen.qualifiesForPromotion).toBe(false);
    expect(inspectPmExplorationJournal(journal).stage).toBe("frozen");
    expect(() =>
      startPmExplorationRound(journal, {
        roundId: "round-after-freeze",
        stage: "deep",
        branchId: null,
        taskId: "train-create",
        inputMemoryDigest: frozen.finalMemoryDigest,
      }),
    ).toThrow(/already frozen/);
  });

  it("fails closed when aggregate resource budgets are exceeded", () => {
    const { journal, plan } = newJournal({
      broadBranchIds: ["workflow"],
      maxTokens: 50,
    });
    const checkpoint = settle(
      journal,
      startBroad(journal, "round-over-budget", "workflow"),
      "over-budget",
      { metrics: { tokens: 51, toolCalls: 1, wallClockMs: 1 } },
    );
    expect(checkpoint.disposition).toBe("rejected-budget");
    expect(checkpoint.effectiveMemoryDigest).toBe(plan.initialMemoryDigest);
    expect(inspectPmExplorationJournal(journal).stopReason).toBe(
      "budget-exhausted",
    );
    expect(() => startBroad(journal, "round-after-budget", "workflow")).toThrow(
      /budget-exhausted/,
    );
    const merge = mergeBroad(journal);
    expect(() =>
      enterPmExplorationDeepStage(journal, merge.mergeDigest),
    ).toThrow(/budget-exhausted/);
  });

  it("stops on consecutive no-gain and cannot reset that stop at Deep entry", () => {
    const { journal } = newJournal({
      broadBranchIds: ["workflow"],
      maxConsecutiveNoGain: 1,
    });
    settle(
      journal,
      startBroad(journal, "round-no-gain", "workflow"),
      "no-gain",
      { decision: "reject" },
    );
    expect(inspectPmExplorationJournal(journal).stopReason).toBe(
      "consecutive-no-gain",
    );
    const merge = mergeBroad(journal);
    expect(() =>
      enterPmExplorationDeepStage(journal, merge.mergeDigest),
    ).toThrow(/consecutive-no-gain/);
  });

  it("snapshots metrics and returns a frozen, redacted projection", () => {
    const { journal } = newJournal();
    const metrics = { tokens: 3, toolCalls: 2, wallClockMs: 1 };
    const checkpoint = settle(
      journal,
      startBroad(journal, "round-metrics", "workflow"),
      "metrics",
      { metrics },
    );
    metrics.tokens = 9999;
    const projection = inspectPmExplorationJournal(journal);
    expect(checkpoint.metrics.tokens).toBe(3);
    expect(projection.aggregateMetrics.tokens).toBe(3);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(JSON.stringify(projection)).not.toContain("train-create");
    expect(projection.authenticated).toBe(false);
    expect(projection.qualifiesForPromotion).toBe(false);
  });

  it("exports recovery state only at a quiescent round boundary", () => {
    const { journal } = newJournal();
    const round = startBroad(journal, "round-active", "workflow");
    expect(() => exportPmExplorationRecoverySnapshot(journal)).toThrow(
      /Active rounds/,
    );
    settle(journal, round, "active");
    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    expect(snapshot.stage).toBe("broad");
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.authenticated).toBe(false);
    expect(snapshot.qualifiesForPromotion).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("round-trips a JSON recovery snapshot and can continue Broad work", () => {
    const { plan, journal } = newJournal();
    settle(
      journal,
      startBroad(journal, "round-before-restart", "workflow"),
      "before-restart",
    );
    const snapshot = JSON.parse(
      JSON.stringify(exportPmExplorationRecoverySnapshot(journal)),
    );
    const restored = restorePmExplorationJournal(plan, snapshot);
    expect(inspectPmExplorationJournal(restored)).toEqual(
      inspectPmExplorationJournal(journal),
    );
    settle(
      restored,
      startBroad(restored, "round-after-restart", "permissions"),
      "after-restart",
    );
    expect(mergeBroad(restored).branchCheckpoints).toHaveLength(2);
  });

  it("restores a merged boundary before Deep entry", () => {
    const { plan, journal } = newJournal();
    finishBroad(journal);
    const merge = mergeBroad(journal);
    const restored = restorePmExplorationJournal(
      plan,
      exportPmExplorationRecoverySnapshot(journal),
    );
    expect(inspectPmExplorationJournal(restored).stage).toBe("broad-complete");
    expect(
      enterPmExplorationDeepStage(restored, merge.mergeDigest)
        .inputMemoryDigest,
    ).toBe(merge.outputMemoryDigest);
  });

  it("restores Deep state and preserves the current memory head", () => {
    const { plan, journal } = newJournal();
    finishBroad(journal);
    const merge = mergeBroad(journal);
    const entry = enterPmExplorationDeepStage(journal, merge.mergeDigest);
    const first = settle(
      journal,
      startPmExplorationRound(journal, {
        roundId: "round-deep-before-restart",
        stage: "deep",
        branchId: null,
        taskId: "train-export",
        inputMemoryDigest: entry.inputMemoryDigest,
      }),
      "deep-before-restart",
    );
    const restored = restorePmExplorationJournal(
      plan,
      exportPmExplorationRecoverySnapshot(journal),
    );
    const next = startPmExplorationRound(restored, {
      roundId: "round-deep-after-restart",
      stage: "deep",
      branchId: null,
      taskId: "train-create",
      inputMemoryDigest: first.effectiveMemoryDigest,
    });
    expect(settle(restored, next, "deep-after-restart").sequence).toBe(4);
  });

  it("restores a frozen journal without granting promotion authority", () => {
    const { plan, journal } = newJournal();
    finishBroad(journal);
    const merge = mergeBroad(journal);
    const entry = enterPmExplorationDeepStage(journal, merge.mergeDigest);
    const deep = settle(
      journal,
      startPmExplorationRound(journal, {
        roundId: "round-deep-frozen-recovery",
        stage: "deep",
        branchId: null,
        taskId: "train-export",
        inputMemoryDigest: entry.inputMemoryDigest,
      }),
      "deep-frozen-recovery",
    );
    freezePmExplorationMemory(journal, {
      finalMemoryDigest: deep.effectiveMemoryDigest,
      evaluatorReceiptDigest: sha("frozen-evaluator"),
    });
    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    const restored = restorePmExplorationJournal(plan, snapshot);
    const projection = inspectPmExplorationJournal(restored);
    expect(projection.stage).toBe("frozen");
    expect(projection.frozenMemoryDigest).toBe(
      snapshot.frozen.frozenMemoryDigest,
    );
    expect(projection.authenticated).toBe(false);
    expect(projection.qualifiesForPromotion).toBe(false);
  });

  it("rejects tampered, cross-plan, proxied, and accessor recovery snapshots", () => {
    const { plan, journal } = newJournal();
    settle(
      journal,
      startBroad(journal, "round-recovery-validation", "workflow"),
      "recovery-validation",
    );
    const snapshot = exportPmExplorationRecoverySnapshot(journal);
    const tampered = structuredClone(snapshot);
    tampered.checkpoints[0].taskId = "train-export";
    expect(() => restorePmExplorationJournal(plan, tampered)).toThrow(
      /snapshot digest mismatch/,
    );
    const otherPlan = createPmExplorationPlan(
      planInput({ planId: "pm-exploration-other-plan" }),
    );
    expect(() => restorePmExplorationJournal(otherPlan, snapshot)).toThrow(
      /plan binding mismatch/,
    );
    expect(() =>
      restorePmExplorationJournal(plan, new Proxy(snapshot, {})),
    ).toThrow(/plain object/);

    const accessor = structuredClone(snapshot);
    Object.defineProperty(accessor.checkpoints[0], "taskId", {
      enumerable: true,
      get: () => "train-create",
    });
    expect(() => restorePmExplorationJournal(plan, accessor)).toThrow(
      /accessor fields/,
    );
  });
});
