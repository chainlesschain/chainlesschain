/**
 * Verified, read-only session reconciliation for checkpoint restores.
 *
 * The caller injects `readVerifiedProjection`. This module performs one
 * forward fold over the verified transcript and retains only a constant-size
 * projection for the requested operationId. It never calls readMessages(),
 * findLatestEvent(), a compatibility all-events reader, or any writer.
 */

import { createHash } from "node:crypto";
import {
  CHECKPOINT_TIMELINE_AUDIT_EVENT,
  CHECKPOINT_TIMELINE_INTENT_EVENT,
} from "./checkpoint-timeline-authority.js";
import { TURN_BINDING_TIMELINE_EVENT } from "./turn-binding-store.js";

export const CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA =
  "chainlesschain.checkpoint-restore-session-recovery";
export const CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION = 1;

export const CHECKPOINT_RESTORE_SESSION_RECONCILIATION = Object.freeze({
  NO_SESSION_DIRECT: "no-session/direct",
  CLEAN_ABORT: "clean-abort",
  CODE_SETTLEMENT_RESUMABLE: "code-settlement-resumable",
  BOTH_SETTLEMENT_RESUMABLE: "both-settlement-resumable",
  ALREADY_COMPLETED: "already-completed",
  CONFLICT_UNKNOWN: "conflict/unknown",
});

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RAW_EVENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ACTIONS = new Set(["restore-code", "restore-both"]);
const AUDIT_STATUSES = new Set(["completed", "failed"]);
const FAILED_WORKSPACE_STATES = new Set(["unchanged", "unknown"]);
const MAX_TEXT = 4_096;

const REQUIRED_EVIDENCE = Object.freeze({
  [CHECKPOINT_RESTORE_SESSION_RECONCILIATION.NO_SESSION_DIRECT]: Object.freeze([
    "exact_saga_head",
    "exact_workspace_owner_or_absence",
    "verified_workspace_state",
  ]),
  [CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CLEAN_ABORT]: Object.freeze([
    "exact_saga_head",
    "exact_workspace_owner_or_absence",
    "verified_transcript_head_cas",
    "operation_events_still_absent",
  ]),
  [CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CODE_SETTLEMENT_RESUMABLE]:
    Object.freeze([
      "exact_saga_head",
      "exact_workspace_owner",
      "verified_workspace_target_state",
      "verified_intent_commit_digest",
      "verified_transcript_head_cas",
      "durable_recovery_resolution_event",
      "verified_recovery_settlement_hash",
    ]),
  [CHECKPOINT_RESTORE_SESSION_RECONCILIATION.BOTH_SETTLEMENT_RESUMABLE]:
    Object.freeze([
      "exact_saga_head",
      "exact_workspace_owner",
      "verified_workspace_target_state",
      "verified_intent_commit_digest",
      "verified_transcript_head_cas",
      "historical_conversation_and_binding_plan",
      "exact_conversation_commit_or_reconciliation",
      "durable_recovery_resolution_event",
      "verified_recovery_settlement_hash",
    ]),
  [CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ALREADY_COMPLETED]: Object.freeze([
    "exact_saga_head",
    "exact_workspace_owner",
    "verified_workspace_target_state",
    "verified_completed_audit_hash",
    "verified_session_commit_digest",
  ]),
  [CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN]: Object.freeze([
    "manual_adjudication",
    "verified_transcript_repair_or_authority_restoration",
  ]),
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, maximum = MAX_TEXT) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function immutable(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutable(entry)));
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = immutable(entry);
    }
    return Object.freeze(result);
  }
  return value;
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
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("checkpoint restore session evidence is not canonical");
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
}

function intentCommitDigest(eventHash) {
  return digest("cc-checkpoint-restore-intent-commit-v1", eventHash);
}

function sessionCommitDigest(eventHash) {
  return digest("cc-checkpoint-restore-session-commit-v1", eventHash);
}

function addIssue(state, issue) {
  if (!state.issueSet.has(issue)) {
    state.issueSet.add(issue);
    state.issues.push(issue);
  }
}

