/**
 * Canonical Coding Agent event protocol — CJS so both the ESM CLI runtime
 * (packages/cli/src/runtime/runtime-events.js) and the Desktop Main process
 * (desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-events.js) can
 * share a single source of truth for event types and the envelope shape.
 *
 * Spec: docs/design/modules/79_Coding_Agent系统.md §5
 *       docs/implementation-plans/CODING_AGENT_EVENT_SCHEMA.md
 */

const { randomUUID } = require("crypto");

const CODING_AGENT_EVENT_VERSION = "1.0";
const CODING_AGENT_EVENT_CHANNEL = "coding-agent:event";

/**
 * Unified event types — dot-case, grouped by domain.
 * Renderer / CLI / Main MUST consume from this whitelist.
 */
const CODING_AGENT_EVENT_TYPES = Object.freeze({
  // Session lifecycle
  SESSION_STARTED: "session.started",
  SESSION_RESUMED: "session.resumed",
  SESSION_INTERRUPTED: "session.interrupted",
  SESSION_COMPLETED: "session.completed",
  SESSION_CLOSED: "session.closed",

  // Request lifecycle
  REQUEST_ACCEPTED: "request.accepted",
  REQUEST_REJECTED: "request.rejected",

  // Assistant output
  ASSISTANT_MESSAGE: "assistant.message",
  ASSISTANT_DELTA: "assistant.delta",
  ASSISTANT_THOUGHT_SUMMARY: "assistant.thought-summary",
  ASSISTANT_FINAL: "assistant.final",

  // Plan mode
  PLAN_STARTED: "plan.started",
  PLAN_UPDATED: "plan.updated",
  PLAN_APPROVAL_REQUIRED: "plan.approval_required",
  PLAN_APPROVED: "plan.approved",
  PLAN_REJECTED: "plan.rejected",

  // Tool calls
  TOOL_CALL_STARTED: "tool.call.started",
  TOOL_CALL_PROGRESS: "tool.call.progress",
  TOOL_CALL_COMPLETED: "tool.call.completed",
  TOOL_CALL_FAILED: "tool.call.failed",
  TOOL_CALL_SKIPPED: "tool.call.skipped",

  // Approval
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_GRANTED: "approval.granted",
  APPROVAL_DENIED: "approval.denied",
  APPROVAL_EXPIRED: "approval.expired",

  // Context compaction
  CONTEXT_COMPACTION_STARTED: "context.compaction.started",
  CONTEXT_COMPACTION_COMPLETED: "context.compaction.completed",

  // Errors / warnings
  WARNING: "warning",
  ERROR: "error",

  // Extension types — outside the v1.0 core but still part of the envelope
  WORKTREE_LIST: "worktree.list",
  WORKTREE_DIFF: "worktree.diff",
  WORKTREE_MERGED: "worktree.merged",
  WORKTREE_MERGE_PREVIEW: "worktree.merge-preview",
  WORKTREE_AUTOMATION_APPLIED: "worktree.automation-applied",
  SESSION_LIST: "session.list",
  COMMAND_RESPONSE: "command.response",
  SLOT_FILLING: "slot.filling",
  MODEL_SWITCH: "model.switch",
  HIGH_RISK_CONFIRMATION_REQUIRED: "approval.high-risk.requested",
  HIGH_RISK_CONFIRMED: "approval.high-risk.granted",
  SERVER_STARTING: "runtime.server.starting",
  SERVER_READY: "runtime.server.ready",
  SERVER_STOPPED: "runtime.server.stopped",

  // Sub-agent delegation — lifecycle of child agents spawned from a parent
  // session via the spawn_sub_agent tool. Sequence within a parent requestId
  // stays strictly increasing; parent session + sub-agent id are carried in
  // the payload so UIs can group child events under the parent turn.
  SUB_AGENT_STARTED: "sub-agent.started",
  SUB_AGENT_PROGRESS: "sub-agent.progress",
  SUB_AGENT_COMPLETED: "sub-agent.completed",
  SUB_AGENT_FAILED: "sub-agent.failed",
  SUB_AGENT_LIST: "sub-agent.list",

  // Review mode — explicit human-in-the-loop (or reviewer sub-agent) gate.
  // When a session enters review mode the runtime MUST block sendMessage
  // until the review is resolved (approved / rejected). Comments can be
  // submitted incrementally by either human reviewers via the UI or by a
  // reviewer role sub-agent writing async findings back to the parent
  // session.
  REVIEW_REQUESTED: "review.requested",
  REVIEW_UPDATED: "review.updated",
  REVIEW_RESOLVED: "review.resolved",
  REVIEW_STATE: "review.state",

  // Patch preview / diff summary — proposed file edits that the user can
  // preview, approve (apply) or reject before they land on disk. Used to
  // surface a "diff summary" strip in the UI that batches multiple writes
  // from a single turn into a reviewable hunk list.
  PATCH_PROPOSED: "patch.proposed",
  PATCH_APPLIED: "patch.applied",
  PATCH_REJECTED: "patch.rejected",
  PATCH_SUMMARY: "patch.summary",

  // Persistent task graph + orchestrator — a session-scoped DAG of tasks
  // with dependencies. The runtime serializes the graph to session metadata
  // so it survives CLI restarts; the orchestrator advances the graph by
  // marking ready nodes as `running` when their dependencies complete.
  TASK_GRAPH_CREATED: "task-graph.created",
  TASK_GRAPH_UPDATED: "task-graph.updated",
  TASK_GRAPH_NODE_ADDED: "task-graph.node.added",
  TASK_GRAPH_NODE_UPDATED: "task-graph.node.updated",
  TASK_GRAPH_NODE_COMPLETED: "task-graph.node.completed",
  TASK_GRAPH_NODE_FAILED: "task-graph.node.failed",
  TASK_GRAPH_ADVANCED: "task-graph.advanced",
  TASK_GRAPH_COMPLETED: "task-graph.completed",
  TASK_GRAPH_STATE: "task-graph.state",
});

