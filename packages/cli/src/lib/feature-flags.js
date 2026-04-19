export {
  feature,
  featureVariant,
  listFeatures,
  setFeature,
  getFlagInfo,
} from "../harness/feature-flags.js";


// =====================================================================
// Feature Flags V2 governance overlay (in-memory, atop legacy flags)
// =====================================================================
export const FFLAG_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", PAUSED: "paused", ARCHIVED: "archived",
});
export const FFLAG_EVAL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", EVALUATING: "evaluating", EVALUATED: "evaluated", FAILED: "failed", CANCELLED: "cancelled",
});
const _fflagPTrans = new Map([
  [FFLAG_PROFILE_MATURITY_V2.PENDING, new Set([FFLAG_PROFILE_MATURITY_V2.ACTIVE, FFLAG_PROFILE_MATURITY_V2.ARCHIVED])],
  [FFLAG_PROFILE_MATURITY_V2.ACTIVE, new Set([FFLAG_PROFILE_MATURITY_V2.PAUSED, FFLAG_PROFILE_MATURITY_V2.ARCHIVED])],
  [FFLAG_PROFILE_MATURITY_V2.PAUSED, new Set([FFLAG_PROFILE_MATURITY_V2.ACTIVE, FFLAG_PROFILE_MATURITY_V2.ARCHIVED])],
  [FFLAG_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _fflagPTerminal = new Set([FFLAG_PROFILE_MATURITY_V2.ARCHIVED]);
const _fflagETrans = new Map([
  [FFLAG_EVAL_LIFECYCLE_V2.QUEUED, new Set([FFLAG_EVAL_LIFECYCLE_V2.EVALUATING, FFLAG_EVAL_LIFECYCLE_V2.CANCELLED])],
  [FFLAG_EVAL_LIFECYCLE_V2.EVALUATING, new Set([FFLAG_EVAL_LIFECYCLE_V2.EVALUATED, FFLAG_EVAL_LIFECYCLE_V2.FAILED, FFLAG_EVAL_LIFECYCLE_V2.CANCELLED])],
  [FFLAG_EVAL_LIFECYCLE_V2.EVALUATED, new Set()],
  [FFLAG_EVAL_LIFECYCLE_V2.FAILED, new Set()],
  [FFLAG_EVAL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _fflagPsV2 = new Map();
const _fflagEsV2 = new Map();
let _fflagMaxActive = 15, _fflagMaxPending = 30, _fflagIdleMs = 30 * 24 * 60 * 60 * 1000, _fflagStuckMs = 30 * 1000;
function _fflagPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _fflagCheckP(from, to) { const a = _fflagPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid fflag profile transition ${from} → ${to}`); }
function _fflagCheckE(from, to) { const a = _fflagETrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid fflag eval transition ${from} → ${to}`); }
function _fflagCountActive(owner) { let c = 0; for (const p of _fflagPsV2.values()) if (p.owner === owner && p.status === FFLAG_PROFILE_MATURITY_V2.ACTIVE) c++; return c; }
function _fflagCountPending(profileId) { let c = 0; for (const e of _fflagEsV2.values()) if (e.profileId === profileId && (e.status === FFLAG_EVAL_LIFECYCLE_V2.QUEUED || e.status === FFLAG_EVAL_LIFECYCLE_V2.EVALUATING)) c++; return c; }
export function setMaxActiveFflagProfilesPerOwnerV2(n) { _fflagMaxActive = _fflagPos(n, "maxActiveFflagProfilesPerOwner"); }
export function getMaxActiveFflagProfilesPerOwnerV2() { return _fflagMaxActive; }
export function setMaxPendingFflagEvalsPerProfileV2(n) { _fflagMaxPending = _fflagPos(n, "maxPendingFflagEvalsPerProfile"); }
export function getMaxPendingFflagEvalsPerProfileV2() { return _fflagMaxPending; }
export function setFflagProfileIdleMsV2(n) { _fflagIdleMs = _fflagPos(n, "fflagProfileIdleMs"); }
export function getFflagProfileIdleMsV2() { return _fflagIdleMs; }
export function setFflagEvalStuckMsV2(n) { _fflagStuckMs = _fflagPos(n, "fflagEvalStuckMs"); }
export function getFflagEvalStuckMsV2() { return _fflagStuckMs; }
export function _resetStateFeatureFlagsV2() { _fflagPsV2.clear(); _fflagEsV2.clear(); _fflagMaxActive = 15; _fflagMaxPending = 30; _fflagIdleMs = 30 * 24 * 60 * 60 * 1000; _fflagStuckMs = 30 * 1000; }
export function registerFflagProfileV2({ id, owner, scope, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_fflagPsV2.has(id)) throw new Error(`fflag profile ${id} already exists`);
  const now = Date.now();
  const p = { id, owner, scope: scope || "*", status: FFLAG_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, lastTouchedAt: now, activatedAt: null, archivedAt: null, metadata: { ...(metadata || {}) } };
  _fflagPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
export function activateFflagProfileV2(id) {
  const p = _fflagPsV2.get(id); if (!p) throw new Error(`fflag profile ${id} not found`);
  const isInitial = p.status === FFLAG_PROFILE_MATURITY_V2.PENDING;
  _fflagCheckP(p.status, FFLAG_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _fflagCountActive(p.owner) >= _fflagMaxActive) throw new Error(`max active fflag profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = FFLAG_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseFflagProfileV2(id) { const p = _fflagPsV2.get(id); if (!p) throw new Error(`fflag profile ${id} not found`); _fflagCheckP(p.status, FFLAG_PROFILE_MATURITY_V2.PAUSED); p.status = FFLAG_PROFILE_MATURITY_V2.PAUSED; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archiveFflagProfileV2(id) { const p = _fflagPsV2.get(id); if (!p) throw new Error(`fflag profile ${id} not found`); _fflagCheckP(p.status, FFLAG_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = FFLAG_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchFflagProfileV2(id) { const p = _fflagPsV2.get(id); if (!p) throw new Error(`fflag profile ${id} not found`); if (_fflagPTerminal.has(p.status)) throw new Error(`cannot touch terminal fflag profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getFflagProfileV2(id) { const p = _fflagPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listFflagProfilesV2() { return [..._fflagPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
export function createFflagEvalV2({ id, profileId, key, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_fflagEsV2.has(id)) throw new Error(`fflag eval ${id} already exists`);
  if (!_fflagPsV2.has(profileId)) throw new Error(`fflag profile ${profileId} not found`);
  if (_fflagCountPending(profileId) >= _fflagMaxPending) throw new Error(`max pending fflag evals for profile ${profileId} reached`);
  const now = Date.now();
  const e = { id, profileId, key: key || "", status: FFLAG_EVAL_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _fflagEsV2.set(id, e); return { ...e, metadata: { ...e.metadata } };
}
export function evaluatingFflagEvalV2(id) { const e = _fflagEsV2.get(id); if (!e) throw new Error(`fflag eval ${id} not found`); _fflagCheckE(e.status, FFLAG_EVAL_LIFECYCLE_V2.EVALUATING); const now = Date.now(); e.status = FFLAG_EVAL_LIFECYCLE_V2.EVALUATING; e.updatedAt = now; if (!e.startedAt) e.startedAt = now; return { ...e, metadata: { ...e.metadata } }; }
export function evaluateFflagEvalV2(id) { const e = _fflagEsV2.get(id); if (!e) throw new Error(`fflag eval ${id} not found`); _fflagCheckE(e.status, FFLAG_EVAL_LIFECYCLE_V2.EVALUATED); const now = Date.now(); e.status = FFLAG_EVAL_LIFECYCLE_V2.EVALUATED; e.updatedAt = now; if (!e.settledAt) e.settledAt = now; return { ...e, metadata: { ...e.metadata } }; }
export function failFflagEvalV2(id, reason) { const e = _fflagEsV2.get(id); if (!e) throw new Error(`fflag eval ${id} not found`); _fflagCheckE(e.status, FFLAG_EVAL_LIFECYCLE_V2.FAILED); const now = Date.now(); e.status = FFLAG_EVAL_LIFECYCLE_V2.FAILED; e.updatedAt = now; if (!e.settledAt) e.settledAt = now; if (reason) e.metadata.failReason = String(reason); return { ...e, metadata: { ...e.metadata } }; }
export function cancelFflagEvalV2(id, reason) { const e = _fflagEsV2.get(id); if (!e) throw new Error(`fflag eval ${id} not found`); _fflagCheckE(e.status, FFLAG_EVAL_LIFECYCLE_V2.CANCELLED); const now = Date.now(); e.status = FFLAG_EVAL_LIFECYCLE_V2.CANCELLED; e.updatedAt = now; if (!e.settledAt) e.settledAt = now; if (reason) e.metadata.cancelReason = String(reason); return { ...e, metadata: { ...e.metadata } }; }
export function getFflagEvalV2(id) { const e = _fflagEsV2.get(id); if (!e) return null; return { ...e, metadata: { ...e.metadata } }; }
export function listFflagEvalsV2() { return [..._fflagEsV2.values()].map((e) => ({ ...e, metadata: { ...e.metadata } })); }
export function autoPauseIdleFflagProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _fflagPsV2.values()) if (p.status === FFLAG_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _fflagIdleMs) { p.status = FFLAG_PROFILE_MATURITY_V2.PAUSED; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckFflagEvalsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const e of _fflagEsV2.values()) if (e.status === FFLAG_EVAL_LIFECYCLE_V2.EVALUATING && e.startedAt != null && (t - e.startedAt) >= _fflagStuckMs) { e.status = FFLAG_EVAL_LIFECYCLE_V2.FAILED; e.updatedAt = t; if (!e.settledAt) e.settledAt = t; e.metadata.failReason = "auto-fail-stuck"; flipped.push(e.id); } return { flipped, count: flipped.length }; }
export function getFeatureFlagsGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(FFLAG_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _fflagPsV2.values()) profilesByStatus[p.status]++;
  const evalsByStatus = {}; for (const v of Object.values(FFLAG_EVAL_LIFECYCLE_V2)) evalsByStatus[v] = 0; for (const e of _fflagEsV2.values()) evalsByStatus[e.status]++;
  return { totalFflagProfilesV2: _fflagPsV2.size, totalFflagEvalsV2: _fflagEsV2.size, maxActiveFflagProfilesPerOwner: _fflagMaxActive, maxPendingFflagEvalsPerProfile: _fflagMaxPending, fflagProfileIdleMs: _fflagIdleMs, fflagEvalStuckMs: _fflagStuckMs, profilesByStatus, evalsByStatus };
}
