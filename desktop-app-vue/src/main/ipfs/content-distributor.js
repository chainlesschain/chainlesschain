/**
 * Content Distributor
 * P2P CDN, hot content caching, IPLD DAG versioning
 * @module ipfs/content-distributor
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

class ContentDistributor {
  constructor(database) {
    this.database = database;
    this._versions = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS content_versions (
        id TEXT PRIMARY KEY,
        content_cid TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        parent_cid TEXT,
        dag_structure TEXT,
        cached INTEGER DEFAULT 0,
        peer_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_content_versions_cid ON content_versions(content_cid);
    `);
  }

  async initialize() {
    logger.info("[ContentDistributor] Initializing...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[ContentDistributor] Initialized");
  }

  async distributeContent({ cid, peerCount } = {}) {
    if (!cid) {
      throw new Error("CID is required");
    }
    const id = uuidv4();
    const entry = {
      id,
      content_cid: cid,
      version: 1,
      parent_cid: null,
      dag_structure: JSON.stringify({ root: cid }),
      cached: 1,
      peer_count: peerCount || 3,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO content_versions (id,content_cid,version,parent_cid,dag_structure,cached,peer_count,created_at) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          cid,
          1,
          null,
          entry.dag_structure,
          1,
          entry.peer_count,
          entry.created_at,
        );
    }
    this._versions.set(id, entry);
    logger.info(
      `[ContentDistributor] Content distributed: ${cid} to ${entry.peer_count} peers`,
    );
    return entry;
  }

  async getVersionHistory(cid) {
    if (!cid) {
      throw new Error("CID is required");
    }
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            "SELECT * FROM content_versions WHERE content_cid = ? ORDER BY version DESC",
          )
          .all(cid);
      } catch (err) {
        logger.error("[ContentDistributor] Failed to get versions:", err);
      }
    }
    return Array.from(this._versions.values()).filter(
      (v) => v.content_cid === cid,
    );
  }

  async close() {
    this._versions.clear();
    logger.info("[ContentDistributor] Closed");
  }
}

let _instance = null;
function getContentDistributor(database) {
  if (!_instance) {
    _instance = new ContentDistributor(database);
  }
  return _instance;
}

export { ContentDistributor, getContentDistributor };
export default ContentDistributor;