function validateOptions(options, dependencies) {
  if (!isPlainObject(options)) {
    throw new TypeError("checkpoint restore session recovery options required");
  }
  if (
    typeof options.operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(options.operationId)
  ) {
    throw new TypeError("operationId must be a safe checkpoint restore id");
  }
  if (!new Set(["direct", "timeline"]).has(options.restoreSurface)) {
    throw new TypeError("restoreSurface must be direct or timeline");
  }
  if (
    options.restoreSurface === "timeline" &&
    !boundedText(options.sessionId, 256)
  ) {
    throw new TypeError("timeline recovery requires a bounded sessionId");
  }
  if (options.restoreSurface === "direct" && options.sessionId != null) {
    throw new TypeError("direct recovery cannot claim session authority");
  }
  if (options.expectedAction != null && !ACTIONS.has(options.expectedAction)) {
    throw new TypeError("expectedAction is not a recoverable timeline action");
  }
  for (const field of [
    "expectedIntentCommitDigest",
    "expectedSessionCommitDigest",
  ]) {
    if (options[field] != null && !DIGEST_PATTERN.test(options[field])) {
      throw new TypeError(`${field} must be a SHA-256 digest`);
    }
  }
  for (const field of [
    "expectedTimelineEntryId",
    "expectedCheckpointId",
    "expectedCheckpointIdentity",
    "expectedConfirmationDigest",
  ]) {
    if (options[field] != null && !boundedText(options[field])) {
      throw new TypeError(`${field} must be bounded text`);
    }
  }
  if (
    options.expectedConfirmationDigest != null &&
    !DIGEST_PATTERN.test(options.expectedConfirmationDigest)
  ) {
    throw new TypeError("expectedConfirmationDigest must be a SHA-256 digest");
  }
  const reader = dependencies?.readVerifiedProjection;
  if (options.restoreSurface === "timeline" && typeof reader !== "function") {
    throw new TypeError("readVerifiedProjection dependency is required");
  }
  if (
    options.projectionOptions != null &&
    !isPlainObject(options.projectionOptions)
  ) {
    throw new TypeError("projectionOptions must be a plain object");
  }
  return reader;
}

function validStateIdentity(value) {
  return (
    DIGEST_PATTERN.test(String(value || "")) ||
    /^git-tree:[a-f0-9]{40,64}$/u.test(String(value || ""))
  );
}

const INTENT_AUTHORITY_FIELDS = Object.freeze([
  "revision",
  "action",
  "turnId",
  "checkpointId",
  "checkpointIdentity",
  "workspaceDir",
  "workspaceScopeIdentity",
  "workspacePrestateIdentity",
  "workspaceWritePlanIdentity",
  "workspaceTargetPoststateIdentity",
  "confirmationDigest",
]);

function projectIntent(event, index, state) {
  const data = event.data;
  if (
    !isPlainObject(data) ||
    data.operationId !== state.operationId ||
    !boundedText(data.revision, 1_024) ||
    !ACTIONS.has(data.action) ||
    !boundedText(data.turnId, 256) ||
    !boundedText(data.checkpointId, 256) ||
    !boundedText(data.checkpointIdentity, 1_024) ||
    !boundedText(data.workspaceDir) ||
    !DIGEST_PATTERN.test(String(data.workspaceScopeIdentity || "")) ||
    !validStateIdentity(data.workspacePrestateIdentity) ||
    !DIGEST_PATTERN.test(String(data.workspaceWritePlanIdentity || "")) ||
    !validStateIdentity(data.workspaceTargetPoststateIdentity) ||
    !DIGEST_PATTERN.test(String(data.confirmationDigest || ""))
  ) {
    addIssue(state, "intent_shape_invalid");
    return null;
  }
  const authority = {};
  for (const field of INTENT_AUTHORITY_FIELDS) authority[field] = data[field];
  return Object.freeze({
    index,
    eventHash: event.hash,
    prevHash: event.prevHash ?? null,
    intentCommitDigest: intentCommitDigest(event.hash),
    authority: Object.freeze(authority),
  });
}

function projectConversationCommit(event, index, state) {
  const data = event.data;
  if (
    !isPlainObject(data) ||
    data.operationId !== state.operationId ||
    !ACTIONS.has(data.action) ||
    !boundedText(data.sourceRevision, 1_024) ||
    !boundedText(data.turnId, 256) ||
    !Array.isArray(data.messages) ||
    !isPlainObject(data.binding) ||
    !Array.isArray(data.binding.turns)
  ) {
    addIssue(state, "conversation_commit_shape_invalid");
    return null;
  }
  return Object.freeze({
    index,
    eventHash: event.hash,
    prevHash: event.prevHash ?? null,
    action: data.action,
    sourceRevision: data.sourceRevision,
    turnId: data.turnId,
    messageCount: data.messages.length,
    bindingTurnCount: data.binding.turns.length,
  });
}

