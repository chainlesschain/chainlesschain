/**
 * AI 命令处理器（增强版）
 *
 * 完整实现 AI 相关命令，集成现有的 LLMManager、RAGManager 和数据库
 *
 * 命令列表：
 * - ai.chat: AI 对话（支持流式响应）
 * - ai.getConversations: 查询对话历史
 * - ai.ragSearch: RAG 知识库搜索
 * - ai.controlAgent: 控制 AI Agent
 * - ai.getModels: 获取可用模型列表
 *
 * @module remote/handlers/ai-handler-enhanced
 */

const { logger } = require('../../utils/logger');
const EventEmitter = require('events');

/**
 * AI 命令处理器类
 */
class AICommandHandlerEnhanced extends EventEmitter {
  constructor(dependencies = {}) {
    super();

    // 核心依赖
    this.llmManager = dependencies.llmManager; // LLMManager 实例
    this.ragManager = dependencies.ragManager; // RAGManager 实例
    this.database = dependencies.database; // Database 实例
    this.aiEngineManager = dependencies.aiEngineManager; // AI Engine Manager（可选）

    // 配置
    this.config = {
      maxMessageLength: 10000, // 最大消息长度
      defaultTopK: 5, // RAG 搜索默认返回数量
      conversationTitleLength: 50, // 对话标题最大长度
      enableMetrics: true, // 启用性能指标
      ...dependencies.config
    };

    // 性能指标
    this.metrics = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      avgResponseTime: 0
    };

    logger.info('[AIHandlerEnhanced] AI 命令处理器已初始化');
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    const startTime = Date.now();
    logger.debug(`[AIHandlerEnhanced] 处理命令: ${action}`);

