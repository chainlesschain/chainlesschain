/**
 * LLM 服务管理器
 *
 * 统一管理不同的LLM服务提供商
 *
 * 🔥 Manus 优化集成 (2026-01-17):
 * - Context Engineering: KV-Cache 友好的 Prompt 构建
 * - Tool Masking: 通过掩码控制工具可用性
 * - Task Tracking: 任务目标重述机制
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

const EventEmitter = require("events");
const OllamaClient = require("./ollama-client");
const { OpenAIClient, DeepSeekClient } = require("./openai-client");
const { AnthropicClient } = require("./anthropic-client");
const { getModelSelector, TaskTypes } = require("./volcengine-models");
const { VolcengineToolsClient } = require("./volcengine-tools");

// 🔥 Manus 优化模块
const { getManusOptimizations } = require("./manus-optimizations");

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

      // 🔥 监听预算告警事件
      this.tokenTracker.on("budget-alert", this._handleBudgetAlert.bind(this));
    }

    // 🔥 响应缓存（可选）
    this.responseCache = config.responseCache || null;
    if (this.responseCache) {
      console.log("[LLMManager] 响应缓存已启用");
    }

    // 🔥 Prompt 压缩器（可选）
    this.promptCompressor = config.promptCompressor || null;
    if (this.promptCompressor) {
      console.log("[LLMManager] Prompt 压缩已启用");
    }

    // 🔥 暂停标志（预算超限时）
    this.paused = false;

    // 🔥 预算配置缓存（用于自动切换模型）
    this.budgetConfig = null;

    // 🔥 Manus 优化（Context Engineering + Tool Masking）
    this.manusOptimizations = null;
    if (config.enableManusOptimizations !== false) {
      try {
        this.manusOptimizations = getManusOptimizations({
          enableKVCacheOptimization: config.enableKVCacheOptimization !== false,
          enableToolMasking: config.enableToolMasking !== false,
          enableTaskTracking: config.enableTaskTracking !== false,
          enableRecoverableCompression: config.enableRecoverableCompression !== false,
          logMaskChanges: config.logMaskChanges !== false,
        });
        console.log("[LLMManager] Manus 优化已启用 (Context Engineering + Tool Masking)");
      } catch (manusError) {
        console.warn("[LLMManager] Manus 优化初始化失败:", manusError.message);
      }
    }
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

    // 🔥 检查服务是否已暂停（预算超限）
    if (this.paused) {
      throw new Error(
        "LLM服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
      );
    }

    const startTime = Date.now();

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
        text: result.text || result.message?.content,
        model: result.model,
        tokens: result.tokens || result.usage?.total_tokens || 0,
        usage: result.usage,
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
    let wasCached = false;
    let wasCompressed = false;
    let compressionRatio = 1.0;
    let processedMessages = messages;

    try {
      // 🔥 步骤 1: 检查响应缓存（如果启用）
      if (this.responseCache && !options.skipCache) {
        const cacheResult = await this.responseCache.get(
          this.provider,
          this.config.model,
          messages,
          options,
        );

        if (cacheResult.hit) {
          console.log("[LLMManager] 缓存命中，跳过 LLM 调用");
          wasCached = true;

          // 🔥 记录 Token 使用（缓存命中）
          if (this.tokenTracker) {
            try {
              await this.tokenTracker.recordUsage({
                conversationId: options.conversationId,
                messageId: options.messageId,
                provider: this.provider,
                model: this.config.model || "unknown",
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                wasCached: true,
                wasCompressed: false,
                compressionRatio: 1.0,
                responseTime: Date.now() - startTime,
                endpoint: options.endpoint,
                userId: options.userId || "default",
              });
            } catch (trackError) {
              console.error("[LLMManager] Token 追踪失败:", trackError);
            }
          }

          return {
            text:
              cacheResult.response.text ||
              cacheResult.response.message?.content,
            message: cacheResult.response.message,
            model: cacheResult.response.model,
            tokens: cacheResult.response.tokens || 0,
            usage: cacheResult.response.usage,
            timestamp: Date.now(),
            wasCached: true,
            tokensSaved: cacheResult.tokensSaved || 0,
          };
        }
      }

      // 🔥 步骤 2: Prompt 压缩（如果启用且未禁用）
      if (
        this.promptCompressor &&
        !options.skipCompression &&
        messages.length > 5
      ) {
        console.log("[LLMManager] 执行 Prompt 压缩...");
        const compressionResult = await this.promptCompressor.compress(
          messages,
          {
            preserveSystemMessage: true,
            preserveLastUserMessage: true,
          },
        );

        processedMessages = compressionResult.messages;
        wasCompressed = true;
        compressionRatio = compressionResult.compressionRatio;

        console.log(
          `[LLMManager] Prompt 已压缩: ${messages.length} → ${processedMessages.length} 条消息, ` +
            `压缩率: ${compressionRatio.toFixed(2)}, 节省 ${compressionResult.tokensSaved} tokens`,
        );
      }

      // 🔥 步骤 3: 调用 LLM API
      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        result = await this.client.chat(processedMessages, options);
      } else {
        // OpenAI兼容的API
        result = await this.client.chat(processedMessages, options);
      }

      this.emit("chat-completed", { messages: processedMessages, result });

      const responseTime = Date.now() - startTime;

      // 🔥 步骤 4: 存入响应缓存（如果启用）
      if (this.responseCache && !options.skipCache && !wasCached) {
        try {
          await this.responseCache.set(
            this.provider,
            this.config.model,
            messages, // 使用原始 messages 作为缓存键
            {
              text: result.message?.content || result.text,
              message: result.message,
              model: result.model,
              tokens: result.tokens || result.usage?.total_tokens || 0,
              usage: result.usage,
            },
            options,
          );
          console.log("[LLMManager] 响应已缓存");
        } catch (cacheError) {
          console.error("[LLMManager] 缓存保存失败:", cacheError);
          // 不阻塞主流程
        }
      }

      // 🔥 步骤 5: 记录 Token 使用
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
            wasCached,
            wasCompressed,
            compressionRatio,
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
        wasCached,
        wasCompressed,
        compressionRatio,
      };
    } catch (error) {
      console.error("[LLMManager] 聊天失败:", error);
      this.emit("chat-failed", { messages: processedMessages, error });
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
    let wasCompressed = false;
    let compressionRatio = 1.0;
    let processedMessages = messages;

    try {
      // 🔥 Prompt 压缩（流式不支持缓存，但支持压缩）
      if (
        this.promptCompressor &&
        !options.skipCompression &&
        messages.length > 5
      ) {
        console.log("[LLMManager] 执行 Prompt 压缩（流式）...");
        const compressionResult = await this.promptCompressor.compress(
          messages,
          {
            preserveSystemMessage: true,
            preserveLastUserMessage: true,
          },
        );

        processedMessages = compressionResult.messages;
        wasCompressed = true;
        compressionRatio = compressionResult.compressionRatio;

        console.log(
          `[LLMManager] Prompt 已压缩（流式）: ${messages.length} → ${processedMessages.length} 条消息, ` +
            `压缩率: ${compressionRatio.toFixed(2)}, 节省 ${compressionResult.tokensSaved} tokens`,
        );
      }

      let result;

      if (this.provider === LLMProviders.OLLAMA) {
        result = await this.client.chatStream(
          processedMessages,
          onChunk,
          options,
        );
      } else {
        // OpenAI兼容的API
        result = await this.client.chatStream(
          processedMessages,
          onChunk,
          options,
        );
      }

      this.emit("chat-stream-completed", {
        messages: processedMessages,
        result,
      });

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
            wasCached: false, // 流式不支持缓存
            wasCompressed,
            compressionRatio,
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
        wasCompressed,
        compressionRatio,
      };
    } catch (error) {
      console.error("[LLMManager] 流式聊天失败:", error);
      this.emit("chat-stream-failed", { messages: processedMessages, error });
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

    // 🔥 检查服务是否已暂停（预算超限）
    if (this.paused) {
      throw new Error(
        "LLM服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
      );
    }

    const startTime = Date.now();

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
        text: result.text || result.message?.content,
        model: result.model,
        tokens: result.tokens || 0,
        usage: result.usage,
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

  // ========================================
  // 🔥 Token 追踪和预算管理 API
  // ========================================

  /**
   * 处理预算告警事件（内部方法）
   * @private
   * @param {Object} alert - 告警详情
   */
  async _handleBudgetAlert(alert) {
    const { level, period, usage, spent, limit } = alert;

    console.warn(
      `[LLMManager] 🚨 预算告警: ${period} 使用率 ${(usage * 100).toFixed(1)}% ($${spent.toFixed(2)}/$${limit})`,
    );

    // 发送告警事件给外部监听器
    this.emit("budget-alert", alert);

    // 如果是 critical 级别且启用了自动暂停
    if (level === "critical" && this.budgetConfig?.auto_pause_on_limit) {
      console.error("[LLMManager] ⛔ 预算超限，自动暂停 LLM 服务");
      this.paused = true;
      this.emit("service-paused", { reason: "budget-exceeded", alert });
    }

    // 如果启用了自动切换到更便宜的模型
    if (
      level === "warning" &&
      this.budgetConfig?.auto_switch_to_cheaper_model
    ) {
      console.warn("[LLMManager] 💡 尝试切换到更便宜的模型");
      await this._switchToCheaperModel();
    }
  }

  /**
   * 切换到更便宜的模型（内部方法）
   * @private
   */
  async _switchToCheaperModel() {
    // 模型成本映射（从低到高）
    const cheaperModels = {
      openai: ["gpt-3.5-turbo", "gpt-4o-mini"],
      anthropic: ["claude-3-haiku-20240307", "claude-3-5-haiku-20241022"],
      deepseek: ["deepseek-chat"],
      volcengine: ["doubao-lite-32k", "doubao-pro-32k"],
    };

    const currentProvider = this.provider;
    const currentModel = this.config.model;

    if (cheaperModels[currentProvider]) {
      const options = cheaperModels[currentProvider];
      const currentIndex = options.indexOf(currentModel);

      // 如果当前不是最便宜的模型，切换到更便宜的
      if (currentIndex > 0) {
        const newModel = options[currentIndex - 1];
        console.log(`[LLMManager] 切换模型: ${currentModel} → ${newModel}`);

        this.config.model = newModel;
        await this.initialize();

        this.emit("model-switched", {
          from: currentModel,
          to: newModel,
          reason: "budget-optimization",
        });
      } else {
        console.warn("[LLMManager] 已经在使用最便宜的模型，无法继续降级");
      }
    }
  }

  /**
   * 恢复被暂停的服务
   * @param {string} userId - 用户 ID
   */
  async resumeService(userId = "default") {
    if (!this.paused) {
      console.warn("[LLMManager] 服务未暂停，无需恢复");
      return { success: false, message: "服务未暂停" };
    }

    console.log("[LLMManager] 恢复 LLM 服务");
    this.paused = false;
    this.emit("service-resumed", { userId });

    return { success: true, message: "服务已恢复" };
  }

  /**
   * 手动暂停服务
   */
  async pauseService() {
    if (this.paused) {
      console.warn("[LLMManager] 服务已经暂停");
      return { success: false, message: "服务已暂停" };
    }

    console.log("[LLMManager] 手动暂停 LLM 服务");
    this.paused = true;
    this.emit("service-paused", { reason: "manual" });

    return { success: true, message: "服务已暂停" };
  }

  /**
   * 获取预算配置
   * @param {string} userId - 用户 ID
   * @returns {Promise<Object>}
   */
  async getBudgetConfig(userId = "default") {
    if (!this.tokenTracker) {
      throw new Error("Token 追踪未启用");
    }

    const config = await this.tokenTracker.getBudgetConfig(userId);
    this.budgetConfig = config; // 缓存配置
    return config;
  }

  /**
   * 保存预算配置
   * @param {string} userId - 用户 ID
   * @param {Object} config - 预算配置
   * @returns {Promise<Object>}
   */
  async saveBudgetConfig(userId = "default", config) {
    if (!this.tokenTracker) {
      throw new Error("Token 追踪未启用");
    }

    const result = await this.tokenTracker.saveBudgetConfig(userId, config);

    // 更新缓存
    this.budgetConfig = await this.tokenTracker.getBudgetConfig(userId);

    return result;
  }

  /**
   * 获取使用统计
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>}
   */
  async getUsageStats(options = {}) {
    if (!this.tokenTracker) {
      throw new Error("Token 追踪未启用");
    }

    return await this.tokenTracker.getUsageStats(options);
  }

  /**
   * 获取时间序列数据（用于图表）
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getTimeSeriesData(options = {}) {
    if (!this.tokenTracker) {
      throw new Error("Token 追踪未启用");
    }

    return await this.tokenTracker.getTimeSeriesData(options);
  }

  /**
   * 获取成本分解（按提供商/模型）
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>}
   */
  async getCostBreakdown(options = {}) {
    if (!this.tokenTracker) {
      throw new Error("Token 追踪未启用");
    }

    return await this.tokenTracker.getCostBreakdown(options);
  }

  /**
   * 导出成本报告
   * @param {Object} options - 导出选项
   * @returns {Promise<string>} CSV 文件路径
   */
  async exportCostReport(options = {}) {
    if (!this.tokenTracker) {
      throw new Error("Token 追踪未启用");
    }

    return await this.tokenTracker.exportCostReport(options);
  }

  /**
   * 计算成本估算（支持多提供商）
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {number} inputTokens - 输入 tokens
   * @param {number} outputTokens - 输出 tokens
   * @param {number} cachedTokens - 缓存 tokens
   * @returns {Object} 成本估算结果
   */
  calculateCostEstimate(
    provider,
    model,
    inputTokens,
    outputTokens,
    cachedTokens = 0,
  ) {
    if (!this.tokenTracker) {
      return { costUsd: 0, costCny: 0, pricing: null };
    }

    return this.tokenTracker.calculateCost(
      provider,
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
    );
  }

  /**
   * 检查是否可以执行操作（预算检查）
   * @param {number} estimatedTokens - 预估 token 数量
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }
   */
  async canPerformOperation(estimatedTokens = 0) {
    if (this.paused) {
      return {
        allowed: false,
        reason: "服务已暂停：预算超限。请前往设置页面调整预算或恢复服务。",
      };
    }

    if (!this.tokenTracker) {
      return { allowed: true };
    }

    // 估算成本
    const estimate = this.calculateCostEstimate(
      this.provider,
      this.config.model,
      estimatedTokens,
      estimatedTokens,
    );

    // 获取当前预算状态
    const budgetConfig = await this.getBudgetConfig();
    if (!budgetConfig) {
      return { allowed: true };
    }

    // 检查是否会超出预算
    const dailyRemaining =
      (budgetConfig.daily_limit_usd || Infinity) -
      (budgetConfig.current_daily_spend || 0);
    const monthlyRemaining =
      (budgetConfig.monthly_limit_usd || Infinity) -
      (budgetConfig.current_monthly_spend || 0);

    if (estimate.costUsd > dailyRemaining) {
      return {
        allowed: false,
        reason: `操作预估成本 $${estimate.costUsd.toFixed(4)} 超出每日剩余预算 $${dailyRemaining.toFixed(4)}`,
      };
    }

    if (estimate.costUsd > monthlyRemaining) {
      return {
        allowed: false,
        reason: `操作预估成本 $${estimate.costUsd.toFixed(4)} 超出每月剩余预算 $${monthlyRemaining.toFixed(4)}`,
      };
    }

    return { allowed: true };
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log("[LLMManager] 关闭LLM管理器");

    // 移除 TokenTracker 监听器
    if (this.tokenTracker) {
      this.tokenTracker.removeAllListeners("budget-alert");
    }

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

// ==========================================
// 🔥 Manus 优化 API
// ==========================================

/**
 * 构建优化后的 Prompt（KV-Cache 友好）
 *
 * @param {Object} options - 构建选项
 * @param {string} options.systemPrompt - 系统提示词
 * @param {Array} options.messages - 对话历史
 * @param {Array} options.tools - 工具定义（可选）
 * @returns {Object} 优化后的消息和元数据
 */
LLMManager.prototype.buildOptimizedPrompt = function (options) {
  if (!this.manusOptimizations) {
    // 不优化，返回基础消息
    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    if (options.messages) {
      messages.push(...options.messages);
    }
    return { messages, metadata: { optimized: false } };
  }

  return this.manusOptimizations.buildOptimizedPrompt(options);
};

/**
 * 使用优化后的 Prompt 进行对话
 *
 * @param {Array} messages - 消息数组
 * @param {Object} options - 选项
 * @param {string} options.systemPrompt - 系统提示词
 * @param {Array} options.tools - 工具定义
 * @returns {Promise<Object>} 对话结果
 */
LLMManager.prototype.chatWithOptimizedPrompt = async function (messages, options = {}) {
  // 构建优化 Prompt
  const optimized = this.buildOptimizedPrompt({
    systemPrompt: options.systemPrompt,
    messages,
    tools: options.tools,
  });

  // 使用优化后的消息进行对话
  const result = await this.chatWithMessages(optimized.messages, {
    ...options,
    skipCompression: true, // 已经优化过，跳过额外压缩
  });

  return {
    ...result,
    promptOptimization: optimized.metadata,
  };
};

/**
 * 开始任务追踪（Manus todo.md 机制）
 *
 * @param {Object} task - 任务信息
 * @param {string} task.objective - 任务目标
 * @param {Array} task.steps - 任务步骤
 * @returns {Object} 任务信息
 */
LLMManager.prototype.startTask = function (task) {
  if (!this.manusOptimizations) {
    console.warn("[LLMManager] Manus 优化未启用，无法追踪任务");
    return null;
  }
  return this.manusOptimizations.startTask(task);
};

/**
 * 更新任务进度
 *
 * @param {number} stepIndex - 当前步骤索引
 * @param {string} status - 状态
 */
LLMManager.prototype.updateTaskProgress = function (stepIndex, status) {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.updateTaskProgress(stepIndex, status);
};

/**
 * 完成当前步骤
 */
LLMManager.prototype.completeCurrentStep = function () {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.completeCurrentStep();
};

/**
 * 完成任务
 */
LLMManager.prototype.completeTask = function () {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.completeTask();
};

/**
 * 取消任务
 */
LLMManager.prototype.cancelTask = function () {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.cancelTask();
};

/**
 * 获取当前任务
 * @returns {Object|null} 当前任务
 */
LLMManager.prototype.getCurrentTask = function () {
  if (!this.manusOptimizations) return null;
  return this.manusOptimizations.getCurrentTask();
};

/**
 * 记录错误（供模型学习）
 * @param {Object} error - 错误信息
 */
LLMManager.prototype.recordError = function (error) {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.recordError(error);
};

/**
 * 设置工具可用性
 * @param {string} toolName - 工具名称
 * @param {boolean} available - 是否可用
 */
LLMManager.prototype.setToolAvailable = function (toolName, available) {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.setToolAvailable(toolName, available);
};

/**
 * 按前缀设置工具可用性
 * @param {string} prefix - 工具前缀
 * @param {boolean} available - 是否可用
 */
LLMManager.prototype.setToolsByPrefix = function (prefix, available) {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.setToolsByPrefix(prefix, available);
};

/**
 * 验证工具调用
 * @param {string} toolName - 工具名称
 * @returns {Object} 验证结果
 */
LLMManager.prototype.validateToolCall = function (toolName) {
  if (!this.manusOptimizations) {
    return { allowed: true };
  }
  return this.manusOptimizations.validateToolCall(toolName);
};

/**
 * 配置任务阶段状态机
 * @param {Object} config - 状态机配置（可选）
 */
LLMManager.prototype.configureTaskPhases = function (config) {
  if (!this.manusOptimizations) return;
  this.manusOptimizations.configureTaskPhases(config);
};

/**
 * 切换到指定阶段
 * @param {string} phase - 阶段名称
 * @returns {boolean} 是否成功
 */
LLMManager.prototype.transitionToPhase = function (phase) {
  if (!this.manusOptimizations) return false;
  return this.manusOptimizations.transitionToPhase(phase);
};

/**
 * 获取 Manus 优化统计
 * @returns {Object} 统计数据
 */
LLMManager.prototype.getManusStats = function () {
  if (!this.manusOptimizations) {
    return { enabled: false };
  }
  return {
    enabled: true,
    ...this.manusOptimizations.getStats(),
  };
};

/**
 * 压缩内容（可恢复压缩）
 * @param {any} content - 原始内容
 * @param {string} type - 内容类型
 * @returns {Object} 压缩后的引用
 */
LLMManager.prototype.compressContent = function (content, type) {
  if (!this.manusOptimizations) return content;
  return this.manusOptimizations.compress(content, type);
};

module.exports = {
  LLMManager,
  LLMProviders,
  getLLMManager,
  TaskTypes, // 导出任务类型枚举，方便外部使用
};
