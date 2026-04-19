/**
 * Session usage aggregation — Phase I of Managed Agents parity plan.
 *
 * Scans JSONL session events for token usage (emitted either as explicit
 * `token_usage` events or embedded under `event.data.usage` on
 * `assistant_message` / `llm_call` events) and produces roll-ups by model.
 *
 * Purely functional aggregation + file-reading helpers. No state.
 */

import {
  readEvents,
  listJsonlSessions,
} from "../harness/jsonl-session-store.js";

const USAGE_EVENT_TYPES = new Set([
  "token_usage",
  "assistant_message",
  "llm_call",
  "llm_response",
]);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract a normalized usage record from a single event, or null if none.
 * Accepts both snake_case (OpenAI/Anthropic) and camelCase variants.
 */
export function extractUsage(event) {
  if (!event || typeof event !== "object") return null;
  if (!USAGE_EVENT_TYPES.has(event.type)) return null;

  const d = event.data || {};
  const raw =
    event.type === "token_usage"
      ? d.usage || d
      : d.usage || d.tokenUsage || null;
  if (!raw || typeof raw !== "object") return null;

  const inputTokens = toNumber(
    raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens ?? 0,
  );
  const outputTokens = toNumber(
    raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens ?? 0,
  );
  const totalTokens = toNumber(
    raw.total_tokens ?? raw.totalTokens ?? inputTokens + outputTokens,
  );

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    provider: d.provider || raw.provider || null,
    model: d.model || raw.model || null,
    inputTokens,
    outputTokens,
    totalTokens,
    timestamp: event.timestamp || null,
  };
}

/**
 * Aggregate a list of events into { total, byModel[] }.
 */
export function aggregateUsage(events) {
  const byKey = new Map();
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
  };

  for (const evt of events || []) {
    const u = extractUsage(evt);
    if (!u) continue;

    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.totalTokens += u.totalTokens;
    total.calls += 1;

    const key = `${u.provider || "?"}/${u.model || "?"}`;
    const entry = byKey.get(key) || {
      provider: u.provider,
      model: u.model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
    };
    entry.inputTokens += u.inputTokens;
    entry.outputTokens += u.outputTokens;
    entry.totalTokens += u.totalTokens;
    entry.calls += 1;
    byKey.set(key, entry);
  }

  return {
    total,
    byModel: Array.from(byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
  };
}

/**
 * Roll up usage for a single JSONL session.
 */
export function sessionUsage(sessionId) {
  const events = readEvents(sessionId);
  const agg = aggregateUsage(events);
  return { sessionId, ...agg };
}

/**
 * Roll up usage across every JSONL session on disk.
 */
export function allSessionsUsage({ limit = 1000 } = {}) {
  const sessions = listJsonlSessions({ limit });
  const perSession = sessions.map((s) => sessionUsage(s.id));

  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
  };
  const byKey = new Map();

  for (const s of perSession) {
    total.inputTokens += s.total.inputTokens;
    total.outputTokens += s.total.outputTokens;
    total.totalTokens += s.total.totalTokens;
    total.calls += s.total.calls;
    for (const row of s.byModel) {
      const key = `${row.provider || "?"}/${row.model || "?"}`;
      const entry = byKey.get(key) || {
        provider: row.provider,
        model: row.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0,
      };
      entry.inputTokens += row.inputTokens;
      entry.outputTokens += row.outputTokens;
      entry.totalTokens += row.totalTokens;
      entry.calls += row.calls;
      byKey.set(key, entry);
    }
  }

  return {
    sessions: perSession,
    total,
    byModel: Array.from(byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
  };
}

