/**
 * P2P Git Sync Orchestrator
 * Coordinates P2P sync operations: fetchFromPeer / pushToPeer
 * Reference negotiation, offline queue integration, topology support
 *
 * @module git/p2p-git-sync
 * @version 1.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// Sync topologies
const TOPOLOGY = {
  STAR: "star",
  MESH: "mesh",
};

// Sync states
const SYNC_STATE = {
  IDLE: "idle",
  DISCOVERING: "discovering",
  NEGOTIATING: "negotiating",
  TRANSFERRING: "transferring",
  APPLYING: "applying",
  COMPLETE: "complete",
  ERROR: "error",
};

// Offline queue retry config
const RETRY_INTERVAL_MS = 5000;
const MAX_RETRIES = 5;

/**
 * Vector clock for causal ordering
 */
class VectorClock {
  constructor(clock = {}) {
    this.clock = { ...clock };
  }

  /**
   * Increment the clock for a node
   * @param {string} nodeId
   */
  increment(nodeId) {
    this.clock[nodeId] = (this.clock[nodeId] || 0) + 1;
    return this;
  }

  /**
   * Merge with another vector clock (take max of each entry)
   * @param {VectorClock} other
   */
  merge(other) {
    const allKeys = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(other.clock),
    ]);
    for (const key of allKeys) {
      this.clock[key] = Math.max(this.clock[key] || 0, other.clock[key] || 0);
    }
    return this;
  }

  /**
   * Check if this clock is causally before or concurrent with another
   * @param {VectorClock} other
   * @returns {'before'|'after'|'concurrent'|'equal'}
   */
  compare(other) {
    let beforeCount = 0;
    let afterCount = 0;
    const allKeys = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(other.clock),
    ]);

    for (const key of allKeys) {
      const a = this.clock[key] || 0;
      const b = other.clock[key] || 0;
      if (a < b) {
        beforeCount++;
      }
      if (a > b) {
        afterCount++;
      }
    }

    if (beforeCount === 0 && afterCount === 0) {
      return "equal";
    }
    if (beforeCount > 0 && afterCount === 0) {
      return "before";
    }
    if (afterCount > 0 && beforeCount === 0) {
      return "after";
    }
    return "concurrent";
  }

  toJSON() {
    return { ...this.clock };
  }

  static fromJSON(json) {
    return new VectorClock(json || {});
  }
}

/**
 * P2P Git Sync Manager
 * Orchestrates Git sync operations between peers
 */