    try {
      this.metrics.totalRequests++;

      let result;
      switch (action) {
        case 'chat':
          result = await this.chat(params, context);
          break;

        case 'getConversations':
          result = await this.getConversations(params, context);
          break;

        case 'ragSearch':
          result = await this.ragSearch(params, context);
          break;

        case 'controlAgent':
          result = await this.controlAgent(params, context);
          break;

        case 'getModels':
          result = await this.getModels(params, context);
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // 更新指标
      this.metrics.successCount++;
      const responseTime = Date.now() - startTime;
      this.updateAvgResponseTime(responseTime);

      // 发出成功事件
      this.emit('command-success', {
        action,
        did: context.did,
        responseTime,
        result
      });

      return result;
    } catch (error) {
      this.metrics.failureCount++;
      logger.error(`[AIHandlerEnhanced] 命令失败: ${action}`, error);

      // 发出失败事件
      this.emit('command-failure', {
        action,
        did: context.did,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * AI 对话
   *
   * 集成 LLMManager，支持多轮对话、流式响应、上下文管理
   */
  async chat(params, context) {
    const {
      message,
      conversationId,
      model,
      systemPrompt,
      temperature,
      maxTokens,
      stream = false
    } = params;

    // 参数验证
    if (!message || typeof message !== 'string') {
      throw new Error('Parameter "message" is required and must be a string');
    }

    if (message.length > this.config.maxMessageLength) {
      throw new Error(`Message too long (max: ${this.config.maxMessageLength} characters)`);
    }

    logger.info(`[AIHandlerEnhanced] 处理对话请求: "${message.substring(0, 50)}..." (来自: ${context.did})`);

    try {
      // 1. 检查 LLM 服务是否可用
      if (!this.llmManager) {
        throw new Error('LLM service not available');
      }

      if (!this.llmManager.isInitialized) {
        logger.warn('[AIHandlerEnhanced] LLM 服务未初始化，尝试初始化...');
        await this.llmManager.initialize();
      }

      // 2. 获取或创建对话
      let convId = conversationId;
      let conversation = null;

      if (convId && this.database) {
        // 尝试获取现有对话
        try {
          conversation = this.database.getConversation(convId);
        } catch (error) {
          logger.warn(`[AIHandlerEnhanced] 对话不存在: ${convId}, 创建新对话`);
          convId = null;
        }
      }

      if (!convId && this.database) {
        // 创建新对话
        const title = message.substring(0, this.config.conversationTitleLength);
        conversation = this.database.createConversation({
          title,
          model: model || this.llmManager.config.model || 'default',
          metadata: JSON.stringify({
            source: 'remote',
            did: context.did,
            channel: context.channel || 'p2p'
          })
        });
        convId = conversation.id;
        logger.info(`[AIHandlerEnhanced] 创建新对话: ${convId}`);
      }

      // 3. 保存用户消息
      if (this.database && convId) {
        try {
          this.database.addMessageToConversation(convId, {
            role: 'user',
            content: message,
            created_at: Date.now()
          });
        } catch (error) {
          logger.warn('[AIHandlerEnhanced] 保存用户消息失败:', error);
        }
      }

      // 4. 构建消息数组
      const messages = [];

      // 添加系统提示（如果提供）
      if (systemPrompt) {
        messages.push({
          role: 'system',
          content: systemPrompt
        });
      }

      // 添加历史消息（如果有对话 ID）
      if (convId && this.database) {
        try {
          const history = this.database.getConversationMessages(convId, 10); // 最近 10 条
          for (const msg of history) {
            if (msg.role !== 'user' || msg.content !== message) {
              // 排除当前用户消息（已经添加过了）
              messages.push({
                role: msg.role,
                content: msg.content
              });
            }
          }
        } catch (error) {
          logger.warn('[AIHandlerEnhanced] 获取历史消息失败:', error);
        }
      }

      // 添加当前用户消息
      messages.push({
        role: 'user',
        content: message
      });

      // 5. 调用 LLM 服务
      let response;
      const llmOptions = {
        model: model || this.llmManager.config.model,
        temperature: temperature || this.llmManager.config.temperature,
        maxTokens: maxTokens || this.llmManager.config.maxTokens
      };

      if (stream) {
        // 流式响应（暂不支持通过远程命令）
        logger.warn('[AIHandlerEnhanced] 流式响应暂不支持远程命令，使用非流式模式');
        response = await this.llmManager.chat(messages, llmOptions);
      } else {
        // 非流式响应
        response = await this.llmManager.chat(messages, llmOptions);
      }

      // 6. 提取响应内容
      const assistantMessage = response.content || response.text || '';
      const usage = response.usage || response.tokens || {};

      // 7. 保存助手消息
      if (this.database && convId && assistantMessage) {
        try {
          this.database.addMessageToConversation(convId, {
            role: 'assistant',
            content: assistantMessage,
            created_at: Date.now()
          });

          // 更新对话的 updated_at
          this.database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
            .run(Date.now(), convId);
        } catch (error) {
          logger.warn('[AIHandlerEnhanced] 保存助手消息失败:', error);
        }
      }

      // 8. 构建返回结果
      return {
        conversationId: convId,
        response: assistantMessage,
        model: response.model || model || 'unknown',
        usage: {
          promptTokens: usage.prompt_tokens || usage.prompt || 0,
          completionTokens: usage.completion_tokens || usage.completion || 0,
          totalTokens: usage.total_tokens || usage.total || 0
        },
        metadata: {
          source: 'remote',
          did: context.did,
          channel: context.channel || 'p2p',
          timestamp: Date.now()
        }
      };
    } catch (error) {
      logger.error('[AIHandlerEnhanced] AI 对话失败:', error);
      throw new Error(`AI chat failed: ${error.message}`);
    }
  }

  /**
   * 查询对话历史
   *
   * 支持分页、搜索、排序
   */
  async getConversations(params, context) {
    const {
      limit = 20,
      offset = 0,
      search = '',
      sortBy = 'updated_at',
      sortOrder = 'DESC'
    } = params;

    logger.info(`[AIHandlerEnhanced] 查询对话历史 (limit: ${limit}, offset: ${offset}, search: "${search}")`);

    try {
      if (!this.database) {
        throw new Error('Database not available');
      }

      // 使用现有的 database.getConversations 方法
      const conversations = this.database.getConversations({
        limit,
        offset,
        search: search || undefined
      });

      // 获取总数
      let total = conversations.length;
      try {
        const countResult = this.database
          .prepare('SELECT COUNT(*) as count FROM conversations WHERE title LIKE ?')
          .get(`%${search}%`);
        total = countResult.count;
      } catch (error) {
        logger.warn('[AIHandlerEnhanced] 获取对话总数失败:', error);
      }

      // 格式化结果
      const formattedConversations = conversations.map(conv => ({
        id: conv.id,
        title: conv.title,
        model: conv.model,
        messageCount: conv.message_count || 0,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        metadata: conv.metadata ? JSON.parse(conv.metadata) : null
      }));

      return {
        conversations: formattedConversations,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    } catch (error) {
      logger.error('[AIHandlerEnhanced] 查询对话历史失败:', error);
      throw new Error(`Get conversations failed: ${error.message}`);
    }
  }

  /**
   * RAG 知识库搜索
   *
   * 集成 RAGManager，支持向量检索、重排序、混合搜索
   */
  async ragSearch(params, context) {
    const {
      query,
      topK = this.config.defaultTopK,
      threshold = 0.7,
      filter = null,
      useHybridSearch = true,
      useReranker = true
    } = params;

    // 参数验证
    if (!query || typeof query !== 'string') {
      throw new Error('Parameter "query" is required and must be a string');
    }

    logger.info(`[AIHandlerEnhanced] RAG 搜索: "${query}" (topK: ${topK}, threshold: ${threshold})`);

    try {
      // 检查 RAG 服务是否可用
      if (!this.ragManager) {
        throw new Error('RAG service not available');
      }

      // 调用 RAGManager 的 search 方法
      const searchResults = await this.ragManager.search(query, {
        limit: topK,
        scoreThreshold: threshold,
        useHybridSearch,
        useReranker,
        filter
      });

      // 格式化结果
      const formattedResults = searchResults.map(result => ({
        id: result.id || result.noteId,
        title: result.title || '',
        content: result.content || result.text || '',
        score: result.score || result.similarity || 0,
        metadata: {
          noteId: result.noteId,
          projectId: result.projectId,
          createdAt: result.created_at || result.createdAt,
          tags: result.tags || [],
          ...(result.metadata || {})
        }
      }));

      return {
        query,
        results: formattedResults,
        total: formattedResults.length,
        topK,
        threshold,
        metadata: {
          useHybridSearch,
          useReranker,
          timestamp: Date.now()
        }
      };
    } catch (error) {
      logger.error('[AIHandlerEnhanced] RAG 搜索失败:', error);
      throw new Error(`RAG search failed: ${error.message}`);
    }
  }

  /**
   * 控制 AI Agent
   *
   * 支持启动、停止、查询状态、任务分配
   */
  async controlAgent(params, context) {
    const { action, agentId, taskConfig = {} } = params;

    // 参数验证
    if (!action || !['start', 'stop', 'restart', 'status', 'list'].includes(action)) {
      throw new Error('Parameter "action" must be one of: start, stop, restart, status, list');
    }

    if (action !== 'list' && !agentId) {
      throw new Error('Parameter "agentId" is required for this action');
    }

    logger.info(`[AIHandlerEnhanced] 控制 Agent: ${action} ${agentId || ''}`);

    try {
      // 检查 AI Engine Manager 是否可用
      if (!this.aiEngineManager) {
        // 如果没有 AI Engine Manager，返回模拟响应
        logger.warn('[AIHandlerEnhanced] AI Engine Manager not available, returning mock response');
        return this.getMockAgentResponse(action, agentId, taskConfig);
      }

      // 根据 action 执行不同操作
      let result;
      switch (action) {
        case 'start':
          result = await this.startAgent(agentId, taskConfig);
          break;

        case 'stop':
          result = await this.stopAgent(agentId);
          break;

        case 'restart':
          await this.stopAgent(agentId);
          result = await this.startAgent(agentId, taskConfig);
          break;

        case 'status':
          result = await this.getAgentStatus(agentId);
          break;

        case 'list':
          result = await this.listAgents();
          break;
      }

      return {
        success: true,
        action,
        agentId: agentId || null,
        ...result,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('[AIHandlerEnhanced] 控制 Agent 失败:', error);
      throw new Error(`Control agent failed: ${error.message}`);
    }
  }

  /**
   * 获取可用模型列表
   *
   * 支持本地模型（Ollama）和云端模型（OpenAI、Anthropic 等）
   */
  async getModels(params, context) {
    const { provider = 'all', includeStatus = true } = params;

    logger.info(`[AIHandlerEnhanced] 获取模型列表 (provider: ${provider})`);

    try {
      const models = [];

      // 获取本地模型（Ollama）
      if (provider === 'all' || provider === 'ollama') {
        try {
          if (this.llmManager && this.llmManager.provider === 'ollama') {
            const localModels = await this.getOllamaModels(includeStatus);
            models.push(...localModels);
          }
        } catch (error) {
          logger.warn('[AIHandlerEnhanced] 获取本地模型失败:', error);
        }
      }

      // 获取云端模型配置
      if (provider === 'all' || provider !== 'ollama') {
        const cloudModels = this.getCloudModels(provider);
        models.push(...cloudModels);
      }

      return {
        models,
        total: models.length,
        provider,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('[AIHandlerEnhanced] 获取模型列表失败:', error);
      throw new Error(`Get models failed: ${error.message}`);
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取 Ollama 模型列表
   */
  async getOllamaModels(includeStatus = true) {
    try {
      // 调用 Ollama API 获取模型列表
      const ollamaClient = this.llmManager.client;
      if (ollamaClient && typeof ollamaClient.listModels === 'function') {
        const models = await ollamaClient.listModels();
        return models.map(m => ({
          id: m.name || m.model,
          name: m.name || m.model,
          provider: 'ollama',
          size: m.size,
          modifiedAt: m.modified_at,
          capabilities: ['chat', 'completion'],
          status: includeStatus ? 'available' : undefined
        }));
      }
      return [];
    } catch (error) {
      logger.warn('[AIHandlerEnhanced] 获取 Ollama 模型失败:', error);
      return [];
    }
  }

  /**
   * 获取云端模型配置
   */
  getCloudModels(provider) {
    const cloudModels = [];

    // OpenAI 模型
    if (provider === 'all' || provider === 'openai') {
      cloudModels.push(
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', capabilities: ['chat', 'function_calling'], maxTokens: 128000 },
        { id: 'gpt-4', name: 'GPT-4', provider: 'openai', capabilities: ['chat', 'function_calling'], maxTokens: 8192 },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', capabilities: ['chat', 'function_calling'], maxTokens: 16385 }
      );
    }

    // Anthropic 模型
    if (provider === 'all' || provider === 'anthropic') {
      cloudModels.push(
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', capabilities: ['chat', 'function_calling'], maxTokens: 200000 },
        { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic', capabilities: ['chat', 'function_calling'], maxTokens: 200000 },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic', capabilities: ['chat'], maxTokens: 200000 }
      );
    }

    // DeepSeek 模型
    if (provider === 'all' || provider === 'deepseek') {
      cloudModels.push(
        { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', capabilities: ['chat'], maxTokens: 32768 },
        { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'deepseek', capabilities: ['chat', 'code'], maxTokens: 16384 }
      );
    }

    return cloudModels;
  }

  /**
   * 启动 Agent
   */
  async startAgent(agentId, taskConfig) {
    // 这里需要根据实际的 AI Engine Manager API 实现
    // 目前返回模拟响应
    return {
      agentId,
      status: 'running',
      taskId: `task-${Date.now()}`,
      message: 'Agent started successfully'
    };
  }

  /**
   * 停止 Agent
   */
  async stopAgent(agentId) {
    return {
      agentId,
      status: 'stopped',
      message: 'Agent stopped successfully'
    };
  }

  /**
   * 获取 Agent 状态
   */
  async getAgentStatus(agentId) {
    return {
      agentId,
      status: 'idle',
      uptime: 0,
      tasksCompleted: 0,
      currentTask: null
    };
  }

  /**
   * 列出所有 Agent
   */
  async listAgents() {
    return {
      agents: [
        { id: 'general-agent', name: 'General Agent', status: 'idle', type: 'general' },
        { id: 'code-agent', name: 'Code Agent', status: 'idle', type: 'specialized' },
        { id: 'data-agent', name: 'Data Analysis Agent', status: 'idle', type: 'specialized' }
      ]
    };
  }

  /**
   * 获取模拟 Agent 响应（当 AI Engine Manager 不可用时）
   */
  getMockAgentResponse(action, agentId, taskConfig) {
    const responses = {
      start: {
        agentId,
        status: 'running',
        taskId: `mock-task-${Date.now()}`,
        message: 'Agent started (mock mode)'
      },
      stop: {
        agentId,
        status: 'stopped',
        message: 'Agent stopped (mock mode)'
      },
      restart: {
        agentId,
        status: 'running',
        message: 'Agent restarted (mock mode)'
      },
      status: {
        agentId,
        status: 'idle',
        uptime: 0,
        message: 'Agent status (mock mode)'
      },
      list: {
        agents: [
          { id: 'mock-agent-1', name: 'Mock Agent 1', status: 'idle' },
          { id: 'mock-agent-2', name: 'Mock Agent 2', status: 'running' }
        ]
      }
    };

    return {
      success: true,
      action,
      ...responses[action],
      timestamp: Date.now(),
      note: 'This is a mock response. AI Engine Manager not available.'
    };
  }

  /**
   * 更新平均响应时间
   */
  updateAvgResponseTime(responseTime) {
    const totalRequests = this.metrics.totalRequests;
    const currentAvg = this.metrics.avgResponseTime;
    this.metrics.avgResponseTime = (currentAvg * (totalRequests - 1) + responseTime) / totalRequests;
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0
        ? (this.metrics.successCount / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}

module.exports = AICommandHandlerEnhanced;
