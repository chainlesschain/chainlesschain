/**
 * Collaboration Session Manager
 *
 * Manages real-time collaboration sessions for knowledge base items.
 * Tracks active users, cursor positions, and presence information.
 *
 * Features:
 * - Session lifecycle management
 * - User presence tracking
 * - Cursor position synchronization
 * - Activity monitoring
 * - Session statistics
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

class CollaborationSessionManager extends EventEmitter {
  constructor(database, p2pManager) {
    super();
    this.database = database;
    this.p2pManager = p2pManager;

    // Active sessions: Map<knowledgeId, Set<sessionInfo>>
    this.activeSessions = new Map();

    // Session heartbeat interval (30 seconds)
    this.heartbeatInterval = 30000;

    // Session timeout (2 minutes)
    this.sessionTimeout = 120000;

    // Start heartbeat monitor
    this._startHeartbeatMonitor();
  }

  /**
   * Create a new collaboration session
   * @param {Object} params - Session parameters
   * @returns {Object} Session info
   */
  async createSession(params) {
    const { knowledgeId, orgId, userDid, userName, userColor } = params;

    const sessionId = uuidv4();
    const now = Date.now();

    // Generate random color if not provided
    const color = userColor || this._generateUserColor();

    const sessionInfo = {
      id: sessionId,
      knowledgeId,
      orgId,
      userDid,
      userName,
      userColor: color,
      peerId: this.p2pManager?.node?.peerId?.toString() || "local",
      cursorPosition: null,
      selectionStart: null,
      selectionEnd: null,
      lastActivity: now,
      status: "active",
      createdAt: now,
    };

    // Save to database
    try {
      this.database.run(
        `
        INSERT INTO collaboration_sessions (
          id, knowledge_id, org_id, user_did, user_name, user_color,
          peer_id, cursor_position, selection_start, selection_end,
          last_activity, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          sessionId,
          knowledgeId,
          orgId,
          userDid,
          userName,
          color,
          sessionInfo.peerId,
          null,
          null,
          null,
          now,
          "active",
          now,
        ],
      );

      // Add to active sessions
      if (!this.activeSessions.has(knowledgeId)) {
        this.activeSessions.set(knowledgeId, new Set());
      }
      this.activeSessions.get(knowledgeId).add(sessionInfo);

      // Broadcast session join
      await this._broadcastSessionEvent(knowledgeId, {
        type: "session:join",
        session: sessionInfo,
      });

      this.emit("session:created", sessionInfo);

      logger.info(
        `[CollabSession] Created session ${sessionId} for knowledge ${knowledgeId}`,
      );
      return sessionInfo;
    } catch (error) {
      logger.error("[CollabSession] Error creating session:", error);
      throw error;
    }
  }

  /**
   * Update session activity (cursor position, selection)
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Updates to apply
   */
  async updateSession(sessionId, updates) {
    try {
      const { cursorPosition, selectionStart, selectionEnd } = updates;

      const now = Date.now();

      // Update database
      this.database.run(
        `
        UPDATE collaboration_sessions
        SET cursor_position = ?,
            selection_start = ?,
            selection_end = ?,
            last_activity = ?
        WHERE id = ?
      `,
        [cursorPosition, selectionStart, selectionEnd, now, sessionId],
      );

      // Update in-memory session
      for (const [knowledgeId, sessions] of this.activeSessions.entries()) {
        for (const session of sessions) {
          if (session.id === sessionId) {
            session.cursorPosition = cursorPosition;
            session.selectionStart = selectionStart;
            session.selectionEnd = selectionEnd;
            session.lastActivity = now;

            // Broadcast cursor update
            await this._broadcastSessionEvent(knowledgeId, {
              type: "session:update",
              sessionId,
              updates: {
                cursorPosition,
                selectionStart,
                selectionEnd,
              },
            });

            this.emit("session:updated", session);
            break;
          }
        }
      }
    } catch (error) {
      logger.error("[CollabSession] Error updating session:", error);
      throw error;
    }
  }

  /**
   * End a collaboration session
   * @param {string} sessionId - Session ID
   */
  async endSession(sessionId) {
    try {
      // Find and remove session
      let knowledgeId = null;
      let sessionInfo = null;

      for (const [kid, sessions] of this.activeSessions.entries()) {
        for (const session of sessions) {
          if (session.id === sessionId) {
            knowledgeId = kid;
            sessionInfo = session;
            sessions.delete(session);
            break;
          }
        }
        if (knowledgeId) {
          break;
        }
      }

      if (!sessionInfo) {
        logger.warn(`[CollabSession] Session ${sessionId} not found`);
        return;
      }

      // Update database
      this.database.run(
        `
        UPDATE collaboration_sessions
        SET status = 'disconnected',
            last_activity = ?
        WHERE id = ?
      `,
        [Date.now(), sessionId],
      );

      // Broadcast session leave
      await this._broadcastSessionEvent(knowledgeId, {
        type: "session:leave",
        sessionId,
      });

      this.emit("session:ended", sessionInfo);

      logger.info(`[CollabSession] Ended session ${sessionId}`);
    } catch (error) {
      logger.error("[CollabSession] Error ending session:", error);
      throw error;
    }
  }

  /**
   * Get active sessions for a knowledge item
   * @param {string} knowledgeId - Knowledge item ID
   * @returns {Array} Active sessions
   */
  getActiveSessions(knowledgeId) {
    const sessions = this.activeSessions.get(knowledgeId);
    return sessions ? Array.from(sessions) : [];
  }

  /**
   * Get all active sessions
   * @returns {Object} Map of knowledge ID to sessions
   */
  getAllActiveSessions() {
    const result = {};
    for (const [knowledgeId, sessions] of this.activeSessions.entries()) {
      result[knowledgeId] = Array.from(sessions);
    }
    return result;
  }

  /**
   * Get session statistics
   * @param {string} knowledgeId - Knowledge item ID (optional)
   * @returns {Object} Statistics
   */
  getSessionStats(knowledgeId = null) {
    if (knowledgeId) {
      const sessions = this.getActiveSessions(knowledgeId);
      return {
        knowledgeId,
        activeUsers: sessions.length,
        sessions: sessions.map((s) => ({
          userName: s.userName,
          userColor: s.userColor,
          lastActivity: s.lastActivity,
          status: s.status,
        })),
      };
    }

    // Global statistics
    let totalSessions = 0;
    const knowledgeItems = [];

    for (const [kid, sessions] of this.activeSessions.entries()) {
      totalSessions += sessions.size;
      knowledgeItems.push({
        knowledgeId: kid,
        activeUsers: sessions.size,
      });
    }

    return {
      totalSessions,
      activeKnowledgeItems: knowledgeItems.length,
      knowledgeItems,
    };
  }

  /**
   * Broadcast session event to peers
   * @private
   */
  async _broadcastSessionEvent(knowledgeId, event) {
    if (!this.p2pManager || !this.p2pManager.pubsub) {
      return;
    }

    try {
      const topic = `collab_${knowledgeId}`;
      const message = JSON.stringify(event);
      await this.p2pManager.pubsub.publish(topic, Buffer.from(message));
    } catch (error) {
      logger.error("[CollabSession] Error broadcasting event:", error);
    }
  }

  /**
   * Start heartbeat monitor to detect inactive sessions
   * @private
   */
  _startHeartbeatMonitor() {
    setInterval(() => {
      const now = Date.now();

      for (const [knowledgeId, sessions] of this.activeSessions.entries()) {
        for (const session of sessions) {
          // Check if session has timed out
          if (now - session.lastActivity > this.sessionTimeout) {
            logger.info(`[CollabSession] Session ${session.id} timed out`);
            this.endSession(session.id);
          }
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * Generate a random user color
   * @private
   */
  _generateUserColor() {
    const colors = [
      "#1890ff", // blue
      "#52c41a", // green
      "#faad14", // orange
      "#f5222d", // red
      "#722ed1", // purple
      "#13c2c2", // cyan
      "#eb2f96", // magenta
      "#fa8c16", // gold
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Clean up all sessions
   */
  async cleanup() {
    logger.info("[CollabSession] Cleaning up all sessions");

    for (const [knowledgeId, sessions] of this.activeSessions.entries()) {
      for (const session of sessions) {
        await this.endSession(session.id);
      }
    }

    this.activeSessions.clear();
  }
}

module.exports = CollaborationSessionManager;
