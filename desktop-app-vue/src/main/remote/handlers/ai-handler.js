/**
 * AI 命令处理器
 *
 * 处理 AI 相关命令：
 * - ai.chat: AI 对话
 * - ai.getConversations: 查询对话历史
 * - ai.ragSearch: RAG 知识库搜索
 * - ai.controlAgent: 控制 AI Agent
 * - ai.getModels: 获取可用模型列表
 *
 * @module remote/handlers/ai-handler
 */

const { logger } = require("../../utils/logger");

/**
 * AI 命令处理器类
 */
class AICommandHandler {
  constructor(aiEngine, ragManager, database, options = {}) {
    this.aiEngine = aiEngine;
    this.ragManager = ragManager;
    this.database = database;
    this.options = options;

    // Phase 6.4 Action 1 — chatStream 状态：streamId → { chunks[], done, cancel }
    // 内存暂存，桌面进程重启清空（mobile 端 streamer reconnect 会重起）
    this.activeStreams = new Map();

    // Phase 6.4 Action 1 — 确保 ai_conversations + ai_messages 表存在
    // 旧 ai-handler.js 用了 `chat_conversations` 但 schema 里没那张表，所以
    // chat() 保存历史那段一直 silent 失败。本次新建专用 ai_* 表。
    this._ensureSchema();

    logger.info(
      "[AIHandler] AI 命令处理器已初始化 (Phase 6.4 — 25 method commit 1)",
    );
  }

  /**
   * 幂等建表 — ai_conversations + ai_messages。
   * iOS Phase 5 Conversation/ChatMessage 字段对齐：
   *   Conversation: id / title / model / messageCount / lastMessageAt / createdAt / archived
   *   ChatMessage:  id / role (user|assistant|system) / content / createdAt / modelUsed / isStreaming
   */
  _ensureSchema() {
    if (!this.database) {
      return;
    }
    try {
      // sqlite3 (database.js) vs better-sqlite3 双兼容；用 .prepare(...).run()
      this.database
        .prepare(
          `
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '新对话',
          model TEXT,
          system_prompt TEXT,
          created_at INTEGER NOT NULL,
          last_message_at INTEGER,
          message_count INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          metadata TEXT
        )
      `,
        )
        .run();
      this.database
        .prepare(
          `
        CREATE TABLE IF NOT EXISTS ai_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          model_used TEXT,
          created_at INTEGER NOT NULL,
          is_streaming INTEGER NOT NULL DEFAULT 0,
          metadata TEXT,
          FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        )
      `,
        )
        .run();
      this.database
        .prepare(
          `
        CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at)
      `,
        )
        .run();
      // Phase 6.4 commit 1 — Prompt templates 表
      this.database
        .prepare(
          `
        CREATE TABLE IF NOT EXISTS ai_prompt_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          template TEXT NOT NULL,
          variables TEXT,
          category TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `,
        )
        .run();
      this.database
        .prepare(
          `
        CREATE INDEX IF NOT EXISTS idx_prompt_templates_category
        ON ai_prompt_templates(category)
      `,
        )
        .run();
    } catch (error) {
      logger.warn(
        "[AIHandler] 建 ai_* 表失败 (可忽略，可能 db 未连接):",
        error.message,
      );
    }
  }

  /** 内部：upsert conversation + 自增 messageCount。 */
  _upsertConversation(conversationId, title, model, systemPrompt) {
    if (!this.database || !conversationId) {
      return;
    }
    const now = Date.now();
    try {
      this.database
        .prepare(
          `
        INSERT INTO ai_conversations
          (id, title, model, system_prompt, created_at, last_message_at, message_count, archived)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0)
        ON CONFLICT(id) DO UPDATE SET
          last_message_at = excluded.last_message_at,
          title = COALESCE(NULLIF(?, ''), title),
          model = COALESCE(?, model)
      `,
        )
        .run(
          conversationId,
          title || "新对话",
          model || null,
          systemPrompt || null,
          now,
          now,
          title || "",
          model || null,
        );
    } catch (error) {
      logger.warn("[AIHandler] upsert ai_conversations 失败:", error.message);
    }
  }

