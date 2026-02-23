/**
 * Channel Manager
 * Manages channels within communities, including messaging, pinning, and reactions.
 * Channels are organized under communities and support multiple types.
 *
 * @module channel-manager
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Channel type constants
 */
const ChannelType = {
  ANNOUNCEMENT: "announcement",
  DISCUSSION: "discussion",
  READONLY: "readonly",
  SUBSCRIPTION: "subscription",
};

/**
 * Message type constants
 */
const MessageType = {
  TEXT: "text",
  IMAGE: "image",
  FILE: "file",
  SYSTEM: "system",
};

class ChannelManager extends EventEmitter {
  constructor(database, didManager, p2pManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;

    this.initialized = false;
  }

  /**
   * Initialize the channel manager
   */
  async initialize() {
    logger.info("[ChannelManager] Initializing channel manager...");

    try {
      await this.initializeTables();
      this.setupP2PListeners();

      this.initialized = true;
      logger.info("[ChannelManager] Channel manager initialized successfully");
    } catch (error) {
      logger.error("[ChannelManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'discussion' CHECK(type IN ('announcement', 'discussion', 'readonly', 'subscription')),
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channels_community ON channels(community_id);
      CREATE INDEX IF NOT EXISTS idx_channels_sort ON channels(community_id, sort_order);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'file', 'system')),
        reply_to TEXT,
        is_pinned INTEGER DEFAULT 0,
        reactions TEXT DEFAULT '{}',
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_messages_sender ON channel_messages(sender_did);
      CREATE INDEX IF NOT EXISTS idx_channel_messages_pinned ON channel_messages(channel_id, is_pinned);
      CREATE INDEX IF NOT EXISTS idx_channel_messages_created ON channel_messages(channel_id, created_at DESC);
    `);

    logger.info("[ChannelManager] Database tables initialized");
  }

  /**
   * Setup P2P event listeners
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    this.p2pManager.on("channel:message-received", async ({ channelId, message }) => {
      try {
        await this.handleMessageReceived(channelId, message);
      } catch (error) {
        logger.warn("[ChannelManager] P2P message receive failed:", error.message);
      }
    });

    logger.info("[ChannelManager] P2P listeners set up");
  }

  /**
   * Get the current user DID
   */
  getCurrentDid() {
    return this.didManager?.getCurrentIdentity()?.did || null;
  }

  /**
   * Check if user has permission to write in a channel
   * @param {string} channelId - Channel ID
   * @param {string} memberDid - Member DID
   */
  async checkWritePermission(channelId, memberDid) {
    const db = this.database.db;

    const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Check if user is a member of the community
    const member = db.prepare(
      "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
    ).get(channel.community_id, memberDid);

    if (!member) {
      throw new Error("You are not a member of this community");
    }

    // Readonly channels: no one can write
    if (channel.type === ChannelType.READONLY) {
      throw new Error("This channel is read-only");
    }

    // Announcement channels: only owner/admin/moderator can write
    if (channel.type === ChannelType.ANNOUNCEMENT) {
      if (member.role !== "owner" && member.role !== "admin" && member.role !== "moderator") {
        throw new Error("Only admins can post in announcement channels");
      }
    }

    return { channel, member };
  }

  /**
   * Create a new channel in a community
   * @param {Object} options - Channel options
   */
  async createChannel({ communityId, name, description = "", type = ChannelType.DISCUSSION, sortOrder = 0 }) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    if (!name || name.trim().length === 0) {
      throw new Error("Channel name cannot be empty");
    }

    try {
      const db = this.database.db;

      // Check admin/owner role
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(communityId, currentDid);

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new Error("Insufficient permissions to create channels");
      }

      const channelId = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO channels (
          id, community_id, name, description, type, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        channelId,
        communityId,
        name.trim(),
        description,
        type,
        sortOrder,
        now,
        now,
      );

      // Send system message about channel creation
      await this.sendSystemMessage(channelId, `Channel "${name.trim()}" has been created`);

      this.database.saveToFile();

      const channel = {
        id: channelId,
        community_id: communityId,
        name: name.trim(),
        description,
        type,
        sort_order: sortOrder,
        created_at: now,
        updated_at: now,
      };

      logger.info("[ChannelManager] Channel created:", channelId);
      this.emit("channel:created", { channel });

      return channel;
    } catch (error) {
      logger.error("[ChannelManager] Failed to create channel:", error);
      throw error;
    }
  }

  /**
   * Delete a channel
   * @param {string} channelId - Channel ID
   */
  async deleteChannel(channelId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId);
      if (!channel) {
        throw new Error("Channel not found");
      }

      // Check admin/owner role
      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(channel.community_id, currentDid);

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new Error("Insufficient permissions to delete channels");
      }

      // Delete messages first
      db.prepare("DELETE FROM channel_messages WHERE channel_id = ?").run(channelId);

      // Delete channel
      db.prepare("DELETE FROM channels WHERE id = ?").run(channelId);

      this.database.saveToFile();

      logger.info("[ChannelManager] Channel deleted:", channelId);
      this.emit("channel:deleted", { channelId, communityId: channel.community_id });

      return { success: true };
    } catch (error) {
      logger.error("[ChannelManager] Failed to delete channel:", error);
      throw error;
    }
  }

  /**
   * Update a channel
   * @param {string} channelId - Channel ID
   * @param {Object} updates - Fields to update
   */
  async updateChannel(channelId, updates) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId);
      if (!channel) {
        throw new Error("Channel not found");
      }

      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(channel.community_id, currentDid);

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new Error("Insufficient permissions to update channels");
      }

      const { name, description, type, sortOrder } = updates;
      const fields = [];
      const values = [];

      if (name !== undefined) {
        fields.push("name = ?");
        values.push(name.trim());
      }
      if (description !== undefined) {
        fields.push("description = ?");
        values.push(description);
      }
      if (type !== undefined) {
        fields.push("type = ?");
        values.push(type);
      }
      if (sortOrder !== undefined) {
        fields.push("sort_order = ?");
        values.push(sortOrder);
      }

      if (fields.length === 0) {
        return { success: true };
      }

      fields.push("updated_at = ?");
      values.push(Date.now());
      values.push(channelId);

      db.prepare(`UPDATE channels SET ${fields.join(", ")} WHERE id = ?`).run(...values);

      this.database.saveToFile();

      logger.info("[ChannelManager] Channel updated:", channelId);
      this.emit("channel:updated", { channelId, updates });

      return { success: true };
    } catch (error) {
      logger.error("[ChannelManager] Failed to update channel:", error);
      throw error;
    }
  }

  /**
   * Get all channels in a community
   * @param {string} communityId - Community ID
   */
  async getChannels(communityId) {
    try {
      const db = this.database.db;

      const stmt = db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM channel_messages WHERE channel_id = c.id) as message_count
        FROM channels c
        WHERE c.community_id = ?
        ORDER BY c.sort_order ASC, c.created_at ASC
      `);

