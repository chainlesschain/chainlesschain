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
      // TODO: 调用实际的 AI Engine
      // 这里暂时返回模拟响应，实际实现需要集成现有的 AI 引擎

      // 模拟响应
      const response = {
        conversationId: conversationId || `conv-${Date.now()}`,
        reply: `收到您的消息："${message}"。这是来自 PC 端的模拟回复。`,
        model: model || 'qwen-72b',
        tokens: {
          prompt: 50,
          completion: 100,
          total: 150
        },
        metadata: {
          source: 'remote',
          did: context.did,
          channel: context.channel || 'p2p',
          timestamp: Date.now()
        }
      };

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
      // TODO: 调用实际的 RAG Manager
      // 这里暂时返回模拟响应

      // 模拟搜索结果
      const results = [
        {
          noteId: 'note-1',
          title: '知识点 1',
          content: `这是关于 "${query}" 的第一条相关知识`,
          score: 0.95,
          metadata: {
            createdAt: Date.now() - 86400000,
            tags: ['AI', 'knowledge']
          }
        },
        {
          noteId: 'note-2',
          title: '知识点 2',
          content: `这是关于 "${query}" 的第二条相关知识`,
          score: 0.87,
          metadata: {
            createdAt: Date.now() - 172800000,
            tags: ['search']
          }
        }
      ];

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
    const { action, agentId } = params;

    // 验证参数
    if (!action || !['start', 'stop', 'restart', 'status'].includes(action)) {
      throw new Error('Parameter "action" must be one of: start, stop, restart, status');
    }

    if (!agentId) {
      throw new Error('Parameter "agentId" is required');
    }

    logger.info(`[AIHandler] 控制 Agent: ${action} ${agentId}`);

    try {
      // TODO: 实现实际的 Agent 控制逻辑

      // 模拟响应
      const response = {
        success: true,
        agentId,
        action,
        status: action === 'start' ? 'running' : action === 'stop' ? 'stopped' : 'running',
        timestamp: Date.now()
      };

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
      // TODO: 从配置或 AI Engine 获取实际模型列表

      // 模拟模型列表
      const models = [
        {
          id: 'gpt-4',
          name: 'GPT-4',
          provider: 'openai',
          capabilities: ['chat', 'completion'],
          maxTokens: 8192
        },
        {
          id: 'claude-3-opus',
          name: 'Claude 3 Opus',
          provider: 'anthropic',
          capabilities: ['chat', 'completion'],
          maxTokens: 200000
        },
        {
          id: 'qwen-72b',
          name: 'Qwen 72B',
          provider: 'ollama',
          capabilities: ['chat', 'completion'],
          maxTokens: 32768
        }
      ];

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
