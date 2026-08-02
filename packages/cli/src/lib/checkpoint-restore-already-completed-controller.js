/**
 * Conservative recovery for a timeline restore whose session transaction is
 * already durably completed.
 *
 * This controller never writes session state and never retries workspace or
 * conversation mutation. It may only reconcile a verified session completion
 * with an exact workspace target and then close the matching saga. The lock
 * order is workspace lifetime authority, verified session read, then short
 * saga CAS operations.
 */

import path from "node:path";
import {
  CheckpointRestoreSagaStore,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "./checkpoint-restore-saga.js";
import { computeCheckpointRestoreDigest } from "./checkpoint-restore-orchestrator.js";
import {
  CHECKPOINT_RESTORE_SESSION_RECONCILIATION,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
  CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
} from "./checkpoint-restore-session-recovery.js";
import {
  inspectWorkspaceLockOwnerSync,
  withWorkspaceRecoveryLockSync,
} from "./process-execution-broker/workspace-transaction.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RAW_EVENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const RECOVERY_PHASES = new Set(["recovery_required", "recovery_started"]);
const ALLOWED_BASE_PHASES = new Set(["workspace_applied", "session_committed"]);
const ACTIONS = new Set(["restore-code", "restore-both"]);
const CHECKPOINT_RESTORE_PURPOSE = "checkpoint-restore";

export const CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION =
  "resume-already-completed";
export const CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA =
  "chainlesschain.checkpoint-restore-workspace-target-verification";
export const CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION = 1;
export const CHECKPOINT_RESTORE_ALREADY_COMPLETED_RESULT_SCHEMA =
  "chainlesschain.checkpoint-restore-already-completed-result";
export const CHECKPOINT_RESTORE_ALREADY_COMPLETED_RESULT_VERSION = 1;

export const CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_INVALID_ARGUMENT",
  SAGA_CONFLICT: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_SAGA_CONFLICT",
  ACTION_NOT_ALLOWED: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION_NOT_ALLOWED",
  OWNER_CONFLICT: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_OWNER_CONFLICT",
  SESSION_CONFLICT: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_SESSION_CONFLICT",
  WORKSPACE_CONFLICT: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_WORKSPACE_CONFLICT",
  ASYNC_UNSUPPORTED: "CHECKPOINT_RESTORE_ALREADY_COMPLETED_ASYNC_UNSUPPORTED",
});

export class CheckpointRestoreAlreadyCompletedError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "CheckpointRestoreAlreadyCompletedError";
    this.code = code;
    Object.assign(this, details);
  }
}

function recoveryError(code, message, details = {}, cause = null) {
  return new CheckpointRestoreAlreadyCompletedError(
    code,
    message,
    details,
    cause,
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw recoveryError(
    CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.INVALID_ARGUMENT,
    "Checkpoint restore recovery evidence is not canonical JSON",
  );
}

function boundedText(value, fallback, maximum = 2_048) {
  let sanitized = "";
  for (const character of String(value || fallback)) {
    const code = character.charCodeAt(0);
    sanitized += code < 32 || code === 127 ? " " : character;
  }
  const normalized = sanitized.trim();
  return (normalized || fallback).slice(0, maximum);
}

function asError(value) {
  return value && typeof value === "object"
    ? value
    : new Error(String(value || "checkpoint restore recovery failed"));
}

function isThenable(value) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  try {
    return typeof value.then === "function";
  } catch (cause) {
    throw recoveryError(
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.ASYNC_UNSUPPORTED,
      "Checkpoint restore recovery result exposed an unsafe thenable",
      {},
      cause,
    );
  }
}

function requireSynchronous(value, boundary) {
  if (isThenable(value)) {
    throw recoveryError(
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.ASYNC_UNSUPPORTED,
      `${boundary} must be synchronous while workspace authority is held`,
    );
  }
  return value;
}