      const channels = stmt.all(communityId);
      return channels || [];
    } catch (error) {
      logger.error("[ChannelManager] Failed to get channels:", error);
      return [];
    }
  }

  /**
   * Send a message to a channel
   * @param {Object} options - Message options
   */
  async sendMessage({ channelId, content, messageType = MessageType.TEXT, replyTo = null }) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    if (!content || content.trim().length === 0) {
      throw new Error("Message content cannot be empty");
    }

    try {
      // Check write permission
      await this.checkWritePermission(channelId, currentDid);

      const db = this.database.db;
      const messageId = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO channel_messages (
          id, channel_id, sender_did, content, message_type,
          reply_to, is_pinned, reactions, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        channelId,
        currentDid,
        content.trim(),
        messageType,
        replyTo,
        0,
        "{}",
        now,
        now,
      );

      // Update channel timestamp
      db.prepare("UPDATE channels SET updated_at = ? WHERE id = ?").run(now, channelId);

      this.database.saveToFile();

      const message = {
        id: messageId,
        channel_id: channelId,
        sender_did: currentDid,
        content: content.trim(),
        message_type: messageType,
        reply_to: replyTo,
        is_pinned: 0,
        reactions: "{}",
        created_at: now,
        updated_at: now,
      };

      logger.info("[ChannelManager] Message sent:", messageId, "to channel:", channelId);
      this.emit("channel:message-sent", { channelId, message });

      return message;
    } catch (error) {
      logger.error("[ChannelManager] Failed to send message:", error);
      throw error;
    }
  }

  /**
   * Send a system message to a channel
   * @param {string} channelId - Channel ID
   * @param {string} content - System message content
   */
  async sendSystemMessage(channelId, content) {
    try {
      const db = this.database.db;
      const messageId = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO channel_messages (
          id, channel_id, sender_did, content, message_type,
          reply_to, is_pinned, reactions, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        channelId,
        "system",
        content,
        MessageType.SYSTEM,
        null,
        0,
        "{}",
        now,
        now,
      );

      return { success: true, messageId };
    } catch (error) {
      logger.error("[ChannelManager] Failed to send system message:", error);
      return { success: false };
    }
  }

  /**
   * Get messages from a channel
   * @param {string} channelId - Channel ID
   * @param {Object} options - Query options
   */
  async getMessages(channelId, { limit = 50, offset = 0, before = null } = {}) {
    try {
      const db = this.database.db;

      let query = `
        SELECT cm.*, c.nickname as sender_nickname
        FROM channel_messages cm
        LEFT JOIN contacts c ON cm.sender_did = c.did
        WHERE cm.channel_id = ?
      `;

      const params = [channelId];

      if (before) {
        query += " AND cm.created_at < ?";
        params.push(before);
      }

      query += " ORDER BY cm.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const messages = db.prepare(query).all(...params);

      // Parse reactions JSON
      return (messages || []).map((msg) => ({
        ...msg,
        reactions: msg.reactions ? JSON.parse(msg.reactions) : {},
      }));
    } catch (error) {
      logger.error("[ChannelManager] Failed to get messages:", error);
      return [];
    }
  }

  /**
   * Pin a message in a channel
   * @param {string} messageId - Message ID
   */
  async pinMessage(messageId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const message = db.prepare("SELECT * FROM channel_messages WHERE id = ?").get(messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      // Check if user is admin/owner/moderator
      const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(message.channel_id);
      if (!channel) {
        throw new Error("Channel not found");
      }

      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(channel.community_id, currentDid);

      if (!member || member.role === "member") {
        throw new Error("Insufficient permissions to pin messages");
      }

      const now = Date.now();
      db.prepare("UPDATE channel_messages SET is_pinned = 1, updated_at = ? WHERE id = ?").run(now, messageId);

      this.database.saveToFile();

      logger.info("[ChannelManager] Message pinned:", messageId);
      this.emit("channel:message-pinned", { messageId, channelId: message.channel_id });

      return { success: true };
    } catch (error) {
      logger.error("[ChannelManager] Failed to pin message:", error);
      throw error;
    }
  }

  /**
   * Unpin a message in a channel
   * @param {string} messageId - Message ID
   */
  async unpinMessage(messageId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const message = db.prepare("SELECT * FROM channel_messages WHERE id = ?").get(messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(message.channel_id);
      if (!channel) {
        throw new Error("Channel not found");
      }

      const member = db.prepare(
        "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
      ).get(channel.community_id, currentDid);

      if (!member || member.role === "member") {
        throw new Error("Insufficient permissions to unpin messages");
      }

      const now = Date.now();
      db.prepare("UPDATE channel_messages SET is_pinned = 0, updated_at = ? WHERE id = ?").run(now, messageId);

      this.database.saveToFile();

      logger.info("[ChannelManager] Message unpinned:", messageId);
      this.emit("channel:message-unpinned", { messageId, channelId: message.channel_id });

      return { success: true };
    } catch (error) {
      logger.error("[ChannelManager] Failed to unpin message:", error);
      throw error;
    }
  }

  /**
   * Add a reaction to a message
   * @param {string} messageId - Message ID
   * @param {string} emoji - Emoji reaction
   */
  async addReaction(messageId, emoji) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const message = db.prepare("SELECT * FROM channel_messages WHERE id = ?").get(messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      const reactions = message.reactions ? JSON.parse(message.reactions) : {};

      if (!reactions[emoji]) {
        reactions[emoji] = [];
      }

      if (!reactions[emoji].includes(currentDid)) {
        reactions[emoji].push(currentDid);
      }

      const now = Date.now();
      db.prepare("UPDATE channel_messages SET reactions = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(reactions),
        now,
        messageId,
      );

      this.database.saveToFile();

      logger.info("[ChannelManager] Reaction added:", emoji, "to message:", messageId);
      this.emit("channel:reaction-added", { messageId, emoji, userDid: currentDid });

      return { success: true, reactions };
    } catch (error) {
      logger.error("[ChannelManager] Failed to add reaction:", error);
      throw error;
    }
  }

  /**
   * Remove a reaction from a message
   * @param {string} messageId - Message ID
   * @param {string} emoji - Emoji reaction to remove
   */
  async removeReaction(messageId, emoji) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const message = db.prepare("SELECT * FROM channel_messages WHERE id = ?").get(messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      const reactions = message.reactions ? JSON.parse(message.reactions) : {};

      if (reactions[emoji]) {
        reactions[emoji] = reactions[emoji].filter((did) => did !== currentDid);
        if (reactions[emoji].length === 0) {
          delete reactions[emoji];
        }
      }

      const now = Date.now();
      db.prepare("UPDATE channel_messages SET reactions = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(reactions),
        now,
        messageId,
      );

      this.database.saveToFile();

      logger.info("[ChannelManager] Reaction removed:", emoji, "from message:", messageId);
      this.emit("channel:reaction-removed", { messageId, emoji, userDid: currentDid });

      return { success: true, reactions };
    } catch (error) {
      logger.error("[ChannelManager] Failed to remove reaction:", error);
      throw error;
    }
  }

  /**
   * Delete a message from a channel
   * @param {string} messageId - Message ID
   */
  async deleteMessage(messageId) {
    const currentDid = this.getCurrentDid();
    if (!currentDid) {
      throw new Error("User not logged in");
    }

    try {
      const db = this.database.db;

      const message = db.prepare("SELECT * FROM channel_messages WHERE id = ?").get(messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      // Check if user is the sender or has admin/moderator permissions
      if (message.sender_did !== currentDid) {
        const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(message.channel_id);
        if (!channel) {
          throw new Error("Channel not found");
        }

        const member = db.prepare(
          "SELECT * FROM community_members WHERE community_id = ? AND member_did = ? AND status = 'active'",
        ).get(channel.community_id, currentDid);

        if (!member || member.role === "member") {
          throw new Error("Insufficient permissions to delete this message");
        }
      }

      db.prepare("DELETE FROM channel_messages WHERE id = ?").run(messageId);

      this.database.saveToFile();

      logger.info("[ChannelManager] Message deleted:", messageId);
      this.emit("channel:message-deleted", { messageId, channelId: message.channel_id });

      return { success: true };
    } catch (error) {
      logger.error("[ChannelManager] Failed to delete message:", error);
      throw error;
    }
  }

  /**
   * Handle incoming P2P message for a channel
   * @param {string} channelId - Channel ID
   * @param {Object} message - Message data
   */
  async handleMessageReceived(channelId, message) {
    try {
      const db = this.database.db;

      // Check if message already exists
      const existing = db.prepare("SELECT id FROM channel_messages WHERE id = ?").get(message.id);
      if (existing) {
        return;
      }

      db.prepare(`
        INSERT OR IGNORE INTO channel_messages (
          id, channel_id, sender_did, content, message_type,
          reply_to, is_pinned, reactions, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        channelId,
        message.sender_did,
        message.content,
        message.message_type || MessageType.TEXT,
        message.reply_to || null,
        message.is_pinned || 0,
        message.reactions || "{}",
        message.created_at,
        message.updated_at || message.created_at,
      );

      this.database.saveToFile();

      logger.info("[ChannelManager] P2P message received:", message.id);
      this.emit("channel:message-received", { channelId, message });
    } catch (error) {
      logger.error("[ChannelManager] Failed to handle P2P message:", error);
    }
  }

  /**
   * Clean up resources
   */
  async close() {
    logger.info("[ChannelManager] Closing channel manager");
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  ChannelManager,
  ChannelType,
  MessageType,
};
