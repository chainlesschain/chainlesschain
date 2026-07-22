"use strict";
/**
 * ChainlessChain Agent Protocol — the versioned wire contract.
 *
 * This module is pure types + constants (no runtime I/O, browser-safe).
 * It formalizes the NDJSON `stream-json` protocol spoken by
 * `cc agent --input-format stream-json --output-format stream-json`
 * (source of truth: packages/cli/src/runtime/headless-stream.js) and the
 * background-session pipe protocol
 * (packages/cli/src/lib/background-session-transport.js), plus the
 * `bg-*` WebSocket relay frames
 * (packages/cli/src/gateways/ws/background-agent-protocol.js).
 *
 * Consumers: the Node SDK client in this package, the VS Code extension,
 * the web-panel, and (as documentation) the JetBrains plugin — Kotlin
 * consumes the same wire shapes via docs/PROTOCOL.md, which is generated
 * from the same field inventory. Any BREAKING field change here is a
 * protocol change: bump PROTOCOL_VERSION and update docs/PROTOCOL.md in
 * the same commit. Additive OPTIONAL fields stay on the current version
 * (consumers MUST tolerate their absence and ignore unknown fields) —
 * mirror packages/cli/src/lib/headless-manifest.js STREAM_PROTOCOL_VERSION.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTOCOL_FEATURES = exports.MIN_PROTOCOL_VERSION = exports.PROTOCOL_VERSION = void 0;
exports.isAgentEvent = isAgentEvent;
exports.isSystemInit = isSystemInit;
exports.isContentDelta = isContentDelta;
exports.contentDelta = contentDelta;
exports.isApprovalRequest = isApprovalRequest;
exports.isQuestionRequest = isQuestionRequest;
exports.isMcpElicitationRequest = isMcpElicitationRequest;
exports.isResult = isResult;
exports.PROTOCOL_VERSION = 1;
/**
 * The oldest protocol version the CLI can still negotiate down to (the N-1 in
 * "N / N-1"). At v1 there is no older line shape, so it equals PROTOCOL_VERSION;
 * once a v2 line shape ships this drops to 1 so a v1-only client negotiates a
 * v1 session. Mirror of packages/cli/src/lib/capability-negotiation.js
 * PROTOCOL_MIN_VERSION.
 */
exports.MIN_PROTOCOL_VERSION = 1;
/**
 * The wire-protocol features subject to negotiation — additive per-line fields
 * a client may or may not understand. Runtime capabilities (bare, worktree,
 * mcp, …) are NOT negotiated. Mirror of capability-negotiation.js
 * PROTOCOL_FEATURES.
 */
exports.PROTOCOL_FEATURES = [
    "event_seq",
    "tool_use_id",
    "trace_id",
];
// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────
function isObject(value) {
    return typeof value === "object" && value !== null;
}
function isAgentEvent(value) {
    return isObject(value) && typeof value.type === "string";
}
function isSystemInit(event) {
    return (event.type === "system" &&
        event.subtype === "init" &&
        typeof event.session_id === "string");
}
function isContentDelta(event) {
    if (event.type !== "stream_event")
        return false;
    const inner = event.event;
    return isObject(inner) && inner.type === "content_block_delta";
}
/** Extract the delta payload, or null when not a content delta. */
function contentDelta(event) {
    if (!isContentDelta(event))
        return null;
    const delta = event.event.delta;
    if (delta.type === "text_delta")
        return { kind: "text", text: delta.text };
    if (delta.type === "thinking_delta")
        return { kind: "thinking", text: delta.thinking };
    return null;
}
function isApprovalRequest(event) {
    return (event.type === "approval_request" &&
        typeof event.id === "string");
}
function isQuestionRequest(event) {
    return (event.type === "question_request" &&
        typeof event.id === "string");
}
/** True when a question wire event is carrying an MCP elicitation form. */
function isMcpElicitationRequest(event) {
    return (isQuestionRequest(event) &&
        event.metadata?.kind === "mcp_elicitation");
}
function isResult(event) {
    return event.type === "result";
}
