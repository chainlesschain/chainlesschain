/**
 * EvoMap Federation — federated hub management, gene syncing,
 * lineage tracking, evolutionary pressure analytics, and gene recombination.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _hubs = new Map();
const _lineage = new Map();

const HUB_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  SYNCING: "syncing",
  DEGRADED: "degraded",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureEvoMapFederationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evomap_hub_federation (
      id TEXT PRIMARY KEY,
      hub_url TEXT NOT NULL,
      hub_name TEXT,
      status TEXT DEFAULT 'offline',
      region TEXT,
      gene_count INTEGER DEFAULT 0,
      last_sync TEXT,
      trust_score REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gene_lineage (
      id TEXT PRIMARY KEY,
      gene_id TEXT NOT NULL,
      parent_gene_id TEXT,
      hub_id TEXT,
      generation INTEGER DEFAULT 0,
      fitness_score REAL DEFAULT 0.0,
      mutation_type TEXT,
      recombination_source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Hub Management ────────────────────────────────────────── */

export function listFederatedHubs(db, filter = {}) {
  let hubs = [..._hubs.values()];
  if (filter.status) {
    hubs = hubs.filter((h) => h.status === filter.status);
  }
  if (filter.region) {
    hubs = hubs.filter((h) => h.region === filter.region);
  }
  const limit = filter.limit || 50;
  return hubs.slice(0, limit);
}

