/**
 * SessionManager — bulkMisc methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-bulkMisc
 */
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  async resumeSession(sessionId, options = {}) {
    const { generateContextPrompt = true } = options;

    try {
      const session = await this.loadSession(sessionId);

      // 更新最后访问时间
      session.metadata.lastResumedAt = Date.now();
      session.metadata.resumeCount = (session.metadata.resumeCount || 0) + 1;
      await this.saveSession(sessionId);

      const result = {
        session,
        messages: await this.getEffectiveMessages(sessionId),
        stats: await this.getSessionStats(sessionId),
      };

      // 生成上下文提示
      if (generateContextPrompt) {
        result.contextPrompt = this._generateContextPrompt(session);
      }

      logger.info(`[SessionManager] 恢复会话: ${sessionId}`);
      this.emit("session-resumed", { sessionId });

      return result;
    } catch (error) {
      logger.error("[SessionManager] 恢复会话失败:", error);
      throw error;
    }
  },

  _generateContextPrompt(session) {
    const msgs = session.messages;
    if (msgs.length === 0) {
      return "";
    }

    let prompt = "[对话上下文提示]\n";
    prompt += `这是一个续接的对话，标题："${session.title}"\n`;

    if (session.metadata.summary) {
      prompt += `上次对话摘要：${session.metadata.summary}\n`;
    }

    // 提取最近的话题
    const recentUserMsgs = msgs
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) =>
        typeof m.content === "string"
          ? m.content.substring(0, 50)
          : JSON.stringify(m.content).substring(0, 50),
      );

    if (recentUserMsgs.length > 0) {
      prompt += `最近讨论的话题：${recentUserMsgs.join("；")}\n`;
    }

    return prompt;
  },

  async deleteMultiple(sessionIds) {
    try {
      let deleted = 0;
      let failed = 0;

      for (const sessionId of sessionIds) {
        try {
          await this.deleteSession(sessionId);
          deleted++;
        } catch (err) {
          logger.warn(
            `[SessionManager] 删除会话 ${sessionId} 失败:`,
            err.message,
          );
          failed++;
        }
      }

      logger.info(
        `[SessionManager] 批量删除完成: 成功 ${deleted}, 失败 ${failed}`,
      );
      return { deleted, failed };
    } catch (error) {
      logger.error("[SessionManager] 批量删除失败:", error);
      throw error;
    }
  },

  async addTagsToMultiple(sessionIds, tags) {
    try {
      let updated = 0;

      for (const sessionId of sessionIds) {
        try {
          await this.addTags(sessionId, tags);
          updated++;
        } catch (err) {
          logger.warn(
            `[SessionManager] 会话 ${sessionId} 添加标签失败:`,
            err.message,
          );
        }
      }

      logger.info(`[SessionManager] 批量添加标签完成: ${updated} 个会话`);
      return { updated };
    } catch (error) {
      logger.error("[SessionManager] 批量添加标签失败:", error);
      throw error;
    }
  },

  async updateTitle(sessionId, title) {
    try {
      const session = await this.loadSession(sessionId);
      session.title = title;
      session.metadata.updatedAt = Date.now();

      const stmt = this.db.prepare(`
        UPDATE llm_sessions SET title = ?, updated_at = ? WHERE id = ?
      `);
      stmt.run(title, Date.now(), sessionId);

      // 更新缓存
      this.sessionCache.set(sessionId, session);

      logger.info(`[SessionManager] 会话标题已更新: ${sessionId}`);
      this.emit("session-updated", { sessionId, title });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 更新标题失败:", error);
      throw error;
    }
  },

  async duplicateSession(sessionId, options = {}) {
    const {
      titleSuffix = " - 副本",
      includeMessages = true,
      includeTags = true,
      resetMetadata = true,
    } = options;

    try {
      // 1. 加载原会话
      const originalSession = await this.loadSession(sessionId);

      if (!originalSession) {
        throw new Error(`会话不存在: ${sessionId}`);
      }

      // 2. 生成新 ID 和标题
      const newSessionId = uuidv4();
      const newTitle = `${originalSession.title}${titleSuffix}`;
      const now = Date.now();

      // 3. 深拷贝消息
      const newMessages = includeMessages
        ? JSON.parse(JSON.stringify(originalSession.messages))
        : [];

      // 4. 构建新会话元数据
      const newMetadata = {
        createdAt: now,
        updatedAt: now,
        messageCount: newMessages.length,
        duplicatedFrom: sessionId,
        duplicatedAt: now,
      };

      // 复制标签
      if (includeTags && originalSession.metadata?.tags) {
        newMetadata.tags = [...originalSession.metadata.tags];
      }

      // 保留或重置统计数据
      if (!resetMetadata) {
        newMetadata.totalTokens = originalSession.metadata?.totalTokens || 0;
        newMetadata.compressionCount =
          originalSession.metadata?.compressionCount || 0;
        newMetadata.totalTokensSaved =
          originalSession.metadata?.totalTokensSaved || 0;
      } else {
        newMetadata.totalTokens = 0;
        newMetadata.compressionCount = 0;
        newMetadata.totalTokensSaved = 0;
      }

      // 5. 创建新会话对象
      const newSession = {
        id: newSessionId,
        conversationId: `dup-${newSessionId}`,
        title: newTitle,
        messages: newMessages,
        compressedHistory: null, // 重置压缩历史
        metadata: newMetadata,
      };

      // 6. 保存到数据库
      const stmt = this.db.prepare(`
        INSERT INTO llm_sessions (
          id, conversation_id, title, messages, compressed_history,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        newSessionId,
        newSession.conversationId,
        newSession.title,
        JSON.stringify(newSession.messages),
        null,
        JSON.stringify(newSession.metadata),
        now,
        now,
      );

      // 7. 保存到文件
      await this.saveSessionToFile(newSession);

      // 8. 缓存
      this.sessionCache.set(newSessionId, newSession);

      logger.info(
        `[SessionManager] 会话已复制: ${sessionId} -> ${newSessionId}`,
      );
      this.emit("session-duplicated", {
        originalId: sessionId,
        newId: newSessionId,
        newSession,
      });

      return newSession;
    } catch (error) {
      logger.error("[SessionManager] 复制会话失败:", error);
      throw error;
    }
  },
};
