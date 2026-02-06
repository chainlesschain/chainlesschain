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

const { logger } = require('../../utils/logger');

/**
 * AI 命令处理器类
 */
class AICommandHandler {
  constructor(aiEngine, ragManager, database, options = {}) {
    this.aiEngine = aiEngine;
    this.ragManager = ragManager;
    this.database = database;
    this.options = options;

    logger.info('[AIHandler] AI 命令处理器已初始化');
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[AIHandler] 处理命令: ${action}`);

    switch (action) {
      case 'chat':
        return await this.chat(params, context);

      case 'getConversations':
        return await this.getConversations(params, context);

      case 'ragSearch':
        return await this.ragSearch(params, context);

      case 'controlAgent':
        return await this.controlAgent(params, context);

      case 'getModels':
        return await this.getModels(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * AI 对话
   */
  async chat(params, context) {
    const { message, conversationId, model, systemPrompt, temperature } = params;

    // 验证参数
    if (!message || typeof message !== 'string') {
      throw new Error('Parameter "message" is required and must be a string');
    }

    logger.info(`[AIHandler] 处理对话请求: "${message.substring(0, 50)}..." (来自: ${context.did})`);

    try {
      let response;

      // 使用实际的 AI Engine
      if (this.aiEngine && typeof this.aiEngine.chat === 'function') {
        const aiResult = await this.aiEngine.chat({
          message,
          conversationId,
          model: model || this.options.defaultModel,
          systemPrompt,
          temperature: temperature || 0.7,
        });

        response = {
          conversationId: aiResult.conversationId || conversationId || `conv-${Date.now()}`,
          reply: aiResult.content || aiResult.reply || aiResult.message,
          model: aiResult.model || model || 'default',
          tokens: aiResult.usage || {
            prompt: 0,
            completion: 0,
            total: 0
          },
          metadata: {
            source: 'remote',
            did: context.did,
            channel: context.channel || 'p2p',
            timestamp: Date.now()
          }
        };
      } else if (this.aiEngine && typeof this.aiEngine.query === 'function') {
        // 兼容 LLMManager.query 接口
        const aiResult = await this.aiEngine.query(message, {
          model: model || this.options.defaultModel,
          temperature: temperature || 0.7,
        });

        response = {
          conversationId: conversationId || `conv-${Date.now()}`,
          reply: typeof aiResult === 'string' ? aiResult : (aiResult.content || aiResult.reply),
          model: model || 'default',
          tokens: aiResult.usage || { prompt: 0, completion: 0, total: 0 },
          metadata: {
            source: 'remote',
            did: context.did,
            channel: context.channel || 'p2p',
            timestamp: Date.now()
          }
        };
      } else {
        // 后备：返回错误信息而非模拟数据
        logger.warn('[AIHandler] AI Engine 不可用，返回错误');
        throw new Error('AI Engine 未初始化或不可用');
      }

      // 保存对话历史到数据库（可选）
      if (this.database) {
        try {
          this.database
            .prepare(`
              INSERT INTO chat_conversations
              (id, title, model, created_at, updated_at, metadata)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET updated_at = ?, metadata = ?
            `)
            .run(
              response.conversationId,
              message.substring(0, 100),
              response.model,
              Date.now(),
              Date.now(),
              JSON.stringify(response.metadata),
              Date.now(),
              JSON.stringify(response.metadata)
            );
        } catch (error) {
          logger.warn('[AIHandler] 保存对话历史失败:', error);
        }
      }

      return response;
    } catch (error) {
      logger.error('[AIHandler] AI 对话失败:', error);
      throw new Error(`AI chat failed: ${error.message}`);
    }
  }

  /**
   * 查询对话历史
   */
  async getConversations(params, context) {
    const { limit = 20, offset = 0, keyword } = params;

    logger.info(`[AIHandler] 查询对话历史 (limit: ${limit}, offset: ${offset})`);

    try {
      if (!this.database) {
        throw new Error('Database not available');
      }

      let query = `
        SELECT id, title, model, created_at, updated_at, metadata
        FROM chat_conversations
        WHERE 1=1
      `;
      const queryParams = [];

      // 关键词搜索
      if (keyword) {
        query += ' AND title LIKE ?';
        queryParams.push(`%${keyword}%`);
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);

      const conversations = this.database.prepare(query).all(...queryParams);

      // 解析 metadata
      const result = conversations.map(conv => ({
        ...conv,
        metadata: conv.metadata ? JSON.parse(conv.metadata) : null
      }));

      return {
        conversations: result,
        total: result.length,
        limit,
        offset
      };
    } catch (error) {
      logger.error('[AIHandler] 查询对话历史失败:', error);
      throw new Error(`Get conversations failed: ${error.message}`);
    }
  }

  /**
   * RAG 知识库搜索
   */
  async ragSearch(params, context) {
    const { query, topK = 5, filters } = params;

    // 验证参数
    if (!query || typeof query !== 'string') {
      throw new Error('Parameter "query" is required and must be a string');
    }

    logger.info(`[AIHandler] RAG 搜索: "${query}" (topK: ${topK})`);

    try {
      let results = [];

      // 使用实际的 RAG Manager
      if (this.ragManager && typeof this.ragManager.search === 'function') {
        const searchResults = await this.ragManager.search(query, {
          limit: topK,
          filter: filters,
        });

        results = (searchResults || []).map(item => ({
          noteId: item.id,
          title: item.title || item.metadata?.title || 'Untitled',
          content: item.content || '',
          score: item.score || 0,
          metadata: {
            createdAt: item.created_at || item.createdAt,
            tags: item.tags || item.metadata?.tags || [],
            type: item.type || item.metadata?.type,
          }
        }));
      } else if (this.ragManager && typeof this.ragManager.retrieve === 'function') {
        // 兼容 RAGManager.retrieve 接口
        const searchResults = await this.ragManager.retrieve(query, { topK });

        results = (searchResults || []).map(item => ({
          noteId: item.id,
          title: item.title || 'Untitled',
          content: item.content || '',
          score: item.score || 0,
          metadata: {
            createdAt: item.created_at,
            type: item.type,
          }
        }));
      } else {
        logger.warn('[AIHandler] RAG Manager 不可用');
        throw new Error('RAG Manager 未初始化或不可用');
      }

      return {
        query,
        results: results.slice(0, topK),
        total: results.length,
        topK
      };
    } catch (error) {
      logger.error('[AIHandler] RAG 搜索失败:', error);
      throw new Error(`RAG search failed: ${error.message}`);
    }
  }

  /**
   * 控制 AI Agent
   */
  async controlAgent(params, context) {
    const { action, agentId, config } = params;

    // 验证参数
    if (!action || !['start', 'stop', 'restart', 'status', 'list'].includes(action)) {
      throw new Error('Parameter "action" must be one of: start, stop, restart, status, list');
    }

    if (action !== 'list' && !agentId) {
      throw new Error('Parameter "agentId" is required');
    }

    logger.info(`[AIHandler] 控制 Agent: ${action} ${agentId || 'all'}`);

    try {
      let response;

      // 获取 AgentPool 引用（如果可用）
      const agentPool = this.aiEngine?.agentPool || this.options.agentPool;

      switch (action) {
        case 'start': {
          if (agentPool && typeof agentPool.acquire === 'function') {
            // 从池中获取或创建代理
            const agent = await agentPool.acquire({
              id: agentId,
              capabilities: config?.capabilities || ['general'],
            });

            response = {
              success: true,
              agentId: agent.id || agentId,
              status: 'running',
              capabilities: agent.capabilities || ['general'],
              startedAt: Date.now(),
            };
          } else {
            // 记录到数据库
            if (this.database) {
              this.database.prepare(`
                INSERT OR REPLACE INTO ai_agents (id, status, config, started_at, updated_at)
                VALUES (?, 'running', ?, ?, ?)
              `).run(agentId, JSON.stringify(config || {}), Date.now(), Date.now());
            }

            response = {
              success: true,
              agentId,
              status: 'running',
              startedAt: Date.now(),
            };
          }
          break;
        }

        case 'stop': {
          if (agentPool && typeof agentPool.release === 'function') {
            // 释放代理回池
            await agentPool.release(agentId);
          }

          // 更新数据库状态
          if (this.database) {
            this.database.prepare(`
              UPDATE ai_agents SET status = 'stopped', stopped_at = ?, updated_at = ?
              WHERE id = ?
            `).run(Date.now(), Date.now(), agentId);
          }

          response = {
            success: true,
            agentId,
            status: 'stopped',
            stoppedAt: Date.now(),
          };
          break;
        }

        case 'restart': {
          // 停止然后启动
          if (agentPool && typeof agentPool.release === 'function') {
            await agentPool.release(agentId);
          }

          if (agentPool && typeof agentPool.acquire === 'function') {
            const agent = await agentPool.acquire({
              id: agentId,
              capabilities: config?.capabilities || ['general'],
            });

            response = {
              success: true,
              agentId: agent.id || agentId,
              status: 'running',
              restartedAt: Date.now(),
            };
          } else {
            if (this.database) {
              this.database.prepare(`
                UPDATE ai_agents SET status = 'running', started_at = ?, updated_at = ?
                WHERE id = ?
              `).run(Date.now(), Date.now(), agentId);
            }

            response = {
              success: true,
              agentId,
              status: 'running',
              restartedAt: Date.now(),
            };
          }
          break;
        }

        case 'status': {
          let agentStatus = 'unknown';
          let agentInfo = null;

          if (agentPool && typeof agentPool.getAgentStatus === 'function') {
            agentStatus = await agentPool.getAgentStatus(agentId);
          } else if (this.database) {
            agentInfo = this.database.prepare(`
              SELECT * FROM ai_agents WHERE id = ?
            `).get(agentId);
            agentStatus = agentInfo?.status || 'not_found';
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

        case 'list': {
          let agents = [];

          if (agentPool && typeof agentPool.getStats === 'function') {
            const poolStats = agentPool.getStats();
            agents = [
              { type: 'available', count: poolStats.available || 0 },
              { type: 'busy', count: poolStats.busy || 0 },
            ];
          }

          if (this.database) {
            const dbAgents = this.database.prepare(`
              SELECT id, status, config, started_at, stopped_at, updated_at
              FROM ai_agents
              ORDER BY updated_at DESC
              LIMIT 100
            `).all();

            agents = dbAgents.map(a => ({
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

      logger.info(`[AIHandler] Agent 控制成功: ${action} ${agentId || 'all'}`);
      return response;
    } catch (error) {
      logger.error('[AIHandler] 控制 Agent 失败:', error);
      throw new Error(`Control agent failed: ${error.message}`);
    }
  }

  /**
   * 获取可用模型列表
   */
  async getModels(params, context) {
    logger.info('[AIHandler] 获取模型列表');

    try {
      let models = [];

      // 从 AI Engine 获取实际模型列表
      if (this.aiEngine && typeof this.aiEngine.getAvailableModels === 'function') {
        const availableModels = await this.aiEngine.getAvailableModels();
        models = (availableModels || []).map(m => ({
          id: m.id || m.name,
          name: m.name || m.id,
          provider: m.provider || 'unknown',
          capabilities: m.capabilities || ['chat'],
          maxTokens: m.maxTokens || m.contextLength || 4096,
        }));
      } else if (this.aiEngine && typeof this.aiEngine.listModels === 'function') {
        const availableModels = await this.aiEngine.listModels();
        models = (availableModels || []).map(m => ({
          id: m.id || m.model || m.name,
          name: m.name || m.model || m.id,
          provider: m.provider || 'ollama',
          capabilities: ['chat', 'completion'],
          maxTokens: m.contextLength || 4096,
        }));
      }

      // 如果没有从 AI Engine 获取到模型，使用默认配置
      if (models.length === 0) {
        models = [
          {
            id: 'qwen2:7b',
            name: 'Qwen2 7B',
            provider: 'ollama',
            capabilities: ['chat', 'completion'],
            maxTokens: 32768
          },
          {
            id: 'llama3:8b',
            name: 'Llama 3 8B',
            provider: 'ollama',
            capabilities: ['chat', 'completion'],
            maxTokens: 8192
          }
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
        total: models.length
      };
    } catch (error) {
      logger.error('[AIHandler] 获取模型列表失败:', error);
      throw new Error(`Get models failed: ${error.message}`);
    }
  }
}

module.exports = AICommandHandler;
