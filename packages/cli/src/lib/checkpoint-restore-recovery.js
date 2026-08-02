/**
 * Read-only checkpoint restore recovery projections.
 *
 * This module intentionally owns no mutation path. It consumes only the
 * verified output of CheckpointRestoreSagaStore.listPending()/load(), removes
 * private workspace-owner evidence, and derives conservative action
 * preconditions for a future command/controller layer.
 *
 * An action marked `candidate` is visible for adjudication. Only `eligible`
 * may be treated as executable, and every executable action still requires
 * the command layer to revalidate the exact sequence, head hash and owner
 * digest immediately before mutation.
 */

export const CHECKPOINT_RESTORE_RECOVERY_PROJECTION_SCHEMA =
  "chainlesschain.checkpoint-restore-recovery-projection";
export const CHECKPOINT_RESTORE_RECOVERY_LIST_SCHEMA =
  "chainlesschain.checkpoint-restore-recovery-list";
export const CHECKPOINT_RESTORE_RECOVERY_PROJECTION_VERSION = 1;
export const MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT = 64;

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

const PHASES = new Set([
  "created",
  "locked",
  "prepared",
  "intent_committed",
  "safety_ready",
  "mutation_started",
  "workspace_applied",
  "session_committed",
  "completed",
  "aborted",
  "rolled_back",
  "recovery_required",
  "recovery_started",
]);
const RECOVERY_PHASES = new Set(["recovery_required", "recovery_started"]);
const TERMINAL_PHASES = new Set(["completed", "aborted", "rolled_back"]);
const MUTATED_BASE_PHASES = new Set([
  "mutation_started",
  "workspace_applied",
  "session_committed",
]);
const ABORT_CANDIDATE_BASE_PHASES = new Set([
  "created",
  "locked",
  "prepared",
  "intent_committed",
  "safety_ready",
]);
const ABORT_ELIGIBLE_BASE_PHASES = new Set(["created", "locked"]);
const ENUM_FIELDS = Object.freeze({
  restoreKind: new Set(["copy", "git", "timeline"]),
  restoreSurface: new Set(["direct", "timeline"]),
  intentAuthority: new Set(["operation", "session"]),
  safetyCoverage: new Set(["full", "partial", "none", "unknown"]),
});
const TEXT_FIELD_LIMITS = Object.freeze({
  checkpointNamespace: 256,
  checkpointId: 256,
  checkpointIdentity: 1024,
  sessionId: 256,
  timelineEntryId: 256,
});
const DIAGNOSTIC_STATUSES = new Set([
  "orphan_unpublished",
  "archived",
  "purge_pending",
  "purged_receipt",
  "purge_receipt_temporary",
  "terminal_unarchived",
  "orphan_temporary",
  "busy",
  "corrupt",
]);

function freezeArray(values) {
  return Object.freeze([...values]);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOperationId(operationId, label = "operationId") {
  if (
    typeof operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(operationId)
  ) {
    throw new TypeError(
      `${label} must be a safe checkpoint restore identifier`,
    );
  }
  return operationId;
}

function assertStore(store) {
  if (
    !store ||
    typeof store !== "object" ||
    typeof store.listPending !== "function" ||
    typeof store.load !== "function"
  ) {
    throw new TypeError(
      "checkpoint restore recovery reader requires listPending/load dependencies",
    );
  }
  return store;
}

function assertSaga(saga) {
  if (!isPlainObject(saga)) {
    throw new TypeError("checkpoint restore saga projection must be an object");
  }
  const operationId = assertOperationId(saga.operationId);
  if (
    !Number.isSafeInteger(saga.seq) ||
    saga.seq < 1 ||
    typeof saga.headHash !== "string" ||
    !HASH_PATTERN.test(saga.headHash) ||
    !PHASES.has(saga.phase) ||
    typeof saga.workspaceIdentity !== "string" ||
    !HASH_PATTERN.test(saga.workspaceIdentity) ||
    !Array.isArray(saga.events) ||
    saga.events.length !== saga.seq
  ) {
    throw new TypeError("checkpoint restore saga projection is not canonical");
  }

  const terminal = TERMINAL_PHASES.has(saga.phase);
  if (saga.terminal !== terminal || saga.pending !== !terminal) {
    throw new TypeError(
      "checkpoint restore saga terminal flags are inconsistent",
    );
  }

  for (let index = 0; index < saga.events.length; index += 1) {
    const event = saga.events[index];
    if (
      !isPlainObject(event) ||
      event.operationId !== operationId ||
      event.seq !== index + 1 ||
      !PHASES.has(event.phase) ||
      !Number.isSafeInteger(event.timestamp) ||
      event.timestamp < 0 ||
      typeof event.hash !== "string" ||
      !HASH_PATTERN.test(event.hash) ||
      !isPlainObject(event.evidence)
    ) {
      throw new TypeError(
        "checkpoint restore saga event projection is invalid",
      );
    }
  }

  const head = saga.events.at(-1);
  if (
    head.seq !== saga.seq ||
    head.phase !== saga.phase ||
    head.hash !== saga.headHash
  ) {
    throw new TypeError(
      "checkpoint restore saga head projection is inconsistent",
    );
  }
  return saga;
}

function latestEvidence(events, key) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const evidence = events[index].evidence;
    if (Object.hasOwn(evidence, key)) return evidence[key];
  }
  return undefined;
}

function optionalHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value) ? value : null;
}

function optionalEnum(field, value) {
  return typeof value === "string" && ENUM_FIELDS[field]?.has(value)
    ? value
    : null;
}

function optionalText(field, value) {
  const limit = TEXT_FIELD_LIMITS[field];
  return typeof value === "string" && value.length <= limit ? value : null;
}

function optionalCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeErrorCode(value) {
  return typeof value === "string" && SAFE_ERROR_CODE_PATTERN.test(value)
    ? value
    : null;
}

function recoveryBasePhase(events) {
  let basePhase = null;
  for (const event of events) {
    if (
      !RECOVERY_PHASES.has(event.phase) &&
      !TERMINAL_PHASES.has(event.phase)
    ) {
      basePhase = event.phase;
    }
  }
  return basePhase;
}

function action({ candidate, eligible, blockers, prerequisites }) {
  return Object.freeze({
    candidate: candidate === true,
    eligible: eligible === true,
    blockers: freezeArray(blockers),
    prerequisites: freezeArray(prerequisites),
  });
}

function unavailableActions(blocker) {
  const unavailable = () =>
    action({
      candidate: false,
      eligible: false,
      blockers: [blocker],
      prerequisites: [],
    });
  return Object.freeze({
    mode: "read_only_preflight",
    abort: unavailable(),
    resume: unavailable(),
    rollback: unavailable(),
    release: unavailable(),
  });
}

