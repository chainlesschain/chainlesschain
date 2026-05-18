/**
 * Social Collaboration Sync
 *
 * P2P document synchronization protocol for social collaborative editing.
 * Handles real-time sync of document updates between peers using the
 * /chainlesschain/social-collab/1.0.0 protocol.
 *
 * @module social/collab-sync
 * @version 0.41.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * Protocol identifier for social collaboration sync
 */
const PROTOCOL_SOCIAL_COLLAB = "/chainlesschain/social-collab/1.0.0";

/**
 * Message types for the sync protocol
 */
const MessageType = {
  UPDATE: "update",
  FULL_STATE_REQUEST: "full_state_request",
  FULL_STATE_RESPONSE: "full_state_response",
  SYNC_START: "sync_start",
  SYNC_STOP: "sync_stop",
};

class CollabSync extends EventEmitter {
  /**
   * @param {Object} p2pManager - P2P network manager
   * @param {Object} yjsCollabManager - Yjs collaboration manager (optional)
   */
  constructor(p2pManager, yjsCollabManager = null) {
    super();

    this.p2pManager = p2pManager;
    this.yjsCollabManager = yjsCollabManager;

    // Active sync sessions: docId -> { peers: Set<peerId>, active: boolean }
    this.syncSessions = new Map();

    // Pending updates queue: docId -> [{ peerId, data, timestamp }]
    this.pendingUpdates = new Map();

    this.initialized = false;
  }

