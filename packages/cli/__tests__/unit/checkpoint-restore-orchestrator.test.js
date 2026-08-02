import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../../src/lib/checkpoint-restore-saga.js";
import {
  CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES,
  computeCheckpointRestoreDigest,
  runCheckpointRestoreOperation,
} from "../../src/lib/checkpoint-restore-orchestrator.js";

const roots = [];
const HASH = (character) => `sha256:${character.repeat(64)}`;

function secureDirectory(target) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(target, 0o700);
}

function secureAuthorityPaths(targets) {
  return targets.map((target) => {
    const stat = fs.lstatSync(target);
    if (process.platform !== "win32") {
      fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    }
    return { target, exists: true, ok: true };
  });
}

function createHarness(options = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-orchestrator-")),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state", "checkpoint-restores");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  const harness = {
    archived: false,
    callbackEntered: false,
    events: [],
    lockActive: false,
    phases: [],
    retained: false,
    store: null,
  };

  const createSagaStore = ({ workspaceRoot: requestedWorkspaceRoot }) => {
    expect(requestedWorkspaceRoot).toBe(canonicalWorkspaceRoot);
    const store = new CheckpointRestoreSagaStore({
      workspaceRoot: canonicalWorkspaceRoot,
      stateDir,
      secureDirectory,
      secureAuthorityPaths,
    });
    harness.store = store;
    return {
      create(input) {
        const snapshot = store.create(input);
        harness.phases.push(snapshot.phase);
        return snapshot;
      },
      load(operationId) {
        return store.load(operationId);
      },
      advance(operationId, input) {
        const snapshot = store.advance(operationId, input);
        harness.phases.push(snapshot.phase);
        if (
          options.failAdvanceAfterPhase === snapshot.phase &&
          !harness.advanceResponseLost
        ) {
          harness.advanceResponseLost = true;
          const error = new Error("injected committed saga response loss");
          error.code = "CHECKPOINT_RESTORE_SAGA_WRITE_FAILED";
          error.commitState = "head_commit_unknown";
          throw error;
        }
        return snapshot;
      },
      archiveTerminal(operationId, input) {
        harness.archiveWhileLockActive ||= harness.lockActive;
        if (options.failArchive) {
          const error = new Error("injected saga archive failure");
          error.code = "CHECKPOINT_RESTORE_SAGA_WRITE_FAILED";
          throw error;
        }
        const archived = store.archiveTerminal(operationId, input);
        harness.archived = true;
        return archived;
      },
    };
  };

  const withWorkspaceLockSync = (lockOptions, callback) => {
    harness.events.push("lock:wait");
    if (options.lockError) throw options.lockError;
    expect(lockOptions).toMatchObject({
      workspaceRoot: canonicalWorkspaceRoot,
      purpose: "checkpoint-restore",
    });
    harness.callbackEntered = true;
    harness.lockActive = true;
    harness.events.push("lock:acquire");
    let retained = false;
    const lease = {
      canonicalWorkspaceRoot,
      owner: {
        identityPolicy: "pid-only-fail-closed",
        pid: 12_345,
        purpose: "checkpoint-restore",
        startedAt: 1_785_700_000_000,
        token: "12345678-1234-4123-8123-123456789abc",
        transactionId: lockOptions.operationId,
        workspaceRoot: canonicalWorkspaceRoot,
      },
      assertOwned() {
        if (!harness.lockActive) throw new Error("workspace lock was lost");
      },
      retainForRecovery(reason) {
        retained = true;
        harness.retained = true;
        harness.retainedReason = reason;
        if (options.retainReturns) return;
        const error = new Error("workspace lock retained for recovery");
        error.code = "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED";
        error.operationId = lockOptions.operationId;
        error.workspaceLockRetained = true;
        throw error;
      },
    };
    let result;
    let callbackError = null;
    try {
      result = callback(lease);
    } catch (error) {
      callbackError = error;
    }
    harness.lockActive = false;
    harness.events.push(retained ? "lock:retain" : "lock:release");
    if (!retained && options.releaseError) throw options.releaseError;
    if (callbackError) throw callbackError;
    return result;
  };

  harness.workspaceRoot = canonicalWorkspaceRoot;
  harness.dependencies = {
    actorPid: 12_345,
    createSagaStore,
    withWorkspaceLockSync,
    computeWorkspaceLockOwnerDigest:
      computeCheckpointRestoreWorkspaceLockOwnerDigest,
  };
  return harness;
}

