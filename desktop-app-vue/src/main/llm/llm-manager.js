/**
 * LLM 服务管理器
 *
 * 统一管理不同的LLM服务提供商
 */

const EventEmitter = require('events');
const OllamaClient = require('./ollama-client');
const { OpenAIClient, DeepSeekClient } = require('./openai-client');

/**
 * LLM 提供商类型
 */
const LLMProviders = {
  OLLAMA: 'ollama',
  OPENAI: 'openai',
  DEEPSEEK: 'deepseek',
  VOLCENGINE: 'volcengine',
  CUSTOM: 'custom',
};

/**
 * LLM管理器类
 */
class LLMManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.provider = config.provider || LLMProviders.OLLAMA;
    this.client = null;
    this.isInitialized = false;

    // 会话上下文
    this.conversationContext = new Map();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    console.log('[LLMManager] 初始化LLM管理器...');
    console.log('[LLMManager] 提供商:', this.provider);

    try {
      this.client = await this.createClient(this.provider);

      if (this.client) {
        // 检查服务状态
        const status = await this.client.checkStatus();

        if (status.available) {
          this.isInitialized = true;
          console.log('[LLMManager] LLM服务可用');
          console.log('[LLMManager] 可用模型数:', status.models?.length || 0);
          this.emit('initialized', status);
        } else {
          console.warn('[LLMManager] LLM服务不可用:', status.error);
          this.isInitialized = false;
          this.emit('unavailable', status);
        }
      }

      return this.isInitialized;
    } catch (error) {
      console.error('[LLMManager] 初始化失败:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * 创建客户端
   * @param {string} provider - 提供商类型
   */
  async createClient(provider) {
    switch (provider) {
      case LLMProviders.OLLAMA:
        return new OllamaClient({
          baseURL: this.config.ollamaURL || 'http://localhost:11434',
          model: this.config.model || 'llama2',
          timeout: this.config.timeout,
        });

      case LLMProviders.OPENAI:
        return new OpenAIClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
          model: this.config.model || 'gpt-3.5-turbo',
          organization: this.config.organization,
          timeout: this.config.timeout,
        });

      case LLMProviders.DEEPSEEK:
        return new DeepSeekClient({
          apiKey: this.config.apiKey,
          model: this.config.model || 'deepseek-chat',
          timeout: this.config.timeout,
        });

      case LLMProviders.VOLCENGINE:
        return new OpenAIClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL || 'https://ark.cn-beijing.volces.com/api/v3',
          model: this.config.model || 'doubao-seed-1-6-lite-251015',
          timeout: this.config.timeout,
        });

      case LLMProviders.CUSTOM:
        return new OpenAIClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
          model: this.config.model,
          timeout: this.config.timeout,
        });

      default:
        throw new Error(`不支持的提供商: ${provider}`);
    }
  }

  /**
   * 切换提供商
   * @param {string} provider - 提供商类型
   * @param {Object} config - 配置
   */
  async switchProvider(provider, config = {}) {
    console.log('[LLMManager] 切换提供商:', provider);

    try {
      this.provider = provider;
      this.config = { ...this.config, ...config };

      await this.initialize();

      this.emit('provider-changed', provider);

      return true;
    } catch (error) {
      console.error('[LLMManager] 切换提供商失败:', error);
      throw error;
    }
  }

  /**
   * 检查服务状态
   */
  async checkStatus() {
    if (!this.client) {
      return {
        available: false,
        error: 'LLM服务未初始化',
        provider: this.provider,
      };
    }

    try {
      const status = await this.client.checkStatus();
      return {
        ...status,
        provider: this.provider,
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        provider: this.provider,
      };
    }
  }

  /**
   * 发送查询（非流式）
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项
   */
  async query(prompt, options = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM服务未初始化');
    }

    try {
      const conversationId = options.conversationId;
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        // Ollama使用generate或chat
        if (conversationId && this.conversationContext.has(conversationId)) {
          // 有上下文，使用chat
          const context = this.conversationContext.get(conversationId);
          const messages = [
            ...context.messages,
            { role: 'user', content: prompt },
          ];

          result = await this.client.chat(messages, options);

          // 更新上下文
          context.messages.push(
            { role: 'user', content: prompt },
            result.message
          );
        } else {
          // 无上下文，使用generate
          result = await this.client.generate(prompt, options);

          // 创建上下文
          if (conversationId) {
            this.conversationContext.set(conversationId, {
              messages: [
                { role: 'user', content: prompt },
                { role: 'assistant', content: result.text },
              ],
              context: result.context,
            });
          }
        }
      } else {
        // OpenAI兼容的API使用chat
        const messages = [];

        if (conversationId && this.conversationContext.has(conversationId)) {
          const context = this.conversationContext.get(conversationId);
          messages.push(...context.messages);
        }

        if (options.systemPrompt) {
          messages.unshift({ role: 'system', content: options.systemPrompt });
        }

        messages.push({ role: 'user', content: prompt });

        result = await this.client.chat(messages, options);

        // 更新上下文
        if (conversationId) {
          if (!this.conversationContext.has(conversationId)) {
            this.conversationContext.set(conversationId, { messages: [] });
          }
          const context = this.conversationContext.get(conversationId);
          context.messages.push(
            { role: 'user', content: prompt },
            result.message
          );
        }
      }

      this.emit('query-completed', { prompt, result });

      return {
        text: result.text || result.message?.content,
        model: result.model,
        tokens: result.tokens || result.usage?.total_tokens || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[LLMManager] 查询失败:', error);
      this.emit('query-failed', { prompt, error });
      throw error;
    }
  }

  /**
   * 聊天对话（支持完整messages数组，非流式）
   * @param {Array} messages - 消息数组 [{role: 'user'|'assistant'|'system', content: string}]
   * @param {Object} options - 选项
   */
  async chatWithMessages(messages, options = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM服务未初始化');
    }

    try {
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        result = await this.client.chat(messages, options);
      } else {
        // OpenAI兼容的API
        result = await this.client.chat(messages, options);
      }

      this.emit('chat-completed', { messages, result });

      return {
        text: result.message?.content || result.text,
        message: result.message,
        model: result.model,
        tokens: result.tokens || result.usage?.total_tokens || 0,
        usage: result.usage,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[LLMManager] 聊天失败:', error);
      this.emit('chat-failed', { messages, error });
      throw error;
    }
  }

  /**
   * 聊天对话（支持完整messages数组，流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async chatWithMessagesStream(messages, onChunk, options = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM服务未初始化');
    }

    try {
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        result = await this.client.chatStream(messages, onChunk, options);
      } else {
        // OpenAI兼容的API
        result = await this.client.chatStream(messages, onChunk, options);
      }

      this.emit('chat-stream-completed', { messages, result });

      return {
        text: result.message?.content || result.text,
        message: result.message,
        model: result.model,
        tokens: result.tokens || 0,
        usage: result.usage,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[LLMManager] 流式聊天失败:', error);
      this.emit('chat-stream-failed', { messages, error });
      throw error;
    }
  }

  /**
   * 发送查询（流式）
   * @param {string} prompt - 提示词
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项
   */
  async queryStream(prompt, onChunk, options = {}) {
    if (!this.isInitialized) {
      throw new Error('LLM服务未初始化');
    }

    try {
      const conversationId = options.conversationId;
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        if (conversationId && this.conversationContext.has(conversationId)) {
          const context = this.conversationContext.get(conversationId);
          const messages = [
            ...context.messages,
            { role: 'user', content: prompt },
          ];

          result = await this.client.chatStream(messages, onChunk, options);

          context.messages.push(
            { role: 'user', content: prompt },
            result.message
          );
        } else {
          result = await this.client.generateStream(prompt, onChunk, options);

          if (conversationId) {
            this.conversationContext.set(conversationId, {
              messages: [
                { role: 'user', content: prompt },
                { role: 'assistant', content: result.text },
              ],
              context: result.context,
            });
          }
        }
      } else {
        const messages = [];

        if (conversationId && this.conversationContext.has(conversationId)) {
          const context = this.conversationContext.get(conversationId);
          messages.push(...context.messages);
        }

        if (options.systemPrompt) {
          messages.unshift({ role: 'system', content: options.systemPrompt });
        }

        messages.push({ role: 'user', content: prompt });

        result = await this.client.chatStream(messages, onChunk, options);

        if (conversationId) {
          if (!this.conversationContext.has(conversationId)) {
            this.conversationContext.set(conversationId, { messages: [] });
          }
          const context = this.conversationContext.get(conversationId);
          context.messages.push(
            { role: 'user', content: prompt },
            result.message
          );
        }
      }

      this.emit('stream-completed', { prompt, result });

      return {
        text: result.text || result.message?.content,
        model: result.model,
        tokens: result.tokens || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[LLMManager] 流式查询失败:', error);
      this.emit('stream-failed', { prompt, error });
      throw error;
    }
  }

  /**
   * 清除会话上下文
   * @param {string} conversationId - 会话ID
   */
  clearContext(conversationId) {
    if (conversationId) {
      this.conversationContext.delete(conversationId);
    } else {
      this.conversationContext.clear();
    }
  }

  /**
   * 获取会话上下文
   * @param {string} conversationId - 会话ID
   */
  getContext(conversationId) {
    return this.conversationContext.get(conversationId);
  }

  /**
   * 生成嵌入向量
   * @param {string} text - 文本
   */
  async embeddings(text) {
    if (!this.isInitialized) {
      throw new Error('LLM服务未初始化');
    }

    try {
      return await this.client.embeddings(text);
    } catch (error) {
      console.error('[LLMManager] 生成嵌入失败:', error);
      throw error;
    }
  }

  /**
   * 列出可用模型
   */
  async listModels() {
    if (!this.client) {
      return [];
    }

    try {
      const status = await this.client.checkStatus();
      return status.models || [];
    } catch (error) {
      console.error('[LLMManager] 列出模型失败:', error);
      return [];
    }
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log('[LLMManager] 关闭LLM管理器');
    this.conversationContext.clear();
    this.isInitialized = false;
    this.client = null;
    this.emit('closed');
  }
}

// 单例实例
let llmManagerInstance = null;

/**
 * 获取LLM管理器单例
 * @param {Object} config - 配置对象（仅首次调用时生效）
 * @returns {LLMManager}
 */
function getLLMManager(config = {}) {
  if (!llmManagerInstance) {
    llmManagerInstance = new LLMManager(config);
  }
  return llmManagerInstance;
}

module.exports = {
  LLMManager,
  LLMProviders,
  getLLMManager,
};
