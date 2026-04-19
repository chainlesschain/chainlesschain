/**
 * @deprecated — canonical implementation lives in
 * `../harness/prompt-compressor.js` as of the CLI Runtime Convergence
 * roadmap. This file is retained as a re-export shim for backwards
 * compatibility and will be removed once all external consumers have
 * migrated.
 *
 * Please import from `packages/cli/src/harness/prompt-compressor.js`
 * in new code.
 */

export {
  estimateTokens,
  estimateMessagesTokens,
  CONTEXT_WINDOWS,
  getContextWindow,
  COMPRESSION_VARIANTS,
  getCompressionVariant,
  adaptiveThresholds,
  PromptCompressor,
} from "../harness/prompt-compressor.js";


// =====================================================================
// Prompt Compressor V2 governance overlay
// =====================================================================
export const PCOMP_PROFILE_MATURITY_V2 = Object.freeze({ PENDING: "pending", ACTIVE: "active", STALE: "stale", ARCHIVED: "archived" });
export const PCOMP_RUN_LIFECYCLE_V2 = Object.freeze({ QUEUED: "queued", COMPRESSING: "compressing", COMPRESSED: "compressed", FAILED: "failed", CANCELLED: "cancelled" });
const _pcompPTrans = new Map([
  [PCOMP_PROFILE_MATURITY_V2.PENDING, new Set([PCOMP_PROFILE_MATURITY_V2.ACTIVE, PCOMP_PROFILE_MATURITY_V2.ARCHIVED])],
  [PCOMP_PROFILE_MATURITY_V2.ACTIVE, new Set([PCOMP_PROFILE_MATURITY_V2.STALE, PCOMP_PROFILE_MATURITY_V2.ARCHIVED])],
  [PCOMP_PROFILE_MATURITY_V2.STALE, new Set([PCOMP_PROFILE_MATURITY_V2.ACTIVE, PCOMP_PROFILE_MATURITY_V2.ARCHIVED])],
  [PCOMP_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pcompPTerminal = new Set([PCOMP_PROFILE_MATURITY_V2.ARCHIVED]);
const _pcompRTrans = new Map([
  [PCOMP_RUN_LIFECYCLE_V2.QUEUED, new Set([PCOMP_RUN_LIFECYCLE_V2.COMPRESSING, PCOMP_RUN_LIFECYCLE_V2.CANCELLED])],
  [PCOMP_RUN_LIFECYCLE_V2.COMPRESSING, new Set([PCOMP_RUN_LIFECYCLE_V2.COMPRESSED, PCOMP_RUN_LIFECYCLE_V2.FAILED, PCOMP_RUN_LIFECYCLE_V2.CANCELLED])],
  [PCOMP_RUN_LIFECYCLE_V2.COMPRESSED, new Set()],
  [PCOMP_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [PCOMP_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pcompPsV2 = new Map();
const _pcompRsV2 = new Map();
let _pcompMaxActive = 8, _pcompMaxPending = 20, _pcompIdleMs = 30 * 24 * 60 * 60 * 1000, _pcompStuckMs = 60 * 1000;
function _pcompPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _pcompCheckP(from, to) { const a = _pcompPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid pcomp profile transition ${from} → ${to}`); }
function _pcompCheckR(from, to) { const a = _pcompRTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid pcomp run transition ${from} → ${to}`); }
function _pcompCountActive(owner) { let c = 0; for (const p of _pcompPsV2.values()) if (p.owner === owner && p.status === PCOMP_PROFILE_MATURITY_V2.ACTIVE) c++; return c; }
function _pcompCountPending(profileId) { let c = 0; for (const r of _pcompRsV2.values()) if (r.profileId === profileId && (r.status === PCOMP_RUN_LIFECYCLE_V2.QUEUED || r.status === PCOMP_RUN_LIFECYCLE_V2.COMPRESSING)) c++; return c; }
export function setMaxActivePcompProfilesPerOwnerV2(n) { _pcompMaxActive = _pcompPos(n, "maxActivePcompProfilesPerOwner"); }
export function getMaxActivePcompProfilesPerOwnerV2() { return _pcompMaxActive; }
export function setMaxPendingPcompRunsPerProfileV2(n) { _pcompMaxPending = _pcompPos(n, "maxPendingPcompRunsPerProfile"); }
export function getMaxPendingPcompRunsPerProfileV2() { return _pcompMaxPending; }
export function setPcompProfileIdleMsV2(n) { _pcompIdleMs = _pcompPos(n, "pcompProfileIdleMs"); }
export function getPcompProfileIdleMsV2() { return _pcompIdleMs; }
export function setPcompRunStuckMsV2(n) { _pcompStuckMs = _pcompPos(n, "pcompRunStuckMs"); }
export function getPcompRunStuckMsV2() { return _pcompStuckMs; }
export function _resetStatePromptCompressorV2() { _pcompPsV2.clear(); _pcompRsV2.clear(); _pcompMaxActive = 8; _pcompMaxPending = 20; _pcompIdleMs = 30 * 24 * 60 * 60 * 1000; _pcompStuckMs = 60 * 1000; }
export function registerPcompProfileV2({ id, owner, variant, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pcompPsV2.has(id)) throw new Error(`pcomp profile ${id} already exists`);
  const now = Date.now();
  const p = { id, owner, variant: variant || "default", status: PCOMP_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, lastTouchedAt: now, activatedAt: null, archivedAt: null, metadata: { ...(metadata || {}) } };
  _pcompPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
export function activatePcompProfileV2(id) {
  const p = _pcompPsV2.get(id); if (!p) throw new Error(`pcomp profile ${id} not found`);
  const isInitial = p.status === PCOMP_PROFILE_MATURITY_V2.PENDING;
  _pcompCheckP(p.status, PCOMP_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pcompCountActive(p.owner) >= _pcompMaxActive) throw new Error(`max active pcomp profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = PCOMP_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stalePcompProfileV2(id) { const p = _pcompPsV2.get(id); if (!p) throw new Error(`pcomp profile ${id} not found`); _pcompCheckP(p.status, PCOMP_PROFILE_MATURITY_V2.STALE); p.status = PCOMP_PROFILE_MATURITY_V2.STALE; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archivePcompProfileV2(id) { const p = _pcompPsV2.get(id); if (!p) throw new Error(`pcomp profile ${id} not found`); _pcompCheckP(p.status, PCOMP_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = PCOMP_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchPcompProfileV2(id) { const p = _pcompPsV2.get(id); if (!p) throw new Error(`pcomp profile ${id} not found`); if (_pcompPTerminal.has(p.status)) throw new Error(`cannot touch terminal pcomp profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getPcompProfileV2(id) { const p = _pcompPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listPcompProfilesV2() { return [..._pcompPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
export function createPcompRunV2({ id, profileId, input, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pcompRsV2.has(id)) throw new Error(`pcomp run ${id} already exists`);
  if (!_pcompPsV2.has(profileId)) throw new Error(`pcomp profile ${profileId} not found`);
  if (_pcompCountPending(profileId) >= _pcompMaxPending) throw new Error(`max pending pcomp runs for profile ${profileId} reached`);
  const now = Date.now();
  const r = { id, profileId, input: input || "", status: PCOMP_RUN_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _pcompRsV2.set(id, r); return { ...r, metadata: { ...r.metadata } };
}
export function compressingPcompRunV2(id) { const r = _pcompRsV2.get(id); if (!r) throw new Error(`pcomp run ${id} not found`); _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.COMPRESSING); const now = Date.now(); r.status = PCOMP_RUN_LIFECYCLE_V2.COMPRESSING; r.updatedAt = now; if (!r.startedAt) r.startedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function compressPcompRunV2(id) { const r = _pcompRsV2.get(id); if (!r) throw new Error(`pcomp run ${id} not found`); _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.COMPRESSED); const now = Date.now(); r.status = PCOMP_RUN_LIFECYCLE_V2.COMPRESSED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function failPcompRunV2(id, reason) { const r = _pcompRsV2.get(id); if (!r) throw new Error(`pcomp run ${id} not found`); _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.FAILED); const now = Date.now(); r.status = PCOMP_RUN_LIFECYCLE_V2.FAILED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; if (reason) r.metadata.failReason = String(reason); return { ...r, metadata: { ...r.metadata } }; }
export function cancelPcompRunV2(id, reason) { const r = _pcompRsV2.get(id); if (!r) throw new Error(`pcomp run ${id} not found`); _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.CANCELLED); const now = Date.now(); r.status = PCOMP_RUN_LIFECYCLE_V2.CANCELLED; r.updatedAt = now; if (!r.settledAt) r.settledAt = now; if (reason) r.metadata.cancelReason = String(reason); return { ...r, metadata: { ...r.metadata } }; }
export function getPcompRunV2(id) { const r = _pcompRsV2.get(id); if (!r) return null; return { ...r, metadata: { ...r.metadata } }; }
export function listPcompRunsV2() { return [..._pcompRsV2.values()].map((r) => ({ ...r, metadata: { ...r.metadata } })); }
export function autoStaleIdlePcompProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _pcompPsV2.values()) if (p.status === PCOMP_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _pcompIdleMs) { p.status = PCOMP_PROFILE_MATURITY_V2.STALE; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckPcompRunsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const r of _pcompRsV2.values()) if (r.status === PCOMP_RUN_LIFECYCLE_V2.COMPRESSING && r.startedAt != null && (t - r.startedAt) >= _pcompStuckMs) { r.status = PCOMP_RUN_LIFECYCLE_V2.FAILED; r.updatedAt = t; if (!r.settledAt) r.settledAt = t; r.metadata.failReason = "auto-fail-stuck"; flipped.push(r.id); } return { flipped, count: flipped.length }; }
export function getPromptCompressorGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(PCOMP_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _pcompPsV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {}; for (const v of Object.values(PCOMP_RUN_LIFECYCLE_V2)) runsByStatus[v] = 0; for (const r of _pcompRsV2.values()) runsByStatus[r.status]++;
  return { totalPcompProfilesV2: _pcompPsV2.size, totalPcompRunsV2: _pcompRsV2.size, maxActivePcompProfilesPerOwner: _pcompMaxActive, maxPendingPcompRunsPerProfile: _pcompMaxPending, pcompProfileIdleMs: _pcompIdleMs, pcompRunStuckMs: _pcompStuckMs, profilesByStatus, runsByStatus };
}
