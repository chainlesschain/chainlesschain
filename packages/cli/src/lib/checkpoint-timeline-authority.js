/**
 * Pure planning/validation for CLI-authoritative checkpoint timeline actions.
 * Hosts may display the preview, but only the CLI commits the returned plan.
 */

import { createHash } from "node:crypto";
import {
  CHECKPOINT_TIMELINE_ACTIONS,
  CHECKPOINT_TIMELINE_ACTION_SCHEMA,
  CHECKPOINT_TIMELINE_ACTION_VERSION,
  resolveCheckpointTimelineAction,
} from "./checkpoint-timeline.js";
import { planSessionBranch } from "./session-branch.js";
import {
  buildExtractiveHandoff,
  formatStructuredHandoff,
} from "../harness/structured-handoff.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
  projectCanonicalResumeMessages,
} from "./session-message-provenance.js";

export const CHECKPOINT_TIMELINE_RESULT_SCHEMA =
  "cc-checkpoint-timeline-result/v1";
export const CHECKPOINT_TIMELINE_RESULT_VERSION = 1;
export const CHECKPOINT_TIMELINE_CONFIRMATION_SCHEMA =
  "cc-checkpoint-timeline-confirmation/v1";
export const CHECKPOINT_TIMELINE_CONFIRMATION_VERSION = 1;
export const CHECKPOINT_WORKSPACE_BINDING_SCHEMA =
  "cc-checkpoint-workspace-binding/v1";
export const CHECKPOINT_WORKSPACE_BINDING_VERSION = 1;
export const CHECKPOINT_TIMELINE_INTENT_EVENT =
  "checkpoint_timeline_action_intent";
export const CHECKPOINT_TIMELINE_AUDIT_EVENT = "checkpoint_timeline_action";

function canonical(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
  return out;
}

function sameEnvelope(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function digestEnvelope(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex")}`;
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    sameEnvelope(Object.keys(value).sort(), [...expected].sort())
  );
}

function isCodeRestore(action) {
  return (
    action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_CODE ||
    action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_BOTH
  );
}

function publicWorkspaceBinding(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== CHECKPOINT_WORKSPACE_BINDING_SCHEMA ||
    value.version !== CHECKPOINT_WORKSPACE_BINDING_VERSION ||
    !["git", "copy"].includes(value.engine) ||
    !/^sha256:[a-f0-9]{64}$/.test(value.scopeIdentity || "") ||
    !/^sha256:[a-f0-9]{64}$/.test(value.writePlanIdentity || "")
  ) {
    return null;
  }
  const gitTree = /^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
  const copyState = /^sha256:[a-f0-9]{64}$/;
  const statePattern = value.engine === "git" ? gitTree : copyState;
  if (
    !statePattern.test(value.prestateIdentity || "") ||
    !statePattern.test(value.targetPoststateIdentity || "")
  ) {
    return null;
  }
  return {
    schema: CHECKPOINT_WORKSPACE_BINDING_SCHEMA,
    version: CHECKPOINT_WORKSPACE_BINDING_VERSION,
    engine: value.engine,
    scopeIdentity: value.scopeIdentity,
    prestateIdentity: value.prestateIdentity,
    writePlanIdentity: value.writePlanIdentity,
    targetPoststateIdentity: value.targetPoststateIdentity,
  };
}

export function buildCheckpointTimelineConfirmationSubmission(
  submission,
  workspaceBinding = null,
) {
  const workspace = workspaceBinding
    ? publicWorkspaceBinding(workspaceBinding)
    : null;
  if (isCodeRestore(submission?.action) && !workspace) return null;
  if (!isCodeRestore(submission?.action) && workspace) return null;
  const body = {
    schema: CHECKPOINT_TIMELINE_CONFIRMATION_SCHEMA,
    version: CHECKPOINT_TIMELINE_CONFIRMATION_VERSION,
    authority: "cli",
    submission: canonical(submission),
    workspace,
  };
  return { ...body, digest: digestEnvelope(body) };
}