function deriveActionEligibility({
  phase,
  basePhase,
  terminal,
  clean,
  workspaceLockOwnerDigest,
  hasSessionAuthority,
  hasFullSafety,
}) {
  const pending = !terminal;
  const knownBasePhase = basePhase !== null;
  const recoveryClaimed = RECOVERY_PHASES.has(phase);
  const commonMutationPrerequisites = [
    "exact_seq_and_head_match",
    "workspace_owner_status_verification",
    "workspace_state_verification",
  ];
  if (hasSessionAuthority) {
    commonMutationPrerequisites.push("session_state_verification");
  }
  if (!recoveryClaimed) {
    commonMutationPrerequisites.push("recovery_claim");
  }

  const abortCandidate =
    pending &&
    knownBasePhase &&
    clean &&
    ABORT_CANDIDATE_BASE_PHASES.has(basePhase);
  const abortSupported = ABORT_ELIGIBLE_BASE_PHASES.has(basePhase);
  const abortOwnerBindingComplete =
    basePhase === "created"
      ? workspaceLockOwnerDigest === null
      : workspaceLockOwnerDigest !== null;
  const abortEligible = false;
  const abortBlockers = [];
  if (!pending) abortBlockers.push("saga_is_terminal");
  if (!knownBasePhase) abortBlockers.push("base_phase_unknown");
  if (!clean) abortBlockers.push("saga_has_orphan_temporary_files");
  if (
    pending &&
    knownBasePhase &&
    !ABORT_CANDIDATE_BASE_PHASES.has(basePhase)
  ) {
    abortBlockers.push("abort_not_safe_after_mutation_boundary");
  }
  if (abortCandidate && !abortSupported) {
    abortBlockers.push(
      "controller_phase_not_supported",
      "session_intent_state_unverified",
    );
  }
  if (abortCandidate && basePhase === "created" && !abortOwnerBindingComplete) {
    abortBlockers.push("unexpected_workspace_owner_digest");
  }
  if (abortCandidate && basePhase === "locked" && !abortOwnerBindingComplete) {
    abortBlockers.push("workspace_owner_digest_missing");
  }
  if (abortCandidate && abortSupported && abortOwnerBindingComplete) {
    abortBlockers.push("workspace_owner_status_unverified");
  }
  const abortPrerequisites = abortCandidate
    ? [
        "exact_seq_and_head_match",
        basePhase === "created"
          ? "workspace_owner_absence_verification"
          : "workspace_owner_digest_match",
        ...(basePhase === "created"
          ? []
          : ["workspace_owner_status_verification"]),
        ...(!abortSupported ? ["session_intent_state_verification"] : []),
        ...(hasSessionAuthority ? ["session_state_verification"] : []),
      ]
    : [];

  const resumeCandidate = pending && knownBasePhase && clean;
  const resumeBlockers = [];
  if (!pending) resumeBlockers.push("saga_is_terminal");
  if (!knownBasePhase) resumeBlockers.push("base_phase_unknown");
  if (!clean) resumeBlockers.push("saga_has_orphan_temporary_files");
  if (resumeCandidate) {
    resumeBlockers.push(
      "workspace_owner_status_unverified",
      "workspace_state_unverified",
    );
    if (hasSessionAuthority) {
      resumeBlockers.push("session_state_unverified");
    }
  }

  const mutationBoundaryReached = MUTATED_BASE_PHASES.has(basePhase);
  const rollbackCandidate =
    pending &&
    knownBasePhase &&
    clean &&
    mutationBoundaryReached &&
    hasFullSafety;
  const rollbackBlockers = [];
  if (!pending) rollbackBlockers.push("saga_is_terminal");
  if (!knownBasePhase) rollbackBlockers.push("base_phase_unknown");
  if (!clean) rollbackBlockers.push("saga_has_orphan_temporary_files");
  if (pending && knownBasePhase && !mutationBoundaryReached) {
    rollbackBlockers.push("workspace_mutation_not_proven");
  }
  if (pending && mutationBoundaryReached && !hasFullSafety) {
    rollbackBlockers.push("full_safety_evidence_missing");
  }
  if (rollbackCandidate) {
    rollbackBlockers.push(
      "workspace_owner_status_unverified",
      "workspace_state_unverified",
      "safety_checkpoint_unverified",
    );
    if (hasSessionAuthority) {
      rollbackBlockers.push("session_state_unverified");
    }
  }

  const releaseCandidate = terminal;
  const releaseEligible = false;
  const releaseBlockers = [];
  if (!terminal) releaseBlockers.push("saga_is_not_terminal");
  if (!clean) releaseBlockers.push("saga_has_orphan_temporary_files");
  if (terminal && clean) {
    releaseBlockers.push("workspace_owner_status_unverified");
  }

  return Object.freeze({
    mode: "read_only_preflight",
    abort: action({
      candidate: abortCandidate,
      eligible: abortEligible,
      blockers: abortBlockers,
      prerequisites: abortPrerequisites,
    }),
    resume: action({
      candidate: resumeCandidate,
      eligible: false,
      blockers: resumeBlockers,
      prerequisites: resumeCandidate ? commonMutationPrerequisites : [],
    }),
    rollback: action({
      candidate: rollbackCandidate,
      eligible: false,
      blockers: rollbackBlockers,
      prerequisites: rollbackCandidate
        ? [...commonMutationPrerequisites, "verified_full_safety_checkpoint"]
        : [],
    }),
    release: action({
      candidate: releaseCandidate,
      eligible: releaseEligible,
      blockers: releaseBlockers,
      prerequisites: releaseCandidate
        ? ["exact_seq_and_head_match", "live_workspace_owner_fence"]
        : [],
    }),
  });
}

/**
 * Project one already-verified saga without returning its event/evidence
 * objects. In particular, workspaceRoot and workspaceLockOwner are never part
 * of the returned object.
 */
