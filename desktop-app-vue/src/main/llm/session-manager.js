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
        logger.warn(
          "[SessionManager] LLM 状态总线订阅失败:",
          busError.message,
        );
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
  _shouldAutoGenerateSummary(session) {
    // 已有摘要且最近更新过，不重新生成
    if (session.metadata.summary && session.metadata.summaryGeneratedAt) {
      const timeSinceLastSummary =
        Date.now() - session.metadata.summaryGeneratedAt;
      // 如果摘要生成后消息数增加不多，不重新生成
      const messagesAfterSummary =
        session.metadata.messageCount -
        (session.metadata.messageCountAtSummary || 0);
      if (messagesAfterSummary < this.autoSummaryThreshold) {
        return false;
      }
    }

    // 消息数达到阈值才生成
    return session.messages.length >= this.autoSummaryThreshold;
  }

  /**
   * 将会话加入自动摘要队列
   * @private
   */
  _queueAutoSummary(sessionId) {
    // 避免重复加入队列
    if (!this._summaryQueue.includes(sessionId)) {
      this._summaryQueue.push(sessionId);
      logger.info(
        `[SessionManager] 会话 ${sessionId} 加入自动摘要队列，队列长度: ${this._summaryQueue.length}`,
      );
    }

    // 如果没有正在进行的摘要生成，立即处理
    if (!this._isGeneratingSummary) {
      this._processAutoSummaryQueue();
    }
  }

  /**
   * 处理自动摘要队列
   * @private
   */
  async _processAutoSummaryQueue() {
    if (this._isGeneratingSummary || this._summaryQueue.length === 0) {
      return;
    }

    this._isGeneratingSummary = true;

    while (this._summaryQueue.length > 0) {
      const sessionId = this._summaryQueue.shift();

      try {
        await this._generateAutoSummary(sessionId);
      } catch (error) {
        logger.error(
          `[SessionManager] 自动摘要生成失败 ${sessionId}:`,
          error.message,
        );
      }

      // 短暂延迟，避免过于频繁的 LLM 调用
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this._isGeneratingSummary = false;
  }

  /**
   * 生成自动摘要
   * @private
   */
  async _generateAutoSummary(sessionId) {
    try {
      const session = await this.loadSession(sessionId);

      // 再次检查是否需要生成
      if (!this._shouldAutoGenerateSummary(session)) {
        logger.info(`[SessionManager] 会话 ${sessionId} 不需要自动摘要，跳过`);
        return null;
      }

      logger.info(`[SessionManager] 开始自动生成摘要: ${sessionId}`);

      const summary = await this.generateSummary(sessionId, {
        useLLM: true,
        maxLength: 200,
      });

      // 记录摘要生成时的消息数
      session.metadata.messageCountAtSummary = session.metadata.messageCount;
      session.metadata.autoSummaryGenerated = true;
      await this.saveSession(sessionId);

      logger.info(`[SessionManager] 自动摘要完成: ${sessionId}`);
      this.emit("auto-summary-generated", { sessionId, summary });

      return summary;
    } catch (error) {
      logger.error(
        `[SessionManager] 自动摘要生成失败 ${sessionId}:`,
        error.message,
      );
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
        logger.info("[SessionManager] 消息数未超过最大限制，跳过压缩");
        return { compressed: false };
      }

      logger.info("[SessionManager] 开始压缩会话:", sessionId);

      // 🚀 Phase 3: 预压缩记忆刷新
      if (
        this.enableMemoryFlush &&
        this.permanentMemoryManager &&
        this.llmManager
      ) {
        try {
          await this.flushMemoryBeforeCompaction(sessionId);
        } catch (error) {
          logger.error("[SessionManager] 预压缩记忆刷新失败:", error.message);
          // 继续压缩流程，不因记忆刷新失败而中断
        }
      }

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

      logger.info("[SessionManager] 压缩完成:", {
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
      logger.error("[SessionManager] 压缩会话失败:", error);
      throw error;
    }
  }

  /**
   * 预压缩记忆刷新 (Phase 3)
   * 在压缩前提取重要信息并保存到 Daily Notes 和 MEMORY.md
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}
   */
  async flushMemoryBeforeCompaction(sessionId) {
    logger.info("[SessionManager] 开始预压缩记忆刷新:", sessionId);

    try {
      const session = await this.loadSession(sessionId);

      // 提取最近的消息（避免传递过多上下文）
      const recentMessages = session.messages.slice(-10);

      if (recentMessages.length === 0) {
        logger.info("[SessionManager] 没有消息需要提取记忆");
        return;
      }

      // 构建 LLM Prompt
      const extractionPrompt = this.buildMemoryExtractionPrompt(recentMessages);

      // 使用 LLM 提取重要信息
      const response = await this.llmManager.chat({
        model: "qwen2:7b", // 使用本地模型，免费
        messages: [
          {
            role: "system",
            content: `你是一个记忆提取助手。从对话中提取重要信息，分为两类：
1. **今日活动** (保存到 Daily Notes): 对话摘要、完成的任务、待办事项、技术发现
2. **长期记忆** (保存到 MEMORY.md): 用户偏好、架构决策、问题解决方案、重要配置

请以 JSON 格式返回，格式如下：
{
  "dailyNotes": "今日活动的 Markdown 内容",
  "longTermMemory": "长期记忆的 Markdown 内容",
  "shouldSave": true/false
}`,
          },
          {
            role: "user",
            content: extractionPrompt,
          },
        ],
        stream: false,
        temperature: 0.3, // 低温度，确保稳定输出
      });

      // 解析响应
      const extraction = this.parseMemoryExtraction(response.content);

      if (!extraction.shouldSave) {
        logger.info("[SessionManager] LLM 判断无需保存记忆");
        return;
      }

      // 保存到 Daily Notes
      if (extraction.dailyNotes && extraction.dailyNotes.trim()) {
        await this.permanentMemoryManager.writeDailyNote(
          extraction.dailyNotes,
          {
            append: true,
          },
        );
        logger.info("[SessionManager] Daily Notes 已更新");
      }

      // 保存到 MEMORY.md
      if (extraction.longTermMemory && extraction.longTermMemory.trim()) {
        // 根据内容判断章节
        const section = this.detectMemorySection(extraction.longTermMemory);
        await this.permanentMemoryManager.appendToMemory(
          extraction.longTermMemory,
          {
            section,
          },
        );
        logger.info(`[SessionManager] MEMORY.md 已更新 (章节: ${section})`);
      }

      logger.info("[SessionManager] 预压缩记忆刷新完成");
    } catch (error) {
      logger.error("[SessionManager] 预压缩记忆刷新失败:", error);
      throw error;
    }
  }

  /**
   * 构建记忆提取 Prompt
   * @param {Array<Object>} messages - 消息列表
   * @returns {string} Prompt 字符串
   */
  buildMemoryExtractionPrompt(messages) {
    const conversationText = messages
      .map((msg, idx) => {
        const role = msg.role === "user" ? "用户" : "AI";
        const content = msg.content.substring(0, 500); // 限制长度
        return `[${idx + 1}] ${role}: ${content}`;
      })
      .join("\n\n");

    return `请从以下对话中提取重要信息：

${conversationText}

请分析并提取：
1. **今日活动**: 对话主题、完成的任务、待办事项、技术发现
2. **长期记忆**: 用户偏好、架构决策、问题解决方案、重要配置

如果没有重要信息需要保存，请设置 shouldSave 为 false。`;
  }

  /**
   * 解析记忆提取结果
   * @param {string} content - LLM 响应内容
   * @returns {Object} 解析后的对象
   */
  parseMemoryExtraction(content) {
    try {
      // 尝试提取 JSON 代码块
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // 尝试直接解析
      const parsed = JSON.parse(content);
      return parsed;
    } catch (error) {
      logger.warn("[SessionManager] 无法解析 LLM 响应，使用简单模式");

      // 回退：简单提取
      return {
        dailyNotes: `## ${new Date().toLocaleTimeString()} - 对话记录\n\n${content.substring(0, 200)}`,
        longTermMemory: "",
        shouldSave: true,
      };
    }
  }

  /**
   * 检测记忆内容应该保存到哪个章节
   * @param {string} content - 记忆内容
   * @returns {string} 章节名称
   */
  detectMemorySection(content) {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes("偏好") || lowerContent.includes("习惯")) {
      return "🧑 用户偏好";
    }

    if (
      lowerContent.includes("决策") ||
      lowerContent.includes("架构") ||
      lowerContent.includes("设计")
    ) {
      return "🏗️ 架构决策";
    }

    if (
      lowerContent.includes("问题") ||
      lowerContent.includes("错误") ||
      lowerContent.includes("解决")
    ) {
      return "🐛 常见问题解决方案";
    }

    if (
      lowerContent.includes("发现") ||
      lowerContent.includes("技巧") ||
      lowerContent.includes("最佳")
    ) {
      return "📚 重要技术发现";
    }

    if (
      lowerContent.includes("配置") ||
      lowerContent.includes("环境") ||
      lowerContent.includes("变量")
    ) {
      return "🔧 系统配置";
    }

    // 默认章节
    return "📚 重要技术发现";
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
        metadata:
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error("[SessionManager] 列出会话失败:", error);
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
      logger.error("[SessionManager] 获取统计失败:", error);
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

      logger.info(`[SessionManager] 已清理 ${oldSessions.length} 个旧会话`);

      return oldSessions.length;
    } catch (error) {
      logger.error("[SessionManager] 清理旧会话失败:", error);
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

      logger.info(
        `[SessionManager] 搜索 "${query}" 找到 ${results.length} 个会话`,
      );
      return results.slice(0, limit);
    } catch (error) {
      logger.error("[SessionManager] 搜索会话失败:", error);
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

      logger.info(`[SessionManager] 会话 ${sessionId} 添加标签:`, newTags);
      this.emit("tags-updated", { sessionId, tags: mergedTags });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 添加标签失败:", error);
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

      logger.info(`[SessionManager] 会话 ${sessionId} 移除标签:`, tagsToRemove);
      this.emit("tags-updated", { sessionId, tags: session.metadata.tags });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 移除标签失败:", error);
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
        const metadata =
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {};
        const tags = metadata.tags || [];
        for (const tag of tags) {
          tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        }
      }

      return Array.from(tagCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error("[SessionManager] 获取标签列表失败:", error);
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
      logger.error("[SessionManager] 按标签查找失败:", error);
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

      logger.info(`[SessionManager] 导出会话 ${sessionId} 为 JSON`);
      return prettify
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);
    } catch (error) {
      logger.error("[SessionManager] 导出 JSON 失败:", error);
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

      logger.info(`[SessionManager] 导出会话 ${sessionId} 为 Markdown`);
      return md;
    } catch (error) {
      logger.error("[SessionManager] 导出 Markdown 失败:", error);
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

      logger.info(
        `[SessionManager] 导入会话成功，新会话ID: ${newSession.id}，消息数: ${importSession.messages.length}`,
      );
      this.emit("session-imported", { sessionId: newSession.id });

      return newSession;
    } catch (error) {
      logger.error("[SessionManager] 导入 JSON 失败:", error);
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

      logger.info(`[SessionManager] 批量导出 ${sessions.length} 个会话`);
      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      logger.error("[SessionManager] 批量导出失败:", error);
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

          logger.info(`[SessionManager] LLM 生成摘要: ${summary}`);
          return summary;
        } catch (llmError) {
          logger.warn(
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
      logger.error("[SessionManager] 生成摘要失败:", error);
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
          logger.warn(
            `[SessionManager] 会话 ${session.id} 摘要生成失败:`,
            err.message,
          );
        }
      }

      logger.info(
        `[SessionManager] 批量摘要完成: 处理 ${processed}, 跳过 ${skipped}`,
      );
      return { processed, skipped };
    } catch (error) {
      logger.error("[SessionManager] 批量生成摘要失败:", error);
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

      logger.info(`[SessionManager] 恢复会话: ${sessionId}`);
      this.emit("session-resumed", { sessionId });

      return result;
    } catch (error) {
      logger.error("[SessionManager] 恢复会话失败:", error);
      throw error;
    }
  }

  /**
   * 生成上下文提示
   * @private
   */
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
      logger.error("[SessionManager] 获取最近会话失败:", error);
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

      logger.info(`[SessionManager] 会话 ${sessionId} 保存为模板: ${name}`);
      this.emit("template-created", { templateId, name });

      return template;
    } catch (error) {
      // 如果表不存在，尝试创建
      if (error.message.includes("no such table")) {
        await this._ensureTemplateTable();
        return this.saveAsTemplate(sessionId, templateInfo);
      }
      logger.error("[SessionManager] 保存模板失败:", error);
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
    logger.info("[SessionManager] 模板表已创建");
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

      logger.info(`[SessionManager] 从模板 ${template.name} 创建会话`);
      return newSession;
    } catch (error) {
      logger.error("[SessionManager] 从模板创建失败:", error);
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
        metadata:
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error("[SessionManager] 列出模板失败:", error);
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

      logger.info(`[SessionManager] 模板已删除: ${templateId}`);
      this.emit("template-deleted", { templateId });
    } catch (error) {
      logger.error("[SessionManager] 删除模板失败:", error);
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
      logger.error("[SessionManager] 获取全局统计失败:", error);
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

      logger.info(`[SessionManager] 会话标题已更新: ${sessionId}`);
      this.emit("session-updated", { sessionId, title });

      return session;
    } catch (error) {
      logger.error("[SessionManager] 更新标题失败:", error);
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

      logger.info(
        `[SessionManager] 标签重命名: "${oldTag}" -> "${newTag}"，更新 ${updated} 个会话`,
      );
      this.emit("tag-renamed", { oldTag, newTag, updated });

      return { updated, oldTag, newTag };
    } catch (error) {
      logger.error("[SessionManager] 重命名标签失败:", error);
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

      logger.info(
        `[SessionManager] 标签合并: [${tagsToMerge.join(", ")}] -> "${targetTag}"，更新 ${updated} 个会话`,
      );
      this.emit("tags-merged", {
        sourceTags: tagsToMerge,
        targetTag,
        updated,
      });

      return { updated, merged: tagsToMerge.length, targetTag };
    } catch (error) {
      logger.error("[SessionManager] 合并标签失败:", error);
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

      logger.info(
        `[SessionManager] 标签已删除: "${tag}"，影响 ${updated} 个会话`,
      );
      this.emit("tag-deleted", { tag, updated });

      return { deleted: tag, updated };
    } catch (error) {
      logger.error("[SessionManager] 删除标签失败:", error);
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

      logger.info(
        `[SessionManager] 批量删除标签: ${tags.length} 个标签，影响 ${totalUpdated} 个会话`,
      );

      return { deleted: tags.length, updated: totalUpdated };
    } catch (error) {
      logger.error("[SessionManager] 批量删除标签失败:", error);
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
      logger.error("[SessionManager] 获取标签详情失败:", error);
      throw error;
    }
  }

  // ============================================================
  // 自动摘要生成 - 后台调度器
  // ============================================================

  /**
   * 启动后台摘要生成器
   * 定期检查没有摘要的会话并自动生成
   */
  startBackgroundSummaryGenerator() {
    if (this._backgroundSummaryTimer) {
      logger.info("[SessionManager] 后台摘要生成器已在运行");
      return;
    }

    logger.info(
      `[SessionManager] 启动后台摘要生成器，间隔: ${this.autoSummaryInterval}ms`,
    );

    this._backgroundSummaryTimer = setInterval(async () => {
      await this._runBackgroundSummaryGeneration();
    }, this.autoSummaryInterval);

    // 立即执行一次
    this._runBackgroundSummaryGeneration();

    this.emit("background-summary-started");
  }

  /**
   * 停止后台摘要生成器
   */
  stopBackgroundSummaryGenerator() {
    if (this._backgroundSummaryTimer) {
      clearInterval(this._backgroundSummaryTimer);
      this._backgroundSummaryTimer = null;
      logger.info("[SessionManager] 后台摘要生成器已停止");
      this.emit("background-summary-stopped");
    }
  }

  /**
   * 运行后台摘要生成
   * @private
   */
  async _runBackgroundSummaryGeneration() {
    if (!this.llmManager) {
      logger.info("[SessionManager] 无 LLM 管理器，跳过后台摘要生成");
      return;
    }

    if (this._isGeneratingSummary) {
      logger.info("[SessionManager] 摘要生成正在进行中，跳过本轮");
      return;
    }

    try {
      logger.info("[SessionManager] 开始后台摘要生成检查...");

      // 获取没有摘要的会话
      const sessionsWithoutSummary = await this.getSessionsWithoutSummary({
        limit: 10,
        minMessages: this.autoSummaryThreshold,
      });

      if (sessionsWithoutSummary.length === 0) {
        logger.info("[SessionManager] 所有会话都已有摘要");
        return;
      }

      logger.info(
        `[SessionManager] 发现 ${sessionsWithoutSummary.length} 个会话需要生成摘要`,
      );

      // 将会话加入队列
      for (const session of sessionsWithoutSummary) {
        this._queueAutoSummary(session.id);
      }

      this.emit("background-summary-queued", {
        count: sessionsWithoutSummary.length,
      });
    } catch (error) {
      logger.error("[SessionManager] 后台摘要生成失败:", error.message);
    }
  }

  /**
   * 获取没有摘要的会话列表
   * @param {Object} options - 查询选项
   * @param {number} [options.limit=50] - 最大返回数量
   * @param {number} [options.minMessages=5] - 最小消息数
   * @returns {Promise<Array>} 会话列表
   */
  async getSessionsWithoutSummary(options = {}) {
    const { limit = 50, minMessages = 5 } = options;

    try {
      const stmt = this.db.prepare(`
        SELECT id, conversation_id, title, metadata, created_at, updated_at
        FROM llm_sessions
        WHERE (
          json_extract(metadata, '$.summary') IS NULL
          OR json_extract(metadata, '$.summary') = ''
        )
        AND json_extract(metadata, '$.messageCount') >= ?
        ORDER BY updated_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(minMessages, limit);

      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        metadata:
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata || "{}")
            : row.metadata || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error("[SessionManager] 获取无摘要会话列表失败:", error);
      throw error;
    }
  }

  /**
   * 获取自动摘要配置
   * @returns {Object} 配置信息
   */
  getAutoSummaryConfig() {
    return {
      enabled: this.enableAutoSummary,
      threshold: this.autoSummaryThreshold,
      interval: this.autoSummaryInterval,
      backgroundEnabled: this.enableBackgroundSummary,
      isRunning: !!this._backgroundSummaryTimer,
      queueLength: this._summaryQueue.length,
      isGenerating: this._isGeneratingSummary,
    };
  }

  /**
   * 更新自动摘要配置
   * @param {Object} config - 新配置
   * @returns {Object} 更新后的配置
   */
  updateAutoSummaryConfig(config = {}) {
    if (typeof config.enabled === "boolean") {
      this.enableAutoSummary = config.enabled;
    }

    if (typeof config.threshold === "number" && config.threshold > 0) {
      this.autoSummaryThreshold = config.threshold;
    }

    if (typeof config.interval === "number" && config.interval >= 60000) {
      this.autoSummaryInterval = config.interval;
      // 如果后台生成器正在运行，重新启动以应用新间隔
      if (this._backgroundSummaryTimer) {
        this.stopBackgroundSummaryGenerator();
        this.startBackgroundSummaryGenerator();
      }
    }

    if (typeof config.backgroundEnabled === "boolean") {
      this.enableBackgroundSummary = config.backgroundEnabled;
      if (config.backgroundEnabled && this.llmManager) {
        this.startBackgroundSummaryGenerator();
      } else {
        this.stopBackgroundSummaryGenerator();
      }
    }

    logger.info(
      "[SessionManager] 自动摘要配置已更新:",
      this.getAutoSummaryConfig(),
    );
    this.emit("auto-summary-config-updated", this.getAutoSummaryConfig());

    return this.getAutoSummaryConfig();
  }

  /**
   * 手动触发所有会话的摘要生成
   * @param {Object} options - 选项
   * @param {boolean} [options.overwrite=false] - 是否覆盖已有摘要
   * @param {number} [options.limit=100] - 最大处理数量
   * @returns {Promise<Object>} 处理结果
   */
  async triggerBulkSummaryGeneration(options = {}) {
    const { overwrite = false, limit = 100 } = options;

    try {
      let sessions;

      if (overwrite) {
        // 获取所有会话
        sessions = await this.listSessions({ limit });
      } else {
        // 只获取没有摘要的会话
        sessions = await this.getSessionsWithoutSummary({
          limit,
          minMessages: this.autoSummaryThreshold,
        });
      }

      logger.info(
        `[SessionManager] 触发批量摘要生成: ${sessions.length} 个会话`,
      );

      // 加入队列
      for (const session of sessions) {
        this._queueAutoSummary(session.id);
      }

      this.emit("bulk-summary-triggered", { count: sessions.length });

      return {
        queued: sessions.length,
        queueLength: this._summaryQueue.length,
      };
    } catch (error) {
      logger.error("[SessionManager] 触发批量摘要生成失败:", error);
      throw error;
    }
  }

  /**
   * 获取自动摘要统计
   * @returns {Promise<Object>} 统计信息
   */
  async getAutoSummaryStats() {
    try {
      // 总会话数
      const totalStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM llm_sessions",
      );
      const totalResult = totalStmt.get();

      // 有摘要的会话数
      const withSummaryStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM llm_sessions
        WHERE json_extract(metadata, '$.summary') IS NOT NULL
        AND json_extract(metadata, '$.summary') != ''
      `);
      const withSummaryResult = withSummaryStmt.get();

      // 自动生成的摘要数
      const autoGeneratedStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM llm_sessions
        WHERE json_extract(metadata, '$.autoSummaryGenerated') = 1
      `);
      const autoGeneratedResult = autoGeneratedStmt.get();

      // 符合摘要条件的会话数
      const eligibleStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM llm_sessions
        WHERE json_extract(metadata, '$.messageCount') >= ?
      `);
      const eligibleResult = eligibleStmt.get(this.autoSummaryThreshold);

      const total = totalResult.count || 0;
      const withSummary = withSummaryResult.count || 0;
      const autoGenerated = autoGeneratedResult.count || 0;
      const eligible = eligibleResult.count || 0;

      return {
        totalSessions: total,
        withSummary,
        withoutSummary: total - withSummary,
        autoGenerated,
        manualGenerated: withSummary - autoGenerated,
        eligible,
        coverage: total > 0 ? ((withSummary / total) * 100).toFixed(1) : 0,
        eligibleCoverage:
          eligible > 0 ? ((withSummary / eligible) * 100).toFixed(1) : 0,
        config: this.getAutoSummaryConfig(),
      };
    } catch (error) {
      logger.error("[SessionManager] 获取自动摘要统计失败:", error);
      throw error;
    }
  }
}

module.exports = {
  SessionManager,
  _deps,
};