function validateExpectedAuthority({
  operationId,
  expectedSeq,
  expectedHash,
  expectedOwnerDigest,
}) {
  if (
    typeof operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(operationId) ||
    !Number.isSafeInteger(expectedSeq) ||
    expectedSeq < 1 ||
    !DIGEST_PATTERN.test(String(expectedHash || "")) ||
    !DIGEST_PATTERN.test(String(expectedOwnerDigest || ""))
  ) {
    throw recoveryError(
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.INVALID_ARGUMENT,
      "Already-completed recovery requires an operation id, exact saga head, and retained owner digest",
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
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.SAGA_CONFLICT,
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

function singleEvent(saga, phase) {
  const matches = saga.events.filter((event) => event?.phase === phase);
  return matches.length === 1 ? matches[0] : null;
}

function pathKey(value, platform) {
  if (typeof value !== "string" || value.length === 0) return null;
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right, platform) {
  const leftKey = pathKey(left, platform);
  return leftKey !== null && leftKey === pathKey(right, platform);
}

function stateDigest(kind, state, authority) {
  return computeCheckpointRestoreDigest(`cc-checkpoint-restore-${state}-v1`, {
    engine: kind,
    scopeIdentity: authority.workspaceScopeIdentity,
    stateIdentity:
      state === "prestate"
        ? authority.workspacePrestateIdentity
        : authority.workspaceTargetPoststateIdentity,
  });
}

function timelineSagaAuthority(saga, workspaceRoot, platform) {
  const sourcePhase = basePhase(saga);
  const created = singleEvent(saga, "created");
  const prepared = singleEvent(saga, "prepared");
  const intent = singleEvent(saga, "intent_committed");
  const workspaceApplied = singleEvent(saga, "workspace_applied");
  const sessionCommitted = singleEvent(saga, "session_committed");
  const createdEvidence = created?.evidence;
  const intentEvidence = intent?.evidence;
  const sessionId = intentEvidence?.sessionId || createdEvidence?.sessionId;
  const timelineEntryId =
    intentEvidence?.timelineEntryId || createdEvidence?.timelineEntryId || null;

  if (
    saga.terminal ||
    !ALLOWED_BASE_PHASES.has(sourcePhase) ||
    !created ||
    !prepared ||
    !intent ||
    !workspaceApplied ||
    createdEvidence?.restoreSurface !== "timeline" ||
    intentEvidence?.intentAuthority !== "session" ||
    !["git", "copy"].includes(createdEvidence?.restoreKind) ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    (createdEvidence.sessionId && createdEvidence.sessionId !== sessionId) ||
    (intentEvidence.sessionId && intentEvidence.sessionId !== sessionId) ||
    (createdEvidence.timelineEntryId &&
      createdEvidence.timelineEntryId !== timelineEntryId) ||
    (intentEvidence.timelineEntryId &&
      intentEvidence.timelineEntryId !== timelineEntryId) ||
    !samePath(createdEvidence.workspaceRoot, workspaceRoot, platform) ||
    typeof createdEvidence.checkpointId !== "string" ||
    typeof createdEvidence.checkpointIdentity !== "string" ||
    (createdEvidence.restoreKind === "git" &&
      typeof createdEvidence.checkpointNamespace !== "string") ||
    !DIGEST_PATTERN.test(String(createdEvidence.workspaceBinding || "")) ||
    !DIGEST_PATTERN.test(String(createdEvidence.confirmationDigest || "")) ||
    !DIGEST_PATTERN.test(String(prepared.evidence?.prestateDigest || "")) ||
    !DIGEST_PATTERN.test(
      String(workspaceApplied.evidence?.poststateDigest || ""),
    ) ||
    !DIGEST_PATTERN.test(String(intentEvidence.intentCommitDigest || "")) ||
    (sourcePhase === "session_committed" &&
      (!sessionCommitted ||
        !DIGEST_PATTERN.test(
          String(sessionCommitted.evidence?.sessionCommitDigest || ""),
        ))) ||
    (sourcePhase === "workspace_applied" && sessionCommitted)
  ) {
    throw recoveryError(
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.ACTION_NOT_ALLOWED,
      "Only an exact timeline workspace_applied or session_committed saga can reconcile an already-completed session",
      {
        operationId: saga.operationId,
        phase: saga.phase,
        basePhase: sourcePhase,
      },
    );
  }

  return Object.freeze({
    basePhase: sourcePhase,
    restoreKind: createdEvidence.restoreKind,
    sessionId,
    timelineEntryId,
    checkpointId: createdEvidence.checkpointId,
    checkpointIdentity: createdEvidence.checkpointIdentity,
    checkpointNamespace: createdEvidence.checkpointNamespace || null,
    workspaceBinding: createdEvidence.workspaceBinding,
    confirmationDigest: createdEvidence.confirmationDigest,
    prestateDigest: prepared.evidence.prestateDigest,
    poststateDigest: workspaceApplied.evidence.poststateDigest,
    intentCommitDigest: intentEvidence.intentCommitDigest,
    sessionCommitDigest:
      sessionCommitted?.evidence?.sessionCommitDigest || null,
  });
}

function sessionConflict(message, details = {}) {
  throw recoveryError(
    CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.SESSION_CONFLICT,
    message,
    details,
  );
}

function validateSessionProjection(
  projection,
  operationId,
  authority,
  workspaceRoot,
  platform,
) {
  const intent = projection?.intent;
  const completed = projection?.audit?.completed;
  const intentAuthority = intent?.authority;
  const completedAuthority = completed?.authority;
  if (
    !isPlainObject(projection) ||
    projection.schema !== CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA ||
    projection.version !== CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION ||
    projection.operationId !== operationId ||
    projection.sessionId !== authority.sessionId ||
    projection.restoreSurface !== "timeline" ||
    projection.classification !==
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ALREADY_COMPLETED ||
    projection.failClosed !== false ||
    projection.safeToMutate !== false ||
    !Array.isArray(projection.issues) ||
    projection.issues.length !== 0 ||
    !isPlainObject(projection.transcript) ||
    !RAW_EVENT_HASH_PATTERN.test(
      String(projection.transcript.headHash || ""),
    ) ||
    !Number.isSafeInteger(projection.transcript.eventCount) ||
    projection.transcript.eventCount < 1 ||
    !isPlainObject(intent) ||
    !RAW_EVENT_HASH_PATTERN.test(String(intent.eventHash || "")) ||
    !DIGEST_PATTERN.test(String(intent.intentCommitDigest || "")) ||
    !isPlainObject(intentAuthority) ||
    !ACTIONS.has(intentAuthority.action) ||
    !isPlainObject(completed) ||
    completed.status !== "completed" ||
    !RAW_EVENT_HASH_PATTERN.test(String(completed.eventHash || "")) ||
    !DIGEST_PATTERN.test(String(completed.sessionCommitDigest || "")) ||
    !isPlainObject(completedAuthority) ||
    projection.audit.failed !== null ||
    projection.transcript.operationTailHash !== completed.eventHash ||
    canonicalJson(intentAuthority) !== canonicalJson(completedAuthority)
  ) {
    return sessionConflict(
      "Verified session recovery did not return one exact already-completed settlement",
      { operationId, classification: projection?.classification || null },
    );
  }

  const computedIntentDigest = computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-intent-commit-v1",
    intent.eventHash,
  );
  const computedSessionDigest = computeCheckpointRestoreDigest(
    "cc-checkpoint-restore-session-commit-v1",
    completed.eventHash,
  );
  if (
    intent.intentCommitDigest !== computedIntentDigest ||
    intent.intentCommitDigest !== authority.intentCommitDigest ||
    completed.sessionCommitDigest !== computedSessionDigest ||
    (authority.sessionCommitDigest &&
      completed.sessionCommitDigest !== authority.sessionCommitDigest) ||
    (authority.timelineEntryId &&
      intentAuthority.turnId !== authority.timelineEntryId) ||
    intentAuthority.checkpointId !== authority.checkpointId ||
    intentAuthority.checkpointIdentity !== authority.checkpointIdentity ||
    intentAuthority.workspaceWritePlanIdentity !== authority.workspaceBinding ||
    intentAuthority.confirmationDigest !== authority.confirmationDigest ||
    !samePath(intentAuthority.workspaceDir, workspaceRoot, platform) ||
    stateDigest(authority.restoreKind, "prestate", intentAuthority) !==
      authority.prestateDigest ||
    stateDigest(authority.restoreKind, "poststate", intentAuthority) !==
      authority.poststateDigest
  ) {
    return sessionConflict(
      "Verified session settlement does not match the durable saga authority",
      { operationId },
    );
  }

  return Object.freeze({
    schema: CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
    version: CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
    sessionId: authority.sessionId,
    transcriptHeadHash: projection.transcript.headHash,
    transcriptEventCount: projection.transcript.eventCount,
    action: intentAuthority.action,
    intentEventHash: intent.eventHash,
    intentCommitDigest: intent.intentCommitDigest,
    completedAuditEventHash: completed.eventHash,
    sessionCommitDigest: completed.sessionCommitDigest,
  });
}

function validateWorkspaceProjection(
  projection,
  operationId,
  authority,
  sessionAuthority,
) {
  if (
    !isPlainObject(projection) ||
    projection.schema !==
      CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA ||
    projection.version !==
      CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION ||
    projection.verified !== true ||
    projection.exact !== true ||
    projection.operationId !== operationId ||
    projection.restoreKind !== authority.restoreKind ||
    projection.checkpointNamespace !== authority.checkpointNamespace ||
    projection.checkpointId !== authority.checkpointId ||
    projection.checkpointIdentity !== authority.checkpointIdentity ||
    projection.workspaceScopeIdentity !==
      sessionAuthority.workspaceScopeIdentity ||
    projection.workspaceTargetPoststateIdentity !==
      sessionAuthority.workspaceTargetPoststateIdentity ||
    projection.poststateDigest !== authority.poststateDigest
  ) {
    throw recoveryError(
      CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.WORKSPACE_CONFLICT,
      "Workspace target verification did not prove the exact durable target",
      { operationId },
    );
  }
  return Object.freeze({
    schema: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_SCHEMA,
    version: CHECKPOINT_RESTORE_WORKSPACE_TARGET_VERIFICATION_VERSION,
    verified: true,
    exact: true,
    operationId,
    restoreKind: authority.restoreKind,
    checkpointNamespace: authority.checkpointNamespace,
    checkpointId: authority.checkpointId,
    checkpointIdentity: authority.checkpointIdentity,
    workspaceScopeIdentity: projection.workspaceScopeIdentity,
    workspaceTargetPoststateIdentity:
      projection.workspaceTargetPoststateIdentity,
    poststateDigest: projection.poststateDigest,
  });
}

function resultProjection(operationId, workspace, session) {
  return Object.freeze({
    schema: CHECKPOINT_RESTORE_ALREADY_COMPLETED_RESULT_SCHEMA,
    version: CHECKPOINT_RESTORE_ALREADY_COMPLETED_RESULT_VERSION,
    operationId,
    recoveryAction: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
    workspace,
    session,
  });
}

function terminalSummary(saga) {
  return Object.freeze({
    operationId: saga.operationId,
    phase: saga.phase,
    seq: saga.seq,
    headHash: saga.headHash,
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

export class CheckpointRestoreAlreadyCompletedController {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw recoveryError(
        CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.INVALID_ARGUMENT,
        "Already-completed recovery controller options must be an object",
      );
    }
    if (
      typeof options.workspaceRoot !== "string" ||
      options.workspaceRoot.length === 0
    ) {
      throw recoveryError(
        CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.INVALID_ARGUMENT,
        "Already-completed recovery requires a workspaceRoot",
      );
    }
    const sessionReader =
      options.readSessionRecovery ||
      (typeof options.sessionRecoveryReader?.read === "function"
        ? options.sessionRecoveryReader.read.bind(options.sessionRecoveryReader)
        : null);
    if (
      typeof sessionReader !== "function" ||
      typeof options.verifyWorkspaceTarget !== "function"
    ) {
      throw recoveryError(
        CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.INVALID_ARGUMENT,
        "Already-completed recovery requires session and workspace verification readers",
      );
    }

    this.workspaceRoot = options.workspaceRoot;
    this.store =
      options.store ||
      new CheckpointRestoreSagaStore({ workspaceRoot: this.workspaceRoot });
    this._readSessionRecovery = sessionReader;
    this._verifyWorkspaceTarget = options.verifyWorkspaceTarget;
    this._inspectWorkspaceLockOwnerSync =
      options.inspectWorkspaceLockOwnerSync || inspectWorkspaceLockOwnerSync;
    this._withWorkspaceRecoveryLockSync =
      options.withWorkspaceRecoveryLockSync || withWorkspaceRecoveryLockSync;
    this._workspaceLockOwnerDigest =
      options.computeWorkspaceLockOwnerDigest ||
      computeCheckpointRestoreWorkspaceLockOwnerDigest;
    this._workspaceLockOptions = Object.freeze({
      ...(options.workspaceLockOptions || {}),
    });
    this._platform = options.platform || process.platform;
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
      requireSynchronous(
        this.store.load(operationId),
        "checkpoint restore saga load",
      ),
      operationId,
      expectedSeq,
      expectedHash,
    );
  }

  _advanceExact(saga, phase, evidence) {
    try {
      return requireSynchronous(
        this.store.advance(saga.operationId, {
          expectedSeq: saga.seq,
          expectedHash: saga.headHash,
          phase,
          evidence,
        }),
        "checkpoint restore saga advance",
      );
    } catch (caught) {
      const error = asError(caught);
      try {
        const observed = requireSynchronous(
          this.store.load(saga.operationId),
          "checkpoint restore saga reconciliation load",
        );
        const latest = observed.events?.at(-1);
        if (
          observed.seq === saga.seq + 1 &&
          observed.phase === phase &&
          latest?.prevHash === saga.headHash &&
          canonicalJson(latest.evidence) === canonicalJson(evidence)
        ) {
          return observed;
        }
      } catch (loadError) {
        error.checkpointRestoreRecoveryLoadError = loadError;
      }
      throw error;
    }
  }

  _inspectBoundOwner(operationId, expectedOwnerDigest) {
    const owner = this._inspectWorkspaceLockOwnerSync(
      this._lockOptions(operationId),
    );
    if (!owner) {
      throw recoveryError(
        CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore has no retained workspace owner to take over",
        { operationId, expectedOwnerDigest, actualOwnerDigest: null },
      );
    }
    const actualOwnerDigest = this._workspaceLockOwnerDigest(owner);
    if (actualOwnerDigest !== expectedOwnerDigest) {
      throw recoveryError(
        CHECKPOINT_RESTORE_ALREADY_COMPLETED_ERROR_CODES.OWNER_CONFLICT,
        "Checkpoint restore workspace owner changed after recovery preview",
        { operationId, expectedOwnerDigest, actualOwnerDigest },
      );
    }
    return owner;
  }

  _archiveTerminal(saga) {
    try {
      const archived = requireSynchronous(
        this.store.archiveTerminal(saga.operationId, {
          expectedSeq: saga.seq,
          expectedHash: saga.headHash,
        }),
        "checkpoint restore saga archive",
      );
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

  _retainFailure(operationError, lease, completedEvidence = null) {
    const error = asError(operationError);
    let observed = null;
    try {
      observed = requireSynchronous(
        this.store.load(lease.recoveryOfOperationId),
        "checkpoint restore failure reconciliation load",
      );
      const latest = observed.events?.at(-1);
      if (
        completedEvidence &&
        observed.terminal &&
        observed.phase === "completed" &&
        canonicalJson(latest?.evidence) === canonicalJson(completedEvidence)
      ) {
        return Object.freeze({ saga: observed, reconciledFromError: true });
      }
      if (!observed.terminal) {
        timelineSagaAuthority(observed, this.workspaceRoot, this._platform);
        if (observed.phase !== "recovery_required") {
          observed = this._advanceExact(observed, "recovery_required", {
            reason: boundedText(
              error.message,
              "Already-completed restore reconciliation requires another attempt",
            ),
            errorCode: boundedText(
              error.code,
              "CHECKPOINT_RESTORE_ALREADY_COMPLETED_FAILED",
              128,
            ),
          });
        }
      }
    } catch (journalError) {
      error.checkpointRestoreRecoveryJournalError = journalError;
    }

    try {
      lease.retainForRecovery(
        boundedText(
          `${error.code || "CHECKPOINT_RESTORE_ALREADY_COMPLETED_FAILED"}: ${error.message || "already-completed outcome is unknown"}`,
          "Already-completed restore outcome is unknown",
          512,
        ),
      );
    } catch (retentionError) {
      if (retentionError && typeof retentionError === "object") {
        retentionError.checkpointRestoreRecoveryCause = error;
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
    throw error;
  }

  resume(operationId, { expectedSeq, expectedHash, expectedOwnerDigest } = {}) {
    validateExpectedAuthority({
      operationId,
      expectedSeq,
      expectedHash,
      expectedOwnerDigest,
    });
    const previewSaga = this._loadExact(operationId, expectedSeq, expectedHash);
    const previewAuthority = timelineSagaAuthority(
      previewSaga,
      this.workspaceRoot,
      this._platform,
    );
    const observedOwner = this._inspectBoundOwner(
      operationId,
      expectedOwnerDigest,
    );

    let settled;
    try {
      settled = this._withWorkspaceRecoveryLockSync(
        {
          ...this._lockOptions(operationId),
          expectedOwner: observedOwner,
        },
        (lease) => {
          let completedEvidence = null;
          try {
            lease.assertOwned();
            const sessionOptions = {
              operationId,
              sessionId: previewAuthority.sessionId,
              restoreSurface: "timeline",
              expectedIntentCommitDigest: previewAuthority.intentCommitDigest,
              expectedCheckpointId: previewAuthority.checkpointId,
              expectedCheckpointIdentity: previewAuthority.checkpointIdentity,
              expectedConfirmationDigest: previewAuthority.confirmationDigest,
              ...(previewAuthority.timelineEntryId
                ? {
                    expectedTimelineEntryId: previewAuthority.timelineEntryId,
                  }
                : {}),
              ...(previewAuthority.sessionCommitDigest
                ? {
                    expectedSessionCommitDigest:
                      previewAuthority.sessionCommitDigest,
                  }
                : {}),
            };
            const rawSessionProjection = requireSynchronous(
              this._readSessionRecovery(Object.freeze(sessionOptions)),
              "checkpoint restore verified session recovery read",
            );
            const session = validateSessionProjection(
              rawSessionProjection,
              operationId,
              previewAuthority,
              this.workspaceRoot,
              this._platform,
            );
            lease.assertOwned();

            const sessionIntentAuthority =
              rawSessionProjection.intent.authority;
            const workspaceExpected = Object.freeze({
              operationId,
              restoreKind: previewAuthority.restoreKind,
              checkpointId: previewAuthority.checkpointId,
              checkpointIdentity: previewAuthority.checkpointIdentity,
              checkpointNamespace: previewAuthority.checkpointNamespace,
              workspaceScopeIdentity:
                sessionIntentAuthority.workspaceScopeIdentity,
              workspaceTargetPoststateIdentity:
                sessionIntentAuthority.workspaceTargetPoststateIdentity,
              poststateDigest: previewAuthority.poststateDigest,
            });
            const rawWorkspaceProjection = requireSynchronous(
              this._verifyWorkspaceTarget(
                Object.freeze({
                  operationId,
                  workspaceRoot: this.workspaceRoot,
                  workspaceLease: lease,
                  expected: workspaceExpected,
                }),
              ),
              "checkpoint restore workspace target verification",
            );
            const workspace = validateWorkspaceProjection(
              rawWorkspaceProjection,
              operationId,
              previewAuthority,
              sessionIntentAuthority,
            );
            lease.assertOwned();

            const projection = resultProjection(
              operationId,
              workspace,
              session,
            );
            const resultDigest = computeCheckpointRestoreDigest(
              "cc-checkpoint-restore-already-completed-result-v1",
              projection,
            );
            completedEvidence = Object.freeze({
              recoveryAction: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
              sessionCommitDigest: session.sessionCommitDigest,
              resultDigest,
            });

            let saga = this._loadExact(operationId, expectedSeq, expectedHash);
            timelineSagaAuthority(saga, this.workspaceRoot, this._platform);
            if (saga.phase !== "recovery_required") {
              saga = this._advanceExact(saga, "recovery_required", {
                reason:
                  "Verified session completion requires exact saga reconciliation",
                errorCode:
                  "CHECKPOINT_RESTORE_ALREADY_COMPLETED_RECONCILIATION",
              });
            }
            lease.assertOwned();
            saga = this._advanceExact(saga, "recovery_started", {
              workspaceLockOwner: lease.owner,
              lockOwnerDigest: this._workspaceLockOwnerDigest(lease.owner),
              recoveryAction: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
            });
            lease.assertOwned();
            saga = this._advanceExact(saga, "completed", completedEvidence);
            lease.assertOwned();
            return Object.freeze({
              saga,
              sessionCommitDigest: session.sessionCommitDigest,
              resultDigest,
              reconciledFromError: false,
            });
          } catch (error) {
            const reconciled = this._retainFailure(
              error,
              lease,
              completedEvidence,
            );
            if (reconciled?.saga) {
              return Object.freeze({
                saga: reconciled.saga,
                sessionCommitDigest: completedEvidence.sessionCommitDigest,
                resultDigest: completedEvidence.resultDigest,
                reconciledFromError: true,
              });
            }
            return reconciled;
          }
        },
      );
    } catch (error) {
      throw propagateRecoveryDiagnostics(error);
    }

    const archive = this._archiveTerminal(settled.saga);
    return Object.freeze({
      ok: true,
      action: CHECKPOINT_RESTORE_ALREADY_COMPLETED_ACTION,
      ...terminalSummary(settled.saga),
      sessionCommitDigest: settled.sessionCommitDigest,
      resultDigest: settled.resultDigest,
      reconciledFromError: settled.reconciledFromError,
      ...archive,
    });
  }
}

export function createCheckpointRestoreAlreadyCompletedController(
  options = {},
) {
  return new CheckpointRestoreAlreadyCompletedController(options);
}
