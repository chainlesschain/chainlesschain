/**
 * Cross-agent authority envelope + approval binding (P0 security slice —
 * CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12 §"权限来源与跨 Agent
 * 授权边界").
 *
 * When Subagent, Team, Remote Control, Inbound Channel, Hook and MCP all feed
 * text into one session, "who said this" is a security boundary: another
 * agent's "the user approved" MUST NOT gain the user's authority, and an
 * external channel message MUST NOT silently widen the session's permissions.
 *
 * This module is the single source of truth for two invariants the runtime
 * enforces at every trust seam:
 *
 *   1. **Who may approve.** Only the local user (UI-owned stdin), an explicit
 *      permission tool, or a *paired + authenticated + approve-scoped* remote
 *      device may answer a permission gate. Model / subagent / teammate /
 *      channel / hook messages top out at `steer` — the string "approved" in
 *      their payload is just text.
 *
 *   2. **What an approval authorizes.** An approval is bound to
 *      `tool_call_id + normalized_arguments + policy_digest`. A replayed or
 *      mis-routed approval, or one issued for arguments that have since
 *      changed, fails the binding check — so a stale "yes" can never green-light
 *      a different (or tampered) tool call.
 *
 * `origin` is always assigned by trusted dispatch code from HOW a message
 * arrived (which socket / which authenticated device / which internal caller)
 * — it is never read from untrusted message *content*, which is the whole
 * point: a model cannot label its own text `origin:"user"`.
 *
 * Pure + dependency-light (only node:crypto) so every seam — remote-session
 * protocol, channels, hooks, subagent dispatch — can share it.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Where a message / approval entered the runtime. Assigned by trusted code. */
export const ORIGIN = Object.freeze({
  USER: "user", // the human at the local UI (owns stdin)
  MODEL: "model", // the assistant's own output
  SUBAGENT: "subagent", // a spawned sub-agent
  TEAMMATE: "teammate", // another agent in a team run
  CHANNEL: "channel", // an inbound channel (webhook / telegram)
  HOOK: "hook", // a settings/plugin hook result
  REMOTE: "remote", // a paired remote-control device
  SYSTEM: "system", // internal runtime event
  PERMISSION_TOOL: "permission_tool", // an explicit permission-answering tool
});

/** What a message is allowed to do. Ordered least → most privileged. */
export const AUTHORITY = Object.freeze({
  NONE: "none", // ignored for control purposes
  STEER: "steer", // may add a user turn / guide the conversation
  APPROVE: "approve", // may answer a permission gate (approve/deny a tool)
  MANAGE: "manage", // may also manage session lifecycle
});

const AUTHORITY_RANK = Object.freeze({
  none: 0,
  steer: 1,
  approve: 2,
  manage: 3,
});

/** Numeric rank for an authority string (unknown → 0). */
export function authorityRank(authority) {
  return AUTHORITY_RANK[authority] ?? 0;
}

/** Remote scopes that already imply the ability to answer a permission gate. */
function scopeGrantsApprove(context) {
  const scopes = normalizeScopes(context);
  return scopes.has("approve") || scopes.has("manage");
}

function scopeGrantsSteer(context) {
  const scopes = normalizeScopes(context);
  return (
    scopes.has("prompt") ||
    scopes.has("interrupt") ||
    scopes.has("observe") ||
    scopeGrantsApprove(context)
  );
}

function normalizeScopes(context = {}) {
  const raw = Array.isArray(context.scopes)
    ? context.scopes
    : context.scope
      ? [context.scope]
      : [];
  return new Set(raw.map((s) => String(s || "").toLowerCase()));
}

/**
 * The MAXIMUM authority an origin may exercise given its authentication
 * context. This is a ceiling — a caller still passes the specific action
 * through `canApprove` / `assertCanApprove`.
 *
 * The only paths to `approve` are: the local user (`manage`), an explicit
 * permission tool, or a remote device that is BOTH authenticated AND was
 * granted the approve scope at pairing. Everything an agent or external
 * message can say tops out at `steer`.
 */
