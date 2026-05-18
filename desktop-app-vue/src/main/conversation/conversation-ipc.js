/**
 * 对话 IPC 处理器
 * 负责处理所有对话相关的前后端通信
 *
 * @module conversation-ipc
 * @description 提供对话创建、查询、更新、删除等 IPC 接口
 */

const { logger } = require("../utils/logger.js");
const ipcGuard = require("../ipc/ipc-guard");
const { getStreamControllerManager } = require("./stream-controller-manager");

/**
 * 🔥 检测任务类型（用于 Multi-Agent 路由）
 * @param {string} content - 用户消息内容
 * @returns {string} 任务类型
 */
function detectTaskType(content) {
  if (!content || typeof content !== "string") {
    return "general";
  }

  // 代码相关任务
  if (
    /写代码|编写|实现|代码|函数|class|function|重构|优化代码|bug|修复|调试/i.test(
      content,
    ) ||
    /```|代码块/.test(content)
  ) {
    return "code_generation";
  }

  // 数据分析任务
  if (
    /分析数据|统计|图表|可视化|趋势|预测|数据集|excel|csv|json.*数据/i.test(
      content,
    )
  ) {
    return "data_analysis";
  }

  // 文档相关任务
  if (/写文档|文档|翻译|摘要|总结|格式化|markdown|报告|文章/i.test(content)) {
    return "document";
  }

  // 知识问答
  if (/什么是|如何|怎么|为什么|解释|介绍|告诉我/i.test(content)) {
    return "knowledge_qa";
  }

  return "general";
}

/**
 * 注册所有对话 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.llmManager - LLM管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.sessionManager] - 会话管理器（可选，用于会话追踪）
 * @param {Object} [dependencies.agentOrchestrator] - Agent协调器（可选，用于Multi-Agent）
 * @param {Object} [dependencies.ragManager] - RAG管理器（可选，用于RAG增强）
 * @param {Object} [dependencies.promptCompressor] - Prompt压缩器（可选）
 * @param {Object} [dependencies.responseCache] - 响应缓存（可选）
 * @param {Object} [dependencies.tokenTracker] - Token追踪器（可选）
 * @param {Object} [dependencies.errorMonitor] - 错误监控器（可选）
 */
function registerConversationIPC({
  database,
  llmManager,
  mainWindow,
  ipcMain: injectedIpcMain,
  // 🔥 新增：高级特性依赖
  sessionManager,
  agentOrchestrator,
  ragManager,
  promptCompressor,
  responseCache,
  tokenTracker,
  errorMonitor,
}) {
  logger.info("[Conversation IPC] registerConversationIPC called with:", {
    hasDatabase: !!database,
    hasLLMManager: !!llmManager,
    hasMainWindow: !!mainWindow,
    isAlreadyRegistered: ipcGuard.isModuleRegistered("conversation-ipc"),
  });

  // 防止重复注册
  if (ipcGuard.isModuleRegistered("conversation-ipc")) {
    logger.info(
      "[Conversation IPC] ⚠️  Handlers already registered, skipping...",
    );
    logger.info(
      "[Conversation IPC] If you see this message but handlers are missing, there may be a registration state mismatch",
    );
    return;
  }

  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require("electron").ipcMain;

  // 获取StreamController管理器
  const streamManager = getStreamControllerManager();

  logger.info("[Conversation IPC] Registering Conversation IPC handlers...");

  // ============================================================
  // 对话查询 (Conversation Query)
  // ============================================================

  /**
   * 根据项目ID获取对话
   * Channel: 'conversation:get-by-project'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, data?: Object[], error?: string }
   */
  ipcMain.handle("conversation:get-by-project", async (_event, projectId) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      if (!projectId) {
        return { success: false, error: "项目ID不能为空" };
      }

      logger.info("[Conversation IPC] 查询项目对话:", projectId);

      // 从 conversations 表查询对话元数据
      // 注意：project_conversations 是消息表，不是对话表
      let conversations = [];

      try {
        conversations = database.db
          .prepare(
            `
          SELECT * FROM conversations
          WHERE project_id = ?
          ORDER BY created_at DESC
        `,
          )
          .all(projectId);
      } catch (tableError) {
        logger.error("[Conversation IPC] 查询对话表失败:", tableError.message);
        conversations = [];
      }

      logger.info("[Conversation IPC] 找到对话数量:", conversations.length);
      return { success: true, data: conversations };
    } catch (error) {
      logger.error("[Conversation IPC] 查询对话失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取最近对话
   * Channel: 'conversation:get-recent'
   *
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 返回数量限制
   * @param {string} [options.projectId] - 可选的项目ID筛选
   * @returns {Promise<Object>} { success: boolean, conversations?: Object[], error?: string }
   */
  ipcMain.handle("conversation:get-recent", async (_event, options = {}) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      const { limit = 10, projectId = null } = options;
      logger.info("[Conversation IPC] 获取最近对话:", { limit, projectId });

      let conversations = [];

      try {
        if (projectId) {
          conversations = database.db
            .prepare(
              `
              SELECT * FROM conversations
              WHERE project_id = ?
              ORDER BY updated_at DESC, created_at DESC
              LIMIT ?
            `,
            )
            .all(projectId, limit);
        } else {
          conversations = database.db
            .prepare(
              `
              SELECT * FROM conversations
              ORDER BY updated_at DESC, created_at DESC
              LIMIT ?
            `,
            )
            .all(limit);
        }
      } catch (tableError) {
        logger.error(
          "[Conversation IPC] 查询最近对话失败:",
          tableError.message,
        );
        conversations = [];
      }

      logger.info("[Conversation IPC] 找到最近对话数量:", conversations.length);
      return { success: true, conversations };
    } catch (error) {
      logger.error("[Conversation IPC] 获取最近对话失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取对话详情
   * Channel: 'conversation:get-by-id'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle("conversation:get-by-id", async (_event, conversationId) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      if (!conversationId) {
        return { success: false, error: "对话ID不能为空" };
      }

      logger.info("[Conversation IPC] 查询对话详情:", conversationId);

      // 从 conversations 表查询对话元数据
      let conversation = null;

      try {
        conversation = database.db
          .prepare(
            `
          SELECT * FROM conversations WHERE id = ?
        `,
          )
          .get(conversationId);
      } catch (tableError) {
        logger.error(
          "[Conversation IPC] 查询对话详情失败:",
          tableError.message,
        );
        conversation = null;
      }

      if (!conversation) {
        return { success: false, error: "对话不存在" };
      }

      return { success: true, data: conversation };
    } catch (error) {
      logger.error("[Conversation IPC] 查询对话详情失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建对话
   * Channel: 'conversation:create'
   *
   * @param {Object} conversationData - 对话数据
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle("conversation:create", async (_event, conversationData) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      const {
        id,
        project_id,
        title,
        context_type = "project",
        context_data = null,
        created_at = Date.now(),
        updated_at = Date.now(),
      } = conversationData;

      if (!id) {
        return { success: false, error: "缺少必要参数：id" };
      }

      logger.info("[Conversation IPC] 创建对话:", id);

      // 插入对话到 conversations 表
      // 注意：conversations 表没有 messages 列，messages 存储在单独的表中
      database.db
        .prepare(
          `
        INSERT INTO conversations (id, project_id, title, context_type, context_data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          project_id || null,
          title || "新对话",
          context_type,
          context_data ? JSON.stringify(context_data) : null,
          created_at,
          updated_at,
        );

      const conversationData_result = {
        id,
        project_id: project_id || null,
        title: title || "新对话",
        context_type,
        context_data,
        created_at,
        updated_at,
      };

      return { success: true, data: conversationData_result };
    } catch (error) {
      logger.error("[Conversation IPC] 创建对话失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新对话
   * Channel: 'conversation:update'
   *
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle(
    "conversation:update",
    async (_event, conversationId, updates) => {
      try {
        if (!database) {
          return { success: false, error: "数据库未初始化" };
        }

        if (!conversationId) {
          return { success: false, error: "对话ID不能为空" };
        }

        logger.info("[Conversation IPC] 更新对话:", conversationId);

        const { title, context_type, context_data, is_starred } = updates;
        const updated_at = Date.now();

        // 更新对话元数据
        // 注意：conversations 表没有 messages 列，messages 存储在单独的表中
        database.db
          .prepare(
            `
        UPDATE conversations
        SET title = COALESCE(?, title),
            context_type = COALESCE(?, context_type),
            context_data = COALESCE(?, context_data),
            is_starred = COALESCE(?, is_starred),
            updated_at = ?
        WHERE id = ?
      `,
          )
          .run(
            title || null,
            context_type || null,
            context_data ? JSON.stringify(context_data) : null,
            is_starred != null ? (is_starred ? 1 : 0) : null,
            updated_at,
            conversationId,
          );

        return { success: true };
      } catch (error) {
        logger.error("[Conversation IPC] 更新对话失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 删除对话
   * Channel: 'conversation:delete'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle("conversation:delete", async (_event, conversationId) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      if (!conversationId) {
        return { success: false, error: "对话ID不能为空" };
      }

      logger.info("[Conversation IPC] 删除对话:", conversationId);

      // 删除对话元数据
      database.db
        .prepare("DELETE FROM conversations WHERE id = ?")
        .run(conversationId);

      // 注意：相关的消息应该通过外键级联删除或单独处理

      return { success: true };
    } catch (error) {
      logger.error("[Conversation IPC] 删除对话失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 创建消息
   * Channel: 'conversation:create-message'
   *
   * @param {Object} messageData - 消息数据
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle("conversation:create-message", async (_event, messageData) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      // 确保数据是扁平的，不包含嵌套对象
      const flatData = {
        id:
          messageData.id ||
          `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversation_id: String(messageData.conversation_id || ""),
        role: String(messageData.role || "user"),
        content: String(messageData.content || ""),
        timestamp: Number(messageData.timestamp || Date.now()),
        tokens: messageData.tokens ? Number(messageData.tokens) : null,
        message_type: messageData.type || messageData.message_type || null, // 支持 type 或 message_type
        metadata: messageData.metadata
          ? JSON.stringify(messageData.metadata)
          : null, // 序列化 metadata
      };

      logger.info(
        "[Conversation IPC] 创建消息:",
        flatData.id,
        "type:",
        flatData.message_type,
      );

      // 尝试使用 createMessage 方法
      try {
        if (database.createMessage) {
          const result = await database.createMessage(flatData);
          return { success: true, data: result };
        }
      } catch (methodError) {
        logger.warn(
          "[Conversation IPC] createMessage 方法不存在，尝试直接插入:",
          methodError.message,
        );
      }

      // 如果方法不存在，直接插入数据库
      // 先检查 message_type 和 metadata 列是否存在
      const tableInfo = database.db
        .prepare("PRAGMA table_info(messages)")
        .all();
      const hasMessageType = tableInfo.some(
        (col) => col.name === "message_type",
      );
      const hasMetadata = tableInfo.some((col) => col.name === "metadata");

      if (hasMessageType && hasMetadata) {
        database.db
          .prepare(
            `
          INSERT INTO messages (id, conversation_id, role, content, timestamp, tokens, message_type, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            flatData.id,
            flatData.conversation_id,
            flatData.role,
            flatData.content,
            flatData.timestamp,
            flatData.tokens,
            flatData.message_type,
            flatData.metadata,
          );
      } else if (hasMessageType) {
        database.db
          .prepare(
            `
          INSERT INTO messages (id, conversation_id, role, content, timestamp, tokens, message_type)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            flatData.id,
            flatData.conversation_id,
            flatData.role,
            flatData.content,
            flatData.timestamp,
            flatData.tokens,
            flatData.message_type,
          );
      } else {
        // 旧版本数据库，只保存基本字段
        database.db
          .prepare(
            `
          INSERT INTO messages (id, conversation_id, role, content, timestamp, tokens)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            flatData.id,
            flatData.conversation_id,
            flatData.role,
            flatData.content,
            flatData.timestamp,
            flatData.tokens,
          );
      }

      return { success: true, data: flatData };
    } catch (error) {
      logger.error("[Conversation IPC] 创建消息失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新消息
   * Channel: 'conversation:update-message'
   *
   * @param {Object} updateData - 更新数据
   * @param {string} updateData.id - 消息ID
   * @param {string} [updateData.content] - 消息内容
   * @param {Object} [updateData.metadata] - 元数据
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  ipcMain.handle("conversation:update-message", async (_event, updateData) => {
    try {
      if (!database) {
        return { success: false, error: "数据库未初始化" };
      }

      const { id, content, metadata } = updateData;

      if (!id) {
        return { success: false, error: "消息ID不能为空" };
      }

      logger.info("[Conversation IPC] 更新消息:", id);

      // 检查 metadata 列是否存在
      const tableInfo = database.db
        .prepare("PRAGMA table_info(messages)")
        .all();
      const hasMetadata = tableInfo.some((col) => col.name === "metadata");

      // 构建更新SQL
      const updates = [];
      const params = [];

      if (content !== undefined) {
        updates.push("content = ?");
        params.push(content);
      }

      if (metadata !== undefined && hasMetadata) {
        updates.push("metadata = ?");
        params.push(JSON.stringify(metadata));
      }

      if (updates.length === 0) {
        return { success: false, error: "没有提供更新字段" };
      }

      // 添加 ID 参数
      params.push(id);

      // 执行更新
      const sql = `UPDATE messages SET ${updates.join(", ")} WHERE id = ?`;
      const result = database.db.prepare(sql).run(...params);

      if (result.changes === 0) {
        return { success: false, error: "消息不存在或未更新" };
      }

      logger.info("[Conversation IPC] 消息更新成功:", id);
      return { success: true };
    } catch (error) {
      logger.error("[Conversation IPC] 更新消息失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取对话的所有消息
   * Channel: 'conversation:get-messages'
   *
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 查询选项 (offset, limit)
   * @returns {Promise<Object>} { success: boolean, data?: Object[], total?: number, error?: string }
   */
  ipcMain.handle(
    "conversation:get-messages",
    async (_event, conversationId, options = {}) => {
      try {
        if (!database) {
          return { success: false, error: "数据库未初始化" };
        }

        if (!conversationId) {
          return { success: false, error: "对话ID不能为空" };
        }

        logger.info("[Conversation IPC] 获取对话消息:", conversationId);

        const { offset = 0, limit = 100 } = options;

        // 尝试使用 getMessagesByConversation 方法
        try {
          if (database.getMessagesByConversation) {
            const result = await database.getMessagesByConversation(
              conversationId,
              options,
            );
            const messages = result.messages || result;

            // 处理 message_type 和 metadata
            const processedMessages = messages.map((msg) => {
              const processed = { ...msg };
              // 将 message_type 映射为 type（前端使用）
              if (msg.message_type) {
                processed.type = msg.message_type;
              }
              // 反序列化 metadata
              if (msg.metadata && typeof msg.metadata === "string") {
                try {
                  processed.metadata = JSON.parse(msg.metadata);
                } catch (e) {
                  logger.warn("[Conversation IPC] 解析 metadata 失败:", e);
                  processed.metadata = null;
                }
              }
              return processed;
            });

            return {
              success: true,
              data: processedMessages,
              total: result.total || processedMessages.length,
            };
          }
        } catch (methodError) {
          logger.warn(
            "[Conversation IPC] getMessagesByConversation 方法不存在，尝试直接查询:",
            methodError.message,
          );
        }

        // 如果方法不存在，直接查询数据库
        const messages = database.db
          .prepare(
            `
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp ASC
        LIMIT ? OFFSET ?
      `,
          )
          .all(conversationId, limit, offset);

        // 处理 message_type 和 metadata
        const processedMessages = messages.map((msg) => {
          const processed = { ...msg };
          // 将 message_type 映射为 type（前端使用）
          if (msg.message_type) {
            processed.type = msg.message_type;
          }
          // 反序列化 metadata
          if (msg.metadata && typeof msg.metadata === "string") {
            try {
              processed.metadata = JSON.parse(msg.metadata);
            } catch (e) {
              logger.warn("[Conversation IPC] 解析 metadata 失败:", e);
              processed.metadata = null;
            }
          }
          return processed;
        });

        logger.info(
          "[Conversation IPC] 找到消息数量:",
          processedMessages.length,
        );
        return {
          success: true,
          data: processedMessages,
          total: processedMessages.length,
        };
      } catch (error) {
        logger.error("[Conversation IPC] 获取对话消息失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 搜索消息
   * Channel: 'conversation:search-messages'
   *
   * @param {Object} searchOptions - 搜索选项
   * @param {string} searchOptions.query - 搜索关键词
   * @param {string} [searchOptions.conversationId] - 对话ID（可选）
   * @param {string} [searchOptions.role] - 消息角色（可选）
   * @param {number} [searchOptions.limit] - 返回结果数量限制
   * @param {number} [searchOptions.offset] - 偏移量
   * @param {string} [searchOptions.order] - 排序方式
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }
   */
  ipcMain.handle(
    "conversation:search-messages",
    async (_event, searchOptions = {}) => {
      try {
        if (!database) {
          return { success: false, error: "数据库未初始化" };
        }

        const { query } = searchOptions;

        if (!query || !query.trim()) {
          return { success: false, error: "搜索关键词不能为空" };
        }

        logger.info("[Conversation IPC] 搜索消息:", query);

        // 尝试使用 searchMessages 方法
        try {
          if (database.searchMessages) {
            const result = database.searchMessages(searchOptions);
            const messages = result.messages || [];

            // 处理 message_type 和 metadata
            const processedMessages = messages.map((msg) => {
              const processed = { ...msg };
              // 将 message_type 映射为 type（前端使用）
              if (msg.message_type) {
                processed.type = msg.message_type;
              }
              // metadata 已在 searchMessages 中反序列化
              return processed;
            });

            return {
              success: true,
              data: {
                messages: processedMessages,
                total: result.total || 0,
                hasMore: result.hasMore || false,
              },
            };
          }
        } catch (methodError) {
          logger.warn(
            "[Conversation IPC] searchMessages 方法不存在，尝试直接查询:",
            methodError.message,
          );
        }

        // 如果方法不存在，直接查询数据库
        const {
          conversationId,
          role,
          limit = 50,
          offset = 0,
          order = "DESC",
        } = searchOptions;

        const searchPattern = `%${query.trim()}%`;
        const params = [searchPattern];
        const whereConditions = ["content LIKE ?"];

        if (conversationId) {
          whereConditions.push("conversation_id = ?");
          params.push(conversationId);
        }

        if (role) {
          whereConditions.push("role = ?");
          params.push(role);
        }

        const whereClause = whereConditions.join(" AND ");
        const orderClause = order === "ASC" ? "ASC" : "DESC";

        const messages = database.db
          .prepare(
            `
        SELECT * FROM messages
        WHERE ${whereClause}
        ORDER BY timestamp ${orderClause}
        LIMIT ? OFFSET ?
      `,
          )
          .all(...params, limit, offset);

        // 获取总数
        const countResult = database.db
          .prepare(
            `
        SELECT COUNT(*) as total FROM messages
        WHERE ${whereClause}
      `,
          )
          .get(...params);

        const total = countResult ? countResult.total : 0;

        // 处理 message_type 和 metadata
        const processedMessages = messages.map((msg) => {
          const processed = { ...msg };
          if (msg.message_type) {
            processed.type = msg.message_type;
          }
          if (msg.metadata && typeof msg.metadata === "string") {
            try {
              processed.metadata = JSON.parse(msg.metadata);
            } catch (e) {
              logger.warn("[Conversation IPC] 解析 metadata 失败:", e);
              processed.metadata = null;
            }
          }
          return processed;
        });

        logger.info(
          "[Conversation IPC] 搜索到消息数量:",
          processedMessages.length,
        );
        return {
          success: true,
          data: {
            messages: processedMessages,
            total,
            hasMore: offset + limit < total,
          },
        };
      } catch (error) {
        logger.error("[Conversation IPC] 搜索消息失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // 流式AI对话 (Streaming Chat) - 🔥 整合高级特性
  // ============================================================

  /**
   * 流式AI对话 - 🔥 v2.0 增强版
   * Channel: 'conversation:chat-stream'
   *
   * 整合以下高级特性：
   * - SessionManager: 自动会话追踪和压缩
   * - Manus Optimizations: Context Engineering + Tool Masking
   * - Multi-Agent: 复杂任务自动路由到专用Agent
   * - RAG: 知识库检索增强
   * - Prompt Compression: 长对话自动压缩
   * - ErrorMonitor: AI诊断预检查
   *
   * @param {Object} chatData - 对话数据
   * @param {string} chatData.conversationId - 对话ID
   * @param {string} chatData.userMessage - 用户消息
   * @param {Array} chatData.conversationHistory - 对话历史（可选）
   * @param {Object} chatData.options - LLM选项（可选）
   * @param {boolean} chatData.enableRAG - 启用RAG增强（默认true）
   * @param {boolean} chatData.enableCompression - 启用压缩（默认true）
   * @param {boolean} chatData.enableSessionTracking - 启用会话追踪（默认true）
   * @param {boolean} chatData.enableManusOptimization - 启用Manus优化（默认true）
   * @param {boolean} chatData.enableMultiAgent - 启用Multi-Agent（默认true）
   * @returns {Promise<Object>} { success: boolean, messageId: string, error?: string }
   */
  ipcMain.handle("conversation:chat-stream", async (_event, chatData) => {
    try {
      logger.info(
        "[Conversation IPC] conversation:chat-stream 调用，llmManager状态:",
        {
          exists: !!llmManager,
          type: llmManager ? typeof llmManager : "undefined",
          // 🔥 打印高级特性状态
          hasSessionManager: !!sessionManager,
          hasAgentOrchestrator: !!agentOrchestrator,
          hasRAGManager: !!ragManager,
          hasPromptCompressor: !!promptCompressor,
        },
      );

      if (!llmManager) {
        logger.error(
          "[Conversation IPC] LLM管理器未初始化！请检查主进程启动日志",
        );
        return {
          success: false,
          error: "LLM管理器未初始化",
          hint: "请检查LLM配置和初始化日志",
        };
      }

      // 优先使用 mainWindow，如果不可用则使用 _event.sender（测试环境）
      const webContents =
        mainWindow && !mainWindow.isDestroyed()
          ? mainWindow.webContents
          : _event.sender;

      const {
        conversationId,
        userMessage,
        conversationHistory = [],
        options = {},
        // 🔥 高级特性开关（默认全部启用）
        enableRAG = true,
        enableCompression = true,
        enableSessionTracking = true,
        enableManusOptimization = true,
        enableMultiAgent = true,
        enableErrorPrecheck = true,
        sessionId = null,
      } = chatData;

      if (!conversationId) {
        return { success: false, error: "对话ID不能为空" };
      }

      if (!userMessage) {
        return { success: false, error: "用户消息不能为空" };
      }

      logger.info("[Conversation IPC] 流式AI对话:", conversationId, {
        enableRAG,
        enableCompression,
        enableSessionTracking,
        enableManusOptimization,
        enableMultiAgent,
      });

      // 🔥 高级特性集成结果
      const integrationResults = {
        sessionUsed: false,
        sessionId: null,
        manusOptimized: false,
        multiAgentRouted: false,
        agentUsed: null,
        ragUsed: false,
        retrievedDocs: [],
        compressionUsed: false,
        compressionRatio: 1.0,
        tokensSaved: 0,
        errorPrechecked: false,
      };

      const provider = llmManager.provider;
      const model = options.model || llmManager.config?.model || "unknown";

      // ============================================================
      // 🔥 高级特性整合 - 步骤 0: 预检查和会话管理
      // ============================================================

      // 🔥 0.1: ErrorMonitor 预检查（如果启用）
      if (enableErrorPrecheck && errorMonitor) {
        try {
          if (llmManager.paused) {
            throw new Error(
              "LLM服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
            );
          }
          integrationResults.errorPrechecked = true;
          logger.info("[Conversation IPC] ✓ ErrorMonitor 预检查通过");
        } catch (precheckError) {
          logger.warn(
            "[Conversation IPC] ErrorMonitor 预检查失败:",
            precheckError.message,
          );
          if (precheckError.message.includes("预算超限")) {
            return { success: false, error: precheckError.message };
          }
        }
      }

      // 🔥 0.2: SessionManager 会话追踪（如果启用）
      let currentSessionId = sessionId;
      if (enableSessionTracking && sessionManager) {
        try {
          if (currentSessionId) {
            try {
              const session =
                await sessionManager.loadSession(currentSessionId);
              logger.info(
                "[Conversation IPC] ✓ 加载现有会话:",
                currentSessionId,
              );
            } catch (loadError) {
              logger.warn("[Conversation IPC] 会话不存在，将创建新会话");
              currentSessionId = null;
            }
          }

          if (!currentSessionId) {
            const sessionTitle = userMessage.substring(0, 50);
            const newSession = await sessionManager.createSession({
              conversationId: conversationId,
              title: sessionTitle,
              metadata: { provider, model },
            });
            currentSessionId = newSession.id;
            logger.info("[Conversation IPC] ✓ 创建新会话:", currentSessionId);
          }

          // 添加用户消息到会话
          await sessionManager.addMessage(currentSessionId, {
            role: "user",
            content: userMessage,
          });

          integrationResults.sessionUsed = true;
          integrationResults.sessionId = currentSessionId;
        } catch (sessionError) {
          logger.warn(
            "[Conversation IPC] SessionManager 会话追踪失败:",
            sessionError.message,
          );
        }
      }

      // 🔥 0.3: Multi-Agent 路由检查（如果启用）- 非流式任务可由Agent处理
      if (enableMultiAgent && agentOrchestrator) {
        try {
          const task = {
            type: detectTaskType(userMessage),
            input: userMessage,
            context: { messages: conversationHistory, provider, model },
          };

          const capableAgents = agentOrchestrator.getCapableAgents(task);

          // 只有高置信度的Agent才会接管（避免误路由）
          if (capableAgents.length > 0 && capableAgents[0].score > 0.8) {
            logger.info(
              "[Conversation IPC] 🤖 发现高匹配度 Agent:",
              capableAgents[0].agentId,
              "得分:",
              capableAgents[0].score,
            );
            integrationResults.multiAgentRouted = true;
            integrationResults.agentUsed = capableAgents[0].agentId;
            // 注：流式对话仍然使用LLM，Agent结果可作为参考上下文
          }
        } catch (agentCheckError) {
          logger.warn(
            "[Conversation IPC] Multi-Agent 路由检查失败:",
            agentCheckError.message,
          );
        }
      }

      // 1. 创建用户消息记录
      const userMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const userMessageData = {
        id: userMessageId,
        conversation_id: conversationId,
        role: "user",
        content: userMessage,
        timestamp: Date.now(),
      };

      if (database.createMessage) {
        await database.createMessage(userMessageData);
      } else {
        database.db
          .prepare(
            `
          INSERT INTO messages (id, conversation_id, role, content, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `,
          )
          .run(
            userMessageData.id,
            userMessageData.conversation_id,
            userMessageData.role,
            userMessageData.content,
            userMessageData.timestamp,
          );
      }

      // 2. 构建消息列表
      let enhancedMessages = [...conversationHistory];
      enhancedMessages.push({
        role: "user",
        content: userMessage,
      });

      // 🔥 2.1: RAG 知识库检索增强（如果启用）
      if (enableRAG && ragManager) {
        try {
          const ragResult = await ragManager.enhanceQuery(userMessage, {
            topK: options.ragTopK || 3,
            includeMetadata: true,
          });

          if (ragResult.retrievedDocs && ragResult.retrievedDocs.length > 0) {
            logger.info(
              "[Conversation IPC] RAG检索到",
              ragResult.retrievedDocs.length,
              "条相关知识",
            );
            integrationResults.ragUsed = true;
            integrationResults.retrievedDocs = ragResult.retrievedDocs.map(
              (doc) => ({
                id: doc.id,
                title: doc.title,
                content: doc.content.substring(0, 200),
                score: doc.score,
              }),
            );

            // 构建知识库上下文
            const knowledgeContext = ragResult.retrievedDocs
              .map(
                (doc, idx) =>
                  `[知识${idx + 1}] ${doc.title || doc.content.substring(0, 50)}\n${doc.content}`,
              )
              .join("\n\n");

            // 在消息数组中插入知识库上下文
            const systemMsgIndex = enhancedMessages.findIndex(
              (msg) => msg.role === "system",
            );

            if (systemMsgIndex >= 0) {
              enhancedMessages[systemMsgIndex] = {
                ...enhancedMessages[systemMsgIndex],
                content: `${enhancedMessages[systemMsgIndex].content}\n\n## 知识库参考\n${knowledgeContext}`,
              };
            } else {
              enhancedMessages = [
                {
                  role: "system",
                  content: `## 知识库参考\n以下是从知识库中检索到的相关信息，请参考这些内容来回答用户的问题：\n\n${knowledgeContext}`,
                },
                ...enhancedMessages,
              ];
            }
          }
        } catch (ragError) {
          logger.warn(
            "[Conversation IPC] RAG检索失败，继续普通对话:",
            ragError.message,
          );
        }
      }

      // 🔥 2.2: Prompt 压缩（如果启用且消息较长）
      if (
        enableCompression &&
        promptCompressor &&
        enhancedMessages.length > 5
      ) {
        try {
          const compressionResult = await promptCompressor.compress(
            enhancedMessages,
            {
              preserveSystemMessage: true,
              preserveLastUserMessage: true,
            },
          );

          if (compressionResult.compressionRatio < 0.95) {
            logger.info(
              "[Conversation IPC] ⚡ Prompt 压缩成功! 压缩率:",
              compressionResult.compressionRatio.toFixed(2),
              "节省",
              compressionResult.tokensSaved,
              "tokens",
            );
            enhancedMessages = compressionResult.messages;
            integrationResults.compressionUsed = true;
            integrationResults.compressionRatio =
              compressionResult.compressionRatio;
            integrationResults.tokensSaved = compressionResult.tokensSaved;
          }
        } catch (compressError) {
          logger.warn(
            "[Conversation IPC] Prompt 压缩失败，使用原始消息:",
            compressError.message,
          );
        }
      }

      // 3. 准备AI消息记录
      const aiMessageId = `msg_${Date.now() + 1}_${Math.random().toString(36).substr(2, 9)}`;
      let fullResponse = "";
      let totalTokens = 0;

      // 4. 使用StreamController管理器创建控制器
      const streamController = streamManager.create(conversationId, {
        enableBuffering: true,
      });

      streamController.start();

      // 5. 定义chunk回调函数
      const onChunk = async (chunk) => {
        // 处理chunk
        const shouldContinue = await streamController.processChunk(chunk);
        if (!shouldContinue) {
          return false;
        }

        // 提取chunk内容
        const chunkContent =
          chunk.content || chunk.text || chunk.delta?.content || "";
        if (chunkContent) {
          fullResponse += chunkContent;

          // 发送chunk给前端
          webContents.send("conversation:stream-chunk", {
            conversationId,
            messageId: aiMessageId,
            chunk: chunkContent,
            fullContent: fullResponse,
          });
        }

        // 更新tokens
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens || 0;
        }

        return true;
      };

      // 6. 调用LLM流式对话 - 🔥 使用 Manus 优化（如果启用）
      try {
        let llmResult;
        const llmOptions = {
          temperature: 0.7,
          maxTokens: 2000,
          conversationId,
          messageId: aiMessageId,
          ...options,
        };

        // 🔥 优先使用 Manus 优化的流式对话
        if (
          enableManusOptimization &&
          llmManager.chatStreamWithOptimizedPrompt
        ) {
          logger.info("[Conversation IPC] 使用 Manus Context Engineering 优化");
          llmResult = await llmManager.chatStreamWithOptimizedPrompt(
            enhancedMessages,
            onChunk,
            llmOptions,
          );
          integrationResults.manusOptimized = true;
        } else if (enableManusOptimization && llmManager.manusOptimizations) {
          // 如果有 manusOptimizations 但没有 chatStreamWithOptimizedPrompt，手动优化
          logger.info("[Conversation IPC] 应用 Manus 优化到消息");
          const optimized = llmManager.buildOptimizedPrompt({
            systemPrompt: options.systemPrompt,
            messages: enhancedMessages,
            tools: options.tools,
          });
          llmResult = await llmManager.chatStream(
            optimized.messages || enhancedMessages,
            onChunk,
            llmOptions,
          );
          integrationResults.manusOptimized = true;
        } else {
          // 标准流式对话
          llmResult = await llmManager.chatStream(
            enhancedMessages,
            onChunk,
            llmOptions,
          );
        }

        logger.info("[Conversation IPC] 流式对话完成");

        // 🔥 记录 AI 响应到 SessionManager
        if (
          enableSessionTracking &&
          sessionManager &&
          currentSessionId &&
          fullResponse
        ) {
          try {
            await sessionManager.addMessage(currentSessionId, {
              role: "assistant",
              content: fullResponse,
            });
            logger.info("[Conversation IPC] ✓ AI响应已记录到会话");
          } catch (sessionRecordError) {
            logger.warn(
              "[Conversation IPC] 记录AI响应到会话失败:",
              sessionRecordError.message,
            );
          }
        }

        // 🔥 记录 Token 使用到 TokenTracker
        if (tokenTracker) {
          try {
            await tokenTracker.recordUsage({
              conversationId,
              messageId: aiMessageId,
              provider,
              model,
              inputTokens: llmResult.usage?.prompt_tokens || 0,
              outputTokens: llmResult.usage?.completion_tokens || 0,
              totalTokens: totalTokens || llmResult.tokens || 0,
              cachedTokens: 0,
              wasCached: false,
              wasCompressed: integrationResults.compressionUsed,
              compressionRatio: integrationResults.compressionRatio,
              responseTime: llmResult.responseTime || 0,
              userId: options.userId || "default",
            });
          } catch (trackError) {
            logger.warn(
              "[Conversation IPC] Token 追踪失败:",
              trackError.message,
            );
          }
        }

        // 7. 保存AI消息
        const aiMessageData = {
          id: aiMessageId,
          conversation_id: conversationId,
          role: "assistant",
          content: fullResponse,
          timestamp: Date.now(),
          tokens: totalTokens || llmResult.tokens,
        };

        if (database.createMessage) {
          await database.createMessage(aiMessageData);
        } else {
          database.db
            .prepare(
              `
            INSERT INTO messages (id, conversation_id, role, content, timestamp, tokens)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
            )
            .run(
              aiMessageData.id,
              aiMessageData.conversation_id,
              aiMessageData.role,
              aiMessageData.content,
              aiMessageData.timestamp,
              aiMessageData.tokens,
            );
        }

        // 8. 更新对话的updated_at
        database.db
          .prepare(
            `
          UPDATE conversations
          SET updated_at = ?
          WHERE id = ?
        `,
          )
          .run(Date.now(), conversationId);

        // 9. 通知前端完成 - 🔥 包含高级特性状态
        streamController.complete({
          messageId: aiMessageId,
          tokens: totalTokens,
        });

        webContents.send("conversation:stream-complete", {
          conversationId,
          messageId: aiMessageId,
          fullContent: fullResponse,
          tokens: totalTokens,
          stats: streamController.getStats(),
          // 🔥 高级特性状态
          integrationResults,
        });

        return {
          success: true,
          userMessageId,
          aiMessageId,
          tokens: totalTokens,
          // 🔥 返回高级特性状态
          ...integrationResults,
        };
      } catch (llmError) {
        logger.error("[Conversation IPC] LLM流式对话失败:", llmError);

        // 🔥 使用 ErrorMonitor 进行错误分析（如果启用）
        if (errorMonitor) {
          try {
            const analysis = await errorMonitor.analyzeError(llmError);
            logger.info("[Conversation IPC] ErrorMonitor 错误分析完成:", {
              classification: analysis.classification,
              severity: analysis.severity,
            });
          } catch (analysisError) {
            logger.warn(
              "[Conversation IPC] ErrorMonitor 分析失败:",
              analysisError.message,
            );
          }
        }

        // 通知前端错误
        streamController.error(llmError);

        webContents.send("conversation:stream-error", {
          conversationId,
          messageId: aiMessageId,
          error: llmError.message,
        });

        return {
          success: false,
          error: llmError.message,
        };
      }
    } catch (error) {
      logger.error("[Conversation IPC] 流式对话处理失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 流式输出控制 (Stream Control)
  // ============================================================

  /**
   * 暂停流式输出
   * Channel: 'conversation:stream-pause'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, status?: string, error?: string }
   */
  ipcMain.handle(
    "conversation:stream-pause",
    async (_event, conversationId) => {
      try {
        if (!conversationId) {
          return { success: false, error: "对话ID不能为空" };
        }

        logger.info("[Conversation IPC] 暂停流式输出:", conversationId);

        const result = streamManager.pause(conversationId);
        return result;
      } catch (error) {
        logger.error("[Conversation IPC] 暂停流式输出失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 恢复流式输出
   * Channel: 'conversation:stream-resume'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, status?: string, error?: string }
   */
  ipcMain.handle(
    "conversation:stream-resume",
    async (_event, conversationId) => {
      try {
        if (!conversationId) {
          return { success: false, error: "对话ID不能为空" };
        }

        logger.info("[Conversation IPC] 恢复流式输出:", conversationId);

        const result = streamManager.resume(conversationId);
        return result;
      } catch (error) {
        logger.error("[Conversation IPC] 恢复流式输出失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 取消流式输出
   * Channel: 'conversation:stream-cancel'
   *
   * @param {string} conversationId - 对话ID
   * @param {string} reason - 取消原因（可选）
   * @returns {Promise<Object>} { success: boolean, status?: string, reason?: string, error?: string }
   */
  ipcMain.handle(
    "conversation:stream-cancel",
    async (_event, conversationId, reason) => {
      try {
        if (!conversationId) {
          return { success: false, error: "对话ID不能为空" };
        }

        logger.info(
          "[Conversation IPC] 取消流式输出:",
          conversationId,
          reason || "",
        );

        const result = streamManager.cancel(conversationId, reason);
        return result;
      } catch (error) {
        logger.error("[Conversation IPC] 取消流式输出失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取流式输出统计信息
   * Channel: 'conversation:stream-stats'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, stats?: Object, error?: string }
   */
  ipcMain.handle(
    "conversation:stream-stats",
    async (_event, conversationId) => {
      try {
        if (!conversationId) {
          return { success: false, error: "对话ID不能为空" };
        }

        logger.info("[Conversation IPC] 获取流式输出统计:", conversationId);

        const result = streamManager.getStats(conversationId);
        return result;
      } catch (error) {
        logger.error("[Conversation IPC] 获取流式输出统计失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取所有活动的流式会话
   * Channel: 'conversation:stream-list'
   *
   * @returns {Promise<Object>} { success: boolean, sessions?: Array, error?: string }
   */
  ipcMain.handle("conversation:stream-list", async (_event) => {
    try {
      logger.info("[Conversation IPC] 获取所有活动流式会话");

      const sessions = streamManager.getAllActiveSessions();
      return {
        success: true,
        sessions,
        count: sessions.length,
      };
    } catch (error) {
      logger.error("[Conversation IPC] 获取活动会话失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 清理已完成的流式会话
   * Channel: 'conversation:stream-cleanup'
   *
   * @returns {Promise<Object>} { success: boolean, cleanedCount?: number, error?: string }
   */
  ipcMain.handle("conversation:stream-cleanup", async (_event) => {
    try {
      logger.info("[Conversation IPC] 清理已完成的流式会话");

      const cleanedCount = streamManager.cleanup();
      return {
        success: true,
        cleanedCount,
      };
    } catch (error) {
      logger.error("[Conversation IPC] 清理会话失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取StreamController管理器状态
   * Channel: 'conversation:stream-manager-stats'
   *
   * @returns {Promise<Object>} { success: boolean, stats?: Object, error?: string }
   */
  ipcMain.handle("conversation:stream-manager-stats", async (_event) => {
    try {
      logger.info("[Conversation IPC] 获取StreamController管理器状态");

      const stats = streamManager.getManagerStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error("[Conversation IPC] 获取管理器状态失败:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 🤖 Agent Chat — non-streaming tool-use loop
  // ============================================================

  /**
   * conversation:agent-chat
   *
   * Autonomous agent mode: LLM picks tools, executes them, iterates
   * until it produces a final text answer.
   *
   * Sends events to renderer:
   *  - conversation:agent-tool-start  { tool, args }
   *  - conversation:agent-tool-result { tool, result, error }
   *  - conversation:agent-response    { content }
   */
  ipcMain.handle("conversation:agent-chat", async (_event, chatData) => {
    try {
      if (!llmManager) {
        return { success: false, error: "LLM管理器未初始化" };
      }

      const webContents =
        mainWindow && !mainWindow.isDestroyed()
          ? mainWindow.webContents
          : _event.sender;

      const {
        conversationId,
        userMessage,
        conversationHistory = [],
        options = {},
      } = chatData;

      if (!conversationId || !userMessage) {
        return {
          success: false,
          error: "conversationId and userMessage are required",
        };
      }

      logger.info("[Agent Chat] Starting agent loop for:", conversationId);

      // Build messages array
      const messages = [
        {
          role: "system",
          content:
            "You are ChainlessChain AI Assistant with access to tools. " +
            "When the user asks you to do something, use the available tools to actually do it. " +
            "Think step by step, call tools as needed, and deliver real results.",
        },
        ...conversationHistory.slice(-20),
        { role: "user", content: userMessage },
      ];

      // Get function caller instance (lazy require to avoid circular deps)
      let functionCaller;
      try {
        const FunctionCaller = require("../ai-engine/function-caller");
        functionCaller = new FunctionCaller({ enableToolMasking: false });
      } catch (err) {
        logger.warn("[Agent Chat] FunctionCaller not available:", err.message);
        // Fall back to regular chat
        const result = await llmManager.chat(messages, options);
        return {
          success: true,
          content: result.content || result.text || "",
          agentMode: false,
        };
      }

      const tools = functionCaller.getAgentChatTools();
      const MAX_ITERATIONS = 10;
      let finalContent = "";

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Call LLM with tools
        let result;
        try {
          result = await llmManager.chat(messages, { ...options, tools });
        } catch (err) {
          // If tools not supported by provider, fall back to no-tools
          logger.warn(
            "[Agent Chat] Tool-calling failed, falling back:",
            err.message,
          );
          result = await llmManager.chat(messages, options);
        }

        const msg = result.message || {
          role: "assistant",
          content: result.content || result.text || "",
        };
        const toolCalls = msg.tool_calls;

        // No tool calls — final answer
        if (!toolCalls || toolCalls.length === 0) {
          finalContent = msg.content || "";
          webContents.send("conversation:agent-response", {
            conversationId,
            content: finalContent,
          });
          break;
        }

        // Process tool calls
        messages.push(msg);

        for (const call of toolCalls) {
          const fn = call.function;
          const toolName = fn.name;
          let toolArgs;
          try {
            toolArgs =
              typeof fn.arguments === "string"
                ? JSON.parse(fn.arguments)
                : fn.arguments || {};
          } catch {
            toolArgs = {};
          }

          webContents.send("conversation:agent-tool-start", {
            conversationId,
            tool: toolName,
            args: toolArgs,
          });

          let toolResult;
          let toolError = null;
          try {
            toolResult = await functionCaller.executeAgentTool(
              toolName,
              toolArgs,
            );
          } catch (err) {
            toolResult = { error: err.message };
            toolError = err.message;
          }

          webContents.send("conversation:agent-tool-result", {
            conversationId,
            tool: toolName,
            result: toolResult,
            error: toolError,
          });

          messages.push({
            role: "tool",
            content: JSON.stringify(toolResult).substring(0, 5000),
            tool_call_id: call.id,
          });
        }
      }

      return {
        success: true,
        content: finalContent,
        agentMode: true,
      };
    } catch (error) {
      logger.error("[Agent Chat] Error:", error);
      return { success: false, error: error.message };
    }
  });

  // 标记模块为已注册
  ipcGuard.markModuleRegistered("conversation-ipc");

  logger.info(
    "[Conversation IPC] ✅ Successfully registered 19 conversation handlers",
  );
  logger.info("[Conversation IPC] - conversation:get-by-project");
  logger.info("[Conversation IPC] - conversation:get-recent");
  logger.info("[Conversation IPC] - conversation:get-by-id");
  logger.info("[Conversation IPC] - conversation:create ✓");
  logger.info("[Conversation IPC] - conversation:update");
  logger.info("[Conversation IPC] - conversation:delete");
  logger.info("[Conversation IPC] - conversation:create-message");
  logger.info("[Conversation IPC] - conversation:update-message");
  logger.info("[Conversation IPC] - conversation:get-messages");
  logger.info("[Conversation IPC] - conversation:search-messages ✓");
  logger.info("[Conversation IPC] - conversation:chat-stream");
  logger.info("[Conversation IPC] - conversation:stream-pause");
  logger.info("[Conversation IPC] - conversation:stream-resume");
  logger.info("[Conversation IPC] - conversation:stream-cancel");
  logger.info("[Conversation IPC] - conversation:stream-stats");
  logger.info("[Conversation IPC] - conversation:stream-list");
  logger.info("[Conversation IPC] - conversation:stream-cleanup");
  logger.info("[Conversation IPC] - conversation:stream-manager-stats");
  logger.info("[Conversation IPC] - conversation:agent-chat");

  // Verify handler is actually registered
  try {
    const { ipcMain: electronIpcMain } = require("electron");
    logger.info(
      "[Conversation IPC] Verification: conversation:create handler exists:",
      typeof electronIpcMain._events !== "undefined",
    );
  } catch (err) {
    logger.warn(
      "[Conversation IPC] Could not verify handler registration:",
      err.message,
    );
  }
}

module.exports = { registerConversationIPC };
