/**
 * Mesh Social Manager
 *
 * Offline mesh networking for social interactions without internet connectivity.
 * Uses simulated BLE/Wi-Fi Direct discovery for nearby peer communication.
 * All state is ephemeral (in-memory only, no database tables).
 *
 * Features:
 * - Discover nearby peers via simulated BLE/Wi-Fi Direct
 * - Send direct messages over mesh network
 * - Broadcast messages to all nearby peers
 * - Queue data for sync when connectivity is restored
 * - Connection type detection
 *
 * @module social/mesh-social
 * @version 0.45.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const {
  MeshSocialBoundaryError,
  createMeshSocialBoundaries,
  assertMeshPeerId,
  normalizeMeshData,
  normalizeMeshPeer,
} = require("./mesh-social-boundaries");

// ============================================================
// Constants
// ============================================================

const CONNECTION_TYPES = {
  BLUETOOTH: "bluetooth",
  WIFI_DIRECT: "wifi-direct",
  ONLINE: "online",
  NONE: "none",
};

// ============================================================
// MeshSocial
// ============================================================

class MeshSocial extends EventEmitter {
  constructor(options = {}) {
    super();

    this.boundaries = createMeshSocialBoundaries(options.boundaries || {});
    this._now =
      typeof options.now === "function" ? options.now : () => Date.now();

    this.initialized = false;
    this._destroyed = false;

    // In-memory peer registry: Map<peerId, { id, alias, lastSeen, connectionType, metadata }>
    this.peers = new Map();

    // Message queue for offline-to-online sync
    this.syncQueue = [];
    this._syncQueueBytes = 0;
    this._syncPromise = null;

    // Discovery state
    this._discoveryActive = false;
    this._discoveryInterval = null;

    // Simulated connection type
    this._connectionType = CONNECTION_TYPES.ONLINE;
  }

  /**
   * Initialize mesh social manager
   */
  async initialize() {
    this._assertUsable();
    if (this.initialized) {
      return;
    }
    logger.info("[MeshSocial] Initializing mesh social manager...");

    try {
      this.initialized = true;
      logger.info("[MeshSocial] Mesh social manager initialized successfully");
    } catch (error) {
      logger.error("[MeshSocial] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Start peer discovery.
   *
   * In production, this would activate BLE/Wi-Fi Direct scanning.
   * In simulation mode, it periodically checks for simulated peers.
   *
   * @returns {Object} Discovery status
   */
  async startDiscovery() {
    try {
      this._requireReady();
      if (this._discoveryActive) {
        logger.info("[MeshSocial] Discovery already active");
        return { success: true, status: "already_active" };
      }

      this._discoveryActive = true;

      // Start periodic peer cleanup (remove stale peers)
      this._discoveryInterval = setInterval(() => {
        this._cleanupStalePeers();
      }, this.boundaries.discoveryIntervalMs);
      this._discoveryInterval.unref?.();

      logger.info("[MeshSocial] Peer discovery started");

      this.emit("mesh:connected", {
        connectionType: this._connectionType,
      });

      return { success: true, status: "started" };
    } catch (error) {
      logger.error("[MeshSocial] Failed to start discovery:", error);
      throw error;
    }
  }

  /**
   * Stop peer discovery.
   *
   * @returns {Object} Discovery status
   */
  async stopDiscovery() {
    try {
      this._assertUsable();
      if (!this._discoveryActive) {
        logger.info("[MeshSocial] Discovery already inactive");
        return { success: true, status: "already_inactive" };
      }

      this._discoveryActive = false;

      if (this._discoveryInterval) {
        clearInterval(this._discoveryInterval);
        this._discoveryInterval = null;
      }

      logger.info("[MeshSocial] Peer discovery stopped");

      this.emit("mesh:disconnected", {
        reason: "discovery_stopped",
      });

      return { success: true, status: "stopped" };
    } catch (error) {
      logger.error("[MeshSocial] Failed to stop discovery:", error);
      throw error;
    }
  }

  /**
   * Get a list of currently visible nearby peers.
   *
   * @returns {Array} List of nearby peers
   */
  async getNearbyPeers() {
    try {
      this._requireReady();
      const now = this._now();
      const peers = [];

      for (const peer of this.peers.values()) {
        // Only include peers seen recently
        if (now - peer.lastSeen < this.boundaries.peerTtlMs) {
          peers.push({
            id: peer.id,
            alias: peer.alias,
            connectionType: peer.connectionType,
            lastSeen: peer.lastSeen,
            metadata: structuredCloneJson(peer.metadata),
          });
        }
      }

      return peers;
    } catch (error) {
      logger.error("[MeshSocial] Failed to get nearby peers:", error);
      throw error;
    }
  }

  /**
   * Send a message to a specific peer via the mesh network.
   *
   * @param {string} peerId - The target peer ID
   * @param {*} data - The data to send
   * @returns {Object} Send result
   */
  async sendViaMesh(peerId, data) {
    try {
      this._requireReady();
      const normalizedPeerId = assertMeshPeerId(peerId, this.boundaries);
      const normalizedData = normalizeMeshData(data, this.boundaries).value;
      const peer = this.peers.get(normalizedPeerId);

      if (!peer) {
        throw new Error(`Peer not found: ${normalizedPeerId}`);
      }

      // Check if peer is still reachable
      const now = this._now();
      if (now - peer.lastSeen > this.boundaries.peerTtlMs) {
        throw new Error(`Peer is no longer reachable: ${normalizedPeerId}`);
      }

      const message = {
        id: uuidv4(),
        from: "self",
        to: normalizedPeerId,
        data: normalizedData,
        timestamp: now,
        type: "direct",
      };

      // Simulate message delivery
      logger.info("[MeshSocial] Sent mesh message to:", normalizedPeerId);

      this.emit("mesh:message", {
        direction: "outgoing",
        message,
      });

      return {
        success: true,
        messageId: message.id,
        deliveredTo: normalizedPeerId,
      };
    } catch (error) {
      logger.error("[MeshSocial] Failed to send via mesh:", error);
      throw error;
    }
  }

  /**
   * Broadcast a message to all nearby peers.
   *
   * @param {*} data - The data to broadcast
   * @returns {Object} Broadcast result
   */
  async broadcastMesh(data) {
    try {
      this._requireReady();
      const normalizedData = normalizeMeshData(data, this.boundaries).value;
      const now = this._now();
      const reachablePeers = [];

      for (const [peerId, peer] of this.peers) {
        if (now - peer.lastSeen < this.boundaries.peerTtlMs) {
          reachablePeers.push(peerId);
        }
      }

      const message = {
        id: uuidv4(),
        from: "self",
        to: "broadcast",
        data: normalizedData,
        timestamp: now,
        type: "broadcast",
      };

      logger.info(
        "[MeshSocial] Broadcast mesh message to",
        reachablePeers.length,
        "peers",
      );

      this.emit("mesh:message", {
        direction: "outgoing",
        message,
        recipients: reachablePeers,
      });

      return {
        success: true,
        messageId: message.id,
        recipientCount: reachablePeers.length,
        recipients: reachablePeers,
      };
    } catch (error) {
      logger.error("[MeshSocial] Failed to broadcast:", error);
      throw error;
    }
  }

  /**
   * Get the current connection type.
   *
   * @returns {string} The connection type
   */
  getConnectionType() {
    this._assertUsable();
    return this._connectionType;
  }

  /**
   * Check if the device is currently in offline/mesh-only mode.
   *
   * @returns {boolean} True if offline
   */
  isOfflineMode() {
    this._assertUsable();
    return (
      this._connectionType === CONNECTION_TYPES.BLUETOOTH ||
      this._connectionType === CONNECTION_TYPES.WIFI_DIRECT ||
      this._connectionType === CONNECTION_TYPES.NONE
    );
  }

  /**
   * Queue data for synchronization when online connectivity is restored.
   *
   * @param {*} data - The data to queue for sync
   * @returns {Object} Queue result
   */
  async syncWhenOnline(data) {
    try {
      this._requireReady();
      const normalized = normalizeMeshData(data, this.boundaries);
      this._assertSyncCapacity(normalized.byteLength);

      const entry = {
        id: uuidv4(),
        data: normalized.value,
        byteLength: normalized.byteLength,
        queuedAt: this._now(),
        synced: false,
      };

      this.syncQueue.push(entry);
      this._syncQueueBytes += entry.byteLength;

      logger.info(
        "[MeshSocial] Queued data for sync. Queue size:",
        this.syncQueue.length,
      );

      // If currently online, attempt immediate sync
      if (this._connectionType === CONNECTION_TYPES.ONLINE) {
        await this._processSyncQueue();
      }

      return {
        success: true,
        entryId: entry.id,
        queueSize: this.syncQueue.length,
      };
    } catch (error) {
      logger.error("[MeshSocial] Failed to queue for sync:", error);
      throw error;
    }
  }

  // ============================================================
  // Peer management (for external callers or testing)
  // ============================================================

  /**
   * Register a discovered peer (called by native discovery module or for testing).
   *
   * @param {string} peerId - The peer ID
   * @param {Object} [peerInfo] - Additional peer info
   * @param {string} [peerInfo.alias] - The peer alias
   * @param {string} [peerInfo.connectionType] - The connection type
   * @param {Object} [peerInfo.metadata] - Additional metadata
   */
  registerPeer(peerId, peerInfo = {}) {
    this._requireReady();
    if (
      peerInfo === null ||
      typeof peerInfo !== "object" ||
      Array.isArray(peerInfo)
    ) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_PEER_INVALID",
        "peerInfo must be a plain object",
      );
    }
    const candidateInfo = {
      ...peerInfo,
      connectionType:
        peerInfo.connectionType === undefined
          ? CONNECTION_TYPES.WIFI_DIRECT
          : peerInfo.connectionType,
    };
    this._assertConnectionType(candidateInfo.connectionType);
    const peer = normalizeMeshPeer(
      peerId,
      candidateInfo,
      this.boundaries,
      this._now(),
    );
    const isNew = !this.peers.has(peer.id);
    if (isNew && this.peers.size >= this.boundaries.maxPeers) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_PEER_CAPACITY",
        `Mesh peer capacity of ${this.boundaries.maxPeers} has been reached`,
        { limit: this.boundaries.maxPeers },
      );
    }

    this.peers.set(peer.id, peer);

    if (isNew) {
      logger.info("[MeshSocial] Discovered new peer:", peer.id);

      this.emit("peer:discovered", {
        peerId: peer.id,
        alias: peer.alias,
        connectionType: peer.connectionType,
      });
    }
  }

  /**
   * Remove a peer from the registry.
   *
   * @param {string} peerId - The peer ID to remove
   */
  removePeer(peerId) {
    this._requireReady();
    const normalizedPeerId = assertMeshPeerId(peerId, this.boundaries);
    if (this.peers.has(normalizedPeerId)) {
      const peer = this.peers.get(normalizedPeerId);
      this.peers.delete(normalizedPeerId);

      logger.info("[MeshSocial] Peer lost:", normalizedPeerId);

      this.emit("peer:lost", {
        peerId: normalizedPeerId,
        alias: peer.alias,
      });
    }
  }

  /**
   * Simulate a connection type change (for testing).
   *
   * @param {string} connectionType - The new connection type
   */
  setConnectionType(connectionType) {
    this._requireReady();
    this._assertConnectionType(connectionType);
    const oldType = this._connectionType;
    this._connectionType = connectionType;

    if (
      oldType !== CONNECTION_TYPES.ONLINE &&
      connectionType === CONNECTION_TYPES.ONLINE
    ) {
      // Connectivity restored - process sync queue
      this._processSyncQueue().catch((err) => {
        logger.error("[MeshSocial] Failed to process sync queue:", err);
      });
    }

    logger.info(
      "[MeshSocial] Connection type changed:",
      oldType,
      "->",
      connectionType,
    );
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /**
   * Clean up peers that haven't been seen recently.
   * @private
   */
  _cleanupStalePeers() {
    if (this._destroyed) {
      return;
    }
    const now = this._now();
    const staleIds = [];

    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastSeen > this.boundaries.peerTtlMs) {
        staleIds.push(peerId);
      }
    }

    for (const peerId of staleIds) {
      this.removePeer(peerId);
    }
  }

  /**
   * Process the sync queue (called when online connectivity is restored).
   * @private
   */
  async _processSyncQueue() {
    if (this._syncPromise) {
      return this._syncPromise;
    }
    this._syncPromise = this._processSyncQueueOnce();
    try {
      return await this._syncPromise;
    } finally {
      this._syncPromise = null;
    }
  }

  async _processSyncQueueOnce() {
    if (this.syncQueue.length === 0) {
      return;
    }

    logger.info(
      "[MeshSocial] Processing sync queue:",
      this.syncQueue.length,
      "items",
    );

    const processed = [];

    for (const entry of this.syncQueue) {
      if (!entry.synced) {
        try {
          // In production, this would send data to the server/P2P network
          entry.synced = true;
          entry.syncedAt = this._now();
          processed.push(entry.id);
        } catch (error) {
          logger.warn(
            "[MeshSocial] Failed to sync entry:",
            entry.id,
            error.message,
          );
        }
      }
    }

    // Remove synced entries
    this.syncQueue = this.syncQueue.filter((entry) => !entry.synced);
    this._syncQueueBytes = this.syncQueue.reduce(
      (total, entry) => total + entry.byteLength,
      0,
    );

    logger.info(
      "[MeshSocial] Synced",
      processed.length,
      "items. Remaining:",
      this.syncQueue.length,
    );
  }

  /**
   * Close the mesh social manager
   */
  _assertUsable() {
    if (this._destroyed) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_DESTROYED",
        "Mesh social manager has been destroyed",
      );
    }
  }

  _requireReady() {
    this._assertUsable();
    if (!this.initialized) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_NOT_INITIALIZED",
        "Mesh social manager is not initialized",
      );
    }
  }

  _assertConnectionType(connectionType) {
    if (!Object.values(CONNECTION_TYPES).includes(connectionType)) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_CONNECTION_TYPE",
        `Unsupported mesh connection type: ${connectionType}`,
      );
    }
  }

  _assertSyncCapacity(nextBytes) {
    if (this.syncQueue.length >= this.boundaries.maxSyncEntries) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_SYNC_CAPACITY",
        `Mesh sync queue entry capacity of ${this.boundaries.maxSyncEntries} has been reached`,
        { limit: this.boundaries.maxSyncEntries },
      );
    }
    if (this._syncQueueBytes + nextBytes > this.boundaries.maxSyncBytes) {
      throw new MeshSocialBoundaryError(
        "ERR_MESH_SYNC_CAPACITY",
        `Mesh sync queue byte capacity of ${this.boundaries.maxSyncBytes} would be exceeded`,
        {
          retainedBytes: this._syncQueueBytes,
          nextBytes,
          limitBytes: this.boundaries.maxSyncBytes,
        },
      );
    }
  }

  async destroy() {
    if (this._destroyed) {
      return;
    }
    logger.info("[MeshSocial] Closing mesh social manager");

    this._destroyed = true;
    this._discoveryActive = false;
    if (this._discoveryInterval) {
      clearInterval(this._discoveryInterval);
      this._discoveryInterval = null;
    }

    this.peers.clear();
    this.syncQueue = [];
    this._syncQueueBytes = 0;
    this.removeAllListeners();
    this.initialized = false;
  }

  async close() {
    await this.destroy();
  }
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  MeshSocial,
  CONNECTION_TYPES,
};
