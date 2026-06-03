/**
 * LLM Store 单元测试
 * 测试LLM配置和状态管理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useLLMStore } from '@renderer/stores/llm';

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

describe('LLM Store', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLLMStore();
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('should have correct initial status', () => {
      expect(store.status).toEqual({
        available: false,
        provider: '',
        models: [],
        error: null
      });
    });

    it('should have default provider config', () => {
      expect(store.config.provider).toBe('ollama');
      expect(store.config.ollama.url).toBe('http://localhost:11434');
      expect(store.config.ollama.model).toBe('llama2');
    });

    it('should have OpenAI config', () => {
      expect(store.config.openai).toEqual({
        apiKey: '',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo',
        organization: ''
      });
    });

    it('should have Anthropic config', () => {
      expect(store.config.anthropic).toEqual({
        apiKey: '',
        baseURL: 'https://api.anthropic.com',
        model: 'claude-3-opus-20240229',
        version: '2023-06-01'
      });
    });

    it('should have DeepSeek config', () => {
      expect(store.config.deepseek).toEqual({
        apiKey: '',
        model: 'deepseek-chat'
      });
    });

    it('should have default options', () => {
      expect(store.config.options).toEqual({
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        max_tokens: 2000,
        timeout: 120000
      });
    });

    it('should have system prompt', () => {
      expect(store.config.systemPrompt).toContain('helpful AI assistant');
    });

    it('should have stream enabled by default', () => {
      expect(store.config.streamEnabled).toBe(true);
    });

    it('should have auto-save enabled', () => {
      expect(store.config.autoSaveConversations).toBe(true);
    });

    it('should have null conversation ID', () => {
      expect(store.currentConversationId).toBeNull();
    });

    it('should not be querying initially', () => {
      expect(store.isQuerying).toBe(false);
      expect(store.isStreaming).toBe(false);
    });

    it('should have empty streaming state', () => {
      expect(store.streamingText).toBe('');
      expect(store.streamingMessageId).toBeNull();
      expect(store.currentStreamControllerId).toBeNull();
    });

    it('should have zero stats', () => {
      expect(store.stats).toEqual({
        totalQueries: 0,
        totalTokens: 0,
        averageResponseTime: 0
      });
    });

    it('should have zero token usage', () => {
      expect(store.tokenUsage.totalTokens).toBe(0);
      expect(store.tokenUsage.totalCost).toBe(0);
      expect(store.tokenUsage.todayTokens).toBe(0);
      expect(store.tokenUsage.todayCost).toBe(0);
    });

    it('should have budget limits', () => {
      expect(store.budget).toEqual({
        dailyLimit: 1.0,
        weeklyLimit: 5.0,
        monthlyLimit: 20.0,
        dailySpend: 0,
        weeklySpend: 0,
        monthlySpend: 0,
        warningThreshold: 0.8,
        criticalThreshold: 0.95,
        desktopAlerts: true
      });
    });

    it('should have zero cache stats', () => {
      expect(store.cacheStats.totalEntries).toBe(0);
      expect(store.cacheStats.totalHits).toBe(0);
      expect(store.cacheStats.hitRate).toBe(0);
    });
  });

  describe('Provider Configuration', () => {
    it('should set provider via updateConfig', () => {
      store.updateConfig({ provider: 'openai' });
      expect(store.config.provider).toBe('openai');
    });

    it('should update Ollama config', () => {
      store.updateProviderConfig('ollama', {
        url: 'http://localhost:11435',
        model: 'llama3'
      });

      expect(store.config.ollama.url).toBe('http://localhost:11435');
      expect(store.config.ollama.model).toBe('llama3');
    });

    it('should update OpenAI config', () => {
      store.updateProviderConfig('openai', {
        apiKey: 'sk-test',
        model: 'gpt-4'
      });

      expect(store.config.openai.apiKey).toBe('sk-test');
      expect(store.config.openai.model).toBe('gpt-4');
      expect(store.config.openai.baseURL).toBe('https://api.openai.com/v1'); // preserved
    });

    it('should update Anthropic config', () => {
      store.updateProviderConfig('anthropic', {
        apiKey: 'sk-ant-test',
        model: 'claude-3-sonnet-20240229'
      });

      expect(store.config.anthropic.apiKey).toBe('sk-ant-test');
      expect(store.config.anthropic.model).toBe('claude-3-sonnet-20240229');
    });

    it('should update DeepSeek config', () => {
      store.updateProviderConfig('deepseek', {
        apiKey: 'ds-test',
        model: 'deepseek-coder'
      });

      expect(store.config.deepseek.apiKey).toBe('ds-test');
      expect(store.config.deepseek.model).toBe('deepseek-coder');
    });

    it('should update custom provider config', () => {
      store.updateProviderConfig('custom', {
        name: 'My LLM',
        apiKey: 'test-key',
        baseURL: 'https://my-llm.com/v1',
        model: 'my-model'
      });

      expect(store.config.custom.name).toBe('My LLM');
      expect(store.config.custom.apiKey).toBe('test-key');
      expect(store.config.custom.baseURL).toBe('https://my-llm.com/v1');
      expect(store.config.custom.model).toBe('my-model');
    });
  });

  describe('Options Configuration', () => {
    it('should update temperature', () => {
      store.updateConfig({ options: { ...store.config.options, temperature: 0.5 } });
      expect(store.config.options.temperature).toBe(0.5);
    });

    it('should update multiple options', () => {
      store.updateConfig({
        options: {
          ...store.config.options,
          temperature: 0.8,
          max_tokens: 4000,
          top_p: 0.95
        }
      });

      expect(store.config.options.temperature).toBe(0.8);
      expect(store.config.options.max_tokens).toBe(4000);
      expect(store.config.options.top_p).toBe(0.95);
    });

    it('should preserve unchanged options', () => {
      store.updateConfig({ options: { ...store.config.options, temperature: 0.5 } });
      expect(store.config.options.top_k).toBe(40); // unchanged
    });

    it('should update system prompt', () => {
      const prompt = 'You are a coding assistant';
      store.updateConfig({ systemPrompt: prompt });
      expect(store.config.systemPrompt).toBe(prompt);
    });

    it('should toggle stream', () => {
      expect(store.config.streamEnabled).toBe(true);
      store.updateConfig({ streamEnabled: false });
      expect(store.config.streamEnabled).toBe(false);
      store.updateConfig({ streamEnabled: true });
      expect(store.config.streamEnabled).toBe(true);
    });

    it('should toggle auto-save', () => {
      expect(store.config.autoSaveConversations).toBe(true);
      store.updateConfig({ autoSaveConversations: false });
      expect(store.config.autoSaveConversations).toBe(false);
      store.updateConfig({ autoSaveConversations: true });
      expect(store.config.autoSaveConversations).toBe(true);
    });
  });

  describe('Status Management', () => {
    it('should set status', () => {
      const status = {
        available: true,
        provider: 'ollama',
        models: ['llama2', 'llama3'],
        error: null
      };

      store.setStatus(status);
      expect(store.status).toEqual(status);
    });

    it('should replace status entirely', () => {
      store.setStatus({ available: true, provider: 'ollama', models: [], error: null });
      store.setStatus({ available: false, provider: '', models: ['llama2'], error: null });

      expect(store.status.available).toBe(false);
      expect(store.status.models).toEqual(['llama2']);
    });

    it('should set error via status', () => {
      store.status.error = 'Connection failed';
      expect(store.status.error).toBe('Connection failed');
    });

    it('should clear error via status', () => {
      store.status.error = 'Error';
      store.status.error = null;
      expect(store.status.error).toBeNull();
    });
  });

  describe('Query State', () => {
    it('should set querying state', () => {
      store.setQuerying(true);
      expect(store.isQuerying).toBe(true);

      store.setQuerying(false);
      expect(store.isQuerying).toBe(false);
    });

    it('should set streaming state', () => {
      store.setStreaming(true);
      expect(store.isStreaming).toBe(true);

      store.setStreaming(false);
      expect(store.isStreaming).toBe(false);
    });

    it('should update streaming text directly', () => {
      store.streamingText = 'Hello';
      expect(store.streamingText).toBe('Hello');

      store.streamingText = 'Hello World';
      expect(store.streamingText).toBe('Hello World');
    });

    it('should clear streaming text', () => {
      store.streamingText = 'Test';
      store.streamingText = '';
      expect(store.streamingText).toBe('');
    });

    it('should set streaming message ID', () => {
      store.streamingMessageId = 'msg123';
      expect(store.streamingMessageId).toBe('msg123');
    });
  });

  describe('Stats Management', () => {
    it('should increment total queries via direct mutation', () => {
      store.stats.totalQueries++;
      expect(store.stats.totalQueries).toBe(1);

      store.stats.totalQueries++;
      expect(store.stats.totalQueries).toBe(2);
    });

    it('should add tokens via direct mutation', () => {
      store.stats.totalTokens += 100;
      expect(store.stats.totalTokens).toBe(100);

      store.stats.totalTokens += 50;
      expect(store.stats.totalTokens).toBe(150);
    });

    it('should update average response time via direct mutation', () => {
      store.stats.averageResponseTime = 1000;
      expect(store.stats.averageResponseTime).toBe(1000);

      store.stats.averageResponseTime = 1500;
      expect(store.stats.averageResponseTime).toBe(1500);
    });

    it('should reset stats', () => {
      store.stats.totalQueries++;
      store.stats.totalTokens += 100;
      store.stats.averageResponseTime = 1000;

      store.resetStats();

      expect(store.stats).toEqual({
        totalQueries: 0,
        totalTokens: 0,
        averageResponseTime: 0
      });
    });
  });

  describe('Token Usage Tracking', () => {
    it('should update token usage via direct mutation', () => {
      Object.assign(store.tokenUsage, {
        totalTokens: 1000,
        totalCost: 0.02,
        todayTokens: 500,
        todayCost: 0.01
      });

      expect(store.tokenUsage.totalTokens).toBe(1000);
      expect(store.tokenUsage.totalCost).toBe(0.02);
      expect(store.tokenUsage.todayTokens).toBe(500);
      expect(store.tokenUsage.todayCost).toBe(0.01);
    });

    it('should store average cost per call', () => {
      Object.assign(store.tokenUsage, {
        totalCost: 1.0,
        totalCalls: 100,
        avgCostPerCall: 0.01
      });

      expect(store.tokenUsage.avgCostPerCall).toBe(0.01);
    });

    it('should update cache hit rate', () => {
      store.tokenUsage.cacheHitRate = 0.75;

      expect(store.tokenUsage.cacheHitRate).toBe(0.75);
    });

    it('should track cached tokens', () => {
      store.tokenUsage.cachedTokens = 5000;

      expect(store.tokenUsage.cachedTokens).toBe(5000);
    });
  });

  describe('Budget Management', () => {
    it('should update budget via direct mutation', () => {
      Object.assign(store.budget, {
        dailyLimit: 2.0,
        weeklyLimit: 10.0
      });

      expect(store.budget.dailyLimit).toBe(2.0);
      expect(store.budget.weeklyLimit).toBe(10.0);
      expect(store.budget.monthlyLimit).toBe(20.0); // unchanged
    });

    it('should update spend via direct mutation', () => {
      Object.assign(store.budget, {
        dailySpend: 0.5,
        weeklySpend: 1.5,
        monthlySpend: 3.0
      });

      expect(store.budget.dailySpend).toBe(0.5);
      expect(store.budget.weeklySpend).toBe(1.5);
      expect(store.budget.monthlySpend).toBe(3.0);
    });

    it('should detect over budget by comparing spend to limit', () => {
      store.budget.dailyLimit = 1.0;
      store.budget.dailySpend = 1.5;

      expect(store.budget.dailySpend > store.budget.dailyLimit).toBe(true);
      expect(store.budget.weeklySpend > store.budget.weeklyLimit).toBe(false);
    });

    it('should detect near warning threshold', () => {
      store.budget.dailyLimit = 1.0;
      store.budget.dailySpend = 0.85;
      store.budget.warningThreshold = 0.8;

      const ratio = store.budget.dailySpend / store.budget.dailyLimit;
      expect(ratio >= store.budget.warningThreshold).toBe(true);
    });

    it('should detect near critical threshold', () => {
      store.budget.dailyLimit = 1.0;
      store.budget.dailySpend = 0.96;
      store.budget.criticalThreshold = 0.95;

      const ratio = store.budget.dailySpend / store.budget.dailyLimit;
      expect(ratio >= store.budget.criticalThreshold).toBe(true);
    });

    it('should toggle desktop alerts via direct mutation', () => {
      expect(store.budget.desktopAlerts).toBe(true);
      store.budget.desktopAlerts = false;
      expect(store.budget.desktopAlerts).toBe(false);
    });
  });

  describe('Cache Stats', () => {
    it('should update cache stats via direct mutation', () => {
      Object.assign(store.cacheStats, {
        totalEntries: 100,
        totalHits: 75,
        totalTokensSaved: 10000
      });

      expect(store.cacheStats.totalEntries).toBe(100);
      expect(store.cacheStats.totalHits).toBe(75);
      expect(store.cacheStats.totalTokensSaved).toBe(10000);
    });

    it('should store hit rate', () => {
      Object.assign(store.cacheStats, {
        totalEntries: 100,
        totalHits: 75,
        hitRate: 0.75
      });

      expect(store.cacheStats.hitRate).toBe(0.75);
    });

    it('should store average hits per entry', () => {
      Object.assign(store.cacheStats, {
        totalEntries: 50,
        totalHits: 150,
        avgHitsPerEntry: 3
      });

      expect(store.cacheStats.avgHitsPerEntry).toBe(3);
    });
  });

  describe('Conversation Management', () => {
    it('should set current conversation ID', () => {
      store.setConversationId('conv123');
      expect(store.currentConversationId).toBe('conv123');
    });

    it('should clear current conversation ID', () => {
      store.setConversationId('conv123');
      store.setConversationId(null);
      expect(store.currentConversationId).toBeNull();
    });
  });

  describe('Getters', () => {
    it('currentProvider should return provider name', () => {
      store.config.provider = 'openai';
      expect(store.currentProvider).toBe('openai');
    });

    it('isAvailable should return availability status', () => {
      expect(store.isAvailable).toBe(false);
      store.status.available = true;
      expect(store.isAvailable).toBe(true);
    });

    it('isBusy should return busy status', () => {
      expect(store.isBusy).toBe(false);
      store.setQuerying(true);
      expect(store.isBusy).toBe(true);
      store.setQuerying(false);
      store.setStreaming(true);
      expect(store.isBusy).toBe(true);
    });

    it('currentModel should return current provider model', () => {
      store.config.provider = 'ollama';
      expect(store.currentModel).toBe('llama2');
      store.config.provider = 'openai';
      expect(store.currentModel).toBe('gpt-3.5-turbo');
    });

    it('providerDisplayName should return display name', () => {
      store.config.provider = 'openai';
      expect(store.providerDisplayName).toBe('OpenAI');
    });

    it('currentProviderConfig should return config for current provider', () => {
      store.config.provider = 'ollama';
      expect(store.currentProviderConfig).toEqual({
        url: 'http://localhost:11434',
        model: 'llama2'
      });
    });
  });
});
