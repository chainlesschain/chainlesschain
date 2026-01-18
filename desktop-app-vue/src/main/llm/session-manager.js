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

  // ============================================================
  // 增强功能 - 会话搜索
  // ============================================================

  /**
   * 搜索会话（按标题和内容）
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @param {boolean} [options.searchContent=true] - 是否搜索消息内容
   * @param {boolean} [options.searchTitle=true] - 是否搜索标题
   * @param {string[]} [options.tags] - 按标签过滤
   * @param {number} [options.limit=20] - 最大返回数量
   * @param {number} [options.offset=0] - 偏移量（分页）
   * @returns {Promise<Array>} 搜索结果
   */
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
            // 找出匹配的消息
            const messages = JSON.parse(row.messages || "[]");
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

      console.log(
        `[SessionManager] 搜索 "${query}" 找到 ${results.length} 个会话`,
      );
      return results.slice(0, limit);
    } catch (error) {
      console.error("[SessionManager] 搜索会话失败:", error);
      throw error;
    }
  }

  /**
   * 解析数据库行为会话对象
   * @private
   */
  _parseSessionRow(row) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      title: row.title,
      metadata: JSON.parse(row.metadata || "{}"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ============================================================
  // 增强功能 - 会话标签系统
  // ============================================================

  /**
   * 添加标签到会话
   * @param {string} sessionId - 会话 ID
   * @param {string|string[]} tags - 标签（单个或数组）
   * @returns {Promise<Object>} 更新后的会话
   */
  async addTags(sessionId, tags) {
    try {
      const session = await this.loadSession(sessionId);
      const currentTags = session.metadata.tags || [];

      // 确保 tags 是数组
      const newTags = Array.isArray(tags) ? tags : [tags];

      // 合并去重
      const mergedTags = [...new Set([...currentTags, ...newTags])];
      session.metadata.tags = mergedTags;
      session.metadata.updatedAt = Date.now();

      await this.saveSession(sessionId);

      console.log(`[SessionManager] 会话 ${sessionId} 添加标签:`, newTags);
      this.emit("tags-updated", { sessionId, tags: mergedTags });

      return session;
    } catch (error) {
      console.error("[SessionManager] 添加标签失败:", error);
      throw error;
    }
  }

  /**
   * 从会话移除标签
   * @param {string} sessionId - 会话 ID
   * @param {string|string[]} tags - 要移除的标签
   * @returns {Promise<Object>} 更新后的会话
   */
  async removeTags(sessionId, tags) {
    try {
      const session = await this.loadSession(sessionId);
      const currentTags = session.metadata.tags || [];

      const tagsToRemove = Array.isArray(tags) ? tags : [tags];
      session.metadata.tags = currentTags.filter(
        (t) => !tagsToRemove.includes(t),
      );
      session.metadata.updatedAt = Date.now();

      await this.saveSession(sessionId);

      console.log(`[SessionManager] 会话 ${sessionId} 移除标签:`, tagsToRemove);
      this.emit("tags-updated", { sessionId, tags: session.metadata.tags });

      return session;
    } catch (error) {
      console.error("[SessionManager] 移除标签失败:", error);
      throw error;
    }
  }

  /**
   * 获取所有使用过的标签
   * @returns {Promise<Array>} 标签列表（带使用次数）
   */
  async getAllTags() {
    try {
      const stmt = this.db.prepare(`
        SELECT metadata FROM llm_sessions
      `);
      const rows = stmt.all();

      const tagCount = new Map();
      for (const row of rows) {
        const metadata = JSON.parse(row.metadata || "{}");
        const tags = metadata.tags || [];
        for (const tag of tags) {
          tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        }
      }

      return Array.from(tagCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      console.error("[SessionManager] 获取标签列表失败:", error);
      throw error;
    }
  }

  /**
   * 按标签查找会话
   * @param {string[]} tags - 标签数组
   * @param {Object} options - 查询选项
   * @param {string} [options.matchMode='any'] - 匹配模式：'any'(任意) 或 'all'(全部)
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 会话列表
   */
  async findSessionsByTags(tags, options = {}) {
    const { matchMode = "any", limit = 50 } = options;

    try {
      const sessions = await this.listSessions({ limit: 1000 });

      return sessions
        .filter((session) => {
          const sessionTags = session.metadata?.tags || [];
          if (matchMode === "all") {
            return tags.every((t) => sessionTags.includes(t));
          }
          return tags.some((t) => sessionTags.includes(t));
        })
        .slice(0, limit);
    } catch (error) {
      console.error("[SessionManager] 按标签查找失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 会话导出/导入
  // ============================================================

  /**
   * 导出会话为 JSON
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 导出选项
   * @param {boolean} [options.includeMetadata=true] - 包含元数据
   * @param {boolean} [options.prettify=true] - 美化 JSON
   * @returns {Promise<string>} JSON 字符串
   */
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

      console.log(`[SessionManager] 导出会话 ${sessionId} 为 JSON`);
      return prettify
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);
    } catch (error) {
      console.error("[SessionManager] 导出 JSON 失败:", error);
      throw error;
    }
  }

  /**
   * 导出会话为 Markdown
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 导出选项
   * @param {boolean} [options.includeTimestamp=true] - 包含时间戳
   * @param {boolean} [options.includeMetadata=false] - 包含元数据
   * @returns {Promise<string>} Markdown 字符串
   */
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

      console.log(`[SessionManager] 导出会话 ${sessionId} 为 Markdown`);
      return md;
    } catch (error) {
      console.error("[SessionManager] 导出 Markdown 失败:", error);
      throw error;
    }
  }

  /**
   * 从 JSON 导入会话
   * @param {string} jsonData - JSON 字符串
   * @param {Object} options - 导入选项
   * @param {boolean} [options.generateNewId=true] - 生成新的会话 ID
   * @param {string} [options.conversationId] - 指定对话 ID
   * @returns {Promise<Object>} 导入的会话
   */
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

      console.log(
        `[SessionManager] 导入会话成功，新会话ID: ${newSession.id}，消息数: ${importSession.messages.length}`,
      );
      this.emit("session-imported", { sessionId: newSession.id });

      return newSession;
    } catch (error) {
      console.error("[SessionManager] 导入 JSON 失败:", error);
      throw error;
    }
  }

  /**
   * 批量导出会话
   * @param {string[]} sessionIds - 会话 ID 数组
   * @param {Object} options - 导出选项
   * @returns {Promise<string>} JSON 字符串
   */
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

      console.log(`[SessionManager] 批量导出 ${sessions.length} 个会话`);
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error("[SessionManager] 批量导出失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 会话摘要生成
  // ============================================================

  /**
   * 生成会话摘要
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 摘要选项
   * @param {boolean} [options.useLLM=true] - 使用 LLM 生成（需要 llmManager）
   * @param {number} [options.maxLength=200] - 摘要最大长度
   * @returns {Promise<string>} 会话摘要
   */
  async generateSummary(sessionId, options = {}) {
    const { useLLM = true, maxLength = 200 } = options;

    try {
      const session = await this.loadSession(sessionId);

      if (session.messages.length === 0) {
        return "空会话";
      }

      // 方式1：使用 LLM 生成摘要
      if (useLLM && this.llmManager) {
        const messagesText = session.messages
          .map((msg) => {
            const role = msg.role === "user" ? "用户" : "助手";
            const content =
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content);
            return `${role}: ${content}`;
          })
          .join("\n");

        const prompt = `请用一句话（不超过${maxLength}字）总结以下对话的主要内容：\n\n${messagesText}\n\n摘要：`;

        try {
          const result = await this.llmManager.query(prompt, {
            max_tokens: 100,
            temperature: 0.3,
          });
          const summary = (result.text || result.content || "").trim();

          // 更新会话元数据
          session.metadata.summary = summary;
          session.metadata.summaryGeneratedAt = Date.now();
          await this.saveSession(sessionId);

          console.log(`[SessionManager] LLM 生成摘要: ${summary}`);
          return summary;
        } catch (llmError) {
          console.warn(
            "[SessionManager] LLM 摘要生成失败，使用简单摘要:",
            llmError.message,
          );
        }
      }

      // 方式2：简单摘要（提取首条用户消息）
      const firstUserMessage = session.messages.find(
        (msg) => msg.role === "user",
      );
      if (firstUserMessage) {
        const content =
          typeof firstUserMessage.content === "string"
            ? firstUserMessage.content
            : JSON.stringify(firstUserMessage.content);
        const summary =
          content.length > maxLength
            ? content.substring(0, maxLength) + "..."
            : content;

        session.metadata.summary = summary;
        await this.saveSession(sessionId);

        return summary;
      }

      return "无用户消息";
    } catch (error) {
      console.error("[SessionManager] 生成摘要失败:", error);
      throw error;
    }
  }

  /**
   * 批量生成摘要
   * @param {Object} options - 选项
   * @param {boolean} [options.overwrite=false] - 覆盖已有摘要
   * @param {number} [options.limit=50] - 最多处理数量
   * @returns {Promise<Object>} 处理结果
   */
  async generateSummariesBatch(options = {}) {
    const { overwrite = false, limit = 50 } = options;

    try {
      const sessions = await this.listSessions({ limit });
      let processed = 0;
      let skipped = 0;

      for (const session of sessions) {
        if (!overwrite && session.metadata?.summary) {
          skipped++;
          continue;
        }

        try {
          await this.generateSummary(session.id, { useLLM: true });
          processed++;
        } catch (err) {
          console.warn(
            `[SessionManager] 会话 ${session.id} 摘要生成失败:`,
            err.message,
          );
        }
      }

      console.log(
        `[SessionManager] 批量摘要完成: 处理 ${processed}, 跳过 ${skipped}`,
      );
      return { processed, skipped };
    } catch (error) {
      console.error("[SessionManager] 批量生成摘要失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 会话续接
  // ============================================================

  /**
   * 恢复会话（获取续接上下文）
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 选项
   * @param {boolean} [options.generateContextPrompt=true] - 生成上下文提示
   * @returns {Promise<Object>} 恢复结果
   */
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

      console.log(`[SessionManager] 恢复会话: ${sessionId}`);
      this.emit("session-resumed", { sessionId });

      return result;
    } catch (error) {
      console.error("[SessionManager] 恢复会话失败:", error);
      throw error;
    }
  }

  /**
   * 生成上下文提示
   * @private
   */
  _generateContextPrompt(session) {
    const msgs = session.messages;
    if (msgs.length === 0) return "";

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
  }

  /**
   * 获取最近的会话（用于快速续接）
   * @param {number} count - 数量
   * @returns {Promise<Array>} 最近的会话列表
   */
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
      console.error("[SessionManager] 获取最近会话失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 会话模板
  // ============================================================

  /**
   * 保存会话为模板
   * @param {string} sessionId - 会话 ID
   * @param {Object} templateInfo - 模板信息
   * @param {string} templateInfo.name - 模板名称
   * @param {string} [templateInfo.description] - 模板描述
   * @param {string} [templateInfo.category] - 分类
   * @returns {Promise<Object>} 模板对象
   */
  async saveAsTemplate(sessionId, templateInfo) {
    const { name, description = "", category = "default" } = templateInfo;

    try {
      const session = await this.loadSession(sessionId);
      const templateId = uuidv4();
      const now = Date.now();

      const template = {
        id: templateId,
        name,
        description,
        category,
        sourceSessionId: sessionId,
        messages: session.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        metadata: {
          createdAt: now,
          updatedAt: now,
          useCount: 0,
        },
      };

      // 保存到数据库
      const stmt = this.db.prepare(`
        INSERT INTO llm_session_templates (
          id, name, description, category, source_session_id,
          messages, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        templateId,
        name,
        description,
        category,
        sessionId,
        JSON.stringify(template.messages),
        JSON.stringify(template.metadata),
        now,
        now,
      );

      console.log(`[SessionManager] 会话 ${sessionId} 保存为模板: ${name}`);
      this.emit("template-created", { templateId, name });

      return template;
    } catch (error) {
      // 如果表不存在，尝试创建
      if (error.message.includes("no such table")) {
        await this._ensureTemplateTable();
        return this.saveAsTemplate(sessionId, templateInfo);
      }
      console.error("[SessionManager] 保存模板失败:", error);
      throw error;
    }
  }

  /**
   * 确保模板表存在
   * @private
   */
  async _ensureTemplateTable() {
    // 使用 prepare().run() 替代 exec() 以符合安全规范
    // 注意：此 SQL 是硬编码的 DDL，不包含用户输入
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS llm_session_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'default',
        source_session_id TEXT,
        messages TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      )
      .run();
    console.log("[SessionManager] 模板表已创建");
  }

  /**
   * 从模板创建会话
   * @param {string} templateId - 模板 ID
   * @param {Object} options - 选项
   * @param {string} [options.conversationId] - 对话 ID
   * @param {string} [options.title] - 会话标题
   * @returns {Promise<Object>} 新会话
   */
  async createFromTemplate(templateId, options = {}) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM llm_session_templates WHERE id = ?
      `);
      const template = stmt.get(templateId);

      if (!template) {
        throw new Error(`模板不存在: ${templateId}`);
      }

      const messages = JSON.parse(template.messages || "[]");

      // 创建新会话
      const newSession = await this.createSession({
        conversationId: options.conversationId || `template-${Date.now()}`,
        title: options.title || `来自模板: ${template.name}`,
        metadata: {
          templateId,
          templateName: template.name,
        },
      });

      // 添加模板消息
      for (const msg of messages) {
        await this.addMessage(newSession.id, msg);
      }

      // 更新模板使用次数
      const updateStmt = this.db.prepare(`
        UPDATE llm_session_templates
        SET metadata = json_set(metadata, '$.useCount', json_extract(metadata, '$.useCount') + 1),
            updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(Date.now(), templateId);

      console.log(`[SessionManager] 从模板 ${template.name} 创建会话`);
      return newSession;
    } catch (error) {
      console.error("[SessionManager] 从模板创建失败:", error);
      throw error;
    }
  }

  /**
   * 列出所有模板
   * @param {Object} options - 查询选项
   * @param {string} [options.category] - 按分类过滤
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 模板列表
   */
  async listTemplates(options = {}) {
    const { category, limit = 50 } = options;

    try {
      await this._ensureTemplateTable();

      let sql = `
        SELECT id, name, description, category, source_session_id,
               metadata, created_at, updated_at
        FROM llm_session_templates
      `;
      const params = [];

      if (category) {
        sql += " WHERE category = ?";
        params.push(category);
      }

      sql += " ORDER BY updated_at DESC LIMIT ?";
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        sourceSessionId: row.source_session_id,
        metadata: JSON.parse(row.metadata || "{}"),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error("[SessionManager] 列出模板失败:", error);
      throw error;
    }
  }

  /**
   * 删除模板
   * @param {string} templateId - 模板 ID
   * @returns {Promise<void>}
   */
  async deleteTemplate(templateId) {
    try {
      const stmt = this.db.prepare(
        "DELETE FROM llm_session_templates WHERE id = ?",
      );
      stmt.run(templateId);

      console.log(`[SessionManager] 模板已删除: ${templateId}`);
      this.emit("template-deleted", { templateId });
    } catch (error) {
      console.error("[SessionManager] 删除模板失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 批量操作
  // ============================================================

  /**
   * 批量删除会话
   * @param {string[]} sessionIds - 会话 ID 数组
   * @returns {Promise<Object>} 删除结果
   */
  async deleteMultiple(sessionIds) {
    try {
      let deleted = 0;
      let failed = 0;

      for (const sessionId of sessionIds) {
        try {
          await this.deleteSession(sessionId);
          deleted++;
        } catch (err) {
          console.warn(
            `[SessionManager] 删除会话 ${sessionId} 失败:`,
            err.message,
          );
          failed++;
        }
      }

      console.log(
        `[SessionManager] 批量删除完成: 成功 ${deleted}, 失败 ${failed}`,
      );
      return { deleted, failed };
    } catch (error) {
      console.error("[SessionManager] 批量删除失败:", error);
      throw error;
    }
  }

  /**
   * 批量添加标签
   * @param {string[]} sessionIds - 会话 ID 数组
   * @param {string[]} tags - 要添加的标签
   * @returns {Promise<Object>} 处理结果
   */
  async addTagsToMultiple(sessionIds, tags) {
    try {
      let updated = 0;

      for (const sessionId of sessionIds) {
        try {
          await this.addTags(sessionId, tags);
          updated++;
        } catch (err) {
          console.warn(
            `[SessionManager] 会话 ${sessionId} 添加标签失败:`,
            err.message,
          );
        }
      }

      console.log(`[SessionManager] 批量添加标签完成: ${updated} 个会话`);
      return { updated };
    } catch (error) {
      console.error("[SessionManager] 批量添加标签失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 高级统计
  // ============================================================

  /**
   * 获取全局统计信息
   * @returns {Promise<Object>} 统计信息
   */
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
      console.error("[SessionManager] 获取全局统计失败:", error);
      throw error;
    }
  }

  /**
   * 更新会话标题
   * @param {string} sessionId - 会话 ID
   * @param {string} title - 新标题
   * @returns {Promise<Object>} 更新后的会话
   */
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

      console.log(`[SessionManager] 会话标题已更新: ${sessionId}`);
      this.emit("session-updated", { sessionId, title });

      return session;
    } catch (error) {
      console.error("[SessionManager] 更新标题失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 会话复制
  // ============================================================

  /**
   * 复制会话
   * @param {string} sessionId - 源会话 ID
   * @param {Object} options - 复制选项
   * @param {string} [options.titleSuffix=' - 副本'] - 标题后缀
   * @param {boolean} [options.includeMessages=true] - 包含消息
   * @param {boolean} [options.includeTags=true] - 包含标签
   * @param {boolean} [options.resetMetadata=true] - 重置元数据（压缩计数、Token节省等）
   * @returns {Promise<Object>} 复制后的新会话
   */
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

      console.log(
        `[SessionManager] 会话已复制: ${sessionId} -> ${newSessionId}`,
      );
      this.emit("session-duplicated", {
        originalId: sessionId,
        newId: newSessionId,
        newSession,
      });

      return newSession;
    } catch (error) {
      console.error("[SessionManager] 复制会话失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 增强功能 - 标签管理
  // ============================================================

  /**
   * 重命名标签
   * @param {string} oldTag - 原标签名
   * @param {string} newTag - 新标签名
   * @returns {Promise<Object>} 更新结果
   */
  async renameTag(oldTag, newTag) {
    if (!oldTag || !newTag) {
      throw new Error("标签名不能为空");
    }

    if (oldTag === newTag) {
      return { updated: 0 };
    }

    try {
      // 获取所有包含该标签的会话
      const sessions = await this.findSessionsByTags([oldTag], {
        limit: 10000,
      });
      let updated = 0;

      for (const session of sessions) {
        const fullSession = await this.loadSession(session.id);
        const tags = fullSession.metadata?.tags || [];
        const tagIndex = tags.indexOf(oldTag);

        if (tagIndex !== -1) {
          // 替换标签
          tags[tagIndex] = newTag;
          // 去重
          fullSession.metadata.tags = [...new Set(tags)];
          fullSession.metadata.updatedAt = Date.now();

          // 保存
          await this.saveSession(session.id);
          updated++;
        }
      }

      console.log(
        `[SessionManager] 标签重命名: "${oldTag}" -> "${newTag}"，更新 ${updated} 个会话`,
      );
      this.emit("tag-renamed", { oldTag, newTag, updated });

      return { updated, oldTag, newTag };
    } catch (error) {
      console.error("[SessionManager] 重命名标签失败:", error);
      throw error;
    }
  }

  /**
   * 合并标签
   * @param {string[]} sourceTags - 源标签（将被删除）
   * @param {string} targetTag - 目标标签
   * @returns {Promise<Object>} 合并结果
   */
  async mergeTags(sourceTags, targetTag) {
    if (!sourceTags || sourceTags.length === 0 || !targetTag) {
      throw new Error("源标签和目标标签不能为空");
    }

    // 移除目标标签（如果在源标签中）
    const tagsToMerge = sourceTags.filter((t) => t !== targetTag);

    if (tagsToMerge.length === 0) {
      return { updated: 0, merged: 0 };
    }

    try {
      // 获取所有包含这些标签的会话
      const sessions = await this.findSessionsByTags(tagsToMerge, {
        limit: 10000,
      });
      let updated = 0;

      for (const session of sessions) {
        const fullSession = await this.loadSession(session.id);
        const tags = fullSession.metadata?.tags || [];
        let modified = false;

        // 移除源标签，添加目标标签
        const newTags = tags.filter((t) => !tagsToMerge.includes(t));
        if (!newTags.includes(targetTag)) {
          newTags.push(targetTag);
        }

        // 检查是否有变化
        if (
          newTags.length !== tags.length ||
          !newTags.every((t) => tags.includes(t))
        ) {
          fullSession.metadata.tags = newTags;
          fullSession.metadata.updatedAt = Date.now();
          await this.saveSession(session.id);
          updated++;
          modified = true;
        }
      }

      console.log(
        `[SessionManager] 标签合并: [${tagsToMerge.join(", ")}] -> "${targetTag}"，更新 ${updated} 个会话`,
      );
      this.emit("tags-merged", {
        sourceTags: tagsToMerge,
        targetTag,
        updated,
      });

      return { updated, merged: tagsToMerge.length, targetTag };
    } catch (error) {
      console.error("[SessionManager] 合并标签失败:", error);
      throw error;
    }
  }

  /**
   * 删除标签
   * @param {string} tag - 要删除的标签
   * @returns {Promise<Object>} 删除结果
   */
  async deleteTag(tag) {
    if (!tag) {
      throw new Error("标签名不能为空");
    }

    try {
      // 获取所有包含该标签的会话
      const sessions = await this.findSessionsByTags([tag], { limit: 10000 });
      let updated = 0;

      for (const session of sessions) {
        const fullSession = await this.loadSession(session.id);
        const tags = fullSession.metadata?.tags || [];
        const newTags = tags.filter((t) => t !== tag);

        if (newTags.length !== tags.length) {
          fullSession.metadata.tags = newTags;
          fullSession.metadata.updatedAt = Date.now();
          await this.saveSession(session.id);
          updated++;
        }
      }

      console.log(
        `[SessionManager] 标签已删除: "${tag}"，影响 ${updated} 个会话`,
      );
      this.emit("tag-deleted", { tag, updated });

      return { deleted: tag, updated };
    } catch (error) {
      console.error("[SessionManager] 删除标签失败:", error);
      throw error;
    }
  }

  /**
   * 批量删除标签
   * @param {string[]} tags - 要删除的标签数组
   * @returns {Promise<Object>} 删除结果
   */
  async deleteTags(tags) {
    if (!tags || tags.length === 0) {
      return { deleted: 0, updated: 0 };
    }

    try {
      let totalUpdated = 0;

      for (const tag of tags) {
        const result = await this.deleteTag(tag);
        totalUpdated += result.updated;
      }

      console.log(
        `[SessionManager] 批量删除标签: ${tags.length} 个标签，影响 ${totalUpdated} 个会话`,
      );

      return { deleted: tags.length, updated: totalUpdated };
    } catch (error) {
      console.error("[SessionManager] 批量删除标签失败:", error);
      throw error;
    }
  }

  /**
   * 获取标签详细信息（包含关联会话列表）
   * @param {string} tag - 标签名
   * @param {Object} options - 查询选项
   * @param {number} [options.limit=50] - 最大会话数量
   * @returns {Promise<Object>} 标签信息
   */
  async getTagDetails(tag, options = {}) {
    const { limit = 50 } = options;

    try {
      const sessions = await this.findSessionsByTags([tag], { limit });
      const allTags = await this.getAllTags();
      const tagInfo = allTags.find((t) => t.name === tag);

      return {
        name: tag,
        count: tagInfo?.count || sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
        })),
      };
    } catch (error) {
      console.error("[SessionManager] 获取标签详情失败:", error);
      throw error;
    }
  }
}

module.exports = {
  SessionManager,
};