function projectAudit(event, index, state) {
  const data = event.data;
  if (
    !isPlainObject(data) ||
    data.operationId !== state.operationId ||
    !AUDIT_STATUSES.has(data.status) ||
    !boundedText(data.revision, 1_024) ||
    !ACTIONS.has(data.action) ||
    !boundedText(data.turnId, 256) ||
    !boundedText(data.checkpointId, 256) ||
    !boundedText(data.checkpointIdentity, 1_024) ||
    !boundedText(data.workspaceDir) ||
    !DIGEST_PATTERN.test(String(data.workspaceScopeIdentity || "")) ||
    !validStateIdentity(data.workspacePrestateIdentity) ||
    !DIGEST_PATTERN.test(String(data.workspaceWritePlanIdentity || "")) ||
    !validStateIdentity(data.workspaceTargetPoststateIdentity) ||
    !DIGEST_PATTERN.test(String(data.confirmationDigest || "")) ||
    (data.status === "failed" && !boundedText(data.failureCode, 128)) ||
    (data.status === "failed" &&
      !FAILED_WORKSPACE_STATES.has(data.workspaceState)) ||
    (data.status === "completed" &&
      (data.failureCode != null || data.workspaceState != null))
  ) {
    addIssue(state, "audit_shape_invalid");
    return null;
  }
  const authority = {};
  for (const field of INTENT_AUTHORITY_FIELDS) authority[field] = data[field];
  return Object.freeze({
    index,
    eventHash: event.hash,
    prevHash: event.prevHash ?? null,
    status: data.status,
    failureCode: data.status === "failed" ? data.failureCode : null,
    workspaceState:
      typeof data.workspaceState === "string" ? data.workspaceState : null,
    authority: Object.freeze(authority),
    sessionCommitDigest:
      data.status === "completed" ? sessionCommitDigest(event.hash) : null,
  });
}

function sameAuthority(left, right) {
  if (!left || !right) return false;
  return INTENT_AUTHORITY_FIELDS.every((field) => left[field] === right[field]);
}

function validateExpectedIntent(state, options) {
  const intent = state.intent;
  if (!intent) {
    if (options.expectedIntentCommitDigest) {
      addIssue(state, "expected_intent_missing");
    }
    if (options.expectedSessionCommitDigest) {
      addIssue(state, "expected_session_commit_missing");
    }
    return;
  }
  if (
    options.expectedIntentCommitDigest &&
    intent.intentCommitDigest !== options.expectedIntentCommitDigest
  ) {
    addIssue(state, "intent_commit_digest_mismatch");
  }
  for (const [field, actual] of [
    ["expectedAction", intent.authority.action],
    ["expectedTimelineEntryId", intent.authority.turnId],
    ["expectedCheckpointId", intent.authority.checkpointId],
    ["expectedCheckpointIdentity", intent.authority.checkpointIdentity],
    ["expectedConfirmationDigest", intent.authority.confirmationDigest],
  ]) {
    if (options[field] != null && options[field] !== actual) {
      addIssue(
        state,
        `${field.replace(/^expected/u, "").toLowerCase()}_mismatch`,
      );
    }
  }
  const completed = state.completedAudit;
  if (
    options.expectedSessionCommitDigest &&
    (!completed ||
      completed.sessionCommitDigest !== options.expectedSessionCommitDigest)
  ) {
    addIssue(state, "session_commit_digest_mismatch");
  }
}