function restorePlan(harness, overrides = {}) {
  const restoreKind = overrides.restoreKind || "git";
  const restoreSurface = overrides.restoreSurface || "direct";
  return {
    restoreKind,
    restoreSurface,
    checkpointId: "cp-1",
    checkpointIdentity:
      restoreKind === "git" ? `git:${"a".repeat(40)}` : HASH("a"),
    checkpointNamespace: "test-checkpoints",
    workspaceRoot: harness.workspaceRoot,
    workspaceBinding: {
      schema: "cc-checkpoint-workspace-binding/v1",
      version: 1,
      engine: restoreKind,
      workspaceRoot: harness.workspaceRoot,
      scopeIdentity: HASH("1"),
      prestateIdentity:
        restoreKind === "git" ? `git-tree:${"2".repeat(40)}` : HASH("2"),
      writePlanIdentity: HASH("3"),
      targetPoststateIdentity:
        restoreKind === "git" ? `git-tree:${"4".repeat(40)}` : HASH("4"),
    },
    targetCount: 1,
    confirmationDigest: HASH("5"),
    ...(restoreSurface === "timeline"
      ? { sessionId: "session-1", timelineEntryId: "turn-1" }
      : {}),
    ...overrides,
  };
}

function successfulRestore(harness, expectedTargetCount = 1) {
  return ({
    expectedIdentity,
    expectedWorkspaceBinding,
    hooks,
    targetCount,
  }) => {
    expect(harness.lockActive).toBe(true);
    expect(expectedIdentity).toBe(`git:${"a".repeat(40)}`);
    expect(expectedWorkspaceBinding.writePlanIdentity).toBe(HASH("3"));
    expect(targetCount).toBe(expectedTargetCount);
    harness.events.push("restore");
    if (targetCount > 0) {
      hooks.onSafetyReady({
        safetyId: "safety-1",
        safetyIdentity: `git:${"b".repeat(40)}`,
        safetyPlanIdentity: HASH("3"),
        safetyCoverage: "full",
      });
      hooks.onMutationStarted({ mutationCount: targetCount });
    }
    hooks.onWorkspaceApplied({ appliedCount: targetCount });
    return { restoredCount: targetCount, safetyId: "safety-1" };
  };
}

