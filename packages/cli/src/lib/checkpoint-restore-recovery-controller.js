/**
 * Conservative production recovery for durable checkpoint restores.
 *
 * This first control-plane slice intentionally supports only two operations:
 *
 * - abort before a session intent or workspace mutation can have been issued;
 * - release an exact terminal operation's retained workspace lock and archive
 *   its saga.
 *
 * Anything that may have crossed the session-intent or mutation boundary must
 * be reconciled by a richer session/workspace recovery planner. Refusing those
 * phases is important: a saga phase is a durable lower bound, not permission to
 * guess that an external side effect did not happen.
 */

import {
  CheckpointRestoreSagaStore,
  CHECKPOINT_RESTORE_SAGA_ERROR_CODES,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "./checkpoint-restore-saga.js";
import {
  inspectWorkspaceLockOwnerSync,
  withWorkspaceRecoveryLockSync,
} from "./process-execution-broker/workspace-transaction.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RECOVERY_PHASES = new Set(["recovery_required", "recovery_started"]);
const SAFE_ABORT_BASE_PHASES = new Set(["created", "locked"]);
const TERMINAL_PHASES = new Set(["completed", "aborted", "rolled_back"]);
const CHECKPOINT_RESTORE_PURPOSE = "checkpoint-restore";

export const CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "CHECKPOINT_RESTORE_RECOVERY_INVALID_ARGUMENT",
  SAGA_CONFLICT: "CHECKPOINT_RESTORE_RECOVERY_SAGA_CONFLICT",
  ACTION_NOT_ALLOWED: "CHECKPOINT_RESTORE_RECOVERY_ACTION_NOT_ALLOWED",
  OWNER_CONFLICT: "CHECKPOINT_RESTORE_RECOVERY_OWNER_CONFLICT",
});

export class CheckpointRestoreRecoveryError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "CheckpointRestoreRecoveryError";
    this.code = code;
    Object.assign(this, details);
  }
}

function recoveryError(code, message, details = {}, cause = null) {
  return new CheckpointRestoreRecoveryError(code, message, details, cause);
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw recoveryError(
    CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.INVALID_ARGUMENT,
    "Checkpoint restore recovery evidence is not canonical JSON",
  );
}

function boundedText(value, fallback, maximum) {
  let result = "";
  for (const character of String(value || fallback)) {
    const code = character.charCodeAt(0);
    result += code < 32 || code === 127 ? " " : character;
  }
  return (result.trim() || fallback).slice(0, maximum);
}

function validateExpectedAuthority({
  expectedSeq,
  expectedHash,
  expectedOwnerDigest,
}) {
  if (
    !Number.isSafeInteger(expectedSeq) ||
    expectedSeq < 1 ||
    typeof expectedHash !== "string" ||
    !HASH_PATTERN.test(expectedHash) ||
    !(
      expectedOwnerDigest === null ||
      (typeof expectedOwnerDigest === "string" &&
        HASH_PATTERN.test(expectedOwnerDigest))
    )
  ) {
    throw recoveryError(
      CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.INVALID_ARGUMENT,
      "Checkpoint restore recovery requires exact saga and observed-owner authority",
    );
  }
}

function exactSaga(saga, operationId, expectedSeq, expectedHash) {
  if (
    !saga ||
    saga.operationId !== operationId ||
    saga.seq !== expectedSeq ||
    saga.headHash !== expectedHash
  ) {
    throw recoveryError(
      CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.SAGA_CONFLICT,
      "Checkpoint restore saga changed after recovery preview",
      {
        operationId,
        expectedSeq,
        expectedHash,
        actualSeq: saga?.seq ?? null,
        actualHash: saga?.headHash ?? null,
      },
    );
  }
  return saga;
}

function basePhase(saga) {
  for (let index = saga.events.length - 1; index >= 0; index -= 1) {
    const phase = saga.events[index]?.phase;
    if (!RECOVERY_PHASES.has(phase)) return phase || null;
  }
  return null;
}

