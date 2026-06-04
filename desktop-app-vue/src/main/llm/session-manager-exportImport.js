/**
 * SessionManager — exportImport methods (prototype mixin).
 * Split verbatim from session-manager.js; mixed into SessionManager.prototype.
 * Methods reference `this` (db / sessionCache / llmManager / ...) exactly as before.
 *
 * @module llm/session-manager-exportImport
 */
const { logger } = require("../utils/logger.js");

module.exports = {
  async exportToJSON(sessionId, options = {}) {
    const { includeMetadata = true, prettify = true } = options;

    try {
      const session = await this.loadSession(sessionId);

      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        session: {
          id: session.id,
          conversationId: session.conversationId,
          title: session.title,
          messages: session.messages,
        },
      };

      if (includeMetadata) {
        exportData.session.metadata = session.metadata;
        exportData.session.compressedHistory = session.compressedHistory;
      }

      logger.info(`[SessionManager] 导出会话 ${sessionId} 为 JSON`);
      return prettify
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);
    } catch (error) {
      logger.error("[SessionManager] 导出 JSON 失败:", error);
      throw error;
    }
  },

  async exportToMarkdown(sessionId, options = {}) {
    const { includeTimestamp = true, includeMetadata = false } = options;

    try {
      const session = await this.loadSession(sessionId);

      let md = `# ${session.title}\n\n`;

      if (includeMetadata) {
        md += `> **会话ID**: ${session.id}\n`;
        md += `> **创建时间**: ${new Date(session.metadata.createdAt).toLocaleString()}\n`;
        if (session.metadata.tags?.length > 0) {
          md += `> **标签**: ${session.metadata.tags.join(", ")}\n`;
        }
        md += "\n---\n\n";
      }

      for (const msg of session.messages) {
        const role = msg.role === "user" ? "👤 用户" : "🤖 助手";
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content, null, 2);

        md += `## ${role}\n\n`;

        if (includeTimestamp && msg.timestamp) {
          md += `*${new Date(msg.timestamp).toLocaleString()}*\n\n`;
        }

        md += `${content}\n\n`;
      }

      md += "---\n\n";
      md += `*导出时间: ${new Date().toLocaleString()}*\n`;

      logger.info(`[SessionManager] 导出会话 ${sessionId} 为 Markdown`);
      return md;
    } catch (error) {
      logger.error("[SessionManager] 导出 Markdown 失败:", error);
      throw error;
    }
  },

  async importFromJSON(jsonData, options = {}) {
    const { generateNewId = true, conversationId } = options;

    try {
      const data = JSON.parse(jsonData);

      if (!data.session || !data.session.messages) {
        throw new Error("无效的会话数据格式");
      }

      const importSession = data.session;

      // 创建新会话
      const newSession = await this.createSession({
        conversationId:
          conversationId ||
          importSession.conversationId ||
          `imported-${Date.now()}`,
        title: importSession.title || "导入的会话",
        metadata: {
          ...(importSession.metadata || {}),
          importedAt: Date.now(),
          importedFrom: data.exportedAt,
        },
      });

      // 添加消息
      for (const msg of importSession.messages) {
        await this.addMessage(newSession.id, {
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp || Date.now(),
        });
      }

      logger.info(
        `[SessionManager] 导入会话成功，新会话ID: ${newSession.id}，消息数: ${importSession.messages.length}`,
      );
      this.emit("session-imported", { sessionId: newSession.id });

      return newSession;
    } catch (error) {
      logger.error("[SessionManager] 导入 JSON 失败:", error);
      throw error;
    }
  },

  async exportMultiple(sessionIds, options = {}) {
    try {
      const sessions = [];

      for (const sessionId of sessionIds) {
        const session = await this.loadSession(sessionId);
        sessions.push({
          id: session.id,
          conversationId: session.conversationId,
          title: session.title,
          messages: session.messages,
          metadata: session.metadata,
        });
      }

      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        sessionCount: sessions.length,
        sessions,
      };

      logger.info(`[SessionManager] 批量导出 ${sessions.length} 个会话`);
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      logger.error("[SessionManager] 批量导出失败:", error);
      throw error;
    }
  },
};
