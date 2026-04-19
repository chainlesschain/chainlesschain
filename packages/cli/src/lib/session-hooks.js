/**
 * Session-level hook firing helpers — the "三件套 +1" that complements
 * the tool-level PreToolUse/PostToolUse hooks already wired in
 * `runtime/agent-core.js`.
 *
 * Four session-level events are fired from `repl/agent-repl.js`:
 *
 *   - SessionStart       — once, after sessionId is established
 *   - UserPromptSubmit   — per user line, before agentLoop()
 *   - AssistantResponse  — per agent reply, after agentLoop() returns
 *   - SessionEnd         — once, on rl.close() before shutdown
 *
 * Semantics (matches existing PreToolUse convention):
 *   - Fire-and-forget by default: hook failures NEVER break the host flow
 *   - `fireUserPromptSubmit` / `fireAssistantResponse` are opt-in helpers
 *     that parse stdout JSON directives ({rewrittenPrompt,abort} /
 *     {rewrittenResponse,suppress}) for callers that want control flow
 *   - No-op when hookDb is null (REPL without DB)
 *   - Helper-side timeout protects against runaway hooks even if
 *     hook-manager's per-hook timeout is misconfigured
 *   - Swallowed errors are persisted to hook_execution_log when possible
 */

import { executeHooks, HookEvents } from "./hook-manager.js";

/**
 * Events this helper is allowed to fire. Guards against typos that
 * would otherwise silently no-op inside executeHooks' event filter.
 */
export const SESSION_HOOK_EVENTS = Object.freeze([
  HookEvents.SessionStart,
  HookEvents.UserPromptSubmit,
  HookEvents.AssistantResponse,
  HookEvents.SessionEnd,
]);

/**
 * Helper-side wall-clock cap. Per-hook timeout still lives in the
 * registered hook row; this is a belt-and-suspenders bound so a
 * misconfigured hook can never wedge the REPL.
 */
const HELPER_TIMEOUT_MS = Number(
  process.env.CC_SESSION_HOOK_TIMEOUT_MS || 15000,
);

/**
 * Internal deps — exposed for tests via `_deps` injection.
 * Keeping this mutable lets vitest swap out timer/log writers without
 * resorting to vi.mock (which doesn't intercept inlined CJS).
 */
