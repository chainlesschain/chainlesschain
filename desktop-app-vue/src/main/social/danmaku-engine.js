/**
 * Danmaku Engine
 *
 * Bullet chat (danmaku) engine for livestream overlay comments:
 * - Real-time danmaku message sending and receiving
 * - In-memory buffer (queue) for real-time display with overflow protection
 * - Message moderation (approve, reject, delete)
 * - Persistent storage of danmaku history
 * - P2P broadcast via DataChannel
 *
 * @module danmaku-engine
 * @version 0.44.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Danmaku message type constants
 */
const DanmakuType = {
  NORMAL: "normal", // Scrolling left-to-right
  TOP: "top", // Fixed at top
  BOTTOM: "bottom", // Fixed at bottom
  SPECIAL: "special", // Special effects
};

/**
 * Default danmaku options
 */
const DANMAKU_DEFAULTS = {
  color: "#FFFFFF",
  fontSize: 24,
  position: 0,
  messageType: DanmakuType.NORMAL,
};

/**
 * Buffer configuration
 */
const BUFFER_CONFIG = {
  maxSize: 200, // Maximum buffer size per stream
  overflowThreshold: 180, // Emit overflow warning at this threshold
};

/**
 * DanmakuEngine class
 * Handles bullet chat message processing and buffering
 */
class DanmakuEngine extends EventEmitter {
  constructor(database, p2pManager) {
    super();

    this.database = database;
    this.p2pManager = p2pManager;

    /**
     * In-memory buffer for real-time danmaku display
     * Map<streamId, Array<DanmakuMessage>>
     */
    this.buffers = new Map();

    /**
     * Moderation settings per stream
     * Map<streamId, boolean>
     */
    this.moderationEnabled = new Map();

    this.initialized = false;
  }

