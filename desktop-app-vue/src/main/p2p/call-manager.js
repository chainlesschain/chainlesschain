/**
 * Call Room Lifecycle Manager
 *
 * Manages voice/video call rooms, participants, and room lifecycle.
 * Integrates with P2P network for decentralized call signaling.
 *
 * Features:
 * - Create/join/leave/end call rooms
 * - Track participants with roles (host/participant)
 * - Support voice and video call types
 * - Max 8 participants per room
 * - Persistent room/participant state in SQLite
 *
 * @module p2p/call-manager
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Default configuration for call rooms
 */
const DEFAULT_CONFIG = {
  maxParticipants: 8,
  ringTimeoutMs: 30000,
  roomIdleTimeoutMs: 300000,
};

/**
 * Call Manager class
 * Manages call room lifecycle and participant tracking
 */
class CallManager extends EventEmitter {
  constructor(database, didManager, p2pManager, config = {}) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // In-memory tracking of active rooms for fast lookup
    this.activeRooms = new Map();

    // Ring timeout timers per room
    this.ringTimers = new Map();

    // Room idle timers
    this.idleTimers = new Map();

    this.initialized = false;
  }

  /**
   * Initialize the call manager
   * Creates database tables and sets up P2P listeners
   */
  async initialize() {
    if (this.initialized) {
      logger.warn("[CallManager] Already initialized");
      return;
    }

    try {
      await this.initializeTables();
      this.setupP2PListeners();
      await this.recoverActiveRooms();
      this.initialized = true;
      logger.info("[CallManager] Initialized successfully");
    } catch (error) {
      logger.error("[CallManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Create database tables for call rooms and participants
   */
  async initializeTables() {
    try {
      const db = this.database.getDatabase();

      db.exec(`
        CREATE TABLE IF NOT EXISTS call_rooms (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('voice', 'video')),
          creator_did TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
          max_participants INTEGER DEFAULT 8,
          created_at INTEGER NOT NULL,
          ended_at INTEGER
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS call_participants (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          participant_did TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'participant' CHECK(role IN ('host', 'participant')),
          status TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing', 'connected', 'left')),
          joined_at INTEGER,
          left_at INTEGER,
          UNIQUE(room_id, participant_did),
          FOREIGN KEY (room_id) REFERENCES call_rooms(id) ON DELETE CASCADE
        )
      `);

      // Create indexes for common queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_call_rooms_status ON call_rooms(status);
        CREATE INDEX IF NOT EXISTS idx_call_rooms_creator ON call_rooms(creator_did);
        CREATE INDEX IF NOT EXISTS idx_call_participants_room ON call_participants(room_id);
        CREATE INDEX IF NOT EXISTS idx_call_participants_did ON call_participants(participant_did);
        CREATE INDEX IF NOT EXISTS idx_call_participants_status ON call_participants(status);
      `);

      logger.info("[CallManager] Database tables initialized");
    } catch (error) {
      logger.error("[CallManager] Failed to initialize tables:", error);
      throw error;
    }
  }

  /**
   * Set up P2P protocol listeners for incoming call signals
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      logger.warn(
        "[CallManager] P2P manager not available, skipping listener setup",
      );
      return;
    }

    // Listen for incoming call invitations via P2P messages
    this.p2pManager.on("message:call-invite", async (data) => {
      try {
        const { roomId, callerDid, callType } = data;
        logger.info(
          `[CallManager] Received call invite from ${callerDid} for room ${roomId}`,
        );

        this.emit("call:incoming", {
          roomId,
          callerDid,
          type: callType,
        });
      } catch (error) {
        logger.error("[CallManager] Error handling call invite:", error);
      }
    });

    // Listen for participant status updates from remote peers
    this.p2pManager.on("message:call-status", async (data) => {
      try {
        const { roomId, participantDid, status } = data;
        logger.info(
          `[CallManager] Participant ${participantDid} status update: ${status} in room ${roomId}`,
        );

        if (status === "connected") {
          await this._updateParticipantStatus(
            roomId,
            participantDid,
            "connected",
          );
          this.emit("participant:joined", { roomId, participantDid });
        } else if (status === "left") {
          await this._updateParticipantStatus(roomId, participantDid, "left");
          this.emit("participant:left", { roomId, participantDid });
          await this._checkRoomEmpty(roomId);
        }
      } catch (error) {
        logger.error(
          "[CallManager] Error handling call status update:",
          error,
        );
      }
    });

    logger.info("[CallManager] P2P listeners set up");
  }

  /**
   * Recover active rooms from database on startup
   */
  async recoverActiveRooms() {
    try {
      const db = this.database.getDatabase();
      const rooms = db
        .prepare("SELECT * FROM call_rooms WHERE status = 'active'")
        .all();

      for (const room of rooms) {
        const participants = db
          .prepare(
            "SELECT * FROM call_participants WHERE room_id = ? AND status != 'left'",
          )
          .all(room.id);

        // If no active participants, end the room
        if (participants.length === 0) {
          await this.endRoom(room.id);
        } else {
          this.activeRooms.set(room.id, {
            ...room,
            participants: participants.map((p) => p.participant_did),
          });
        }
      }

      logger.info(
        `[CallManager] Recovered ${this.activeRooms.size} active rooms`,
      );
    } catch (error) {
      logger.error("[CallManager] Error recovering active rooms:", error);
    }
  }

  /**
   * Create a new call room
   * @param {Object} options - Room creation options
   * @param {string} options.type - Call type ('voice' or 'video')
   * @param {number} [options.maxParticipants] - Maximum participants (default: 8)
   * @param {string[]} [options.inviteDids] - DIDs to invite
   * @returns {Object} Created room info
   */
  async createRoom({ type, maxParticipants, inviteDids = [] }) {
    try {
      if (!type || !["voice", "video"].includes(type)) {
        throw new Error('Invalid call type. Must be "voice" or "video"');
      }

      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("No active DID identity");
      }

      const roomId = uuidv4();
      const now = Date.now();
      const maxPart =
        maxParticipants || this.config.maxParticipants;

      const db = this.database.getDatabase();

      // Create the room
      db.prepare(
        `INSERT INTO call_rooms (id, type, creator_did, status, max_participants, created_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      ).run(roomId, type, currentDid, maxPart, now);

      // Add the creator as host
      const hostId = uuidv4();
      db.prepare(
        `INSERT INTO call_participants (id, room_id, participant_did, role, status, joined_at)
         VALUES (?, ?, ?, 'host', 'connected', ?)`,
      ).run(hostId, roomId, currentDid, now);

      // Track in memory
      this.activeRooms.set(roomId, {
        id: roomId,
        type,
        creator_did: currentDid,
        status: "active",
        max_participants: maxPart,
        created_at: now,
        participants: [currentDid],
      });

      const room = {
        id: roomId,
        type,
        creatorDid: currentDid,
        status: "active",
        maxParticipants: maxPart,
        createdAt: now,
      };

      this.emit("room:created", room);

      // Send invitations to specified DIDs
      for (const did of inviteDids) {
        await this._sendCallInvite(roomId, did, type);
      }

      // Set up idle timer
      this._resetIdleTimer(roomId);

      logger.info(
        `[CallManager] Room ${roomId} created (${type}) by ${currentDid}`,
      );

      return {
        success: true,
        room,
      };
    } catch (error) {
      logger.error("[CallManager] Error creating room:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Join an existing call room
   * @param {string} roomId - Room ID to join
   * @returns {Object} Join result
   */
  async joinRoom(roomId) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("No active DID identity");
      }

      const db = this.database.getDatabase();

      // Verify room exists and is active
      const room = db
        .prepare("SELECT * FROM call_rooms WHERE id = ? AND status = 'active'")
        .get(roomId);

      if (!room) {
        throw new Error("Room not found or already ended");
      }

      // Check participant count
      const activeParticipants = db
        .prepare(
          "SELECT COUNT(*) as count FROM call_participants WHERE room_id = ? AND status != 'left'",
        )
        .get(roomId);

      if (activeParticipants.count >= room.max_participants) {
        throw new Error("Room is full");
      }

      // Check if already in room
      const existing = db
        .prepare(
          "SELECT * FROM call_participants WHERE room_id = ? AND participant_did = ?",
        )
        .get(roomId, currentDid);

      const now = Date.now();

      if (existing) {
        // Re-join if previously left
        if (existing.status === "left") {
          db.prepare(
            "UPDATE call_participants SET status = 'connected', joined_at = ?, left_at = NULL WHERE id = ?",
          ).run(now, existing.id);
        } else {
          // Already in room
          return {
            success: true,
            room: this._formatRoom(room),
            alreadyJoined: true,
          };
        }
      } else {
        // Add new participant
        const participantId = uuidv4();
        db.prepare(
          `INSERT INTO call_participants (id, room_id, participant_did, role, status, joined_at)
           VALUES (?, ?, ?, 'participant', 'connected', ?)`,
        ).run(participantId, roomId, currentDid, now);
      }

      // Update in-memory tracking
      const tracked = this.activeRooms.get(roomId);
      if (tracked) {
        if (!tracked.participants.includes(currentDid)) {
          tracked.participants.push(currentDid);
        }
      }

      // Notify other participants via P2P
      await this._broadcastToRoom(roomId, "call-status", {
        roomId,
        participantDid: currentDid,
        status: "connected",
      });

      this.emit("participant:joined", { roomId, participantDid: currentDid });
      this._resetIdleTimer(roomId);

      logger.info(`[CallManager] ${currentDid} joined room ${roomId}`);

      return {
        success: true,
        room: this._formatRoom(room),
      };
    } catch (error) {
      logger.error("[CallManager] Error joining room:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Leave a call room
   * @param {string} roomId - Room ID to leave
   * @returns {Object} Leave result
   */
  async leaveRoom(roomId) {
    try {
      const currentDid = this._getCurrentDid();
      if (!currentDid) {
        throw new Error("No active DID identity");
      }

      const db = this.database.getDatabase();
      const now = Date.now();

      // Update participant status
      const result = db
        .prepare(
          `UPDATE call_participants SET status = 'left', left_at = ?
           WHERE room_id = ? AND participant_did = ? AND status != 'left'`,
        )
        .run(now, roomId, currentDid);

      if (result.changes === 0) {
        return { success: true, message: "Not in room or already left" };
      }

      // Update in-memory tracking
      const tracked = this.activeRooms.get(roomId);
      if (tracked) {
        tracked.participants = tracked.participants.filter(
          (did) => did !== currentDid,
        );
      }

      // Notify other participants
      await this._broadcastToRoom(roomId, "call-status", {
        roomId,
        participantDid: currentDid,
        status: "left",
      });

      this.emit("participant:left", { roomId, participantDid: currentDid });

      // Check if room should be auto-ended
      await this._checkRoomEmpty(roomId);

      logger.info(`[CallManager] ${currentDid} left room ${roomId}`);

      return { success: true };
    } catch (error) {
      logger.error("[CallManager] Error leaving room:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End a call room (host action or auto-end)
   * @param {string} roomId - Room ID to end
   * @returns {Object} End result
   */
  async endRoom(roomId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Verify room exists
      const room = db
        .prepare("SELECT * FROM call_rooms WHERE id = ?")
        .get(roomId);

      if (!room) {
        return { success: false, error: "Room not found" };
      }

      if (room.status === "ended") {
        return { success: true, message: "Room already ended" };
      }

      // End the room
      db.prepare(
        "UPDATE call_rooms SET status = 'ended', ended_at = ? WHERE id = ?",
      ).run(now, roomId);

      // Mark all remaining participants as left
      db.prepare(
        `UPDATE call_participants SET status = 'left', left_at = ?
         WHERE room_id = ? AND status != 'left'`,
      ).run(now, roomId);

      // Clean up in-memory state
      this.activeRooms.delete(roomId);
      this._clearRingTimer(roomId);
      this._clearIdleTimer(roomId);

      // Notify all participants
      await this._broadcastToRoom(roomId, "call-status", {
        roomId,
        status: "ended",
      });

      this.emit("room:ended", { roomId, endedAt: now });

      logger.info(`[CallManager] Room ${roomId} ended`);

      return { success: true, endedAt: now };
    } catch (error) {
      logger.error("[CallManager] Error ending room:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all active rooms
   * @returns {Object} Active rooms list
   */
  async getActiveRooms() {
    try {
      const db = this.database.getDatabase();

      const rooms = db
        .prepare("SELECT * FROM call_rooms WHERE status = 'active' ORDER BY created_at DESC")
        .all();

      const result = [];
      for (const room of rooms) {
        const participants = db
          .prepare(
            "SELECT * FROM call_participants WHERE room_id = ? AND status != 'left'",
          )
          .all(room.id);

        result.push({
          ...this._formatRoom(room),
          participants: participants.map((p) => this._formatParticipant(p)),
          participantCount: participants.length,
        });
      }

      return { success: true, rooms: result };
    } catch (error) {
      logger.error("[CallManager] Error getting active rooms:", error);
      return { success: false, error: error.message, rooms: [] };
    }
  }

  /**
   * Get participants of a room
   * @param {string} roomId - Room ID
   * @param {boolean} [activeOnly=true] - Only return active participants
   * @returns {Object} Participants list
   */
  async getParticipants(roomId, activeOnly = true) {
    try {
      const db = this.database.getDatabase();

      let query = "SELECT * FROM call_participants WHERE room_id = ?";
      if (activeOnly) {
        query += " AND status != 'left'";
      }
      query += " ORDER BY joined_at ASC";

      const participants = db.prepare(query).all(roomId);

      return {
        success: true,
        participants: participants.map((p) => this._formatParticipant(p)),
      };
    } catch (error) {
      logger.error("[CallManager] Error getting participants:", error);
      return { success: false, error: error.message, participants: [] };
    }
  }

  /**
   * Get room by ID
   * @param {string} roomId - Room ID
   * @returns {Object} Room info
   */
  async getRoomById(roomId) {
    try {
      const db = this.database.getDatabase();

      const room = db
        .prepare("SELECT * FROM call_rooms WHERE id = ?")
        .get(roomId);

      if (!room) {
        return { success: false, error: "Room not found" };
      }

      const participants = db
        .prepare(
          "SELECT * FROM call_participants WHERE room_id = ? AND status != 'left'",
        )
        .all(roomId);

      return {
        success: true,
        room: {
          ...this._formatRoom(room),
          participants: participants.map((p) => this._formatParticipant(p)),
          participantCount: participants.length,
        },
      };
    } catch (error) {
      logger.error("[CallManager] Error getting room by ID:", error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  /**
   * Get the current user's DID
   */
  _getCurrentDid() {
    if (!this.didManager) {
      return null;
    }

    try {
      const identity = this.didManager.getCurrentIdentity
        ? this.didManager.getCurrentIdentity()
        : null;
      return identity?.did || null;
    } catch (error) {
      logger.error("[CallManager] Error getting current DID:", error);
      return null;
    }
  }

  /**
   * Format a room database row for API response
   */
  _formatRoom(room) {
    return {
      id: room.id,
      type: room.type,
      creatorDid: room.creator_did,
      status: room.status,
      maxParticipants: room.max_participants,
      createdAt: room.created_at,
      endedAt: room.ended_at || null,
    };
  }

  /**
   * Format a participant database row for API response
   */
  _formatParticipant(participant) {
    return {
      id: participant.id,
      roomId: participant.room_id,
      participantDid: participant.participant_did,
      role: participant.role,
      status: participant.status,
      joinedAt: participant.joined_at,
      leftAt: participant.left_at || null,
    };
  }

  /**
   * Send a call invitation to a specific DID via P2P
   */
  async _sendCallInvite(roomId, targetDid, callType) {
    try {
      if (!this.p2pManager) {
        logger.warn("[CallManager] P2P manager not available for invite");
        return;
      }

      const currentDid = this._getCurrentDid();

      // Add the target as a ringing participant
      const db = this.database.getDatabase();
      const participantId = uuidv4();
      const now = Date.now();

      db.prepare(
        `INSERT OR IGNORE INTO call_participants (id, room_id, participant_did, role, status, joined_at)
         VALUES (?, ?, ?, 'participant', 'ringing', ?)`,
      ).run(participantId, roomId, targetDid, now);

      // Send invite via P2P
      await this.p2pManager.sendMessage(targetDid, {
        type: "call-invite",
        roomId,
        callerDid: currentDid,
        callType,
        timestamp: now,
      });

      // Set ring timeout
      this._setRingTimer(roomId, targetDid);

      logger.info(
        `[CallManager] Call invite sent to ${targetDid} for room ${roomId}`,
      );
    } catch (error) {
      logger.error("[CallManager] Error sending call invite:", error);
    }
  }

  /**
   * Broadcast a message to all participants in a room
   */
  async _broadcastToRoom(roomId, messageType, data) {
    try {
      if (!this.p2pManager) {
        return;
      }

      const db = this.database.getDatabase();
      const currentDid = this._getCurrentDid();

      const participants = db
        .prepare(
          "SELECT participant_did FROM call_participants WHERE room_id = ? AND status != 'left'",
        )
        .all(roomId);

      for (const participant of participants) {
        if (participant.participant_did !== currentDid) {
          await this.p2pManager
            .sendMessage(participant.participant_did, {
              type: messageType,
              ...data,
            })
            .catch((err) => {
              logger.warn(
                `[CallManager] Failed to send ${messageType} to ${participant.participant_did}:`,
                err.message,
              );
            });
        }
      }
    } catch (error) {
      logger.error("[CallManager] Error broadcasting to room:", error);
    }
  }

  /**
   * Update a participant's status in the database
   */
  async _updateParticipantStatus(roomId, participantDid, status) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      if (status === "left") {
        db.prepare(
          "UPDATE call_participants SET status = 'left', left_at = ? WHERE room_id = ? AND participant_did = ?",
        ).run(now, roomId, participantDid);
      } else {
        db.prepare(
          "UPDATE call_participants SET status = ?, joined_at = COALESCE(joined_at, ?) WHERE room_id = ? AND participant_did = ?",
        ).run(status, now, roomId, participantDid);
      }
    } catch (error) {
      logger.error(
        "[CallManager] Error updating participant status:",
        error,
      );
    }
  }

  /**
   * Check if a room has no active participants and should be ended
   */
  async _checkRoomEmpty(roomId) {
    try {
      const db = this.database.getDatabase();

      const activeCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM call_participants WHERE room_id = ? AND status != 'left'",
        )
        .get(roomId);

      if (activeCount.count === 0) {
        logger.info(
          `[CallManager] Room ${roomId} has no active participants, ending`,
        );
        await this.endRoom(roomId);
      }
    } catch (error) {
      logger.error("[CallManager] Error checking room empty:", error);
    }
  }

  /**
   * Set a ring timeout timer for a participant
   */
  _setRingTimer(roomId, targetDid) {
    const timerKey = `${roomId}:${targetDid}`;
    this._clearSpecificTimer(this.ringTimers, timerKey);

    const timer = setTimeout(async () => {
      this.ringTimers.delete(timerKey);

      // Update participant status to left if still ringing
      try {
        const db = this.database.getDatabase();
        const participant = db
          .prepare(
            "SELECT * FROM call_participants WHERE room_id = ? AND participant_did = ? AND status = 'ringing'",
          )
          .get(roomId, targetDid);

        if (participant) {
          const now = Date.now();
          db.prepare(
            "UPDATE call_participants SET status = 'left', left_at = ? WHERE id = ?",
          ).run(now, participant.id);

          logger.info(
            `[CallManager] Ring timeout for ${targetDid} in room ${roomId}`,
          );
        }
      } catch (error) {
        logger.error("[CallManager] Error handling ring timeout:", error);
      }
    }, this.config.ringTimeoutMs);

    this.ringTimers.set(timerKey, timer);
  }

  /**
   * Clear ring timer for a room
   */
  _clearRingTimer(roomId) {
    for (const [key, timer] of this.ringTimers.entries()) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(timer);
        this.ringTimers.delete(key);
      }
    }
  }

  /**
   * Reset the idle timer for a room
   */
  _resetIdleTimer(roomId) {
    this._clearIdleTimer(roomId);

    const timer = setTimeout(async () => {
      this.idleTimers.delete(roomId);
      logger.info(`[CallManager] Room ${roomId} idle timeout, ending`);
      await this.endRoom(roomId);
    }, this.config.roomIdleTimeoutMs);

    this.idleTimers.set(roomId, timer);
  }

  /**
   * Clear idle timer for a room
   */
  _clearIdleTimer(roomId) {
    const timer = this.idleTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(roomId);
    }
  }

  /**
   * Clear a specific timer from a map
   */
  _clearSpecificTimer(timerMap, key) {
    const timer = timerMap.get(key);
    if (timer) {
      clearTimeout(timer);
      timerMap.delete(key);
    }
  }

  /**
   * Clean up all resources
   */
  async destroy() {
    // Clear all timers
    for (const timer of this.ringTimers.values()) {
      clearTimeout(timer);
    }
    this.ringTimers.clear();

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    this.activeRooms.clear();
    this.removeAllListeners();
    this.initialized = false;

    logger.info("[CallManager] Destroyed");
  }
}

module.exports = { CallManager };