export function validateCheckpointTimelineConfirmationSubmission(
  timeline,
  confirmation,
) {
  if (
    !exactKeys(confirmation, [
      "schema",
      "version",
      "authority",
      "submission",
      "workspace",
      "digest",
    ]) ||
    confirmation.schema !== CHECKPOINT_TIMELINE_CONFIRMATION_SCHEMA ||
    confirmation.version !== CHECKPOINT_TIMELINE_CONFIRMATION_VERSION ||
    confirmation.authority !== "cli" ||
    !/^sha256:[a-f0-9]{64}$/.test(confirmation.digest || "")
  ) {
    return { ok: false, code: "TIMELINE_PREVIEW_REQUIRED" };
  }
  const validation = validateCheckpointTimelineSubmission(
    timeline,
    confirmation.submission,
  );
  if (!validation.ok) return validation;
  const workspace = confirmation.workspace
    ? publicWorkspaceBinding(confirmation.workspace)
    : null;
  if (
    (isCodeRestore(validation.submission.action) && !workspace) ||
    (!isCodeRestore(validation.submission.action) &&
      confirmation.workspace !== null) ||
    (workspace && !sameEnvelope(workspace, confirmation.workspace))
  ) {
    return { ok: false, code: "TIMELINE_CONFIRMATION_INVALID" };
  }
  const expected = buildCheckpointTimelineConfirmationSubmission(
    validation.submission,
    workspace,
  );
  if (!expected || !sameEnvelope(expected, confirmation)) {
    return { ok: false, code: "TIMELINE_CONFIRMATION_INVALID" };
  }
  return {
    ok: true,
    entry: validation.entry,
    submission: validation.submission,
    workspace,
    confirmation: expected,
  };
}

export function checkpointTimelineConfirmationsMatch(left, right) {
  return sameEnvelope(left, right);
}

export function validateCheckpointTimelineSubmission(timeline, submission) {
  if (
    !submission ||
    typeof submission !== "object" ||
    Array.isArray(submission) ||
    submission.schema !== CHECKPOINT_TIMELINE_ACTION_SCHEMA ||
    submission.version !== CHECKPOINT_TIMELINE_ACTION_VERSION ||
    submission.authority !== "cli"
  ) {
    return { ok: false, code: "TIMELINE_SUBMISSION_INVALID" };
  }
  if (
    typeof timeline?.revision !== "string" ||
    submission.revision !== timeline.revision
  ) {
    return {
      ok: false,
      code: "TIMELINE_STALE",
      expectedRevision: timeline?.revision || null,
      submittedRevision: submission.revision || null,
    };
  }
  const resolved = resolveCheckpointTimelineAction(
    timeline,
    submission.turnId,
    submission.action,
  );
  if (!resolved.ok) return resolved;
  const expectedCheckpointIdentity =
    resolved.submission.checkpointIdentity || null;
  const submittedCheckpointIdentity = submission.checkpointIdentity || null;
  if (expectedCheckpointIdentity !== submittedCheckpointIdentity) {
    return {
      ok: false,
      code: "TIMELINE_STALE",
      expectedCheckpointIdentity,
      submittedCheckpointIdentity,
    };
  }
  if (!sameEnvelope(resolved.submission, submission)) {
    return { ok: false, code: "TIMELINE_SUBMISSION_INVALID" };
  }
  const entry = timeline.entries.find(
    (candidate) => candidate.turnId === submission.turnId,
  );
  return { ok: true, entry, submission: resolved.submission };
}

function userAnchor(messages, offset) {
  const list = Array.isArray(messages) ? messages : [];
  const numeric = Number(offset);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  const candidates =
    list[0]?.role === "system"
      ? [numeric - 1, numeric - 2]
      : [numeric - 2, numeric - 1];
  for (const index of candidates) {
    if (index >= 0 && index < list.length && list[index]?.role === "user") {
      return index;
    }
  }
  return null;
}

function summaryMessage(messages, action, turnId) {
  const handoff = buildExtractiveHandoff(messages, {
    maxFallbackSourceChars: 24_000,
  });
  return markDurableSystemMessage(
    {
      role: "system",
      content:
        `[Conversation Summary: ${action} ${turnId}]\n` +
        formatStructuredHandoff(handoff),
    },
    DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
  );
}

function codePreviewShape(value, checkpointId) {
  const data = value && typeof value === "object" ? value : {};
  const source = (key) => (Array.isArray(data[key]) ? data[key] : []);
  const list = (key) =>
    source(key)
      .slice(0, 256)
      .map((item) =>
        typeof item === "string" ? item : String(item?.rel || ""),
      )
      .filter(Boolean);
  const counts = {
    modified: source("modified").length,
    added: source("added").length,
    deleted: source("deleted").length,
  };
  return {
    checkpointId: checkpointId || null,
    modified: list("modified"),
    added: list("added"),
    deleted: list("deleted"),
    summary: {
      ...counts,
      total: counts.modified + counts.added + counts.deleted,
      truncated:
        counts.modified > 256 || counts.added > 256 || counts.deleted > 256,
    },
  };
}

