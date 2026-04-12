/**
 * Nostr Bridge
 *
 * NIP-01 compatible Nostr relay bridge:
 * - Relay connection management (add/remove/connect/disconnect)
 * - Event publishing and retrieval
 * - NIP-01 event serialization
 * - Local event storage with SQLite
 *
 * @module social/nostr-bridge
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

// ============================================================
// Constants
// ============================================================

const EVENT_KINDS = {
  SET_METADATA: 0,
  TEXT_NOTE: 1,
  RECOMMEND_RELAY: 2,
  CONTACTS: 3,
  ENCRYPTED_DM: 4,
  DELETE: 5,
  REPOST: 6,
  REACTION: 7,
};

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 60000;

// ============================================================
// NostrBridge
// ============================================================

class NostrBridge extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._relays = new Map(); // relayUrl → { ws, status, subscriptions }
    this._subscriptions = new Map();
    this._eventBuffer = [];
    this._reconnectTimers = new Map();
    this._reconnectAttempts = new Map();
  }

  /**
   * Initialize the Nostr bridge
   */
  async initialize() {
    logger.info("[NostrBridge] Initializing Nostr bridge...");
    this._ensureTables();
    await this._loadSavedRelays();
    this.initialized = true;
    logger.info("[NostrBridge] Nostr bridge initialized successfully");
  }

  /**
   * Create database tables for Nostr relay and event storage
   */
  _ensureTables() {
    if (!this.database || !this.database.db) {
      logger.warn("[NostrBridge] Database not available");
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS nostr_relays (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'disconnected',
        last_connected INTEGER,
        event_count INTEGER DEFAULT 0,
        read_enabled INTEGER DEFAULT 1,
        write_enabled INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_nostr_relays_url ON nostr_relays(url);
      CREATE INDEX IF NOT EXISTS idx_nostr_relays_status ON nostr_relays(status);

      CREATE TABLE IF NOT EXISTS nostr_events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        kind INTEGER NOT NULL,
        content TEXT,
        tags TEXT,
        sig TEXT,
        created_at INTEGER NOT NULL,
        relay_url TEXT,
        imported INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_nostr_events_pubkey ON nostr_events(pubkey);
      CREATE INDEX IF NOT EXISTS idx_nostr_events_kind ON nostr_events(kind);
      CREATE INDEX IF NOT EXISTS idx_nostr_events_created_at ON nostr_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_nostr_events_relay_url ON nostr_events(relay_url);
    `);

    logger.info("[NostrBridge] Database tables ensured");
  }

  /**
   * Load saved relays from database
   */
  async _loadSavedRelays() {
    if (!this.database || !this.database.db) {
      return;
    }

    try {
      const stmt = this.database.db.prepare("SELECT * FROM nostr_relays");
      const relays = stmt.all();
      for (const relay of relays) {
        this._relays.set(relay.url, {
          ws: null,
          status: "disconnected",
          subscriptions: new Set(),
        });
      }
      logger.info(`[NostrBridge] Loaded ${relays.length} saved relays`);
    } catch (err) {
      logger.error("[NostrBridge] Failed to load saved relays:", err);
    }
  }

  /**
   * Add a relay to the pool
   * @param {string} url - WebSocket URL (ws:// or wss://)
   * @returns {Object} result
   */
  async addRelay(url) {
    if (!url || (!url.startsWith("ws://") && !url.startsWith("wss://"))) {
      throw new Error(
        `Invalid relay URL: ${url}. Must start with ws:// or wss://`,
      );
    }

    if (this._relays.has(url)) {
      return { success: false, message: "Relay already exists" };
    }

    const id = uuidv4();
    this._relays.set(url, {
      ws: null,
      status: "disconnected",
      subscriptions: new Set(),
    });

    if (this.database && this.database.db) {
      try {
        const stmt = this.database.db.prepare(
          "INSERT OR IGNORE INTO nostr_relays (id, url, status) VALUES (?, ?, ?)",
        );
        stmt.run(id, url, "disconnected");
      } catch (err) {
        logger.error("[NostrBridge] Failed to save relay to DB:", err);
      }
    }

    this.emit("relay:added", { url });
    logger.info(`[NostrBridge] Relay added: ${url}`);
    return { success: true, url };
  }

  /**
   * Remove a relay from the pool
   * @param {string} url - Relay URL to remove
   * @returns {Object} result
   */
  async removeRelay(url) {
    const relay = this._relays.get(url);
    if (!relay) {
      return { success: false, message: "Relay not found" };
    }

    // Cancel reconnect and disconnect
    this._cancelReconnect(url);
    if (relay.ws) {
      try {
        relay.ws.close();
      } catch (_err) {
        // Intentionally empty - relay may already be closed
      }
    }

    this._relays.delete(url);

    if (this.database && this.database.db) {
      try {
        const stmt = this.database.db.prepare(
          "DELETE FROM nostr_relays WHERE url = ?",
        );
        stmt.run(url);
      } catch (err) {
        logger.error("[NostrBridge] Failed to remove relay from DB:", err);
      }
    }

    this.emit("relay:removed", { url });
    logger.info(`[NostrBridge] Relay removed: ${url}`);
    return { success: true, url };
  }

  /**
   * Connect to a relay via WebSocket
   * @param {string} url - Relay URL
   * @returns {Object} result
   */
  async connectRelay(url) {
    const relay = this._relays.get(url);
    if (!relay) {
      throw new Error(`Relay not found: ${url}`);
    }

    if (relay.status === "connected") {
      return { success: true, message: "Already connected" };
    }

    // Cancel any pending reconnect for this relay
    this._cancelReconnect(url);

    logger.info(`[NostrBridge] Connecting to relay: ${url}`);
    relay.status = "connecting";
    this.emit("relay:connecting", { url });

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);

        const connectTimeout = setTimeout(() => {
          ws.terminate();
          relay.status = "error";
          reject(new Error(`Connection timeout for relay: ${url}`));
        }, 10000);

        ws.on("open", () => {
          clearTimeout(connectTimeout);
          relay.ws = ws;
          relay.status = "connected";
          this._reconnectAttempts.delete(url);

          if (this.database && this.database.db) {
            try {
              this.database.db
                .prepare(
                  "UPDATE nostr_relays SET status = ?, last_connected = ? WHERE url = ?",
                )
                .run("connected", Date.now(), url);
            } catch (err) {
              logger.error("[NostrBridge] Failed to update relay status:", err);
            }
          }

          this.emit("relay:connected", { url });
          logger.info(`[NostrBridge] Connected to relay: ${url}`);
          resolve({ success: true, url, status: "connected" });
        });

        ws.on("message", (data) => {
          this._handleRelayMessage(url, data);
        });

        ws.on("close", () => {
          relay.ws = null;
          relay.status = "disconnected";
          this.emit("relay:disconnected", { url });
          logger.info(`[NostrBridge] Disconnected from relay: ${url}`);
          this._scheduleReconnect(url);
        });

        ws.on("error", (err) => {
          clearTimeout(connectTimeout);
          relay.status = "error";
          logger.error(
            `[NostrBridge] WebSocket error for ${url}:`,
            err.message,
          );
          this.emit("relay:error", { url, error: err.message });
        });
      } catch (err) {
        relay.status = "error";
        logger.error(`[NostrBridge] Failed to connect to relay ${url}:`, err);
        reject(err);
      }
    });
  }

  /**
   * Handle incoming NIP-01 relay message
   * @param {string} url - Relay URL
   * @param {Buffer|string} data - Raw WebSocket message
   */
  _handleRelayMessage(url, data) {
    try {
      const message = JSON.parse(
        typeof data === "string" ? data : data.toString("utf8"),
      );
      if (!Array.isArray(message) || message.length < 2) {
        return;
      }

      const [type] = message;

      switch (type) {
        case "EVENT": {
          // ["EVENT", <subscription_id>, <event JSON>]
          const [, subscriptionId, event] = message;
          if (event && event.id) {
            this._storeIncomingEvent(event, url);
            this.emit("event:received", {
              event,
              subscriptionId,
              relayUrl: url,
            });
          }
          break;
        }
        case "EOSE": {
          // ["EOSE", <subscription_id>] — End of stored events
          const [, subscriptionId] = message;
          this.emit("subscription:eose", { subscriptionId, relayUrl: url });
          break;
        }
        case "OK": {
          // ["OK", <event_id>, <accepted>, <message>]
          const [, eventId, accepted, reason] = message;
          this.emit("event:status", {
            eventId,
            accepted,
            reason,
            relayUrl: url,
          });
          break;
        }
        case "NOTICE": {
          // ["NOTICE", <message>]
          const [, notice] = message;
          logger.info(`[NostrBridge] Notice from ${url}: ${notice}`);
          this.emit("relay:notice", { notice, relayUrl: url });
          break;
        }
        default:
          logger.debug(
            `[NostrBridge] Unknown message type from ${url}: ${type}`,
          );
      }
    } catch (err) {
      logger.error(
        `[NostrBridge] Failed to parse message from ${url}:`,
        err.message,
      );
    }
  }

  /**
   * Store an event received from a relay
   * @param {Object} event - Nostr event
   * @param {string} relayUrl - Source relay URL
   */
  _storeIncomingEvent(event, relayUrl) {
    if (!this.database || !this.database.db) {
      return;
    }
    try {
      this.database.db
        .prepare(
          `INSERT OR IGNORE INTO nostr_events (id, pubkey, kind, content, tags, sig, created_at, relay_url, imported)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          event.id,
          event.pubkey,
          event.kind,
          event.content || "",
          JSON.stringify(event.tags || []),
          event.sig || "",
          event.created_at,
          relayUrl,
        );
    } catch (err) {
      logger.error(
        "[NostrBridge] Failed to store incoming event:",
        err.message,
      );
    }
  }

  /**
   * Schedule reconnect with exponential backoff
   * @param {string} url - Relay URL
   */
  _scheduleReconnect(url) {
    if (!this._relays.has(url)) {
      return;
    }
    const attempts = this._reconnectAttempts.get(url) || 0;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, attempts),
      RECONNECT_MAX_DELAY,
    );
    this._reconnectAttempts.set(url, attempts + 1);

    logger.info(
      `[NostrBridge] Scheduling reconnect to ${url} in ${delay}ms (attempt ${attempts + 1})`,
    );
    const timer = setTimeout(async () => {
      this._reconnectTimers.delete(url);
      if (this._relays.has(url)) {
        try {
          await this.connectRelay(url);
        } catch (err) {
          logger.error(
            `[NostrBridge] Reconnect to ${url} failed:`,
            err.message,
          );
        }
      }
    }, delay);
    this._reconnectTimers.set(url, timer);
  }

  /**
   * Cancel pending reconnect for a relay
   * @param {string} url - Relay URL
   */
  _cancelReconnect(url) {
    const timer = this._reconnectTimers.get(url);
    if (timer) {
      clearTimeout(timer);
      this._reconnectTimers.delete(url);
    }
    this._reconnectAttempts.delete(url);
  }

  /**
   * Disconnect from a relay
   * @param {string} url - Relay URL
   * @returns {Object} result
   */
  async disconnectRelay(url) {
    const relay = this._relays.get(url);
    if (!relay) {
      return { success: false, message: "Relay not found" };
    }

    // Cancel any pending reconnect — intentional disconnect should not auto-reconnect
    this._cancelReconnect(url);

    if (relay.ws) {
      try {
        // Remove close listener to prevent auto-reconnect on intentional disconnect
        relay.ws.removeAllListeners("close");
        relay.ws.close();
      } catch (_err) {
        // Intentionally empty - connection may already be closed
      }
      relay.ws = null;
    }

    relay.status = "disconnected";
    relay.subscriptions.clear();

    if (this.database && this.database.db) {
      try {
        const stmt = this.database.db.prepare(
          "UPDATE nostr_relays SET status = ? WHERE url = ?",
        );
        stmt.run("disconnected", url);
      } catch (err) {
        logger.error("[NostrBridge] Failed to update relay status:", err);
      }
    }

    this.emit("relay:disconnected", { url });
    logger.info(`[NostrBridge] Disconnected from relay: ${url}`);
    return { success: true, url, status: "disconnected" };
  }

  /**
   * Publish a Nostr event to write-enabled relays
   * @param {Object} params - Event parameters
   * @param {number} params.kind - Event kind (see EVENT_KINDS)
   * @param {string} params.content - Event content
   * @param {Array} [params.tags] - Event tags
   * @param {string} [params.pubkey] - Author public key hex
   * @returns {Object} Published event
   */
  async publishEvent({ kind, content, tags = [], pubkey }) {
    if (kind === undefined || kind === null) {
      throw new Error("Event kind is required");
    }

    const authorPubkey = pubkey || crypto.randomBytes(32).toString("hex");
    const createdAt = Math.floor(Date.now() / 1000);

    // NIP-01 event structure
    const event = {
      pubkey: authorPubkey,
      created_at: createdAt,
      kind,
      tags,
      content: content || "",
    };

    // Compute event ID: sha256 of serialized event
    const serialized = this._serializeEvent(event);
    const id = crypto
      .createHash("sha256")
      .update(JSON.stringify(serialized))
      .digest("hex");

    event.id = id;
    // Signature placeholder - real implementation would use secp256k1
    event.sig = crypto.randomBytes(64).toString("hex");

    // Send to write-enabled relays
    let sentCount = 0;
    for (const [relayUrl, relay] of this._relays) {
      if (
        relay.status === "connected" &&
        relay.ws &&
        relay.ws.readyState === WebSocket.OPEN
      ) {
        try {
          // NIP-01: ["EVENT", <event JSON>]
          const message = JSON.stringify(["EVENT", event]);
          relay.ws.send(message);
          sentCount++;
          logger.info(`[NostrBridge] Event sent to relay: ${relayUrl}`);

          // Update relay event count
          if (this.database && this.database.db) {
            try {
              const stmt = this.database.db.prepare(
                "UPDATE nostr_relays SET event_count = event_count + 1 WHERE url = ?",
              );
              stmt.run(relayUrl);
            } catch (_err) {
              // Intentionally empty - non-critical counter update
            }
          }
        } catch (err) {
          logger.error(
            `[NostrBridge] Failed to send event to ${relayUrl}:`,
            err,
          );
        }
      }
    }

    // Store event locally
    if (this.database && this.database.db) {
      try {
        const stmt = this.database.db.prepare(
          `INSERT OR IGNORE INTO nostr_events (id, pubkey, kind, content, tags, sig, created_at, relay_url, imported)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        stmt.run(
          event.id,
          event.pubkey,
          event.kind,
          event.content,
          JSON.stringify(event.tags),
          event.sig,
          event.created_at,
          null,
          0,
        );
      } catch (err) {
        logger.error("[NostrBridge] Failed to store event in DB:", err);
      }
    }

    this.emit("event:published", { event, sentCount });
    logger.info(
      `[NostrBridge] Event published: ${id} (sent to ${sentCount} relays)`,
    );

    return { success: true, event, sentCount };
  }

  /**
   * Get events from local database
   * @param {Object} params - Query parameters
   * @param {Array<number>} [params.kinds] - Filter by event kinds
   * @param {number} [params.limit=50] - Max results
   * @param {number} [params.since] - Unix timestamp filter (events after)
   * @returns {Array} Events
   */
  async getEvents({ kinds, limit = 50, since } = {}) {
    if (!this.database || !this.database.db) {
      return [];
    }

    try {
      let sql = "SELECT * FROM nostr_events WHERE 1=1";
      const params = [];

      if (kinds && kinds.length > 0) {
        const placeholders = kinds.map(() => "?").join(",");
        sql += ` AND kind IN (${placeholders})`;
        params.push(...kinds);
      }

      if (since) {
        sql += " AND created_at >= ?";
        params.push(since);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.database.db.prepare(sql);
      const rows = stmt.all(...params);

      // Parse tags JSON
      return rows.map((row) => ({
        ...row,
        tags: row.tags ? JSON.parse(row.tags) : [],
      }));
    } catch (err) {
      logger.error("[NostrBridge] Failed to get events:", err);
      return [];
    }
  }

  /**
   * List all relays with their status
   * @returns {Array} Relay list
   */
  async listRelays() {
    if (this.database && this.database.db) {
      try {
        const stmt = this.database.db.prepare(
          "SELECT * FROM nostr_relays ORDER BY url",
        );
        const dbRelays = stmt.all();

        // Merge with in-memory status
        return dbRelays.map((relay) => {
          const memRelay = this._relays.get(relay.url);
          return {
            ...relay,
            status: memRelay ? memRelay.status : relay.status,
            connected: memRelay ? memRelay.status === "connected" : false,
          };
        });
      } catch (err) {
        logger.error("[NostrBridge] Failed to list relays from DB:", err);
      }
    }

    // Fallback to in-memory relays
    const relays = [];
    for (const [url, relay] of this._relays) {
      relays.push({
        url,
        status: relay.status,
        connected: relay.status === "connected",
      });
    }
    return relays;
  }

  /**
   * NIP-01 event serialization
   * [0, <pubkey>, <created_at>, <kind>, <tags>, <content>]
   * @param {Object} event - Nostr event
   * @returns {Array} Serialized event array
   */
  _serializeEvent(event) {
    return [
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ];
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getNostrBridge(database) {
  if (!_instance) {
    _instance = new NostrBridge(database);
  }
  return _instance;
}

export { NostrBridge, getNostrBridge, EVENT_KINDS };
export default NostrBridge;
