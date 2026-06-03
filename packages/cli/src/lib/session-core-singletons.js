/**
 * Session-core singletons for the CLI
 *
 * Wires MemoryStore / BetaFlags / ApprovalGate with file-based persistence under
 * the CLI home dir (`~/.chainlesschain/`).
 *
 * Lazy: instances are created on first access so bootstrap stays fast.
 */

import { join } from "node:path";
import { promises as fsp, existsSync, mkdirSync } from "node:fs";
import { getHomeDir } from "./paths.js";
import {
  MemoryStore,
  BetaFlags,
  ApprovalGate,
  APPROVAL_POLICY,
  SessionManager,
  StreamRouter,
  createMemoryFileAdapter,
  createBetaFlagsFileAdapter,
  createApprovalGateFileAdapter,
  hydrateMemoryStore,
} from "@chainlesschain/session-core";

let _memoryStore = null;
let _betaFlags = null;
let _approvalGate = null;
let _sessionManager = null;

export function getMemoryStorePath() {
  return join(getHomeDir(), "memory-store.json");
}

export function getBetaFlagsPath() {
  return join(getHomeDir(), "beta-flags.json");
}

export function getApprovalPoliciesPath() {
  return join(getHomeDir(), "approval-policies.json");
}

export function getMemoryStore() {
  if (_memoryStore) return _memoryStore;
  const adapter = createMemoryFileAdapter(getMemoryStorePath());
  _memoryStore = new MemoryStore({ adapter });
  hydrateMemoryStore(_memoryStore, adapter);
  return _memoryStore;
}

export async function getBetaFlags() {
  if (_betaFlags) return _betaFlags;
  const store = createBetaFlagsFileAdapter(getBetaFlagsPath());
  _betaFlags = new BetaFlags({ store });
  await _betaFlags.load();
  return _betaFlags;
}

export async function getApprovalGate() {
  if (_approvalGate) return _approvalGate;
  const store = createApprovalGateFileAdapter(getApprovalPoliciesPath());
  _approvalGate = new ApprovalGate({
    defaultPolicy: APPROVAL_POLICY.STRICT,
    store,
  });
  await _approvalGate.load();
  return _approvalGate;
}

export function getParkedSessionsPath() {
  return join(getHomeDir(), "parked-sessions.json");
}

