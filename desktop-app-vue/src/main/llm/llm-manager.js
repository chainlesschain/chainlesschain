/**
 * LLM 服务管理器
 *
 * 统一管理不同的LLM服务提供商
 */

const EventEmitter = require('events');
const OllamaClient = require('./ollama-client');
const { OpenAIClient, DeepSeekClient } = require('./openai-client');
const { AnthropicClient } = require('./anthropic-client');

/**
 * LLM 提供商类型
 */
const LLMProviders = {
  OLLAMA: 'ollama',
  OPENAI: 'openai',
  DEEPSEEK: 'deepseek',
  VOLCENGINE: 'volcengine',
  ANTHROPIC: 'anthropic',
  CLAUDE: 'claude',
  CUSTOM: 'custom',
};

const normalizeProvider = (provider) => {
  if (!provider) return provider;
  if (provider === LLMProviders.CLAUDE) {
    return LLMProviders.ANTHROPIC;
  }
  return provider;
};

/**
 * LLM管理器类
 */
class LLMManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.provider = normalizeProvider(config.provider) || LLMProviders.OLLAMA;
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
        // 检查服务状态（不阻塞初始化）
        try {
          const status = await this.client.checkStatus();

          if (status.available) {
            this.isInitialized = true;
            console.log('[LLMManager] LLM服务可用');
            console.log('[LLMManager] 可用模型数:', status.models?.length || 0);
            this.emit('initialized', status);
          } else {
            console.warn('[LLMManager] LLM服务状态检查失败:', status.error);
            // 即使状态检查失败，也标记为已初始化（允许后续调用时重试）
            this.isInitialized = true;
            this.emit('unavailable', status);
          }
        } catch (statusError) {
          console.warn('[LLMManager] 无法检查服务状态（将在实际调用时重试）:', statusError.message);
          // 即使状态检查失败，也标记为已初始化（允许后续调用时重试）
          this.isInitialized = true;
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
    const normalizedProvider = normalizeProvider(provider);

    switch (normalizedProvider) {
      case LLMProviders.OLLAMA:
        return new OllamaClient({
          baseURL: this.config.ollamaURL || 'http://localhost:11434',
          model: this.config.model || 'llama2',
          timeout: this.config.timeout,
        });

      case LLMProviders.ANTHROPIC:
        return new AnthropicClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL || 'https://api.anthropic.com',
          model: this.config.model || 'claude-3-opus-20240229',
          timeout: this.config.timeout,
          anthropicVersion: this.config.anthropicVersion,
          maxTokens: this.config.maxTokens,
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
      this.provider = normalizeProvider(provider);
      this.config = { ...this.config, ...config };

      await this.initialize();

      this.emit('provider-changed', this.provider);

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

/**
 * 为LLMManager添加AI标签生成和摘要生成功能
 */
LLMManager.prototype.generateTags = async function({ title, content, url }) {
  if (!this.isInitialized) {
    console.warn('[LLMManager] LLM服务未初始化，使用fallback');
    // Fallback: 简单的关键词提取
    return this.generateTagsFallback({ title, content, url });
  }

  try {
    // 限制内容长度
    const limitedContent = content.substring(0, 500);

    const prompt = `分析以下网页内容，生成3-5个最相关的标签（中文或英文）。
只返回标签列表，用逗号分隔，不要其他内容。

标题: ${title}
URL: ${url}
内容: ${limitedContent}

标签:`;

    const result = await this.query(prompt, {
      temperature: 0.3,
      max_tokens: 50,
    });

    // 解析标签
    const responseText = result.text || result.message?.content || '';
    const tags = responseText
      .split(/[,，、]/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length < 20)
      .slice(0, 5);

    console.log('[LLMManager] AI生成标签:', tags);
    return tags;
  } catch (error) {
    console.error('[LLMManager] 标签生成失败:', error);
    // Fallback
    return this.generateTagsFallback({ title, content, url });
  }
};

/**
 * Fallback标签生成（简单关键词提取）
 */
LLMManager.prototype.generateTagsFallback = function({ title, content, url }) {
  const tags = [];

  // 从URL提取域名
  if (url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.split('.').slice(-2, -1)[0];
      if (domain) {
        tags.push(domain);
      }
    } catch (e) {
      // 忽略
    }
  }

  // 从标题提取关键词
  if (title) {
    const keywords = ['教程', '指南', '文档', '博客', '新闻', '技术', '开发', 'Tutorial', 'Guide', 'Documentation', 'Blog'];
    for (const keyword of keywords) {
      if (title.toLowerCase().includes(keyword.toLowerCase())) {
        tags.push(keyword);
        if (tags.length >= 3) break;
      }
    }
  }

  return tags.slice(0, 3);
};

/**
 * 生成内容摘要
 */
LLMManager.prototype.generateSummary = async function({ title, content }) {
  if (!this.isInitialized) {
    console.warn('[LLMManager] LLM服务未初始化，使用fallback');
    // Fallback: 简单截取
    return this.generateSummaryFallback({ content });
  }

  try {
    // 限制内容长度
    const limitedContent = content.substring(0, 3000);

    const prompt = `请为以下文章生成一段简洁的摘要（100-200字）。
只返回摘要内容，不要其他说明。

标题: ${title}
内容: ${limitedContent}

摘要:`;

    const result = await this.query(prompt, {
      temperature: 0.5,
      max_tokens: 300,
    });

    const summary = (result.text || result.message?.content || '').trim();

    console.log('[LLMManager] AI生成摘要:', summary.substring(0, 50) + '...');
    return summary;
  } catch (error) {
    console.error('[LLMManager] 摘要生成失败:', error);
    // Fallback
    return this.generateSummaryFallback({ content });
  }
};

/**
 * Fallback摘要生成（简单截取）
 */
LLMManager.prototype.generateSummaryFallback = function({ content }) {
  // 提取纯文本（去除HTML）
  const textContent = content.replace(/<[^>]*>/g, '').trim();

  // 取前200字
  const summary = textContent.substring(0, 200);

  return summary + (textContent.length > 200 ? '...' : '');
};

module.exports = {
  LLMManager,
  LLMProviders,
  getLLMManager,
};
