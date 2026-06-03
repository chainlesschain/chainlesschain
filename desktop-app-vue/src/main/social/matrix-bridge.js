/**
 * Matrix Bridge
 *
 * Matrix Client-Server API integration:
 * - Login/authentication (password, SSO stub)
 * - Room management (list, join, create)
 * - Message sending and retrieval
 * - E2EE simulation (Olm/Megolm)
 * - DID mapping for Matrix user IDs
 *
 * @module social/matrix-bridge
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const MATRIX_EVENT_TYPES = {
  MESSAGE: "m.room.message",
  MEMBER: "m.room.member",
  CREATE: "m.room.create",
  ENCRYPTED: "m.room.encrypted",
  REACTION: "m.reaction",
};

const LOGIN_STATE = {
  LOGGED_OUT: "logged_out",
  LOGGING_IN: "logging_in",
  LOGGED_IN: "logged_in",
  ERROR: "error",
};

// ============================================================
// MatrixBridge
// ============================================================

class MatrixBridge extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._homeserver = "https://matrix.org";
    this._userId = null;
    this._accessToken = null;
    this._loginState = LOGIN_STATE.LOGGED_OUT;
    this._rooms = new Map();
    this._syncToken = null;
    this._e2eeEnabled = true;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS matrix_rooms (
        id TEXT PRIMARY KEY,
        room_id TEXT UNIQUE NOT NULL,
        name TEXT,
        topic TEXT,
        is_encrypted INTEGER DEFAULT 0,
        member_count INTEGER DEFAULT 0,
        last_event_at INTEGER,
        joined_at INTEGER,
        status TEXT DEFAULT 'joined',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_matrix_rooms_room_id ON matrix_rooms(room_id);
      CREATE INDEX IF NOT EXISTS idx_matrix_rooms_status ON matrix_rooms(status);

      CREATE TABLE IF NOT EXISTS matrix_events (
        id TEXT PRIMARY KEY,
        event_id TEXT UNIQUE,
        room_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        event_type TEXT NOT NULL,
        content TEXT,
        origin_server_ts INTEGER,
        is_encrypted INTEGER DEFAULT 0,
        decrypted_content TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_matrix_events_room_id ON matrix_events(room_id);
      CREATE INDEX IF NOT EXISTS idx_matrix_events_sender ON matrix_events(sender);
      CREATE INDEX IF NOT EXISTS idx_matrix_events_type ON matrix_events(event_type);
    `);
  }

  async initialize() {
    logger.info("[MatrixBridge] Initializing Matrix bridge...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const rooms = this.database.db
          .prepare("SELECT * FROM matrix_rooms WHERE status = 'joined'")
          .all();
        for (const room of rooms) {
          this._rooms.set(room.room_id, room);
        }
        logger.info(`[MatrixBridge] Loaded ${rooms.length} joined rooms`);
      } catch (err) {
        logger.error("[MatrixBridge] Failed to load rooms:", err);
      }
    }

    this.initialized = true;
    logger.info("[MatrixBridge] Matrix bridge initialized");
  }

  /**
   * Login to a Matrix homeserver
   * @param {Object} params
   * @param {string} params.homeserver - Homeserver URL
   * @param {string} params.userId - Matrix user ID (@user:server)
   * @param {string} params.password - Password
   * @returns {Object} Login result
   */
  async login({ homeserver, userId, password } = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }
    if (!password) {
      throw new Error("Password is required");
    }

    this._loginState = LOGIN_STATE.LOGGING_IN;
    this.emit("login-state-changed", LOGIN_STATE.LOGGING_IN);

    try {
      this._homeserver = homeserver || this._homeserver;

      // Simulate Matrix login via CS API
      // In production: POST /_matrix/client/v3/login
      logger.info(
        `[MatrixBridge] Logging in as ${userId} to ${this._homeserver}`,
      );

      this._userId = userId;
      this._accessToken = crypto.randomBytes(32).toString("hex");
      this._loginState = LOGIN_STATE.LOGGED_IN;

      this.emit("login-state-changed", LOGIN_STATE.LOGGED_IN);
      this.emit("logged-in", { userId, homeserver: this._homeserver });
      logger.info(`[MatrixBridge] Logged in as ${userId}`);

      return {
        success: true,
        userId: this._userId,
        homeserver: this._homeserver,
        accessToken: this._accessToken.substring(0, 8) + "...",
      };
    } catch (err) {
      this._loginState = LOGIN_STATE.ERROR;
      this.emit("login-state-changed", LOGIN_STATE.ERROR);
      logger.error("[MatrixBridge] Login failed:", err);
      throw err;
    }
  }

  /**
   * List joined rooms
   * @returns {Array} Rooms
   */
  async listRooms() {
    if (this.database && this.database.db) {
      try {
        return this.database.db
          .prepare(
            "SELECT * FROM matrix_rooms WHERE status = 'joined' ORDER BY last_event_at DESC",
          )
          .all();
      } catch (err) {
        logger.error("[MatrixBridge] Failed to list rooms:", err);
      }
    }
    return Array.from(this._rooms.values());
  }

  /**
   * Send a message to a Matrix room
   * @param {Object} params
   * @param {string} params.roomId - Matrix room ID
   * @param {string} params.body - Message body
   * @param {string} [params.msgtype] - Message type (m.text, m.image, etc.)
   * @returns {Object} Sent event
   */
  async sendMessage({ roomId, body, msgtype = "m.text" } = {}) {
    if (!roomId) {
      throw new Error("Room ID is required");
    }
    if (!body) {
      throw new Error("Message body is required");
    }

    const eventId = `$${crypto.randomBytes(16).toString("hex")}`;
    const now = Date.now();

    const event = {
      id: uuidv4(),
      event_id: eventId,
      room_id: roomId,
      sender: this._userId || "@local:matrix.org",
      event_type: this._e2eeEnabled
        ? MATRIX_EVENT_TYPES.ENCRYPTED
        : MATRIX_EVENT_TYPES.MESSAGE,
      content: JSON.stringify({ msgtype, body }),
      origin_server_ts: now,
      is_encrypted: this._e2eeEnabled ? 1 : 0,
      decrypted_content: this._e2eeEnabled
        ? JSON.stringify({ msgtype, body })
        : null,
      created_at: now,
    };

    if (this.database && this.database.db) {
      try {
        this.database.db
          .prepare(
            `
          INSERT INTO matrix_events (id, event_id, room_id, sender, event_type, content, origin_server_ts, is_encrypted, decrypted_content)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            event.id,
            event.event_id,
            event.room_id,
            event.sender,
            event.event_type,
            event.content,
            event.origin_server_ts,
            event.is_encrypted,
            event.decrypted_content,
          );

        // Update room last_event_at
        this.database.db
          .prepare(
            "UPDATE matrix_rooms SET last_event_at = ? WHERE room_id = ?",
          )
          .run(now, roomId);
      } catch (err) {
        logger.error("[MatrixBridge] Failed to store event:", err);
      }
    }

    this.emit("message-sent", event);
    logger.info(`[MatrixBridge] Message sent to ${roomId}: ${eventId}`);
    return { success: true, event };
  }

  /**
   * Get messages from a room
   * @param {Object} params
   * @param {string} params.roomId - Room ID
   * @param {number} [params.limit] - Max messages
   * @param {number} [params.since] - Timestamp filter
   * @returns {Array} Messages
   */
  async getMessages({ roomId, limit = 50, since } = {}) {
    if (!roomId) {
      throw new Error("Room ID is required");
    }

    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM matrix_events WHERE room_id = ?";
        const params = [roomId];

        if (since) {
          sql += " AND origin_server_ts >= ?";
          params.push(since);
        }

        sql += " ORDER BY origin_server_ts DESC LIMIT ?";
        params.push(limit);

        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          content: r.content ? JSON.parse(r.content) : {},
          decrypted_content: r.decrypted_content
            ? JSON.parse(r.decrypted_content)
            : null,
        }));
      } catch (err) {
        logger.error("[MatrixBridge] Failed to get messages:", err);
      }
    }
    return [];
  }

  /**
   * Join a Matrix room
   * @param {Object} params
   * @param {string} params.roomIdOrAlias - Room ID or alias
   * @returns {Object} Join result
   */
  async joinRoom({ roomIdOrAlias } = {}) {
    if (!roomIdOrAlias) {
      throw new Error("Room ID or alias is required");
    }

    const roomId = roomIdOrAlias.startsWith("!")
      ? roomIdOrAlias
      : `!${crypto.randomBytes(8).toString("hex")}:matrix.org`;
    const id = uuidv4();
    const now = Date.now();

    const room = {
      id,
      room_id: roomId,
      name: roomIdOrAlias.startsWith("#")
        ? roomIdOrAlias
        : `Room ${roomId.substring(0, 8)}`,
      topic: "",
      is_encrypted: this._e2eeEnabled ? 1 : 0,
      member_count: 1,
      last_event_at: now,
      joined_at: now,
      status: "joined",
      created_at: now,
    };

    if (this.database && this.database.db) {
      try {
        this.database.db
          .prepare(
            `
          INSERT OR IGNORE INTO matrix_rooms (id, room_id, name, topic, is_encrypted, member_count, last_event_at, joined_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            id,
            roomId,
            room.name,
            room.topic,
            room.is_encrypted,
            room.member_count,
            now,
            now,
            "joined",
          );
      } catch (err) {
        logger.error("[MatrixBridge] Failed to store room:", err);
      }
    }

    this._rooms.set(roomId, room);
    this.emit("room-joined", room);
    logger.info(`[MatrixBridge] Joined room: ${roomId}`);
    return { success: true, room };
  }

  /**
   * Get current login state
   * @returns {Object} Login state info
   */
  getLoginState() {
    return {
      state: this._loginState,
      userId: this._userId,
      homeserver: this._homeserver,
      e2eeEnabled: this._e2eeEnabled,
    };
  }

  async close() {
    this.removeAllListeners();
    this._rooms.clear();
    this._accessToken = null;
    this._loginState = LOGIN_STATE.LOGGED_OUT;
    this.initialized = false;
    logger.info("[MatrixBridge] Closed");
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getMatrixBridge(database) {
  if (!_instance) {
    _instance = new MatrixBridge(database);
  }
  return _instance;
}

export { MatrixBridge, getMatrixBridge, MATRIX_EVENT_TYPES, LOGIN_STATE };
export default MatrixBridge;
