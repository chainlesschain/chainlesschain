/**
 * LLM Store - LLM 服务管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * LLM 服务状态
 */
export interface LLMStatus {
  available: boolean;
  provider: string;
  models: string[];
  error: string | null;
}

/**
 * Ollama 配置
 */
export interface OllamaConfig {
  url: string;
  model: string;
}

/**
 * OpenAI 配置
 */
export interface OpenAIConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  organization: string;
}

/**
 * Anthropic 配置
 */
export interface AnthropicConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  version: string;
}

/**
 * DeepSeek 配置
 */
export interface DeepSeekConfig {
  apiKey: string;
  model: string;
}

/**
 * 自定义提供商配置
 */
export interface CustomProviderConfig {
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * LLM 选项
 */
export interface LLMOptions {
  temperature: number;
  top_p: number;
  top_k: number;
  max_tokens: number;
  timeout: number;
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'custom';
  ollama: OllamaConfig;
  openai: OpenAIConfig;
  anthropic: AnthropicConfig;
  deepseek: DeepSeekConfig;
  custom: CustomProviderConfig;
  options: LLMOptions;
  systemPrompt: string;
  streamEnabled: boolean;
  autoSaveConversations: boolean;
}

/**
 * 统计信息
 */
export interface LLMStats {
  totalQueries: number;
  totalTokens: number;
  averageResponseTime: number;
}

/**
 * Token 使用追踪
 */
export interface TokenUsage {
  totalTokens: number;
  totalCost: number;
  todayTokens: number;
  todayCost: number;
  weekTokens: number;
  weekCost: number;
  cacheHitRate: number;
  cachedTokens: number;
  avgCostPerCall: number;
  totalCalls: number;
  lastUpdated: number | null;
}

/**
 * 预算配置
 */
export interface BudgetConfig {
  dailyLimit: number;
  weeklyLimit: number;
  monthlyLimit: number;
  dailySpend: number;
  weeklySpend: number;
  monthlySpend: number;
  warningThreshold: number;
  criticalThreshold: number;
  desktopAlerts: boolean;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  totalEntries: number;
  expiredEntries: number;
  totalHits: number;
  totalTokensSaved: number;
  totalCostSaved: number;
  avgHitsPerEntry: number;
  hitRate: number;
}

/**
 * 查询选项
 */
export interface QueryOptions {
  conversationId?: string | null;
  systemPrompt?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  timeout?: number;
  [key: string]: any;
}

/**
 * LLM 响应
 */
export interface LLMResponse {
  content: string;
  tokens?: number;
  model?: string;
  provider?: string;
  [key: string]: any;
}

/**
 * 流式数据块
 */
export interface StreamChunk {
  chunk: string;
  fullText: string;
  done?: boolean;
}

/**
 * LLM Store 状态
 */
export interface LLMState {
  status: LLMStatus;
  config: LLMConfig;
  currentConversationId: string | null;
  isQuerying: boolean;
  isStreaming: boolean;
  streamingText: string;
  streamingMessageId: string | null;
  currentStreamControllerId: string | null;
  lastQueryTime: number | null;
  stats: LLMStats;
  tokenUsage: TokenUsage;
  budget: BudgetConfig;
  cacheStats: CacheStats;
}

// ==================== Store ====================

export const useLLMStore = defineStore('llm', {
  state: (): LLMState => ({
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

      anthropic: {
        apiKey: '',
        baseURL: 'https://api.anthropic.com',
        model: 'claude-3-opus-20240229',
        version: '2023-06-01',
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
    currentStreamControllerId: null,

    // 最后查询时间
    lastQueryTime: null,

    // 统计信息
    stats: {
      totalQueries: 0,
      totalTokens: 0,
      averageResponseTime: 0,
    },

    // Token 使用追踪
    tokenUsage: {
      totalTokens: 0,
      totalCost: 0,
      todayTokens: 0,
      todayCost: 0,
      weekTokens: 0,
      weekCost: 0,
      cacheHitRate: 0,
      cachedTokens: 0,
      avgCostPerCall: 0,
      totalCalls: 0,
      lastUpdated: null,
    },

    // 预算配置
    budget: {
      dailyLimit: 1.0,
      weeklyLimit: 5.0,
      monthlyLimit: 20.0,
      dailySpend: 0,
      weeklySpend: 0,
      monthlySpend: 0,
      warningThreshold: 0.8,
      criticalThreshold: 0.95,
      desktopAlerts: true,
    },

    // 缓存统计
    cacheStats: {
      totalEntries: 0,
      expiredEntries: 0,
      totalHits: 0,
      totalTokensSaved: 0,
      totalCostSaved: 0,
      avgHitsPerEntry: 0,
      hitRate: 0,
    },
  }),

  getters: {
    // 当前提供商
    currentProvider(): string {
      return this.config.provider;
    },

    // 当前提供商配置
    currentProviderConfig(): any {
      switch (this.config.provider) {
        case 'ollama':
          return this.config.ollama;
        case 'openai':
          return this.config.openai;
        case 'anthropic':
          return this.config.anthropic;
        case 'deepseek':
          return this.config.deepseek;
        case 'custom':
          return this.config.custom;
        default:
          return {};
      }
    },

    // 当前模型
    currentModel(): string {
      const providerConfig = (this.config as any)[this.config.provider];
      return providerConfig?.model || '';
    },

    // 是否可用
    isAvailable(): boolean {
      return this.status.available;
    },

    // 是否正在工作
    isBusy(): boolean {
      return this.isQuerying || this.isStreaming;
    },

    // 提供商显示名称
    providerDisplayName(): string {
      const names: Record<string, string> = {
        ollama: 'Ollama (本地)',
        openai: 'OpenAI',
        anthropic: 'Claude (Anthropic)',
        deepseek: 'DeepSeek',
        custom: this.config.custom.name || '自定义API',
      };
      return names[this.config.provider] || this.config.provider;
    },
  },

  actions: {
    /**
     * 加载配置
     */
    async loadConfig(): Promise<void> {
      try {
        const config = await (window as any).electronAPI.llm.getConfig();
        if (config) {
          this.config = config;
        }
      } catch (error) {
        logger.error('加载LLM配置失败:', error as any);
        throw error;
      }
    },

    /**
     * 保存配置
     */
    async saveConfig(config?: LLMConfig): Promise<void> {
      try {
        await (window as any).electronAPI.llm.setConfig(config || this.config);
        if (config) {
          this.config = config;
        }
      } catch (error) {
        logger.error('保存LLM配置失败:', error as any);
        throw error;
      }
    },

    /**
     * 更新配置
     */
    updateConfig(updates: Partial<LLMConfig>): void {
      this.config = { ...this.config, ...updates };
    },

    /**
     * 更新提供商配置
     */
    updateProviderConfig(
      provider: keyof Pick<LLMConfig, 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'custom'>,
      config: any
    ): void {
      if (this.config[provider]) {
        this.config[provider] = { ...this.config[provider], ...config };
      }
    },

    /**
     * 切换提供商
     */
    async switchProvider(provider: LLMConfig['provider']): Promise<void> {
      this.config.provider = provider;
      await this.saveConfig();
      await this.checkStatus();
    },

    /**
     * 检查服务状态
     */
    async checkStatus(): Promise<LLMStatus> {
      try {
        const status = await (window as any).electronAPI.llm.checkStatus();
        this.status = status;
        return status;
      } catch (error) {
        logger.error('检查LLM状态失败:', error as any);
        this.status = {
          available: false,
          provider: this.config.provider,
          models: [],
          error: (error as Error).message,
        };
        throw error;
      }
    },

    /**
     * 列出可用模型
     */
    async listModels(): Promise<string[]> {
      try {
        const models = await (window as any).electronAPI.llm.listModels();
        this.status.models = models;
        return models;
      } catch (error) {
        logger.error('获取模型列表失败:', error as any);
        throw error;
      }
    },

    /**
     * 发送查询（非流式）
     */
    async query(prompt: string, options: QueryOptions = {}): Promise<LLMResponse> {
      this.isQuerying = true;
      const startTime = Date.now();

      try {
        const response = await (window as any).electronAPI.llm.query(prompt, {
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
        logger.error('LLM查询失败:', error as any);
        throw error;
      } finally {
        this.isQuerying = false;
      }
    },

    /**
     * 发送查询（流式）
     */
    async queryStream(
      prompt: string,
      onChunk?: (data: StreamChunk) => void,
      options: QueryOptions = {}
    ): Promise<LLMResponse> {
      this.isStreaming = true;
      this.streamingText = '';
      const startTime = Date.now();

      try {
        // 监听流式事件
        const handleChunk = (data: StreamChunk) => {
          this.streamingText = data.fullText;
          if (onChunk) {
            onChunk(data);
          }
        };

        (window as any).electronAPI.llm.on('llm:stream-chunk', handleChunk);

        const response = await (window as any).electronAPI.llm.queryStream(prompt, {
          ...options,
          conversationId: this.currentConversationId,
          systemPrompt: this.config.systemPrompt,
          ...this.config.options,
        });

        // 清理事件监听
        (window as any).electronAPI.llm.off('llm:stream-chunk', handleChunk);

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
        logger.error('LLM流式查询失败:', error as any);
        throw error;
      } finally {
        this.isStreaming = false;
        this.streamingText = '';
      }
    },

    /**
     * 生成嵌入向量
     */
    async embeddings(text: string): Promise<number[]> {
      try {
        return await (window as any).electronAPI.llm.embeddings(text);
      } catch (error) {
        logger.error('生成嵌入向量失败:', error as any);
        throw error;
      }
    },

    /**
     * 清除会话上下文
     */
    async clearContext(conversationId: string | null = null): Promise<void> {
      try {
        await (window as any).electronAPI.llm.clearContext(
          conversationId || this.currentConversationId
        );
        if (!conversationId || conversationId === this.currentConversationId) {
          this.currentConversationId = null;
        }
      } catch (error) {
        logger.error('清除上下文失败:', error as any);
        throw error;
      }
    },

    /**
     * 取消流式输出
     */
    async cancelStream(reason: string = '用户取消'): Promise<any> {
      try {
        if (!this.currentStreamControllerId) {
          logger.warn('[LLM Store] 没有正在进行的流式输出');
          return { success: false, message: '没有正在进行的流式输出' };
        }

        const result = await (window as any).electronAPI.llm.cancelStream(
          this.currentStreamControllerId,
          reason
        );

        // 重置状态
        this.isStreaming = false;
        this.isQuerying = false;
        this.streamingText = '';
        this.currentStreamControllerId = null;

        return result;
      } catch (error) {
        logger.error('取消流式输出失败:', error as any);
        // 即使取消失败，也重置状态
        this.isStreaming = false;
        this.isQuerying = false;
        this.streamingText = '';
        this.currentStreamControllerId = null;
        throw error;
      }
    },

    /**
     * 设置当前会话ID
     */
    setConversationId(id: string | null): void {
      this.currentConversationId = id;
    },

    /**
     * 重置统计
     */
    resetStats(): void {
      this.stats = {
        totalQueries: 0,
        totalTokens: 0,
        averageResponseTime: 0,
      };
    },

    /**
     * 设置状态
     */
    setStatus(status: LLMStatus): void {
      this.status = status;
    },

    /**
     * 设置查询状态
     */
    setQuerying(querying: boolean): void {
      this.isQuerying = querying;
    },

    /**
     * 设置流式状态
     */
    setStreaming(streaming: boolean): void {
      this.isStreaming = streaming;
    },

    // ========== Token 追踪与成本管理 ==========

    /**
     * 加载 Token 使用统计
     */
    async loadTokenUsage(options: Record<string, any> = {}): Promise<any> {
      try {
        const stats = await (window as any).electronAPI.llm.getUsageStats(options);
        if (stats) {
          Object.assign(this.tokenUsage, {
            totalTokens: stats.totalTokens || 0,
            totalCost: stats.totalCost || 0,
            todayTokens: stats.todayTokens || 0,
            todayCost: stats.todayCost || 0,
            weekTokens: stats.weekTokens || 0,
            weekCost: stats.weekCost || 0,
            cacheHitRate: stats.cacheHitRate || 0,
            cachedTokens: stats.cachedTokens || 0,
            avgCostPerCall: stats.avgCostPerCall || 0,
            totalCalls: stats.totalCalls || 0,
            lastUpdated: Date.now(),
          });
        }
        return stats;
      } catch (error) {
        logger.error('加载 Token 使用统计失败:', error as any);
        throw error;
      }
    },

    /**
     * 获取时间序列数据
     */
    async getTimeSeriesData(options: Record<string, any> = {}): Promise<any> {
      try {
        return await (window as any).electronAPI.llm.getTimeSeries(options);
      } catch (error) {
        logger.error('获取时间序列数据失败:', error as any);
        throw error;
      }
    },

    /**
     * 获取成本分解
     */
    async getCostBreakdown(options: Record<string, any> = {}): Promise<any> {
      try {
        return await (window as any).electronAPI.llm.getCostBreakdown(options);
      } catch (error) {
        logger.error('获取成本分解失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载预算配置
     */
    async loadBudget(userId: string = 'default'): Promise<any> {
      try {
        const budget = await (window as any).electronAPI.llm.getBudget(userId);
        if (budget) {
          Object.assign(this.budget, budget);
        }
        return budget;
      } catch (error) {
        logger.error('加载预算配置失败:', error as any);
        throw error;
      }
    },

    /**
     * 保存预算配置
     */
    async saveBudget(config: Partial<BudgetConfig>, userId: string = 'default'): Promise<boolean> {
      try {
        await (window as any).electronAPI.llm.setBudget(userId, config);
        await this.loadBudget(userId);
        return true;
      } catch (error) {
        logger.error('保存预算配置失败:', error as any);
        throw error;
      }
    },

    /**
     * 导出成本报告
     */
    async exportCostReport(options: Record<string, any> = {}): Promise<any> {
      try {
        return await (window as any).electronAPI.llm.exportCostReport(options);
      } catch (error) {
        logger.error('导出成本报告失败:', error as any);
        throw error;
      }
    },

    /**
     * 清除响应缓存
     */
    async clearCache(): Promise<any> {
      try {
        const result = await (window as any).electronAPI.llm.clearCache();
        // 重新加载缓存统计
        await this.loadCacheStats();
        return result;
      } catch (error) {
        logger.error('清除缓存失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载缓存统计
     */
    async loadCacheStats(): Promise<any> {
      try {
        const stats = await (window as any).electronAPI.llm.getCacheStats();
        if (stats) {
          Object.assign(this.cacheStats, {
            totalEntries: stats.database?.totalEntries || 0,
            expiredEntries: stats.database?.expiredEntries || 0,
            totalHits: stats.database?.totalHits || 0,
            totalTokensSaved: stats.database?.totalTokensSaved || 0,
            totalCostSaved: parseFloat(stats.database?.totalCostSaved || 0),
            avgHitsPerEntry: parseFloat(stats.database?.avgHitsPerEntry || 0),
            hitRate: parseFloat(stats.runtime?.hitRate || 0),
          });
        }
        return stats;
      } catch (error) {
        logger.error('加载缓存统计失败:', error as any);
        throw error;
      }
    },

    /**
     * 初始化 Token 追踪数据（在应用启动时调用）
     */
    async initTokenTracking(): Promise<void> {
      try {
        await Promise.all([this.loadTokenUsage(), this.loadBudget(), this.loadCacheStats()]);
      } catch (error) {
        logger.error('初始化 Token 追踪数据失败:', error as any);
      }
    },
  },
});