export const _deps = {
  executeHooks,
  now: () => Date.now(),
  logFailure: (hookDb, eventName, err) => {
    // Best-effort persistence to hook_execution_log; never throws.
    if (!hookDb || typeof hookDb.prepare !== "function") return;
    try {
      const stmt = hookDb.prepare(
        `INSERT INTO hook_execution_log
           (hook_id, event, success, error, executed_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      stmt.run(
        null,
        eventName,
        0,
        String(err && err.message ? err.message : err),
        new Date().toISOString(),
      );
    } catch {
      /* table may not exist yet — silent */
    }
  },
};

/**
 * Fire a session-level hook. Returns the raw results from executeHooks
 * (array of {hookId, hookName, success, ...}) or an empty array if
 * hookDb is missing, event is not allowed, or execution throws.
 *
 * @param {object|null} hookDb  better-sqlite3 handle, or null to no-op
 * @param {string}      eventName  one of SESSION_HOOK_EVENTS
 * @param {object}      [context]  forwarded to hook matcher + handler env
 * @returns {Promise<Array>}
 */
export async function fireSessionHook(hookDb, eventName, context = {}) {
  if (!hookDb) return [];
  if (!SESSION_HOOK_EVENTS.includes(eventName)) {
    throw new Error(
      `fireSessionHook: event "${eventName}" is not a session hook. ` +
        `Use one of: ${SESSION_HOOK_EVENTS.join(", ")}`,
    );
  }

  try {
    const enriched = {
      timestamp: new Date().toISOString(),
      ...context,
    };
    return await withTimeout(
      _deps.executeHooks(hookDb, eventName, enriched),
      HELPER_TIMEOUT_MS,
      `${eventName} session hook`,
    );
  } catch (err) {
    // Hook failures must never break the REPL — but we record them
    _deps.logFailure(hookDb, eventName, err);
    return [];
  }
}

/**
 * Fire UserPromptSubmit with rewrite/abort support.
 *
 * A hook may control the prompt by emitting a single JSON line to stdout:
 *   {"rewrittenPrompt": "..."}   — replace the user prompt
 *   {"abort": true, "reason": "..."} — skip agentLoop entirely
 *
 * First matching directive wins (priority order from executeHooks).
 * Malformed JSON / no directive → no change (pure observation).
 *
 * @returns {Promise<{prompt: string, abort: boolean, reason?: string, results: Array}>}
 */
export async function fireUserPromptSubmit(
  hookDb,
  originalPrompt,
  context = {},
) {
  const results = await fireSessionHook(hookDb, HookEvents.UserPromptSubmit, {
    ...context,
    prompt: originalPrompt,
  });

  let prompt = originalPrompt;
  let abort = false;
  let reason;

  for (const r of results) {
    if (!r || !r.success) continue;
    const directive = extractDirective(r);
    if (!directive) continue;
    if (directive.abort) {
      abort = true;
      reason = directive.reason;
      break;
    }
    if (
      typeof directive.rewrittenPrompt === "string" &&
      directive.rewrittenPrompt.trim()
    ) {
      prompt = directive.rewrittenPrompt;
      break;
    }
  }

  return { prompt, abort, reason, results };
}

/**
 * Fire AssistantResponse with rewrite/suppress support.
 *
 * Symmetric to fireUserPromptSubmit but on the way out. A hook may emit:
 *   {"rewrittenResponse": "..."} — replace the response shown to the user
 *   {"suppress": true, "reason": "..."} — drop the response entirely
 *
 * Common use: PII / secret scrubbing, watermark injection, profanity
 * filter on the model's final string before it reaches the terminal.
 *
 * @returns {Promise<{response: string, suppress: boolean, reason?: string, results: Array}>}
 */
export async function fireAssistantResponse(
  hookDb,
  originalResponse,
  context = {},
) {
  const results = await fireSessionHook(hookDb, HookEvents.AssistantResponse, {
    ...context,
    response: originalResponse,
  });

  let response = originalResponse;
  let suppress = false;
  let reason;

  for (const r of results) {
    if (!r || !r.success) continue;
    const directive = extractDirective(r);
    if (!directive) continue;
    if (directive.suppress) {
      suppress = true;
      reason = directive.reason;
      break;
    }
    if (
      typeof directive.rewrittenResponse === "string" &&
      directive.rewrittenResponse.length > 0
    ) {
      response = directive.rewrittenResponse;
      break;
    }
  }

  return { response, suppress, reason, results };
}

function extractDirective(result) {
  const raw = result.stdout ?? result.output ?? result.result;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(new Error(`${label} exceeded ${ms}ms helper timeout`)),
      ms,
    );
    if (typeof t.unref === "function") t.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ===== V2 Surface: Session Hooks governance overlay (CLI v0.142.0) =====
export const SHOK_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", DISABLED: "disabled", RETIRED: "retired",
});
export const SHOK_INVOCATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled",
});
const _shokPTrans = new Map([
  [SHOK_PROFILE_MATURITY_V2.PENDING, new Set([SHOK_PROFILE_MATURITY_V2.ACTIVE, SHOK_PROFILE_MATURITY_V2.RETIRED])],
  [SHOK_PROFILE_MATURITY_V2.ACTIVE, new Set([SHOK_PROFILE_MATURITY_V2.DISABLED, SHOK_PROFILE_MATURITY_V2.RETIRED])],
  [SHOK_PROFILE_MATURITY_V2.DISABLED, new Set([SHOK_PROFILE_MATURITY_V2.ACTIVE, SHOK_PROFILE_MATURITY_V2.RETIRED])],
  [SHOK_PROFILE_MATURITY_V2.RETIRED, new Set()],
]);
const _shokPTerminal = new Set([SHOK_PROFILE_MATURITY_V2.RETIRED]);
const _shokITrans = new Map([
  [SHOK_INVOCATION_LIFECYCLE_V2.QUEUED, new Set([SHOK_INVOCATION_LIFECYCLE_V2.RUNNING, SHOK_INVOCATION_LIFECYCLE_V2.CANCELLED])],
  [SHOK_INVOCATION_LIFECYCLE_V2.RUNNING, new Set([SHOK_INVOCATION_LIFECYCLE_V2.COMPLETED, SHOK_INVOCATION_LIFECYCLE_V2.FAILED, SHOK_INVOCATION_LIFECYCLE_V2.CANCELLED])],
  [SHOK_INVOCATION_LIFECYCLE_V2.COMPLETED, new Set()],
  [SHOK_INVOCATION_LIFECYCLE_V2.FAILED, new Set()],
  [SHOK_INVOCATION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _shokPsV2 = new Map();
const _shokIsV2 = new Map();
let _shokMaxActive = 12, _shokMaxPending = 25, _shokIdleMs = 30 * 24 * 60 * 60 * 1000, _shokStuckMs = 30 * 1000;
function _shokPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _shokCheckP(from, to) { const a = _shokPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid shok profile transition ${from} → ${to}`); }
function _shokCheckI(from, to) { const a = _shokITrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid shok invocation transition ${from} → ${to}`); }
export function setMaxActiveShokProfilesPerOwnerV2(n) { _shokMaxActive = _shokPos(n, "maxActiveShokProfilesPerOwner"); }
export function getMaxActiveShokProfilesPerOwnerV2() { return _shokMaxActive; }
export function setMaxPendingShokInvocationsPerProfileV2(n) { _shokMaxPending = _shokPos(n, "maxPendingShokInvocationsPerProfile"); }
export function getMaxPendingShokInvocationsPerProfileV2() { return _shokMaxPending; }
export function setShokProfileIdleMsV2(n) { _shokIdleMs = _shokPos(n, "shokProfileIdleMs"); }
export function getShokProfileIdleMsV2() { return _shokIdleMs; }
export function setShokInvocationStuckMsV2(n) { _shokStuckMs = _shokPos(n, "shokInvocationStuckMs"); }
export function getShokInvocationStuckMsV2() { return _shokStuckMs; }
export function _resetStateSessionHooksV2() { _shokPsV2.clear(); _shokIsV2.clear(); _shokMaxActive = 12; _shokMaxPending = 25; _shokIdleMs = 30 * 24 * 60 * 60 * 1000; _shokStuckMs = 30 * 1000; }
export function registerShokProfileV2({ id, owner, event, metadata } = {}) {
  if (!id) throw new Error("shok profile id required"); if (!owner) throw new Error("shok profile owner required");
  if (_shokPsV2.has(id)) throw new Error(`shok profile ${id} already registered`);
  const now = Date.now();
  const p = { id, owner, event: event || "preTurn", status: SHOK_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, retiredAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _shokPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
function _shokCountActive(owner) { let n = 0; for (const p of _shokPsV2.values()) if (p.owner === owner && p.status === SHOK_PROFILE_MATURITY_V2.ACTIVE) n++; return n; }
export function activateShokProfileV2(id) {
  const p = _shokPsV2.get(id); if (!p) throw new Error(`shok profile ${id} not found`);
  _shokCheckP(p.status, SHOK_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === SHOK_PROFILE_MATURITY_V2.DISABLED;
  if (!recovery && _shokCountActive(p.owner) >= _shokMaxActive) throw new Error(`max active shok profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = SHOK_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now; if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function disableShokProfileV2(id) { const p = _shokPsV2.get(id); if (!p) throw new Error(`shok profile ${id} not found`); _shokCheckP(p.status, SHOK_PROFILE_MATURITY_V2.DISABLED); p.status = SHOK_PROFILE_MATURITY_V2.DISABLED; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function retireShokProfileV2(id) { const p = _shokPsV2.get(id); if (!p) throw new Error(`shok profile ${id} not found`); _shokCheckP(p.status, SHOK_PROFILE_MATURITY_V2.RETIRED); const now = Date.now(); p.status = SHOK_PROFILE_MATURITY_V2.RETIRED; p.updatedAt = now; if (!p.retiredAt) p.retiredAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchShokProfileV2(id) { const p = _shokPsV2.get(id); if (!p) throw new Error(`shok profile ${id} not found`); if (_shokPTerminal.has(p.status)) throw new Error(`cannot touch terminal shok profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getShokProfileV2(id) { const p = _shokPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listShokProfilesV2() { return [..._shokPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
function _shokCountPending(profileId) { let n = 0; for (const i of _shokIsV2.values()) if (i.profileId === profileId && (i.status === SHOK_INVOCATION_LIFECYCLE_V2.QUEUED || i.status === SHOK_INVOCATION_LIFECYCLE_V2.RUNNING)) n++; return n; }
export function createShokInvocationV2({ id, profileId, payload, metadata } = {}) {
  if (!id) throw new Error("shok invocation id required"); if (!profileId) throw new Error("shok invocation profileId required");
  if (_shokIsV2.has(id)) throw new Error(`shok invocation ${id} already exists`);
  if (!_shokPsV2.has(profileId)) throw new Error(`shok profile ${profileId} not found`);
  if (_shokCountPending(profileId) >= _shokMaxPending) throw new Error(`max pending shok invocations for profile ${profileId} reached`);
  const now = Date.now();
  const i = { id, profileId, payload: payload || "", status: SHOK_INVOCATION_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _shokIsV2.set(id, i); return { ...i, metadata: { ...i.metadata } };
}
export function runningShokInvocationV2(id) { const i = _shokIsV2.get(id); if (!i) throw new Error(`shok invocation ${id} not found`); _shokCheckI(i.status, SHOK_INVOCATION_LIFECYCLE_V2.RUNNING); const now = Date.now(); i.status = SHOK_INVOCATION_LIFECYCLE_V2.RUNNING; i.updatedAt = now; if (!i.startedAt) i.startedAt = now; return { ...i, metadata: { ...i.metadata } }; }
export function completeShokInvocationV2(id) { const i = _shokIsV2.get(id); if (!i) throw new Error(`shok invocation ${id} not found`); _shokCheckI(i.status, SHOK_INVOCATION_LIFECYCLE_V2.COMPLETED); const now = Date.now(); i.status = SHOK_INVOCATION_LIFECYCLE_V2.COMPLETED; i.updatedAt = now; if (!i.settledAt) i.settledAt = now; return { ...i, metadata: { ...i.metadata } }; }
export function failShokInvocationV2(id, reason) { const i = _shokIsV2.get(id); if (!i) throw new Error(`shok invocation ${id} not found`); _shokCheckI(i.status, SHOK_INVOCATION_LIFECYCLE_V2.FAILED); const now = Date.now(); i.status = SHOK_INVOCATION_LIFECYCLE_V2.FAILED; i.updatedAt = now; if (!i.settledAt) i.settledAt = now; if (reason) i.metadata.failReason = String(reason); return { ...i, metadata: { ...i.metadata } }; }
export function cancelShokInvocationV2(id, reason) { const i = _shokIsV2.get(id); if (!i) throw new Error(`shok invocation ${id} not found`); _shokCheckI(i.status, SHOK_INVOCATION_LIFECYCLE_V2.CANCELLED); const now = Date.now(); i.status = SHOK_INVOCATION_LIFECYCLE_V2.CANCELLED; i.updatedAt = now; if (!i.settledAt) i.settledAt = now; if (reason) i.metadata.cancelReason = String(reason); return { ...i, metadata: { ...i.metadata } }; }
export function getShokInvocationV2(id) { const i = _shokIsV2.get(id); if (!i) return null; return { ...i, metadata: { ...i.metadata } }; }
export function listShokInvocationsV2() { return [..._shokIsV2.values()].map((i) => ({ ...i, metadata: { ...i.metadata } })); }
export function autoDisableIdleShokProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _shokPsV2.values()) if (p.status === SHOK_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _shokIdleMs) { p.status = SHOK_PROFILE_MATURITY_V2.DISABLED; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckShokInvocationsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const i of _shokIsV2.values()) if (i.status === SHOK_INVOCATION_LIFECYCLE_V2.RUNNING && i.startedAt != null && (t - i.startedAt) >= _shokStuckMs) { i.status = SHOK_INVOCATION_LIFECYCLE_V2.FAILED; i.updatedAt = t; if (!i.settledAt) i.settledAt = t; i.metadata.failReason = "auto-fail-stuck"; flipped.push(i.id); } return { flipped, count: flipped.length }; }
export function getSessionHooksGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(SHOK_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _shokPsV2.values()) profilesByStatus[p.status]++;
  const invocationsByStatus = {}; for (const v of Object.values(SHOK_INVOCATION_LIFECYCLE_V2)) invocationsByStatus[v] = 0; for (const i of _shokIsV2.values()) invocationsByStatus[i.status]++;
  return { totalShokProfilesV2: _shokPsV2.size, totalShokInvocationsV2: _shokIsV2.size, maxActiveShokProfilesPerOwner: _shokMaxActive, maxPendingShokInvocationsPerProfile: _shokMaxPending, shokProfileIdleMs: _shokIdleMs, shokInvocationStuckMs: _shokStuckMs, profilesByStatus, invocationsByStatus };
}
