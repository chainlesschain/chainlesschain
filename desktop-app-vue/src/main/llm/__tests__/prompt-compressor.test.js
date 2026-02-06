/**
 * Prompt Compressor 单元测试
 *
 * 测试内容：
 * - estimateTokens 函数
 * - PromptCompressor 类构造函数
 * - compress 方法
 * - _deduplicateMessages 去重逻辑
 * - _truncateHistory 截断逻辑
 * - getStats 获取统计
 * - updateConfig 更新配置
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const { PromptCompressor, estimateTokens } = require('../prompt-compressor');

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('should estimate tokens for English text', () => {
    // 英文按 4 字符/token
    const text = 'Hello World'; // 11 字符 ≈ 3 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('should estimate tokens for Chinese text', () => {
    // 中文按 1.5 字符/token
    const text = '你好世界'; // 4 字符 ≈ 3 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('should estimate tokens for mixed text', () => {
    const text = '你好 Hello 世界 World'; // 混合文本
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle long text', () => {
    const text = 'a'.repeat(1000);
    const tokens = estimateTokens(text);
    expect(tokens).toBe(250); // 1000 / 4 = 250
  });
});

describe('PromptCompressor', () => {
  let compressor;

  beforeEach(() => {
    vi.clearAllMocks();

    compressor = new PromptCompressor({
      enableDeduplication: true,
      enableSummarization: false,
      enableTruncation: true,
      maxHistoryMessages: 10,
      maxTotalTokens: 4000,
      similarityThreshold: 0.9,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultCompressor = new PromptCompressor();

      expect(defaultCompressor.enableDeduplication).toBe(true);
      expect(defaultCompressor.enableSummarization).toBe(false);
      expect(defaultCompressor.enableTruncation).toBe(true);
      expect(defaultCompressor.maxHistoryMessages).toBe(10);
      expect(defaultCompressor.maxTotalTokens).toBe(4000);
      expect(defaultCompressor.similarityThreshold).toBe(0.9);
    });

    it('should initialize with custom config', () => {
      const customCompressor = new PromptCompressor({
        enableDeduplication: false,
        enableSummarization: true,
        enableTruncation: false,
        maxHistoryMessages: 20,
        maxTotalTokens: 8000,
        similarityThreshold: 0.8,
      });

      expect(customCompressor.enableDeduplication).toBe(false);
      expect(customCompressor.enableSummarization).toBe(true);
      expect(customCompressor.enableTruncation).toBe(false);
      expect(customCompressor.maxHistoryMessages).toBe(20);
      expect(customCompressor.maxTotalTokens).toBe(8000);
      expect(customCompressor.similarityThreshold).toBe(0.8);
    });
  });

  describe('compress', () => {
    it('should return empty result for empty messages', async () => {
      const result = await compressor.compress([]);

      expect(result.messages).toEqual([]);
      expect(result.originalTokens).toBe(0);
      expect(result.compressedTokens).toBe(0);
      expect(result.compressionRatio).toBe(1.0);
      expect(result.strategy).toBe('none');
      expect(result.processingTime).toBe(0);
    });

    it('should return empty result for non-array input', async () => {
      const result = await compressor.compress(null);

      expect(result.messages).toEqual([]);
      expect(result.strategy).toBe('none');
    });

    it('should compress messages with deduplication', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Hello' }, // 重复
        { role: 'assistant', content: 'How can I help?' },
      ];

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBeLessThanOrEqual(messages.length);
      expect(result.strategy).toContain('deduplication');
    });

    it('should compress messages with truncation', async () => {
      // 创建超过 maxHistoryMessages 的消息
      const messages = [{ role: 'system', content: 'System prompt' }];

      for (let i = 0; i < 15; i++) {
        messages.push({ role: 'user', content: `User message ${i}` });
        messages.push({ role: 'assistant', content: `Assistant response ${i}` });
      }

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBeLessThanOrEqual(compressor.maxHistoryMessages + 1);
      expect(result.strategy).toContain('truncation');
    });

    it('should preserve system message', async () => {
      const messages = [
        { role: 'system', content: 'Important system prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];

      const result = await compressor.compress(messages, { preserveSystemMessage: true });

      const systemMessages = result.messages.filter((m) => m.role === 'system');
      expect(systemMessages.length).toBeGreaterThan(0);
      expect(systemMessages[0].content).toBe('Important system prompt');
    });

    it('should preserve last user message', async () => {
      const messages = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Last important message' },
      ];

      const result = await compressor.compress(messages, { preserveLastUserMessage: true });

      const lastMessage = result.messages[result.messages.length - 1];
      expect(lastMessage.content).toBe('Last important message');
    });

    it('should calculate compression metrics', async () => {
      const messages = [
        { role: 'user', content: 'Hello, how are you today?' },
        { role: 'assistant', content: 'I am doing well, thank you for asking!' },
        { role: 'user', content: 'Hello, how are you today?' }, // 重复
      ];

      const result = await compressor.compress(messages);

      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compressedTokens).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
      expect(result.tokensSaved).toBeDefined();
    });

    it('should handle messages with non-string content', async () => {
      const messages = [
        { role: 'user', content: { text: 'Hello', images: [] } },
        { role: 'assistant', content: 'Hi' },
      ];

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  describe('_deduplicateMessages (via compress)', () => {
    it('should remove exact duplicate messages', async () => {
      compressor.enableTruncation = false;

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Hello' }, // 完全重复
        { role: 'assistant', content: 'How can I help?' },
        { role: 'user', content: 'Final question' }, // 最后一条用户消息会被保留
      ];

      const result = await compressor.compress(messages, { preserveLastUserMessage: true });

      // 重复的 "Hello" 应该被去重（但最后一条用户消息被保留）
      // 原始: Hello, Hi, Hello, How can I help?, Final question
      // 去重后: Hello, Hi, How can I help?, Final question (第二个 Hello 被移除)
      expect(result.messages.length).toBeLessThan(messages.length);
    });

    it('should remove similar messages above threshold', async () => {
      compressor.enableTruncation = false;
      compressor.similarityThreshold = 0.8;

      const messages = [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Hello world!' }, // 非常相似
        { role: 'assistant', content: 'How can I help?' },
        { role: 'user', content: 'Different message' }, // 不同的最后一条
      ];

      const result = await compressor.compress(messages, { preserveLastUserMessage: true });

      // 相似消息应该被去重 (5 -> 4 或更少)
      expect(result.messages.length).toBeLessThan(messages.length);
    });

    it('should skip deduplication when disabled', async () => {
      compressor.enableDeduplication = false;
      compressor.enableTruncation = false;

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'user', content: 'Hello' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBe(3);
      expect(result.strategy).toBe('none');
    });
  });

  describe('_truncateHistory (via compress)', () => {
    it('should truncate to max history messages', async () => {
      compressor.enableDeduplication = false;
      compressor.maxHistoryMessages = 5;

      const messages = [];
      for (let i = 0; i < 10; i++) {
        messages.push({ role: 'user', content: `Message ${i}` });
      }

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBeLessThanOrEqual(5);
      expect(result.strategy).toContain('truncation');
    });

    it('should keep most recent messages', async () => {
      compressor.enableDeduplication = false;
      compressor.maxHistoryMessages = 3;

      const messages = [
        { role: 'user', content: 'Old message 1' },
        { role: 'user', content: 'Old message 2' },
        { role: 'user', content: 'Recent message 1' },
        { role: 'user', content: 'Recent message 2' },
        { role: 'user', content: 'Most recent' },
      ];

      const result = await compressor.compress(messages, { preserveLastUserMessage: true });

      // 应该保留最近的消息
      expect(result.messages.some((m) => m.content === 'Most recent')).toBe(true);
    });

    it('should skip truncation when disabled', async () => {
      compressor.enableDeduplication = false;
      compressor.enableTruncation = false;
      compressor.maxHistoryMessages = 2;

      const messages = [
        { role: 'user', content: 'Message 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'user', content: 'Message 4' },
      ];

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBe(4);
    });

    it('should not truncate when under limit', async () => {
      compressor.enableDeduplication = false;
      compressor.maxHistoryMessages = 10;

      const messages = [
        { role: 'user', content: 'Message 1' },
        { role: 'user', content: 'Message 2' },
      ];

      const result = await compressor.compress(messages);

      expect(result.messages.length).toBe(2);
      expect(result.strategy).not.toContain('truncation');
    });
  });

  describe('_summarizeHistory', () => {
    it('should call LLM for summarization when enabled', async () => {
      const mockLLMManager = {
        query: vi.fn().mockResolvedValue({
          text: 'Summary of the conversation',
        }),
      };

      const summaryCompressor = new PromptCompressor({
        enableDeduplication: false,
        enableSummarization: true,
        enableTruncation: false,
        maxTotalTokens: 10, // 强制触发总结
        llmManager: mockLLMManager,
      });

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am fine' },
        { role: 'user', content: 'Great!' },
        { role: 'assistant', content: 'Thank you!' },
      ];

      const result = await summaryCompressor.compress(messages);

      expect(mockLLMManager.query).toHaveBeenCalled();
      expect(result.strategy).toContain('summarization');
    });

    it('should skip summarization when LLM not available', async () => {
      const summaryCompressor = new PromptCompressor({
        enableDeduplication: false,
        enableSummarization: true,
        enableTruncation: false,
        maxTotalTokens: 10,
        llmManager: null,
      });

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am fine' },
        { role: 'user', content: 'Great!' },
        { role: 'assistant', content: 'Thank you!' },
      ];

      const result = await summaryCompressor.compress(messages);

      expect(result.strategy).not.toContain('summarization');
    });

    it('should handle LLM errors gracefully', async () => {
      const mockLLMManager = {
        query: vi.fn().mockRejectedValue(new Error('LLM error')),
      };

      const summaryCompressor = new PromptCompressor({
        enableDeduplication: false,
        enableSummarization: true,
        enableTruncation: false,
        maxTotalTokens: 10,
        llmManager: mockLLMManager,
      });

      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am fine' },
        { role: 'user', content: 'Great!' },
        { role: 'assistant', content: 'Thank you!' },
      ];

      const result = await summaryCompressor.compress(messages);

      // 应该不抛出错误，而是跳过总结
      expect(result.strategy).not.toContain('summarization');
    });
  });

  describe('getStats', () => {
    it('should return current stats', () => {
      const stats = compressor.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.strategies).toEqual({
        deduplication: true,
        summarization: false,
        truncation: true,
      });
      expect(stats.config).toEqual({
        maxHistoryMessages: 10,
        maxTotalTokens: 4000,
        similarityThreshold: 0.9,
      });
    });

    it('should reflect config changes', () => {
      compressor.enableDeduplication = false;
      compressor.maxHistoryMessages = 20;

      const stats = compressor.getStats();

      expect(stats.strategies.deduplication).toBe(false);
      expect(stats.config.maxHistoryMessages).toBe(20);
    });
  });

  describe('updateConfig', () => {
    it('should update enableDeduplication', () => {
      compressor.updateConfig({ enableDeduplication: false });
      expect(compressor.enableDeduplication).toBe(false);
    });

    it('should update enableSummarization', () => {
      compressor.updateConfig({ enableSummarization: true });
      expect(compressor.enableSummarization).toBe(true);
    });

    it('should update enableTruncation', () => {
      compressor.updateConfig({ enableTruncation: false });
      expect(compressor.enableTruncation).toBe(false);
    });

    it('should update maxHistoryMessages', () => {
      compressor.updateConfig({ maxHistoryMessages: 50 });
      expect(compressor.maxHistoryMessages).toBe(50);
    });

    it('should update maxTotalTokens', () => {
      compressor.updateConfig({ maxTotalTokens: 8000 });
      expect(compressor.maxTotalTokens).toBe(8000);
    });

    it('should update similarityThreshold', () => {
      compressor.updateConfig({ similarityThreshold: 0.8 });
      expect(compressor.similarityThreshold).toBe(0.8);
    });

    it('should update multiple options at once', () => {
      compressor.updateConfig({
        enableDeduplication: false,
        maxHistoryMessages: 30,
        maxTotalTokens: 6000,
      });

      expect(compressor.enableDeduplication).toBe(false);
      expect(compressor.maxHistoryMessages).toBe(30);
      expect(compressor.maxTotalTokens).toBe(6000);
    });

    it('should ignore undefined options', () => {
      const originalValue = compressor.maxHistoryMessages;
      compressor.updateConfig({ maxHistoryMessages: undefined });
      expect(compressor.maxHistoryMessages).toBe(originalValue);
    });
  });
});