const VALID_TYPE_SET = new Set(Object.values(CODING_AGENT_EVENT_TYPES));

/**
 * Map kebab-case legacy message types (the wire format the CLI WS server
 * currently emits, and what `agent-core.js` yields) to the unified dot-case
 * protocol. Anything not listed here gets passed through unchanged so we can
 * stage the migration.
 */
const LEGACY_TO_UNIFIED_TYPE = Object.freeze({
  // Session lifecycle
  "session-created": CODING_AGENT_EVENT_TYPES.SESSION_STARTED,
  "session-resumed": CODING_AGENT_EVENT_TYPES.SESSION_RESUMED,
  "session-closed": CODING_AGENT_EVENT_TYPES.SESSION_CLOSED,
  "session-interrupted": CODING_AGENT_EVENT_TYPES.SESSION_INTERRUPTED,
  "session-completed": CODING_AGENT_EVENT_TYPES.SESSION_COMPLETED,
  "session-list-result": CODING_AGENT_EVENT_TYPES.SESSION_LIST,

  // Assistant output
  "response-token": CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
  "response-delta": CODING_AGENT_EVENT_TYPES.ASSISTANT_DELTA,
  "response-complete": CODING_AGENT_EVENT_TYPES.ASSISTANT_FINAL,
  "response-message": CODING_AGENT_EVENT_TYPES.ASSISTANT_MESSAGE,
  "thought-summary": CODING_AGENT_EVENT_TYPES.ASSISTANT_THOUGHT_SUMMARY,

  // Tool calls
  "tool-executing": CODING_AGENT_EVENT_TYPES.TOOL_CALL_STARTED,
  "tool-progress": CODING_AGENT_EVENT_TYPES.TOOL_CALL_PROGRESS,
  "tool-result": CODING_AGENT_EVENT_TYPES.TOOL_CALL_COMPLETED,
  "tool-error": CODING_AGENT_EVENT_TYPES.TOOL_CALL_FAILED,
  "tool-skipped": CODING_AGENT_EVENT_TYPES.TOOL_CALL_SKIPPED,
  "tool-blocked": CODING_AGENT_EVENT_TYPES.TOOL_CALL_FAILED,

  // Plan mode
  "plan-started": CODING_AGENT_EVENT_TYPES.PLAN_STARTED,
  "plan-updated": CODING_AGENT_EVENT_TYPES.PLAN_UPDATED,
  "plan-ready": CODING_AGENT_EVENT_TYPES.PLAN_APPROVAL_REQUIRED,
  "plan-generated": CODING_AGENT_EVENT_TYPES.PLAN_UPDATED,
  "plan-approved": CODING_AGENT_EVENT_TYPES.PLAN_APPROVED,
  "plan-rejected": CODING_AGENT_EVENT_TYPES.PLAN_REJECTED,

  // Request lifecycle
  "request-accepted": CODING_AGENT_EVENT_TYPES.REQUEST_ACCEPTED,
  "request-rejected": CODING_AGENT_EVENT_TYPES.REQUEST_REJECTED,

  // Approvals
  "approval-requested": CODING_AGENT_EVENT_TYPES.APPROVAL_REQUESTED,
  "approval-granted": CODING_AGENT_EVENT_TYPES.APPROVAL_GRANTED,
  "approval-denied": CODING_AGENT_EVENT_TYPES.APPROVAL_DENIED,
  "approval-expired": CODING_AGENT_EVENT_TYPES.APPROVAL_EXPIRED,
  "high-risk-confirmation-required":
    CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMATION_REQUIRED,
  "high-risk-confirmed": CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMED,

  // Context compaction
  "compression-started": CODING_AGENT_EVENT_TYPES.CONTEXT_COMPACTION_STARTED,
  "compression-applied": CODING_AGENT_EVENT_TYPES.CONTEXT_COMPACTION_COMPLETED,
  "compression-stats": CODING_AGENT_EVENT_TYPES.CONTEXT_COMPACTION_COMPLETED,

  // Worktree extensions
  "worktree-list": CODING_AGENT_EVENT_TYPES.WORKTREE_LIST,
  "worktree-diff": CODING_AGENT_EVENT_TYPES.WORKTREE_DIFF,
  "worktree-merged": CODING_AGENT_EVENT_TYPES.WORKTREE_MERGED,
  "worktree-merge-preview": CODING_AGENT_EVENT_TYPES.WORKTREE_MERGE_PREVIEW,
  "worktree-automation-applied":
    CODING_AGENT_EVENT_TYPES.WORKTREE_AUTOMATION_APPLIED,

  // Misc extensions
  "command-response": CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
  "slot-filling": CODING_AGENT_EVENT_TYPES.SLOT_FILLING,
  "model-switch": CODING_AGENT_EVENT_TYPES.MODEL_SWITCH,
  "server-starting": CODING_AGENT_EVENT_TYPES.SERVER_STARTING,
  "server-ready": CODING_AGENT_EVENT_TYPES.SERVER_READY,
  "server-stopped": CODING_AGENT_EVENT_TYPES.SERVER_STOPPED,

  // Errors
  warning: CODING_AGENT_EVENT_TYPES.WARNING,
  error: CODING_AGENT_EVENT_TYPES.ERROR,
});

