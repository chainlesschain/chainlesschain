import { defineStore } from 'pinia';

export const useLLMStore = defineStore('llm', {
  state: () => ({
    // 服务状态
    status: {
      available: false,
      provider: '',
      models: [],
      error: null,
    },

    // 配置
    config: {
      provider: 'ollama',

      ollama: {
        url: 'http://localhost:11434',
        model: 'llama2',
      },

      openai: {
        apiKey: '',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo',
        organization: '',
      },

      deepseek: {
        apiKey: '',
        model: 'deepseek-chat',
      },

      custom: {
        name: 'Custom Provider',
        apiKey: '',
        baseURL: '',
        model: '',
      },

      options: {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        max_tokens: 2000,
        timeout: 120000,
      },

      systemPrompt: 'You are a helpful AI assistant for a knowledge management system.',
      streamEnabled: true,
      autoSaveConversations: true,
    },

    // 当前会话
    currentConversationId: null,

    // 查询状态
    isQuerying: false,
    isStreaming: false,

    // 流式响应临时数据
    streamingText: '',
    streamingMessageId: null,

    // 最后查询时间
    lastQueryTime: null,

    // 统计信息
    stats: {
      totalQueries: 0,
      totalTokens: 0,
      averageResponseTime: 0,
    },
  }),

  getters: {
    // 当前提供商
    currentProvider: (state) => state.config.provider,

    // 当前提供商配置
    currentProviderConfig: (state) => {
      switch (state.config.provider) {
        case 'ollama':
          return state.config.ollama;
        case 'openai':
          return state.config.openai;
        case 'deepseek':
          return state.config.deepseek;
        case 'custom':
          return state.config.custom;
        default:
          return {};
      }
    },

    // 当前模型
    currentModel: (state) => {
      const providerConfig = state.config[state.config.provider];
      return providerConfig?.model || '';
    },

    // 是否可用
    isAvailable: (state) => state.status.available,

    // 是否正在工作
    isBusy: (state) => state.isQuerying || state.isStreaming,

    // 提供商显示名称
    providerDisplayName: (state) => {
      const names = {
        ollama: 'Ollama (本地)',
        openai: 'OpenAI',
        deepseek: 'DeepSeek',
        custom: state.config.custom.name || '自定义API',
      };
      return names[state.config.provider] || state.config.provider;
    },
  },

  actions: {
    // 加载配置
    async loadConfig() {
      try {
        const config = await window.electronAPI.llm.getConfig();
        if (config) {
          this.config = config;
        }
      } catch (error) {
        console.error('加载LLM配置失败:', error);
        throw error;
      }
    },

    // 保存配置
    async saveConfig(config) {
      try {
        await window.electronAPI.llm.setConfig(config || this.config);
        if (config) {
          this.config = config;
        }
      } catch (error) {
        console.error('保存LLM配置失败:', error);
        throw error;
      }
    },

    // 更新配置
    updateConfig(updates) {
      this.config = { ...this.config, ...updates };
    },

    // 更新提供商配置
    updateProviderConfig(provider, config) {
      if (this.config[provider]) {
        this.config[provider] = { ...this.config[provider], ...config };
      }
    },

    // 切换提供商
    async switchProvider(provider) {
      this.config.provider = provider;
      await this.saveConfig();
      await this.checkStatus();
    },

    // 检查服务状态
    async checkStatus() {
      try {
        const status = await window.electronAPI.llm.checkStatus();
        this.status = status;
        return status;
      } catch (error) {
        console.error('检查LLM状态失败:', error);
        this.status = {
          available: false,
          provider: this.config.provider,
          models: [],
          error: error.message,
        };
        throw error;
      }
    },

    // 列出可用模型
    async listModels() {
      try {
        const models = await window.electronAPI.llm.listModels();
        this.status.models = models;
        return models;
      } catch (error) {
        console.error('获取模型列表失败:', error);
        throw error;
      }
    },

    // 发送查询（非流式）
    async query(prompt, options = {}) {
      this.isQuerying = true;
      const startTime = Date.now();

      try {
        const response = await window.electronAPI.llm.query(prompt, {
          ...options,
          conversationId: this.currentConversationId,
          systemPrompt: this.config.systemPrompt,
          ...this.config.options,
        });

        // 更新统计
        this.stats.totalQueries++;
        this.stats.totalTokens += response.tokens || 0;
        const responseTime = Date.now() - startTime;
        this.stats.averageResponseTime =
          (this.stats.averageResponseTime * (this.stats.totalQueries - 1) + responseTime) /
          this.stats.totalQueries;

        this.lastQueryTime = Date.now();

        return response;
      } catch (error) {
        console.error('LLM查询失败:', error);
        throw error;
      } finally {
        this.isQuerying = false;
      }
    },

    // 发送查询（流式）
    async queryStream(prompt, onChunk, options = {}) {
      this.isStreaming = true;
      this.streamingText = '';
      const startTime = Date.now();

      try {
        // 监听流式事件
        const handleChunk = (data) => {
          this.streamingText = data.fullText;
          if (onChunk) {
            onChunk(data);
          }
        };

        window.electronAPI.llm.on('llm:stream-chunk', handleChunk);

        const response = await window.electronAPI.llm.queryStream(prompt, {
          ...options,
          conversationId: this.currentConversationId,
          systemPrompt: this.config.systemPrompt,
          ...this.config.options,
        });

        // 清理事件监听
        window.electronAPI.llm.off('llm:stream-chunk', handleChunk);

        // 更新统计
        this.stats.totalQueries++;
        this.stats.totalTokens += response.tokens || 0;
        const responseTime = Date.now() - startTime;
        this.stats.averageResponseTime =
          (this.stats.averageResponseTime * (this.stats.totalQueries - 1) + responseTime) /
          this.stats.totalQueries;

        this.lastQueryTime = Date.now();

        return response;
      } catch (error) {
        console.error('LLM流式查询失败:', error);
        throw error;
      } finally {
        this.isStreaming = false;
        this.streamingText = '';
      }
    },

    // 生成嵌入向量
    async embeddings(text) {
      try {
        return await window.electronAPI.llm.embeddings(text);
      } catch (error) {
        console.error('生成嵌入向量失败:', error);
        throw error;
      }
    },

    // 清除会话上下文
    async clearContext(conversationId = null) {
      try {
        await window.electronAPI.llm.clearContext(conversationId || this.currentConversationId);
        if (!conversationId || conversationId === this.currentConversationId) {
          this.currentConversationId = null;
        }
      } catch (error) {
        console.error('清除上下文失败:', error);
        throw error;
      }
    },

    // 设置当前会话ID
    setConversationId(id) {
      this.currentConversationId = id;
    },

    // 重置统计
    resetStats() {
      this.stats = {
        totalQueries: 0,
        totalTokens: 0,
        averageResponseTime: 0,
      };
    },

    // 设置状态
    setStatus(status) {
      this.status = status;
    },

    // 设置查询状态
    setQuerying(querying) {
      this.isQuerying = querying;
    },

    // 设置流式状态
    setStreaming(streaming) {
      this.isStreaming = streaming;
    },
  },
});
