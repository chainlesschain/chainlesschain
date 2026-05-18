/**
 * EvoMap Federation
 *
 * Multi-Hub interconnection and Gene evolution:
 * - Multi-Hub sync and discovery
 * - Evolution pressure selection
 * - Gene recombination
 * - Lineage DAG tracking
 *
 * @module evomap/evomap-federation
 * @version 3.4.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const HUB_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  SYNCING: "syncing",
  DEGRADED: "degraded",
};

class EvoMapFederation extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._hubs = new Map();
    this._lineage = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS evomap_hub_federation (
        id TEXT PRIMARY KEY,
        hub_url TEXT NOT NULL,
        hub_name TEXT,
        status TEXT DEFAULT 'offline',
        region TEXT,
        gene_count INTEGER DEFAULT 0,
        last_sync INTEGER,
        trust_score REAL DEFAULT 0.5,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_evomap_hubs_status ON evomap_hub_federation(status);

      CREATE TABLE IF NOT EXISTS gene_lineage (
        id TEXT PRIMARY KEY,
        gene_id TEXT NOT NULL,
        parent_gene_id TEXT,
        hub_id TEXT,
        generation INTEGER DEFAULT 0,
        fitness_score REAL DEFAULT 0.0,
        mutation_type TEXT,
        recombination_source TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_gene_lineage_gene ON gene_lineage(gene_id);
      CREATE INDEX IF NOT EXISTS idx_gene_lineage_parent ON gene_lineage(parent_gene_id);
    `);
  }

  async initialize() {
    logger.info("[EvoMapFederation] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const hubs = this.database.db
          .prepare(
            "SELECT * FROM evomap_hub_federation ORDER BY created_at DESC",
          )
          .all();
        for (const h of hubs) {
          this._hubs.set(h.id, h);
        }
        logger.info(`[EvoMapFederation] Loaded ${hubs.length} hubs`);
      } catch (err) {
        logger.error("[EvoMapFederation] Failed to load:", err);
      }
    }
    this.initialized = true;
    logger.info("[EvoMapFederation] Initialized");
  }

  async listHubs(filter = {}) {
    let hubs = Array.from(this._hubs.values());
    if (filter.status) {
      hubs = hubs.filter((h) => h.status === filter.status);
    }
    if (filter.region) {
      hubs = hubs.filter((h) => h.region === filter.region);
    }
    return hubs.slice(0, filter.limit || 50);
  }

  async syncGenes({ hubId, geneIds } = {}) {
    if (!hubId) {
      throw new Error("Hub ID is required");
    }
    const hub = this._hubs.get(hubId);
    if (!hub) {
      throw new Error(`Hub not found: ${hubId}`);
    }
    hub.last_sync = Date.now();
    hub.status = HUB_STATUS.SYNCING;
    // Simulate sync
    hub.status = HUB_STATUS.ONLINE;
    hub.gene_count += (geneIds || []).length;
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          "UPDATE evomap_hub_federation SET last_sync = ?, status = ?, gene_count = ? WHERE id = ?",
        )
        .run(hub.last_sync, hub.status, hub.gene_count, hubId);
    }
    this.emit("genes-synced", { hubId, geneCount: (geneIds || []).length });
    logger.info(
      `[EvoMapFederation] Synced ${(geneIds || []).length} genes with hub ${hubId}`,
    );
    return { hubId, synced: (geneIds || []).length, timestamp: Date.now() };
  }

  async getPressureReport() {
    const lineages = Array.from(this._lineage.values());
    return {
      totalGenes: lineages.length,
      avgFitness:
        lineages.length > 0
          ? lineages.reduce((s, l) => s + l.fitness_score, 0) / lineages.length
          : 0,
      maxGeneration:
        lineages.length > 0
          ? Math.max(...lineages.map((l) => l.generation))
          : 0,
      mutations: lineages.filter((l) => l.mutation_type).length,
      recombinations: lineages.filter((l) => l.recombination_source).length,
    };
  }

  async recombineGenes({ geneId1, geneId2 } = {}) {
    if (!geneId1 || !geneId2) {
      throw new Error("Two gene IDs are required for recombination");
    }
    const id = uuidv4();
    const childGeneId = uuidv4();
    const now = Date.now();
    const lineageEntry = {
      id,
      gene_id: childGeneId,
      parent_gene_id: geneId1,
      hub_id: null,
      generation: 1,
      fitness_score: 0.5 + Math.random() * 0.5,
      mutation_type: "recombination",
      recombination_source: geneId2,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO gene_lineage (id,gene_id,parent_gene_id,hub_id,generation,fitness_score,mutation_type,recombination_source,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          childGeneId,
          geneId1,
          null,
          lineageEntry.generation,
          lineageEntry.fitness_score,
          lineageEntry.mutation_type,
          geneId2,
          now,
        );
    }
    this._lineage.set(id, lineageEntry);
    this.emit("genes-recombined", lineageEntry);
    logger.info(
      `[EvoMapFederation] Genes recombined: ${geneId1} + ${geneId2} → ${childGeneId}`,
    );
    return lineageEntry;
  }

  async getLineage(geneId) {
    if (!geneId) {
      throw new Error("Gene ID is required");
    }
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            "SELECT * FROM gene_lineage WHERE gene_id = ? OR parent_gene_id = ? ORDER BY generation ASC",
          )
          .all(geneId, geneId);
      } catch (err) {
        logger.error("[EvoMapFederation] Failed to get lineage:", err);
      }
    }
    return Array.from(this._lineage.values()).filter(
      (l) => l.gene_id === geneId || l.parent_gene_id === geneId,
    );
  }

  buildFederationContext(contextHint, _limit = 3) {
    const hubs = Array.from(this._hubs.values()).filter(
      (h) => h.status === HUB_STATUS.ONLINE,
    );
    if (hubs.length === 0) {
      return null;
    }
    return `[EvoMap Federation] ${hubs.length} online hubs. Total genes: ${hubs.reduce((s, h) => s + (h.gene_count || 0), 0)}`;
  }

  async close() {
    this.removeAllListeners();
    this._hubs.clear();
    this._lineage.clear();
    this.initialized = false;
    logger.info("[EvoMapFederation] Closed");
  }
}

let _instance = null;
function getEvoMapFederation(database) {
  if (!_instance) {
    _instance = new EvoMapFederation(database);
  }
  return _instance;
}

export { EvoMapFederation, getEvoMapFederation, HUB_STATUS };
export default EvoMapFederation;