function finishState(state, authority, options) {
  if (
    !authority ||
    typeof authority !== "object" ||
    !Number.isSafeInteger(authority.eventCount) ||
    authority.eventCount < 0 ||
    !(
      authority.headHash === null ||
      (typeof authority.headHash === "string" &&
        RAW_EVENT_HASH_PATTERN.test(authority.headHash))
    )
  ) {
    addIssue(state, "transcript_authority_invalid");
  } else {
    if (authority.eventCount !== state.eventCount) {
      addIssue(state, "transcript_event_count_mismatch");
    }
    if ((authority.headHash ?? null) !== (state.lastEventHash ?? null)) {
      addIssue(state, "transcript_head_mismatch");
    }
  }

  if (state.intent) {
    if (
      state.conversationCommit &&
      (state.intent.authority.revision !==
        state.conversationCommit.sourceRevision ||
        state.intent.authority.action !== state.conversationCommit.action ||
        state.intent.authority.turnId !== state.conversationCommit.turnId)
    ) {
      addIssue(state, "conversation_commit_intent_mismatch");
    }
    for (const audit of [state.completedAudit, state.failedAudit]) {
      if (audit && !sameAuthority(state.intent.authority, audit.authority)) {
        addIssue(state, "audit_intent_mismatch");
      }
    }
    if (
      state.intent.authority.action === "restore-code" &&
      state.conversationCommit
    ) {
      addIssue(state, "code_restore_has_conversation_commit");
    }
    if (
      state.completedAudit &&
      state.intent.authority.action === "restore-both" &&
      !state.conversationCommit
    ) {
      addIssue(state, "completed_both_missing_conversation_commit");
    }
  }
  if (state.completedAudit && state.failedAudit) {
    addIssue(state, "conflicting_audit_outcomes");
  }
  validateExpectedIntent(state, options);

  let classification;
  if (state.issues.length > 0) {
    classification = CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN;
  } else if (!state.intent) {
    classification = CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CLEAN_ABORT;
  } else if (state.completedAudit) {
    classification =
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.ALREADY_COMPLETED;
  } else if (state.intent.authority.action === "restore-code") {
    classification =
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CODE_SETTLEMENT_RESUMABLE;
  } else {
    classification =
      CHECKPOINT_RESTORE_SESSION_RECONCILIATION.BOTH_SETTLEMENT_RESUMABLE;
  }

  const operationTailIndex = state.operationTailIndex;
  return immutable({
    schema: CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
    version: CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
    operationId: state.operationId,
    sessionId: options.sessionId,
    restoreSurface: "timeline",
    classification,
    failClosed: classification === "conflict/unknown",
    safeToMutate: false,
    issues: state.issues,
    transcript: {
      headHash: authority?.headHash ?? null,
      eventCount: Number.isSafeInteger(authority?.eventCount)
        ? authority.eventCount
        : null,
      operationEventCount: state.operationEventCount,
      operationTailHash: state.operationTailHash,
      eventsAfterOperationTail:
        operationTailIndex == null ||
        !Number.isSafeInteger(authority?.eventCount)
          ? null
          : authority.eventCount - operationTailIndex,
    },
    intent: state.intent,
    conversationCommit: state.conversationCommit,
    audit: {
      completed: state.completedAudit,
      failed: state.failedAudit,
    },
    requiredEvidence: REQUIRED_EVIDENCE[classification],
  });
}

function createFold(operationId, options) {
  const state = {
    operationId,
    issueSet: new Set(),
    issues: [],
    eventCount: 0,
    lastEventHash: null,
    operationEventCount: 0,
    operationTailHash: null,
    operationTailIndex: null,
    intent: null,
    conversationCommit: null,
    completedAudit: null,
    failedAudit: null,
  };

  return {
    accept(event) {
      state.eventCount += 1;
      const index = state.eventCount;
      if (
        !isPlainObject(event) ||
        typeof event.type !== "string" ||
        !RAW_EVENT_HASH_PATTERN.test(String(event.hash || "")) ||
        (event.prevHash ?? null) !== state.lastEventHash
      ) {
        addIssue(state, "verified_event_chain_invalid");
      }
      state.lastEventHash = typeof event?.hash === "string" ? event.hash : null;
      if (
        !isPlainObject(event?.data) ||
        event.data.operationId !== operationId
      ) {
        return;
      }

      state.operationEventCount += 1;
      state.operationTailHash = event.hash || null;
      state.operationTailIndex = index;

      if (event.type === CHECKPOINT_TIMELINE_INTENT_EVENT) {
        if (
          state.intent ||
          state.conversationCommit ||
          state.completedAudit ||
          state.failedAudit
        ) {
          addIssue(state, "duplicate_or_out_of_order_intent");
          return;
        }
        state.intent = projectIntent(event, index, state);
        return;
      }
      if (event.type === TURN_BINDING_TIMELINE_EVENT) {
        if (!state.intent) addIssue(state, "conversation_commit_before_intent");
        if (state.conversationCommit) {
          addIssue(state, "duplicate_conversation_commit");
          return;
        }
        if (state.completedAudit || state.failedAudit) {
          addIssue(state, "conversation_commit_after_audit");
        }
        state.conversationCommit = projectConversationCommit(
          event,
          index,
          state,
        );
        return;
      }
      if (event.type === CHECKPOINT_TIMELINE_AUDIT_EVENT) {
        if (!state.intent) addIssue(state, "audit_before_intent");
        const audit = projectAudit(event, index, state);
        if (!audit) return;
        if (audit.status === "completed") {
          if (state.completedAudit) {
            addIssue(state, "duplicate_completed_audit");
          } else {
            state.completedAudit = audit;
          }
        } else if (state.failedAudit) {
          addIssue(state, "duplicate_failed_audit");
        } else {
          state.failedAudit = audit;
        }
        return;
      }
      addIssue(state, "unknown_operation_event_type");
    },
    finish(authority) {
      return finishState(state, authority, options);
    },
  };
}

