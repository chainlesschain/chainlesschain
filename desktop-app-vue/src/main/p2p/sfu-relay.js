/**
 * SFU (Selective Forwarding Unit) Relay
 *
 * Manages media stream relaying for group calls with 5-8 participants.
 * Instead of full mesh (N*(N-1)/2 connections), each participant sends one
 * upstream to the relay, which selectively forwards to all other participants.
 *
 * Features:
 * - Create relay instances per room
 * - Manage upstream (sender) and downstream (receiver) connections
 * - Selective forwarding based on active speaker / subscription
 * - Bandwidth-aware relay decisions
 * - Graceful peer add/remove
 *
 * @module p2p/sfu-relay
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Default SFU configuration
 */
const DEFAULT_CONFIG = {
  maxUpstreams: 8,
  relayTimeoutMs: 5000,
  cleanupIntervalMs: 30000,
  activeSpeakerIntervalMs: 1000,
};

/**
 * Upstream connection state
 * @typedef {Object} UpstreamEntry
 * @property {string} peerId - Peer identifier
 * @property {Object|null} stream - Stream reference or metadata
 * @property {string} status - Connection status: 'active', 'paused', 'disconnected'
 * @property {number} addedAt - Timestamp when added
 * @property {Object} stats - Stream statistics
 */

/**
 * Relay instance state
 * @typedef {Object} RelayInstance
 * @property {string} roomId - Associated room ID
 * @property {Map<string, UpstreamEntry>} upstreams - Upstream connections by peerId
 * @property {Map<string, Set<string>>} subscriptions - Downstream subscriptions: peerId -> Set<upstream peerId>
 * @property {string} activeSpeaker - Current active speaker peerId
 * @property {number} createdAt - Timestamp when relay was created
 * @property {string} status - Relay status: 'active', 'stopped'
 */

/**
 * SFU Relay class
 * Manages selective forwarding for group calls
 */
