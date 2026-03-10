/**
 * IPFS Cluster Manager — Distributed Pin Management & Node Orchestration
 *
 * Manages a cluster of IPFS nodes with automated pin replication,
 * health monitoring, and rebalancing. Provides:
 * - Node lifecycle: add / remove / heartbeat / health checks
 * - Content pinning: pin / unpin with configurable replication factor
 * - Cluster-wide rebalancing for even load distribution
 * - Health event logging and statistics
 *
 * @module ai-engine/cowork/ipfs-cluster-manager
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const NODE_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  DEGRADED: "degraded",
  MAINTENANCE: "maintenance",
};

const PIN_STATUS = {
  PINNING: "pinning",
  PINNED: "pinned",
  UNPINNING: "unpinning",
  UNPINNED: "unpinned",
  FAILED: "failed",
};

const HEALTH_EVENT = {
  NODE_JOINED: "node_joined",
  NODE_LEFT: "node_left",
  NODE_DEGRADED: "node_degraded",
  REPLICATION_FAILED: "replication_failed",
  REBALANCE_STARTED: "rebalance_started",
  REBALANCE_COMPLETED: "rebalance_completed",
};

const DEFAULT_CONFIG = {
  defaultReplicationFactor: 3,
  defaultReplicationMin: 1,
  heartbeatIntervalMs: 30000,
  heartbeatTimeoutMs: 90000,
  rebalanceThreshold: 0.2,
  maxPinsPerNode: 10000,
  cleanupIntervalMs: 60000,
};

// ============================================================
// IPFSClusterManager Class
// ============================================================

class IPFSClusterManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };

    // In-memory caches
    this._nodes = new Map(); // nodeId → node object
    this._pins = new Map(); // pinId → pin object

    // Dependencies
    this._ipfsManager = null;
    this._agentRegistry = null;
    this._filecoinStorage = null;

    // Timers
    this._cleanupTimer = null;
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database manager (better-sqlite3 compatible)
   * @param {Object} deps - Optional dependencies
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ipfsManager = deps.ipfsManager || null;
    this._agentRegistry = deps.agentRegistry || null;
    this._filecoinStorage = deps.filecoinStorage || null;

    this._ensureTables();
    this._loadNodes();
    this._loadPins();
    this._startCleanupTimer();

    this.initialized = true;

    logger.info(
      `[IPFS Cluster] Initialized: ${this._nodes.size} nodes, ${this._pins.size} pins`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ipfs_cluster_nodes (
          id TEXT PRIMARY KEY,
          peer_id TEXT UNIQUE NOT NULL,
          endpoint TEXT NOT NULL,
          status TEXT DEFAULT 'online',
          region TEXT,
          storage_capacity INTEGER DEFAULT 0,
          storage_used INTEGER DEFAULT 0,
          pin_count INTEGER DEFAULT 0,
          last_heartbeat TEXT DEFAULT (datetime('now')),
          joined_at TEXT DEFAULT (datetime('now')),
          metadata TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS ipfs_cluster_pins (
          id TEXT PRIMARY KEY,
          cid TEXT NOT NULL,
          name TEXT,
          replication_factor INTEGER DEFAULT 3,
          replication_min INTEGER DEFAULT 1,
          current_replicas INTEGER DEFAULT 0,
          pin_status TEXT DEFAULT 'pinning',
          allocations TEXT DEFAULT '[]',
          metadata TEXT DEFAULT '{}',
          priority INTEGER DEFAULT 0,
          expire_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS ipfs_cluster_health_log (
          id TEXT PRIMARY KEY,
          node_id TEXT,
          event_type TEXT NOT NULL,
          details TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to create tables:", err.message);
    }
  }

  // ============================================================
  // Data Loading
  // ============================================================

  _loadNodes() {
    if (!this.db) {
      return;
    }
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM ipfs_cluster_nodes WHERE status != 'offline'",
      );
      const rows = stmt.all();
      for (const row of rows) {
        const node = {
          ...row,
          metadata: JSON.parse(row.metadata || "{}"),
        };
        this._nodes.set(node.id, node);
      }
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to load nodes:", err.message);
    }
  }

  _loadPins() {
    if (!this.db) {
      return;
    }
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM ipfs_cluster_pins WHERE pin_status != 'unpinned'",
      );
      const rows = stmt.all();
      for (const row of rows) {
        const pin = {
          ...row,
          allocations: JSON.parse(row.allocations || "[]"),
          metadata: JSON.parse(row.metadata || "{}"),
        };
        this._pins.set(pin.id, pin);
      }
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to load pins:", err.message);
    }
  }

  // ============================================================
  // Node Management
  // ============================================================

  /**
   * Add a node to the cluster
   * @param {Object} options - Node options
   * @returns {Object} Created node
   */
  addNode(options = {}) {
    const {
      peerId,
      endpoint,
      region,
      storageCapacity = 0,
      metadata = {},
    } = options;

    if (!peerId || !endpoint) {
      throw new Error("peerId and endpoint are required");
    }

    // Check for duplicate peerId
    for (const node of this._nodes.values()) {
      if (node.peer_id === peerId) {
        throw new Error(`Node with peerId ${peerId} already exists`);
      }
    }

    const node = {
      id: uuidv4(),
      peer_id: peerId,
      endpoint,
      status: NODE_STATUS.ONLINE,
      region: region || null,
      storage_capacity: storageCapacity,
      storage_used: 0,
      pin_count: 0,
      last_heartbeat: new Date().toISOString(),
      joined_at: new Date().toISOString(),
      metadata,
    };

    this._nodes.set(node.id, node);
    this._persistNode(node);
    this._logHealthEvent(node.id, HEALTH_EVENT.NODE_JOINED, {
      peerId,
      endpoint,
      region,
    });

    this.emit("node:added", node);
    logger.info(`[IPFS Cluster] Node added: ${peerId} (${node.id})`);

    return node;
  }

  /**
   * Remove a node from the cluster
   * @param {string} nodeId - Node ID to remove
   * @returns {boolean} Whether the node was removed
   */
  removeNode(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node) {
      return false;
    }

    node.status = NODE_STATUS.OFFLINE;
    this._updateNode(nodeId, { status: NODE_STATUS.OFFLINE });

    // Reassign pins from removed node
    this._reassignPinsFromNode(nodeId);

    this._logHealthEvent(nodeId, HEALTH_EVENT.NODE_LEFT, {
      peerId: node.peer_id,
    });

    this._nodes.delete(nodeId);
    this.emit("node:removed", { nodeId, peerId: node.peer_id });
    logger.info(`[IPFS Cluster] Node removed: ${node.peer_id} (${nodeId})`);

    return true;
  }

  /**
   * List cluster nodes with optional filters
   * @param {Object} filter - Filter criteria
   * @returns {Array} Filtered node list
   */
  listNodes(filter = {}) {
    let nodes = Array.from(this._nodes.values());

    if (filter.status) {
      nodes = nodes.filter((n) => n.status === filter.status);
    }
    if (filter.region) {
      nodes = nodes.filter((n) => n.region === filter.region);
    }

    return nodes;
  }

  /**
   * Get status of a specific node
   * @param {string} nodeId - Node ID
   * @returns {Object|null} Node with health info
   */
  getNodeStatus(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node) {
      return null;
    }

    const now = Date.now();
    const lastBeat = new Date(node.last_heartbeat).getTime();
    const timeSinceHeartbeat = now - lastBeat;

    return {
      ...node,
      healthy: timeSinceHeartbeat < this.config.heartbeatTimeoutMs,
      timeSinceHeartbeat,
    };
  }

  /**
   * Process heartbeat from a node
   * @param {string} nodeId - Node ID
   * @param {Object} metrics - Optional metrics update
   * @returns {Object} Acknowledgement
   */
  heartbeatNode(nodeId, metrics = {}) {
    const node = this._nodes.get(nodeId);
    if (!node) {
      return { acknowledged: false, error: "Node not found" };
    }

    node.last_heartbeat = new Date().toISOString();

    if (metrics.storageUsed !== undefined) {
      node.storage_used = metrics.storageUsed;
    }
    if (metrics.pinCount !== undefined) {
      node.pin_count = metrics.pinCount;
    }

    // Restore degraded nodes that heartbeat
    if (node.status === NODE_STATUS.DEGRADED) {
      node.status = NODE_STATUS.ONLINE;
    }

    this._updateNode(nodeId, {
      last_heartbeat: node.last_heartbeat,
      storage_used: node.storage_used,
      pin_count: node.pin_count,
      status: node.status,
    });

    return { acknowledged: true };
  }

  // ============================================================
  // Pin Management
  // ============================================================

  /**
   * Pin content across the cluster
   * @param {Object} options - Pin options
   * @returns {Object} Created pin record
   */
  pinContent(options = {}) {
    const {
      cid,
      name,
      replicationFactor = this.config.defaultReplicationFactor,
      replicationMin = this.config.defaultReplicationMin,
      priority = 0,
      metadata = {},
      expireAt,
    } = options;

    if (!cid) {
      throw new Error("cid is required");
    }

    const allocations = this._allocateNodes(replicationFactor);
    const currentReplicas = allocations.length;

    const pin = {
      id: uuidv4(),
      cid,
      name: name || null,
      replication_factor: replicationFactor,
      replication_min: replicationMin,
      current_replicas: currentReplicas,
      pin_status:
        currentReplicas >= replicationMin
          ? PIN_STATUS.PINNED
          : PIN_STATUS.PINNING,
      allocations,
      metadata,
      priority,
      expire_at: expireAt || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this._pins.set(pin.id, pin);
    this._persistPin(pin);

    // Update node pin counts
    for (const allocNodeId of allocations) {
      const allocNode = this._nodes.get(allocNodeId);
      if (allocNode) {
        allocNode.pin_count = (allocNode.pin_count || 0) + 1;
      }
    }

    this.emit("content:pinned", pin);
    logger.info(
      `[IPFS Cluster] Content pinned: ${cid} → ${currentReplicas} replicas`,
    );

    return pin;
  }

  /**
   * Unpin content from the cluster
   * @param {string} pinId - Pin ID
   * @returns {boolean} Whether the pin was removed
   */
  unpinContent(pinId) {
    const pin = this._pins.get(pinId);
    if (!pin) {
      return false;
    }

    // Decrement node pin counts
    for (const allocNodeId of pin.allocations) {
      const allocNode = this._nodes.get(allocNodeId);
      if (allocNode && allocNode.pin_count > 0) {
        allocNode.pin_count -= 1;
      }
    }

    pin.pin_status = PIN_STATUS.UNPINNED;
    pin.allocations = [];
    pin.current_replicas = 0;
    pin.updated_at = new Date().toISOString();

    this._updatePin(pinId, {
      pin_status: PIN_STATUS.UNPINNED,
      allocations: "[]",
      current_replicas: 0,
      updated_at: pin.updated_at,
    });

    this.emit("content:unpinned", { pinId, cid: pin.cid });
    logger.info(`[IPFS Cluster] Content unpinned: ${pin.cid}`);

    return true;
  }

  /**
   * Get status of a specific pin
   * @param {string} pinId - Pin ID
   * @returns {Object|null} Pin record
   */
  getPinStatus(pinId) {
    return this._pins.get(pinId) || null;
  }

  /**
   * List pins with optional filters
   * @param {Object} filter - Filter criteria
   * @returns {Array} Filtered pin list
   */
  listPins(filter = {}) {
    let pins = Array.from(this._pins.values());

    if (filter.pin_status) {
      pins = pins.filter((p) => p.pin_status === filter.pin_status);
    }
    if (filter.cid) {
      pins = pins.filter((p) => p.cid === filter.cid);
    }

    return pins;
  }

  // ============================================================
  // Cluster Operations
  // ============================================================

  /**
   * Rebalance pins across cluster nodes for even distribution
   * @returns {Object} Rebalance results
   */
  rebalance() {
    const startTime = Date.now();
    const onlineNodes = this.listNodes({ status: NODE_STATUS.ONLINE });

    if (onlineNodes.length === 0) {
      return { moved: 0, duration: 0 };
    }

    this._logHealthEvent(null, HEALTH_EVENT.REBALANCE_STARTED, {
      nodeCount: onlineNodes.length,
    });
    this.emit("cluster:rebalance:started");

    const totalPins = onlineNodes.reduce(
      (sum, n) => sum + (n.pin_count || 0),
      0,
    );
    const avgPins = Math.floor(totalPins / onlineNodes.length);
    const threshold = Math.ceil(avgPins * this.config.rebalanceThreshold);

    let moved = 0;

    // Sort nodes: overloaded first (desc), underloaded last (asc)
    const overloaded = onlineNodes
      .filter((n) => (n.pin_count || 0) > avgPins + threshold)
      .sort((a, b) => (b.pin_count || 0) - (a.pin_count || 0));

    const underloaded = onlineNodes
      .filter((n) => (n.pin_count || 0) < avgPins - threshold)
      .sort((a, b) => (a.pin_count || 0) - (b.pin_count || 0));

    for (const srcNode of overloaded) {
      for (const dstNode of underloaded) {
        while (
          (srcNode.pin_count || 0) > avgPins + threshold &&
          (dstNode.pin_count || 0) < avgPins
        ) {
          // Move one pin allocation from src to dst
          const pinToMove = this._findPinOnNode(srcNode.id);
          if (!pinToMove) {
            break;
          }

          pinToMove.allocations = pinToMove.allocations.filter(
            (id) => id !== srcNode.id,
          );
          pinToMove.allocations.push(dstNode.id);
          pinToMove.updated_at = new Date().toISOString();

          srcNode.pin_count = Math.max(0, (srcNode.pin_count || 0) - 1);
          dstNode.pin_count = (dstNode.pin_count || 0) + 1;

          moved++;
        }
      }
    }

    const duration = Date.now() - startTime;

    this._logHealthEvent(null, HEALTH_EVENT.REBALANCE_COMPLETED, {
      moved,
      duration,
    });
    this.emit("cluster:rebalanced", { moved, duration });
    logger.info(
      `[IPFS Cluster] Rebalance completed: ${moved} pins moved in ${duration}ms`,
    );

    return { moved, duration };
  }

  /**
   * Check health of all cluster nodes
   * @returns {Object} Health report
   */
  checkHealth() {
    const now = Date.now();
    let healthy = 0;
    let degraded = 0;
    let offline = 0;

    for (const node of this._nodes.values()) {
      if (node.status === NODE_STATUS.OFFLINE) {
        offline++;
        continue;
      }

      const lastBeat = new Date(node.last_heartbeat).getTime();
      const elapsed = now - lastBeat;

      if (elapsed > this.config.heartbeatTimeoutMs) {
        if (node.status !== NODE_STATUS.DEGRADED) {
          node.status = NODE_STATUS.DEGRADED;
          this._logHealthEvent(node.id, HEALTH_EVENT.NODE_DEGRADED, {
            elapsed,
            timeout: this.config.heartbeatTimeoutMs,
          });
        }
        degraded++;
      } else {
        healthy++;
      }
    }

    // Count under-replicated pins
    let underReplicatedPins = 0;
    for (const pin of this._pins.values()) {
      if (
        pin.pin_status !== PIN_STATUS.UNPINNED &&
        pin.current_replicas < pin.replication_min
      ) {
        underReplicatedPins++;
      }
    }

    return {
      healthy,
      degraded,
      offline,
      totalNodes: this._nodes.size,
      underReplicatedPins,
    };
  }

  /**
   * Get comprehensive cluster health including pin stats
   * @returns {Object} Full health report
   */
  getClusterHealth() {
    const health = this.checkHealth();

    let pinnedCount = 0;
    let pinningCount = 0;
    let failedCount = 0;

    for (const pin of this._pins.values()) {
      if (pin.pin_status === PIN_STATUS.PINNED) {
        pinnedCount++;
      } else if (pin.pin_status === PIN_STATUS.PINNING) {
        pinningCount++;
      } else if (pin.pin_status === PIN_STATUS.FAILED) {
        failedCount++;
      }
    }

    return {
      ...health,
      pinHealth: {
        pinned: pinnedCount,
        pinning: pinningCount,
        failed: failedCount,
        total: this._pins.size,
      },
    };
  }

  /**
   * Get cluster statistics
   * @returns {Object} Cluster stats
   */
  getStats() {
    let totalStorage = 0;
    let usedStorage = 0;
    let onlineNodes = 0;

    for (const node of this._nodes.values()) {
      totalStorage += node.storage_capacity || 0;
      usedStorage += node.storage_used || 0;
      if (node.status === NODE_STATUS.ONLINE) {
        onlineNodes++;
      }
    }

    let pinnedContent = 0;
    for (const pin of this._pins.values()) {
      if (pin.pin_status === PIN_STATUS.PINNED) {
        pinnedContent++;
      }
    }

    const health = this.checkHealth();

    return {
      totalNodes: this._nodes.size,
      onlineNodes,
      totalPins: this._pins.size,
      pinnedContent,
      totalStorage,
      usedStorage,
      replicationHealth:
        health.totalNodes > 0 ? health.healthy / health.totalNodes : 0,
    };
  }

  /**
   * Get current configuration
   * @returns {Object} Configuration copy
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   * @returns {Object} Updated configuration
   */
  configure(updates) {
    Object.assign(this.config, updates);
    logger.info("[IPFS Cluster] Configuration updated");
    return this.getConfig();
  }

  /**
   * Destroy instance and clean up resources
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    this._nodes.clear();
    this._pins.clear();
    this.initialized = false;
    this.removeAllListeners();

    logger.info("[IPFS Cluster] Destroyed");
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  _persistNode(node) {
    if (!this.db) {
      return;
    }
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO ipfs_cluster_nodes
        (id, peer_id, endpoint, status, region, storage_capacity, storage_used, pin_count, last_heartbeat, joined_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        node.id,
        node.peer_id,
        node.endpoint,
        node.status,
        node.region,
        node.storage_capacity,
        node.storage_used,
        node.pin_count,
        node.last_heartbeat,
        node.joined_at,
        JSON.stringify(node.metadata),
      );
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to persist node:", err.message);
    }
  }

  _updateNode(nodeId, updates) {
    if (!this.db) {
      return;
    }
    try {
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(updates);
      const stmt = this.db.prepare(
        `UPDATE ipfs_cluster_nodes SET ${fields} WHERE id = ?`,
      );
      stmt.run(...values, nodeId);
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to update node:", err.message);
    }
  }

  _persistPin(pin) {
    if (!this.db) {
      return;
    }
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO ipfs_cluster_pins
        (id, cid, name, replication_factor, replication_min, current_replicas, pin_status, allocations, metadata, priority, expire_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        pin.id,
        pin.cid,
        pin.name,
        pin.replication_factor,
        pin.replication_min,
        pin.current_replicas,
        pin.pin_status,
        JSON.stringify(pin.allocations),
        JSON.stringify(pin.metadata),
        pin.priority,
        pin.expire_at,
        pin.created_at,
        pin.updated_at,
      );
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to persist pin:", err.message);
    }
  }

  _updatePin(pinId, updates) {
    if (!this.db) {
      return;
    }
    try {
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(updates);
      const stmt = this.db.prepare(
        `UPDATE ipfs_cluster_pins SET ${fields} WHERE id = ?`,
      );
      stmt.run(...values, pinId);
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to update pin:", err.message);
    }
  }

  _logHealthEvent(nodeId, eventType, details = {}) {
    if (!this.db) {
      return;
    }
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ipfs_cluster_health_log (id, node_id, event_type, details)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(uuidv4(), nodeId, eventType, JSON.stringify(details));
    } catch (err) {
      logger.error("[IPFS Cluster] Failed to log health event:", err.message);
    }
  }

  /**
   * Allocate online nodes for pin replication, preferring nodes with most free capacity
   * @param {number} replicationFactor - Desired number of replicas
   * @returns {Array<string>} Array of node IDs
   */
  _allocateNodes(replicationFactor) {
    const onlineNodes = this.listNodes({ status: NODE_STATUS.ONLINE }).filter(
      (n) => (n.pin_count || 0) < this.config.maxPinsPerNode,
    );

    // Sort by free capacity descending
    onlineNodes.sort((a, b) => {
      const freeA = (a.storage_capacity || 0) - (a.storage_used || 0);
      const freeB = (b.storage_capacity || 0) - (b.storage_used || 0);
      return freeB - freeA;
    });

    const count = Math.min(replicationFactor, onlineNodes.length);
    return onlineNodes.slice(0, count).map((n) => n.id);
  }

  _reassignPinsFromNode(nodeId) {
    for (const pin of this._pins.values()) {
      if (pin.allocations.includes(nodeId)) {
        pin.allocations = pin.allocations.filter((id) => id !== nodeId);
        pin.current_replicas = pin.allocations.length;
        pin.updated_at = new Date().toISOString();

        // Try to find replacement node
        const candidates = this.listNodes({
          status: NODE_STATUS.ONLINE,
        }).filter((n) => !pin.allocations.includes(n.id));
        if (candidates.length > 0) {
          // Pick node with most free capacity
          candidates.sort((a, b) => {
            const freeA = (a.storage_capacity || 0) - (a.storage_used || 0);
            const freeB = (b.storage_capacity || 0) - (b.storage_used || 0);
            return freeB - freeA;
          });
          const replacement = candidates[0];
          pin.allocations.push(replacement.id);
          pin.current_replicas = pin.allocations.length;
          replacement.pin_count = (replacement.pin_count || 0) + 1;
        }

        if (pin.current_replicas < pin.replication_min) {
          this._logHealthEvent(nodeId, HEALTH_EVENT.REPLICATION_FAILED, {
            pinId: pin.id,
            cid: pin.cid,
            currentReplicas: pin.current_replicas,
          });
        }
      }
    }
  }

  _findPinOnNode(nodeId) {
    for (const pin of this._pins.values()) {
      if (
        pin.pin_status !== PIN_STATUS.UNPINNED &&
        pin.allocations.includes(nodeId)
      ) {
        return pin;
      }
    }
    return null;
  }

  _startCleanupTimer() {
    this._cleanupTimer = setInterval(() => {
      this._checkNodeHealth();
    }, this.config.cleanupIntervalMs);

    // Prevent timer from keeping process alive
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _checkNodeHealth() {
    const now = Date.now();
    for (const node of this._nodes.values()) {
      if (
        node.status === NODE_STATUS.OFFLINE ||
        node.status === NODE_STATUS.MAINTENANCE
      ) {
        continue;
      }
      const lastBeat = new Date(node.last_heartbeat).getTime();
      if (now - lastBeat > this.config.heartbeatTimeoutMs) {
        if (node.status !== NODE_STATUS.DEGRADED) {
          node.status = NODE_STATUS.DEGRADED;
          this._logHealthEvent(node.id, HEALTH_EVENT.NODE_DEGRADED, {
            elapsed: now - lastBeat,
          });
          this.emit("node:degraded", { nodeId: node.id, peerId: node.peer_id });
        }
      }
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getIPFSClusterManager() {
  if (!instance) {
    instance = new IPFSClusterManager();
  }
  return instance;
}

module.exports = {
  IPFSClusterManager,
  getIPFSClusterManager,
  NODE_STATUS,
  PIN_STATUS,
  HEALTH_EVENT,
};
