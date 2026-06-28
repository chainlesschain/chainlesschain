/**
 * SessionManager — queryStats methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-queryStats
 */
const { logger } = require("../utils/logger.js");

/**
 * Tolerant JSON column parse mirroring the prior `typeof x === "string" ?
 * JSON.parse(x) : x` form, but resilient to a CORRUPT non-empty string (which
 * `JSON.parse(x || "{}")` still threw on, aborting the whole .map). Already-
 * parsed values pass through; null/empty/corrupt → fallback.
 */
function safeParse(raw, fallback) {
  if (raw == null || raw === "") {
    return fallback;
  }
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[SessionManager] Bad JSON column, using fallback: ${err.message}`,
    );
    return fallback;
  }
}

module.exports = {
  async listSessions(options = {}) {
    const { conversationId, limit = 50 } = options;

    try {
      let sql = `
        SELECT id, conversation_id, title, metadata, created_at, updated_at
        FROM llm_sessions
      `;

      const params = [];

      if (conversationId) {
        sql += " WHERE conversation_id = ?";
        params.push(conversationId);
      }

      sql += " ORDER BY updated_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        metadata: safeParse(row.metadata, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error("[SessionManager] 列出会话失败:", error);
      throw error;
    }
  },

  async getSessionStats(sessionId) {
    try {
      const session = await this.loadSession(sessionId);

      const stats = {
        sessionId: session.id,
        conversationId: session.conversationId,
        messageCount: session.messages.length,
        compressionCount: session.metadata.compressionCount || 0,
        totalTokensSaved: session.metadata.totalTokensSaved || 0,
        createdAt: session.metadata.createdAt,
        updatedAt: session.metadata.updatedAt,
      };

      if (session.compressedHistory) {
        const history = JSON.parse(session.compressedHistory);
        stats.lastCompression = {
          originalTokens: history.originalCount,
          compressedTokens: history.compressedCount,
          compressionRatio: history.compressionRatio,
          compressedAt: history.compressedAt,
        };
      }

      return stats;
    } catch (error) {
      logger.error("[SessionManager] 获取统计失败:", error);
      throw error;
    }
  },

  async cleanupOldSessions(daysToKeep = 30) {
    try {
      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

      const stmt = this.db.prepare(`
        SELECT id FROM llm_sessions
        WHERE updated_at < ?
      `);

      const oldSessions = stmt.all(cutoffTime);

      for (const session of oldSessions) {
        await this.deleteSession(session.id);
      }

      logger.info(`[SessionManager] 已清理 ${oldSessions.length} 个旧会话`);

      return oldSessions.length;
    } catch (error) {
      logger.error("[SessionManager] 清理旧会话失败:", error);
      throw error;
    }
  },

  async searchSessions(query, options = {}) {
    const {
      searchContent = true,
      searchTitle = true,
      tags = [],
      limit = 20,
      offset = 0,
    } = options;

    try {
      if (!query || query.trim().length === 0) {
        return this.listSessions({ limit, offset });
      }

      const searchTerm = `%${query.trim()}%`;
      const results = [];

      // 搜索标题
      if (searchTitle) {
        const titleStmt = this.db.prepare(`
          SELECT id, conversation_id, title, metadata, created_at, updated_at
          FROM llm_sessions
          WHERE title LIKE ?
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?
        `);
        const titleResults = titleStmt.all(searchTerm, limit, offset);
        results.push(
          ...titleResults.map((row) => ({
            ...this._parseSessionRow(row),
            matchType: "title",
          })),
        );
      }

      // 搜索消息内容
      if (searchContent) {
        const contentStmt = this.db.prepare(`
          SELECT id, conversation_id, title, messages, metadata, created_at, updated_at
          FROM llm_sessions
          WHERE messages LIKE ?
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?
        `);
        const contentResults = contentStmt.all(searchTerm, limit, offset);

        for (const row of contentResults) {
          // 避免重复
          if (!results.find((r) => r.id === row.id)) {
            const session = this._parseSessionRow(row);
            // 找出匹配的消息（per-row 守卫：一条坏 messages 不应让整个搜索抛错返空）
            let messages = [];
            try {
              messages = JSON.parse(row.messages || "[]");
            } catch {
              messages = [];
            }
            const matchedMessages = messages.filter((msg) => {
              const content =
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content);
              return content.toLowerCase().includes(query.toLowerCase());
            });

            results.push({
              ...session,
              matchType: "content",
              matchedMessages: matchedMessages.slice(0, 3), // 最多返回3条匹配消息
            });
          }
        }
      }

      // 按标签过滤
      if (tags.length > 0) {
        return results.filter((session) => {
          const sessionTags = session.metadata?.tags || [];
          return tags.some((tag) => sessionTags.includes(tag));
        });
      }

      logger.info(
        `[SessionManager] 搜索 "${query}" 找到 ${results.length} 个会话`,
      );
      return results.slice(0, limit);
    } catch (error) {
      logger.error("[SessionManager] 搜索会话失败:", error);
      throw error;
    }
  },

  async getRecentSessions(count = 5) {
    try {
      const stmt = this.db.prepare(`
        SELECT id, conversation_id, title, metadata, created_at, updated_at
        FROM llm_sessions
        ORDER BY updated_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(count);
      return rows.map((row) => this._parseSessionRow(row));
    } catch (error) {
      logger.error("[SessionManager] 获取最近会话失败:", error);
      throw error;
    }
  },

  async getGlobalStats() {
    try {
      const stmt = this.db.prepare(`
        SELECT
          COUNT(*) as totalSessions,
          SUM(json_extract(metadata, '$.messageCount')) as totalMessages,
          SUM(json_extract(metadata, '$.compressionCount')) as totalCompressions,
          SUM(json_extract(metadata, '$.totalTokensSaved')) as totalTokensSaved,
          MIN(created_at) as earliestSession,
          MAX(updated_at) as latestActivity
        FROM llm_sessions
      `);

      const row = stmt.get();

      // 获取标签统计
      const tags = await this.getAllTags();

      // 获取活跃度（最近7天）
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const activityStmt = this.db.prepare(`
        SELECT COUNT(*) as recentSessions
        FROM llm_sessions
        WHERE updated_at > ?
      `);
      const activity = activityStmt.get(weekAgo);

      return {
        totalSessions: row.totalSessions || 0,
        totalMessages: row.totalMessages || 0,
        totalCompressions: row.totalCompressions || 0,
        totalTokensSaved: row.totalTokensSaved || 0,
        earliestSession: row.earliestSession,
        latestActivity: row.latestActivity,
        uniqueTags: tags.length,
        topTags: tags.slice(0, 5),
        recentActivityCount: activity.recentSessions || 0,
      };
    } catch (error) {
      logger.error("[SessionManager] 获取全局统计失败:", error);
      throw error;
    }
  },
};
