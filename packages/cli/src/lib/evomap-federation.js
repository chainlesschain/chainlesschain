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