  /** 内部：insert message + 自增 conversation.message_count。 */
  _insertMessage(
    messageId,
    conversationId,
    role,
    content,
    modelUsed,
    isStreaming = false,
  ) {
    if (!this.database) {
      return;
    }
    const now = Date.now();
    try {
      this.database
        .prepare(
          `
        INSERT INTO ai_messages
          (id, conversation_id, role, content, model_used, created_at, is_streaming)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          messageId,
          conversationId,
          role,
          content,
          modelUsed || null,
          now,
          isStreaming ? 1 : 0,
        );
      this.database
        .prepare(
          `
        UPDATE ai_conversations
        SET message_count = message_count + 1, last_message_at = ?
        WHERE id = ?
      `,
        )
        .run(now, conversationId);
    } catch (error) {
      logger.warn("[AIHandler] insert ai_messages 失败:", error.message);
    }
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[AIHandler] 处理命令: ${action}`);

    switch (action) {
      case "chat":
        return await this.chat(params, context);

      case "getConversations":
        return await this.getConversations(params, context);

      case "ragSearch":
        return await this.ragSearch(params, context);

      case "controlAgent":
        return await this.controlAgent(params, context);

      case "getModels":
        return await this.getModels(params, context);

      // Phase 6.4 Action 1 — 新增 7 method 修 Phase 5 iOS AIChat UI bug
      case "chatStream":
        return await this.chatStream(params, context);

      case "getStreamChunk":
        return await this.getStreamChunk(params, context);

      case "cancelStream":
        return await this.cancelStream(params, context);

      case "getConversation":
        return await this.getConversation(params, context);

      case "createConversation":
        return await this.createConversation(params, context);

      case "deleteConversation":
        return await this.deleteConversation(params, context);

      case "getMessages":
        return await this.getMessages(params, context);

      // Phase 6.4 commit 1 — Conversations 高级 5
      case "updateConversation":
        return await this.updateConversation(params, context);
      case "archiveConversation":
        return await this.archiveConversation(params, context);
      case "unarchiveConversation":
        return await this.unarchiveConversation(params, context);
      case "searchConversations":
        return await this.searchConversations(params, context);
      case "exportConversation":
        return await this.exportConversation(params, context);

      // Phase 6.4 commit 1 — Prompt templates 3
      case "getPromptTemplates":
        return await this.getPromptTemplates(params, context);
      case "savePromptTemplate":
        return await this.savePromptTemplate(params, context);
      case "deletePromptTemplate":
        return await this.deletePromptTemplate(params, context);

      // Phase 6.4 commit 1 — RAG 5
      case "ragSearchAdvanced":
        return await this.ragSearchAdvanced(params, context);
      case "ragIndex":
        return await this.ragIndex(params, context);
      case "ragDelete":
        return await this.ragDelete(params, context);
      case "ragListDocuments":
        return await this.ragListDocuments(params, context);
      case "ragStats":
        return await this.ragStats(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * AI 对话
   */
  async chat(params, context) {
    const { message, conversationId, model, systemPrompt, temperature } =
      params;

    // 验证参数
    if (!message || typeof message !== "string") {
      throw new Error('Parameter "message" is required and must be a string');
    }

    logger.info(
      `[AIHandler] 处理对话请求: "${message.substring(0, 50)}..." (来自: ${context.did})`,
    );

    try {
      let response;

      // 使用实际的 AI Engine
      if (this.aiEngine && typeof this.aiEngine.chat === "function") {
        // Phase 3d v1.3 fix: LLMManager.chat 兼容接口签名是
        // chat(messagesArray, options) —— 此前传 {message,...} 单对象会触发
        // 「messages必须是数组」校验异常 (llm-manager.js:468)。Android 移动端
        // 远程 ai.chat 命令 params.message 是单条字符串，转成 OpenAI 风格
        // [{system}, {user}] 数组再喂给 LLMManager。
        const messages = [];
        if (
          systemPrompt &&
          typeof systemPrompt === "string" &&
          systemPrompt.length
        ) {
          messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: message });

        const aiResult = await this.aiEngine.chat(messages, {
          conversationId,
          model: model || this.options.defaultModel,
          temperature: temperature || 0.7,
        });

        response = {
          conversationId:
            aiResult.conversationId || conversationId || `conv-${Date.now()}`,
          reply: aiResult.content || aiResult.reply || aiResult.message,
          model: aiResult.model || model || "default",
          tokens: aiResult.usage || {
            prompt: 0,
            completion: 0,
            total: 0,
          },
          metadata: {
            source: "remote",
            did: context.did,
            channel: context.channel || "p2p",
            timestamp: Date.now(),
          },
        };
      } else if (this.aiEngine && typeof this.aiEngine.query === "function") {
        // 兼容 LLMManager.query 接口
        const aiResult = await this.aiEngine.query(message, {
          model: model || this.options.defaultModel,
          temperature: temperature || 0.7,
        });

        response = {
          conversationId: conversationId || `conv-${Date.now()}`,
          reply:
            typeof aiResult === "string"
              ? aiResult
              : aiResult.content || aiResult.reply,
          model: model || "default",
          tokens: aiResult.usage || { prompt: 0, completion: 0, total: 0 },
          metadata: {
            source: "remote",
            did: context.did,
            channel: context.channel || "p2p",
            timestamp: Date.now(),
          },
        };
      } else {
        // 后备：返回错误信息而非模拟数据
        logger.warn("[AIHandler] AI Engine 不可用，返回错误");
        throw new Error("AI Engine 未初始化或不可用");
      }

      // 保存对话历史到数据库（可选）
      if (this.database) {
        try {
          this.database
            .prepare(
              `
              INSERT INTO chat_conversations
              (id, title, model, created_at, updated_at, metadata)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET updated_at = ?, metadata = ?
            `,
            )
            .run(
              response.conversationId,
              message.substring(0, 100),
              response.model,
              Date.now(),
              Date.now(),
              JSON.stringify(response.metadata),
              Date.now(),
              JSON.stringify(response.metadata),
            );
        } catch (error) {
          logger.warn("[AIHandler] 保存对话历史失败:", error);
        }
      }

      return response;
    } catch (error) {
      logger.error("[AIHandler] AI 对话失败:", error);
      throw new Error(`AI chat failed: ${error.message}`);
    }
  }

  /**
   * 查询对话历史
   */
  async getConversations(params, context) {
    const { limit = 20, offset = 0, keyword } = params;

    logger.info(
      `[AIHandler] 查询对话历史 (limit: ${limit}, offset: ${offset})`,
    );

    try {
      if (!this.database) {
        throw new Error("Database not available");
      }

      let query = `
        SELECT id, title, model, created_at, updated_at, metadata
        FROM chat_conversations
        WHERE 1=1
      `;
      const queryParams = [];

      // 关键词搜索
      if (keyword) {
        query += " AND title LIKE ?";
        queryParams.push(`%${keyword}%`);
      }

      query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
      queryParams.push(limit, offset);

      const conversations = this.database.prepare(query).all(...queryParams);

      // 解析 metadata
      const result = conversations.map((conv) => ({
        ...conv,
        metadata: conv.metadata ? JSON.parse(conv.metadata) : null,
      }));

      return {
        conversations: result,
        total: result.length,
        limit,
        offset,
      };
    } catch (error) {
      logger.error("[AIHandler] 查询对话历史失败:", error);
      throw new Error(`Get conversations failed: ${error.message}`);
    }
  }

  /**
   * RAG 知识库搜索
   */
  async ragSearch(params, context) {
    const { query, topK = 5, filters } = params;

    // 验证参数
    if (!query || typeof query !== "string") {
      throw new Error('Parameter "query" is required and must be a string');
    }

    logger.info(`[AIHandler] RAG 搜索: "${query}" (topK: ${topK})`);

    try {
      let results = [];

      // 使用实际的 RAG Manager
      if (this.ragManager && typeof this.ragManager.search === "function") {
        const searchResults = await this.ragManager.search(query, {
          limit: topK,
          filter: filters,
        });

        results = (searchResults || []).map((item) => ({
          noteId: item.id,
          title: item.title || item.metadata?.title || "Untitled",
          content: item.content || "",
          score: item.score || 0,
          metadata: {
            createdAt: item.created_at || item.createdAt,
            tags: item.tags || item.metadata?.tags || [],
            type: item.type || item.metadata?.type,
          },
        }));
      } else if (
        this.ragManager &&
        typeof this.ragManager.retrieve === "function"
      ) {
        // 兼容 RAGManager.retrieve 接口
        const searchResults = await this.ragManager.retrieve(query, { topK });

        results = (searchResults || []).map((item) => ({
          noteId: item.id,
          title: item.title || "Untitled",
          content: item.content || "",
          score: item.score || 0,
          metadata: {
            createdAt: item.created_at,
            type: item.type,
          },
        }));
      } else {
        logger.warn("[AIHandler] RAG Manager 不可用");
        throw new Error("RAG Manager 未初始化或不可用");
      }

      return {
        query,
        results: results.slice(0, topK),
        total: results.length,
        topK,
      };
    } catch (error) {
      logger.error("[AIHandler] RAG 搜索失败:", error);
      throw new Error(`RAG search failed: ${error.message}`);
    }
  }

  /**
   * 控制 AI Agent
   */
  async controlAgent(params, context) {
    const { action, agentId, config } = params;

    // 验证参数
    if (
      !action ||
      !["start", "stop", "restart", "status", "list"].includes(action)
    ) {
      throw new Error(
        'Parameter "action" must be one of: start, stop, restart, status, list',
      );
    }

    if (action !== "list" && !agentId) {
      throw new Error('Parameter "agentId" is required');
    }

    logger.info(`[AIHandler] 控制 Agent: ${action} ${agentId || "all"}`);

    try {
      let response;

      // 获取 AgentPool 引用（如果可用）
      const agentPool = this.aiEngine?.agentPool || this.options.agentPool;

      switch (action) {
        case "start": {
          if (agentPool && typeof agentPool.acquire === "function") {
            // 从池中获取或创建代理
            const agent = await agentPool.acquire({
              id: agentId,
              capabilities: config?.capabilities || ["general"],
            });

            response = {
              success: true,
              agentId: agent.id || agentId,
              status: "running",
              capabilities: agent.capabilities || ["general"],
              startedAt: Date.now(),
            };
          } else {
            // 记录到数据库
            if (this.database) {
              this.database
                .prepare(
                  `
                INSERT OR REPLACE INTO ai_agents (id, status, config, started_at, updated_at)
                VALUES (?, 'running', ?, ?, ?)
              `,
                )
                .run(
                  agentId,
                  JSON.stringify(config || {}),
                  Date.now(),
                  Date.now(),
                );
            }

            response = {
              success: true,
              agentId,
              status: "running",
              startedAt: Date.now(),
            };
          }
          break;
        }

        case "stop": {
          if (agentPool && typeof agentPool.release === "function") {
            // 释放代理回池
            await agentPool.release(agentId);
          }

          // 更新数据库状态
          if (this.database) {
            this.database
              .prepare(
                `
              UPDATE ai_agents SET status = 'stopped', stopped_at = ?, updated_at = ?
              WHERE id = ?
            `,
              )
              .run(Date.now(), Date.now(), agentId);
          }

          response = {
            success: true,
            agentId,
            status: "stopped",
            stoppedAt: Date.now(),
          };
          break;
        }

        case "restart": {
          // 停止然后启动
          if (agentPool && typeof agentPool.release === "function") {
            await agentPool.release(agentId);
          }

          if (agentPool && typeof agentPool.acquire === "function") {
            const agent = await agentPool.acquire({
              id: agentId,
              capabilities: config?.capabilities || ["general"],
            });

            response = {
              success: true,
              agentId: agent.id || agentId,
              status: "running",
              restartedAt: Date.now(),
            };
          } else {
            if (this.database) {
              this.database
                .prepare(
                  `
                UPDATE ai_agents SET status = 'running', started_at = ?, updated_at = ?
                WHERE id = ?
              `,
                )
                .run(Date.now(), Date.now(), agentId);
            }

            response = {
              success: true,
              agentId,
              status: "running",
              restartedAt: Date.now(),
            };
          }
          break;
        }

        case "status": {
          let agentStatus = "unknown";
          let agentInfo = null;

          if (agentPool && typeof agentPool.getAgentStatus === "function") {
            agentStatus = await agentPool.getAgentStatus(agentId);
          } else if (this.database) {
            agentInfo = this.database
              .prepare(
                `
              SELECT * FROM ai_agents WHERE id = ?
            `,
              )
              .get(agentId);
            agentStatus = agentInfo?.status || "not_found";
          }

          response = {
            success: true,
            agentId,
            status: agentStatus,
            info: agentInfo,
            timestamp: Date.now(),
          };
          break;
        }

        case "list": {
          let agents = [];

          if (agentPool && typeof agentPool.getStats === "function") {
            const poolStats = agentPool.getStats();
            agents = [
              { type: "available", count: poolStats.available || 0 },
              { type: "busy", count: poolStats.busy || 0 },
            ];
          }

          if (this.database) {
            const dbAgents = this.database
              .prepare(
                `
              SELECT id, status, config, started_at, stopped_at, updated_at
              FROM ai_agents
              ORDER BY updated_at DESC
              LIMIT 100
            `,
              )
              .all();

            agents = dbAgents.map((a) => ({
              ...a,
              config: a.config ? JSON.parse(a.config) : null,
            }));
          }

          response = {
            success: true,
            agents,
            total: agents.length,
            timestamp: Date.now(),
          };
          break;
        }
      }

      logger.info(`[AIHandler] Agent 控制成功: ${action} ${agentId || "all"}`);
      return response;
    } catch (error) {
      logger.error("[AIHandler] 控制 Agent 失败:", error);
      throw new Error(`Control agent failed: ${error.message}`);
    }
  }

  /**
   * 获取可用模型列表
   */
  async getModels(params, context) {
    logger.info("[AIHandler] 获取模型列表");

    try {
      let models = [];

      // 从 AI Engine 获取实际模型列表
      if (
        this.aiEngine &&
        typeof this.aiEngine.getAvailableModels === "function"
      ) {
        const availableModels = await this.aiEngine.getAvailableModels();
        models = (availableModels || []).map((m) => ({
          id: m.id || m.name,
          name: m.name || m.id,
          provider: m.provider || "unknown",
          capabilities: m.capabilities || ["chat"],
          maxTokens: m.maxTokens || m.contextLength || 4096,
        }));
      } else if (
        this.aiEngine &&
        typeof this.aiEngine.listModels === "function"
      ) {
        const availableModels = await this.aiEngine.listModels();
        models = (availableModels || []).map((m) => ({
          id: m.id || m.model || m.name,
          name: m.name || m.model || m.id,
          provider: m.provider || "ollama",
          capabilities: ["chat", "completion"],
          maxTokens: m.contextLength || 4096,
        }));
      }

      // 如果没有从 AI Engine 获取到模型，使用默认配置
      if (models.length === 0) {
        models = [
          {
            id: "qwen2:7b",
            name: "Qwen2 7B",
            provider: "ollama",
            capabilities: ["chat", "completion"],
            maxTokens: 32768,
          },
          {
            id: "llama3:8b",
            name: "Llama 3 8B",
            provider: "ollama",
            capabilities: ["chat", "completion"],
            maxTokens: 8192,
          },
        ];

        // 尝试从环境变量获取配置的模型
        const configuredModels = process.env.LLM_MODELS;
        if (configuredModels) {
          try {
            const parsed = JSON.parse(configuredModels);
            if (Array.isArray(parsed)) {
              models = parsed;
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }

      return {
        models,
        total: models.length,
      };
    } catch (error) {
      logger.error("[AIHandler] 获取模型列表失败:", error);
      throw new Error(`Get models failed: ${error.message}`);
    }
  }

  // ============================================================================
  // Phase 6.4 Action 1 — 7 method 修 Phase 5 iOS AIChat UI bug
  // ============================================================================

  /**
   * 启动流式 chat — Phase 5 iOS UI 核心 UX。
   *
   * 返 streamId 给 iOS；后续 iOS 通过 `getStreamChunk(streamId)` 轮询。
   * 内部 Promise 异步驱动 LLMManager.chatStream，chunks 通过 callback 累
   * 积进 activeStreams Map.[streamId].chunks。完成时设 done=true。
   */
  async chatStream(params, context) {
    const {
      message,
      conversationId: convIdParam,
      model,
      systemPrompt,
      temperature,
    } = params;

    if (!message || typeof message !== "string") {
      throw new Error('Parameter "message" is required and must be a string');
    }

    const conversationId =
      convIdParam ||
      `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    logger.info(
      `[AIHandler] chatStream 启动: streamId=${streamId} conv=${conversationId} from ${context.did}`,
    );

    // 注册 stream state
    const streamState = {
      streamId,
      conversationId,
      chunks: [], // 累积 token 段
      done: false,
      cancelled: false,
      error: null,
      startedAt: Date.now(),
    };
    this.activeStreams.set(streamId, streamState);

    // upsert conversation + 写 user message
    this._upsertConversation(
      conversationId,
      message.substring(0, 100),
      model,
      systemPrompt,
    );
    this._insertMessage(
      `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      conversationId,
      "user",
      message,
      model,
    );

    // 异步启动 LLM 流式 — 不 await，立即返
    const messages = [];
    if (
      systemPrompt &&
      typeof systemPrompt === "string" &&
      systemPrompt.length
    ) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: message });

    const onChunk = (chunk) => {
      if (streamState.cancelled) {
        return;
      }
      // LLM client 通常返 {content:"..."} 或纯字符串
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk?.content || chunk?.delta || chunk?.text || "";
      if (text) {
        streamState.chunks.push(text);
      }
    };

    // fire-and-forget — 流完成后更新 done + 写 assistant message
    (async () => {
      try {
        if (this.aiEngine && typeof this.aiEngine.chatStream === "function") {
          await this.aiEngine.chatStream(messages, onChunk, {
            conversationId,
            model: model || this.options.defaultModel,
            temperature: temperature || 0.7,
          });
        } else if (this.aiEngine && typeof this.aiEngine.chat === "function") {
          // 没流式 API 时 fallback 单次 chat — 整个回复当一个 chunk
          const aiResult = await this.aiEngine.chat(messages, {
            conversationId,
            model: model || this.options.defaultModel,
            temperature: temperature || 0.7,
          });
          const text =
            aiResult.content || aiResult.reply || aiResult.message || "";
          if (text) {
            streamState.chunks.push(text);
          }
        } else {
          throw new Error("AI Engine 不可用");
        }
      } catch (err) {
        streamState.error = err.message || String(err);
        logger.error(`[AIHandler] chatStream ${streamId} 失败:`, err);
      } finally {
        streamState.done = true;
        // 写 assistant message 到 DB
        const fullText = streamState.chunks.join("");
        if (fullText && !streamState.cancelled) {
          this._insertMessage(
            `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            conversationId,
            "assistant",
            fullText,
            model,
          );
        }
        // 5 分钟后自动清 stream state 防内存泄漏
        setTimeout(() => this.activeStreams.delete(streamId), 5 * 60 * 1000);
      }
    })();

    return {
      success: true,
      streamId,
      conversationId,
    };
  }

  /**
   * 拉 streamId 的 buffered chunks（自 sinceChunk 起）。
   *
   * iOS 端按 sinceChunk 递增轮询，桌面返新累积 chunks + isComplete + nextChunkIdx。
   */
  async getStreamChunk(params, _context) {
    const { streamId, sinceChunk = 0 } = params;
    if (!streamId || typeof streamId !== "string") {
      throw new Error('Parameter "streamId" is required and must be a string');
    }

    const state = this.activeStreams.get(streamId);
    if (!state) {
      // stream 已结束 + 自动清理；返 done=true 让 iOS 退出轮询
      return {
        success: true,
        chunks: [],
        isComplete: true,
        nextChunkIdx: sinceChunk,
        error: "stream not found (expired or never started)",
      };
    }

    const startIdx = Math.max(0, sinceChunk | 0);
    const newChunks = state.chunks.slice(startIdx);
    return {
      success: true,
      chunks: newChunks,
      isComplete: state.done,
      nextChunkIdx: state.chunks.length,
      error: state.error || undefined,
      cancelled: state.cancelled,
    };
  }

  /** 取消 in-flight stream — 设 cancelled flag，下次 chunk callback 会被忽略。 */
  async cancelStream(params, _context) {
    const { streamId } = params;
    if (!streamId || typeof streamId !== "string") {
      throw new Error('Parameter "streamId" is required and must be a string');
    }
    const state = this.activeStreams.get(streamId);
    if (!state) {
      return { success: true, cancelled: false };
    }
    state.cancelled = true;
    state.done = true;
    logger.info(`[AIHandler] cancelStream ${streamId} — 用户取消`);
    return { success: true, cancelled: true };
  }

  /** 查单个对话 metadata. */
  async getConversation(params, _context) {
    const { conversationId } = params;
    if (!conversationId || typeof conversationId !== "string") {
      throw new Error('Parameter "conversationId" is required');
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const row = this.database
      .prepare(
        `SELECT id, title, model, message_count, last_message_at, created_at, archived FROM ai_conversations WHERE id = ?`,
      )
      .get(conversationId);
    if (!row) {
      return {
        success: false,
        conversation: null,
        error: "conversation not found",
      };
    }
    return {
      success: true,
      conversation: {
        id: row.id,
        title: row.title,
        model: row.model,
        messageCount: row.message_count,
        lastMessageAt: row.last_message_at,
        createdAt: row.created_at,
        archived: !!row.archived,
      },
    };
  }

  /** 创建空对话 — title/model/systemPrompt 全可选；返 conversationId + Conversation. */
  async createConversation(params, _context) {
    const { title, model, systemPrompt } = params;
    if (!this.database) {
      throw new Error("Database not available");
    }
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const finalTitle = title || "新对话";
    this.database
      .prepare(
        `
      INSERT INTO ai_conversations
        (id, title, model, system_prompt, created_at, last_message_at, message_count, archived)
      VALUES (?, ?, ?, ?, ?, NULL, 0, 0)
    `,
      )
      .run(
        conversationId,
        finalTitle,
        model || null,
        systemPrompt || null,
        now,
      );
    logger.info(`[AIHandler] createConversation: ${conversationId}`);
    return {
      success: true,
      conversationId,
      conversation: {
        id: conversationId,
        title: finalTitle,
        model: model || null,
        messageCount: 0,
        lastMessageAt: null,
        createdAt: now,
        archived: false,
      },
    };
  }

  /** 删除对话 + 所有 messages (FK CASCADE). */
  async deleteConversation(params, _context) {
    const { conversationId } = params;
    if (!conversationId || typeof conversationId !== "string") {
      throw new Error('Parameter "conversationId" is required');
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const info = this.database
      .prepare("DELETE FROM ai_conversations WHERE id = ?")
      .run(conversationId);
    // 兼容 FK 不在 (sqlite3 不强制) — 显式删 messages
    try {
      this.database
        .prepare("DELETE FROM ai_messages WHERE conversation_id = ?")
        .run(conversationId);
    } catch (_err) {
      // 表不存在或其它 — 忽略
    }
    logger.info(
      `[AIHandler] deleteConversation: ${conversationId} (rows: ${info.changes})`,
    );
    return { success: true };
  }

  /** 拉对话 messages 列表 (按 createdAt ASC). */
  async getMessages(params, _context) {
    const { conversationId, limit = 100, offset = 0 } = params;
    if (!conversationId || typeof conversationId !== "string") {
      throw new Error('Parameter "conversationId" is required');
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const rows = this.database
      .prepare(
        `
        SELECT id, role, content, model_used, created_at, is_streaming
        FROM ai_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(conversationId, Math.max(1, limit | 0), Math.max(0, offset | 0));
    const messages = rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      modelUsed: r.model_used,
      isStreaming: !!r.is_streaming,
    }));
    return { success: true, messages, total: messages.length };
  }

  // ============================================================================
  // Phase 6.4 commit 1 — Conversations 高级 5
  // ============================================================================

  /** 改 conversation 元信息 (title / model / systemPrompt 任一改)。 */
  async updateConversation(params, _context) {
    const { conversationId, title, model, systemPrompt } = params;
    if (!conversationId || typeof conversationId !== "string") {
      throw new Error("conversationId is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const sets = [];
    const args = [];
    if (title !== undefined) {
      sets.push("title = ?");
      args.push(String(title));
    }
    if (model !== undefined) {
      sets.push("model = ?");
      args.push(model || null);
    }
    if (systemPrompt !== undefined) {
      sets.push("system_prompt = ?");
      args.push(systemPrompt || null);
    }
    if (sets.length === 0) {
      throw new Error("At least one of title/model/systemPrompt required");
    }
    args.push(conversationId);
    const stmt = this.database.prepare(
      `UPDATE ai_conversations SET ${sets.join(", ")} WHERE id = ?`,
    );
    const result = stmt.run(...args);
    if (result.changes === 0) {
      throw new Error("Conversation not found");
    }
    return { conversationId, message: "Conversation updated" };
  }

  /** 归档 conversation (archived=1)。隐藏在 getConversations 默认列表外。 */
  async archiveConversation(params, _context) {
    const { conversationId } = params;
    if (!conversationId) {
      throw new Error("conversationId is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const result = this.database
      .prepare(
        "UPDATE ai_conversations SET archived = 1, last_message_at = ? WHERE id = ?",
      )
      .run(Date.now(), conversationId);
    if (result.changes === 0) {
      throw new Error("Conversation not found");
    }
    return { conversationId, archived: true };
  }

  async unarchiveConversation(params, _context) {
    const { conversationId } = params;
    if (!conversationId) {
      throw new Error("conversationId is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const result = this.database
      .prepare(
        "UPDATE ai_conversations SET archived = 0, last_message_at = ? WHERE id = ?",
      )
      .run(Date.now(), conversationId);
    if (result.changes === 0) {
      throw new Error("Conversation not found");
    }
    return { conversationId, archived: false };
  }

  /**
   * 搜 conversation by title / 内容（messages.content LIKE）。
   * archived 默认 false (排除归档)，传 true 仅在归档里找。
   */
  async searchConversations(params, _context) {
    const { query, limit = 20, archived = false } = params;
    if (!query || typeof query !== "string") {
      throw new Error("query is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const archivedFlag = archived ? 1 : 0;
    // 双路：1) title LIKE 2) messages.content LIKE (DISTINCT)
    const rows = this.database
      .prepare(
        `
        SELECT DISTINCT c.id, c.title, c.model, c.message_count, c.last_message_at,
                        c.created_at, c.archived
        FROM ai_conversations c
        LEFT JOIN ai_messages m ON m.conversation_id = c.id
        WHERE c.archived = ?
          AND (c.title LIKE ? OR m.content LIKE ?)
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT ?
      `,
      )
      .all(archivedFlag, `%${query}%`, `%${query}%`, Math.max(1, limit | 0));
    return {
      success: true,
      query,
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        model: r.model,
        messageCount: r.message_count || 0,
        lastMessageAt: r.last_message_at,
        createdAt: r.created_at,
        archived: !!r.archived,
      })),
      total: rows.length,
    };
  }

  /**
   * 导出 conversation 完整消息历史。format: markdown (default) / json。
   */
  async exportConversation(params, _context) {
    const { conversationId, format = "markdown" } = params;
    if (!conversationId) {
      throw new Error("conversationId is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const conv = this.database
      .prepare(
        "SELECT id, title, model, system_prompt, created_at, message_count FROM ai_conversations WHERE id = ?",
      )
      .get(conversationId);
    if (!conv) {
      throw new Error("Conversation not found");
    }
    const messages = this.database
      .prepare(
        `SELECT role, content, created_at, model_used
         FROM ai_messages WHERE conversation_id = ?
         ORDER BY created_at ASC`,
      )
      .all(conversationId);
    let content;
    let mime;
    if (format === "json") {
      content = JSON.stringify({ conversation: conv, messages }, null, 2);
      mime = "application/json";
    } else {
      // markdown
      const lines = [`# ${conv.title}`, ""];
      if (conv.model) {
        lines.push(`> Model: ${conv.model}`);
      }
      if (conv.system_prompt) {
        lines.push("", "**System:**", "", conv.system_prompt);
      }
      for (const m of messages) {
        lines.push("", `## ${m.role}`, "", m.content || "");
      }
      content = lines.join("\n") + "\n";
      mime = "text/markdown";
    }
    return {
      conversationId,
      format,
      mime,
      content,
      messageCount: messages.length,
    };
  }

  // ============================================================================
  // Phase 6.4 commit 1 — Prompt templates 3
  // ============================================================================

  async getPromptTemplates(params, _context) {
    const { category, limit = 50 } = params || {};
    if (!this.database) {
      return { success: true, templates: [], total: 0 };
    }
    let sql =
      "SELECT id, name, description, template, variables, category, created_at, updated_at FROM ai_prompt_templates";
    const args = [];
    if (category) {
      sql += " WHERE category = ?";
      args.push(category);
    }
    sql += " ORDER BY updated_at DESC LIMIT ?";
    args.push(Math.max(1, limit | 0));
    const rows = this.database.prepare(sql).all(...args);
    const templates = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      template: r.template,
      variables: r.variables ? JSON.parse(r.variables) : [],
      category: r.category,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return { success: true, templates, total: templates.length };
  }

  /**
   * 创建或更新 prompt template (id 传入则 upsert，缺省自动生成新 id)。
   * variables: 字符串数组，例 ["topic", "tone"] 表示模板含 {{topic}} / {{tone}} 占位。
   */
  async savePromptTemplate(params, _context) {
    const { id, name, template, description, variables, category } = params;
    if (!name || typeof name !== "string") {
      throw new Error("name is required");
    }
    if (!template || typeof template !== "string") {
      throw new Error("template is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const now = Date.now();
    const templateId =
      id || `tpl_${now}_${Math.random().toString(36).slice(2, 9)}`;
    const variablesJson = Array.isArray(variables)
      ? JSON.stringify(variables)
      : "[]";
    this.database
      .prepare(
        `
        INSERT INTO ai_prompt_templates
          (id, name, description, template, variables, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          template = excluded.template,
          variables = excluded.variables,
          category = excluded.category,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        templateId,
        name,
        description || null,
        template,
        variablesJson,
        category || null,
        now,
        now,
      );
    return {
      templateId,
      name,
      message: id ? "Template updated" : "Template created",
    };
  }

  async deletePromptTemplate(params, _context) {
    const { templateId } = params;
    if (!templateId) {
      throw new Error("templateId is required");
    }
    if (!this.database) {
      throw new Error("Database not available");
    }
    const result = this.database
      .prepare("DELETE FROM ai_prompt_templates WHERE id = ?")
      .run(templateId);
    if (result.changes === 0) {
      throw new Error("Template not found");
    }
    return { templateId, deleted: true };
  }

  // ============================================================================
  // Phase 6.4 commit 1 — RAG 5
  // ============================================================================

  /**
   * 高级 RAG 检索：含 filters (metadata 过滤) / scoreThreshold (低分截断) / namespace 隔离。
   * 若 ragManager.searchAdvanced 不存在，fallback 到普通 search 然后客户端侧过滤。
   */
  async ragSearchAdvanced(params, _context) {
    const {
      query,
      topK = 5,
      filters,
      scoreThreshold = 0.0,
      namespace,
    } = params;
    if (!query || typeof query !== "string") {
      throw new Error("query is required");
    }
    if (!this.ragManager) {
      throw new Error("RAG manager not available");
    }
    let results;
    if (typeof this.ragManager.searchAdvanced === "function") {
      results = await this.ragManager.searchAdvanced({
        query,
        topK: Math.max(1, topK | 0),
        filters,
        scoreThreshold,
        namespace,
      });
    } else if (typeof this.ragManager.search === "function") {
      const raw = await this.ragManager.search(query, {
        limit: Math.max(1, topK | 0),
        namespace,
      });
      const list = Array.isArray(raw)
        ? raw
        : raw && raw.results
          ? raw.results
          : [];
      results = list.filter((r) => {
        if (scoreThreshold > 0 && (r.score || 0) < scoreThreshold) {
          return false;
        }
        if (filters && r.metadata) {
          for (const k of Object.keys(filters)) {
            if (r.metadata[k] !== filters[k]) {
              return false;
            }
          }
        }
        return true;
      });
    } else {
      throw new Error("ragManager has no search method");
    }
    return { success: true, query, results, total: results.length };
  }

  /** 手动 index 一段 text 到向量库。docId 可传或自动生成。 */
  async ragIndex(params, _context) {
    const { text, metadata = {}, docId } = params;
    if (!text || typeof text !== "string") {
      throw new Error("text is required");
    }
    if (!this.ragManager) {
      throw new Error("RAG manager not available");
    }
    const id =
      docId || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    if (typeof this.ragManager.indexDocument === "function") {
      await this.ragManager.indexDocument({ id, text, metadata });
    } else if (typeof this.ragManager.index === "function") {
      await this.ragManager.index({ id, text, metadata });
    } else {
      throw new Error("ragManager has no index method");
    }
    return { docId: id, indexed: true };
  }

  async ragDelete(params, _context) {
    const { docId } = params;
    if (!docId) {
      throw new Error("docId is required");
    }
    if (!this.ragManager) {
      throw new Error("RAG manager not available");
    }
    if (typeof this.ragManager.deleteDocument === "function") {
      await this.ragManager.deleteDocument(docId);
    } else if (typeof this.ragManager.delete === "function") {
      await this.ragManager.delete(docId);
    } else {
      throw new Error("ragManager has no delete method");
    }
    return { docId, deleted: true };
  }

  async ragListDocuments(params, _context) {
    const { limit = 50, offset = 0, namespace } = params || {};
    if (!this.ragManager) {
      return { success: true, documents: [], total: 0 };
    }
    let docs = [];
    if (typeof this.ragManager.listDocuments === "function") {
      docs = await this.ragManager.listDocuments({
        limit: Math.max(1, limit | 0),
        offset: Math.max(0, offset | 0),
        namespace,
      });
    } else if (typeof this.ragManager.list === "function") {
      docs = await this.ragManager.list({ limit, offset, namespace });
    }
    const arr = Array.isArray(docs)
      ? docs
      : docs && docs.documents
        ? docs.documents
        : [];
    return { success: true, documents: arr, total: arr.length };
  }

  async ragStats(_params, _context) {
    if (!this.ragManager) {
      return { success: true, totalDocs: 0, totalVectors: 0, available: false };
    }
    if (typeof this.ragManager.stats === "function") {
      const s = await this.ragManager.stats();
      return { success: true, available: true, ...s };
    }
    if (typeof this.ragManager.getStats === "function") {
      const s = await this.ragManager.getStats();
      return { success: true, available: true, ...s };
    }
    return { success: true, available: false, totalDocs: 0, totalVectors: 0 };
  }
}

module.exports = AICommandHandler;
