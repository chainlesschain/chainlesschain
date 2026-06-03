/**
 * Web UI envelope unwrap helper.
 *
 * Single source of truth for the unified Coding Agent envelope → legacy
 * kebab-case adapter consumed by the browser bundle in `web-ui-server.js`.
 *
 * The same code runs in two contexts:
 *   1. Node.js unit tests — imported as ESM/CJS and executed directly.
 *   2. Browser — inlined into the HTML payload as a `<script>` block via
 *      `getInlineSource()`. The function body must therefore stay
 *      ES5-friendly (no spread, no const) so it parses in older runtimes.
 */

export const UNIFIED_TO_LEGACY = Object.freeze({
  "session.started": "session-created",
  "session.resumed": "session-resumed",
  "session.list": "session-list-result",
  "session.closed": "session-closed",
  "assistant.delta": "response-token",
  "assistant.final": "response-complete",
  "assistant.message": "response-message",
  "assistant.thought-summary": "thought-summary",
  "tool.call.started": "tool-executing",
  "tool.call.completed": "tool-result",
  "tool.call.failed": "tool-error",
  "tool.call.skipped": "tool-skipped",
  "plan.started": "plan-started",
  "plan.updated": "plan-updated",
  "plan.approval_required": "plan-ready",
  "plan.approved": "plan-approved",
  "plan.rejected": "plan-rejected",
  "request.accepted": "request-accepted",
  "request.rejected": "request-rejected",
  "approval.requested": "approval-requested",
  "approval.granted": "approval-granted",
  "approval.denied": "approval-denied",
  "model.switch": "model-switch",
  "command.response": "command-response",
  "slot.filling": "slot-filling",
  "context.compaction.completed": "compression-applied",
  "worktree.list": "worktree-list",
  "worktree.diff": "worktree-diff",
  "worktree.merged": "worktree-merged",
  "worktree.merge-preview": "worktree-merge-preview",
  "worktree.automation-applied": "worktree-automation-applied",
});

/**
 * Detect a unified envelope and unwrap its payload into a flat shape that
 * matches the legacy kebab-case message structure.
 *
 * Returns the message unchanged if it is not a recognised envelope so that
 * non-envelope traffic (auth-result, server pings, etc.) keeps working.
 */
export function unwrapEnvelope(msg) {
  if (!msg || typeof msg !== "object") return msg;
  if (msg.version !== "1.0") return msg;
  if (typeof msg.eventId !== "string") return msg;
  if (!msg.payload || typeof msg.payload !== "object") return msg;
  const legacyType = UNIFIED_TO_LEGACY[msg.type] || msg.type;
  const flat = Object.assign({}, msg.payload);
  flat.type = legacyType;
  if (msg.sessionId != null) flat.sessionId = msg.sessionId;
  if (msg.requestId != null) flat.requestId = msg.requestId;
  return flat;
}

/**
 * Render the helper as a `var` + `function` declaration string suitable
 * for inlining inside the browser bundle returned by `buildHtml`.
 *
 * The output is intentionally ES5-compatible: it uses `var` rather than
 * `const`, and inlines the map literal so the browser does not need to
 * import any module.
 */
export function getInlineSource() {
  return (
    "var UNIFIED_TO_LEGACY = " +
    JSON.stringify(UNIFIED_TO_LEGACY, null, 2) +
    ";\n" +
    "function unwrapEnvelope(msg) {\n" +
    "    if (!msg || typeof msg !== 'object') return msg;\n" +
    "    if (msg.version !== '1.0') return msg;\n" +
    "    if (typeof msg.eventId !== 'string') return msg;\n" +
    "    if (!msg.payload || typeof msg.payload !== 'object') return msg;\n" +
    "    var legacyType = UNIFIED_TO_LEGACY[msg.type] || msg.type;\n" +
    "    var flat = Object.assign({}, msg.payload);\n" +
    "    flat.type = legacyType;\n" +
    "    if (msg.sessionId != null) flat.sessionId = msg.sessionId;\n" +
    "    if (msg.requestId != null) flat.requestId = msg.requestId;\n" +
    "    return flat;\n" +
    "  }"
  );
}
