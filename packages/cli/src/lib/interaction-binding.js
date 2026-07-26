/**
 * Transport-neutral binding for a human interaction response.
 *
 * The binding is intentionally plain JSON so CLI attach, WebSocket, Desktop,
 * VS Code, JetBrains, SDK and Remote Control can echo the same value without
 * reinterpreting it. The runtime that created the request remains authoritative
 * and compares every field before accepting a response.
 */

function asNullableString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

export function normalizeInteractionBinding(binding = {}) {
  const source =
    binding && typeof binding === "object" && !Array.isArray(binding)
      ? binding
      : {};
  return {
    backgroundAgentId: asNullableString(
      source.backgroundAgentId ?? source.background_agent_id,
    ),
    sessionId: asNullableString(source.sessionId ?? source.session_id),
    turnId: asNullableString(source.turnId ?? source.turn_id),
    toolUseId: asNullableString(
      source.toolUseId ??
        source.tool_use_id ??
        source.toolCallId ??
        source.tool_call_id,
    ),
    sequence:
      Number.isSafeInteger(source.sequence) && source.sequence > 0
        ? source.sequence
        : null,
  };
}

export function sameInteractionBinding(left, right) {
  const a = normalizeInteractionBinding(left);
  const b = normalizeInteractionBinding(right);
  return (
    a.backgroundAgentId === b.backgroundAgentId &&
    a.sessionId === b.sessionId &&
    a.turnId === b.turnId &&
    a.toolUseId === b.toolUseId &&
    a.sequence === b.sequence
  );
}

export function hasCompleteInteractionBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return false;
  }
  const hasAny = (...keys) =>
    keys.some((key) => Object.prototype.hasOwnProperty.call(binding, key));
  return (
    hasAny("backgroundAgentId", "background_agent_id") &&
    hasAny("sessionId", "session_id") &&
    hasAny("turnId", "turn_id") &&
    hasAny("toolUseId", "tool_use_id", "toolCallId", "tool_call_id") &&
    normalizeInteractionBinding(binding).sequence !== null
  );
}
