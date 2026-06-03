/**
 * WebRTC Yjs Provider
 * Custom Yjs sync provider over existing WebRTC DataChannel
 * State vector exchange, awareness protocol, P2P update broadcasting
 *
 * @module collab/webrtc-yjs-provider
 * @version 2.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// Try to load Yjs modules
let Y, awarenessProtocol, syncProtocol;
try {
  Y = require("yjs");
} catch (_e) {
  logger.warn("[WebRTCYjsProvider] yjs not available");
}
try {
  awarenessProtocol = require("y-protocols/awareness");
} catch (_e) {
  logger.warn("[WebRTCYjsProvider] y-protocols/awareness not available");
}
try {
  syncProtocol = require("y-protocols/sync");
} catch (_e) {
  logger.warn("[WebRTCYjsProvider] y-protocols/sync not available");
}

// Message types
const MSG_TYPE = {
  SYNC_STEP1: 0,
  SYNC_STEP2: 1,
  SYNC_UPDATE: 2,
  AWARENESS_UPDATE: 3,
  AWARENESS_QUERY: 4,
};

// User colors for cursor display
const COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
];

/**
 * WebRTCYjsProvider - Yjs sync over WebRTC DataChannel
 */
class WebRTCYjsProvider extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.yjsEngine - YjsCRDTEngine instance
   * @param {Object} options.webrtcManager - WebRTCDataChannelManager instance
   * @param {Object} [options.p2pManager] - P2PManager for peer discovery
   */
  constructor(options = {}) {
    super();
    this.yjsEngine = options.yjsEngine || null;
    this.webrtcManager = options.webrtcManager || null;
    this.p2pManager = options.p2pManager || null;

    // Active rooms (roomId -> { documentId, peers: Set, awareness })
    this.rooms = new Map();

    // Peer-to-document mapping
    this._peerRooms = new Map(); // peerId -> Set<roomId>

    // Awareness state (cursor positions, presence)
    this._awarenessStates = new Map(); // documentId -> Map<peerId, state>

    // Local user info
    this.localUser = {
      did: null,
      name: "Anonymous",
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };

    // Sync state tracking
    this._syncedPeers = new Map(); // documentId -> Set<peerId>
  }

  /**
   * Initialize the provider
   * @param {Object} [userInfo] - Local user information
   */
  async initialize(userInfo = {}) {
    if (userInfo.did) {
      this.localUser.did = userInfo.did;
    }
    if (userInfo.name) {
      this.localUser.name = userInfo.name;
    }
    if (userInfo.color) {
      this.localUser.color = userInfo.color;
    }

    // Set up WebRTC message handlers
    if (this.webrtcManager) {
      this.webrtcManager.on("data", (peerId, data) => {
        this._handlePeerMessage(peerId, data);
      });

      this.webrtcManager.on("peer:connected", (peerId) => {
        this._handlePeerConnected(peerId);
      });

      this.webrtcManager.on("peer:disconnected", (peerId) => {
        this._handlePeerDisconnected(peerId);
      });
    }

    logger.info(`[WebRTCYjsProvider] Initialized as ${this.localUser.name}`);
  }

  /**
   * Join a collaboration room for a document
   * @param {string} roomId
   * @param {string} documentId
   * @returns {Object} Room info
   */
  joinRoom(roomId, documentId) {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }

    // Ensure document exists in CRDT engine
    this.yjsEngine?.getOrCreateDocument(documentId);

    const room = {
      roomId,
      documentId,
      peers: new Set(),
      awarenessStates: new Map(),
      synced: false,
    };

    this.rooms.set(roomId, room);
    this._syncedPeers.set(documentId, new Set());
    this._awarenessStates.set(documentId, new Map());

    // Set up document update listener
    const docStructure = this.yjsEngine?._getDocStructure(documentId);
    if (docStructure?.doc) {
      docStructure.doc.on("update", (update, origin) => {
        if (origin !== "remote") {
          // Broadcast local changes to all room peers
          this._broadcastUpdate(roomId, update);
        }
      });
    }

    logger.info(
      `[WebRTCYjsProvider] Joined room ${roomId} for document ${documentId}`,
    );
    this.emit("room:joined", { roomId, documentId });

    return room;
  }

  /**
   * Leave a collaboration room
   * @param {string} roomId
   */
  leaveRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    // Notify peers about leaving
    this._broadcastAwareness(roomId, {
      type: "leave",
      did: this.localUser.did,
    });

    this.rooms.delete(roomId);
    this._syncedPeers.delete(room.documentId);
    this._awarenessStates.delete(room.documentId);

    logger.info(`[WebRTCYjsProvider] Left room ${roomId}`);
    this.emit("room:left", { roomId });
  }

  /**
   * Add a peer to a room
   * @param {string} roomId
   * @param {string} peerId
   */
  addPeerToRoom(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    room.peers.add(peerId);

    // Track peer-room mapping
    if (!this._peerRooms.has(peerId)) {
      this._peerRooms.set(peerId, new Set());
    }
    this._peerRooms.get(peerId).add(roomId);

    // Initiate sync with new peer
    this._initiateSync(roomId, peerId);

    this.emit("peer:added", { roomId, peerId });
  }

  /**
   * Initiate Yjs sync with a peer (send state vector)
   */
  _initiateSync(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room || !this.yjsEngine) {
      return;
    }

    // Get our state vector
    const stateVector = this.yjsEngine.getStateVector(room.documentId);

    // Send sync step 1 (our state vector)
    this._sendToPeer(peerId, {
      type: MSG_TYPE.SYNC_STEP1,
      roomId,
      stateVector: Array.from(stateVector),
    });

    // Send awareness query
    this._sendToPeer(peerId, {
      type: MSG_TYPE.AWARENESS_QUERY,
      roomId,
    });
  }

  /**
   * Handle incoming peer message
   */
  _handlePeerMessage(peerId, rawData) {
    let message;
    try {
      // Handle both Buffer and string data
      const dataStr = Buffer.isBuffer(rawData)
        ? rawData.toString("utf8")
        : typeof rawData === "string"
          ? rawData
          : JSON.stringify(rawData);

      message = JSON.parse(dataStr);
    } catch (_e) {
      return; // Not a Yjs message
    }

    if (message.type === undefined || message.roomId === undefined) {
      return;
    }

    const room = this.rooms.get(message.roomId);
    if (!room) {
      return;
    }

    switch (message.type) {
      case MSG_TYPE.SYNC_STEP1:
        this._handleSyncStep1(peerId, room, message);
        break;

      case MSG_TYPE.SYNC_STEP2:
        this._handleSyncStep2(peerId, room, message);
        break;

      case MSG_TYPE.SYNC_UPDATE:
        this._handleSyncUpdate(peerId, room, message);
        break;

      case MSG_TYPE.AWARENESS_UPDATE:
        this._handleAwarenessUpdate(peerId, room, message);
        break;

      case MSG_TYPE.AWARENESS_QUERY:
        this._sendAwarenessState(peerId, room);
        break;
    }
  }

  /**
   * Handle sync step 1: peer sends their state vector,
   * we respond with the diff they need
   */
  _handleSyncStep1(peerId, room, message) {
    if (!this.yjsEngine) {
      return;
    }

    const remoteStateVector = new Uint8Array(message.stateVector);

    // Calculate diff: updates the peer needs
    const diff = this.yjsEngine.encodeDiff(room.documentId, remoteStateVector);

    // Send sync step 2 (the diff)
    this._sendToPeer(peerId, {
      type: MSG_TYPE.SYNC_STEP2,
      roomId: room.roomId,
      update: Array.from(diff),
    });

    // Also send our state vector so they can send us what we need
    const ourStateVector = this.yjsEngine.getStateVector(room.documentId);
    this._sendToPeer(peerId, {
      type: MSG_TYPE.SYNC_STEP1,
      roomId: room.roomId,
      stateVector: Array.from(ourStateVector),
    });
  }

  /**
   * Handle sync step 2: peer sends us updates we need
   */
  _handleSyncStep2(peerId, room, message) {
    if (!this.yjsEngine) {
      return;
    }

    const update = new Uint8Array(message.update);
    this.yjsEngine.applyUpdate(room.documentId, update, "remote");

    // Mark peer as synced
    const syncedSet = this._syncedPeers.get(room.documentId);
    if (syncedSet) {
      syncedSet.add(peerId);
    }

    if (!room.synced) {
      room.synced = true;
      this.emit("room:synced", { roomId: room.roomId, peerId });
    }
  }

  /**
   * Handle incremental sync update
   */
  _handleSyncUpdate(peerId, room, message) {
    if (!this.yjsEngine) {
      return;
    }

    const update = new Uint8Array(message.update);
    this.yjsEngine.applyUpdate(room.documentId, update, "remote");

    this.emit("document:remote-update", {
      roomId: room.roomId,
      documentId: room.documentId,
      peerId,
      size: update.length,
    });
  }

  /**
   * Handle awareness update (cursor, presence)
   */
  _handleAwarenessUpdate(peerId, room, message) {
    const states = this._awarenessStates.get(room.documentId);
    if (!states) {
      return;
    }

    states.set(peerId, {
      ...message.state,
      peerId,
      lastUpdated: Date.now(),
    });

    this.emit("awareness:update", {
      roomId: room.roomId,
      peerId,
      state: message.state,
    });
  }

  /**
   * Send our awareness state to a peer
   */
  _sendAwarenessState(peerId, room) {
    this._sendToPeer(peerId, {
      type: MSG_TYPE.AWARENESS_UPDATE,
      roomId: room.roomId,
      state: {
        user: this.localUser,
        cursor: null,
        status: "online",
      },
    });
  }

  /**
   * Update local cursor position and broadcast
   * @param {string} roomId
   * @param {Object} cursor - { line, column, selection }
   */
  updateCursor(roomId, cursor) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const state = {
      user: this.localUser,
      cursor,
      status: "editing",
    };

    // Broadcast to all room peers
    for (const peerId of room.peers) {
      this._sendToPeer(peerId, {
        type: MSG_TYPE.AWARENESS_UPDATE,
        roomId,
        state,
      });
    }
  }

  /**
   * Broadcast a document update to all room peers
   */
  _broadcastUpdate(roomId, update) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const message = {
      type: MSG_TYPE.SYNC_UPDATE,
      roomId,
      update: Array.from(update),
    };

    for (const peerId of room.peers) {
      this._sendToPeer(peerId, message);
    }
  }

  /**
   * Broadcast awareness state to all room peers
   */
  _broadcastAwareness(roomId, state) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    for (const peerId of room.peers) {
      this._sendToPeer(peerId, {
        type: MSG_TYPE.AWARENESS_UPDATE,
        roomId,
        state,
      });
    }
  }

  /**
   * Send a message to a peer
   */
  _sendToPeer(peerId, message) {
    if (!this.webrtcManager) {
      return;
    }

    try {
      const data = JSON.stringify(message);
      this.webrtcManager.sendMessage(peerId, data);
    } catch (error) {
      logger.warn(
        `[WebRTCYjsProvider] Failed to send to peer ${peerId}:`,
        error.message,
      );
    }
  }

  /**
   * Handle peer connected
   */
  _handlePeerConnected(peerId) {
    logger.info(`[WebRTCYjsProvider] Peer connected: ${peerId}`);
  }

  /**
   * Handle peer disconnected
   */
  _handlePeerDisconnected(peerId) {
    const peerRooms = this._peerRooms.get(peerId);
    if (peerRooms) {
      for (const roomId of peerRooms) {
        const room = this.rooms.get(roomId);
        if (room) {
          room.peers.delete(peerId);
          // Remove awareness state
          const states = this._awarenessStates.get(room.documentId);
          if (states) {
            states.delete(peerId);
          }

          this.emit("peer:disconnected", { roomId, peerId });
        }
      }
      this._peerRooms.delete(peerId);
    }
  }

  /**
   * Get awareness states for a room
   * @param {string} roomId
   * @returns {Array}
   */
  getAwarenessStates(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }

    const states = this._awarenessStates.get(room.documentId);
    if (!states) {
      return [];
    }

    return Array.from(states.values());
  }

  /**
   * Get room info
   * @param {string} roomId
   */
  getRoomInfo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      roomId: room.roomId,
      documentId: room.documentId,
      peerCount: room.peers.size,
      synced: room.synced,
      peers: Array.from(room.peers),
    };
  }

  /**
   * Destroy provider
   */
  destroy() {
    for (const [roomId] of this.rooms) {
      this.leaveRoom(roomId);
    }
    this.rooms.clear();
    this._peerRooms.clear();
    this._awarenessStates.clear();
    this._syncedPeers.clear();
    this.removeAllListeners();
    logger.info("[WebRTCYjsProvider] Destroyed");
  }
}

module.exports = {
  WebRTCYjsProvider,
  MSG_TYPE,
  COLORS,
};
