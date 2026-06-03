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

// ============================================================
// Constants
// ============================================================

const CONNECTION_TYPES = {
  BLUETOOTH: "bluetooth",
  WIFI_DIRECT: "wifi-direct",
  ONLINE: "online",
  NONE: "none",
};

const DISCOVERY_INTERVAL_MS = 5000;
const PEER_TIMEOUT_MS = 30000;
const MAX_SYNC_QUEUE_SIZE = 1000;

// ============================================================
// MeshSocial
// ============================================================

class MeshSocial extends EventEmitter {
  constructor() {
    super();

    this.initialized = false;

    // In-memory peer registry: Map<peerId, { id, alias, lastSeen, connectionType, metadata }>
    this.peers = new Map();

    // Message queue for offline-to-online sync
    this.syncQueue = [];

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
      if (this._discoveryActive) {
        logger.info("[MeshSocial] Discovery already active");
        return { success: true, status: "already_active" };
      }

      this._discoveryActive = true;

      // Start periodic peer cleanup (remove stale peers)
      this._discoveryInterval = setInterval(() => {
        this._cleanupStalePeers();
      }, DISCOVERY_INTERVAL_MS);

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
      const now = Date.now();
      const peers = [];

      for (const [peerId, peer] of this.peers) {
        // Only include peers seen recently
        if (now - peer.lastSeen < PEER_TIMEOUT_MS) {
          peers.push({
            id: peer.id,
            alias: peer.alias,
            connectionType: peer.connectionType,
            lastSeen: peer.lastSeen,
            metadata: peer.metadata || {},
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
      if (!peerId) {
        throw new Error("Peer ID is required");
      }

      if (data === undefined || data === null) {
        throw new Error("Data is required");
      }

      const peer = this.peers.get(peerId);

      if (!peer) {
        throw new Error(`Peer not found: ${peerId}`);
      }

      // Check if peer is still reachable
      const now = Date.now();
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        throw new Error(`Peer is no longer reachable: ${peerId}`);
      }

      const message = {
        id: uuidv4(),
        from: "self",
        to: peerId,
        data,
        timestamp: now,
        type: "direct",
      };

      // Simulate message delivery
      logger.info("[MeshSocial] Sent mesh message to:", peerId);

      this.emit("mesh:message", {
        direction: "outgoing",
        message,
      });

      return {
        success: true,
        messageId: message.id,
        deliveredTo: peerId,
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
      if (data === undefined || data === null) {
        throw new Error("Data is required");
      }

      const now = Date.now();
      const reachablePeers = [];

      for (const [peerId, peer] of this.peers) {
        if (now - peer.lastSeen < PEER_TIMEOUT_MS) {
          reachablePeers.push(peerId);
        }
      }

      const message = {
        id: uuidv4(),
        from: "self",
        to: "broadcast",
        data,
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
    return this._connectionType;
  }

  /**
   * Check if the device is currently in offline/mesh-only mode.
   *
   * @returns {boolean} True if offline
   */
  isOfflineMode() {
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
      if (data === undefined || data === null) {
        throw new Error("Data is required");
      }

      if (this.syncQueue.length >= MAX_SYNC_QUEUE_SIZE) {
        throw new Error("Sync queue is full");
      }

      const entry = {
        id: uuidv4(),
        data,
        queuedAt: Date.now(),
        synced: false,
      };

      this.syncQueue.push(entry);

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
    const isNew = !this.peers.has(peerId);

    this.peers.set(peerId, {
      id: peerId,
      alias: peerInfo.alias || `peer-${peerId.substring(0, 8)}`,
      connectionType: peerInfo.connectionType || CONNECTION_TYPES.WIFI_DIRECT,
      lastSeen: Date.now(),
      metadata: peerInfo.metadata || {},
    });

    if (isNew) {
      logger.info("[MeshSocial] Discovered new peer:", peerId);

      this.emit("peer:discovered", {
        peerId,
        alias: peerInfo.alias,
        connectionType: peerInfo.connectionType,
      });
    }
  }

  /**
   * Remove a peer from the registry.
   *
   * @param {string} peerId - The peer ID to remove
   */
  removePeer(peerId) {
    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId);
      this.peers.delete(peerId);

      logger.info("[MeshSocial] Peer lost:", peerId);

      this.emit("peer:lost", {
        peerId,
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

    logger.info("[MeshSocial] Connection type changed:", oldType, "->", connectionType);
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /**
   * Clean up peers that haven't been seen recently.
   * @private
   */
  _cleanupStalePeers() {
    const now = Date.now();
    const staleIds = [];

    for (const [peerId, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
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
          entry.syncedAt = Date.now();
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
  async close() {
    logger.info("[MeshSocial] Closing mesh social manager");

    await this.stopDiscovery();

    this.peers.clear();
    this.syncQueue = [];
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  MeshSocial,
  CONNECTION_TYPES,
};