/**
 * Map a legacy kebab-case type into the canonical dot-case type.
 * Returns the original input if no mapping exists, so unknown types fall
 * through and the receiver still gets a structured envelope.
 */
function mapLegacyType(type) {
  if (!type) {
    return null;
  }
  return LEGACY_TO_UNIFIED_TYPE[type] || type;
}

/**
 * Per-requestId monotonically-increasing sequence tracker, scoped to a
 * single agent runtime instance. Used to satisfy the protocol invariant:
 *
 *   "Within the same requestId, sequence MUST be strictly increasing."
 */
class CodingAgentSequenceTracker {
  constructor() {
    this._counters = new Map();
  }

  next(requestId) {
    if (!requestId) {
      return 0;
    }
    const current = this._counters.get(requestId) || 0;
    const next = current + 1;
    this._counters.set(requestId, next);
    return next;
  }

  reset(requestId) {
    if (requestId) {
      this._counters.delete(requestId);
    } else {
      this._counters.clear();
    }
  }

  peek(requestId) {
    return this._counters.get(requestId) || 0;
  }
}

const defaultSequenceTracker = new CodingAgentSequenceTracker();

/**
 * Build a unified Coding Agent event envelope. This is the ONLY shape the
 * CLI runtime, the Desktop Main process and the Renderer should pass around.
 *
 * @param {string} type     One of CODING_AGENT_EVENT_TYPES (or a legacy
 *                          kebab-case alias, which will be normalized).
 * @param {object} payload  Event-specific data. Must be a plain object.
 * @param {object} context  Envelope context: sessionId, requestId, source,
 *                          sequence, eventId, timestamp, meta, tracker.
 */