/** Build the exact preview and internal commit plan from current CLI state. */
export function planCheckpointTimelineAction({
  timeline,
  submission,
  messages = [],
  codePreview = null,
} = {}) {
  const validation = validateCheckpointTimelineSubmission(timeline, submission);
  if (!validation.ok) return validation;

  const { entry } = validation;
  const action = submission.action;
  const needsConversation = action !== CHECKPOINT_TIMELINE_ACTIONS.RESTORE_CODE;
  const anchor = needsConversation
    ? userAnchor(messages, submission.conversationOffset)
    : null;
  if (needsConversation && anchor == null) {
    return {
      ok: false,
      code: "TIMELINE_CONVERSATION_ANCHOR_STALE",
      expectedRevision: timeline.revision,
    };
  }

  const preview = {
    schema: CHECKPOINT_TIMELINE_RESULT_SCHEMA,
    version: CHECKPOINT_TIMELINE_RESULT_VERSION,
    ok: true,
    mode: "preview",
    action,
    sessionId: timeline.sessionId,
    turnId: entry.turnId,
    revision: timeline.revision,
    coverage: entry.coverage,
    excludedPaths: [...(entry.excludedPaths || [])],
    irreversibleSideEffects: [...(entry.irreversibleSideEffects || [])],
    warnings: [...(entry.warnings || [])],
    confirmationRequired: true,
    code:
      action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_CODE ||
      action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_BOTH
        ? codePreviewShape(codePreview, submission.checkpointId)
        : null,
    conversation: null,
    branch: null,
  };
  const commit = {
    action,
    turnId: entry.turnId,
    messages: null,
    bindingPruneOffset: null,
    branchPlan: null,
  };

  if (action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_CONVERSATION) {
    commit.messages = messages.slice(0, anchor);
    commit.bindingPruneOffset = submission.conversationOffset;
  } else if (action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_BOTH) {
    commit.messages = messages.slice(0, anchor);
    commit.bindingPruneOffset = submission.conversationOffset;
  } else if (action === CHECKPOINT_TIMELINE_ACTIONS.SUMMARY_FROM) {
    const selected = messages.slice(anchor);
    commit.messages = [
      ...messages.slice(0, anchor),
      summaryMessage(selected, action, entry.turnId),
    ];
    commit.bindingPruneOffset = submission.conversationOffset;
  } else if (action === CHECKPOINT_TIMELINE_ACTIONS.SUMMARY_TO) {
    const entryIndex = timeline.entries.indexOf(entry);
    const next = timeline.entries[entryIndex + 1];
    const nextAnchor = next
      ? userAnchor(messages, next.conversationOffset)
      : messages.length;
    if (nextAnchor == null || nextAnchor <= 0) {
      return { ok: false, code: "TIMELINE_CONVERSATION_ANCHOR_STALE" };
    }
    const systemCount = messages[0]?.role === "system" ? 1 : 0;
    const prefix = messages.slice(systemCount, nextAnchor);
    let canonicalPrefix;
    try {
      canonicalPrefix = projectCanonicalResumeMessages(prefix, {
        strict: true,
      });
    } catch {
      return { ok: false, code: "TIMELINE_CONVERSATION_INVALID" };
    }
    const durableSystems = canonicalPrefix.filter((message) =>
      Boolean(getDurableSystemMessageProvenance(message)),
    );
    // The first system is the current host-owned prompt and stays in place.
    // Other systems survive the rewrite only with runtime provenance. An
    // unmarked verified event must neither survive nor be quoted into the new
    // durable summary, otherwise SUMMARY_TO would bless it on persistence.
    const selected = canonicalPrefix.filter(
      (message) => message.role !== "system",
    );
    commit.messages = [
      ...messages.slice(0, systemCount),
      ...durableSystems,
      summaryMessage(selected, action, entry.turnId),
      ...messages.slice(nextAnchor),
    ];
    // Every surviving later offset shifts when a prefix is summarized.
    commit.bindingPruneOffset = 0;
  } else if (action === CHECKPOINT_TIMELINE_ACTIONS.BRANCH) {
    commit.branchPlan = planSessionBranch({
      parentSessionId: timeline.sessionId,
      turn: {
        turnId: entry.turnId,
        conversationOffset: submission.conversationOffset,
        fileCheckpointId: submission.checkpointId,
        coverage: entry.coverage,
      },
    });
    commit.messages = messages.slice(0, anchor);
    preview.branch = {
      branchSessionId: commit.branchPlan.branchSessionId,
      preservesParent: true,
      requiresWorktree: commit.branchPlan.requiresWorktree,
      warnings: [...commit.branchPlan.warnings],
    };
  }

  if (commit.messages) {
    preview.conversation = {
      beforeMessages: messages.length,
      afterMessages: commit.messages.length,
      affectedMessages: Math.max(0, messages.length - anchor),
    };
  }
  const workspaceBinding = isCodeRestore(action)
    ? codePreview?.workspaceBinding || null
    : null;
  const publicBinding = workspaceBinding
    ? publicWorkspaceBinding(workspaceBinding)
    : null;
  const confirmationSubmission = buildCheckpointTimelineConfirmationSubmission(
    validation.submission,
    publicBinding,
  );
  if (!confirmationSubmission) {
    return { ok: false, code: "TIMELINE_WORKSPACE_BINDING_INVALID" };
  }
  preview.confirmationSubmission = confirmationSubmission;
  return {
    ok: true,
    preview,
    commit,
    submission: validation.submission,
    workspaceBinding,
  };
}