class P2PGitSync extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.gitManager - GitManager instance
   * @param {Object} options.p2pGitTransport - P2PGitTransport factory
   * @param {Object} options.deviceDiscovery - DeviceDiscoveryManager instance
   * @param {Object} [options.p2pSyncEngine] - P2PSyncEngine for offline queue
   * @param {Object} options.database - DatabaseManager instance
   * @param {Object} [options.mainWindow] - Electron main window
   */
  constructor(options = {}) {
    super();
    this.gitManager = options.gitManager || null;
    this.transportFactory = options.p2pGitTransport || null;
    this.deviceDiscovery = options.deviceDiscovery || null;
    this.p2pSyncEngine = options.p2pSyncEngine || null;
    this.db = options.database || null;
    this.mainWindow = options.mainWindow || null;

    // Configuration
    this.config = {
      enabled: false,
      topology: TOPOLOGY.MESH,
      maxConcurrentPeers: 3,
      requireDIDAuth: true,
      autoSync: false,
      autoSyncInterval: 60000, // 1 minute
    };

    // State
    this.syncState = SYNC_STATE.IDLE;
    this.activeSyncs = new Map(); // peerId -> syncInfo
    this.vectorClock = new VectorClock();
    this.localNodeId = null;

    // Offline queue
    this._offlineQueue = [];
    this._retryTimers = new Map();

    // Auto-sync timer
    this._autoSyncTimer = null;

    // Active transports
    this._transports = new Map();
  }

  /**
   * Initialize the P2P Git sync system
   * @param {Object} [config] - Override configuration
   */
  async initialize(config = {}) {
    Object.assign(this.config, config);

    // Set local node ID from DID or random
    if (this.deviceDiscovery?.localDID) {
      this.localNodeId = this.deviceDiscovery.localDID;
    } else {
      this.localNodeId = `node-${uuidv4().slice(0, 8)}`;
    }

    this.vectorClock.increment(this.localNodeId);

    // Listen for device events
    if (this.deviceDiscovery) {
      this.deviceDiscovery.on("device:verified", (deviceInfo) => {
        if (this.config.autoSync) {
          this._enqueueSyncWithPeer(deviceInfo.peerId);
        }
      });
    }

    logger.info(
      `[P2PGitSync] Initialized (topology: ${this.config.topology}, node: ${this.localNodeId})`,
    );
  }

  /**
   * Enable P2P Git sync
   */
  enable() {
    this.config.enabled = true;
    if (this.config.autoSync) {
      this._startAutoSync();
    }
    logger.info("[P2PGitSync] Enabled");
    this.emit("state:changed", { enabled: true });
  }

  /**
   * Disable P2P Git sync
   */
  disable() {
    this.config.enabled = false;
    this._stopAutoSync();
    // Cancel all active syncs
    for (const [peerId] of this.activeSyncs) {
      this._cancelSync(peerId);
    }
    logger.info("[P2PGitSync] Disabled");
    this.emit("state:changed", { enabled: false });
  }

  /**
   * Fetch refs and objects from a peer
   * @param {string} peerId - Remote peer identifier
   * @param {Object} [options]
   * @param {string[]} [options.refs] - Specific refs to fetch (default: all)
   * @returns {Promise<Object>} Sync result
   */
  async fetchFromPeer(peerId, options = {}) {
    if (!this.config.enabled) {
      throw new Error("P2P Git sync is not enabled");
    }

    const syncId = uuidv4();
    const startTime = Date.now();

    this._setSyncState(SYNC_STATE.NEGOTIATING);
    this.activeSyncs.set(peerId, { syncId, direction: "pull", startTime });

    try {
      // Verify peer is authorized
      if (this.config.requireDIDAuth && this.deviceDiscovery) {
        const peerInfo = this.deviceDiscovery.verifiedPeers.get(peerId);
        if (
          !peerInfo ||
          !this.deviceDiscovery.isDeviceAuthorized(peerInfo.did)
        ) {
          throw new Error("Peer not authorized for sync");
        }
        this.deviceDiscovery.updateLastSeen(peerInfo.did);
      }

      // Get or create transport for this peer
      const transport = await this._getTransport(peerId);

      // Get local refs for negotiation
      const localRefs = await this._getLocalRefs();

      // Send ref negotiation request
      logger.info(
        `[P2PGitSync] Fetching from peer ${peerId}, local refs: ${Object.keys(localRefs).length}`,
      );
      this._setSyncState(SYNC_STATE.NEGOTIATING);

      // Use isomorphic-git fetch with P2P transport
      if (this.gitManager) {
        const git = require("isomorphic-git");
        const fs = require("fs");
        const repoPath =
          this.gitManager.repoPath || this.gitManager.config?.repoPath;

        if (repoPath) {
          this._setSyncState(SYNC_STATE.TRANSFERRING);

          await git.fetch({
            fs,
            dir: repoPath,
            http: transport.toHttpPlugin(),
            remote: `p2p-${peerId.slice(0, 8)}`,
            url: `p2p://${peerId}/repo`,
            ref: options.refs?.[0] || undefined,
            singleBranch: !!options.refs,
            onProgress: (progress) => {
              this.emit("sync:progress", {
                peerId,
                syncId,
                phase: progress.phase,
                loaded: progress.loaded,
                total: progress.total,
              });
            },
          });
        }
      }

      this._setSyncState(SYNC_STATE.COMPLETE);

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        syncId,
        peerId,
        direction: "pull",
        duration,
      };

      // Record sync history
      await this._recordSyncHistory(result);

      // Update vector clock
      this.vectorClock.increment(this.localNodeId);

      this.emit("sync:complete", result);
      return result;
    } catch (error) {
      this._setSyncState(SYNC_STATE.ERROR);
      logger.error(`[P2PGitSync] Fetch from ${peerId} failed:`, error.message);

      const result = {
        success: false,
        syncId,
        peerId,
        direction: "pull",
        duration: Date.now() - startTime,
        error: error.message,
      };

      await this._recordSyncHistory(result);

      // Add to offline queue for retry
      this._addToOfflineQueue({
        type: "fetch",
        peerId,
        options,
        retryCount: 0,
      });

      this.emit("sync:error", result);
      throw error;
    } finally {
      this.activeSyncs.delete(peerId);
      if (this.activeSyncs.size === 0) {
        this._setSyncState(SYNC_STATE.IDLE);
      }
    }
  }

  /**
   * Push refs and objects to a peer
   * @param {string} peerId - Remote peer identifier
   * @param {Object} [options]
   * @param {string[]} [options.refs] - Specific refs to push (default: current branch)
   * @returns {Promise<Object>} Sync result
   */
  async pushToPeer(peerId, options = {}) {
    if (!this.config.enabled) {
      throw new Error("P2P Git sync is not enabled");
    }

    const syncId = uuidv4();
    const startTime = Date.now();

    this.activeSyncs.set(peerId, { syncId, direction: "push", startTime });

    try {
      // Verify peer authorization
      if (this.config.requireDIDAuth && this.deviceDiscovery) {
        const peerInfo = this.deviceDiscovery.verifiedPeers.get(peerId);
        if (
          !peerInfo ||
          !this.deviceDiscovery.isDeviceAuthorized(peerInfo.did)
        ) {
          throw new Error("Peer not authorized for sync");
        }
        this.deviceDiscovery.updateLastSeen(peerInfo.did);
      }

      const transport = await this._getTransport(peerId);

      logger.info(`[P2PGitSync] Pushing to peer ${peerId}`);
      this._setSyncState(SYNC_STATE.TRANSFERRING);

      if (this.gitManager) {
        const git = require("isomorphic-git");
        const fs = require("fs");
        const repoPath =
          this.gitManager.repoPath || this.gitManager.config?.repoPath;

        if (repoPath) {
          await git.push({
            fs,
            dir: repoPath,
            http: transport.toHttpPlugin(),
            remote: `p2p-${peerId.slice(0, 8)}`,
            url: `p2p://${peerId}/repo`,
            ref: options.refs?.[0] || undefined,
            onProgress: (progress) => {
              this.emit("sync:progress", {
                peerId,
                syncId,
                phase: progress.phase,
                loaded: progress.loaded,
                total: progress.total,
              });
            },
          });
        }
      }

      this._setSyncState(SYNC_STATE.COMPLETE);

      const duration = Date.now() - startTime;
      const result = {
        success: true,
        syncId,
        peerId,
        direction: "push",
        duration,
      };

      await this._recordSyncHistory(result);
      this.vectorClock.increment(this.localNodeId);

      this.emit("sync:complete", result);
      return result;
    } catch (error) {
      this._setSyncState(SYNC_STATE.ERROR);
      logger.error(`[P2PGitSync] Push to ${peerId} failed:`, error.message);

      const result = {
        success: false,
        syncId,
        peerId,
        direction: "push",
        duration: Date.now() - startTime,
        error: error.message,
      };

      await this._recordSyncHistory(result);

      this._addToOfflineQueue({
        type: "push",
        peerId,
        options,
        retryCount: 0,
      });

      this.emit("sync:error", result);
      throw error;
    } finally {
      this.activeSyncs.delete(peerId);
      if (this.activeSyncs.size === 0) {
        this._setSyncState(SYNC_STATE.IDLE);
      }
    }
  }

  /**
   * Sync bidirectionally with a peer (fetch then push)
   * @param {string} peerId
   * @param {Object} [options]
   */
  async syncWithPeer(peerId, options = {}) {
    logger.info(`[P2PGitSync] Bidirectional sync with ${peerId}`);

    try {
      await this.fetchFromPeer(peerId, options);
    } catch (error) {
      logger.warn(
        `[P2PGitSync] Fetch phase failed, continuing to push: ${error.message}`,
      );
    }

    try {
      await this.pushToPeer(peerId, options);
    } catch (error) {
      logger.warn(`[P2PGitSync] Push phase failed: ${error.message}`);
    }
  }

  /**
   * Sync with all connected and authorized peers
   * @param {Object} [options]
   */
  async syncAll(options = {}) {
    if (!this.deviceDiscovery) {
      throw new Error("Device discovery not available");
    }

    const syncablePeers = this.deviceDiscovery.getSyncablePeers();
    const maxConcurrent = this.config.maxConcurrentPeers;

    logger.info(
      `[P2PGitSync] Syncing with ${syncablePeers.length} peers (max concurrent: ${maxConcurrent})`,
    );

    const results = [];

    // Process peers in batches
    for (let i = 0; i < syncablePeers.length; i += maxConcurrent) {
      const batch = syncablePeers.slice(i, i + maxConcurrent);
      const batchResults = await Promise.allSettled(
        batch.map((peer) => this.syncWithPeer(peer.peerId, options)),
      );

      for (const result of batchResults) {
        results.push(
          result.status === "fulfilled"
            ? { success: true }
            : { success: false, error: result.reason?.message },
        );
      }
    }

    return results;
  }

  // ==========================================
  // Internal helpers
  // ==========================================

  /**
   * Get or create a transport for a peer
   * @param {string} peerId
   */
  async _getTransport(peerId) {
    if (this._transports.has(peerId)) {
      return this._transports.get(peerId);
    }

    if (!this.transportFactory) {
      throw new Error("No transport factory configured");
    }

    let transport;
    if (typeof this.transportFactory === "function") {
      transport = this.transportFactory(peerId);
    } else {
      // Use transport factory's create method
      const { P2PGitTransport } = require("./p2p-git-transport");
      transport = new P2PGitTransport({
        webrtcManager: this.transportFactory.webrtcManager,
        peerId,
      });
      await transport.initialize();
    }

    this._transports.set(peerId, transport);
    return transport;
  }

  /**
   * Get local Git refs
   */
  async _getLocalRefs() {
    try {
      if (!this.gitManager) {
        return {};
      }
      const git = require("isomorphic-git");
      const fs = require("fs");
      const repoPath =
        this.gitManager.repoPath || this.gitManager.config?.repoPath;
      if (!repoPath) {
        return {};
      }

      const branches = await git.listBranches({ fs, dir: repoPath });
      const refs = {};
      for (const branch of branches) {
        try {
          const oid = await git.resolveRef({ fs, dir: repoPath, ref: branch });
          refs[`refs/heads/${branch}`] = oid;
        } catch (_e) {
          // Skip unresolvable refs
        }
      }
      return refs;
    } catch (error) {
      logger.warn("[P2PGitSync] Failed to get local refs:", error.message);
      return {};
    }
  }

  /**
   * Record sync history to database
   * @param {Object} result
   */
  async _recordSyncHistory(result) {
    if (!this.db) {
      return;
    }

    try {
      const peerInfo = this.deviceDiscovery?.verifiedPeers?.get(result.peerId);
      this.db.run(
        `INSERT INTO git_p2p_sync_history
         (id, peer_did, peer_device_name, direction, objects_transferred, bytes_transferred, duration_ms, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.syncId,
          peerInfo?.did || result.peerId,
          peerInfo?.name || null,
          result.direction,
          result.objectsTransferred || 0,
          result.bytesTransferred || 0,
          result.duration || 0,
          result.success ? "success" : "failed",
          result.error || null,
        ],
      );
    } catch (error) {
      logger.warn("[P2PGitSync] Failed to record sync history:", error.message);
    }
  }

  /**
   * Get sync history
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   */
  getSyncHistory(options = {}) {
    if (!this.db) {
      return [];
    }
    const limit = options.limit || 50;

    try {
      return this.db.all(
        `SELECT * FROM git_p2p_sync_history ORDER BY created_at DESC LIMIT ?`,
        [limit],
      );
    } catch (error) {
      return [];
    }
  }

  // ==========================================
  // Offline queue
  // ==========================================

  _addToOfflineQueue(item) {
    this._offlineQueue.push(item);
    this._scheduleRetry(item);
  }

  _scheduleRetry(item) {
    if (item.retryCount >= MAX_RETRIES) {
      logger.warn(
        `[P2PGitSync] Max retries reached for ${item.type} to ${item.peerId}`,
      );
      return;
    }

    const delay = RETRY_INTERVAL_MS * Math.pow(2, item.retryCount);
    const timerId = setTimeout(async () => {
      item.retryCount++;
      try {
        if (item.type === "fetch") {
          await this.fetchFromPeer(item.peerId, item.options);
        } else {
          await this.pushToPeer(item.peerId, item.options);
        }
        // Remove from queue on success
        this._offlineQueue = this._offlineQueue.filter((q) => q !== item);
      } catch (_e) {
        this._scheduleRetry(item);
      }
    }, delay);

    this._retryTimers.set(item.peerId, timerId);
  }

  _enqueueSyncWithPeer(peerId) {
    // Debounce - don't sync with same peer multiple times
    if (this.activeSyncs.has(peerId)) {
      return;
    }
    this.syncWithPeer(peerId).catch((e) => {
      logger.warn(`[P2PGitSync] Auto-sync with ${peerId} failed: ${e.message}`);
    });
  }

  // ==========================================
  // Auto-sync
  // ==========================================

  _startAutoSync() {
    if (this._autoSyncTimer) {
      return;
    }
    this._autoSyncTimer = setInterval(() => {
      this.syncAll().catch((e) => {
        logger.warn("[P2PGitSync] Auto-sync-all failed:", e.message);
      });
    }, this.config.autoSyncInterval);
    logger.info(
      `[P2PGitSync] Auto-sync started (interval: ${this.config.autoSyncInterval}ms)`,
    );
  }

  _stopAutoSync() {
    if (this._autoSyncTimer) {
      clearInterval(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
  }

  // ==========================================
  // State management
  // ==========================================

  _setSyncState(state) {
    this.syncState = state;
    this.emit("sync:state", state);
    this._notifyRenderer("git-p2p:sync-state", { state });
  }

  _cancelSync(peerId) {
    const transport = this._transports.get(peerId);
    if (transport) {
      transport.destroy?.();
      this._transports.delete(peerId);
    }
    this.activeSyncs.delete(peerId);
  }

  _notifyRenderer(channel, data) {
    try {
      this.mainWindow?.webContents?.send?.(channel, data);
    } catch (_e) {
      // Renderer not available
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      topology: this.config.topology,
      syncState: this.syncState,
      activeSyncs: this.activeSyncs.size,
      offlineQueueSize: this._offlineQueue.length,
      vectorClock: this.vectorClock.toJSON(),
      connectedPeers: this.deviceDiscovery?.getVerifiedPeers()?.length || 0,
      authorizedDevices:
        this.deviceDiscovery?.getAuthorizedDevices()?.length || 0,
    };
  }

  /**
   * Update configuration
   * @param {Object} newConfig
   */
  setConfig(newConfig) {
    Object.assign(this.config, newConfig);

    if (this.config.enabled && this.config.autoSync) {
      this._startAutoSync();
    } else {
      this._stopAutoSync();
    }
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    this.disable();
    for (const [, transport] of this._transports) {
      transport.destroy?.();
    }
    this._transports.clear();
    for (const [, timerId] of this._retryTimers) {
      clearTimeout(timerId);
    }
    this._retryTimers.clear();
    this.removeAllListeners();
    logger.info("[P2PGitSync] Destroyed");
  }
}

module.exports = {
  P2PGitSync,
  VectorClock,
  TOPOLOGY,
  SYNC_STATE,
};