  /**
   * Initialize the danmaku engine
   */
  async initialize() {
    logger.info("[DanmakuEngine] Initializing danmaku engine...");

    try {
      await this.initializeTables();

      this.setupP2PListeners();

      this.initialized = true;
      logger.info(
        "[DanmakuEngine] Danmaku engine initialized successfully",
      );
    } catch (error) {
      logger.error("[DanmakuEngine] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS danmaku_messages (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'normal' CHECK(message_type IN ('normal','top','bottom','special')),
        color TEXT DEFAULT '#FFFFFF',
        font_size INTEGER DEFAULT 24,
        position REAL DEFAULT 0,
        is_moderated INTEGER DEFAULT 0,
        created_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_danmaku_stream_id ON danmaku_messages(stream_id);
      CREATE INDEX IF NOT EXISTS idx_danmaku_created_at ON danmaku_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_danmaku_sender_did ON danmaku_messages(sender_did);
    `);

    logger.info("[DanmakuEngine] Database tables initialized");
  }

  /**
   * Set up P2P event listeners for danmaku broadcasting
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    this.p2pManager.on("danmaku:broadcast", async ({ danmaku }) => {
      await this.handleDanmakuReceived(danmaku);
    });

    logger.info("[DanmakuEngine] P2P event listeners set up");
  }

  /**
   * Send a danmaku message
   * @param {string} streamId - Stream ID
   * @param {string} senderDid - Sender DID
   * @param {string} content - Message content
   * @param {Object} options - Display options
   * @param {string} options.messageType - Message type (normal, top, bottom, special)
   * @param {string} options.color - Text color (hex)
   * @param {number} options.fontSize - Font size
   * @param {number} options.position - Vertical position (0-1)
   * @returns {Object} Created danmaku message
   */
  async sendDanmaku(streamId, senderDid, content, options = {}) {
    try {
      if (!streamId) {
        throw new Error("Stream ID is required");
      }

      if (!senderDid) {
        throw new Error("Sender DID is required");
      }

      if (!content || content.trim().length === 0) {
        throw new Error("Danmaku content cannot be empty");
      }

      if (content.length > 100) {
        throw new Error("Danmaku content cannot exceed 100 characters");
      }

      // Check if moderation is enabled and auto-hold
      const isModerated = this.moderationEnabled.get(streamId) || false;

      const danmakuId = uuidv4();
      const now = Date.now();

      const danmaku = {
        id: danmakuId,
        stream_id: streamId,
        sender_did: senderDid,
        content: content.trim(),
        message_type: options.messageType || DANMAKU_DEFAULTS.messageType,
        color: options.color || DANMAKU_DEFAULTS.color,
        font_size: options.fontSize || DANMAKU_DEFAULTS.fontSize,
        position: options.position !== undefined ? options.position : DANMAKU_DEFAULTS.position,
        is_moderated: isModerated ? 0 : 0, // 0 = not moderated (visible), when moderation enabled new msgs need approval
        created_at: now,
      };

      // Persist to database
      const db = this.database.db;
      db.prepare(`
        INSERT INTO danmaku_messages
        (id, stream_id, sender_did, content, message_type, color, font_size, position, is_moderated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        danmaku.id,
        danmaku.stream_id,
        danmaku.sender_did,
        danmaku.content,
        danmaku.message_type,
        danmaku.color,
        danmaku.font_size,
        danmaku.position,
        danmaku.is_moderated,
        danmaku.created_at,
      );

      // Add to real-time buffer (unless held for moderation)
      if (!isModerated) {
        this.addToBuffer(streamId, danmaku);
      }

      logger.info(
        "[DanmakuEngine] Danmaku sent:",
        danmakuId,
        "stream:",
        streamId,
      );

      // Broadcast to P2P network
      await this.broadcastDanmaku(danmaku);

      this.emit("danmaku:received", { danmaku });

      return danmaku;
    } catch (error) {
      logger.error("[DanmakuEngine] Failed to send danmaku:", error);
      throw error;
    }
  }

  /**
   * Add a danmaku message to the in-memory buffer
   * @param {string} streamId - Stream ID
   * @param {Object} danmaku - Danmaku message object
   */
  addToBuffer(streamId, danmaku) {
    if (!this.buffers.has(streamId)) {
      this.buffers.set(streamId, []);
    }

    const buffer = this.buffers.get(streamId);

    // Check for overflow
    if (buffer.length >= BUFFER_CONFIG.overflowThreshold) {
      this.emit("buffer:overflow", {
        streamId,
        bufferSize: buffer.length,
        maxSize: BUFFER_CONFIG.maxSize,
      });
    }

    // Trim buffer if at max capacity
    if (buffer.length >= BUFFER_CONFIG.maxSize) {
      // Remove oldest messages
      const removeCount = Math.floor(BUFFER_CONFIG.maxSize * 0.2);
      buffer.splice(0, removeCount);
    }

    buffer.push(danmaku);
  }

  /**
   * Get danmaku history for a stream
   * @param {string} streamId - Stream ID
   * @param {number} limit - Result limit
   * @param {number} offset - Result offset
   * @returns {Array} List of danmaku messages
   */
  async getDanmakuHistory(streamId, limit = 50, offset = 0) {
    try {
      const db = this.database.db;
      const messages = db
        .prepare(
          "SELECT * FROM danmaku_messages WHERE stream_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(streamId, limit, offset);

      return messages || [];
    } catch (error) {
      logger.error(
        "[DanmakuEngine] Failed to get danmaku history:",
        error,
      );
      throw error;
    }
  }

  /**
   * Moderate a danmaku message
   * @param {string} danmakuId - Danmaku message ID
   * @param {string} action - Moderation action ('approve', 'reject', 'delete')
   * @returns {Object} Result
   */
  async moderateDanmaku(danmakuId, action) {
    try {
      const db = this.database.db;
      const danmaku = db
        .prepare("SELECT * FROM danmaku_messages WHERE id = ?")
        .get(danmakuId);

      if (!danmaku) {
        throw new Error("Danmaku message not found");
      }

      switch (action) {
        case "approve":
          db.prepare(
            "UPDATE danmaku_messages SET is_moderated = 0 WHERE id = ?",
          ).run(danmakuId);
          // Add to buffer for display
          this.addToBuffer(danmaku.stream_id, {
            ...danmaku,
            is_moderated: 0,
          });
          this.emit("danmaku:received", {
            danmaku: { ...danmaku, is_moderated: 0 },
          });
          break;

        case "reject":
          db.prepare(
            "UPDATE danmaku_messages SET is_moderated = 1 WHERE id = ?",
          ).run(danmakuId);
          break;

        case "delete":
          db.prepare("DELETE FROM danmaku_messages WHERE id = ?").run(
            danmakuId,
          );
          // Remove from buffer
          this.removeFromBuffer(danmaku.stream_id, danmakuId);
          break;

        default:
          throw new Error(`Unknown moderation action: ${action}`);
      }

      logger.info(
        "[DanmakuEngine] Danmaku moderated:",
        danmakuId,
        action,
      );

      this.emit("danmaku:moderated", {
        danmakuId,
        action,
        streamId: danmaku.stream_id,
      });

      return { success: true, action };
    } catch (error) {
      logger.error(
        "[DanmakuEngine] Failed to moderate danmaku:",
        error,
      );
      throw error;
    }
  }

  /**
   * Remove a danmaku message from the buffer
   * @param {string} streamId - Stream ID
   * @param {string} danmakuId - Danmaku message ID
   */
  removeFromBuffer(streamId, danmakuId) {
    const buffer = this.buffers.get(streamId);
    if (!buffer) {
      return;
    }

    const index = buffer.findIndex((d) => d.id === danmakuId);
    if (index !== -1) {
      buffer.splice(index, 1);
    }
  }

  /**
   * Clear the buffer for a stream
   * @param {string} streamId - Stream ID
   */
  clearBuffer(streamId) {
    this.buffers.delete(streamId);
    logger.info("[DanmakuEngine] Buffer cleared for stream:", streamId);
  }

  /**
   * Get buffer size for a stream
   * @param {string} streamId - Stream ID
   * @returns {number} Buffer size
   */
  getBufferSize(streamId) {
    const buffer = this.buffers.get(streamId);
    return buffer ? buffer.length : 0;
  }

  /**
   * Get current buffer contents for a stream
   * @param {string} streamId - Stream ID
   * @returns {Array} Buffer contents
   */
  getBuffer(streamId) {
    return this.buffers.get(streamId) || [];
  }

  /**
   * Enable or disable moderation for a stream
   * @param {string} streamId - Stream ID
   * @param {boolean} enabled - Whether moderation is enabled
   */
  setModeration(streamId, enabled) {
    this.moderationEnabled.set(streamId, enabled);
    logger.info(
      "[DanmakuEngine] Moderation",
      enabled ? "enabled" : "disabled",
      "for stream:",
      streamId,
    );
  }

  /**
   * Broadcast danmaku to P2P network
   * @param {Object} danmaku - Danmaku message
   */
  async broadcastDanmaku(danmaku) {
    if (!this.p2pManager) {
      return;
    }

    try {
      const connectedPeers = this.p2pManager.getConnectedPeers
        ? this.p2pManager.getConnectedPeers()
        : [];

      for (const peer of connectedPeers) {
        try {
          await this.p2pManager.sendEncryptedMessage(
            peer.id || peer,
            JSON.stringify({
              type: "danmaku:broadcast",
              danmaku: {
                id: danmaku.id,
                stream_id: danmaku.stream_id,
                sender_did: danmaku.sender_did,
                content: danmaku.content,
                message_type: danmaku.message_type,
                color: danmaku.color,
                font_size: danmaku.font_size,
                position: danmaku.position,
                created_at: danmaku.created_at,
              },
            }),
          );
        } catch (error) {
          // Silently ignore individual peer broadcast failures
        }
      }
    } catch (error) {
      logger.warn(
        "[DanmakuEngine] Failed to broadcast danmaku:",
        error.message,
      );
    }
  }

  /**
   * Handle danmaku received from P2P network
   * @param {Object} danmaku - Danmaku message
   */
  async handleDanmakuReceived(danmaku) {
    try {
      if (!danmaku || !danmaku.id || !danmaku.stream_id) {
        return;
      }

      const db = this.database.db;

      // Check if already exists
      const existing = db
        .prepare("SELECT id FROM danmaku_messages WHERE id = ?")
        .get(danmaku.id);

      if (existing) {
        return;
      }

      // Persist
      db.prepare(`
        INSERT OR IGNORE INTO danmaku_messages
        (id, stream_id, sender_did, content, message_type, color, font_size, position, is_moderated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        danmaku.id,
        danmaku.stream_id,
        danmaku.sender_did,
        danmaku.content,
        danmaku.message_type || DanmakuType.NORMAL,
        danmaku.color || DANMAKU_DEFAULTS.color,
        danmaku.font_size || DANMAKU_DEFAULTS.fontSize,
        danmaku.position || 0,
        0,
        danmaku.created_at || Date.now(),
      );

      // Add to buffer for display
      this.addToBuffer(danmaku.stream_id, danmaku);

      this.emit("danmaku:received", { danmaku });
    } catch (error) {
      logger.error(
        "[DanmakuEngine] Failed to handle received danmaku:",
        error,
      );
    }
  }

  /**
   * Close the danmaku engine
   */
  async close() {
    logger.info("[DanmakuEngine] Closing danmaku engine");

    this.buffers.clear();
    this.moderationEnabled.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  DanmakuEngine,
  DanmakuType,
  DANMAKU_DEFAULTS,
  BUFFER_CONFIG,
};
