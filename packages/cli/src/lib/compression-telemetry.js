export {
  recordCompressionMetric,
  getCompressionTelemetrySummary,
  resetCompressionTelemetry,
} from "../harness/compression-telemetry.js";


// =====================================================================
// Compression Telemetry V2 governance overlay
// =====================================================================
export const COMPT_PROFILE_MATURITY_V2 = Object.freeze({ PENDING: "pending", ACTIVE: "active", STALE: "stale", ARCHIVED: "archived" });
export const COMPT_SAMPLE_LIFECYCLE_V2 = Object.freeze({ QUEUED: "queued", RECORDING: "recording", RECORDED: "recorded", FAILED: "failed", CANCELLED: "cancelled" });
const _comptPTrans = new Map([
  [COMPT_PROFILE_MATURITY_V2.PENDING, new Set([COMPT_PROFILE_MATURITY_V2.ACTIVE, COMPT_PROFILE_MATURITY_V2.ARCHIVED])],
  [COMPT_PROFILE_MATURITY_V2.ACTIVE, new Set([COMPT_PROFILE_MATURITY_V2.STALE, COMPT_PROFILE_MATURITY_V2.ARCHIVED])],
  [COMPT_PROFILE_MATURITY_V2.STALE, new Set([COMPT_PROFILE_MATURITY_V2.ACTIVE, COMPT_PROFILE_MATURITY_V2.ARCHIVED])],
  [COMPT_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _comptPTerminal = new Set([COMPT_PROFILE_MATURITY_V2.ARCHIVED]);
const _comptJTrans = new Map([
  [COMPT_SAMPLE_LIFECYCLE_V2.QUEUED, new Set([COMPT_SAMPLE_LIFECYCLE_V2.RECORDING, COMPT_SAMPLE_LIFECYCLE_V2.CANCELLED])],
  [COMPT_SAMPLE_LIFECYCLE_V2.RECORDING, new Set([COMPT_SAMPLE_LIFECYCLE_V2.RECORDED, COMPT_SAMPLE_LIFECYCLE_V2.FAILED, COMPT_SAMPLE_LIFECYCLE_V2.CANCELLED])],
  [COMPT_SAMPLE_LIFECYCLE_V2.RECORDED, new Set()],
  [COMPT_SAMPLE_LIFECYCLE_V2.FAILED, new Set()],
  [COMPT_SAMPLE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _comptPsV2 = new Map();
const _comptJsV2 = new Map();
let _comptMaxActive = 10, _comptMaxPending = 30, _comptIdleMs = 30 * 24 * 60 * 60 * 1000, _comptStuckMs = 30 * 1000;
function _comptPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _comptCheckP(from, to) { const a = _comptPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid compt profile transition ${from} → ${to}`); }
function _comptCheckJ(from, to) { const a = _comptJTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid compt sample transition ${from} → ${to}`); }
function _comptCountActive(owner) { let c = 0; for (const p of _comptPsV2.values()) if (p.owner === owner && p.status === COMPT_PROFILE_MATURITY_V2.ACTIVE) c++; return c; }
function _comptCountPending(profileId) { let c = 0; for (const j of _comptJsV2.values()) if (j.profileId === profileId && (j.status === COMPT_SAMPLE_LIFECYCLE_V2.QUEUED || j.status === COMPT_SAMPLE_LIFECYCLE_V2.RECORDING)) c++; return c; }
export function setMaxActiveComptProfilesPerOwnerV2(n) { _comptMaxActive = _comptPos(n, "maxActiveComptProfilesPerOwner"); }
export function getMaxActiveComptProfilesPerOwnerV2() { return _comptMaxActive; }
export function setMaxPendingComptSamplesPerProfileV2(n) { _comptMaxPending = _comptPos(n, "maxPendingComptSamplesPerProfile"); }
export function getMaxPendingComptSamplesPerProfileV2() { return _comptMaxPending; }
export function setComptProfileIdleMsV2(n) { _comptIdleMs = _comptPos(n, "comptProfileIdleMs"); }
export function getComptProfileIdleMsV2() { return _comptIdleMs; }
export function setComptSampleStuckMsV2(n) { _comptStuckMs = _comptPos(n, "comptSampleStuckMs"); }
export function getComptSampleStuckMsV2() { return _comptStuckMs; }
export function _resetStateCompressionTelemetryV2() { _comptPsV2.clear(); _comptJsV2.clear(); _comptMaxActive = 10; _comptMaxPending = 30; _comptIdleMs = 30 * 24 * 60 * 60 * 1000; _comptStuckMs = 30 * 1000; }
export function registerComptProfileV2({ id, owner, kind, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_comptPsV2.has(id)) throw new Error(`compt profile ${id} already exists`);
  const now = Date.now();
  const p = { id, owner, kind: kind || "default", status: COMPT_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, lastTouchedAt: now, activatedAt: null, archivedAt: null, metadata: { ...(metadata || {}) } };
  _comptPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
export function activateComptProfileV2(id) {
  const p = _comptPsV2.get(id); if (!p) throw new Error(`compt profile ${id} not found`);
  const isInitial = p.status === COMPT_PROFILE_MATURITY_V2.PENDING;
  _comptCheckP(p.status, COMPT_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _comptCountActive(p.owner) >= _comptMaxActive) throw new Error(`max active compt profiles for owner ${p.owner} reached`);
  const now = Date.now(); p.status = COMPT_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleComptProfileV2(id) { const p = _comptPsV2.get(id); if (!p) throw new Error(`compt profile ${id} not found`); _comptCheckP(p.status, COMPT_PROFILE_MATURITY_V2.STALE); p.status = COMPT_PROFILE_MATURITY_V2.STALE; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archiveComptProfileV2(id) { const p = _comptPsV2.get(id); if (!p) throw new Error(`compt profile ${id} not found`); _comptCheckP(p.status, COMPT_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = COMPT_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchComptProfileV2(id) { const p = _comptPsV2.get(id); if (!p) throw new Error(`compt profile ${id} not found`); if (_comptPTerminal.has(p.status)) throw new Error(`cannot touch terminal compt profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getComptProfileV2(id) { const p = _comptPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listComptProfilesV2() { return [..._comptPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
export function createComptSampleV2({ id, profileId, metric, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_comptJsV2.has(id)) throw new Error(`compt sample ${id} already exists`);
  if (!_comptPsV2.has(profileId)) throw new Error(`compt profile ${profileId} not found`);
  if (_comptCountPending(profileId) >= _comptMaxPending) throw new Error(`max pending compt samples for profile ${profileId} reached`);
  const now = Date.now();
  const j = { id, profileId, metric: metric || "", status: COMPT_SAMPLE_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _comptJsV2.set(id, j); return { ...j, metadata: { ...j.metadata } };
}
export function recordingComptSampleV2(id) { const j = _comptJsV2.get(id); if (!j) throw new Error(`compt sample ${id} not found`); _comptCheckJ(j.status, COMPT_SAMPLE_LIFECYCLE_V2.RECORDING); const now = Date.now(); j.status = COMPT_SAMPLE_LIFECYCLE_V2.RECORDING; j.updatedAt = now; if (!j.startedAt) j.startedAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function recordComptSampleV2(id) { const j = _comptJsV2.get(id); if (!j) throw new Error(`compt sample ${id} not found`); _comptCheckJ(j.status, COMPT_SAMPLE_LIFECYCLE_V2.RECORDED); const now = Date.now(); j.status = COMPT_SAMPLE_LIFECYCLE_V2.RECORDED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; return { ...j, metadata: { ...j.metadata } }; }
export function failComptSampleV2(id, reason) { const j = _comptJsV2.get(id); if (!j) throw new Error(`compt sample ${id} not found`); _comptCheckJ(j.status, COMPT_SAMPLE_LIFECYCLE_V2.FAILED); const now = Date.now(); j.status = COMPT_SAMPLE_LIFECYCLE_V2.FAILED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.failReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function cancelComptSampleV2(id, reason) { const j = _comptJsV2.get(id); if (!j) throw new Error(`compt sample ${id} not found`); _comptCheckJ(j.status, COMPT_SAMPLE_LIFECYCLE_V2.CANCELLED); const now = Date.now(); j.status = COMPT_SAMPLE_LIFECYCLE_V2.CANCELLED; j.updatedAt = now; if (!j.settledAt) j.settledAt = now; if (reason) j.metadata.cancelReason = String(reason); return { ...j, metadata: { ...j.metadata } }; }
export function getComptSampleV2(id) { const j = _comptJsV2.get(id); if (!j) return null; return { ...j, metadata: { ...j.metadata } }; }
export function listComptSamplesV2() { return [..._comptJsV2.values()].map((j) => ({ ...j, metadata: { ...j.metadata } })); }
export function autoStaleIdleComptProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _comptPsV2.values()) if (p.status === COMPT_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _comptIdleMs) { p.status = COMPT_PROFILE_MATURITY_V2.STALE; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckComptSamplesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const j of _comptJsV2.values()) if (j.status === COMPT_SAMPLE_LIFECYCLE_V2.RECORDING && j.startedAt != null && (t - j.startedAt) >= _comptStuckMs) { j.status = COMPT_SAMPLE_LIFECYCLE_V2.FAILED; j.updatedAt = t; if (!j.settledAt) j.settledAt = t; j.metadata.failReason = "auto-fail-stuck"; flipped.push(j.id); } return { flipped, count: flipped.length }; }
export function getCompressionTelemetryGovStatsV2() {
  const profilesByStatus = {}; for (const v of Object.values(COMPT_PROFILE_MATURITY_V2)) profilesByStatus[v] = 0; for (const p of _comptPsV2.values()) profilesByStatus[p.status]++;
  const samplesByStatus = {}; for (const v of Object.values(COMPT_SAMPLE_LIFECYCLE_V2)) samplesByStatus[v] = 0; for (const j of _comptJsV2.values()) samplesByStatus[j.status]++;
  return { totalComptProfilesV2: _comptPsV2.size, totalComptSamplesV2: _comptJsV2.size, maxActiveComptProfilesPerOwner: _comptMaxActive, maxPendingComptSamplesPerProfile: _comptMaxPending, comptProfileIdleMs: _comptIdleMs, comptSampleStuckMs: _comptStuckMs, profilesByStatus, samplesByStatus };
}