class SFURelay extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };

    // Active relay instances by roomId
    this.relays = new Map();

    // Cleanup interval timer
    this.cleanupTimer = null;

    // Active speaker detection timers per room
    this.speakerTimers = new Map();
  }

  /**
   * Create a new relay instance for a room
   * @param {string} roomId - Room identifier
   * @returns {Object} Relay creation result
   */
  createRelay(roomId) {
    try {
      if (!roomId) {
        throw new Error("Room ID is required");
      }

      if (this.relays.has(roomId)) {
        logger.warn(
          `[SFURelay] Relay already exists for room ${roomId}`,
        );
        return {
          success: true,
          roomId,
          alreadyExists: true,
        };
      }

      const relay = {
        roomId,
        upstreams: new Map(),
        subscriptions: new Map(),
        activeSpeaker: null,
        createdAt: Date.now(),
        status: "active",
      };

      this.relays.set(roomId, relay);

      // Start active speaker detection
      this._startSpeakerDetection(roomId);

      // Start cleanup if not already running
      if (!this.cleanupTimer) {
        this._startCleanup();
      }

      this.emit("relay:started", { roomId, createdAt: relay.createdAt });

      logger.info(`[SFURelay] Relay created for room ${roomId}`);

      return {
        success: true,
        roomId,
        createdAt: relay.createdAt,
      };
    } catch (error) {
      logger.error("[SFURelay] Error creating relay:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add an upstream connection (a participant sending their media)
   * @param {string} roomId - Room identifier
   * @param {string} peerId - Peer identifier
   * @param {Object} stream - Stream reference or metadata
   * @returns {Object} Result
   */
  addUpstream(roomId, peerId, stream) {
    try {
      const relay = this._getRelay(roomId);

      if (relay.upstreams.size >= this.config.maxUpstreams) {
        throw new Error(
          `Maximum upstreams (${this.config.maxUpstreams}) reached for room ${roomId}`,
        );
      }

      if (relay.upstreams.has(peerId)) {
        // Update existing upstream
        const existing = relay.upstreams.get(peerId);
        existing.stream = stream;
        existing.status = "active";

        logger.info(
          `[SFURelay] Upstream updated for peer ${peerId} in room ${roomId}`,
        );

        return { success: true, updated: true };
      }

      const upstreamEntry = {
        peerId,
        stream,
        status: "active",
        addedAt: Date.now(),
        stats: {
          bytesRelayed: 0,
          packetsRelayed: 0,
          lastActivity: Date.now(),
        },
      };

      relay.upstreams.set(peerId, upstreamEntry);

      // Auto-subscribe all other participants to this new upstream
      for (const [existingPeerId] of relay.upstreams) {
        if (existingPeerId !== peerId) {
          this._addSubscription(roomId, existingPeerId, peerId);
          this._addSubscription(roomId, peerId, existingPeerId);
        }
      }

      this.emit("upstream:added", { roomId, peerId });

      logger.info(
        `[SFURelay] Upstream added for peer ${peerId} in room ${roomId}` +
          ` (total: ${relay.upstreams.size})`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[SFURelay] Error adding upstream:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove an upstream connection (participant leaving or muting)
   * @param {string} roomId - Room identifier
   * @param {string} peerId - Peer identifier
   * @returns {Object} Result
   */
  removeUpstream(roomId, peerId) {
    try {
      const relay = this._getRelay(roomId);

      if (!relay.upstreams.has(peerId)) {
        return { success: true, message: "Upstream not found" };
      }

      // Remove the upstream
      relay.upstreams.delete(peerId);

      // Remove all subscriptions to this upstream
      for (const [subscriberPeerId, subs] of relay.subscriptions) {
        subs.delete(peerId);
      }

      // Remove this peer's subscriptions
      relay.subscriptions.delete(peerId);

      // Update active speaker if needed
      if (relay.activeSpeaker === peerId) {
        relay.activeSpeaker = null;
      }

      this.emit("upstream:removed", { roomId, peerId });

      logger.info(
        `[SFURelay] Upstream removed for peer ${peerId} from room ${roomId}` +
          ` (remaining: ${relay.upstreams.size})`,
      );

      // If no upstreams left, consider shutting down relay
      if (relay.upstreams.size === 0) {
        logger.info(
          `[SFURelay] No upstreams left in room ${roomId}, relay idle`,
        );
      }

      return { success: true };
    } catch (error) {
      logger.error("[SFURelay] Error removing upstream:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the downstream peer IDs that a given peer should receive streams from
   * @param {string} roomId - Room identifier
   * @param {string} peerId - Peer identifier
   * @returns {Object} List of downstream source peer IDs
   */
  getDownstreams(roomId, peerId) {
    try {
      const relay = this._getRelay(roomId);

      const subscriptions = relay.subscriptions.get(peerId);
      if (!subscriptions) {
        return { success: true, downstreams: [] };
      }

      const downstreams = [];
      for (const sourcePeerId of subscriptions) {
        const upstream = relay.upstreams.get(sourcePeerId);
        if (upstream && upstream.status === "active") {
          downstreams.push({
            peerId: sourcePeerId,
            stream: upstream.stream,
            isActiveSpeaker: relay.activeSpeaker === sourcePeerId,
          });
        }
      }

      return { success: true, downstreams };
    } catch (error) {
      logger.error("[SFURelay] Error getting downstreams:", error);
      return { success: false, error: error.message, downstreams: [] };
    }
  }

  /**
   * Relay data from one peer to all other peers in the room
   * @param {string} roomId - Room identifier
   * @param {string} peerId - Source peer identifier
   * @param {any} data - Data to relay
   * @returns {Object} Relay result with list of recipients
   */
  relayToAll(roomId, peerId, data) {
    try {
      const relay = this._getRelay(roomId);

      const upstream = relay.upstreams.get(peerId);
      if (!upstream) {
        throw new Error(`No upstream found for peer ${peerId} in room ${roomId}`);
      }

      // Update upstream stats
      upstream.stats.lastActivity = Date.now();
      upstream.stats.packetsRelayed++;

      const recipients = [];

      // Forward to all subscribers of this upstream
      for (const [subscriberPeerId, subs] of relay.subscriptions) {
        if (subs.has(peerId) && subscriberPeerId !== peerId) {
          recipients.push(subscriberPeerId);
        }
      }

      // Emit relay event with data for each recipient
      for (const recipientPeerId of recipients) {
        this.emit("relay:data", {
          roomId,
          sourcePeerId: peerId,
          targetPeerId: recipientPeerId,
          data,
        });
      }

      return {
        success: true,
        recipientCount: recipients.length,
        recipients,
      };
    } catch (error) {
      logger.error("[SFURelay] Error relaying data:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Shutdown a relay instance for a room
   * @param {string} roomId - Room identifier
   * @returns {Object} Shutdown result
   */
  shutdown(roomId) {
    try {
      if (!this.relays.has(roomId)) {
        return { success: true, message: "Relay not found" };
      }

      const relay = this.relays.get(roomId);
      relay.status = "stopped";

      // Clear speaker detection
      this._stopSpeakerDetection(roomId);

      // Notify all connected peers
      for (const [peerId] of relay.upstreams) {
        this.emit("upstream:removed", { roomId, peerId });
      }

      // Clean up
      relay.upstreams.clear();
      relay.subscriptions.clear();
      this.relays.delete(roomId);

      this.emit("relay:stopped", { roomId, stoppedAt: Date.now() });

      // Stop global cleanup if no relays left
      if (this.relays.size === 0 && this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }

      logger.info(`[SFURelay] Relay shutdown for room ${roomId}`);

      return { success: true };
    } catch (error) {
      logger.error("[SFURelay] Error shutting down relay:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get relay status for a room
   * @param {string} roomId - Room identifier
   * @returns {Object} Relay status info
   */
  getRelayStatus(roomId) {
    try {
      const relay = this._getRelay(roomId);

      const upstreams = [];
      for (const [peerId, entry] of relay.upstreams) {
        upstreams.push({
          peerId,
          status: entry.status,
          addedAt: entry.addedAt,
          stats: { ...entry.stats },
        });
      }

      const subscriptionCount = {};
      for (const [peerId, subs] of relay.subscriptions) {
        subscriptionCount[peerId] = subs.size;
      }

      return {
        success: true,
        roomId,
        status: relay.status,
        upstreamCount: relay.upstreams.size,
        upstreams,
        subscriptionCount,
        activeSpeaker: relay.activeSpeaker,
        createdAt: relay.createdAt,
      };
    } catch (error) {
      logger.error("[SFURelay] Error getting relay status:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update active speaker for a room (called with audio level data)
   * @param {string} roomId - Room identifier
   * @param {string} peerId - Peer with highest audio level
   */
  setActiveSpeaker(roomId, peerId) {
    const relay = this.relays.get(roomId);
    if (!relay) {
      return;
    }

    if (relay.activeSpeaker !== peerId) {
      const previous = relay.activeSpeaker;
      relay.activeSpeaker = peerId;

      this.emit("relay:active-speaker-changed", {
        roomId,
        previousSpeaker: previous,
        currentSpeaker: peerId,
      });
    }
  }

  /**
   * Get all active relays
   * @returns {Array} Active relay summaries
   */
  getActiveRelays() {
    const relays = [];
    for (const [roomId, relay] of this.relays) {
      if (relay.status === "active") {
        relays.push({
          roomId,
          upstreamCount: relay.upstreams.size,
          activeSpeaker: relay.activeSpeaker,
          createdAt: relay.createdAt,
        });
      }
    }
    return relays;
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  /**
   * Get a relay instance, throwing if not found or not active
   */
  _getRelay(roomId) {
    const relay = this.relays.get(roomId);
    if (!relay) {
      throw new Error(`No relay found for room ${roomId}`);
    }
    if (relay.status !== "active") {
      throw new Error(`Relay for room ${roomId} is not active (status: ${relay.status})`);
    }
    return relay;
  }

  /**
   * Add a subscription for a peer to receive from a source
   */
  _addSubscription(roomId, subscriberPeerId, sourcePeerId) {
    const relay = this.relays.get(roomId);
    if (!relay) {
      return;
    }

    if (!relay.subscriptions.has(subscriberPeerId)) {
      relay.subscriptions.set(subscriberPeerId, new Set());
    }

    relay.subscriptions.get(subscriberPeerId).add(sourcePeerId);
  }

  /**
   * Start active speaker detection for a room
   */
  _startSpeakerDetection(roomId) {
    this._stopSpeakerDetection(roomId);

    const timer = setInterval(() => {
      const relay = this.relays.get(roomId);
      if (!relay || relay.status !== "active") {
        this._stopSpeakerDetection(roomId);
        return;
      }

      // Emit request for audio levels from all upstreams
      this.emit("relay:request-audio-levels", {
        roomId,
        upstreams: Array.from(relay.upstreams.keys()),
      });
    }, this.config.activeSpeakerIntervalMs);

    this.speakerTimers.set(roomId, timer);
  }

  /**
   * Stop active speaker detection for a room
   */
  _stopSpeakerDetection(roomId) {
    const timer = this.speakerTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.speakerTimers.delete(roomId);
    }
  }

  /**
   * Start periodic cleanup of stale relays
   */
  _startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this._cleanupStaleRelays();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Clean up stale relays with no active upstreams
   */
  _cleanupStaleRelays() {
    const now = Date.now();
    const staleThreshold = this.config.cleanupIntervalMs * 2;

    for (const [roomId, relay] of this.relays) {
      if (relay.status !== "active") {
        continue;
      }

      // Check if all upstreams are stale
      let allStale = true;
      for (const [, upstream] of relay.upstreams) {
        if (now - upstream.stats.lastActivity < staleThreshold) {
          allStale = false;
          break;
        }
      }

      if (relay.upstreams.size === 0 || allStale) {
        const idleTime = now - relay.createdAt;
        if (idleTime > staleThreshold) {
          logger.info(
            `[SFURelay] Cleaning up stale relay for room ${roomId}`,
          );
          this.shutdown(roomId);
        }
      }
    }
  }

  /**
   * Clean up all resources
   */
  async destroy() {
    // Shutdown all relays
    for (const roomId of this.relays.keys()) {
      this.shutdown(roomId);
    }

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clear speaker timers
    for (const timer of this.speakerTimers.values()) {
      clearInterval(timer);
    }
    this.speakerTimers.clear();

    this.removeAllListeners();

    logger.info("[SFURelay] Destroyed");
  }
}

module.exports = { SFURelay };
