import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../../src/lib/checkpoint-restore-saga.js";
import {
  CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES,
  CheckpointRestoreRecoveryController,
} from "../../src/lib/checkpoint-restore-recovery-controller.js";
import {
  inspectWorkspaceLockOwnerSync,
  withWorkspaceLockSync,
} from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];

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

function tokenSequence(prefix = "70000000") {
  let sequence = 0;
  return () =>
    `${prefix}-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function fixture({ storeOverride = null } = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-recovery-")),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const workspaceRoot = fs.realpathSync.native(workspace);
  const store = new CheckpointRestoreSagaStore({
    workspaceRoot,
    stateDir: path.join(root, "state", "checkpoint-restores"),
    secureDirectory,
    secureAuthorityPaths,
  });
  const lockDir = path.join(root, "locks");
  let now = 1_000;
  const ownerToken = tokenSequence();
  const workspaceLockOptions = {
    lockDir,
    allowNonCanonicalLockDirForTests: true,
    timeoutMs: 50,
    retryMs: 5,
    _now: () => now,
    _sleep: (milliseconds) => {
      now += milliseconds;
    },
    _isProcessAlive: () => false,
    _ownerToken: ownerToken,
  };
  const controller = new CheckpointRestoreRecoveryController({
    workspaceRoot,
    store: storeOverride?.(store) || store,
    workspaceLockOptions,
    isProcessAlive: () => false,
  });
  const lockOptions = (operationId, overrides = {}) => ({
    ...workspaceLockOptions,
    workspaceRoot,
    operationId,
    purpose: "checkpoint-restore",
    ...overrides,
  });
  return {
    root,
    workspaceRoot,
    store,
    controller,
    lockOptions,
  };
}

function advance(store, saga, phase, evidence = {}) {
  return store.advance(saga.operationId, {
    expectedSeq: saga.seq,
    expectedHash: saga.headHash,
    phase,
    evidence,
  });
}

function captureThrown(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return null;
}

function retainLockedSaga(input, operationId, { phase = "locked" } = {}) {
  let saga = input.store.create({ operationId });
  const retained = captureThrown(() =>
    withWorkspaceLockSync(input.lockOptions(operationId), (lease) => {
      saga = advance(input.store, saga, "locked", {
        workspaceLockOwner: lease.owner,
      });
      if (phase === "prepared") {
        saga = advance(input.store, saga, "prepared", {
          prestateDigest: `sha256:${"1".repeat(64)}`,
          targetCount: 1,
        });
      } else if (phase === "intent_committed") {
        saga = advance(input.store, saga, "prepared", {
          prestateDigest: `sha256:${"1".repeat(64)}`,
          targetCount: 1,
        });
        saga = advance(input.store, saga, "intent_committed", {
          sessionId: "recovery-session",
          intentCommitDigest: `sha256:${"2".repeat(64)}`,
        });
      }
      lease.retainForRecovery("fixture retained owner");
    }),
  );
  expect(retained).toMatchObject({
    workspaceLockRetained: true,
    retainedOwner: { transactionId: operationId },
  });
  return { saga, owner: retained.retainedOwner };
}

function retainTerminalSaga(input, operationId) {
  let saga = input.store.create({ operationId });
  const retained = captureThrown(() =>
    withWorkspaceLockSync(input.lockOptions(operationId), (lease) => {
      saga = advance(input.store, saga, "locked", {
        workspaceLockOwner: lease.owner,
      });
      saga = advance(input.store, saga, "aborted", {
        reason: "fixture terminal abort",
      });
      lease.retainForRecovery("terminal publication preceded lock release");
    }),
  );
  expect(retained).toMatchObject({ workspaceLockRetained: true });
  return { saga, owner: retained.retainedOwner };
}

function currentOwner(input, operationId) {
  return inspectWorkspaceLockOwnerSync(input.lockOptions(operationId));
}

function archivedEventNames(input, operationId) {
  return fs
    .readdirSync(path.join(input.store.archiveRoot, operationId))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CheckpointRestoreRecoveryController", () => {
  it("takes over one exact dead owner, journals recovery, aborts, releases, and archives", () => {
    const input = fixture();
    const operationId = "abort_locked_restore";
    const retained = retainLockedSaga(input, operationId);
    const ownerDigest = computeCheckpointRestoreWorkspaceLockOwnerDigest(
      retained.owner,
    );

    const result = input.controller.abort(operationId, {
      expectedSeq: retained.saga.seq,
      expectedHash: retained.saga.headHash,
      expectedOwnerDigest: ownerDigest,
      reason: "operator confirmed pre-intent abort",
    });

    expect(result).toMatchObject({
      ok: true,
      action: "abort",
      phase: "aborted",
      archived: true,
      alreadyArchived: false,
      warning: null,
    });
    expect(currentOwner(input, operationId)).toBeNull();
    expect(archivedEventNames(input, operationId)).toEqual([
      "000001-created.json",
      "000002-locked.json",
      "000003-recovery_required.json",
      "000004-recovery_started.json",
      "000005-aborted.json",
    ]);
  });

  it("CAS-aborts created state only after proving its initiator stopped and no owner published", () => {
    const input = fixture();
    const operationId = "abort_created_restore";
    const saga = input.store.create({
      operationId,
      evidence: { actorPid: process.pid },
    });

    const result = input.controller.abort(operationId, {
      expectedSeq: saga.seq,
      expectedHash: saga.headHash,
      expectedOwnerDigest: null,
    });

    expect(result).toMatchObject({
      phase: "aborted",
      archived: true,
    });
    expect(currentOwner(input, operationId)).toBeNull();
  });

  it("refuses a lock-free created abort while its durable initiator may still be live", () => {
    const input = fixture();
    const operationId = "abort_live_created_restore";
    const saga = input.store.create({
      operationId,
      evidence: { actorPid: process.pid },
    });
    const liveController = new CheckpointRestoreRecoveryController({
      workspaceRoot: input.workspaceRoot,
      store: input.store,
      isProcessAlive: () => true,
      workspaceLockOptions: input.lockOptions(operationId),
    });

    expect(() =>
      liveController.abort(operationId, {
        expectedSeq: saga.seq,
        expectedHash: saga.headHash,
        expectedOwnerDigest: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
        actorPid: process.pid,
      }),
    );
    expect(input.store.load(operationId).phase).toBe("created");
    expect(currentOwner(input, operationId)).toBeNull();
  });

  it("rejects stale saga or owner authority before replacing the retained owner", () => {
    const input = fixture();
    const operationId = "abort_authority_conflict";
    const retained = retainLockedSaga(input, operationId);
    const before = currentOwner(input, operationId);

    expect(() =>
      input.controller.abort(operationId, {
        expectedSeq: retained.saga.seq + 1,
        expectedHash: retained.saga.headHash,
        expectedOwnerDigest:
          computeCheckpointRestoreWorkspaceLockOwnerDigest(before),
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.SAGA_CONFLICT,
      }),
    );
    expect(currentOwner(input, operationId)).toEqual(before);

    expect(() =>
      input.controller.abort(operationId, {
        expectedSeq: retained.saga.seq,
        expectedHash: retained.saga.headHash,
        expectedOwnerDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
      }),
    );
    expect(currentOwner(input, operationId)).toEqual(before);
  });

  it("refuses prepared or intent phases because session intent may already be durable", () => {
    for (const phase of ["prepared", "intent_committed"]) {
      const input = fixture();
      const operationId = `abort_${phase}`;
      const retained = retainLockedSaga(input, operationId, { phase });
      const before = currentOwner(input, operationId);

      expect(() =>
        input.controller.abort(operationId, {
          expectedSeq: retained.saga.seq,
          expectedHash: retained.saga.headHash,
          expectedOwnerDigest:
            computeCheckpointRestoreWorkspaceLockOwnerDigest(before),
        }),
      ).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.ACTION_NOT_ALLOWED,
          basePhase: phase,
        }),
      );
      expect(currentOwner(input, operationId)).toEqual(before);
    }
  });

  it("journals recovery_required and retains the replacement owner when abort settlement fails", () => {
    let failAborted = true;
    const input = fixture({
      storeOverride: (store) => ({
        load: (...args) => store.load(...args),
        advance: (operationId, request) => {
          if (request.phase === "aborted" && failAborted) {
            failAborted = false;
            const error = new Error("injected aborted journal failure");
            error.code = "INJECTED_ABORT_FAILURE";
            throw error;
          }
          return store.advance(operationId, request);
        },
        archiveTerminal: (...args) => store.archiveTerminal(...args),
      }),
    });
    const operationId = "abort_failure_retained";
    const retained = retainLockedSaga(input, operationId);
    const priorOwner = retained.owner;

    const error = captureThrown(() =>
      input.controller.abort(operationId, {
        expectedSeq: retained.saga.seq,
        expectedHash: retained.saga.headHash,
        expectedOwnerDigest:
          computeCheckpointRestoreWorkspaceLockOwnerDigest(priorOwner),
      }),
    );

    expect(error).toMatchObject({
      workspaceLockRetained: true,
      checkpointRestoreRecoveryRequired: true,
      checkpointRestoreSagaPhase: "recovery_required",
      checkpointRestoreRecoveryCause: {
        code: "INJECTED_ABORT_FAILURE",
      },
    });
    expect(input.store.load(operationId).phase).toBe("recovery_required");
    const replacementOwner = currentOwner(input, operationId);
    expect(replacementOwner.transactionId).toBe(operationId);
    expect(replacementOwner.token).not.toBe(priorOwner.token);
  });

  it("takes over a crashed recovery attempt through recovery_required before starting a new one", () => {
    const input = fixture();
    const operationId = "abort_recovery_restart";
    let saga = input.store.create({ operationId });
    const retained = captureThrown(() =>
      withWorkspaceLockSync(input.lockOptions(operationId), (lease) => {
        saga = advance(input.store, saga, "locked", {
          workspaceLockOwner: lease.owner,
        });
        saga = advance(input.store, saga, "recovery_required", {
          reason: "initial recovery requested",
          errorCode: "INITIAL_RECOVERY_REQUIRED",
        });
        saga = advance(input.store, saga, "recovery_started", {
          workspaceLockOwner: lease.owner,
          recoveryAction: "abort-pre-intent",
        });
        lease.retainForRecovery("recovery process crashed");
      }),
    );

    const result = input.controller.abort(operationId, {
      expectedSeq: saga.seq,
      expectedHash: saga.headHash,
      expectedOwnerDigest: computeCheckpointRestoreWorkspaceLockOwnerDigest(
        retained.retainedOwner,
      ),
    });

    expect(result).toMatchObject({ phase: "aborted", archived: true });
    expect(archivedEventNames(input, operationId).slice(-3)).toEqual([
      "000005-recovery_required.json",
      "000006-recovery_started.json",
      "000007-aborted.json",
    ]);
  });

  it("releases only an exact terminal retained owner and archives afterward", () => {
    const input = fixture();
    const operationId = "release_terminal_restore";
    const retained = retainTerminalSaga(input, operationId);

    const result = input.controller.release(operationId, {
      expectedSeq: retained.saga.seq,
      expectedHash: retained.saga.headHash,
      expectedOwnerDigest: computeCheckpointRestoreWorkspaceLockOwnerDigest(
        retained.owner,
      ),
    });

    expect(result).toMatchObject({
      ok: true,
      action: "release",
      phase: "aborted",
      archived: true,
    });
    expect(currentOwner(input, operationId)).toBeNull();

    const repeated = input.controller.release(operationId, {
      expectedSeq: result.seq,
      expectedHash: result.headHash,
      expectedOwnerDigest: null,
    });
    expect(repeated).toMatchObject({
      ok: true,
      archived: true,
      alreadyArchived: true,
    });
  });

  it("releases and archives a terminal saga whose workspace lock is already absent", () => {
    const input = fixture();
    const operationId = "release_absent_owner";
    let saga = input.store.create({ operationId });
    saga = advance(input.store, saga, "aborted", {
      reason: "stopped before workspace lock",
    });

    const result = input.controller.release(operationId, {
      expectedSeq: saga.seq,
      expectedHash: saga.headHash,
      expectedOwnerDigest: null,
    });

    expect(result).toMatchObject({
      phase: "aborted",
      archived: true,
    });
    expect(currentOwner(input, operationId)).toBeNull();
  });

  it("does not release a nonterminal saga", () => {
    const input = fixture();
    const operationId = "release_pending_restore";
    const retained = retainLockedSaga(input, operationId);
    const before = currentOwner(input, operationId);

    expect(() =>
      input.controller.release(operationId, {
        expectedSeq: retained.saga.seq,
        expectedHash: retained.saga.headHash,
        expectedOwnerDigest:
          computeCheckpointRestoreWorkspaceLockOwnerDigest(before),
      }),
    ).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.ACTION_NOT_ALLOWED,
      }),
    );
    expect(currentOwner(input, operationId)).toEqual(before);
  });

  it("reports archival failure without turning a completed abort into a false failure", () => {
    const input = fixture({
      storeOverride: (store) => ({
        load: (...args) => store.load(...args),
        advance: (...args) => store.advance(...args),
        archiveTerminal: () => {
          const error = new Error("injected archive failure");
          error.code = "INJECTED_ARCHIVE_FAILURE";
          error.commitState = "archive_not_committed";
          throw error;
        },
      }),
    });
    const operationId = "abort_archive_warning";
    const saga = input.store.create({
      operationId,
      evidence: { actorPid: process.pid },
    });

    const result = input.controller.abort(operationId, {
      expectedSeq: saga.seq,
      expectedHash: saga.headHash,
      expectedOwnerDigest: null,
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "aborted",
      archived: false,
      warning: {
        code: "INJECTED_ARCHIVE_FAILURE",
        commitState: "archive_not_committed",
      },
    });
    expect(input.store.load(operationId).phase).toBe("aborted");
    expect(currentOwner(input, operationId)).toBeNull();
  });
});
