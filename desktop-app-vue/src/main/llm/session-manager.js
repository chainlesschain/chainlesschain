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

const { logger } = require("../utils/logger.js");
const _fsPromises = require("fs").promises;
const path = require("path");

// _deps allows tests to inject mocks for CJS interop (vi.mock('fs') doesn't
// intercept require() in Vitest's forks pool for inlined CJS modules)
const _deps = { fs: _fsPromises };
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const { PromptCompressor } = require("./prompt-compressor");
const _mixin_summary = require("./session-manager-summary");
const _mixin_compression = require("./session-manager-compression");
const _mixin_queryStats = require("./session-manager-queryStats");
const _mixin_tags = require("./session-manager-tags");
const _mixin_exportImport = require("./session-manager-exportImport");
const _mixin_templates = require("./session-manager-templates");
const _mixin_bulkMisc = require("./session-manager-bulkMisc");

/**
 * SessionManager 类
 */
class SessionManager extends EventEmitter {
  /**
   * 创建会话管理器
   * @param {Object} options - 配置选项
   * @param {Object} options.database - 数据库实例
   * @param {Object} options.llmManager - LLM 管理器实例（用于智能总结）
   * @param {Object} [options.permanentMemoryManager] - 永久记忆管理器实例（Phase 3）
   * @param {string} options.sessionsDir - 会话存储目录
   * @param {number} [options.maxHistoryMessages=10] - 最大历史消息数
   * @param {number} [options.compressionThreshold=10] - 触发压缩的消息数阈值
   * @param {boolean} [options.enableAutoSave=true] - 启用自动保存
   * @param {boolean} [options.enableCompression=true] - 启用智能压缩
   * @param {boolean} [options.enableAutoSummary=true] - 启用自动摘要生成
   * @param {number} [options.autoSummaryThreshold=5] - 触发自动摘要的消息数阈值
   * @param {number} [options.autoSummaryInterval=300000] - 后台自动摘要检查间隔（毫秒，默认5分钟）
   * @param {boolean} [options.enableBackgroundSummary=true] - 启用后台摘要生成
   * @param {boolean} [options.enableMemoryFlush=true] - 启用预压缩记忆刷新（Phase 3）
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[SessionManager] database 参数是必需的");
    }

    this.db = options.database;
    this.llmManager = options.llmManager || null;
    this.permanentMemoryManager = options.permanentMemoryManager || null;
    this.sessionsDir =
      options.sessionsDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "sessions");
    this.maxHistoryMessages = options.maxHistoryMessages || 10;
    this.compressionThreshold = options.compressionThreshold || 10;
    this.enableAutoSave = options.enableAutoSave !== false;
    this.enableCompression = options.enableCompression !== false;

    // 自动摘要配置
    this.enableAutoSummary = options.enableAutoSummary !== false;
    this.autoSummaryThreshold = options.autoSummaryThreshold || 5;
    this.autoSummaryInterval = options.autoSummaryInterval || 5 * 60 * 1000; // 默认5分钟
    this.enableBackgroundSummary = options.enableBackgroundSummary !== false;

    // 预压缩记忆刷新配置 (Phase 3)
    this.enableMemoryFlush = options.enableMemoryFlush !== false;

    // 后台任务状态
    this._backgroundSummaryTimer = null;
    this._isGeneratingSummary = false;
    this._summaryQueue = [];

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

    // L1: 订阅 LLM 状态总线 — provider/model 切换时清空内存缓存
    this._stateBusSubscriptions = [];
    if (options.enableStateBus !== false) {
      try {
        const { getLLMStateBus, Events } = require("./llm-state-bus");
        const bus = getLLMStateBus();
        const onProviderChange = (payload) => {
          logger.info(
            "[SessionManager] LLM provider/model 变更,清空内存缓存",
            payload,
          );
          this.sessionCache.clear();
          this.emit("cache-invalidated", { reason: "provider-change" });
        };
        const onAllInvalidated = (payload) => {
          logger.info("[SessionManager] 全局失效,清空所有缓存", payload);
          this.sessionCache.clear();
          this.emit("cache-invalidated", { reason: "all-invalidated" });
        };
        const onSessionInvalidated = (payload) => {
          if (payload && payload.sessionId) {
            this.sessionCache.delete(payload.sessionId);
          }
        };
        bus.on(Events.PROVIDER_CHANGED, onProviderChange);
        bus.on(Events.MODEL_SWITCHED, onProviderChange);
        bus.on(Events.ALL_INVALIDATED, onAllInvalidated);
        bus.on(Events.SESSION_INVALIDATED, onSessionInvalidated);
        this._stateBusSubscriptions.push(
          [Events.PROVIDER_CHANGED, onProviderChange],
          [Events.MODEL_SWITCHED, onProviderChange],
          [Events.ALL_INVALIDATED, onAllInvalidated],
          [Events.SESSION_INVALIDATED, onSessionInvalidated],
        );
      } catch (busError) {
        logger.warn("[SessionManager] LLM 状态总线订阅失败:", busError.message);
      }
    }

    logger.info("[SessionManager] 初始化完成", {
      会话目录: this.sessionsDir,
      最大消息数: this.maxHistoryMessages,
      压缩阈值: this.compressionThreshold,
      自动保存: this.enableAutoSave,
      智能压缩: this.enableCompression,
      自动摘要: this.enableAutoSummary,
      摘要阈值: this.autoSummaryThreshold,
      后台摘要: this.enableBackgroundSummary,
      记忆刷新: this.enableMemoryFlush,
      永久记忆: !!this.permanentMemoryManager,
    });
  }

  /**
   * 初始化（确保目录存在）
   */
  async initialize() {
    try {
      await _deps.fs.mkdir(this.sessionsDir, { recursive: true });
      logger.info("[SessionManager] 会话目录已创建:", this.sessionsDir);

      // 启动后台摘要生成器
      if (this.enableBackgroundSummary && this.llmManager) {
        this.startBackgroundSummaryGenerator();
      }
    } catch (error) {
      logger.error("[SessionManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 销毁实例（清理后台任务）
   */
  destroy() {
    this.stopBackgroundSummaryGenerator();
    this.sessionCache.clear();

    // L1: 解绑状态总线订阅
    if (this._stateBusSubscriptions && this._stateBusSubscriptions.length > 0) {
      try {
        const { getLLMStateBus } = require("./llm-state-bus");
        const bus = getLLMStateBus();
        for (const [event, handler] of this._stateBusSubscriptions) {
          bus.off(event, handler);
        }
      } catch (_unbindError) {
        /* ignore */
      }
      this._stateBusSubscriptions = [];
    }

    logger.info("[SessionManager] 实例已销毁");
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

      logger.info("[SessionManager] 会话已创建:", sessionId);
      this.emit("session-created", session);

      return session;
    } catch (error) {
      logger.error("[SessionManager] 创建会话失败:", error);
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
        logger.info("[SessionManager] 从缓存加载会话:", sessionId);
        return this.sessionCache.get(sessionId);
      }

      // 2. 尝试从文件加载
      if (fromFile) {
        try {
          const session = await this.loadSessionFromFile(sessionId);
          this.sessionCache.set(sessionId, session);
          return session;
        } catch (fileError) {
          logger.warn("[SessionManager] 从文件加载失败，尝试从数据库加载");
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
        metadata:
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {},
      };

      // 缓存
      this.sessionCache.set(sessionId, session);

      logger.info("[SessionManager] 从数据库加载会话:", sessionId);
      return session;
    } catch (error) {
      logger.error("[SessionManager] 加载会话失败:", error);
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
        logger.info("[SessionManager] 消息数达到阈值，触发压缩");
        await this.compressSession(sessionId);
      }

      // 自动保存
      if (this.enableAutoSave) {
        await this.saveSession(sessionId);
      }

      // 检查是否需要自动生成摘要
      if (this.enableAutoSummary && this._shouldAutoGenerateSummary(session)) {
        // 异步生成摘要，不阻塞消息添加
        this._queueAutoSummary(sessionId);
      }

      this.emit("message-added", { sessionId, message });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 添加消息失败:", error);
      throw error;
    }
  }

  /**
   * 检查是否应该自动生成摘要
   * @private
   */

  /**
   * 将会话加入自动摘要队列
   * @private
   */

  /**
   * 处理自动摘要队列
   * @private
   */

  /**
   * 生成自动摘要
   * @private
   */

  /**
   * 压缩会话历史
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 压缩结果
   */

  /**
   * 预压缩记忆刷新 (Phase 3)
   * 在压缩前提取重要信息并保存到 Daily Notes 和 MEMORY.md
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}
   */

  /**
   * 构建记忆提取 Prompt
   * @param {Array<Object>} messages - 消息列表
   * @returns {string} Prompt 字符串
   */

  /**
   * 解析记忆提取结果
   * @param {string} content - LLM 响应内容
   * @returns {Object} 解析后的对象
   */

  /**
   * 检测记忆内容应该保存到哪个章节
   * @param {string} content - 记忆内容
   * @returns {string} 章节名称
   */

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
        logger.error("[SessionManager] 保存文件失败:", err);
      });

      logger.info("[SessionManager] 会话已保存:", sessionId);
    } catch (error) {
      logger.error("[SessionManager] 保存会话失败:", error);
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
      await _deps.fs.writeFile(
        filePath,
        JSON.stringify(session, null, 2),
        "utf-8",
      );
    } catch (error) {
      logger.error("[SessionManager] 保存文件失败:", error);
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
      const content = await _deps.fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      logger.error("[SessionManager] 从文件加载失败:", error);
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
        logger.info("[SessionManager] 返回压缩后的消息");
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
      logger.error("[SessionManager] 获取有效消息失败:", error);
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
        await _deps.fs.unlink(filePath);
      } catch (fileError) {
        logger.warn(
          "[SessionManager] 删除文件失败（可能不存在）:",
          fileError.message,
        );
      }

      logger.info("[SessionManager] 会话已删除:", sessionId);
      this.emit("session-deleted", { sessionId });
    } catch (error) {
      logger.error("[SessionManager] 删除会话失败:", error);
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

  /**
   * 获取会话统计
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 统计信息
   */

  /**
   * 清理旧会话（超过指定天数）
   * @param {number} daysToKeep - 保留天数
   * @returns {Promise<number>} 删除的会话数
   */

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

  /**
   * 解析数据库行为会话对象
   * @private
   */
  _parseSessionRow(row) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      title: row.title,
      metadata:
        typeof row.metadata === "string"
          ? JSON.parse(row.metadata || "{}")
          : row.metadata || {},
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

  /**
   * 从会话移除标签
   * @param {string} sessionId - 会话 ID
   * @param {string|string[]} tags - 要移除的标签
   * @returns {Promise<Object>} 更新后的会话
   */

  /**
   * 获取所有使用过的标签
   * @returns {Promise<Array>} 标签列表（带使用次数）
   */

  /**
   * 按标签查找会话
   * @param {string[]} tags - 标签数组
   * @param {Object} options - 查询选项
   * @param {string} [options.matchMode='any'] - 匹配模式：'any'(任意) 或 'all'(全部)
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 会话列表
   */

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

  /**
   * 导出会话为 Markdown
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 导出选项
   * @param {boolean} [options.includeTimestamp=true] - 包含时间戳
   * @param {boolean} [options.includeMetadata=false] - 包含元数据
   * @returns {Promise<string>} Markdown 字符串
   */

  /**
   * 从 JSON 导入会话
   * @param {string} jsonData - JSON 字符串
   * @param {Object} options - 导入选项
   * @param {boolean} [options.generateNewId=true] - 生成新的会话 ID
   * @param {string} [options.conversationId] - 指定对话 ID
   * @returns {Promise<Object>} 导入的会话
   */

  /**
   * 批量导出会话
   * @param {string[]} sessionIds - 会话 ID 数组
   * @param {Object} options - 导出选项
   * @returns {Promise<string>} JSON 字符串
   */

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

  /**
   * 批量生成摘要
   * @param {Object} options - 选项
   * @param {boolean} [options.overwrite=false] - 覆盖已有摘要
   * @param {number} [options.limit=50] - 最多处理数量
   * @returns {Promise<Object>} 处理结果
   */

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

  /**
   * 生成上下文提示
   * @private
   */

  /**
   * 获取最近的会话（用于快速续接）
   * @param {number} count - 数量
   * @returns {Promise<Array>} 最近的会话列表
   */

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

  /**
   * 确保模板表存在
   * @private
   */

  /**
   * 从模板创建会话
   * @param {string} templateId - 模板 ID
   * @param {Object} options - 选项
   * @param {string} [options.conversationId] - 对话 ID
   * @param {string} [options.title] - 会话标题
   * @returns {Promise<Object>} 新会话
   */

  /**
   * 列出所有模板
   * @param {Object} options - 查询选项
   * @param {string} [options.category] - 按分类过滤
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 模板列表
   */

  /**
   * 删除模板
   * @param {string} templateId - 模板 ID
   * @returns {Promise<void>}
   */

  // ============================================================
  // 增强功能 - 批量操作
  // ============================================================

  /**
   * 批量删除会话
   * @param {string[]} sessionIds - 会话 ID 数组
   * @returns {Promise<Object>} 删除结果
   */

  /**
   * 批量添加标签
   * @param {string[]} sessionIds - 会话 ID 数组
   * @param {string[]} tags - 要添加的标签
   * @returns {Promise<Object>} 处理结果
   */

  // ============================================================
  // 增强功能 - 高级统计
  // ============================================================

  /**
   * 获取全局统计信息
   * @returns {Promise<Object>} 统计信息
   */

  /**
   * 更新会话标题
   * @param {string} sessionId - 会话 ID
   * @param {string} title - 新标题
   * @returns {Promise<Object>} 更新后的会话
   */

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

  // ============================================================
  // 增强功能 - 标签管理
  // ============================================================

  /**
   * 重命名标签
   * @param {string} oldTag - 原标签名
   * @param {string} newTag - 新标签名
   * @returns {Promise<Object>} 更新结果
   */

  /**
   * 合并标签
   * @param {string[]} sourceTags - 源标签（将被删除）
   * @param {string} targetTag - 目标标签
   * @returns {Promise<Object>} 合并结果
   */

  /**
   * 删除标签
   * @param {string} tag - 要删除的标签
   * @returns {Promise<Object>} 删除结果
   */

  /**
   * 批量删除标签
   * @param {string[]} tags - 要删除的标签数组
   * @returns {Promise<Object>} 删除结果
   */

  /**
   * 获取标签详细信息（包含关联会话列表）
   * @param {string} tag - 标签名
   * @param {Object} options - 查询选项
   * @param {number} [options.limit=50] - 最大会话数量
   * @returns {Promise<Object>} 标签信息
   */

  // ============================================================
  // 自动摘要生成 - 后台调度器
  // ============================================================

  /**
   * 启动后台摘要生成器
   * 定期检查没有摘要的会话并自动生成
   */

  /**
   * 停止后台摘要生成器
   */

  /**
   * 运行后台摘要生成
   * @private
   */

  /**
   * 获取没有摘要的会话列表
   * @param {Object} options - 查询选项
   * @param {number} [options.limit=50] - 最大返回数量
   * @param {number} [options.minMessages=5] - 最小消息数
   * @returns {Promise<Array>} 会话列表
   */

  /**
   * 获取自动摘要配置
   * @returns {Object} 配置信息
   */

  /**
   * 更新自动摘要配置
   * @param {Object} config - 新配置
   * @returns {Object} 更新后的配置
   */

  /**
   * 手动触发所有会话的摘要生成
   * @param {Object} options - 选项
   * @param {boolean} [options.overwrite=false] - 是否覆盖已有摘要
   * @param {number} [options.limit=100] - 最大处理数量
   * @returns {Promise<Object>} 处理结果
   */

  /**
   * 获取自动摘要统计
   * @returns {Promise<Object>} 统计信息
   */
}

// Attach the per-domain method groups onto the prototype. Splitting the 2600-line
// class into mixins keeps `this` + cross-method calls intact (all land on one prototype).
Object.assign(
  SessionManager.prototype,
  _mixin_summary,
  _mixin_compression,
  _mixin_queryStats,
  _mixin_tags,
  _mixin_exportImport,
  _mixin_templates,
  _mixin_bulkMisc,
);

module.exports = {
  SessionManager,
  _deps,
};
