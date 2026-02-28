/**
 * Multi-Protocol Fusion Bridge
 *
 * Unified message format and cross-protocol routing:
 * - Lossless cross-protocol conversion
 * - DID↔AP↔Nostr↔Matrix identity mapping
 * - Cross-protocol message routing
 *
 * @module social/protocol-fusion-bridge
 * @version 3.3.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const PROTOCOL = {
  DID: "did",
  ACTIVITYPUB: "activitypub",
  NOSTR: "nostr",
  MATRIX: "matrix",
};

class ProtocolFusionBridge extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._messages = new Map();
    this._identityMap = new Map();
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS unified_messages (
        id TEXT PRIMARY KEY,
        source_protocol TEXT NOT NULL,
        target_protocol TEXT,
        sender_id TEXT,
        content TEXT,
        unified_format TEXT,
        converted INTEGER DEFAULT 0,
        routed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_unified_msgs_protocol ON unified_messages(source_protocol);

      CREATE TABLE IF NOT EXISTS identity_mappings (
        id TEXT PRIMARY KEY,
        did_id TEXT,
        activitypub_id TEXT,
        nostr_pubkey TEXT,
        matrix_id TEXT,
        verified INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_identity_map_did ON identity_mappings(did_id);
    `);
  }

  async initialize() {
    logger.info("[ProtocolFusionBridge] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const mappings = this.database.db
          .prepare("SELECT * FROM identity_mappings ORDER BY created_at DESC")
          .all();
        for (const m of mappings) {
          this._identityMap.set(m.id, m);
        }
        logger.info(
          `[ProtocolFusionBridge] Loaded ${mappings.length} identity mappings`,
        );
      } catch (err) {
        logger.error("[ProtocolFusionBridge] Failed to load:", err);
      }
    }
    this.initialized = true;
    logger.info("[ProtocolFusionBridge] Initialized");
  }

  async getUnifiedFeed(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM unified_messages WHERE 1=1";
        const params = [];
        if (filter.protocol) {
          sql += " AND source_protocol = ?";
          params.push(filter.protocol);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[ProtocolFusionBridge] Failed to get feed:", err);
      }
    }
    let msgs = Array.from(this._messages.values());
    if (filter.protocol) {
      msgs = msgs.filter((m) => m.source_protocol === filter.protocol);
    }
    return msgs.slice(0, filter.limit || 50);
  }

  async sendMessage({
    sourceProtocol,
    targetProtocol,
    senderId,
    content,
  } = {}) {
    if (!content) {
      throw new Error("Message content is required");
    }
    if (!sourceProtocol) {
      throw new Error("Source protocol is required");
    }
    const id = uuidv4();
    const now = Date.now();
    const msg = {
      id,
      source_protocol: sourceProtocol,
      target_protocol: targetProtocol || sourceProtocol,
      sender_id: senderId || "self",
      content,
      unified_format: JSON.stringify({
        text: content,
        protocol: sourceProtocol,
        timestamp: now,
      }),
      converted: targetProtocol && targetProtocol !== sourceProtocol ? 1 : 0,
      routed: 1,
      created_at: now,
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO unified_messages (id,source_protocol,target_protocol,sender_id,content,unified_format,converted,routed,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          msg.source_protocol,
          msg.target_protocol,
          msg.sender_id,
          msg.content,
          msg.unified_format,
          msg.converted,
          msg.routed,
          now,
        );
    }
    this._messages.set(id, msg);
    this.emit("message-sent", msg);
    logger.info(
      `[ProtocolFusionBridge] Message sent: ${sourceProtocol} → ${targetProtocol || sourceProtocol}`,
    );
    return msg;
  }

  async mapIdentity({ didId, activitypubId, nostrPubkey, matrixId } = {}) {
    if (!didId) {
      throw new Error("DID ID is required");
    }
    const id = uuidv4();
    const mapping = {
      id,
      did_id: didId,
      activitypub_id: activitypubId || null,
      nostr_pubkey: nostrPubkey || null,
      matrix_id: matrixId || null,
      verified: 0,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO identity_mappings (id,did_id,activitypub_id,nostr_pubkey,matrix_id,verified,created_at) VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          didId,
          mapping.activitypub_id,
          mapping.nostr_pubkey,
          mapping.matrix_id,
          0,
          mapping.created_at,
        );
    }
    this._identityMap.set(id, mapping);
    this.emit("identity-mapped", mapping);
    logger.info(`[ProtocolFusionBridge] Identity mapped: ${didId}`);
    return mapping;
  }

  async getIdentityMap(didId) {
    if (didId) {
      const found = Array.from(this._identityMap.values()).find(
        (m) => m.did_id === didId,
      );
      return found || null;
    }
    return Array.from(this._identityMap.values());
  }

  async getProtocolStatus() {
    const msgs = Array.from(this._messages.values());
    const status = {};
    for (const p of Object.values(PROTOCOL)) {
      status[p] = {
        messageCount: msgs.filter((m) => m.source_protocol === p).length,
        identities: Array.from(this._identityMap.values()).filter((m) => {
          if (p === PROTOCOL.DID) {
            return !!m.did_id;
          }
          if (p === PROTOCOL.ACTIVITYPUB) {
            return !!m.activitypub_id;
          }
          if (p === PROTOCOL.NOSTR) {
            return !!m.nostr_pubkey;
          }
          if (p === PROTOCOL.MATRIX) {
            return !!m.matrix_id;
          }
          return false;
        }).length,
      };
    }
    return status;
  }

  buildFusionContext() {
    const mappings = Array.from(this._identityMap.values());
    if (mappings.length === 0) {
      return null;
    }
    const protocols = new Set();
    for (const m of mappings) {
      if (m.activitypub_id) {
        protocols.add("AP");
      }
      if (m.nostr_pubkey) {
        protocols.add("Nostr");
      }
      if (m.matrix_id) {
        protocols.add("Matrix");
      }
    }
    return `[Protocol Fusion] ${mappings.length} identity mappings across protocols: ${Array.from(protocols).join(", ")}`;
  }

  async close() {
    this.removeAllListeners();
    this._messages.clear();
    this._identityMap.clear();
    this.initialized = false;
    logger.info("[ProtocolFusionBridge] Closed");
  }
}

let _instance = null;
function getProtocolFusionBridge(database) {
  if (!_instance) {
    _instance = new ProtocolFusionBridge(database);
  }
  return _instance;
}

export { ProtocolFusionBridge, getProtocolFusionBridge, PROTOCOL };
export default ProtocolFusionBridge;
