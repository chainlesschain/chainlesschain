import { createHash } from "node:crypto";
import { redactSecrets } from "./secret-scan.js";

export const POLICY_DECISION_EVENT_VERSION = 1;

const MAX_CHAIN = 8;

function boundedText(value, max) {
  if (value == null) return null;
  let text;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  const redacted = redactSecrets(String(text));
  return redacted.length > max
    ? `${redacted.slice(0, Math.max(0, max - 1))}…`
    : redacted;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function canonicalDecision(
  value,
  { blocked = false, requiresApproval = false } = {},
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    blocked ||
    ["block", "blocked", "deny", "denied", "decline", "cancel"].includes(
      normalized,
    )
  ) {
    return "deny";
  }
  if (
    requiresApproval ||
    ["ask", "confirm", "approval_required", "require_confirmation"].includes(
      normalized,
    )
  ) {
    return "ask";
  }
  return "allow";
}

function normalizeChain(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CHAIN).map((candidate) => {
    const row =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? candidate
        : {};
    return {
      layer: boundedText(row.layer, 80),
      outcome: boundedText(row.outcome, 80),
      via: boundedText(row.via || row.source, 120),
      rule: boundedText(row.rule, 256),
      reason: boundedText(row.reason, 512),
    };
  });
}

function finalizePolicyDecision(value) {
  const projection = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
  const policyDigest = digest(projection);
  return Object.freeze({
    type: "policy_decision",
    schema_version: POLICY_DECISION_EVENT_VERSION,
    decision_id:
      boundedText(projection.decision_id, 160) ||
      `policy:${policyDigest.slice("sha256:".length, "sha256:".length + 48)}`,
    ...projection,
    policy_digest: policyDigest,
  });
}

export function projectHookPolicyDecision(event = {}) {
  if (event?.type !== "hook_response") return null;
  return finalizePolicyDecision({
    source: "hook",
    decision: canonicalDecision(event.decision, {
      blocked: event.blocked === true || Boolean(event.error),
      requiresApproval: event.requires_approval === true,
    }),
    session_id: boundedText(event.session_id, 160) || undefined,
    turn_id: boundedText(event.turn_id, 160) || undefined,
    tool_use_id: boundedText(event.tool_use_id, 160) || undefined,
    tool: boundedText(event.tool || event.tool_name, 256) || undefined,
    hook_event: boundedText(event.hook_event, 96) || undefined,
    via: boundedText(
      event.via || (event.hook_event ? `hook:${event.hook_event}` : "hook"),
      120,
    ),
    reason: event.error ? "hook_runtime_error" : undefined,
  });
}

export function projectToolPolicyDecision(event = {}, context = {}) {
  const permission =
    event?.permission_decision &&
    typeof event.permission_decision === "object" &&
    !Array.isArray(event.permission_decision)
      ? event.permission_decision
      : null;
  if (!permission) return null;
  return finalizePolicyDecision({
    decision_id:
      boundedText(permission.id || event.permission_decision_id, 160) ||
      undefined,
    source: "tool",
    decision: canonicalDecision(permission.decision),
    session_id:
      boundedText(context.sessionId || event.session_id, 160) || undefined,
    turn_id: boundedText(context.turnId || event.turn_id, 160) || undefined,
    tool_use_id:
      boundedText(context.toolUseId || event.tool_use_id || event.id, 160) ||
      undefined,
    tool: boundedText(event.tool || permission.tool, 256) || undefined,
    via: boundedText(permission.via, 120) || undefined,
    rule: boundedText(permission.rule, 256) || undefined,
    reason: boundedText(permission.reason, 512) || undefined,
    chain: normalizeChain(permission.chain),
  });
}
