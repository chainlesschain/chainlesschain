import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";

const temporaryDirectories = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-finalization-"));
  temporaryDirectories.push(root);
  const state = path.join(root, "queue.json");
  const worktreePath = path.join(root, "task-worktree");
  let sequence = 0;
  let now = 1_000;
  const common = {
    filePath: state,
    now: () => now,
    id: (kind) => `${kind}-${++sequence}`,
  };
  const queue = TeamDistributedQueue.create({
    ...common,
    processId: 101,
    isProcessAlive: (pid) => pid === 101,
    tasks: [{ key: "task", title: "Task" }],
    authority: {
      runId: "finalization-run",
      baseTarget: {
        branch: "main",
        commitOid: "a".repeat(40),
      },
    },
  });
  const claim = queue.claim({ holder: "worker" });
  const taskResult = {
    branch: "team/finalization-run/task",
    worktreePath,
    committed: true,
    commitOid: "b".repeat(40),
    baselineCommitOid: "a".repeat(40),
    dependencyCommits: [],
    managedLinks: [],
  };
  expect(
    queue.complete("task", {
      holder: "worker",
      leaseId: claim.lease.leaseId,
      result: taskResult,
    }),
  ).toMatchObject({ ok: true });
  const record = {
    key: "task",
    branch: taskResult.branch,
    path: worktreePath,
    committed: true,
    completed: true,
    commitOid: taskResult.commitOid,
    baselineCommitOid: taskResult.baselineCommitOid,
    dependencyCommits: [],
    imported: true,
    integration: {
      previewed: false,
      clean: null,
      merged: false,
      baseCommit: null,
      mergeCommit: null,
    },
    managedLinks: [],
    cleanupPrepared: false,
    cleaned: false,
  };
  const coordinator = {
    version: 5,
    runId: "finalization-run",
    baseTarget: {
      branch: "main",
      commitOid: "a".repeat(40),
    },
    records: [record],
  };
  const git = {
    baseBranch: "main",
    initialBaseOid: "a".repeat(40),
    currentBaseOid: "a".repeat(40),
    branches: [
      {
        key: "task",
        branch: taskResult.branch,
        commitOid: taskResult.commitOid,
        worktreePath,
      },
    ],
  };
  return {
    queue,
    common,
    coordinator,
    git,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}

