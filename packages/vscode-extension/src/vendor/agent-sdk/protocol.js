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
 * from the same field inventory. Any field change here is a protocol
 * change: bump PROTOCOL_VERSION and update docs/PROTOCOL.md in the same
 * commit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTOCOL_VERSION = void 0;
exports.isAgentEvent = isAgentEvent;
exports.isSystemInit = isSystemInit;
exports.isContentDelta = isContentDelta;
exports.contentDelta = contentDelta;
exports.isApprovalRequest = isApprovalRequest;
exports.isQuestionRequest = isQuestionRequest;
exports.isResult = isResult;
exports.PROTOCOL_VERSION = 1;
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
function isResult(event) {
    return event.type === "result";
}
