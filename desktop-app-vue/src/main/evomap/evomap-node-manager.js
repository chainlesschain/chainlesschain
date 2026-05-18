/**
 * EvoMap Node Manager
 *
 * Manages node identity, heartbeat lifecycle, and credits for the
 * EvoMap GEP-A2A protocol. Maps the local DID identity to an EvoMap
 * node_id and maintains the connection with the Hub.
 *
 * @module evomap/evomap-node-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const EventEmitter = require("events");

const DEFAULT_HEARTBEAT_INTERVAL = 900000; // 15 minutes

/**
 * EvoMapNodeManager - Singleton manager for EvoMap node lifecycle
 */
class EvoMapNodeManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.didManager = null;
    this.hookSystem = null;
    this.initialized = false;

    // Runtime state
    this._nodeId = null;
    this._credits = 0;
    this._reputation = 0;
    this._registered = false;
    this._lastHeartbeat = null;
    this._heartbeatTimer = null;
    this._heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL;
  }

  /**
   * Initialize the node manager
   * @param {Object} db - Database manager instance
   * @param {Object} didManager - DID identity manager instance
   * @param {Object} hookSystem - HookSystem instance (optional)
   */
  async initialize(db, didManager, hookSystem = null) {
    if (this.initialized) {
      logger.warn("[EvoMapNodeManager] Already initialized");
      return;
    }

    this.db = db;
    this.didManager = didManager;
    this.hookSystem = hookSystem;

    this._ensureTables();

    // Load persisted node state
    await this._loadNodeState();

    this.initialized = true;
    logger.info(
      `[EvoMapNodeManager] Initialized (nodeId: ${this._nodeId || "not registered"})`,
    );
  }

  /**
   * Shut down the node manager
   */
  async shutdown() {
    this.stopHeartbeat();
    this.initialized = false;
    logger.info("[EvoMapNodeManager] Shut down");
  }

  // ============================================================
  // Database Schema
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS evomap_node (
          id TEXT PRIMARY KEY DEFAULT 'default',
          node_id TEXT NOT NULL,
          did TEXT,
          credits REAL DEFAULT 0,
          reputation REAL DEFAULT 0,
          claim_code TEXT,
          hub_node_id TEXT,
          heartbeat_interval_ms INTEGER DEFAULT ${DEFAULT_HEARTBEAT_INTERVAL},
          last_heartbeat TEXT,
          registered_at TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS evomap_assets (
          asset_id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT DEFAULT 'local',
          direction TEXT DEFAULT 'local',
          content TEXT NOT NULL,
          summary TEXT,
          local_source_id TEXT,
          local_source_type TEXT,
          gdi_score REAL,
          fetch_count INTEGER DEFAULT 0,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_evomap_assets_type ON evomap_assets(type);
        CREATE INDEX IF NOT EXISTS idx_evomap_assets_status ON evomap_assets(status);
        CREATE INDEX IF NOT EXISTS idx_evomap_assets_direction ON evomap_assets(direction);

        CREATE TABLE IF NOT EXISTS evomap_sync_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          asset_id TEXT,
          status TEXT,
          details TEXT,
          created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_evomap_sync_action ON evomap_sync_log(action);
      `);

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }

      logger.info("[EvoMapNodeManager] Database tables ensured");
    } catch (error) {
      logger.error("[EvoMapNodeManager] Table creation error:", error.message);
    }
  }

  // ============================================================
  // Node Identity
  // ============================================================

  /**
   * Get or create a persistent node ID
   * @returns {string} "node_<hex>"
   */
  getOrCreateNodeId() {
    if (this._nodeId) {
      return this._nodeId;
    }

    // Generate a new node ID
    const randomBytes = crypto.randomBytes(16).toString("hex");
    this._nodeId = `node_${randomBytes}`;

    // Get linked DID if available
    let did = null;
    if (this.didManager) {
      try {
        const identity = this.didManager.getCurrentIdentity?.() || null;
        did = identity?.did || null;
      } catch (_e) {
        // DID manager may not be ready
      }
    }

    const now = new Date().toISOString();

    try {
      this.db.run(
        `INSERT OR REPLACE INTO evomap_node (id, node_id, did, credits, reputation, registered_at, updated_at)
         VALUES ('default', ?, ?, 0, 0, ?, ?)`,
        [this._nodeId, did, now, now],
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (error) {
      logger.error(
        "[EvoMapNodeManager] Failed to persist node ID:",
        error.message,
      );
    }

    logger.info(`[EvoMapNodeManager] Created node ID: ${this._nodeId}`);
    return this._nodeId;
  }

  /**
   * Register with the Hub via hello handshake
   * @param {Object} client - EvoMapClient instance
   * @returns {Promise<Object>} { nodeId, credits, claimCode }
   */
  async registerNode(client) {
    if (!client) {
      return { success: false, error: "EvoMap client is required" };
    }

    const nodeId = this.getOrCreateNodeId();
    client.setSenderId(nodeId);

    const result = await client.hello();

    if (!result.success) {
      this._logSync("heartbeat", null, "failed", { error: result.error });
      return result;
    }

    const data = result.data;
    const now = new Date().toISOString();

    // Update local state
    this._registered = true;
    this._credits = data.credits || 0;
    this._heartbeatInterval =
      data.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL;

    // Persist
    try {
      this.db.run(
        `UPDATE evomap_node SET
          credits = ?, reputation = ?, claim_code = ?, hub_node_id = ?,
          heartbeat_interval_ms = ?, last_heartbeat = ?, updated_at = ?
         WHERE id = 'default'`,
        [
          this._credits,
          this._reputation,
          data.claim_code || null,
          data.hub_node_id || null,
          this._heartbeatInterval,
          now,
          now,
        ],
      );

      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (error) {
      logger.error(
        "[EvoMapNodeManager] Failed to persist registration:",
        error.message,
      );
    }

    this._logSync("heartbeat", null, "success", { credits: this._credits });

    this.emit("registered", {
      nodeId: this._nodeId,
      credits: this._credits,
      claimCode: data.claim_code,
    });

    logger.info(
      `[EvoMapNodeManager] Registered with Hub (credits: ${this._credits})`,
    );

    return {
      success: true,
      data: {
        nodeId: this._nodeId,
        credits: this._credits,
        claimCode: data.claim_code,
      },
    };
  }

  /**
   * Get current node status
   * @returns {Object}
   */
  getNodeStatus() {
    return {
      nodeId: this._nodeId,
      credits: this._credits,
      reputation: this._reputation,
      registered: this._registered,
      lastHeartbeat: this._lastHeartbeat || null,
      heartbeatInterval: this._heartbeatInterval,
      initialized: this.initialized,
    };
  }

  // ============================================================
  // Heartbeat
  // ============================================================

  /**
   * Start periodic heartbeat
   * @param {Object} client - EvoMapClient instance
   */
  startHeartbeat(client) {
    if (this._heartbeatTimer) {
      logger.warn("[EvoMapNodeManager] Heartbeat already running");
      return;
    }

    this._heartbeatClient = client;

    this._heartbeatTimer = setInterval(() => {
      this._heartbeatLoop().catch((err) =>
        logger.error("[EvoMapNodeManager] Heartbeat error:", err.message),
      );
    }, this._heartbeatInterval);

    logger.info(
      `[EvoMapNodeManager] Heartbeat started (interval: ${this._heartbeatInterval}ms)`,
    );
  }

  /**
   * Stop periodic heartbeat
   */
  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
      this._heartbeatClient = null;
      logger.info("[EvoMapNodeManager] Heartbeat stopped");
    }
  }

  /**
   * Execute a single heartbeat
   * @private
   */
  async _heartbeatLoop() {
    if (!this._heartbeatClient || !this._nodeId) {
      return;
    }

    const result = await this._heartbeatClient.hello();
    const now = new Date().toISOString();
    this._lastHeartbeat = now;

    if (result.success) {
      const data = result.data;
      const oldCredits = this._credits;
      this._credits = data.credits || this._credits;

      try {
        this.db.run(
          `UPDATE evomap_node SET credits = ?, last_heartbeat = ?, updated_at = ?
           WHERE id = 'default'`,
          [this._credits, now, now],
        );
      } catch (_e) {
        // non-critical
      }

      if (this._credits !== oldCredits) {
        this.emit("credits-updated", {
          credits: this._credits,
          previous: oldCredits,
        });
      }

      this.emit("heartbeat", { credits: this._credits, timestamp: now });
    } else {
      this.emit("offline", { error: result.error, timestamp: now });
      this._logSync("heartbeat", null, "failed", { error: result.error });
    }
  }

  // ============================================================
  // Credits
  // ============================================================

  /**
   * Refresh credits from Hub
   * @param {Object} client - EvoMapClient instance
   * @returns {Promise<number>} Current credits
   */
  async refreshCredits(client) {
    if (!client || !this._nodeId) {
      return this._credits;
    }

    const result = await client.getNodeInfo(this._nodeId);
    if (result.success && result.data) {
      this._credits = result.data.credits || this._credits;
      this._reputation = result.data.reputation || this._reputation;

      try {
        const now = new Date().toISOString();
        this.db.run(
          `UPDATE evomap_node SET credits = ?, reputation = ?, updated_at = ?
           WHERE id = 'default'`,
          [this._credits, this._reputation, now],
        );
      } catch (_e) {
        // non-critical
      }
    }

    return this._credits;
  }

  /**
   * Get current credits
   * @returns {number}
   */
  getCredits() {
    return this._credits;
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * Load persisted node state from database
   * @private
   */
  async _loadNodeState() {
    try {
      const row = this.db
        .prepare("SELECT * FROM evomap_node WHERE id = ?")
        .get("default");

      if (row) {
        this._nodeId = row.node_id;
        this._credits = row.credits || 0;
        this._reputation = row.reputation || 0;
        this._heartbeatInterval =
          row.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL;
        this._lastHeartbeat = row.last_heartbeat || null;
        this._registered = !!row.registered_at;

        logger.info(`[EvoMapNodeManager] Loaded node state: ${this._nodeId}`);
      }
    } catch (error) {
      logger.warn(
        "[EvoMapNodeManager] No persisted node state:",
        error.message,
      );
    }
  }

  /**
   * Log a sync action
   * @private
   * @param {string} action
   * @param {string|null} assetId
   * @param {string} status
   * @param {Object} details
   */
  _logSync(action, assetId, status, details = {}) {
    try {
      this.db.run(
        `INSERT INTO evomap_sync_log (id, action, asset_id, status, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          action,
          assetId,
          status,
          JSON.stringify(details),
          new Date().toISOString(),
        ],
      );
    } catch (_e) {
      // non-critical
    }
  }
}

// ==================== Singleton Support ====================

let _instance = null;

/**
 * Get or create a singleton EvoMapNodeManager instance
 * @returns {EvoMapNodeManager}
 */
function getEvoMapNodeManager() {
  if (!_instance) {
    _instance = new EvoMapNodeManager();
  }
  return _instance;
}

module.exports = {
  EvoMapNodeManager,
  getEvoMapNodeManager,
};
