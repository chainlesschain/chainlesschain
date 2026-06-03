/**
 * Gene IP Manager
 * DID+VC originality proof, anti-plagiarism, derivation chain
 * @module evomap/gene-ip-manager
 * @version 3.4.0
 */
import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

class GeneIPManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._ownerships = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS gene_ownership (
        id TEXT PRIMARY KEY,
        gene_id TEXT NOT NULL,
        owner_did TEXT NOT NULL,
        originality_proof TEXT,
        derivation_chain TEXT,
        revenue_split TEXT,
        verified INTEGER DEFAULT 0,
        plagiarism_score REAL DEFAULT 0.0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_gene_ownership_gene ON gene_ownership(gene_id);
      CREATE INDEX IF NOT EXISTS idx_gene_ownership_owner ON gene_ownership(owner_did);
    `);
  }

  async initialize() {
    logger.info("[GeneIPManager] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const ownerships = this.database.db
          .prepare("SELECT * FROM gene_ownership ORDER BY created_at DESC")
          .all();
        for (const o of ownerships) {
          this._ownerships.set(o.id, {
            ...o,
            originality_proof: o.originality_proof
              ? JSON.parse(o.originality_proof)
              : null,
            derivation_chain: o.derivation_chain
              ? JSON.parse(o.derivation_chain)
              : [],
            revenue_split: o.revenue_split ? JSON.parse(o.revenue_split) : {},
          });
        }
        logger.info(
          `[GeneIPManager] Loaded ${ownerships.length} ownership records`,
        );
      } catch (err) {
        logger.error("[GeneIPManager] Failed to load:", err);
      }
    }
    this.initialized = true;
    logger.info("[GeneIPManager] Initialized");
  }

  async registerOwnership({
    geneId,
    ownerDid,
    originalityProof,
    revenueSplit,
  } = {}) {
    if (!geneId) {
      throw new Error("Gene ID is required");
    }
    if (!ownerDid) {
      throw new Error("Owner DID is required");
    }
    const id = uuidv4();
    const ownership = {
      id,
      gene_id: geneId,
      owner_did: ownerDid,
      originality_proof: originalityProof || {
        method: "did-vc",
        timestamp: Date.now(),
      },
      derivation_chain: [],
      revenue_split: revenueSplit || { [ownerDid]: 100 },
      verified: 1,
      plagiarism_score: 0.0,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO gene_ownership (id,gene_id,owner_did,originality_proof,derivation_chain,revenue_split,verified,plagiarism_score,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          geneId,
          ownerDid,
          JSON.stringify(ownership.originality_proof),
          JSON.stringify(ownership.derivation_chain),
          JSON.stringify(ownership.revenue_split),
          1,
          0.0,
          ownership.created_at,
        );
    }
    this._ownerships.set(id, ownership);
    this.emit("ownership-registered", ownership);
    logger.info(
      `[GeneIPManager] Ownership registered: ${geneId} by ${ownerDid}`,
    );
    return ownership;
  }

  async traceContributions(geneId) {
    if (!geneId) {
      throw new Error("Gene ID is required");
    }
    const ownership = Array.from(this._ownerships.values()).find(
      (o) => o.gene_id === geneId,
    );
    if (!ownership) {
      return { geneId, contributors: [], derivationChain: [] };
    }
    return {
      geneId,
      owner: ownership.owner_did,
      contributors: Object.keys(ownership.revenue_split || {}),
      derivationChain: ownership.derivation_chain || [],
      revenueSplit: ownership.revenue_split,
    };
  }

  async close() {
    this.removeAllListeners();
    this._ownerships.clear();
    this.initialized = false;
    logger.info("[GeneIPManager] Closed");
  }
}

let _instance = null;
function getGeneIPManager(database) {
  if (!_instance) {
    _instance = new GeneIPManager(database);
  }
  return _instance;
}

export { GeneIPManager, getGeneIPManager };
export default GeneIPManager;