export function projectCheckpointRestoreRecovery(input) {
  const saga = assertSaga(input);
  const events = saga.events;
  const basePhase = recoveryBasePhase(events);
  const restoreKind = optionalEnum(
    "restoreKind",
    latestEvidence(events, "restoreKind"),
  );
  const restoreSurface = optionalEnum(
    "restoreSurface",
    latestEvidence(events, "restoreSurface"),
  );
  const intentAuthority = optionalEnum(
    "intentAuthority",
    latestEvidence(events, "intentAuthority"),
  );
  const sessionId = optionalText(
    "sessionId",
    latestEvidence(events, "sessionId"),
  );
  const timelineEntryId = optionalText(
    "timelineEntryId",
    latestEvidence(events, "timelineEntryId"),
  );
  const safetyCoverage = optionalEnum(
    "safetyCoverage",
    latestEvidence(events, "safetyCoverage"),
  );
  const safetyId = optionalText(
    "checkpointId",
    latestEvidence(events, "safetyId"),
  );
  const safetyIdentity = optionalText(
    "checkpointIdentity",
    latestEvidence(events, "safetyIdentity"),
  );
  const safetyPlanIdentity = optionalText(
    "checkpointIdentity",
    latestEvidence(events, "safetyPlanIdentity"),
  );
  const workspaceLockOwnerDigest = optionalHash(
    latestEvidence(events, "lockOwnerDigest"),
  );
  const workspaceOwnerEvidencePresent = events.some((event) =>
    Object.hasOwn(event.evidence, "workspaceLockOwner"),
  );
  const orphanTemporaryFilesPresent =
    Array.isArray(saga.orphanTemporaryFiles) &&
    saga.orphanTemporaryFiles.length > 0;
  const clean = !orphanTemporaryFilesPresent;
  const hasSessionAuthority =
    intentAuthority === "session" ||
    sessionId !== null ||
    timelineEntryId !== null;
  const hasFullSafety =
    safetyCoverage === "full" &&
    safetyId !== null &&
    safetyIdentity !== null &&
    safetyPlanIdentity !== null;
  const actionEligibility = deriveActionEligibility({
    phase: saga.phase,
    basePhase,
    terminal: saga.terminal,
    clean,
    workspaceLockOwnerDigest,
    hasSessionAuthority,
    hasFullSafety,
  });

  return Object.freeze({
    schema: CHECKPOINT_RESTORE_RECOVERY_PROJECTION_SCHEMA,
    version: CHECKPOINT_RESTORE_RECOVERY_PROJECTION_VERSION,
    operationId: saga.operationId,
    phase: saga.phase,
    basePhase,
    status: saga.terminal
      ? "terminal"
      : saga.phase === "recovery_required"
        ? "recovery_required"
        : saga.phase === "recovery_started"
          ? "recovery_in_progress"
          : "pending",
    pending: saga.pending,
    terminal: saga.terminal,
    seq: saga.seq,
    headHash: saga.headHash,
    workspaceIdentity: saga.workspaceIdentity,
    fence: Object.freeze({
      expectedSeq: saga.seq,
      expectedHash: saga.headHash,
      // Historical saga evidence is diagnostic only. A command must inspect
      // the current canonical workspace lock before deriving an owner fence.
      ownerAuthority: "unverified",
      recordedOwnerDigest: workspaceLockOwnerDigest,
    }),
    createdAt: events[0].timestamp,
    updatedAt: events.at(-1).timestamp,
    restore: Object.freeze({
      kind: restoreKind,
      surface: restoreSurface,
      intentAuthority,
      checkpointNamespace: optionalText(
        "checkpointNamespace",
        latestEvidence(events, "checkpointNamespace"),
      ),
      checkpointId: optionalText(
        "checkpointId",
        latestEvidence(events, "checkpointId"),
      ),
      checkpointIdentity: optionalText(
        "checkpointIdentity",
        latestEvidence(events, "checkpointIdentity"),
      ),
      sessionId,
      timelineEntryId,
    }),
    progress: Object.freeze({
      targetCount: optionalCount(latestEvidence(events, "targetCount")),
      appliedCount: optionalCount(latestEvidence(events, "appliedCount")),
    }),
    safety: Object.freeze({
      coverage: safetyCoverage,
      checkpointId: safetyId,
      checkpointIdentity: safetyIdentity,
      planIdentity: safetyPlanIdentity,
      complete: hasFullSafety,
    }),
    authority: Object.freeze({
      workspaceOwnerEvidencePresent,
      workspaceOwnerDigestPresent: workspaceLockOwnerDigest !== null,
      complete:
        workspaceOwnerEvidencePresent && workspaceLockOwnerDigest !== null,
    }),
    recovery: Object.freeze({
      errorCode: safeErrorCode(latestEvidence(events, "errorCode")),
      reasonPresent: events.some((event) =>
        Object.hasOwn(event.evidence, "reason"),
      ),
      actionRecorded: events.some((event) =>
        Object.hasOwn(event.evidence, "recoveryAction"),
      ),
    }),
    integrity: Object.freeze({
      clean,
      orphanTemporaryFilesPresent,
    }),
    actionEligibility,
  });
}