  /**
   * Initialize the sync module
   */
  async initialize() {
    logger.info("[CollabSync] Initializing...");

    try {
      this._setupP2PListeners();
      this.initialized = true;
      logger.info("[CollabSync] Initialized successfully");
    } catch (error) {
      logger.error("[CollabSync] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Set up P2P protocol handlers
   */
  _setupP2PListeners() {
    if (!this.p2pManager) {
      logger.warn("[CollabSync] P2P manager not available, sync disabled");
      return;
    }

    // Handle incoming sync protocol messages
    if (this.p2pManager.node && typeof this.p2pManager.node.handle === "function") {
      this.p2pManager.node.handle(
        PROTOCOL_SOCIAL_COLLAB,
        async ({ stream, connection }) => {
          try {
            const peerId = connection.remotePeer.toString();
            await this._handleIncomingStream(peerId, stream);
          } catch (error) {
            logger.error("[CollabSync] Error handling incoming stream:", error);
          }
        },
      );
    }

    // Listen for peer connection/disconnection events
    if (typeof this.p2pManager.on === "function") {
      this.p2pManager.on("peer:connected", ({ peerId }) => {
        this._handlePeerConnected(peerId);
      });

      this.p2pManager.on("peer:disconnected", ({ peerId }) => {
        this._handlePeerDisconnected(peerId);
      });
    }

    logger.info("[CollabSync] P2P listeners configured");
  }

  /**
   * Start syncing a document with a specific peer
   * @param {string} docId - Document ID
   * @param {string} peerId - Peer ID to sync with
   * @returns {Object} Result
   */
  async startSync(docId, peerId) {
    try {
      if (!docId || !peerId) {
        throw new Error("Document ID and peer ID are required");
      }

      // Initialize sync session if not exists
      if (!this.syncSessions.has(docId)) {
        this.syncSessions.set(docId, { peers: new Set(), active: true });
      }

      const session = this.syncSessions.get(docId);
      session.peers.add(peerId);
      session.active = true;

      // Send sync start message to peer
      await this._sendMessage(peerId, {
        type: MessageType.SYNC_START,
        docId,
        timestamp: Date.now(),
      });

      // Request full state from peer to ensure we're in sync
      await this.requestFullState(docId, peerId);

      this.emit("sync:connected", { docId, peerId });
      logger.info(`[CollabSync] Sync started for doc ${docId} with peer ${peerId}`);

      return { success: true, docId, peerId };
    } catch (error) {
      logger.error("[CollabSync] Error starting sync:", error);
      throw error;
    }
  }

  /**
   * Stop syncing a document (with all peers or a specific peer)
   * @param {string} docId - Document ID
   * @param {string} [peerId] - Optional specific peer to stop syncing with
   * @returns {Object} Result
   */
  async stopSync(docId, peerId = null) {
    try {
      if (!docId) {
        throw new Error("Document ID is required");
      }

      const session = this.syncSessions.get(docId);
      if (!session) {
        return { success: true };
      }

      if (peerId) {
        // Stop sync with specific peer
        session.peers.delete(peerId);

        await this._sendMessage(peerId, {
          type: MessageType.SYNC_STOP,
          docId,
          timestamp: Date.now(),
        }).catch(() => {
          // Peer may already be disconnected
        });

        this.emit("sync:disconnected", { docId, peerId });
        logger.info(`[CollabSync] Sync stopped for doc ${docId} with peer ${peerId}`);

        if (session.peers.size === 0) {
          session.active = false;
          this.syncSessions.delete(docId);
        }
      } else {
        // Stop sync with all peers
        for (const pid of session.peers) {
          await this._sendMessage(pid, {
            type: MessageType.SYNC_STOP,
            docId,
            timestamp: Date.now(),
          }).catch(() => {
            // Peer may already be disconnected
          });

          this.emit("sync:disconnected", { docId, peerId: pid });
        }

        session.peers.clear();
        session.active = false;
        this.syncSessions.delete(docId);
        logger.info(`[CollabSync] All sync stopped for doc ${docId}`);
      }

      return { success: true };
    } catch (error) {
      logger.error("[CollabSync] Error stopping sync:", error);
      throw error;
    }
  }

  /**
   * Broadcast a document update to all syncing peers
   * @param {string} docId - Document ID
   * @param {Uint8Array|Buffer} update - The update data (Yjs update or raw bytes)
   * @returns {Object} Result with count of peers notified
   */
  async broadcastUpdate(docId, update) {
    try {
      if (!docId || !update) {
        throw new Error("Document ID and update data are required");
      }

      const session = this.syncSessions.get(docId);
      if (!session || !session.active || session.peers.size === 0) {
        return { success: true, peersNotified: 0 };
      }

      let peersNotified = 0;
      const updatePayload = {
        type: MessageType.UPDATE,
        docId,
        data: Array.from(update instanceof Buffer ? update : new Uint8Array(update)),
        timestamp: Date.now(),
      };

      for (const peerId of session.peers) {
        try {
          await this._sendMessage(peerId, updatePayload);
          peersNotified++;
        } catch (error) {
          logger.warn(`[CollabSync] Failed to send update to peer ${peerId}:`, error.message);
        }
      }

      this.emit("sync:update", { docId, peersNotified });

      return { success: true, peersNotified };
    } catch (error) {
      logger.error("[CollabSync] Error broadcasting update:", error);
      throw error;
    }
  }

  /**
   * Request the full document state from a peer
   * @param {string} docId - Document ID
   * @param {string} peerId - Peer to request from
   * @returns {Object} Result
   */
  async requestFullState(docId, peerId) {
    try {
      if (!docId || !peerId) {
        throw new Error("Document ID and peer ID are required");
      }

      await this._sendMessage(peerId, {
        type: MessageType.FULL_STATE_REQUEST,
        docId,
        timestamp: Date.now(),
      });

      logger.info(`[CollabSync] Full state requested for doc ${docId} from peer ${peerId}`);

      return { success: true };
    } catch (error) {
      logger.error("[CollabSync] Error requesting full state:", error);
      throw error;
    }
  }

  /**
   * Handle an incoming update from a peer
   * @param {string} peerId - Peer that sent the update
   * @param {Object} data - Message data
   */
  async handleIncomingUpdate(peerId, data) {
    try {
      if (!peerId || !data) {
        return;
      }

      const { type, docId } = data;

      switch (type) {
        case MessageType.UPDATE: {
          const updateBytes = new Uint8Array(data.data);

          // Apply to Yjs document if available
          if (this.yjsCollabManager) {
            try {
              const ydoc = this.yjsCollabManager.getDocument(docId);
              if (ydoc) {
                const Y = require("yjs");
                Y.applyUpdate(ydoc, updateBytes, "network");
              }
            } catch (err) {
              logger.warn("[CollabSync] Failed to apply Yjs update:", err.message);
            }
          }

          this.emit("sync:update", { docId, peerId, data: updateBytes });
          break;
        }

        case MessageType.FULL_STATE_REQUEST: {
          // Send full state back to the requesting peer
          if (this.yjsCollabManager) {
            try {
              const ydoc = this.yjsCollabManager.getDocument(docId);
              if (ydoc) {
                const Y = require("yjs");
                const state = Y.encodeStateAsUpdate(ydoc);
                await this._sendMessage(peerId, {
                  type: MessageType.FULL_STATE_RESPONSE,
                  docId,
                  data: Array.from(state),
                  timestamp: Date.now(),
                });
              }
            } catch (err) {
              logger.warn("[CollabSync] Failed to send full state:", err.message);
            }
          }
          break;
        }

        case MessageType.FULL_STATE_RESPONSE: {
          const stateBytes = new Uint8Array(data.data);

          if (this.yjsCollabManager) {
            try {
              const ydoc = this.yjsCollabManager.getDocument(docId);
              if (ydoc) {
                const Y = require("yjs");
                Y.applyUpdate(ydoc, stateBytes, "network");
              }
            } catch (err) {
              logger.warn("[CollabSync] Failed to apply full state:", err.message);
            }
          }

          this.emit("sync:update", { docId, peerId, fullState: true });
          break;
        }

        case MessageType.SYNC_START: {
          // Peer wants to start syncing - add them to our session
          if (!this.syncSessions.has(docId)) {
            this.syncSessions.set(docId, { peers: new Set(), active: true });
          }
          this.syncSessions.get(docId).peers.add(peerId);

          this.emit("sync:connected", { docId, peerId });
          logger.info(`[CollabSync] Peer ${peerId} joined sync for doc ${docId}`);
          break;
        }

        case MessageType.SYNC_STOP: {
          // Peer wants to stop syncing
          const session = this.syncSessions.get(docId);
          if (session) {
            session.peers.delete(peerId);
            if (session.peers.size === 0) {
              this.syncSessions.delete(docId);
            }
          }

          this.emit("sync:disconnected", { docId, peerId });
          logger.info(`[CollabSync] Peer ${peerId} left sync for doc ${docId}`);
          break;
        }

        default:
          logger.warn(`[CollabSync] Unknown message type: ${type}`);
      }
    } catch (error) {
      logger.error("[CollabSync] Error handling incoming update:", error);
    }
  }

  /**
   * Get the list of peers syncing a specific document
   * @param {string} docId - Document ID
   * @returns {string[]} List of peer IDs
   */
  getSyncPeers(docId) {
    const session = this.syncSessions.get(docId);
    if (!session) {
      return [];
    }
    return Array.from(session.peers);
  }

  /**
   * Check if a document is actively syncing
   * @param {string} docId - Document ID
   * @returns {boolean}
   */
  isSyncing(docId) {
    const session = this.syncSessions.get(docId);
    return session ? session.active && session.peers.size > 0 : false;
  }

  // ========================================
  // Internal Methods
  // ========================================

  /**
   * Handle incoming P2P stream
   */
  async _handleIncomingStream(peerId, stream) {
    try {
      const chunks = [];

      await new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);

        // Timeout for stream reading
        setTimeout(() => resolve(), 30000);
      });

      if (chunks.length === 0) {
        return;
      }

      const raw = Buffer.concat(chunks);
      const data = JSON.parse(raw.toString("utf-8"));

      await this.handleIncomingUpdate(peerId, data);
    } catch (error) {
      logger.error(`[CollabSync] Error handling stream from ${peerId}:`, error);
    }
  }

