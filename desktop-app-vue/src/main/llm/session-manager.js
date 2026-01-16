/**
 * SessionManager - 会话上下文管理器
 *
 * 功能：
 * - 会话持久化（保存到 .chainlesschain/memory/sessions/）
 * - 智能上下文压缩（集成 PromptCompressor）
 * - 跨会话连续对话
 * - Token 使用优化（减少 30-40%）
 *
 * 基于 OpenClaude 最佳实践
 *
 * @module session-manager
 * @version 1.0.0
 * @since 2026-01-16
 */

const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const { PromptCompressor } = require("./prompt-compressor");

/**
 * SessionManager 类
 */
class SessionManager extends EventEmitter {
  /**
   * 创建会话管理器
   * @param {Object} options - 配置选项
   * @param {Object} options.database - 数据库实例
   * @param {Object} options.llmManager - LLM 管理器实例（用于智能总结）
   * @param {string} options.sessionsDir - 会话存储目录
   * @param {number} [options.maxHistoryMessages=10] - 最大历史消息数
   * @param {number} [options.compressionThreshold=10] - 触发压缩的消息数阈值
   * @param {boolean} [options.enableAutoSave=true] - 启用自动保存
   * @param {boolean} [options.enableCompression=true] - 启用智能压缩
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[SessionManager] database 参数是必需的");
    }

    this.db = options.database;
    this.llmManager = options.llmManager || null;
    this.sessionsDir =
      options.sessionsDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "sessions");
    this.maxHistoryMessages = options.maxHistoryMessages || 10;
    this.compressionThreshold = options.compressionThreshold || 10;
    this.enableAutoSave = options.enableAutoSave !== false;
    this.enableCompression = options.enableCompression !== false;

    // 初始化 PromptCompressor
    this.promptCompressor = new PromptCompressor({
      enableDeduplication: true,
      enableSummarization: !!this.llmManager,
      enableTruncation: true,
      maxHistoryMessages: this.maxHistoryMessages,
      maxTotalTokens: 4000,
      llmManager: this.llmManager,
    });

    // 内存缓存
    this.sessionCache = new Map();

    console.log("[SessionManager] 初始化完成", {
      会话目录: this.sessionsDir,
      最大消息数: this.maxHistoryMessages,
      压缩阈值: this.compressionThreshold,
      自动保存: this.enableAutoSave,
      智能压缩: this.enableCompression,
    });
  }

  /**
   * 初始化（确保目录存在）
   */
  async initialize() {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      console.log("[SessionManager] 会话目录已创建:", this.sessionsDir);
    } catch (error) {
      console.error("[SessionManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 创建新会话
   * @param {Object} params
   * @param {string} params.conversationId - 对话 ID
   * @param {string} [params.title] - 会话标题
   * @param {Object} [params.metadata] - 会话元数据
   * @returns {Promise<Object>} 会话对象
   */
  async createSession(params) {
    const { conversationId, title, metadata = {} } = params;

    if (!conversationId) {
      throw new Error("[SessionManager] conversationId 是必需的");
    }

    try {
      const sessionId = uuidv4();
      const now = Date.now();

      const session = {
        id: sessionId,
        conversationId,
        title: title || `会话 ${new Date(now).toLocaleString()}`,
        messages: [],
        compressedHistory: null,
        metadata: {
          ...metadata,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          totalTokens: 0,
          compressionCount: 0,
        },
      };

      // 保存到数据库
      const stmt = this.db.prepare(`
        INSERT INTO llm_sessions (
          id, conversation_id, title, messages, compressed_history,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        sessionId,
        conversationId,
        session.title,
        JSON.stringify(session.messages),
        null,
        JSON.stringify(session.metadata),
        now,
        now,
      );

      // 保存到文件
      await this.saveSessionToFile(session);

      // 缓存
      this.sessionCache.set(sessionId, session);

      console.log("[SessionManager] 会话已创建:", sessionId);
      this.emit("session-created", session);

      return session;
    } catch (error) {
      console.error("[SessionManager] 创建会话失败:", error);
      throw error;
    }
  }

  /**
   * 加载会话
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 加载选项
   * @param {boolean} [options.fromCache=true] - 优先从缓存加载
   * @param {boolean} [options.fromFile=false] - 从文件加载
   * @returns {Promise<Object>} 会话对象
   */
  async loadSession(sessionId, options = {}) {
    const { fromCache = true, fromFile = false } = options;

    try {
      // 1. 尝试从缓存加载
      if (fromCache && this.sessionCache.has(sessionId)) {
        console.log("[SessionManager] 从缓存加载会话:", sessionId);
        return this.sessionCache.get(sessionId);
      }

      // 2. 尝试从文件加载
      if (fromFile) {
        try {
          const session = await this.loadSessionFromFile(sessionId);
          this.sessionCache.set(sessionId, session);
          return session;
        } catch (fileError) {
          console.warn("[SessionManager] 从文件加载失败，尝试从数据库加载");
        }
      }

      // 3. 从数据库加载
      const stmt = this.db.prepare(`
        SELECT id, conversation_id, title, messages, compressed_history,
               metadata, created_at, updated_at
        FROM llm_sessions
        WHERE id = ?
      `);

      const row = stmt.get(sessionId);

      if (!row) {
        throw new Error(`会话不存在: ${sessionId}`);
      }

      const session = {
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        messages: JSON.parse(row.messages || "[]"),
        compressedHistory: row.compressed_history,
        metadata: JSON.parse(row.metadata || "{}"),
      };

      // 缓存
      this.sessionCache.set(sessionId, session);

      console.log("[SessionManager] 从数据库加载会话:", sessionId);
      return session;
    } catch (error) {
      console.error("[SessionManager] 加载会话失败:", error);
      throw error;
    }
  }

  /**
   * 添加消息到会话
   * @param {string} sessionId - 会话 ID
   * @param {Object} message - 消息对象 {role, content}
   * @param {Object} options - 添加选项
   * @returns {Promise<Object>} 更新后的会话
   */
  async addMessage(sessionId, message, options = {}) {
    try {
      const session = await this.loadSession(sessionId);

      // 添加消息
      session.messages.push({
        ...message,
        timestamp: Date.now(),
      });

      // 更新元数据
      session.metadata.messageCount = session.messages.length;
      session.metadata.updatedAt = Date.now();

      // 检查是否需要压缩
      if (
        this.enableCompression &&
        session.messages.length >= this.compressionThreshold
      ) {
        console.log("[SessionManager] 消息数达到阈值，触发压缩");
        await this.compressSession(sessionId);
      }

      // 自动保存
      if (this.enableAutoSave) {
        await this.saveSession(sessionId);
      }

      this.emit("message-added", { sessionId, message });

      return session;
    } catch (error) {
      console.error("[SessionManager] 添加消息失败:", error);
      throw error;
    }
  }

  /**
   * 压缩会话历史
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 压缩结果
   */
  async compressSession(sessionId) {
    try {
      const session = await this.loadSession(sessionId);

      if (session.messages.length <= this.maxHistoryMessages) {
        console.log("[SessionManager] 消息数未超过最大限制，跳过压缩");
        return { compressed: false };
      }

      console.log("[SessionManager] 开始压缩会话:", sessionId);

      // 使用 PromptCompressor 压缩
      const result = await this.promptCompressor.compress(session.messages, {
        preserveSystemMessage: true,
        preserveLastUserMessage: true,
      });

      // 保存压缩后的消息
      session.messages = result.messages;
      session.compressedHistory = JSON.stringify({
        originalCount: result.originalTokens,
        compressedCount: result.compressedTokens,
        compressionRatio: result.compressionRatio,
        strategy: result.strategy,
        compressedAt: Date.now(),
      });

      // 更新元数据
      session.metadata.compressionCount =
        (session.metadata.compressionCount || 0) + 1;
      session.metadata.totalTokensSaved =
        (session.metadata.totalTokensSaved || 0) +
        (result.originalTokens - result.compressedTokens);

      // 保存
      await this.saveSession(sessionId);

      console.log("[SessionManager] 压缩完成:", {
        原始Tokens: result.originalTokens,
        压缩后Tokens: result.compressedTokens,
        压缩率: result.compressionRatio.toFixed(2),
        策略: result.strategy,
      });

      this.emit("session-compressed", {
        sessionId,
        compressionRatio: result.compressionRatio,
        tokensSaved: result.originalTokens - result.compressedTokens,
      });

      return {
        compressed: true,
        ...result,
      };
    } catch (error) {
      console.error("[SessionManager] 压缩会话失败:", error);
      throw error;
    }
  }

  /**
   * 保存会话（到数据库和文件）
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}
   */
  async saveSession(sessionId) {
    try {
      const session = await this.loadSession(sessionId);
      const now = Date.now();

      session.metadata.updatedAt = now;

      // 保存到数据库
      const stmt = this.db.prepare(`
        UPDATE llm_sessions
        SET
          title = ?,
          messages = ?,
          compressed_history = ?,
          metadata = ?,
          updated_at = ?
        WHERE id = ?
      `);

      stmt.run(
        session.title,
        JSON.stringify(session.messages),
        session.compressedHistory,
        JSON.stringify(session.metadata),
        now,
        sessionId,
      );

      // 保存到文件（后台异步）
      this.saveSessionToFile(session).catch((err) => {
        console.error("[SessionManager] 保存文件失败:", err);
      });

      console.log("[SessionManager] 会话已保存:", sessionId);
    } catch (error) {
      console.error("[SessionManager] 保存会话失败:", error);
      throw error;
    }
  }

  /**
   * 保存会话到文件
   * @param {Object} session - 会话对象
   * @returns {Promise<void>}
   */
  async saveSessionToFile(session) {
    try {
      const filePath = path.join(this.sessionsDir, `${session.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
    } catch (error) {
      console.error("[SessionManager] 保存文件失败:", error);
      throw error;
    }
  }

  /**
   * 从文件加载会话
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>}
   */
  async loadSessionFromFile(sessionId) {
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error("[SessionManager] 从文件加载失败:", error);
      throw error;
    }
  }

  /**
   * 获取会话的有效消息（用于 LLM 调用）
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Array>} 消息数组
   */
  async getEffectiveMessages(sessionId) {
    try {
      const session = await this.loadSession(sessionId);

      // 如果已压缩，返回压缩后的消息
      if (session.compressedHistory) {
        console.log("[SessionManager] 返回压缩后的消息");
        return session.messages;
      }

      // 如果消息数超过阈值，先压缩
      if (session.messages.length > this.compressionThreshold) {
        await this.compressSession(sessionId);
        const updatedSession = await this.loadSession(sessionId);
        return updatedSession.messages;
      }

      return session.messages;
    } catch (error) {
      console.error("[SessionManager] 获取有效消息失败:", error);
      throw error;
    }
  }

  /**
   * 删除会话
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}
   */
  async deleteSession(sessionId) {
    try {
      // 从数据库删除
      const stmt = this.db.prepare("DELETE FROM llm_sessions WHERE id = ?");
      stmt.run(sessionId);

      // 从缓存删除
      this.sessionCache.delete(sessionId);

      // 从文件系统删除
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      try {
        await fs.unlink(filePath);
      } catch (fileError) {
        console.warn(
          "[SessionManager] 删除文件失败（可能不存在）:",
          fileError.message,
        );
      }

      console.log("[SessionManager] 会话已删除:", sessionId);
      this.emit("session-deleted", { sessionId });
    } catch (error) {
      console.error("[SessionManager] 删除会话失败:", error);
      throw error;
    }
  }

  /**
   * 列出所有会话
   * @param {Object} options - 查询选项
   * @param {string} [options.conversationId] - 按对话 ID 过滤
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 会话列表
   */
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
        metadata: JSON.parse(row.metadata || "{}"),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error("[SessionManager] 列出会话失败:", error);
      throw error;
    }
  }

  /**
   * 获取会话统计
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 统计信息
   */
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
      console.error("[SessionManager] 获取统计失败:", error);
      throw error;
    }
  }

  /**
   * 清理旧会话（超过指定天数）
   * @param {number} daysToKeep - 保留天数
   * @returns {Promise<number>} 删除的会话数
   */
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

      console.log(`[SessionManager] 已清理 ${oldSessions.length} 个旧会话`);

      return oldSessions.length;
    } catch (error) {
      console.error("[SessionManager] 清理旧会话失败:", error);
      throw error;
    }
  }
}

module.exports = {
  SessionManager,
};
