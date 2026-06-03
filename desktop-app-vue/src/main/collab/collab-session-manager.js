/**
 * Collaboration Session Manager
 * Room lifecycle, RBAC permission control, online status, offline editing
 *
 * @module collab/collab-session-manager
 * @version 2.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// Room status
const ROOM_STATUS = {
  ACTIVE: "active",
  CLOSED: "closed",
  ARCHIVED: "archived",
};

// Participant roles
const ROLE = {
  VIEWER: "viewer",
  EDITOR: "editor",
  ADMIN: "admin",
};

// Participant status
const PARTICIPANT_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  EDITING: "editing",
};

/**
 * CollabSessionManager
 * Manages collaboration room lifecycle and participants
 */
class CollabSessionManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.yjsProvider - WebRTCYjsProvider instance
   * @param {Object} options.yjsEngine - YjsCRDTEngine instance
   * @param {Object} [options.permissionEngine] - PermissionEngine instance
   * @param {Object} [options.p2pManager] - P2PManager instance
   * @param {Object} options.database - DatabaseManager instance
   * @param {Object} [options.mainWindow] - Electron main window
   */
  constructor(options = {}) {
    super();
    this.yjsProvider = options.yjsProvider || null;
    this.yjsEngine = options.yjsEngine || null;
    this.permissionEngine = options.permissionEngine || null;
    this.p2pManager = options.p2pManager || null;
    this.db = options.database || null;
    this.mainWindow = options.mainWindow || null;

    // Active rooms (roomId -> room info)
    this.activeRooms = new Map();

    // Local user info
    this.localUser = {
      did: null,
      name: "Anonymous",
    };

    // Offline edit buffer
    this._offlineEdits = new Map(); // documentId -> [updates]
  }

  /**
   * Initialize session manager
   * @param {Object} [userInfo]
   */
  async initialize(userInfo = {}) {
    if (userInfo.did) {
      this.localUser.did = userInfo.did;
    }
    if (userInfo.name) {
      this.localUser.name = userInfo.name;
    }

    // Set up Yjs provider event listeners
    if (this.yjsProvider) {
      this.yjsProvider.on("room:synced", (data) => {
        this._handleRoomSynced(data);
      });

      this.yjsProvider.on("peer:disconnected", (data) => {
        this._handlePeerDisconnected(data);
      });

      this.yjsProvider.on("awareness:update", (data) => {
        this._forwardToRenderer("collab:awareness-update", data);
      });
    }

    // Set up P2P topic subscription for room discovery
    if (this.p2pManager) {
      this.p2pManager.on("message", (peerId, message) => {
        if (message.type === "collab:invite") {
          this._handleInvite(peerId, message);
        }
      });
    }

    logger.info("[CollabSessionManager] Initialized");
  }

  /**
   * Create a new collaboration room
   * @param {Object} options
   * @param {string} options.documentId - Document to collaborate on
   * @param {number} [options.maxParticipants=10]
   * @param {Object} [options.permissions] - Default permissions
   * @returns {Object} Room info
   */
  async createRoom(options) {
    const roomId = uuidv4();
    const topic = `collab:${roomId}`;

    const room = {
      id: roomId,
      documentId: options.documentId,
      topic,
      ownerDid: this.localUser.did,
      maxParticipants: options.maxParticipants || 10,
      permissions: options.permissions || { defaultRole: ROLE.EDITOR },
      status: ROOM_STATUS.ACTIVE,
      createdAt: Date.now(),
      participants: new Map(),
    };

    // Add creator as admin
    room.participants.set(this.localUser.did, {
      did: this.localUser.did,
      name: this.localUser.name,
      role: ROLE.ADMIN,
      status: PARTICIPANT_STATUS.ONLINE,
      joinedAt: Date.now(),
    });

    // Save to database
    if (this.db) {
      this.db.run(
        `INSERT INTO collab_rooms (id, document_id, topic, owner_did, max_participants, permissions, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          roomId,
          options.documentId,
          topic,
          this.localUser.did,
          room.maxParticipants,
          JSON.stringify(room.permissions),
          ROOM_STATUS.ACTIVE,
        ],
      );

      this.db.run(
        `INSERT INTO collab_participants (id, room_id, user_did, user_name, role, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          roomId,
          this.localUser.did,
          this.localUser.name,
          ROLE.ADMIN,
          PARTICIPANT_STATUS.ONLINE,
        ],
      );
    }

    this.activeRooms.set(roomId, room);

    // Join the room in Yjs provider
    this.yjsProvider?.joinRoom(roomId, options.documentId);

    // Subscribe to P2P topic
    this.p2pManager?.subscribe?.(topic);

    logger.info(
      `[CollabSessionManager] Created room ${roomId} for document ${options.documentId}`,
    );
    this.emit("room:created", { roomId, documentId: options.documentId });

    return {
      roomId,
      topic,
      documentId: options.documentId,
      ownerDid: this.localUser.did,
    };
  }

  /**
   * Join an existing collaboration room
   * @param {string} roomId
   * @param {string} documentId
   * @returns {Object}
   */
  async joinRoom(roomId, documentId) {
    if (this.activeRooms.has(roomId)) {
      return this.activeRooms.get(roomId);
    }

    const room = {
      id: roomId,
      documentId,
      topic: `collab:${roomId}`,
      ownerDid: null,
      maxParticipants: 10,
      permissions: { defaultRole: ROLE.EDITOR },
      status: ROOM_STATUS.ACTIVE,
      createdAt: Date.now(),
      participants: new Map(),
    };

    // Add self
    room.participants.set(this.localUser.did, {
      did: this.localUser.did,
      name: this.localUser.name,
      role: ROLE.EDITOR,
      status: PARTICIPANT_STATUS.ONLINE,
      joinedAt: Date.now(),
    });

    this.activeRooms.set(roomId, room);

    // Join in Yjs provider
    this.yjsProvider?.joinRoom(roomId, documentId);

    // Save participant record
    if (this.db) {
      this.db.run(
        `INSERT OR REPLACE INTO collab_participants (id, room_id, user_did, user_name, role, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          roomId,
          this.localUser.did,
          this.localUser.name,
          ROLE.EDITOR,
          PARTICIPANT_STATUS.ONLINE,
        ],
      );
    }

    logger.info(`[CollabSessionManager] Joined room ${roomId}`);
    this.emit("room:joined", { roomId, documentId });

    return room;
  }

  /**
   * Leave a collaboration room
   * @param {string} roomId
   */
  async leaveRoom(roomId) {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      return;
    }

    // Update participant status
    if (this.db) {
      this.db.run(
        `UPDATE collab_participants SET status = ? WHERE room_id = ? AND user_did = ?`,
        [PARTICIPANT_STATUS.OFFLINE, roomId, this.localUser.did],
      );
    }

    // Leave in Yjs provider
    this.yjsProvider?.leaveRoom(roomId);

    // Unsubscribe from P2P topic
    this.p2pManager?.unsubscribe?.(room.topic);

    this.activeRooms.delete(roomId);

    logger.info(`[CollabSessionManager] Left room ${roomId}`);
    this.emit("room:left", { roomId });
  }

  /**
   * Invite a user to a room
   * @param {string} roomId
   * @param {string} inviteeDid - DID of the user to invite
   * @param {string} [role='editor']
   */
  async inviteUser(roomId, inviteeDid, role = ROLE.EDITOR) {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    // Check permission
    if (!this._hasPermission(roomId, this.localUser.did, "invite")) {
      throw new Error("No permission to invite users");
    }

    // Check room capacity
    if (room.participants.size >= room.maxParticipants) {
      throw new Error("Room is at maximum capacity");
    }

    // Send invite via P2P
    if (this.p2pManager) {
      this.p2pManager.broadcast?.(room.topic, {
        type: "collab:invite",
        roomId,
        documentId: room.documentId,
        inviteeDid,
        role,
        inviterDid: this.localUser.did,
        inviterName: this.localUser.name,
      });
    }

    logger.info(
      `[CollabSessionManager] Invited ${inviteeDid} to room ${roomId}`,
    );
    this.emit("room:invite-sent", { roomId, inviteeDid, role });
  }

  /**
   * Handle incoming invite
   */
  _handleInvite(peerId, message) {
    if (message.inviteeDid !== this.localUser.did) {
      return;
    }

    this.emit("room:invite-received", {
      roomId: message.roomId,
      documentId: message.documentId,
      inviterDid: message.inviterDid,
      inviterName: message.inviterName,
      role: message.role,
    });

    this._forwardToRenderer("collab:invite-received", message);
  }

  // ==========================================
  // Permission Control
  // ==========================================

  /**
   * Check if a user has a specific permission
   * @param {string} roomId
   * @param {string} userDid
   * @param {string} action - 'view' | 'edit' | 'invite' | 'admin'
   * @returns {boolean}
   */
  _hasPermission(roomId, userDid, action) {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(userDid);
    if (!participant) {
      return false;
    }

    const rolePermissions = {
      [ROLE.VIEWER]: ["view"],
      [ROLE.EDITOR]: ["view", "edit"],
      [ROLE.ADMIN]: ["view", "edit", "invite", "admin"],
    };

    return (rolePermissions[participant.role] || []).includes(action);
  }

  /**
   * Set participant role
   * @param {string} roomId
   * @param {string} targetDid
   * @param {string} newRole
   */
  async setParticipantRole(roomId, targetDid, newRole) {
    if (!this._hasPermission(roomId, this.localUser.did, "admin")) {
      throw new Error("No admin permission");
    }

    const room = this.activeRooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    const participant = room.participants.get(targetDid);
    if (participant) {
      participant.role = newRole;
    }

    if (this.db) {
      this.db.run(
        `UPDATE collab_participants SET role = ? WHERE room_id = ? AND user_did = ?`,
        [newRole, roomId, targetDid],
      );
    }
  }

  // ==========================================
  // Online/Offline Status
  // ==========================================

  /**
   * Update participant status
   * @param {string} roomId
   * @param {string} userDid
   * @param {string} status
   */
  updateParticipantStatus(roomId, userDid, status) {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      return;
    }

    const participant = room.participants.get(userDid);
    if (participant) {
      participant.status = status;
      participant.lastActive = Date.now();
    }

    if (this.db) {
      this.db.run(
        `UPDATE collab_participants SET status = ?, last_active = datetime('now') WHERE room_id = ? AND user_did = ?`,
        [status, roomId, userDid],
      );
    }

    this.emit("participant:status-changed", { roomId, userDid, status });
  }

  /**
   * Get participants list for a room
   * @param {string} roomId
   * @returns {Array}
   */
  getParticipants(roomId) {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      return [];
    }

    return Array.from(room.participants.values());
  }

  // ==========================================
  // Offline Editing
  // ==========================================

  /**
   * Buffer an offline edit
   * @param {string} documentId
   * @param {Uint8Array} update - Yjs update
   */
  bufferOfflineEdit(documentId, update) {
    if (!this._offlineEdits.has(documentId)) {
      this._offlineEdits.set(documentId, []);
    }
    this._offlineEdits.get(documentId).push({
      update,
      timestamp: Date.now(),
    });

    // Persist to database
    if (this.db) {
      const roomId = this._findRoomForDocument(documentId);
      this.db.run(
        `INSERT INTO collab_offline_edits (id, room_id, document_id, user_did, yjs_update, edit_count)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [
          uuidv4(),
          roomId || "",
          documentId,
          this.localUser.did,
          Buffer.from(update),
        ],
      );
    }
  }

  /**
   * Apply buffered offline edits when reconnecting
   * @param {string} documentId
   */
  async applyOfflineEdits(documentId) {
    const edits = this._offlineEdits.get(documentId);
    if (!edits || edits.length === 0) {
      return;
    }

    logger.info(
      `[CollabSessionManager] Applying ${edits.length} offline edits for ${documentId}`,
    );

    for (const edit of edits) {
      // CRDT auto-merge handles conflicts
      this.yjsEngine?.applyUpdate(documentId, edit.update, "offline");
    }

    this._offlineEdits.delete(documentId);

    // Mark as applied in database
    if (this.db) {
      this.db.run(
        `UPDATE collab_offline_edits SET applied_at = datetime('now')
         WHERE document_id = ? AND user_did = ? AND applied_at IS NULL`,
        [documentId, this.localUser.did],
      );
    }

    this.emit("offline:edits-applied", { documentId, count: edits.length });
  }

  // ==========================================
  // Room Info Queries
  // ==========================================

  /**
   * Get room info
   * @param {string} roomId
   */
  getRoomInfo(roomId) {
    const room = this.activeRooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      id: room.id,
      documentId: room.documentId,
      topic: room.topic,
      ownerDid: room.ownerDid,
      status: room.status,
      maxParticipants: room.maxParticipants,
      participantCount: room.participants.size,
      participants: this.getParticipants(roomId),
    };
  }

  /**
   * Get all active rooms
   */
  getActiveRooms() {
    return Array.from(this.activeRooms.values()).map((room) => ({
      id: room.id,
      documentId: room.documentId,
      status: room.status,
      participantCount: room.participants.size,
    }));
  }

  _findRoomForDocument(documentId) {
    for (const [roomId, room] of this.activeRooms) {
      if (room.documentId === documentId) {
        return roomId;
      }
    }
    return null;
  }

  _handleRoomSynced(data) {
    this._forwardToRenderer("collab:room-synced", data);
    this.emit("room:synced", data);
  }

  _handlePeerDisconnected(data) {
    const room = this.activeRooms.get(data.roomId);
    if (room) {
      // Update participant status
      for (const [did, participant] of room.participants) {
        if (participant.peerId === data.peerId) {
          participant.status = PARTICIPANT_STATUS.OFFLINE;
          break;
        }
      }
    }
    this._forwardToRenderer("collab:peer-left", data);
  }

  _forwardToRenderer(channel, data) {
    try {
      this.mainWindow?.webContents?.send?.(channel, data);
    } catch (_e) {
      // Renderer not available
    }
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    for (const [roomId] of this.activeRooms) {
      this.leaveRoom(roomId);
    }
    this.activeRooms.clear();
    this._offlineEdits.clear();
    this.removeAllListeners();
    logger.info("[CollabSessionManager] Destroyed");
  }
}

module.exports = {
  CollabSessionManager,
  ROOM_STATUS,
  ROLE,
  PARTICIPANT_STATUS,
};