  /**
   * Send a message to a peer via P2P
   */
  async _sendMessage(peerId, message) {
    if (!this.p2pManager || !this.p2pManager.node) {
      throw new Error("P2P manager not available");
    }

    try {
      const stream = await this.p2pManager.node.dialProtocol(
        peerId,
        PROTOCOL_SOCIAL_COLLAB,
      );

      const payload = Buffer.from(JSON.stringify(message), "utf-8");

      await new Promise((resolve, reject) => {
        stream.write(payload, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      stream.close();
    } catch (error) {
      throw new Error(`Failed to send message to ${peerId}: ${error.message}`);
    }
  }

  /**
   * Handle peer connected event
   */
  _handlePeerConnected(peerId) {
    // Auto-resume sync for any documents that had this peer
    for (const [docId, session] of this.syncSessions) {
      if (session.peers.has(peerId) && session.active) {
        this.emit("sync:connected", { docId, peerId });
        logger.info(`[CollabSync] Peer ${peerId} reconnected for doc ${docId}`);
      }
    }
  }

  /**
   * Handle peer disconnected event
   */
  _handlePeerDisconnected(peerId) {
    for (const [docId, session] of this.syncSessions) {
      if (session.peers.has(peerId)) {
        this.emit("sync:disconnected", { docId, peerId });
        logger.info(`[CollabSync] Peer ${peerId} disconnected from doc ${docId}`);
      }
    }
  }

  /**
   * Clean up resources
   */
  async destroy() {
    // Stop all active sync sessions
    for (const [docId] of this.syncSessions) {
      try {
        await this.stopSync(docId);
      } catch (err) {
        // Ignore errors during cleanup
      }
    }

    this.syncSessions.clear();
    this.pendingUpdates.clear();
    this.removeAllListeners();
    this.initialized = false;

    logger.info("[CollabSync] Destroyed");
  }
}

module.exports = {
  CollabSync,
  PROTOCOL_SOCIAL_COLLAB,
  MessageType,
};