function authority(result) {
  return {
    operationId: result.operationId,
    owner: result.lease.owner,
    leaseId: result.lease.leaseId,
    fencingToken: result.lease.fencingToken,
    expectedPhase: result.phase,
    expectedRevision: result.revision,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("TeamDistributedQueue fenced finalization", () => {
  it("persists every merge and cleanup intent before completing", () => {
    const value = fixture();
    let current = value.queue.beginFinalization({
      operationId: "operation-1",
      owner: "finalizer-a",
      mode: "merge",
      ttlMs: 10_000,
      git: value.git,
      coordinator: value.coordinator,
    });
    expect(current).toMatchObject({
      ok: true,
      phase: "previewing",
      lease: { fencingToken: 1 },
    });

    const previewCoordinator = structuredClone(value.coordinator);
    previewCoordinator.records[0].integration = {
      previewed: true,
      clean: true,
      merged: false,
      baseCommit: "a".repeat(40),
      mergeCommit: null,
    };
    current = value.queue.recordFinalizationPhase({
      ...authority(current),
      transitionId: "previewed",
      toPhase: "previewed",
      coordinator: previewCoordinator,
      result: { preview: [{ key: "task", clean: true, merged: false }] },
    });
    expect(current).toMatchObject({ ok: true, phase: "previewed" });

    current = value.queue.recordFinalizationPhase({
      ...authority(current),
      transitionId: "merging",
      toPhase: "merging",
      coordinator: previewCoordinator,
      intentKind: "merge",
    });
    expect(current.finalization.intent).toMatchObject({
      kind: "merge",
      expectedBaseOid: "a".repeat(40),
    });

    const mergedCoordinator = structuredClone(previewCoordinator);
    mergedCoordinator.records[0].integration.merged = true;
    mergedCoordinator.records[0].integration.mergeCommit = "c".repeat(40);
    current = value.queue.recordFinalizationPhase({
      ...authority(current),
      transitionId: "merged",
      toPhase: "merged",
      coordinator: mergedCoordinator,
      currentBaseOid: "c".repeat(40),
      result: {
        integration: [{ key: "task", clean: true, merged: true }],
      },
    });
    expect(current).toMatchObject({ ok: true, phase: "merged" });

    const preparedCoordinator = structuredClone(mergedCoordinator);
    preparedCoordinator.records[0].cleanupPrepared = true;
    current = value.queue.recordFinalizationPhase({
      ...authority(current),
      transitionId: "cleanup-prepared",
      toPhase: "cleanup_prepared",
      coordinator: preparedCoordinator,
    });
    expect(current).toMatchObject({
      ok: true,
      phase: "cleanup_prepared",
    });

    current = value.queue.recordFinalizationPhase({
      ...authority(current),
      transitionId: "cleaning",
      toPhase: "cleaning",
      coordinator: preparedCoordinator,
      intentKind: "cleanup",
    });
    expect(current.finalization.intent.kind).toBe("cleanup");

    const cleanedCoordinator = structuredClone(preparedCoordinator);
    cleanedCoordinator.records[0].cleaned = true;
    current = value.queue.completeFinalization({
      ...authority(current),
      transitionId: "completed",
      coordinator: cleanedCoordinator,
      cleanup: [{ key: "task", ok: true }],
      currentBaseOid: "c".repeat(40),
    });
    expect(current).toMatchObject({
      ok: true,
      phase: "completed",
      finalization: {
        lease: null,
        completedAt: 1_000,
      },
    });
    expect(
      value.queue.getFinalization().transitions.map((item) => item.to),
    ).toEqual([
      "previewing",
      "previewed",
      "merging",
      "merged",
      "cleanup_prepared",
      "cleaning",
      "completed",
    ]);
  });

  it("fences concurrent owners and requires explicit takeover after death", () => {
    const value = fixture();
    const begun = value.queue.beginFinalization({
      operationId: "operation-2",
      owner: "finalizer-a",
      mode: "merge",
      ttlMs: 100,
      git: value.git,
      coordinator: value.coordinator,
    });
    expect(begun.ok).toBe(true);
    expect(
      value.queue.renewFinalization({
        operationId: "operation-2",
        owner: begun.lease.owner,
        leaseId: begun.lease.leaseId,
        fencingToken: begun.lease.fencingToken,
        ttlMs: 500,
      }),
    ).toMatchObject({
      ok: true,
      revision: 2,
      lease: { renewals: 1, expiresAt: 1_500 },
    });

    const competitor = TeamDistributedQueue.open({
      ...value.common,
      processId: 202,
      isProcessAlive: (pid) => pid === 101 || pid === 202,
    });
    expect(
      competitor.beginFinalization({
        operationId: "operation-2",
        owner: "finalizer-b",
        mode: "merge",
        git: value.git,
        coordinator: value.coordinator,
      }),
    ).toMatchObject({
      ok: false,
      reason: "finalization_busy",
      takeoverRequired: false,
    });

    value.advance(501);
    const expiredButAlive = competitor.beginFinalization({
      operationId: "operation-2",
      owner: "finalizer-b",
      mode: "merge",
      git: value.git,
      coordinator: value.coordinator,
    });
    expect(expiredButAlive).toMatchObject({
      ok: false,
      reason: "finalization_busy",
      takeoverRequired: false,
      expired: true,
      ownerDead: false,
    });
    expect(
      competitor.takeoverFinalization({
        operationId: "operation-2",
        owner: "finalizer-b",
        reason: "ttl elapsed",
      }),
    ).toMatchObject({
      ok: false,
      reason: "finalization_busy",
      expired: true,
      ownerDead: false,
    });
    expect(
      value.queue.renewFinalization({
        operationId: "operation-2",
        owner: begun.lease.owner,
        leaseId: begun.lease.leaseId,
        fencingToken: begun.lease.fencingToken,
        ttlMs: 100,
      }),
    ).toMatchObject({
      ok: true,
      lease: { renewals: 2, expiresAt: 1_601 },
    });
    value.advance(101);

    const deadOwnerCompetitor = TeamDistributedQueue.open({
      ...value.common,
      processId: 202,
      isProcessAlive: (pid) => pid === 202,
    });
    expect(
      deadOwnerCompetitor.beginFinalization({
        operationId: "operation-2",
        owner: "finalizer-b",
        mode: "merge",
        git: value.git,
        coordinator: value.coordinator,
      }),
    ).toMatchObject({
      ok: false,
      reason: "finalization_takeover_required",
      takeoverRequired: true,
      expired: true,
      ownerDead: true,
    });
    const takeover = deadOwnerCompetitor.takeoverFinalization({
      operationId: "operation-2",
      owner: "finalizer-b",
      reason: "owner process is dead",
    });
    expect(takeover).toMatchObject({
      ok: true,
      takeover: true,
      phase: "recovery_required",
      lease: {
        owner: "finalizer-b",
        ownerPid: 202,
        fencingToken: 2,
      },
      finalization: {
        recovery: {
          fromPhase: "previewing",
          intent: { kind: "preview" },
        },
      },
    });
    expect(
      value.queue.recordFinalizationPhase({
        ...authority(begun),
        transitionId: "stale",
        toPhase: "previewed",
        coordinator: value.coordinator,
        result: { preview: [] },
      }),
    ).toMatchObject({
      ok: false,
      reason: "finalization_cas_mismatch",
    });
  });

  it("returns exact transition replays and rejects conflicting ids", () => {
    const value = fixture();
    const begun = value.queue.beginFinalization({
      operationId: "operation-3",
      owner: "finalizer-a",
      mode: "merge",
      git: value.git,
      coordinator: value.coordinator,
    });
    const previewCoordinator = structuredClone(value.coordinator);
    previewCoordinator.records[0].integration = {
      previewed: true,
      clean: true,
      merged: false,
      baseCommit: "a".repeat(40),
      mergeCommit: null,
    };
    const request = {
      ...authority(begun),
      transitionId: "one-transition",
      toPhase: "previewed",
      coordinator: previewCoordinator,
      result: { preview: [{ key: "task", clean: true }] },
    };
    expect(value.queue.recordFinalizationPhase(request)).toMatchObject({
      ok: true,
      phase: "previewed",
    });
    expect(value.queue.recordFinalizationPhase(request)).toMatchObject({
      ok: true,
      idempotent: true,
      phase: "previewed",
    });
    expect(
      value.queue.recordFinalizationPhase({
        ...request,
        releaseLease: true,
      }),
    ).toMatchObject({
      ok: false,
      reason: "finalization_transition_id_conflict",
    });
  });

  it("pins the operation parameters and completed task graph", () => {
    const value = fixture();
    expect(
      value.queue.beginFinalization({
        operationId: "operation-4",
        owner: "finalizer-a",
        mode: "merge",
        git: value.git,
        coordinator: value.coordinator,
      }),
    ).toMatchObject({ ok: true, phase: "previewing" });
    expect(
      value.queue.beginFinalization({
        operationId: "different-operation",
        owner: "finalizer-a",
        mode: "merge",
        git: value.git,
        coordinator: value.coordinator,
      }),
    ).toMatchObject({
      ok: false,
      reason: "finalization_parameter_or_input_drift",
    });
    expect(() =>
      value.queue.addTask({ key: "late", title: "Late task" }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INVALID_MUTATION" }),
    );
    expect(value.queue.list().map((task) => task.key)).toEqual(["task"]);
  });
});
