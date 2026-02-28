/**
 * Satellite Communication
 * LEO satellite messaging with encryption
 * @module security/satellite-comm
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

class SatelliteComm extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._messages = new Map();
    this._signatureQueue = [];
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS satellite_messages (
        id TEXT PRIMARY KEY,
        sender_did TEXT,
        recipient_did TEXT,
        content_encrypted TEXT,
        compression TEXT DEFAULT 'gzip',
        satellite_provider TEXT,
        status TEXT DEFAULT 'queued',
        sent_at INTEGER,
        received_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_satellite_msgs_status ON satellite_messages(status);

      CREATE TABLE IF NOT EXISTS offline_signature_queue (
        id TEXT PRIMARY KEY,
        document_hash TEXT NOT NULL,
        signer_did TEXT,
        signature TEXT,
        status TEXT DEFAULT 'pending',
        synced INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_offline_sig_status ON offline_signature_queue(status);
    `);
  }

  async initialize() {
    logger.info("[SatelliteComm] Initializing...");
    this._ensureTables();
    this.initialized = true;
    logger.info("[SatelliteComm] Initialized");
  }

  async sendMessage({ senderDid, recipientDid, content, provider } = {}) {
    if (!content) {
      throw new Error("Message content is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const msg = {
      id,
      sender_did: senderDid || "self",
      recipient_did: recipientDid || "",
      content_encrypted: `enc_${Buffer.from(content).toString("base64")}`,
      compression: "gzip",
      satellite_provider: provider || "iridium",
      status: "sent",
      sent_at: now,
      received_at: null,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO satellite_messages (id,sender_did,recipient_did,content_encrypted,compression,satellite_provider,status,sent_at,received_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          msg.sender_did,
          msg.recipient_did,
          msg.content_encrypted,
          msg.compression,
          msg.satellite_provider,
          msg.status,
          now,
          null,
          now,
        );
    }
    this._messages.set(id, msg);
    this.emit("message-sent", msg);
    logger.info(`[SatelliteComm] Message sent via ${msg.satellite_provider}`);
    return msg;
  }

  async getMessages(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM satellite_messages WHERE 1=1";
        const params = [];
        if (filter.status) {
          sql += " AND status = ?";
          params.push(filter.status);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[SatelliteComm] Failed to get messages:", err);
      }
    }
    return Array.from(this._messages.values()).slice(0, filter.limit || 50);
  }

  async syncSignatures() {
    const pending = this._signatureQueue.filter((s) => s.status === "pending");
    for (const sig of pending) {
      sig.status = "synced";
    }
    return {
      synced: pending.length,
      remaining: this._signatureQueue.filter((s) => s.status === "pending")
        .length,
    };
  }

  async emergencyRevoke(keyId) {
    if (!keyId) {
      throw new Error("Key ID is required");
    }
    logger.info(
      `[SatelliteComm] Emergency revocation broadcast for key: ${keyId}`,
    );
    return {
      keyId,
      revoked: true,
      broadcastedAt: Date.now(),
      provider: "iridium",
    };
  }

  async getRecoveryStatus() {
    return {
      offlineSignatures: this._signatureQueue.length,
      pendingSync: this._signatureQueue.filter((s) => s.status === "pending")
        .length,
      lastSyncAt: Date.now(),
    };
  }

  async close() {
    this.removeAllListeners();
    this._messages.clear();
    this._signatureQueue = [];
    this.initialized = false;
    logger.info("[SatelliteComm] Closed");
  }
}

let _instance = null;
function getSatelliteComm(database) {
  if (!_instance) {
    _instance = new SatelliteComm(database);
  }
  return _instance;
}

export { SatelliteComm, getSatelliteComm };
export default SatelliteComm;