function createCodingAgentEvent(type, payload = {}, context = {}) {
  if (payload && typeof payload !== "object") {
    throw new TypeError(
      "createCodingAgentEvent: payload must be an object",
    );
  }

  const normalizedType = mapLegacyType(type);
  const tracker = context.tracker || defaultSequenceTracker;
  const sessionId =
    context.sessionId || (payload && payload.sessionId) || null;
  const requestId =
    context.requestId ||
    (payload && (payload.requestId || payload.id)) ||
    null;

  let sequence;
  if (Number.isInteger(context.sequence)) {
    sequence = context.sequence;
  } else if (requestId && tracker) {
    sequence = tracker.next(requestId);
  } else {
    sequence = null;
  }

  const eventId = context.eventId || randomUUID();

  const meta = { ...(context.meta || {}) };
  // Strip envelope fields if a caller accidentally stuffed them into meta.
  delete meta.sessionId;
  delete meta.requestId;
  delete meta.sequence;
  delete meta.source;
  delete meta.eventId;

  return {
    version: CODING_AGENT_EVENT_VERSION,
    eventId,
    // Legacy alias retained for transitional consumers that still read .id.
    id: eventId,
    type: normalizedType,
    timestamp: context.timestamp || Date.now(),
    sessionId,
    requestId,
    // Default to "desktop-main" to preserve the existing Desktop call-site
    // semantics. CLI runtime sites should pass `source: "cli-runtime"`
    // explicitly when they adopt the protocol.
    source: context.source || "desktop-main",
    sequence,
    payload: payload || {},
    meta,
  };
}

/**
 * Wrap a legacy kebab-case message (e.g. `{ type: "session-created", ... }`
 * coming over the WS wire from the CLI server) into a unified envelope.
 * Used during the migration window so receivers don't have to learn two
 * shapes — they can call this once at the boundary and forget the rest.
 */
function wrapLegacyMessage(message, context = {}) {
  if (!message || typeof message !== "object") {
    throw new TypeError(
      "wrapLegacyMessage: message must be a non-null object",
    );
  }

  const { type, ...payload } = message;
  return createCodingAgentEvent(type, payload, {
    ...context,
    requestId: context.requestId || message.id || message.requestId || null,
    sessionId: context.sessionId || message.sessionId || null,
  });
}

/**
 * Validate an envelope. Returns `{ valid: true }` or
 * `{ valid: false, errors: [...] }`. Used by tests and the Desktop bridge
 * to fail fast when a producer sends a malformed event.
 */