export function addFederatedHub(db, hubUrl, hubName, region) {
  if (!hubUrl) throw new Error("Hub URL is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const hub = {
    id,
    hubUrl,
    hubName: hubName || hubUrl,
    status: HUB_STATUS.OFFLINE,
    region: region || "global",
    geneCount: 0,
    lastSync: null,
    trustScore: 0.5,
    createdAt: now,
  };

  _hubs.set(id, hub);

  db.prepare(
    `INSERT INTO evomap_hub_federation (id, hub_url, hub_name, status, region, gene_count, last_sync, trust_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, hub.hubUrl, hub.hubName, hub.status, hub.region, 0, null, 0.5, now);

  return hub;
}

/* ── Gene Syncing ──────────────────────────────────────────── */

export function syncGenes(db, hubId, geneIds = []) {
  const hub = _hubs.get(hubId);
  if (!hub) throw new Error(`Hub not found: ${hubId}`);

  const now = new Date().toISOString();
  const synced = geneIds.length || Math.floor(Math.random() * 10) + 1;

  hub.status = HUB_STATUS.ONLINE;
  hub.geneCount += synced;
  hub.lastSync = now;
  hub.trustScore = Math.min(1.0, hub.trustScore + 0.05);

  db.prepare(
    `UPDATE evomap_hub_federation SET status = ?, gene_count = ?, last_sync = ?, trust_score = ? WHERE id = ?`,
  ).run(hub.status, hub.geneCount, now, hub.trustScore, hubId);

  return { hubId, synced, timestamp: now };
}

/* ── Evolutionary Pressure ────────────────────────────────── */

export function getPressureReport() {
  const lineageEntries = [..._lineage.values()];
  if (lineageEntries.length === 0) {
    return {
      totalGenes: 0,
      avgFitness: 0,
      maxGeneration: 0,
      mutations: 0,
      recombinations: 0,
    };
  }

  const totalGenes = lineageEntries.length;
  const avgFitness =
    lineageEntries.reduce((s, e) => s + e.fitnessScore, 0) / totalGenes;
  const maxGeneration = Math.max(...lineageEntries.map((e) => e.generation));
  const mutations = lineageEntries.filter(
    (e) => e.mutationType && e.mutationType !== "recombination",
  ).length;
  const recombinations = lineageEntries.filter(
    (e) => e.mutationType === "recombination",
  ).length;

  return { totalGenes, avgFitness, maxGeneration, mutations, recombinations };
}

/* ── Gene Recombination ───────────────────────────────────── */

export function recombineGenes(db, geneId1, geneId2) {
  if (!geneId1 || !geneId2) throw new Error("Two gene IDs are required");

  const id = crypto.randomUUID();
  const childGeneId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Determine generation from parents
  const parent1 = [..._lineage.values()].find((e) => e.geneId === geneId1);
  const parent2 = [..._lineage.values()].find((e) => e.geneId === geneId2);
  const gen = Math.max(parent1?.generation || 0, parent2?.generation || 0) + 1;

  const entry = {
    id,
    geneId: childGeneId,
    parentGeneId: geneId1,
    hubId: null,
    generation: gen,
    fitnessScore: 0.5 + Math.random() * 0.5,
    mutationType: "recombination",
    recombinationSource: geneId2,
    createdAt: now,
  };

  _lineage.set(id, entry);

  db.prepare(
    `INSERT INTO gene_lineage (id, gene_id, parent_gene_id, hub_id, generation, fitness_score, mutation_type, recombination_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.geneId,
    entry.parentGeneId,
    null,
    entry.generation,
    entry.fitnessScore,
    entry.mutationType,
    entry.recombinationSource,
    now,
  );

  return entry;
}

/* ── Lineage Tracking ─────────────────────────────────────── */

export function getLineage(geneId) {
  if (!geneId) throw new Error("Gene ID is required");
  return [..._lineage.values()].filter(
    (e) =>
      e.geneId === geneId ||
      e.parentGeneId === geneId ||
      e.recombinationSource === geneId,
  );
}

export function addLineageEntry(db, geneId, parentGeneId, opts = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const entry = {
    id,
    geneId,
    parentGeneId: parentGeneId || null,
    hubId: opts.hubId || null,
    generation: opts.generation || 0,
    fitnessScore: opts.fitnessScore || 0.5 + Math.random() * 0.5,
    mutationType: opts.mutationType || "mutation",
    recombinationSource: opts.recombinationSource || null,
    createdAt: now,
  };

  _lineage.set(id, entry);

  db.prepare(
    `INSERT INTO gene_lineage (id, gene_id, parent_gene_id, hub_id, generation, fitness_score, mutation_type, recombination_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.geneId,
    entry.parentGeneId,
    entry.hubId,
    entry.generation,
    entry.fitnessScore,
    entry.mutationType,
    entry.recombinationSource,
    now,
  );

  return entry;
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _hubs.clear();
  _lineage.clear();
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Canonical Surface (Phase 42 — EvoMap Advanced Federation)
 *   Strictly additive; legacy exports above remain unchanged.
 * ═══════════════════════════════════════════════════════════════ */

export const HUB_STATUS_V2 = Object.freeze({
  ONLINE: "online",
  OFFLINE: "offline",
  SYNCING: "syncing",
  DEGRADED: "degraded",
});

export const TRUST_TIER = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

export const MUTATION_TYPE = Object.freeze({
  MUTATION: "mutation",
  RECOMBINATION: "recombination",
  CROSSOVER: "crossover",
  DRIFT: "drift",
});

const _allowedHubTransitions = new Map([
  [
    HUB_STATUS_V2.ONLINE,
    new Set([
      HUB_STATUS_V2.OFFLINE,
      HUB_STATUS_V2.SYNCING,
      HUB_STATUS_V2.DEGRADED,
    ]),
  ],
  [
    HUB_STATUS_V2.OFFLINE,
    new Set([HUB_STATUS_V2.SYNCING, HUB_STATUS_V2.ONLINE]),
  ],
  [
    HUB_STATUS_V2.SYNCING,
    new Set([
      HUB_STATUS_V2.ONLINE,
      HUB_STATUS_V2.DEGRADED,
      HUB_STATUS_V2.OFFLINE,
    ]),
  ],
  [
    HUB_STATUS_V2.DEGRADED,
    new Set([HUB_STATUS_V2.ONLINE, HUB_STATUS_V2.OFFLINE]),
  ],
]);

export function trustTier(score) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    throw new Error("Trust score must be a number");
  }
  if (score < 0.3) return TRUST_TIER.LOW;
  if (score < 0.7) return TRUST_TIER.MEDIUM;
  return TRUST_TIER.HIGH;
}

export function setHubStatus(db, hubId, newStatus) {
  const hub = _hubs.get(hubId);
  if (!hub) throw new Error(`Hub not found: ${hubId}`);

  const validStatuses = Object.values(HUB_STATUS_V2);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Unknown hub status: ${newStatus}`);
  }

  const allowed = _allowedHubTransitions.get(hub.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid hub status transition: ${hub.status} → ${newStatus}`,
    );
  }

  hub.status = newStatus;

  db.prepare(`UPDATE evomap_hub_federation SET status = ? WHERE id = ?`).run(
    newStatus,
    hubId,
  );

  return { hubId, status: newStatus };
}

export function listHubsV2(db, filter = {}) {
  let hubs = [..._hubs.values()];

  if (filter.status) {
    hubs = hubs.filter((h) => h.status === filter.status);
  }
  if (filter.region) {
    hubs = hubs.filter((h) => h.region === filter.region);
  }
  if (typeof filter.minTrust === "number") {
    hubs = hubs.filter((h) => h.trustScore >= filter.minTrust);
  }
  if (filter.trustTier) {
    hubs = hubs.filter((h) => trustTier(h.trustScore) === filter.trustTier);
  }

  const limit = filter.limit || 50;
  return hubs.slice(0, limit).map((h) => ({
    ...h,
    trustTier: trustTier(h.trustScore),
  }));
}

export function buildFederationContext() {
  const hubs = [..._hubs.values()];
  const lineageEntries = [..._lineage.values()];

  const onlineHubs = hubs.filter(
    (h) => h.status === HUB_STATUS_V2.ONLINE,
  ).length;
  const totalGenes = lineageEntries.length;
  const avgFitness =
    totalGenes === 0
      ? 0
      : lineageEntries.reduce((s, e) => s + e.fitnessScore, 0) / totalGenes;
  const avgTrust =
    hubs.length === 0
      ? 0
      : hubs.reduce((s, h) => s + h.trustScore, 0) / hubs.length;

  return {
    hubCount: hubs.length,
    onlineHubs,
    totalGenes,
    avgFitness,
    avgTrust,
    avgTrustTier: hubs.length === 0 ? null : trustTier(avgTrust),
    regions: [...new Set(hubs.map((h) => h.region))],
  };
}

export function getFederationStatsV2() {
  const hubs = [..._hubs.values()];
  const lineageEntries = [..._lineage.values()];

  const byStatus = {};
  for (const status of Object.values(HUB_STATUS_V2)) {
    byStatus[status] = hubs.filter((h) => h.status === status).length;
  }

  const byRegion = {};
  for (const h of hubs) {
    byRegion[h.region] = (byRegion[h.region] || 0) + 1;
  }

  const byTrustTier = {
    [TRUST_TIER.LOW]: 0,
    [TRUST_TIER.MEDIUM]: 0,
    [TRUST_TIER.HIGH]: 0,
  };
  for (const h of hubs) {
    byTrustTier[trustTier(h.trustScore)]++;
  }

  const byMutationType = {};
  for (const e of lineageEntries) {
    const type = e.mutationType || "unknown";
    byMutationType[type] = (byMutationType[type] || 0) + 1;
  }

  return {
    totalHubs: hubs.length,
    totalGenes: lineageEntries.length,
    byStatus,
    byRegion,
    byTrustTier,
    byMutationType,
  };
}

// =====================================================================
// evomap-federation V2 governance overlay (iter25)
// =====================================================================
export const EVFEDGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const EVFEDGOV_SYNC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SYNCING: "syncing",
  SYNCED: "synced",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _evfedgovPTrans = new Map([
  [
    EVFEDGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE,
      EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      EVFEDGOV_PROFILE_MATURITY_V2.STALE,
      EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EVFEDGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE,
      EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _evfedgovPTerminal = new Set([EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _evfedgovJTrans = new Map([
  [
    EVFEDGOV_SYNC_LIFECYCLE_V2.QUEUED,
    new Set([
      EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCING,
      EVFEDGOV_SYNC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCING,
    new Set([
      EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCED,
      EVFEDGOV_SYNC_LIFECYCLE_V2.FAILED,
      EVFEDGOV_SYNC_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCED, new Set()],
  [EVFEDGOV_SYNC_LIFECYCLE_V2.FAILED, new Set()],
  [EVFEDGOV_SYNC_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _evfedgovPsV2 = new Map();
const _evfedgovJsV2 = new Map();
let _evfedgovMaxActive = 6,
  _evfedgovMaxPending = 15,
  _evfedgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _evfedgovStuckMs = 60 * 1000;
function _evfedgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _evfedgovCheckP(from, to) {
  const a = _evfedgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evfedgov profile transition ${from} → ${to}`);
}
function _evfedgovCheckJ(from, to) {
  const a = _evfedgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evfedgov sync transition ${from} → ${to}`);
}
function _evfedgovCountActive(owner) {
  let c = 0;
  for (const p of _evfedgovPsV2.values())
    if (p.owner === owner && p.status === EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _evfedgovCountPending(profileId) {
  let c = 0;
  for (const j of _evfedgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === EVFEDGOV_SYNC_LIFECYCLE_V2.QUEUED ||
        j.status === EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCING)
    )
      c++;
  return c;
}
export function setMaxActiveEvfedgovProfilesPerOwnerV2(n) {
  _evfedgovMaxActive = _evfedgovPos(n, "maxActiveEvfedgovProfilesPerOwner");
}
export function getMaxActiveEvfedgovProfilesPerOwnerV2() {
  return _evfedgovMaxActive;
}
export function setMaxPendingEvfedgovSyncsPerProfileV2(n) {
  _evfedgovMaxPending = _evfedgovPos(n, "maxPendingEvfedgovSyncsPerProfile");
}
export function getMaxPendingEvfedgovSyncsPerProfileV2() {
  return _evfedgovMaxPending;
}
export function setEvfedgovProfileIdleMsV2(n) {
  _evfedgovIdleMs = _evfedgovPos(n, "evfedgovProfileIdleMs");
}
export function getEvfedgovProfileIdleMsV2() {
  return _evfedgovIdleMs;
}
export function setEvfedgovSyncStuckMsV2(n) {
  _evfedgovStuckMs = _evfedgovPos(n, "evfedgovSyncStuckMs");
}
export function getEvfedgovSyncStuckMsV2() {
  return _evfedgovStuckMs;
}
export function _resetStateEvomapFederationGovV2() {
  _evfedgovPsV2.clear();
  _evfedgovJsV2.clear();
  _evfedgovMaxActive = 6;
  _evfedgovMaxPending = 15;
  _evfedgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _evfedgovStuckMs = 60 * 1000;
}
export function registerEvfedgovProfileV2({ id, owner, hub, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_evfedgovPsV2.has(id))
    throw new Error(`evfedgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    hub: hub || "primary",
    status: EVFEDGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _evfedgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateEvfedgovProfileV2(id) {
  const p = _evfedgovPsV2.get(id);
  if (!p) throw new Error(`evfedgov profile ${id} not found`);
  const isInitial = p.status === EVFEDGOV_PROFILE_MATURITY_V2.PENDING;
  _evfedgovCheckP(p.status, EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _evfedgovCountActive(p.owner) >= _evfedgovMaxActive)
    throw new Error(
      `max active evfedgov profiles for owner ${p.owner} reached`,
    );
  const now = Date.now();
  p.status = EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleEvfedgovProfileV2(id) {
  const p = _evfedgovPsV2.get(id);
  if (!p) throw new Error(`evfedgov profile ${id} not found`);
  _evfedgovCheckP(p.status, EVFEDGOV_PROFILE_MATURITY_V2.STALE);
  p.status = EVFEDGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveEvfedgovProfileV2(id) {
  const p = _evfedgovPsV2.get(id);
  if (!p) throw new Error(`evfedgov profile ${id} not found`);
  _evfedgovCheckP(p.status, EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = EVFEDGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchEvfedgovProfileV2(id) {
  const p = _evfedgovPsV2.get(id);
  if (!p) throw new Error(`evfedgov profile ${id} not found`);
  if (_evfedgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal evfedgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getEvfedgovProfileV2(id) {
  const p = _evfedgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listEvfedgovProfilesV2() {
  return [..._evfedgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createEvfedgovSyncV2({ id, profileId, geneId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_evfedgovJsV2.has(id))
    throw new Error(`evfedgov sync ${id} already exists`);
  if (!_evfedgovPsV2.has(profileId))
    throw new Error(`evfedgov profile ${profileId} not found`);
  if (_evfedgovCountPending(profileId) >= _evfedgovMaxPending)
    throw new Error(
      `max pending evfedgov syncs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    geneId: geneId || "",
    status: EVFEDGOV_SYNC_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _evfedgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function syncingEvfedgovSyncV2(id) {
  const j = _evfedgovJsV2.get(id);
  if (!j) throw new Error(`evfedgov sync ${id} not found`);
  _evfedgovCheckJ(j.status, EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCING);
  const now = Date.now();
  j.status = EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeSyncEvfedgovV2(id) {
  const j = _evfedgovJsV2.get(id);
  if (!j) throw new Error(`evfedgov sync ${id} not found`);
  _evfedgovCheckJ(j.status, EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCED);
  const now = Date.now();
  j.status = EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failEvfedgovSyncV2(id, reason) {
  const j = _evfedgovJsV2.get(id);
  if (!j) throw new Error(`evfedgov sync ${id} not found`);
  _evfedgovCheckJ(j.status, EVFEDGOV_SYNC_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = EVFEDGOV_SYNC_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelEvfedgovSyncV2(id, reason) {
  const j = _evfedgovJsV2.get(id);
  if (!j) throw new Error(`evfedgov sync ${id} not found`);
  _evfedgovCheckJ(j.status, EVFEDGOV_SYNC_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = EVFEDGOV_SYNC_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getEvfedgovSyncV2(id) {
  const j = _evfedgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listEvfedgovSyncsV2() {
  return [..._evfedgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleEvfedgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _evfedgovPsV2.values())
    if (
      p.status === EVFEDGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _evfedgovIdleMs
    ) {
      p.status = EVFEDGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEvfedgovSyncsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _evfedgovJsV2.values())
    if (
      j.status === EVFEDGOV_SYNC_LIFECYCLE_V2.SYNCING &&
      j.startedAt != null &&
      t - j.startedAt >= _evfedgovStuckMs
    ) {
      j.status = EVFEDGOV_SYNC_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getEvomapFederationGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(EVFEDGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _evfedgovPsV2.values()) profilesByStatus[p.status]++;
  const syncsByStatus = {};
  for (const v of Object.values(EVFEDGOV_SYNC_LIFECYCLE_V2))
    syncsByStatus[v] = 0;
  for (const j of _evfedgovJsV2.values()) syncsByStatus[j.status]++;
  return {
    totalEvfedgovProfilesV2: _evfedgovPsV2.size,
    totalEvfedgovSyncsV2: _evfedgovJsV2.size,
    maxActiveEvfedgovProfilesPerOwner: _evfedgovMaxActive,
    maxPendingEvfedgovSyncsPerProfile: _evfedgovMaxPending,
    evfedgovProfileIdleMs: _evfedgovIdleMs,
    evfedgovSyncStuckMs: _evfedgovStuckMs,
    profilesByStatus,
    syncsByStatus,
  };
}