export function timelineActionError(error) {
  const checkpointRestoreError =
    error?.checkpointRestoreCause ||
    error?.cause?.checkpointRestoreCause ||
    null;
  const operationError = checkpointRestoreError
    ? checkpointRestoreError.transactionError || checkpointRestoreError
    : error?.transactionError || null;
  const recoveryError = operationError || checkpointRestoreError || error;
  const sagaError = checkpointRestoreError || error;
  const retainedRecoveryCandidate =
    error?.transactionRecoveryEvidence ||
    checkpointRestoreError?.transactionRecoveryEvidence ||
    checkpointRestoreError?.transactionError?.transactionRecoveryEvidence ||
    null;
  const retainedRecovery =
    retainedRecoveryCandidate &&
    typeof retainedRecoveryCandidate === "object" &&
    !Array.isArray(retainedRecoveryCandidate)
      ? retainedRecoveryCandidate
      : null;
  const auditError =
    operationError?.checkpointAuditError || error?.checkpointAuditError || null;
  const createdPaths = Array.isArray(recoveryError?.createdPaths)
    ? recoveryError.createdPaths
    : Array.isArray(retainedRecovery?.createdPaths)
      ? retainedRecovery.createdPaths
      : [];
  return {
    schema: CHECKPOINT_TIMELINE_RESULT_SCHEMA,
    version: CHECKPOINT_TIMELINE_RESULT_VERSION,
    ok: false,
    code:
      error?.code === "SESSION_REVISION_STALE"
        ? "TIMELINE_STALE"
        : error?.code === "CHECKPOINT_WORKSPACE_STALE"
          ? "TIMELINE_WORKSPACE_STALE"
          : error?.code || "TIMELINE_ACTION_FAILED",
    error: error?.message || String(error || "timeline action failed"),
    commitState:
      error?.commitState ||
      checkpointRestoreError?.commitState ||
      operationError?.commitState ||
      null,
    operationFailureCode: operationError?.code || null,
    auditFailureCode: auditError?.code || null,
    restorePhase:
      recoveryError?.restorePhase || retainedRecovery?.restorePhase || null,
    safetyCheckpointId:
      recoveryError?.safetyId || retainedRecovery?.safetyId || null,
    safetyCheckpointIdentity:
      recoveryError?.safetyIdentity || retainedRecovery?.safetyIdentity || null,
    safetyCoverage:
      recoveryError?.safetyCoverage || retainedRecovery?.safetyCoverage || null,
    safetyPlanIdentity:
      recoveryError?.safetyPlanIdentity ||
      retainedRecovery?.safetyPlanIdentity ||
      null,
    branchSessionId:
      recoveryError?.branchSessionId ||
      retainedRecovery?.branchSessionId ||
      null,
    createdPaths: createdPaths.slice(0, 256),
    operationId:
      sagaError?.checkpointRestoreOperationId || error?.operationId || null,
    blockingOperationId:
      error?.ownerTransactionId ||
      error?.retainedOwner?.transactionId ||
      error?.priorOwner?.transactionId ||
      null,
    sagaPhase: sagaError?.checkpointRestoreSagaPhase || null,
    sagaSeq: sagaError?.checkpointRestoreSagaSeq || null,
    sagaHeadHash: sagaError?.checkpointRestoreSagaHeadHash || null,
    recoveryRequired: Boolean(
      sagaError?.checkpointRestoreRecoveryRequired ||
      error?.workspaceLockRetained,
    ),
    workspaceLockRetained: error?.workspaceLockRetained === true,
  };
}