function validateCodingAgentEvent(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object") {
    return { valid: false, errors: ["envelope must be an object"] };
  }
  if (envelope.version !== CODING_AGENT_EVENT_VERSION) {
    errors.push(`version must be "${CODING_AGENT_EVENT_VERSION}"`);
  }
  if (!envelope.type) {
    errors.push("type is required");
  } else if (!VALID_TYPE_SET.has(envelope.type)) {
    errors.push(`type "${envelope.type}" is not in the whitelist`);
  }
  if (!envelope.eventId) {
    errors.push("eventId is required");
  }
  if (envelope.payload && typeof envelope.payload !== "object") {
    errors.push("payload must be an object");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Legacy alias enum — kept so existing Desktop code that imports
 * `CodingAgentEventType.SESSION_CREATED` keeps compiling while we migrate
 * call sites to `CODING_AGENT_EVENT_TYPES.SESSION_STARTED`.
 */
const CodingAgentEventType = Object.freeze({
  SERVER_STARTING: CODING_AGENT_EVENT_TYPES.SERVER_STARTING,
  SERVER_READY: CODING_AGENT_EVENT_TYPES.SERVER_READY,
  SERVER_STOPPED: CODING_AGENT_EVENT_TYPES.SERVER_STOPPED,
  SESSION_CREATED: CODING_AGENT_EVENT_TYPES.SESSION_STARTED,
  SESSION_RESUMED: CODING_AGENT_EVENT_TYPES.SESSION_RESUMED,
  SESSION_INTERRUPTED: CODING_AGENT_EVENT_TYPES.SESSION_INTERRUPTED,
  SESSION_CLOSED: CODING_AGENT_EVENT_TYPES.SESSION_CLOSED,
  SESSION_LIST: CODING_AGENT_EVENT_TYPES.SESSION_LIST,
  WORKTREE_LIST: CODING_AGENT_EVENT_TYPES.WORKTREE_LIST,
  WORKTREE_DIFF: CODING_AGENT_EVENT_TYPES.WORKTREE_DIFF,
  WORKTREE_MERGE_PREVIEW: CODING_AGENT_EVENT_TYPES.WORKTREE_MERGE_PREVIEW,
  WORKTREE_MERGED: CODING_AGENT_EVENT_TYPES.WORKTREE_MERGED,
  WORKTREE_AUTOMATION_APPLIED:
    CODING_AGENT_EVENT_TYPES.WORKTREE_AUTOMATION_APPLIED,
  MESSAGE_SENT: CODING_AGENT_EVENT_TYPES.REQUEST_ACCEPTED,
  RESPONSE_COMPLETE: CODING_AGENT_EVENT_TYPES.ASSISTANT_FINAL,
  TOOL_EXECUTING: CODING_AGENT_EVENT_TYPES.TOOL_CALL_STARTED,
  TOOL_RESULT: CODING_AGENT_EVENT_TYPES.TOOL_CALL_COMPLETED,
  TOOL_BLOCKED: CODING_AGENT_EVENT_TYPES.TOOL_CALL_FAILED,
  COMMAND_RESPONSE: CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
  PLAN_READY: CODING_AGENT_EVENT_TYPES.PLAN_APPROVAL_REQUIRED,
  PLAN_GENERATED: CODING_AGENT_EVENT_TYPES.PLAN_UPDATED,
  APPROVAL_REQUESTED: CODING_AGENT_EVENT_TYPES.APPROVAL_REQUESTED,
  APPROVAL_GRANTED: CODING_AGENT_EVENT_TYPES.APPROVAL_GRANTED,
  APPROVAL_DENIED: CODING_AGENT_EVENT_TYPES.APPROVAL_DENIED,
  HIGH_RISK_CONFIRMATION_REQUIRED:
    CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMATION_REQUIRED,
  HIGH_RISK_CONFIRMED: CODING_AGENT_EVENT_TYPES.HIGH_RISK_CONFIRMED,
  SLOT_FILLING: CODING_AGENT_EVENT_TYPES.SLOT_FILLING,
  MODEL_SWITCH: CODING_AGENT_EVENT_TYPES.MODEL_SWITCH,
  ERROR: CODING_AGENT_EVENT_TYPES.ERROR,
});

module.exports = {
  CODING_AGENT_EVENT_VERSION,
  CODING_AGENT_EVENT_CHANNEL,
  CODING_AGENT_EVENT_TYPES,
  CodingAgentEventType, // legacy alias
  LEGACY_TO_UNIFIED_TYPE,
  CodingAgentSequenceTracker,
  defaultSequenceTracker,
  createCodingAgentEvent,
  wrapLegacyMessage,
  validateCodingAgentEvent,
  mapLegacyType,
};