// ===== V2 Surface: Session Usage governance overlay (CLI v0.142.0) =====
export const SUSE_BUDGET_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", EXHAUSTED: "exhausted", ARCHIVED: "archived",
});
export const SUSE_RECORD_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", RECORDING: "recording", RECORDED: "recorded", REJECTED: "rejected", CANCELLED: "cancelled",
});
const _suseBTrans = new Map([
  [SUSE_BUDGET_MATURITY_V2.PENDING, new Set([SUSE_BUDGET_MATURITY_V2.ACTIVE, SUSE_BUDGET_MATURITY_V2.ARCHIVED])],
  [SUSE_BUDGET_MATURITY_V2.ACTIVE, new Set([SUSE_BUDGET_MATURITY_V2.EXHAUSTED, SUSE_BUDGET_MATURITY_V2.ARCHIVED])],
  [SUSE_BUDGET_MATURITY_V2.EXHAUSTED, new Set([SUSE_BUDGET_MATURITY_V2.ACTIVE, SUSE_BUDGET_MATURITY_V2.ARCHIVED])],
  [SUSE_BUDGET_MATURITY_V2.ARCHIVED, new Set()],
]);
const _suseBTerminal = new Set([SUSE_BUDGET_MATURITY_V2.ARCHIVED]);
const _suseRTrans = new Map([
  [SUSE_RECORD_LIFECYCLE_V2.QUEUED, new Set([SUSE_RECORD_LIFECYCLE_V2.RECORDING, SUSE_RECORD_LIFECYCLE_V2.CANCELLED])],
  [SUSE_RECORD_LIFECYCLE_V2.RECORDING, new Set([SUSE_RECORD_LIFECYCLE_V2.RECORDED, SUSE_RECORD_LIFECYCLE_V2.REJECTED, SUSE_RECORD_LIFECYCLE_V2.CANCELLED])],
  [SUSE_RECORD_LIFECYCLE_V2.RECORDED, new Set()],
  [SUSE_RECORD_LIFECYCLE_V2.REJECTED, new Set()],
  [SUSE_RECORD_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _suseBsV2 = new Map();
const _suseRsV2 = new Map();
let _suseMaxActive = 5, _suseMaxPending = 50, _suseIdleMs = 30 * 24 * 60 * 60 * 1000, _suseStuckMs = 30 * 1000;
function _susePos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _suseCheckB(from, to) { const a = _suseBTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid suse budget transition ${from} → ${to}`); }
function _suseCheckR(from, to) { const a = _suseRTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid suse record transition ${from} → ${to}`); }
export function setMaxActiveSuseBudgetsPerOwnerV2(n) { _suseMaxActive = _susePos(n, "maxActiveSuseBudgetsPerOwner"); }
export function getMaxActiveSuseBudgetsPerOwnerV2() { return _suseMaxActive; }
export function setMaxPendingSuseRecordsPerBudgetV2(n) { _suseMaxPending = _susePos(n, "maxPendingSuseRecordsPerBudget"); }
export function getMaxPendingSuseRecordsPerBudgetV2() { return _suseMaxPending; }
export function setSuseBudgetIdleMsV2(n) { _suseIdleMs = _susePos(n, "suseBudgetIdleMs"); }
export function getSuseBudgetIdleMsV2() { return _suseIdleMs; }
export function setSuseRecordStuckMsV2(n) { _suseStuckMs = _susePos(n, "suseRecordStuckMs"); }
export function getSuseRecordStuckMsV2() { return _suseStuckMs; }
export function _resetStateSessionUsageV2() { _suseBsV2.clear(); _suseRsV2.clear(); _suseMaxActive = 5; _suseMaxPending = 50; _suseIdleMs = 30 * 24 * 60 * 60 * 1000; _suseStuckMs = 30 * 1000; }
export function registerSuseBudgetV2({ id, owner, limit, metadata } = {}) {
  if (!id) throw new Error("suse budget id required"); if (!owner) throw new Error("suse budget owner required");
  if (_suseBsV2.has(id)) throw new Error(`suse budget ${id} already registered`);
  const now = Date.now();
  const lim = limit == null ? 1000 : Math.max(1, Math.floor(Number(limit)) || 1);
  const b = { id, owner, limit: lim, status: SUSE_BUDGET_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, archivedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _suseBsV2.set(id, b); return { ...b, metadata: { ...b.metadata } };
}
function _suseCountActive(owner) { let n = 0; for (const b of _suseBsV2.values()) if (b.owner === owner && b.status === SUSE_BUDGET_MATURITY_V2.ACTIVE) n++; return n; }
export function activateSuseBudgetV2(id) {
  const b = _suseBsV2.get(id); if (!b) throw new Error(`suse budget ${id} not found`);
  _suseCheckB(b.status, SUSE_BUDGET_MATURITY_V2.ACTIVE);
  const recovery = b.status === SUSE_BUDGET_MATURITY_V2.EXHAUSTED;
  if (!recovery && _suseCountActive(b.owner) >= _suseMaxActive) throw new Error(`max active suse budgets for owner ${b.owner} reached`);
  const now = Date.now(); b.status = SUSE_BUDGET_MATURITY_V2.ACTIVE; b.updatedAt = now; b.lastTouchedAt = now; if (!b.activatedAt) b.activatedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function exhaustSuseBudgetV2(id) { const b = _suseBsV2.get(id); if (!b) throw new Error(`suse budget ${id} not found`); _suseCheckB(b.status, SUSE_BUDGET_MATURITY_V2.EXHAUSTED); b.status = SUSE_BUDGET_MATURITY_V2.EXHAUSTED; b.updatedAt = Date.now(); return { ...b, metadata: { ...b.metadata } }; }
export function archiveSuseBudgetV2(id) { const b = _suseBsV2.get(id); if (!b) throw new Error(`suse budget ${id} not found`); _suseCheckB(b.status, SUSE_BUDGET_MATURITY_V2.ARCHIVED); const now = Date.now(); b.status = SUSE_BUDGET_MATURITY_V2.ARCHIVED; b.updatedAt = now; if (!b.archivedAt) b.archivedAt = now; return { ...b, metadata: { ...b.metadata } }; }
export function touchSuseBudgetV2(id) { const b = _suseBsV2.get(id); if (!b) throw new Error(`suse budget ${id} not found`); if (_suseBTerminal.has(b.status)) throw new Error(`cannot touch terminal suse budget ${id}`); const now = Date.now(); b.lastTouchedAt = now; b.updatedAt = now; return { ...b, metadata: { ...b.metadata } }; }
export function getSuseBudgetV2(id) { const b = _suseBsV2.get(id); if (!b) return null; return { ...b, metadata: { ...b.metadata } }; }
export function listSuseBudgetsV2() { return [..._suseBsV2.values()].map((b) => ({ ...b, metadata: { ...b.metadata } })); }
function _suseCountPending(budgetId) { let n = 0; for (const r of _suseRsV2.values()) if (r.budgetId === budgetId && (r.status === SUSE_RECORD_LIFECYCLE_V2.QUEUED || r.status === SUSE_RECORD_LIFECYCLE_V2.RECORDING)) n++; return n; }
export function createSuseRecordV2({ id, budgetId, amount, metadata } = {}) {
  if (!id) throw new Error("suse record id required"); if (!budgetId) throw new Error("suse record budgetId required");
  if (_suseRsV2.has(id)) throw new Error(`suse record ${id} already exists`);
  if (!_suseBsV2.has(budgetId)) throw new Error(`suse budget ${budgetId} not found`);
  if (_suseCountPending(budgetId) >= _suseMaxPending) throw new Error(`max pending suse records for budget ${budgetId} reached`);
  const now = Date.now();
  const amt = amount == null ? 0 : Math.max(0, Number(amount) || 0);
  const r = { id, budgetId, amount: amt, status: SUSE_RECORD_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _suseRsV2.set(id, r); return { ...r, metadata: { ...r.metadata } };
}
export function recordingSuseRecordV2(id) { const r = _suseRsV2.get(id); if (!r) throw new Error(`suse record ${id} not found`); _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.RECORDING); const now = Date.now(); r.status = SUSE_RECORD_LIFECYCLE_V2.RECORDING; r.updatedAt = now; if (!r.startedAt) r.startedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function recordSuseRecordV2(id) { const r = _suseRsV2.get(id); if (!r) throw new Error(`suse record ${id} not found`); _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.RECORDED); const now = Date.now(); r.status = SUSE_RECORD_LIFECYCLE_V2.RECORDED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function rejectSuseRecordV2(id, reason) { const r = _suseRsV2.get(id); if (!r) throw new Error(`suse record ${id} not found`); _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.REJECTED); const now = Date.now(); r.status = SUSE_RECORD_LIFECYCLE_V2.REJECTED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; if (reason) r.metadata.rejectReason = String(reason); return { ...r, metadata: { ...r.metadata } }; }
export function cancelSuseRecordV2(id, reason) { const r = _suseRsV2.get(id); if (!r) throw new Error(`suse record ${id} not found`); _suseCheckR(r.status, SUSE_RECORD_LIFECYCLE_V2.CANCELLED); const now = Date.now(); r.status = SUSE_RECORD_LIFECYCLE_V2.CANCELLED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; if (reason) r.metadata.cancelReason = String(reason); return { ...r, metadata: { ...r.metadata } }; }
export function getSuseRecordV2(id) { const r = _suseRsV2.get(id); if (!r) return null; return { ...r, metadata: { ...r.metadata } }; }
export function listSuseRecordsV2() { return [..._suseRsV2.values()].map((r) => ({ ...r, metadata: { ...r.metadata } })); }
export function autoExhaustIdleSuseBudgetsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const b of _suseBsV2.values()) if (b.status === SUSE_BUDGET_MATURITY_V2.ACTIVE && (t - b.lastTouchedAt) >= _suseIdleMs) { b.status = SUSE_BUDGET_MATURITY_V2.EXHAUSTED; b.updatedAt = t; flipped.push(b.id); } return { flipped, count: flipped.length }; }
export function autoRejectStuckSuseRecordsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const r of _suseRsV2.values()) if (r.status === SUSE_RECORD_LIFECYCLE_V2.RECORDING && r.startedAt != null && (t - r.startedAt) >= _suseStuckMs) { r.status = SUSE_RECORD_LIFECYCLE_V2.REJECTED; r.updatedAt = t; if (!r.settledAt) r.settledAt = t; r.metadata.rejectReason = "auto-reject-stuck"; flipped.push(r.id); } return { flipped, count: flipped.length }; }
export function getSessionUsageGovStatsV2() {
  const budgetsByStatus = {}; for (const v of Object.values(SUSE_BUDGET_MATURITY_V2)) budgetsByStatus[v] = 0; for (const b of _suseBsV2.values()) budgetsByStatus[b.status]++;
  const recordsByStatus = {}; for (const v of Object.values(SUSE_RECORD_LIFECYCLE_V2)) recordsByStatus[v] = 0; for (const r of _suseRsV2.values()) recordsByStatus[r.status]++;
  return { totalSuseBudgetsV2: _suseBsV2.size, totalSuseRecordsV2: _suseRsV2.size, maxActiveSuseBudgetsPerOwner: _suseMaxActive, maxPendingSuseRecordsPerBudget: _suseMaxPending, suseBudgetIdleMs: _suseIdleMs, suseRecordStuckMs: _suseStuckMs, budgetsByStatus, recordsByStatus };
}
