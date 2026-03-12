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
