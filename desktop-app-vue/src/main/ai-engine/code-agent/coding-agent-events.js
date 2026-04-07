const { randomUUID } = require("crypto");

const CODING_AGENT_EVENT_CHANNEL = "coding-agent:event";

const CodingAgentEventType = {
  SERVER_STARTING: "server-starting",
  SERVER_READY: "server-ready",
  SERVER_STOPPED: "server-stopped",
  SESSION_CREATED: "session-created",
  SESSION_RESUMED: "session-resumed",
  SESSION_CLOSED: "session-closed",
  SESSION_LIST: "session-list",
  WORKTREE_LIST: "worktree-list",
  WORKTREE_DIFF: "worktree-diff",
  WORKTREE_MERGE_PREVIEW: "worktree-merge-preview",
  WORKTREE_MERGED: "worktree-merged",
  WORKTREE_AUTOMATION_APPLIED: "worktree-automation-applied",
  MESSAGE_SENT: "message-sent",
  RESPONSE_COMPLETE: "response-complete",
  TOOL_EXECUTING: "tool-executing",
  TOOL_RESULT: "tool-result",
  TOOL_BLOCKED: "tool-blocked",
  COMMAND_RESPONSE: "command-response",
  PLAN_READY: "plan-ready",
  PLAN_GENERATED: "plan-generated",
  APPROVAL_REQUESTED: "approval-requested",
  HIGH_RISK_CONFIRMATION_REQUIRED: "high-risk-confirmation-required",
  HIGH_RISK_CONFIRMED: "high-risk-confirmed",
  SLOT_FILLING: "slot-filling",
  MODEL_SWITCH: "model-switch",
  ERROR: "error",
};

function createCodingAgentEvent(type, payload = {}, meta = {}) {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    sessionId: meta.sessionId || payload.sessionId || null,
    requestId: meta.requestId || payload.requestId || payload.id || null,
    payload,
  };
}

module.exports = {
  CODING_AGENT_EVENT_CHANNEL,
  CodingAgentEventType,
  createCodingAgentEvent,
};
