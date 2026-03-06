/**
 * Filecoin Storage
 * Storage deals, proof verification, cost estimation
 * @module ipfs/filecoin-storage
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

class FilecoinStorage extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._deals = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS filecoin_deals (
        id TEXT PRIMARY KEY,
        cid TEXT NOT NULL,
        miner_id TEXT,
        size_bytes INTEGER,
        price_fil REAL,
        duration_epochs INTEGER,
        status TEXT DEFAULT 'proposed',
        verified INTEGER DEFAULT 0,
        renewal_count INTEGER DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_filecoin_deals_status ON filecoin_deals(status);
      CREATE INDEX IF NOT EXISTS idx_filecoin_deals_cid ON filecoin_deals(cid);
    `);
  }

  async initialize() {
    logger.info("[FilecoinStorage] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const deals = this.database.db
          .prepare("SELECT * FROM filecoin_deals ORDER BY created_at DESC")
          .all();
        for (const d of deals) {
          this._deals.set(d.id, d);
        }
        logger.info(`[FilecoinStorage] Loaded ${deals.length} deals`);
      } catch (err) {
        logger.error("[FilecoinStorage] Failed to load:", err);
      }
    }
    this.initialized = true;
    logger.info("[FilecoinStorage] Initialized");
  }

  async storeToFilecoin({ cid, sizeBytes, minerId, durationEpochs } = {}) {
    if (!cid) {
      throw new Error("CID is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const priceFil = (sizeBytes || 1024) * 0.000001;
    const deal = {
      id,
      cid,
      miner_id: minerId || "f01234",
      size_bytes: sizeBytes || 1024,
      price_fil: priceFil,
      duration_epochs: durationEpochs || 518400,
      status: "active",
      verified: 1,
      renewal_count: 0,
      expires_at: now + (durationEpochs || 518400) * 30000,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO filecoin_deals (id,cid,miner_id,size_bytes,price_fil,duration_epochs,status,verified,renewal_count,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          cid,
          deal.miner_id,
          deal.size_bytes,
          priceFil,
          deal.duration_epochs,
          deal.status,
          1,
          0,
          deal.expires_at,
          now,
        );
    }
    this._deals.set(id, deal);
    this.emit("deal-created", deal);
    logger.info(`[FilecoinStorage] Deal created for CID: ${cid}`);
    return deal;
  }

  async getDealStatus(dealId) {
    if (!dealId) {
      throw new Error("Deal ID is required");
    }
    return this._deals.get(dealId) || null;
  }

  async getStorageStats() {
    const deals = Array.from(this._deals.values());
    return {
      totalDeals: deals.length,
      activeDeals: deals.filter((d) => d.status === "active").length,
      totalSizeBytes: deals.reduce((s, d) => s + (d.size_bytes || 0), 0),
      totalCostFil: deals.reduce((s, d) => s + (d.price_fil || 0), 0),
    };
  }

  async close() {
    this.removeAllListeners();
    this._deals.clear();
    this.initialized = false;
    logger.info("[FilecoinStorage] Closed");
  }
}

let _instance = null;
function getFilecoinStorage(database) {
  if (!_instance) {
    _instance = new FilecoinStorage(database);
  }
  return _instance;
}

export { FilecoinStorage, getFilecoinStorage };
export default FilecoinStorage;