function directProjection(options) {
  const classification =
    CHECKPOINT_RESTORE_SESSION_RECONCILIATION.NO_SESSION_DIRECT;
  return immutable({
    schema: CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
    version: CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
    operationId: options.operationId,
    sessionId: null,
    restoreSurface: "direct",
    classification,
    failClosed: false,
    safeToMutate: false,
    issues: [],
    transcript: null,
    intent: null,
    conversationCommit: null,
    audit: { completed: null, failed: null },
    requiredEvidence: REQUIRED_EVIDENCE[classification],
  });
}

function unavailableProjection(options, error) {
  const classification =
    CHECKPOINT_RESTORE_SESSION_RECONCILIATION.CONFLICT_UNKNOWN;
  return immutable({
    schema: CHECKPOINT_RESTORE_SESSION_RECOVERY_SCHEMA,
    version: CHECKPOINT_RESTORE_SESSION_RECOVERY_VERSION,
    operationId: options.operationId,
    sessionId: options.sessionId,
    restoreSurface: "timeline",
    classification,
    failClosed: true,
    safeToMutate: false,
    issues: ["verified_projection_unavailable"],
    errorCode:
      typeof error?.code === "string" && boundedText(error.code, 128)
        ? error.code
        : "SESSION_RECOVERY_PROJECTION_FAILED",
    transcript: null,
    intent: null,
    conversationCommit: null,
    audit: { completed: null, failed: null },
    requiredEvidence: REQUIRED_EVIDENCE[classification],
  });
}

export function readCheckpointRestoreSessionRecovery(
  options = {},
  dependencies = {},
) {
  const readVerifiedProjection = validateOptions(options, dependencies);
  if (options.restoreSurface === "direct") return directProjection(options);
  try {
    let projectionCreated = false;
    let finishedProjection;
    const returnedProjection = readVerifiedProjection(
      options.sessionId,
      () => {
        if (projectionCreated) {
          const error = new Error("verified projection factory was reused");
          error.code = "CHECKPOINT_RESTORE_SESSION_PROJECTION_INVALID";
          throw error;
        }
        projectionCreated = true;
        const fold = createFold(options.operationId, options);
        let finished = false;
        return Object.freeze({
          accept(event) {
            if (finished) {
              const error = new Error(
                "verified projection accepted an event after finish",
              );
              error.code = "CHECKPOINT_RESTORE_SESSION_PROJECTION_INVALID";
              throw error;
            }
            fold.accept(event);
          },
          finish(authority) {
            if (finished) {
              const error = new Error("verified projection finished twice");
              error.code = "CHECKPOINT_RESTORE_SESSION_PROJECTION_INVALID";
              throw error;
            }
            finished = true;
            finishedProjection = fold.finish(authority);
            return finishedProjection;
          },
        });
      },
      options.projectionOptions || {},
    );
    if (
      !projectionCreated ||
      finishedProjection === undefined ||
      returnedProjection !== finishedProjection
    ) {
      const error = new Error("verified projection reader bypassed its fold");
      error.code = "CHECKPOINT_RESTORE_SESSION_PROJECTION_INVALID";
      throw error;
    }
    return returnedProjection;
  } catch (error) {
    return unavailableProjection(options, error);
  }
}

export function createCheckpointRestoreSessionRecoveryReader(dependencies) {
  if (
    !isPlainObject(dependencies) ||
    typeof dependencies.readVerifiedProjection !== "function"
  ) {
    throw new TypeError("readVerifiedProjection dependency is required");
  }
  return Object.freeze({
    read(options) {
      return readCheckpointRestoreSessionRecovery(options, dependencies);
    },
  });
}