function terminalSummary(value) {
  return Object.freeze({
    operationId: value.operationId,
    phase: value.phase,
    seq: value.seq,
    headHash: value.headHash,
  });
}

function archiveWarning(error) {
  return Object.freeze({
    code: boundedText(
      error?.code,
      "CHECKPOINT_RESTORE_SAGA_ARCHIVE_PENDING",
      128,
    ),
    message: boundedText(
      error?.message,
      "Checkpoint restore saga archive is pending",
      512,
    ),
    commitState:
      typeof error?.commitState === "string"
        ? boundedText(error.commitState, "unknown", 128)
        : null,
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A permission failure proves that the PID exists but is not observable.
    // PID reuse is intentionally fail-closed and is therefore also "alive".
    return error?.code === "EPERM";
  }
}

function propagateRecoveryDiagnostics(error) {
  if (!error || typeof error !== "object") return error;
  const nested = error.cause;
  if (!nested || typeof nested !== "object") return error;
  for (const field of [
    "checkpointRestoreRecoveryCause",
    "checkpointRestoreOperationId",
    "checkpointRestoreSagaPhase",
    "checkpointRestoreSagaSeq",
    "checkpointRestoreSagaHeadHash",
    "checkpointRestoreRecoveryRequired",
  ]) {
    if (error[field] === undefined && nested[field] !== undefined) {
      error[field] = nested[field];
    }
  }
  return error;
}

/**
 * The controller never keeps a saga store lock while acquiring a workspace or
 * session authority. Store methods take short internal locks, and all calls
 * made from a workspace callback therefore follow workspace -> saga order.
 */
export class CheckpointRestoreRecoveryController {
  constructor(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.INVALID_ARGUMENT,
        "Checkpoint restore recovery controller options must be an object",
      );
    }
    if (
      typeof options.workspaceRoot !== "string" ||
      options.workspaceRoot.length === 0
    ) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.INVALID_ARGUMENT,
        "Checkpoint restore recovery requires a workspaceRoot",
      );
    }
    this.workspaceRoot = options.workspaceRoot;
    this.store =
      options.store ||
      new CheckpointRestoreSagaStore({
        workspaceRoot: this.workspaceRoot,
      });
    this._inspectWorkspaceLockOwnerSync =
      options.inspectWorkspaceLockOwnerSync || inspectWorkspaceLockOwnerSync;
    this._withWorkspaceRecoveryLockSync =
      options.withWorkspaceRecoveryLockSync || withWorkspaceRecoveryLockSync;
    this._workspaceLockOwnerDigest =
      options.computeWorkspaceLockOwnerDigest ||
      computeCheckpointRestoreWorkspaceLockOwnerDigest;
    this._isProcessAlive = options.isProcessAlive || processAlive;
    this._workspaceLockOptions = Object.freeze({
      ...(options.workspaceLockOptions || {}),
    });
  }

  _lockOptions(operationId) {
    return {
      ...this._workspaceLockOptions,
      workspaceRoot: this.workspaceRoot,
      operationId,
      purpose: CHECKPOINT_RESTORE_PURPOSE,
    };
  }

  _loadExact(operationId, expectedSeq, expectedHash) {
    return exactSaga(
      this.store.load(operationId),
      operationId,
      expectedSeq,
      expectedHash,
    );
  }

  _assertAbortable(saga) {
    const sourcePhase = basePhase(saga);
    if (!SAFE_ABORT_BASE_PHASES.has(sourcePhase) || saga.terminal) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.ACTION_NOT_ALLOWED,
        "Checkpoint restore can only be aborted before prepared session intent authority",
        {
          operationId: saga.operationId,
          phase: saga.phase,
          basePhase: sourcePhase,
        },
      );
    }
    return sourcePhase;
  }

  _assertTerminal(saga) {
    if (!saga.terminal || !TERMINAL_PHASES.has(saga.phase)) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.ACTION_NOT_ALLOWED,
        "Only a terminal checkpoint restore can release recovery authority",
        {
          operationId: saga.operationId,
          phase: saga.phase,
          basePhase: basePhase(saga),
        },
      );
    }
    return saga;
  }

  _advanceExact(saga, phase, evidence) {
    try {
      return this.store.advance(saga.operationId, {
        expectedSeq: saga.seq,
        expectedHash: saga.headHash,
        phase,
        evidence,
      });
    } catch (error) {
      // Event publication and HEAD replacement are separate durable renames.
      // Reconcile only the exact intended successor; never blind-retry a CAS.
      try {
        const observed = this.store.load(saga.operationId);
        const latest = observed.events.at(-1);
        if (
          observed.seq === saga.seq + 1 &&
          observed.phase === phase &&
          latest?.prevHash === saga.headHash &&
          canonicalJson(latest.evidence) === canonicalJson(evidence)
        ) {
          return observed;
        }
      } catch (loadError) {
        if (error && typeof error === "object") {
          error.checkpointRestoreRecoveryLoadError = loadError;
        }
      }
      throw error;
    }
  }

  _inspectBoundOwner(operationId, expectedOwnerDigest) {
    const owner = this._inspectWorkspaceLockOwnerSync(
      this._lockOptions(operationId),
    );
    if (owner === null) {
      if (expectedOwnerDigest !== null) {
        throw recoveryError(
          CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
          "Checkpoint restore workspace owner disappeared after recovery preview",
          { operationId, expectedOwnerDigest, actualOwnerDigest: null },
        );
      }
      return null;
    }
    const actualOwnerDigest = this._workspaceLockOwnerDigest(owner);
    if (actualOwnerDigest !== expectedOwnerDigest) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore workspace owner changed after recovery preview",
        { operationId, expectedOwnerDigest, actualOwnerDigest },
      );
    }
    return owner;
  }

  _withBoundWorkspaceAuthority(operationId, expectedOwnerDigest, callback) {
    const observedOwner = this._inspectBoundOwner(
      operationId,
      expectedOwnerDigest,
    );
    if (!observedOwner) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore has no retained workspace owner to take over",
        { operationId, expectedOwnerDigest: null, actualOwnerDigest: null },
      );
    }
    return this._withWorkspaceRecoveryLockSync(
      {
        ...this._lockOptions(operationId),
        expectedOwner: observedOwner,
      },
      callback,
    );
  }

  _abortCreatedWithoutPublishedOwner(
    saga,
    expectedOwnerDigest,
    normalizedReason,
  ) {
    if (expectedOwnerDigest !== null || saga.phase !== "created") return null;
    const created = saga.events[0];
    const actorPid = created?.evidence?.actorPid;
    if (!Number.isSafeInteger(actorPid) || actorPid <= 0) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.ACTION_NOT_ALLOWED,
        "Lock-free created recovery requires the durable initiator PID",
        { operationId: saga.operationId, phase: saga.phase },
      );
    }
    if (this._isProcessAlive(actorPid)) {
      throw recoveryError(
        CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore initiator is still live",
        { operationId: saga.operationId, actorPid },
      );
    }
    // Re-read absence immediately before the saga CAS. Once the initiator is
    // dead, no original process can publish a later workspace lock. Competing
    // recovery callers are serialized by the exact saga head CAS.
    this._inspectBoundOwner(saga.operationId, null);
    const aborted = this._advanceExact(saga, "aborted", {
      recoveryAction: "abort-before-lock",
      reason: normalizedReason,
    });
    const archive = this._archiveTerminal(aborted);
    return Object.freeze({
      ok: true,
      action: "abort",
      ...terminalSummary(aborted),
      reconciledFromError: false,
      ...archive,
    });
  }

  _archiveTerminal(saga) {
    try {
      const archived = this.store.archiveTerminal(saga.operationId, {
        expectedSeq: saga.seq,
        expectedHash: saga.headHash,
      });
      return Object.freeze({
        archived: true,
        alreadyArchived: archived.alreadyArchived === true,
        warning: null,
      });
    } catch (error) {
      return Object.freeze({
        archived: false,
        alreadyArchived: false,
        warning: archiveWarning(error),
      });
    }
  }

  _retainAbortFailure(operationError, lease) {
    let observed = null;
    try {
      observed = this.store.load(lease.recoveryOfOperationId);
    } catch (loadError) {
      if (operationError && typeof operationError === "object") {
        operationError.checkpointRestoreRecoveryLoadError = loadError;
      }
    }

    if (observed?.terminal) return observed;

    if (observed && observed.phase !== "recovery_required") {
      try {
        observed = this._advanceExact(observed, "recovery_required", {
          reason: boundedText(
            operationError?.message,
            "Checkpoint restore abort requires another recovery attempt",
            2_048,
          ),
          errorCode: boundedText(
            operationError?.code,
            "CHECKPOINT_RESTORE_RECOVERY_ABORT_FAILED",
            128,
          ),
        });
      } catch (journalError) {
        if (operationError && typeof operationError === "object") {
          operationError.checkpointRestoreRecoveryJournalError = journalError;
        }
      }
    }

    try {
      lease.retainForRecovery(
        boundedText(
          `${operationError?.code || "CHECKPOINT_RESTORE_RECOVERY_ABORT_FAILED"}: ${operationError?.message || "abort outcome is unknown"}`,
          "Checkpoint restore abort outcome is unknown",
          512,
        ),
      );
    } catch (retentionError) {
      if (retentionError && typeof retentionError === "object") {
        retentionError.checkpointRestoreRecoveryCause = operationError;
        retentionError.checkpointRestoreOperationId =
          lease.recoveryOfOperationId;
        retentionError.checkpointRestoreSagaPhase = observed?.phase || null;
        retentionError.checkpointRestoreSagaSeq = observed?.seq || null;
        retentionError.checkpointRestoreSagaHeadHash =
          observed?.headHash || null;
        retentionError.checkpointRestoreRecoveryRequired = true;
      }
      throw retentionError;
    }
    throw operationError;
  }

  abort(
    operationId,
    {
      expectedSeq,
      expectedHash,
      expectedOwnerDigest,
      reason = "Operator aborted checkpoint restore before durable intent",
    } = {},
  ) {
    validateExpectedAuthority({
      expectedSeq,
      expectedHash,
      expectedOwnerDigest,
    });
    const previewSaga = this._loadExact(operationId, expectedSeq, expectedHash);
    this._assertAbortable(previewSaga);
    const normalizedReason = boundedText(
      reason,
      "Operator aborted checkpoint restore before durable intent",
      2_048,
    );
    const lockFreeAbort = this._abortCreatedWithoutPublishedOwner(
      previewSaga,
      expectedOwnerDigest,
      normalizedReason,
    );
    if (lockFreeAbort) return lockFreeAbort;

    let settled;
    try {
      settled = this._withBoundWorkspaceAuthority(
        operationId,
        expectedOwnerDigest,
        (lease) => {
          try {
            lease.assertOwned();
            let saga = this._loadExact(operationId, expectedSeq, expectedHash);
            this._assertAbortable(saga);

            if (saga.phase !== "recovery_required") {
              saga = this._advanceExact(saga, "recovery_required", {
                reason:
                  "Checkpoint restore was interrupted before durable intent",
                errorCode: "CHECKPOINT_RESTORE_RECOVERY_ABORT_REQUESTED",
              });
            }
            lease.assertOwned();
            const recoveryStartedEvidence = {
              workspaceLockOwner: lease.owner,
              lockOwnerDigest: this._workspaceLockOwnerDigest(lease.owner),
              recoveryAction: "abort-pre-intent",
            };
            saga = this._advanceExact(
              saga,
              "recovery_started",
              recoveryStartedEvidence,
            );
            lease.assertOwned();
            saga = this._advanceExact(saga, "aborted", {
              recoveryAction: "abort-pre-intent",
              reason: normalizedReason,
            });
            lease.assertOwned();
            return Object.freeze({ saga, reconciledFromError: false });
          } catch (error) {
            const saga = this._retainAbortFailure(error, lease);
            return Object.freeze({ saga, reconciledFromError: true });
          }
        },
      );
    } catch (error) {
      throw propagateRecoveryDiagnostics(error);
    }

    const archive = this._archiveTerminal(settled.saga);
    return Object.freeze({
      ok: true,
      action: "abort",
      ...terminalSummary(settled.saga),
      reconciledFromError: settled.reconciledFromError,
      ...archive,
    });
  }

  _readTerminalRetention(operationId, expectedSeq, expectedHash) {
    try {
      return Object.freeze({
        saga: this._assertTerminal(
          this._loadExact(operationId, expectedSeq, expectedHash),
        ),
        alreadyArchived: false,
      });
    } catch (error) {
      if (error?.code !== CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND) {
        throw error;
      }
      // `archiveTerminal` is an exact, idempotent retained-state read when the
      // active operation is absent and the requested archive already exists.
      const archived = this.store.archiveTerminal(operationId, {
        expectedSeq,
        expectedHash,
      });
      return Object.freeze({
        saga: Object.freeze({
          operationId,
          phase: archived.phase,
          seq: archived.seq,
          headHash: archived.headHash,
          terminal: true,
        }),
        alreadyArchived: archived.alreadyArchived === true,
      });
    }
  }

  _retainTerminalVerificationFailure(operationError, lease) {
    try {
      lease.retainForRecovery(
        boundedText(
          `${operationError?.code || "CHECKPOINT_RESTORE_TERMINAL_VERIFY_FAILED"}: ${operationError?.message || "terminal authority is unknown"}`,
          "Checkpoint restore terminal authority is unknown",
          512,
        ),
      );
    } catch (retentionError) {
      if (retentionError && typeof retentionError === "object") {
        retentionError.checkpointRestoreRecoveryCause = operationError;
        retentionError.checkpointRestoreOperationId =
          lease.recoveryOfOperationId;
        retentionError.checkpointRestoreRecoveryRequired = true;
      }
      throw retentionError;
    }
    throw operationError;
  }

  release(
    operationId,
    { expectedSeq, expectedHash, expectedOwnerDigest } = {},
  ) {
    validateExpectedAuthority({
      expectedSeq,
      expectedHash,
      expectedOwnerDigest,
    });
    const preview = this._readTerminalRetention(
      operationId,
      expectedSeq,
      expectedHash,
    );
    this._assertTerminal(preview.saga);

    const observedOwner = this._inspectBoundOwner(
      operationId,
      expectedOwnerDigest,
    );
    if (!observedOwner) {
      const archive = preview.alreadyArchived
        ? Object.freeze({
            archived: true,
            alreadyArchived: true,
            warning: null,
          })
        : this._archiveTerminal(preview.saga);
      return Object.freeze({
        ok: true,
        action: "release",
        ...terminalSummary(preview.saga),
        ...archive,
      });
    }

    const settled = this._withBoundWorkspaceAuthority(
      operationId,
      expectedOwnerDigest,
      (lease) => {
        try {
          lease.assertOwned();
          const retained = this._readTerminalRetention(
            operationId,
            expectedSeq,
            expectedHash,
          );
          this._assertTerminal(retained.saga);
          lease.assertOwned();
          return retained;
        } catch (error) {
          return this._retainTerminalVerificationFailure(error, lease);
        }
      },
    );

    const archive = settled.alreadyArchived
      ? Object.freeze({
          archived: true,
          alreadyArchived: true,
          warning: null,
        })
      : this._archiveTerminal(settled.saga);
    return Object.freeze({
      ok: true,
      action: "release",
      ...terminalSummary(settled.saga),
      ...archive,
    });
  }
}

export function createCheckpointRestoreRecoveryController(options = {}) {
  return new CheckpointRestoreRecoveryController(options);
}
