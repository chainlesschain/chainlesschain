/**
 * memory-injection — recall top-K session-core memories and format them as a
 * system-prompt block for agent-repl / chat-repl startup.
 *
 * Managed Agents parity Phase G item #5: new sessions automatically surface
 * relevant global/agent-scoped memory so the assistant has continuity across
 * runs.
 *
 * Design:
 * - Pull from global scope + (optionally) the session's agent scope.
 * - Deduplicate by memory id, sort by relevance/score, cap at `limit`.
 * - Return `null` when nothing useful was found so callers can skip the
 *   extra system message entirely.
 * - Pure formatting — caller decides where to splice it into `messages`.
 */

import { getMemoryStore } from "./session-core-singletons.js";

const DEFAULT_LIMIT = 8;
const DEFAULT_CONTENT_CHARS = 280;

export function recallStartupMemories({
  agentId = null,
  query = "",
  limit = DEFAULT_LIMIT,
  memoryStore = null,
} = {}) {
  const store = memoryStore || getMemoryStore();
  if (!store || typeof store.recall !== "function") return [];

  const pools = [];
  try {
    pools.push(store.recall({ scope: "global", query, limit }) || []);
  } catch (_e) {
    /* ignore — missing scope is not fatal */
  }
  if (agentId) {
    try {
      pools.push(
        store.recall({ scope: "agent", scopeId: agentId, query, limit }) || [],
      );
    } catch (_e) {
      /* ignore */
    }
  }

  const seen = new Set();
  const merged = [];
  for (const pool of pools) {
    for (const m of pool) {
      if (!m || !m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
  }

  merged.sort((a, b) => {
    const ra = Number(a.relevance ?? a.score ?? 0);
    const rb = Number(b.relevance ?? b.score ?? 0);
    return rb - ra;
  });

  return merged.slice(0, limit);
}

export function formatMemoriesAsSystemPrompt(memories, { headline } = {}) {
  if (!Array.isArray(memories) || memories.length === 0) return null;

  const title =
    headline || "Relevant memory from prior sessions (recall — do not echo):";
  const lines = [title];
  for (const m of memories) {
    const scope = m.scope || "global";
    const scopeTag = m.scopeId
      ? `${scope}:${String(m.scopeId).slice(0, 12)}`
      : scope;
    const cat = m.category ? `[${m.category}] ` : "";
    const body = String(m.content || "").slice(0, DEFAULT_CONTENT_CHARS);
    lines.push(`- (${scopeTag}) ${cat}${body}`);
  }
  return lines.join("\n");
}

export function buildMemoryInjection(options = {}) {
  const memories = recallStartupMemories(options);
  const content = formatMemoriesAsSystemPrompt(memories, {
    headline: options.headline,
  });
  return content ? { role: "system", content, count: memories.length } : null;
}

// ===== V2 Surface: Memory Injection governance overlay (CLI v0.142.0) =====
export const MINJ_RULE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", PAUSED: "paused", ARCHIVED: "archived",
});
export const MINJ_INJECTION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", INJECTING: "injecting", APPLIED: "applied", FAILED: "failed", CANCELLED: "cancelled",
});
const _minjRTrans = new Map([
  [MINJ_RULE_MATURITY_V2.PENDING, new Set([MINJ_RULE_MATURITY_V2.ACTIVE, MINJ_RULE_MATURITY_V2.ARCHIVED])],
  [MINJ_RULE_MATURITY_V2.ACTIVE, new Set([MINJ_RULE_MATURITY_V2.PAUSED, MINJ_RULE_MATURITY_V2.ARCHIVED])],
  [MINJ_RULE_MATURITY_V2.PAUSED, new Set([MINJ_RULE_MATURITY_V2.ACTIVE, MINJ_RULE_MATURITY_V2.ARCHIVED])],
  [MINJ_RULE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _minjRTerminal = new Set([MINJ_RULE_MATURITY_V2.ARCHIVED]);
const _minjITrans = new Map([
  [MINJ_INJECTION_LIFECYCLE_V2.QUEUED, new Set([MINJ_INJECTION_LIFECYCLE_V2.INJECTING, MINJ_INJECTION_LIFECYCLE_V2.CANCELLED])],
  [MINJ_INJECTION_LIFECYCLE_V2.INJECTING, new Set([MINJ_INJECTION_LIFECYCLE_V2.APPLIED, MINJ_INJECTION_LIFECYCLE_V2.FAILED, MINJ_INJECTION_LIFECYCLE_V2.CANCELLED])],
  [MINJ_INJECTION_LIFECYCLE_V2.APPLIED, new Set()],
  [MINJ_INJECTION_LIFECYCLE_V2.FAILED, new Set()],
  [MINJ_INJECTION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _minjRsV2 = new Map();
const _minjIsV2 = new Map();
let _minjMaxActive = 10, _minjMaxPending = 25, _minjIdleMs = 30 * 24 * 60 * 60 * 1000, _minjStuckMs = 30 * 1000;
function _minjPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _minjCheckR(from, to) { const a = _minjRTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid minj rule transition ${from} → ${to}`); }
function _minjCheckI(from, to) { const a = _minjITrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid minj injection transition ${from} → ${to}`); }
export function setMaxActiveMinjRulesPerOwnerV2(n) { _minjMaxActive = _minjPos(n, "maxActiveMinjRulesPerOwner"); }
export function getMaxActiveMinjRulesPerOwnerV2() { return _minjMaxActive; }
export function setMaxPendingMinjInjectionsPerRuleV2(n) { _minjMaxPending = _minjPos(n, "maxPendingMinjInjectionsPerRule"); }
export function getMaxPendingMinjInjectionsPerRuleV2() { return _minjMaxPending; }
export function setMinjRuleIdleMsV2(n) { _minjIdleMs = _minjPos(n, "minjRuleIdleMs"); }
export function getMinjRuleIdleMsV2() { return _minjIdleMs; }
export function setMinjInjectionStuckMsV2(n) { _minjStuckMs = _minjPos(n, "minjInjectionStuckMs"); }
export function getMinjInjectionStuckMsV2() { return _minjStuckMs; }
export function _resetStateMemoryInjectionV2() { _minjRsV2.clear(); _minjIsV2.clear(); _minjMaxActive = 10; _minjMaxPending = 25; _minjIdleMs = 30 * 24 * 60 * 60 * 1000; _minjStuckMs = 30 * 1000; }
export function registerMinjRuleV2({ id, owner, scope, metadata } = {}) {
  if (!id) throw new Error("minj rule id required"); if (!owner) throw new Error("minj rule owner required");
  if (_minjRsV2.has(id)) throw new Error(`minj rule ${id} already registered`);
  const now = Date.now();
  const r = { id, owner, scope: scope || "*", status: MINJ_RULE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, archivedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _minjRsV2.set(id, r); return { ...r, metadata: { ...r.metadata } };
}
function _minjCountActive(owner) { let n = 0; for (const r of _minjRsV2.values()) if (r.owner === owner && r.status === MINJ_RULE_MATURITY_V2.ACTIVE) n++; return n; }
export function activateMinjRuleV2(id) {
  const r = _minjRsV2.get(id); if (!r) throw new Error(`minj rule ${id} not found`);
  _minjCheckR(r.status, MINJ_RULE_MATURITY_V2.ACTIVE);
  const recovery = r.status === MINJ_RULE_MATURITY_V2.PAUSED;
  if (!recovery && _minjCountActive(r.owner) >= _minjMaxActive) throw new Error(`max active minj rules for owner ${r.owner} reached`);
  const now = Date.now(); r.status = MINJ_RULE_MATURITY_V2.ACTIVE; r.updatedAt = now; r.lastTouchedAt = now; if (!r.activatedAt) r.activatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function pauseMinjRuleV2(id) { const r = _minjRsV2.get(id); if (!r) throw new Error(`minj rule ${id} not found`); _minjCheckR(r.status, MINJ_RULE_MATURITY_V2.PAUSED); r.status = MINJ_RULE_MATURITY_V2.PAUSED; r.updatedAt = Date.now(); return { ...r, metadata: { ...r.metadata } }; }
export function archiveMinjRuleV2(id) { const r = _minjRsV2.get(id); if (!r) throw new Error(`minj rule ${id} not found`); _minjCheckR(r.status, MINJ_RULE_MATURITY_V2.ARCHIVED); const now = Date.now(); r.status = MINJ_RULE_MATURITY_V2.ARCHIVED; r.updatedAt = now; if (!r.archivedAt) r.archivedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function touchMinjRuleV2(id) { const r = _minjRsV2.get(id); if (!r) throw new Error(`minj rule ${id} not found`); if (_minjRTerminal.has(r.status)) throw new Error(`cannot touch terminal minj rule ${id}`); const now = Date.now(); r.lastTouchedAt = now; r.updatedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function getMinjRuleV2(id) { const r = _minjRsV2.get(id); if (!r) return null; return { ...r, metadata: { ...r.metadata } }; }
export function listMinjRulesV2() { return [..._minjRsV2.values()].map((r) => ({ ...r, metadata: { ...r.metadata } })); }
function _minjCountPending(ruleId) { let n = 0; for (const i of _minjIsV2.values()) if (i.ruleId === ruleId && (i.status === MINJ_INJECTION_LIFECYCLE_V2.QUEUED || i.status === MINJ_INJECTION_LIFECYCLE_V2.INJECTING)) n++; return n; }
export function createMinjInjectionV2({ id, ruleId, payload, metadata } = {}) {
  if (!id) throw new Error("minj injection id required"); if (!ruleId) throw new Error("minj injection ruleId required");
  if (_minjIsV2.has(id)) throw new Error(`minj injection ${id} already exists`);
  if (!_minjRsV2.has(ruleId)) throw new Error(`minj rule ${ruleId} not found`);
  if (_minjCountPending(ruleId) >= _minjMaxPending) throw new Error(`max pending minj injections for rule ${ruleId} reached`);
  const now = Date.now();
  const i = { id, ruleId, payload: payload || "", status: MINJ_INJECTION_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _minjIsV2.set(id, i); return { ...i, metadata: { ...i.metadata } };
}
export function injectingMinjInjectionV2(id) { const i = _minjIsV2.get(id); if (!i) throw new Error(`minj injection ${id} not found`); _minjCheckI(i.status, MINJ_INJECTION_LIFECYCLE_V2.INJECTING); const now = Date.now(); i.status = MINJ_INJECTION_LIFECYCLE_V2.INJECTING; i.updatedAt = now; if (!i.startedAt) i.startedAt = now; return { ...i, metadata: { ...i.metadata } }; }
export function applyMinjInjectionV2(id) { const i = _minjIsV2.get(id); if (!i) throw new Error(`minj injection ${id} not found`); _minjCheckI(i.status, MINJ_INJECTION_LIFECYCLE_V2.APPLIED); const now = Date.now(); i.status = MINJ_INJECTION_LIFECYCLE_V2.APPLIED; i.updatedAt = now; if (!i.settledAt) i.settledAt = now; return { ...i, metadata: { ...i.metadata } }; }
export function failMinjInjectionV2(id, reason) { const i = _minjIsV2.get(id); if (!i) throw new Error(`minj injection ${id} not found`); _minjCheckI(i.status, MINJ_INJECTION_LIFECYCLE_V2.FAILED); const now = Date.now(); i.status = MINJ_INJECTION_LIFECYCLE_V2.FAILED; i.updatedAt = now; if (!i.settledAt) i.settledAt = now; if (reason) i.metadata.failReason = String(reason); return { ...i, metadata: { ...i.metadata } }; }
export function cancelMinjInjectionV2(id, reason) { const i = _minjIsV2.get(id); if (!i) throw new Error(`minj injection ${id} not found`); _minjCheckI(i.status, MINJ_INJECTION_LIFECYCLE_V2.CANCELLED); const now = Date.now(); i.status = MINJ_INJECTION_LIFECYCLE_V2.CANCELLED; i.updatedAt = now; if (!i.settledAt) i.settledAt = now; if (reason) i.metadata.cancelReason = String(reason); return { ...i, metadata: { ...i.metadata } }; }
export function getMinjInjectionV2(id) { const i = _minjIsV2.get(id); if (!i) return null; return { ...i, metadata: { ...i.metadata } }; }
export function listMinjInjectionsV2() { return [..._minjIsV2.values()].map((i) => ({ ...i, metadata: { ...i.metadata } })); }
export function autoPauseIdleMinjRulesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const r of _minjRsV2.values()) if (r.status === MINJ_RULE_MATURITY_V2.ACTIVE && (t - r.lastTouchedAt) >= _minjIdleMs) { r.status = MINJ_RULE_MATURITY_V2.PAUSED; r.updatedAt = t; flipped.push(r.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckMinjInjectionsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const i of _minjIsV2.values()) if (i.status === MINJ_INJECTION_LIFECYCLE_V2.INJECTING && i.startedAt != null && (t - i.startedAt) >= _minjStuckMs) { i.status = MINJ_INJECTION_LIFECYCLE_V2.FAILED; i.updatedAt = t; if (!i.settledAt) i.settledAt = t; i.metadata.failReason = "auto-fail-stuck"; flipped.push(i.id); } return { flipped, count: flipped.length }; }
export function getMemoryInjectionGovStatsV2() {
  const rulesByStatus = {}; for (const v of Object.values(MINJ_RULE_MATURITY_V2)) rulesByStatus[v] = 0; for (const r of _minjRsV2.values()) rulesByStatus[r.status]++;
  const injectionsByStatus = {}; for (const v of Object.values(MINJ_INJECTION_LIFECYCLE_V2)) injectionsByStatus[v] = 0; for (const i of _minjIsV2.values()) injectionsByStatus[i.status]++;
  return { totalMinjRulesV2: _minjRsV2.size, totalMinjInjectionsV2: _minjIsV2.size, maxActiveMinjRulesPerOwner: _minjMaxActive, maxPendingMinjInjectionsPerRule: _minjMaxPending, minjRuleIdleMs: _minjIdleMs, minjInjectionStuckMs: _minjStuckMs, rulesByStatus, injectionsByStatus };
}
