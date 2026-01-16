/**
 * LLM 服务管理器
 *
 * 统一管理不同的LLM服务提供商
 */

const EventEmitter = require("events");
const OllamaClient = require("./ollama-client");
const { OpenAIClient, DeepSeekClient } = require("./openai-client");
const { AnthropicClient } = require("./anthropic-client");
const { getModelSelector, TaskTypes } = require("./volcengine-models");
const { VolcengineToolsClient } = require("./volcengine-tools");

/**
 * LLM 提供商类型
 */
const LLMProviders = {
  OLLAMA: "ollama",
  OPENAI: "openai",
  DEEPSEEK: "deepseek",
  VOLCENGINE: "volcengine",
  ANTHROPIC: "anthropic",
  CLAUDE: "claude",
  CUSTOM: "custom",
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

    // 火山引擎工具调用客户端
    this.toolsClient = null;

    // Token 追踪器（可选）
    this.tokenTracker = config.tokenTracker || null;
    if (this.tokenTracker) {
      console.log("[LLMManager] Token 追踪已启用");
    }

    // 🔥 暂停标志（预算超限时）
    this.paused = false;
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    console.log("[LLMManager] 初始化LLM管理器...");
    console.log("[LLMManager] 提供商:", this.provider);

    try {
      this.client = await this.createClient(this.provider);

      // 🔥 初始化火山引擎工具调用客户端
      if (this.provider === LLMProviders.VOLCENGINE) {
        try {
          this.toolsClient = new VolcengineToolsClient({
            apiKey: this.config.apiKey,
            baseURL:
              this.config.baseURL || "https://ark.cn-beijing.volces.com/api/v3",
            model: this.config.model || "doubao-seed-1.6-lite",
          });
          console.log("[LLMManager] 火山引擎工具调用客户端已初始化");
        } catch (toolsError) {
          console.warn(
            "[LLMManager] 工具调用客户端初始化失败:",
            toolsError.message,
          );
        }
      }

      if (this.client) {
        // 检查服务状态（不阻塞初始化）
        try {
          const status = await this.client.checkStatus();

          if (status.available) {
            this.isInitialized = true;
            console.log("[LLMManager] LLM服务可用");
            console.log("[LLMManager] 可用模型数:", status.models?.length || 0);
            this.emit("initialized", status);
          } else {
            console.warn("[LLMManager] LLM服务状态检查失败:", status.error);
            // 即使状态检查失败，也标记为已初始化（允许后续调用时重试）
            this.isInitialized = true;
            this.emit("unavailable", status);
          }
        } catch (statusError) {
          console.warn(
            "[LLMManager] 无法检查服务状态（将在实际调用时重试）:",
            statusError.message,
          );
          // 即使状态检查失败，也标记为已初始化（允许后续调用时重试）
          this.isInitialized = true;
        }
      }

      return this.isInitialized;
    } catch (error) {
      console.error("[LLMManager] 初始化失败:", error);
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
          baseURL: this.config.ollamaURL || "http://localhost:11434",
          model: this.config.model || "llama2",
          timeout: this.config.timeout,
        });

      case LLMProviders.ANTHROPIC:
        return new AnthropicClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL || "https://api.anthropic.com",
          model: this.config.model || "claude-3-opus-20240229",
          timeout: this.config.timeout,
          anthropicVersion: this.config.anthropicVersion,
          maxTokens: this.config.maxTokens,
        });

      case LLMProviders.OPENAI:
        return new OpenAIClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
          model: this.config.model || "gpt-3.5-turbo",
          embeddingModel:
            this.config.embeddingModel || "text-embedding-ada-002",
          organization: this.config.organization,
          timeout: this.config.timeout,
        });

      case LLMProviders.DEEPSEEK:
        return new DeepSeekClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
          model: this.config.model || "deepseek-chat",
          embeddingModel:
            this.config.embeddingModel || "text-embedding-ada-002",
          timeout: this.config.timeout,
        });

      case LLMProviders.VOLCENGINE:
        return new OpenAIClient({
          apiKey: this.config.apiKey,
          baseURL:
            this.config.baseURL || "https://ark.cn-beijing.volces.com/api/v3",
          model: this.config.model || "doubao-seed-1.6-lite",
          embeddingModel:
            this.config.embeddingModel || "doubao-embedding-large",
          timeout: this.config.timeout,
        });

      case LLMProviders.CUSTOM:
        return new OpenAIClient({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
          model: this.config.model,
          embeddingModel: this.config.embeddingModel,
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
    console.log("[LLMManager] 切换提供商:", provider);

    try {
      this.provider = normalizeProvider(provider);
      this.config = { ...this.config, ...config };

      await this.initialize();

      this.emit("provider-changed", this.provider);

      return true;
    } catch (error) {
      console.error("[LLMManager] 切换提供商失败:", error);
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
        error: "LLM服务未初始化",
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
      throw new Error("LLM服务未初始化");
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
            { role: "user", content: prompt },
          ];

          result = await this.client.chat(messages, options);

          // 更新上下文
          context.messages.push(
            { role: "user", content: prompt },
            result.message,
          );
        } else {
          // 无上下文，使用generate
          result = await this.client.generate(prompt, options);

          // 创建上下文
          if (conversationId) {
            this.conversationContext.set(conversationId, {
              messages: [
                { role: "user", content: prompt },
                { role: "assistant", content: result.text },
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
          messages.unshift({ role: "system", content: options.systemPrompt });
        }

        messages.push({ role: "user", content: prompt });

        result = await this.client.chat(messages, options);

        // 更新上下文
        if (conversationId) {
          if (!this.conversationContext.has(conversationId)) {
            this.conversationContext.set(conversationId, { messages: [] });
          }
          const context = this.conversationContext.get(conversationId);
          context.messages.push(
            { role: "user", content: prompt },
            result.message,
          );
        }
      }

      this.emit("query-completed", { prompt, result });

      return {
        text: result.text || result.message?.content,
        model: result.model,
        tokens: result.tokens || result.usage?.total_tokens || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[LLMManager] 查询失败:", error);
      this.emit("query-failed", { prompt, error });
      throw error;
    }
  }

  /**
   * 向后兼容：聊天对话（消息数组）
   * @param {Array} messages
   * @param {Object} options
   */
  async chat(messages, options = {}) {
    if (!Array.isArray(messages)) {
      throw new Error("messages必须是数组");
    }

    const result = await this.chatWithMessages(messages, options);
    return {
      ...result,
      content: result.message?.content || result.text,
    };
  }

  /**
   * 向后兼容：聊天对话（流式）
   * @param {Array} messages
   * @param {Function} onChunk
   * @param {Object} options
   */
  async chatStream(messages, onChunk, options = {}) {
    if (!Array.isArray(messages)) {
      throw new Error("messages必须是数组");
    }
    if (typeof onChunk !== "function") {
      throw new Error("onChunk回调是必需的");
    }

    const result = await this.chatWithMessagesStream(
      messages,
      onChunk,
      options,
    );
    return {
      ...result,
      content: result.message?.content || result.text,
    };
  }

  /**
   * 聊天对话（支持完整messages数组，非流式）
   * @param {Array} messages - 消息数组 [{role: 'user'|'assistant'|'system', content: string}]
   * @param {Object} options - 选项
   */
  async chatWithMessages(messages, options = {}) {
    if (!this.isInitialized) {
      throw new Error("LLM服务未初始化");
    }

    // 🔥 检查服务是否已暂停（预算超限）
    if (this.paused) {
      throw new Error(
        "LLM服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
      );
    }

    const startTime = Date.now();

    try {
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        result = await this.client.chat(messages, options);
      } else {
        // OpenAI兼容的API
        result = await this.client.chat(messages, options);
      }

      this.emit("chat-completed", { messages, result });

      const responseTime = Date.now() - startTime;

      // 🔥 记录 Token 使用
      if (this.tokenTracker) {
        try {
          await this.tokenTracker.recordUsage({
            conversationId: options.conversationId,
            messageId: options.messageId,
            provider: this.provider,
            model: result.model || this.config.model || "unknown",
            inputTokens: result.usage?.prompt_tokens || 0,
            outputTokens: result.usage?.completion_tokens || 0,
            cachedTokens: result.usage?.cached_tokens || 0,
            wasCached: options.wasCached || false,
            wasCompressed: options.wasCompressed || false,
            compressionRatio: options.compressionRatio || 1.0,
            responseTime,
            endpoint: options.endpoint,
            userId: options.userId || "default",
          });
        } catch (trackError) {
          console.error("[LLMManager] Token 追踪失败:", trackError);
          // 不阻塞主流程
        }
      }

      return {
        text: result.message?.content || result.text,
        message: result.message,
        model: result.model,
        tokens: result.tokens || result.usage?.total_tokens || 0,
        usage: result.usage,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[LLMManager] 聊天失败:", error);
      this.emit("chat-failed", { messages, error });
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
      throw new Error("LLM服务未初始化");
    }

    // 🔥 检查服务是否已暂停（预算超限）
    if (this.paused) {
      throw new Error(
        "LLM服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
      );
    }

    const startTime = Date.now();

    try {
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        result = await this.client.chatStream(messages, onChunk, options);
      } else {
        // OpenAI兼容的API
        result = await this.client.chatStream(messages, onChunk, options);
      }

      this.emit("chat-stream-completed", { messages, result });

      const responseTime = Date.now() - startTime;

      // 🔥 记录 Token 使用
      if (this.tokenTracker) {
        try {
          await this.tokenTracker.recordUsage({
            conversationId: options.conversationId,
            messageId: options.messageId,
            provider: this.provider,
            model: result.model || this.config.model || "unknown",
            inputTokens: result.usage?.prompt_tokens || 0,
            outputTokens: result.usage?.completion_tokens || 0,
            cachedTokens: result.usage?.cached_tokens || 0,
            wasCached: options.wasCached || false,
            wasCompressed: options.wasCompressed || false,
            compressionRatio: options.compressionRatio || 1.0,
            responseTime,
            endpoint: options.endpoint,
            userId: options.userId || "default",
          });
        } catch (trackError) {
          console.error("[LLMManager] Token 追踪失败:", trackError);
          // 不阻塞主流程
        }
      }

      return {
        text: result.message?.content || result.text,
        message: result.message,
        model: result.model,
        tokens: result.tokens || 0,
        usage: result.usage,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[LLMManager] 流式聊天失败:", error);
      this.emit("chat-stream-failed", { messages, error });
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
      throw new Error("LLM服务未初始化");
    }

    try {
      const conversationId = options.conversationId;
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        if (conversationId && this.conversationContext.has(conversationId)) {
          const context = this.conversationContext.get(conversationId);
          const messages = [
            ...context.messages,
            { role: "user", content: prompt },
          ];

          result = await this.client.chatStream(messages, onChunk, options);

          context.messages.push(
            { role: "user", content: prompt },
            result.message,
          );
        } else {
          result = await this.client.generateStream(prompt, onChunk, options);

          if (conversationId) {
            this.conversationContext.set(conversationId, {
              messages: [
                { role: "user", content: prompt },
                { role: "assistant", content: result.text },
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
          messages.unshift({ role: "system", content: options.systemPrompt });
        }

        messages.push({ role: "user", content: prompt });

        result = await this.client.chatStream(messages, onChunk, options);

        if (conversationId) {
          if (!this.conversationContext.has(conversationId)) {
            this.conversationContext.set(conversationId, { messages: [] });
          }
          const context = this.conversationContext.get(conversationId);
          context.messages.push(
            { role: "user", content: prompt },
            result.message,
          );
        }
      }

      this.emit("stream-completed", { prompt, result });

      return {
        text: result.text || result.message?.content,
        model: result.model,
        tokens: result.tokens || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[LLMManager] 流式查询失败:", error);
      this.emit("stream-failed", { prompt, error });
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
      throw new Error("LLM服务未初始化");
    }

    try {
      return await this.client.embeddings(text);
    } catch (error) {
      console.error("[LLMManager] 生成嵌入失败:", error);
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
      console.error("[LLMManager] 列出模型失败:", error);
      return [];
    }
  }

  /**
   * 智能选择模型（仅限火山引擎）
   * @param {Object} scenario - 场景描述
   * @returns {Object} 推荐的模型配置
   */
  selectVolcengineModel(scenario = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      console.warn(
        "[LLMManager] 智能选择器仅支持火山引擎，当前提供商:",
        this.provider,
      );
      return null;
    }

    const selector = getModelSelector();
    const model = selector.selectByScenario(scenario);

    console.log("[LLMManager] 智能选择模型:", model.name);
    console.log("[LLMManager] 模型ID:", model.id);
    console.log("[LLMManager] 能力:", model.capabilities);
    console.log("[LLMManager] 价格:", model.pricing);

    return {
      modelId: model.id,
      modelName: model.name,
      capabilities: model.capabilities,
      pricing: model.pricing,
      description: model.description,
      contextLength: model.contextLength,
      maxOutputTokens: model.maxOutputTokens,
    };
  }

  /**
   * 根据任务类型智能选择模型
   * @param {string} taskType - 任务类型（来自 TaskTypes）
   * @param {Object} options - 选项
   * @returns {Object} 推荐的模型配置
   */
  selectModelByTask(taskType, options = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      console.warn(
        "[LLMManager] 智能选择器仅支持火山引擎，当前提供商:",
        this.provider,
      );
      return null;
    }

    const selector = getModelSelector();
    const model = selector.selectModel(taskType, options);

    console.log("[LLMManager] 为任务", taskType, "选择模型:", model.name);

    return {
      modelId: model.id,
      modelName: model.name,
      capabilities: model.capabilities,
      pricing: model.pricing,
      description: model.description,
    };
  }

  /**
   * 估算成本（仅限火山引擎）
   * @param {string} modelId - 模型ID
   * @param {number} inputTokens - 输入tokens
   * @param {number} outputTokens - 输出tokens
   * @param {number} imageCount - 图片数量
   * @returns {number} 预估成本（人民币）
   */
  estimateCost(modelId, inputTokens = 0, outputTokens = 0, imageCount = 0) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      console.warn(
        "[LLMManager] 成本估算仅支持火山引擎，当前提供商:",
        this.provider,
      );
      return 0;
    }

    const selector = getModelSelector();
    const cost = selector.estimateCost(
      modelId,
      inputTokens,
      outputTokens,
      imageCount,
    );

    console.log("[LLMManager] 成本估算:");
    console.log("  模型:", modelId);
    console.log("  输入tokens:", inputTokens);
    console.log("  输出tokens:", outputTokens);
    console.log("  图片数量:", imageCount);
    console.log("  预估成本: ¥", cost.toFixed(4));

    return cost;
  }

  /**
   * 列出火山引擎所有可用模型
   * @param {Object} filters - 过滤条件
   * @returns {Array} 模型列表
   */
  listVolcengineModels(filters = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      console.warn(
        "[LLMManager] 模型列表仅支持火山引擎，当前提供商:",
        this.provider,
      );
      return [];
    }

    const selector = getModelSelector();
    return selector.listModels(filters);
  }

  // ========================================
  // 🔥 火山引擎工具调用功能
  // ========================================

  /**
   * 启用联网搜索的对话
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithWebSearch(messages, options = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      throw new Error("联网搜索仅支持火山引擎");
    }

    if (!this.toolsClient) {
      throw new Error("火山引擎工具调用客户端未初始化");
    }

    console.log("[LLMManager] 使用联网搜索对话");
    return await this.toolsClient.chatWithWebSearch(messages, options);
  }

  /**
   * 启用图像处理的对话
   * @param {Array} messages - 消息数组（需包含图像URL）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithImageProcess(messages, options = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      throw new Error("图像处理仅支持火山引擎");
    }

    if (!this.toolsClient) {
      throw new Error("火山引擎工具调用客户端未初始化");
    }

    console.log("[LLMManager] 使用图像处理对话");
    return await this.toolsClient.chatWithImageProcess(messages, options);
  }

  /**
   * 使用知识库增强的对话
   * @param {Array} messages - 消息数组
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithKnowledgeBase(messages, knowledgeBaseId, options = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      throw new Error("知识库搜索仅支持火山引擎");
    }

    if (!this.toolsClient) {
      throw new Error("火山引擎工具调用客户端未初始化");
    }

    console.log("[LLMManager] 使用知识库搜索对话");
    return await this.toolsClient.chatWithKnowledgeBase(
      messages,
      knowledgeBaseId,
      options,
    );
  }

  /**
   * Function Calling 对话
   * @param {Array} messages - 消息数组
   * @param {Array} functions - 可用函数列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应
   */
  async chatWithFunctionCalling(messages, functions, options = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      throw new Error("函数调用仅支持火山引擎");
    }

    if (!this.toolsClient) {
      throw new Error("火山引擎工具调用客户端未初始化");
    }

    console.log("[LLMManager] 使用函数调用对话");
    return await this.toolsClient.chatWithFunctionCalling(
      messages,
      functions,
      options,
    );
  }

  /**
   * 混合多种工具的对话（智能组合）
   * @param {Array} messages - 消息数组
   * @param {Object} toolConfig - 工具配置
   * @returns {Promise<Object>} API响应
   */
  async chatWithMultipleTools(messages, toolConfig = {}) {
    if (this.provider !== LLMProviders.VOLCENGINE) {
      throw new Error("工具调用仅支持火山引擎");
    }

    if (!this.toolsClient) {
      throw new Error("火山引擎工具调用客户端未初始化");
    }

    console.log("[LLMManager] 使用多种工具对话");
    return await this.toolsClient.chatWithMultipleTools(messages, toolConfig);
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log("[LLMManager] 关闭LLM管理器");
    this.conversationContext.clear();
    this.isInitialized = false;
    this.client = null;
    this.emit("closed");
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
LLMManager.prototype.generateTags = async function ({ title, content, url }) {
  if (!this.isInitialized) {
    console.warn("[LLMManager] LLM服务未初始化，使用fallback");
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
    const responseText = result.text || result.message?.content || "";
    const tags = responseText
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length < 20)
      .slice(0, 5);

    console.log("[LLMManager] AI生成标签:", tags);
    return tags;
  } catch (error) {
    console.error("[LLMManager] 标签生成失败:", error);
    // Fallback
    return this.generateTagsFallback({ title, content, url });
  }
};

/**
 * Fallback标签生成（简单关键词提取）
 */
LLMManager.prototype.generateTagsFallback = function ({ title, content, url }) {
  const tags = [];

  // 从URL提取域名
  if (url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.split(".").slice(-2, -1)[0];
      if (domain) {
        tags.push(domain);
      }
    } catch (e) {
      // 忽略
    }
  }

  // 从标题提取关键词
  if (title) {
    const keywords = [
      "教程",
      "指南",
      "文档",
      "博客",
      "新闻",
      "技术",
      "开发",
      "Tutorial",
      "Guide",
      "Documentation",
      "Blog",
    ];
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
LLMManager.prototype.generateSummary = async function ({ title, content }) {
  if (!this.isInitialized) {
    console.warn("[LLMManager] LLM服务未初始化，使用fallback");
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

    const summary = (result.text || result.message?.content || "").trim();

    console.log("[LLMManager] AI生成摘要:", summary.substring(0, 50) + "...");
    return summary;
  } catch (error) {
    console.error("[LLMManager] 摘要生成失败:", error);
    // Fallback
    return this.generateSummaryFallback({ content });
  }
};

/**
 * Fallback摘要生成（简单截取）
 */
LLMManager.prototype.generateSummaryFallback = function ({ content }) {
  // 提取纯文本（去除HTML）
  const textContent = content.replace(/<[^>]*>/g, "").trim();

  // 取前200字
  const summary = textContent.substring(0, 200);

  return summary + (textContent.length > 200 ? "..." : "");
};

module.exports = {
  LLMManager,
  LLMProviders,
  getLLMManager,
  TaskTypes, // 导出任务类型枚举，方便外部使用
};