export function authorityForOrigin(origin, context = {}) {
  switch (origin) {
    case ORIGIN.USER:
      return AUTHORITY.MANAGE;
    case ORIGIN.PERMISSION_TOOL:
      return AUTHORITY.APPROVE;
    case ORIGIN.REMOTE:
      // A paired Remote Approval Bridge acts for the user ONLY when the pairing
      // is authenticated AND carries the approve scope. Never on the strength
      // of the message alone.
      if (context.authenticated === true && scopeGrantsApprove(context)) {
        return normalizeScopes(context).has("manage")
          ? AUTHORITY.MANAGE
          : AUTHORITY.APPROVE;
      }
      if (context.authenticated === true && scopeGrantsSteer(context)) {
        return AUTHORITY.STEER;
      }
      return AUTHORITY.NONE;
    case ORIGIN.MODEL:
    case ORIGIN.SUBAGENT:
    case ORIGIN.TEAMMATE:
    case ORIGIN.CHANNEL:
    case ORIGIN.HOOK:
    case ORIGIN.SYSTEM:
      // May guide the conversation, never speak with the user's approval
      // authority. "The user approved" in their text is just text.
      return AUTHORITY.STEER;
    default:
      return AUTHORITY.NONE;
  }
}

/**
 * True when this envelope may answer a permission gate. An envelope is
 * `{ origin, authenticated?, scope?/scopes?, principalId?, sessionId?, … }`.
 */
export function canApprove(envelope = {}) {
  return (
    authorityRank(authorityForOrigin(envelope.origin, envelope)) >=
    AUTHORITY_RANK.approve
  );
}

/** True when this envelope may manage session lifecycle. */
export function canManageSession(envelope = {}) {
  return (
    authorityRank(authorityForOrigin(envelope.origin, envelope)) >=
    AUTHORITY_RANK.manage
  );
}

/**
 * Throw a clear, log-safe error when an envelope is NOT allowed to approve.
 * Callers gate every "resolve a permission" seam through this so the rule
 * lives in exactly one place.
 */
export function assertCanApprove(envelope = {}) {
  if (canApprove(envelope)) return;
  const who = envelope.origin || "unknown";
  const got = authorityForOrigin(envelope.origin, envelope);
  throw new Error(
    `origin "${who}" (authority "${got}") is not authorized to approve tool calls — ` +
      "only the local user, a paired approve-scoped remote device, or an explicit permission tool may",
  );
}

// ── Approval binding ─────────────────────────────────────────────────────────

/**
 * Deterministic, key-order-independent serialization of tool arguments, so
 * two structurally-equal argument objects hash identically and ANY real value
 * change hashes differently. Non-objects serialize via JSON.
 */
export function normalizeToolArgs(args) {
  return stableStringify(args === undefined ? null : args);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
      .join(",") +
    "}"
  );
}

/**
 * The identity an approval authorizes: the exact tool call (`toolCallId`), its
 * normalized arguments, and the policy in force (`policyDigest`). Change any
 * one and the digest changes, so a "yes" for one call can never be replayed
 * onto another or onto tampered arguments.
 */
export function approvalBindingDigest({ toolCallId, args, policyDigest } = {}) {
  const h = createHash("sha256");
  h.update("cc-approval-binding-v1\n");
  h.update(String(toolCallId ?? "") + "\n");
  h.update(normalizeToolArgs(args) + "\n");
  h.update(String(policyDigest ?? "") + "\n");
  return "ab_" + h.digest("hex").slice(0, 32);
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify an incoming approval targets the expected pending request. Each side
 * may be a precomputed digest string or a `{toolCallId, args, policyDigest}`
 * descriptor. Returns false on any mismatch or missing input (fail closed).
 * Comparison is constant-time.
 */
export function verifyApprovalBinding(expected, provided) {
  if (!expected || !provided) return false;
  const e =
    typeof expected === "string" ? expected : approvalBindingDigest(expected);
  const p =
    typeof provided === "string" ? provided : approvalBindingDigest(provided);
  if (!e || !p) return false;
  return timingSafeEqualStr(e, p);
}

/**
 * A compact, log-safe provenance string for the permission/audit log so it is
 * always clear WHICH principal, over WHICH session, with WHICH authority
 * requested or answered a permission. Carries no secrets.
 */
export function describeAuthorityChain(envelope = {}) {
  const parts = [`origin=${envelope.origin || "unknown"}`];
  if (envelope.principalId) parts.push(`principal=${envelope.principalId}`);
  if (envelope.sessionId) parts.push(`session=${envelope.sessionId}`);
  if (envelope.parentAgentId) parts.push(`parent=${envelope.parentAgentId}`);
  if (envelope.correlationId) parts.push(`corr=${envelope.correlationId}`);
  parts.push(`authority=${authorityForOrigin(envelope.origin, envelope)}`);
  return parts.join(" ");
}