function projectDiagnostic(input) {
  if (!isPlainObject(input)) {
    throw new TypeError("checkpoint restore recovery diagnostic is invalid");
  }
  const operationId = assertOperationId(
    input.operationId,
    "diagnostic operationId",
  );
  const status = DIAGNOSTIC_STATUSES.has(input.status)
    ? input.status
    : "unavailable";
  return Object.freeze({
    operationId,
    status,
    code: safeErrorCode(input.code),
    recoverable: input.recoverable === true,
    actionEligibility: unavailableActions("verified_saga_projection_required"),
  });
}

/** Read one bounded page using CheckpointRestoreSagaStore.listPending(). */
export function listCheckpointRestoreRecoveries({
  store,
  afterOperationId = "",
  limit = MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT,
} = {}) {
  const readerStore = assertStore(store);
  if (
    (afterOperationId !== "" && !OPERATION_ID_PATTERN.test(afterOperationId)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CHECKPOINT_RESTORE_RECOVERY_LIST_LIMIT
  ) {
    throw new TypeError(
      "checkpoint restore recovery listing requires a safe cursor and bounded limit",
    );
  }

  const listed = readerStore.listPending({ afterOperationId, limit });
  if (!Array.isArray(listed)) {
    throw new TypeError(
      "checkpoint restore listPending dependency returned no page",
    );
  }
  const items = freezeArray(listed.map(projectCheckpointRestoreRecovery));
  const diagnostics = freezeArray(
    (Array.isArray(listed.diagnostics) ? listed.diagnostics : []).map(
      projectDiagnostic,
    ),
  );
  const truncated = listed.truncated === true;
  const budgetExhausted = listed.budgetExhausted === true;
  const nextCursor = truncated ? listed.nextCursor : null;
  if (
    (truncated &&
      (typeof nextCursor !== "string" ||
        (nextCursor !== "" && !OPERATION_ID_PATTERN.test(nextCursor)))) ||
    (!truncated && listed.nextCursor != null) ||
    (budgetExhausted && !truncated)
  ) {
    throw new TypeError("checkpoint restore pagination metadata is invalid");
  }

  return Object.freeze({
    schema: CHECKPOINT_RESTORE_RECOVERY_LIST_SCHEMA,
    version: CHECKPOINT_RESTORE_RECOVERY_PROJECTION_VERSION,
    items,
    diagnostics,
    page: Object.freeze({
      afterOperationId,
      limit,
      returned: items.length,
      diagnostics: diagnostics.length,
      truncated,
      budgetExhausted,
      nextCursor,
    }),
  });
}

/** Read one verified active saga using CheckpointRestoreSagaStore.load(). */
export function showCheckpointRestoreRecovery({ store, operationId } = {}) {
  const readerStore = assertStore(store);
  const safeOperationId = assertOperationId(operationId);
  return projectCheckpointRestoreRecovery(readerStore.load(safeOperationId));
}

/**
 * Small dependency-injected adapter for future CLI/IDE command wiring.
 * Constructing it performs no filesystem access.
 */
export function createCheckpointRestoreRecoveryReader({ store } = {}) {
  const readerStore = assertStore(store);
  return Object.freeze({
    list(options = {}) {
      return listCheckpointRestoreRecoveries({
        ...options,
        store: readerStore,
      });
    },
    show(operationId) {
      return showCheckpointRestoreRecovery({
        store: readerStore,
        operationId,
      });
    },
  });
}
