/**
 * Pure planning/validation for CLI-authoritative checkpoint timeline actions.
 * Hosts may display the preview, but only the CLI commits the returned plan.
 */

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
  markDurableSystemMessage,
} from "./session-message-provenance.js";

export const CHECKPOINT_TIMELINE_RESULT_SCHEMA =
  "cc-checkpoint-timeline-result/v1";
export const CHECKPOINT_TIMELINE_RESULT_VERSION = 1;
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
  const list = (key) =>
    Array.isArray(data[key])
      ? data[key]
          .slice(0, 256)
          .map((item) =>
            typeof item === "string" ? item : String(item?.rel || ""),
          )
          .filter(Boolean)
      : [];
  return {
    checkpointId: checkpointId || null,
    modified: list("modified"),
    added: list("added"),
    deleted: list("deleted"),
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
    const selected = messages.slice(systemCount, nextAnchor);
    commit.messages = [
      ...messages.slice(0, systemCount),
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
  return { ok: true, preview, commit, submission: validation.submission };
}

export function timelineActionError(error) {
  return {
    schema: CHECKPOINT_TIMELINE_RESULT_SCHEMA,
    version: CHECKPOINT_TIMELINE_RESULT_VERSION,
    ok: false,
    code:
      error?.code === "SESSION_REVISION_STALE"
        ? "TIMELINE_STALE"
        : error?.code || "TIMELINE_ACTION_FAILED",
    error: error?.message || String(error || "timeline action failed"),
  };
}