function createParkedSessionsStore(filePath) {
  async function readAll() {
    try {
      const raw = await fsp.readFile(filePath, "utf8");
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  async function writeAll(map) {
    const dir = join(filePath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(map, null, 2), "utf8");
  }
  return {
    async save(json) {
      const map = await readAll();
      map[json.sessionId] = json;
      await writeAll(map);
    },
    async load(sessionId) {
      const map = await readAll();
      return map[sessionId] || null;
    },
    async remove(sessionId) {
      const map = await readAll();
      delete map[sessionId];
      await writeAll(map);
    },
    async list() {
      return Object.values(await readAll());
    },
  };
}

export function getSessionManager() {
  if (_sessionManager) return _sessionManager;
  const store = createParkedSessionsStore(getParkedSessionsPath());
  _sessionManager = new SessionManager({ store });
  _sessionManager._parkedStore = store;
  return _sessionManager;
}

export function createStreamRouter() {
  return new StreamRouter();
}

export function resetSessionCoreSingletonsForTests() {
  _memoryStore = null;
  _betaFlags = null;
  _approvalGate = null;
  _sessionManager = null;
}

// =====================================================================
// session-core-singletons V2 governance overlay (iter27)
// =====================================================================
export const SCSGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const SCSGOV_ACCESS_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RESOLVING: "resolving",
  RESOLVED: "resolved",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _scsgovPTrans = new Map([
  [
    SCSGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SCSGOV_PROFILE_MATURITY_V2.ACTIVE,
      SCSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SCSGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SCSGOV_PROFILE_MATURITY_V2.STALE,
      SCSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SCSGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      SCSGOV_PROFILE_MATURITY_V2.ACTIVE,
      SCSGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SCSGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _scsgovPTerminal = new Set([SCSGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _scsgovJTrans = new Map([
  [
    SCSGOV_ACCESS_LIFECYCLE_V2.QUEUED,
    new Set([
      SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVING,
      SCSGOV_ACCESS_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVING,
    new Set([
      SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVED,
      SCSGOV_ACCESS_LIFECYCLE_V2.FAILED,
      SCSGOV_ACCESS_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVED, new Set()],
  [SCSGOV_ACCESS_LIFECYCLE_V2.FAILED, new Set()],
  [SCSGOV_ACCESS_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _scsgovPsV2 = new Map();
const _scsgovJsV2 = new Map();
let _scsgovMaxActive = 8,
  _scsgovMaxPending = 20,
  _scsgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _scsgovStuckMs = 60 * 1000;
function _scsgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _scsgovCheckP(from, to) {
  const a = _scsgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid scsgov profile transition ${from} → ${to}`);
}
function _scsgovCheckJ(from, to) {
  const a = _scsgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid scsgov access transition ${from} → ${to}`);
}
function _scsgovCountActive(owner) {
  let c = 0;
  for (const p of _scsgovPsV2.values())
    if (p.owner === owner && p.status === SCSGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _scsgovCountPending(profileId) {
  let c = 0;
  for (const j of _scsgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SCSGOV_ACCESS_LIFECYCLE_V2.QUEUED ||
        j.status === SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVING)
    )
      c++;
  return c;
}
export function setMaxActiveScsgovProfilesPerOwnerV2(n) {
  _scsgovMaxActive = _scsgovPos(n, "maxActiveScsgovProfilesPerOwner");
}
export function getMaxActiveScsgovProfilesPerOwnerV2() {
  return _scsgovMaxActive;
}
export function setMaxPendingScsgovAccesssPerProfileV2(n) {
  _scsgovMaxPending = _scsgovPos(n, "maxPendingScsgovAccesssPerProfile");
}
export function getMaxPendingScsgovAccesssPerProfileV2() {
  return _scsgovMaxPending;
}
export function setScsgovProfileIdleMsV2(n) {
  _scsgovIdleMs = _scsgovPos(n, "scsgovProfileIdleMs");
}
export function getScsgovProfileIdleMsV2() {
  return _scsgovIdleMs;
}
export function setScsgovAccessStuckMsV2(n) {
  _scsgovStuckMs = _scsgovPos(n, "scsgovAccessStuckMs");
}
export function getScsgovAccessStuckMsV2() {
  return _scsgovStuckMs;
}
export function _resetStateSessionCoreSingletonsGovV2() {
  _scsgovPsV2.clear();
  _scsgovJsV2.clear();
  _scsgovMaxActive = 8;
  _scsgovMaxPending = 20;
  _scsgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _scsgovStuckMs = 60 * 1000;
}
export function registerScsgovProfileV2({
  id,
  owner,
  component,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_scsgovPsV2.has(id))
    throw new Error(`scsgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    component: component || "default",
    status: SCSGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _scsgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateScsgovProfileV2(id) {
  const p = _scsgovPsV2.get(id);
  if (!p) throw new Error(`scsgov profile ${id} not found`);
  const isInitial = p.status === SCSGOV_PROFILE_MATURITY_V2.PENDING;
  _scsgovCheckP(p.status, SCSGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _scsgovCountActive(p.owner) >= _scsgovMaxActive)
    throw new Error(`max active scsgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SCSGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleScsgovProfileV2(id) {
  const p = _scsgovPsV2.get(id);
  if (!p) throw new Error(`scsgov profile ${id} not found`);
  _scsgovCheckP(p.status, SCSGOV_PROFILE_MATURITY_V2.STALE);
  p.status = SCSGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveScsgovProfileV2(id) {
  const p = _scsgovPsV2.get(id);
  if (!p) throw new Error(`scsgov profile ${id} not found`);
  _scsgovCheckP(p.status, SCSGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SCSGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchScsgovProfileV2(id) {
  const p = _scsgovPsV2.get(id);
  if (!p) throw new Error(`scsgov profile ${id} not found`);
  if (_scsgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal scsgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getScsgovProfileV2(id) {
  const p = _scsgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listScsgovProfilesV2() {
  return [..._scsgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createScsgovAccessV2({ id, profileId, caller, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_scsgovJsV2.has(id))
    throw new Error(`scsgov access ${id} already exists`);
  if (!_scsgovPsV2.has(profileId))
    throw new Error(`scsgov profile ${profileId} not found`);
  if (_scsgovCountPending(profileId) >= _scsgovMaxPending)
    throw new Error(
      `max pending scsgov accesss for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    caller: caller || "",
    status: SCSGOV_ACCESS_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _scsgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function resolvingScsgovAccessV2(id) {
  const j = _scsgovJsV2.get(id);
  if (!j) throw new Error(`scsgov access ${id} not found`);
  _scsgovCheckJ(j.status, SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVING);
  const now = Date.now();
  j.status = SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeAccessScsgovV2(id) {
  const j = _scsgovJsV2.get(id);
  if (!j) throw new Error(`scsgov access ${id} not found`);
  _scsgovCheckJ(j.status, SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVED);
  const now = Date.now();
  j.status = SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failScsgovAccessV2(id, reason) {
  const j = _scsgovJsV2.get(id);
  if (!j) throw new Error(`scsgov access ${id} not found`);
  _scsgovCheckJ(j.status, SCSGOV_ACCESS_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SCSGOV_ACCESS_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelScsgovAccessV2(id, reason) {
  const j = _scsgovJsV2.get(id);
  if (!j) throw new Error(`scsgov access ${id} not found`);
  _scsgovCheckJ(j.status, SCSGOV_ACCESS_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SCSGOV_ACCESS_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getScsgovAccessV2(id) {
  const j = _scsgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listScsgovAccesssV2() {
  return [..._scsgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleScsgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _scsgovPsV2.values())
    if (
      p.status === SCSGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _scsgovIdleMs
    ) {
      p.status = SCSGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckScsgovAccesssV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _scsgovJsV2.values())
    if (
      j.status === SCSGOV_ACCESS_LIFECYCLE_V2.RESOLVING &&
      j.startedAt != null &&
      t - j.startedAt >= _scsgovStuckMs
    ) {
      j.status = SCSGOV_ACCESS_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSessionCoreSingletonsGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SCSGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _scsgovPsV2.values()) profilesByStatus[p.status]++;
  const accesssByStatus = {};
  for (const v of Object.values(SCSGOV_ACCESS_LIFECYCLE_V2))
    accesssByStatus[v] = 0;
  for (const j of _scsgovJsV2.values()) accesssByStatus[j.status]++;
  return {
    totalScsgovProfilesV2: _scsgovPsV2.size,
    totalScsgovAccesssV2: _scsgovJsV2.size,
    maxActiveScsgovProfilesPerOwner: _scsgovMaxActive,
    maxPendingScsgovAccesssPerProfile: _scsgovMaxPending,
    scsgovProfileIdleMs: _scsgovIdleMs,
    scsgovAccessStuckMs: _scsgovStuckMs,
    profilesByStatus,
    accesssByStatus,
  };
}