function runDirect(harness, options = {}) {
  const plan = options.plan || restorePlan(harness);
  return runCheckpointRestoreOperation({
    operationId: options.operationId || "checkpoint-restore-direct-test",
    plan,
    revalidate: options.revalidate || (() => plan),
    restore: options.restore || successfulRestore(harness, plan.targetCount),
    dependencies: harness.dependencies,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("checkpoint restore orchestrator", () => {
  it("runs a direct non-zero restore through one durable operation-local saga", () => {
    const harness = createHarness();
    const completed = runDirect(harness);

    expect(completed).toMatchObject({
      operationId: "checkpoint-restore-direct-test",
      result: { restoredCount: 1, safetyId: "safety-1" },
      sessionCommitDigest: null,
      saga: { phase: "completed", seq: 8 },
      warnings: [],
    });
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "safety_ready",
      "mutation_started",
      "workspace_applied",
      "completed",
    ]);
    expect(harness.events).toEqual([
      "lock:wait",
      "lock:acquire",
      "restore",
      "lock:release",
    ]);
    expect(harness.archived).toBe(true);
    expect(harness.retained).toBe(false);
  });

  it("keeps session authority inside the workspace lock and settles it before session_committed", () => {
    const harness = createHarness();
    const plan = restorePlan(harness, { restoreSurface: "timeline" });
    const settlementDigest = HASH("9");
    const completed = runCheckpointRestoreOperation({
      operationId: "checkpoint-restore-timeline-test",
      plan,
      revalidate: () => plan,
      restore: successfulRestore(harness),
      withSessionAuthority({ commitIntent, restoreWorkspace }) {
        expect(harness.lockActive).toBe(true);
        harness.events.push("session:acquire");
        commitIntent(HASH("8"));
        const code = restoreWorkspace();
        expect(harness.phases.at(-1)).toBe("workspace_applied");
        harness.events.push("session:settled");
        return {
          result: { code, conversation: { messages: 2 } },
          sessionCommitDigest: settlementDigest,
        };
      },
      dependencies: harness.dependencies,
    });

    expect(completed.sessionCommitDigest).toBe(settlementDigest);
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "safety_ready",
      "mutation_started",
      "workspace_applied",
      "session_committed",
      "completed",
    ]);
    expect(harness.events).toEqual([
      "lock:wait",
      "lock:acquire",
      "session:acquire",
      "restore",
      "session:settled",
      "lock:release",
    ]);
    expect(harness.archived).toBe(true);
  });

  it("uses the exact zero-target path without safety or mutation phases", () => {
    const harness = createHarness();
    const plan = restorePlan(harness, { targetCount: 0 });
    const completed = runDirect(harness, {
      plan,
      restore: successfulRestore(harness, 0),
    });

    expect(completed.result.restoredCount).toBe(0);
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "workspace_applied",
      "completed",
    ]);
  });

  it("aborts, archives, and releases when locked revalidation is stale", () => {
    const harness = createHarness();
    const plan = restorePlan(harness);
    const restore = vi.fn();

    expect(() =>
      runDirect(harness, {
        plan,
        revalidate: () => ({
          ...plan,
          workspaceBinding: {
            ...plan.workspaceBinding,
            prestateIdentity: HASH("6"),
          },
        }),
        restore,
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.WORKSPACE_STALE,
        checkpointRestoreSagaPhase: "aborted",
        checkpointRestoreRecoveryRequired: false,
      }),
    );
    expect(restore).not.toHaveBeenCalled();
    expect(harness.phases).toEqual(["created", "locked", "aborted"]);
    expect(harness.archived).toBe(true);
    expect(harness.archiveWhileLockActive).toBeFalsy();
    expect(harness.events.at(-1)).toBe("lock:release");
  });

  it("aborts a failure before mutation and does not retain the workspace lock", () => {
    const harness = createHarness();
    const failure = new Error("safety snapshot could not be created");
    failure.code = "INJECTED_SAFETY_FAILURE";

    expect(() =>
      runDirect(harness, {
        restore: () => {
          throw failure;
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INJECTED_SAFETY_FAILURE",
        checkpointRestoreSagaPhase: "aborted",
        checkpointRestoreRecoveryRequired: false,
      }),
    );
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "aborted",
    ]);
    expect(harness.archived).toBe(true);
    expect(harness.archiveWhileLockActive).toBeFalsy();
    expect(harness.retained).toBe(false);
  });

  it("keeps a completed saga visible when workspace lock release is uncertain", () => {
    const releaseError = new Error("injected workspace lock release failure");
    releaseError.code = "WORKSPACE_LOCK_RELEASE_FAILED";
    const harness = createHarness({ releaseError });

    expect(() => runDirect(harness)).toThrow(
      expect.objectContaining({
        code: "WORKSPACE_LOCK_RELEASE_FAILED",
        checkpointRestoreSagaPhase: "completed",
        checkpointRestoreRecoveryRequired: true,
      }),
    );
    expect(harness.phases.at(-1)).toBe("completed");
    expect(harness.archived).toBe(false);
    expect(harness.events.at(-1)).toBe("lock:release");
  });

  it("marks recovery_required and retains the lock after mutation starts", () => {
    const harness = createHarness();
    let caught;
    try {
      runDirect(harness, {
        restore: ({ hooks }) => {
          hooks.onSafetyReady({
            safetyId: "safety-partial",
            safetyIdentity: `git:${"b".repeat(40)}`,
            safetyPlanIdentity: HASH("3"),
            safetyCoverage: "full",
          });
          hooks.onMutationStarted({ mutationCount: 1 });
          const error = new Error("injected partial mutation");
          error.code = "INJECTED_PARTIAL_MUTATION";
          error.restorePhase = "workspace-mutation";
          throw error;
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      checkpointRestoreOperationId: "checkpoint-restore-direct-test",
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(caught.checkpointRestoreCause).toMatchObject({
      code: "INJECTED_PARTIAL_MUTATION",
      safetyId: "safety-partial",
      checkpointRestoreRecoveryRequired: true,
    });
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "safety_ready",
      "mutation_started",
      "recovery_required",
    ]);
    expect(harness.retained).toBe(true);
    expect(harness.archived).toBe(false);
    expect(harness.events.at(-1)).toBe("lock:retain");
  });

  it("fails closed and retains recovery authority when the engine omits workspace_applied", () => {
    const harness = createHarness();

    expect(() =>
      runDirect(harness, {
        restore: ({ hooks }) => {
          hooks.onSafetyReady({
            safetyId: "safety-boundary",
            safetyIdentity: `git:${"b".repeat(40)}`,
            safetyPlanIdentity: HASH("3"),
            safetyCoverage: "full",
          });
          hooks.onMutationStarted({ mutationCount: 1 });
          return { restoredCount: 1 };
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
        checkpointRestoreSagaPhase: "recovery_required",
      }),
    );
    expect(harness.phases.at(-1)).toBe("recovery_required");
    expect(harness.retained).toBe(true);
  });

  it("retains recovery authority when final session settlement is unknown", () => {
    const harness = createHarness();
    const plan = restorePlan(harness, { restoreSurface: "timeline" });
    let caught;
    try {
      runCheckpointRestoreOperation({
        operationId: "checkpoint-restore-session-unknown",
        plan,
        revalidate: () => plan,
        restore: successfulRestore(harness),
        withSessionAuthority({ commitIntent, restoreWorkspace }) {
          commitIntent(HASH("8"));
          restoreWorkspace();
          const error = new Error("session settlement outcome is unknown");
          error.code = "SESSION_INDEX_ANCHOR_FAILED";
          error.commitState = "unknown";
          throw error;
        },
        dependencies: harness.dependencies,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryRequired: true,
    });
    expect(caught.checkpointRestoreCause).toMatchObject({
      code: "SESSION_INDEX_ANCHOR_FAILED",
      commitState: "unknown",
    });
    expect(harness.phases).not.toContain("session_committed");
    expect(harness.phases.at(-1)).toBe("recovery_required");
    expect(harness.retained).toBe(true);
  });

  it("retains a durable session intent when its adapter throws a known error", () => {
    const harness = createHarness();
    const plan = restorePlan(harness, { restoreSurface: "timeline" });
    let caught;
    try {
      runCheckpointRestoreOperation({
        operationId: "checkpoint-restore-session-known-failure",
        plan,
        revalidate: () => plan,
        restore: successfulRestore(harness),
        withSessionAuthority({ commitIntent }) {
          commitIntent(HASH("8"));
          const error = new Error(
            "session adapter failed after durable intent",
          );
          error.code = "SESSION_ADAPTER_FAILED";
          throw error;
        },
        dependencies: harness.dependencies,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
      checkpointRestoreOperationId: "checkpoint-restore-session-known-failure",
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryRequired: true,
      workspaceLockRetained: true,
    });
    expect(caught.checkpointRestoreCause).toMatchObject({
      code: "SESSION_ADAPTER_FAILED",
      checkpointRestoreRecoveryRequired: true,
    });
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "recovery_required",
    ]);
    expect(harness.retained).toBe(true);
    expect(harness.archived).toBe(false);
  });

  it("retains a durable session intent after pre-mutation safety is ready", () => {
    const harness = createHarness();
    const plan = restorePlan(harness, { restoreSurface: "timeline" });

    expect(() =>
      runCheckpointRestoreOperation({
        operationId: "checkpoint-restore-session-safety-failure",
        plan,
        revalidate: () => plan,
        restore({ hooks }) {
          hooks.onSafetyReady({
            safetyId: "safety-session",
            safetyIdentity: `git:${"b".repeat(40)}`,
            safetyPlanIdentity: HASH("3"),
            safetyCoverage: "full",
          });
          const error = new Error("restore stopped after safety became ready");
          error.code = "SESSION_SAFETY_READY_FAILURE";
          throw error;
        },
        withSessionAuthority({ commitIntent, restoreWorkspace }) {
          commitIntent(HASH("8"));
          return restoreWorkspace();
        },
        dependencies: harness.dependencies,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
        checkpointRestoreSagaPhase: "recovery_required",
        checkpointRestoreRecoveryRequired: true,
      }),
    );
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "safety_ready",
      "recovery_required",
    ]);
    expect(harness.retained).toBe(true);
    expect(harness.archived).toBe(false);
  });

  it("retains a settled session intent when its adapter omits workspace restore", () => {
    const harness = createHarness();
    const plan = restorePlan(harness, { restoreSurface: "timeline" });

    expect(() =>
      runCheckpointRestoreOperation({
        operationId: "checkpoint-restore-session-boundary",
        plan,
        revalidate: () => plan,
        restore: successfulRestore(harness),
        withSessionAuthority({ commitIntent }) {
          commitIntent(HASH("8"));
          return { result: {}, sessionCommitDigest: HASH("9") };
        },
        dependencies: harness.dependencies,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
        checkpointRestoreSagaPhase: "recovery_required",
      }),
    );
    expect(harness.phases).toEqual([
      "created",
      "locked",
      "prepared",
      "intent_committed",
      "recovery_required",
    ]);
    expect(harness.retained).toBe(true);
  });

  it("reconciles an exact committed saga response loss without replaying restore", () => {
    const harness = createHarness({ failAdvanceAfterPhase: "completed" });
    const restore = vi.fn(successfulRestore(harness));
    const completed = runDirect(harness, { restore });

    expect(completed.saga.phase).toBe("completed");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(
      harness.phases.filter((phase) => phase === "completed"),
    ).toHaveLength(1);
    expect(harness.archived).toBe(true);
  });

  it("reports terminal archive failure as a success warning", () => {
    const harness = createHarness({ failArchive: true });
    const completed = runDirect(harness);

    expect(completed.saga.phase).toBe("completed");
    expect(completed.warnings).toEqual([
      expect.stringContaining("saga archive is pending"),
    ]);
    expect(harness.archived).toBe(false);
    expect(harness.events.at(-1)).toBe("lock:release");
  });

  it("aborts a newly-created saga when workspace lock acquisition fails", () => {
    const lockError = new Error("incumbent recovery lock");
    lockError.code = "WORKSPACE_LOCK_TIMEOUT";
    lockError.ownerTransactionId = "checkpoint-restore-incumbent";
    const harness = createHarness({ lockError });

    expect(() => runDirect(harness)).toThrow(
      expect.objectContaining({
        code: "WORKSPACE_LOCK_TIMEOUT",
        ownerTransactionId: "checkpoint-restore-incumbent",
        checkpointRestoreSagaPhase: "aborted",
      }),
    );
    expect(harness.callbackEntered).toBe(false);
    expect(harness.phases).toEqual(["created", "aborted"]);
    expect(harness.archived).toBe(true);
    expect(harness.retained).toBe(false);
  });

  it("rejects asynchronous locked callbacks and aborts before mutation", () => {
    const harness = createHarness();

    expect(() =>
      runDirect(harness, { revalidate: async ({ plan }) => plan }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.ASYNC_UNSUPPORTED,
        checkpointRestoreSagaPhase: "aborted",
      }),
    );
    expect(harness.phases).toEqual(["created", "locked", "aborted"]);
    expect(harness.archived).toBe(true);
  });

  it("rejects direct session claims and timeline restores without a session adapter before creating a saga", () => {
    const harness = createHarness();
    const createSagaStore = vi.fn(harness.dependencies.createSagaStore);
    const dependencies = { ...harness.dependencies, createSagaStore };

    expect(() =>
      runCheckpointRestoreOperation({
        plan: restorePlan(harness, { sessionId: "not-authoritative" }),
        revalidate: vi.fn(),
        restore: vi.fn(),
        dependencies,
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      }),
    );
    expect(() =>
      runCheckpointRestoreOperation({
        plan: restorePlan(harness, { restoreSurface: "timeline" }),
        revalidate: vi.fn(),
        restore: vi.fn(),
        dependencies,
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_ORCHESTRATOR_ERROR_CODES.INVALID_PLAN,
      }),
    );
    expect(createSagaStore).not.toHaveBeenCalled();
  });

  it("computes canonical digests independent of object key order", () => {
    expect(
      computeCheckpointRestoreDigest("test-domain", { a: 1, b: [true] }),
    ).toBe(computeCheckpointRestoreDigest("test-domain", { b: [true], a: 1 }));
  });
});
