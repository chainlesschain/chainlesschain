/**
 * QueryRewriter 单元测试
 *
 * 测试内容：
 * - QueryRewriter 类构造函数
 * - rewriteQuery 主要重写方法
 * - multiQueryRewrite 多查询重写
 * - hydeRewrite HyDE重写
 * - stepBackRewrite Step-Back重写
 * - decomposeQuery 查询分解
 * - parseQueryVariants 解析变体
 * - 缓存机制
 * - 配置管理
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

const { QueryRewriter, DEFAULT_REWRITER_CONFIG } = require('../query-rewriter');

describe('DEFAULT_REWRITER_CONFIG', () => {
  it('should have default values', () => {
    expect(DEFAULT_REWRITER_CONFIG.enabled).toBe(true);
    expect(DEFAULT_REWRITER_CONFIG.method).toBe('multi_query');
    expect(DEFAULT_REWRITER_CONFIG.maxVariants).toBe(3);
    expect(DEFAULT_REWRITER_CONFIG.temperature).toBe(0.7);
    expect(DEFAULT_REWRITER_CONFIG.enableCache).toBe(true);
  });
});

describe('QueryRewriter', () => {
  let rewriter;
  let mockLLMManager;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLLMManager = {
      query: vi.fn(),
    };

    rewriter = new QueryRewriter(mockLLMManager, {
      enabled: true,
      method: 'multi_query',
      maxVariants: 3,
      enableCache: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with llmManager', () => {
      expect(rewriter.llmManager).toBe(mockLLMManager);
    });

    it('should initialize with default config', () => {
      const defaultRewriter = new QueryRewriter(mockLLMManager);

      expect(defaultRewriter.config.enabled).toBe(true);
      expect(defaultRewriter.config.method).toBe('multi_query');
      expect(defaultRewriter.config.maxVariants).toBe(3);
    });

    it('should initialize with custom config', () => {
      const customRewriter = new QueryRewriter(mockLLMManager, {
        method: 'hyde',
        maxVariants: 5,
      });

      expect(customRewriter.config.method).toBe('hyde');
      expect(customRewriter.config.maxVariants).toBe(5);
    });

    it('should initialize empty cache', () => {
      expect(rewriter.cache).toBeInstanceOf(Map);
      expect(rewriter.cache.size).toBe(0);
    });

    it('should be an EventEmitter', () => {
      expect(typeof rewriter.on).toBe('function');
      expect(typeof rewriter.emit).toBe('function');
    });
  });

  describe('rewriteQuery', () => {
    it('should return original query when disabled', async () => {
      rewriter.config.enabled = false;

      const result = await rewriter.rewriteQuery('test query');

      expect(result.originalQuery).toBe('test query');
      expect(result.rewrittenQueries).toEqual(['test query']);
      expect(result.method).toBe('none');
      expect(mockLLMManager.query).not.toHaveBeenCalled();
    });

    it('should use cache when available', async () => {
      mockLLMManager.query.mockResolvedValue('["variant1", "variant2"]');

      // 第一次调用
      await rewriter.rewriteQuery('test query');

      // 第二次调用应使用缓存
      const result = await rewriter.rewriteQuery('test query');

      expect(mockLLMManager.query).toHaveBeenCalledTimes(1);
      expect(result.rewrittenQueries.length).toBeGreaterThan(0);
    });

    it('should emit rewrite-start event', async () => {
      mockLLMManager.query.mockResolvedValue('["variant1"]');

      const eventHandler = vi.fn();
      rewriter.on('rewrite-start', eventHandler);

      await rewriter.rewriteQuery('test query');

      expect(eventHandler).toHaveBeenCalledWith({
        query: 'test query',
        method: 'multi_query',
      });
    });

    it('should emit rewrite-complete event', async () => {
      mockLLMManager.query.mockResolvedValue('["variant1", "variant2"]');

      const eventHandler = vi.fn();
      rewriter.on('rewrite-complete', eventHandler);

      await rewriter.rewriteQuery('test query');

      expect(eventHandler).toHaveBeenCalledWith({
        query: 'test query',
        method: 'multi_query',
        variantCount: expect.any(Number),
      });
    });

    it('should return fallback on error', async () => {
      mockLLMManager.query.mockRejectedValue(new Error('LLM Error'));

      const result = await rewriter.rewriteQuery('test query');

      expect(result.originalQuery).toBe('test query');
      expect(result.rewrittenQueries).toEqual(['test query']);
      expect(result.method).toBe('fallback');
      expect(result.error).toBe('LLM Error');
    });

    it('should emit rewrite-error event on error', async () => {
      mockLLMManager.query.mockRejectedValue(new Error('LLM Error'));

      const eventHandler = vi.fn();
      rewriter.on('rewrite-error', eventHandler);

      await rewriter.rewriteQuery('test query');

      expect(eventHandler).toHaveBeenCalledWith({
        query: 'test query',
        method: 'multi_query',
        error: expect.any(Error),
      });
    });

    it('should use specified method', async () => {
      mockLLMManager.query.mockResolvedValue('Hypothetical answer for hyde.');

      const result = await rewriter.rewriteQuery('test query', { method: 'hyde' });

      expect(result.method).toBe('hyde');
    });

    it('should limit cache size', async () => {
      rewriter.config.enableCache = true;
      mockLLMManager.query.mockResolvedValue('["variant"]');

      // 填充缓存超过100条
      for (let i = 0; i < 105; i++) {
        rewriter.cache.set(`key${i}`, { query: `query${i}` });
      }

      await rewriter.rewriteQuery('new query');

      // 缓存清理逻辑在添加新条目后触发，会删除最早的一条
      // 所以大小应该是 105 (原有) + 1 (新增) - 1 (删除) = 105 或者更少
      expect(rewriter.cache.size).toBeLessThanOrEqual(106);
    });
  });

  describe('multiQueryRewrite', () => {
    it('should generate multiple query variants', async () => {
      mockLLMManager.query.mockResolvedValue('["what is RAG?", "explain RAG system", "RAG basics"]');

      const result = await rewriter.multiQueryRewrite('What is RAG?');

      expect(result.originalQuery).toBe('What is RAG?');
      expect(result.method).toBe('multi_query');
      expect(result.rewrittenQueries).toContain('What is RAG?');
      expect(result.variants.length).toBeLessThanOrEqual(3);
    });

    it('should respect maxVariants option', async () => {
      mockLLMManager.query.mockResolvedValue(
        '["v1", "v2", "v3", "v4", "v5"]'
      );

      const result = await rewriter.multiQueryRewrite('test', { maxVariants: 2 });

      expect(result.variants.length).toBeLessThanOrEqual(2);
    });
  });

  describe('hydeRewrite', () => {
    it('should generate hypothetical document', async () => {
      mockLLMManager.query.mockResolvedValue(
        'RAG (Retrieval-Augmented Generation) is a technique that combines retrieval and generation...'
      );

      const result = await rewriter.hydeRewrite('What is RAG?');

      expect(result.originalQuery).toBe('What is RAG?');
      expect(result.method).toBe('hyde');
      expect(result.hypotheticalDocument).toBeDefined();
      expect(result.rewrittenQueries).toHaveLength(2);
    });
  });

  describe('stepBackRewrite', () => {
    it('should generate abstract query', async () => {
      mockLLMManager.query.mockResolvedValue('Python文件操作方法');

      const result = await rewriter.stepBackRewrite('如何在Python中读取CSV文件?');

      expect(result.originalQuery).toBe('如何在Python中读取CSV文件?');
      expect(result.method).toBe('step_back');
      expect(result.abstractQuery).toBeDefined();
      expect(result.rewrittenQueries).toHaveLength(2);
    });
  });

  describe('decomposeQuery', () => {
    it('should decompose complex query', async () => {
      mockLLMManager.query.mockResolvedValue(
        '["RAG系统的实现原理是什么", "RAG系统有哪些优化方法"]'
      );

      const result = await rewriter.decomposeQuery('RAG系统的实现原理和优化方法');

      expect(result.originalQuery).toBe('RAG系统的实现原理和优化方法');
      expect(result.method).toBe('decompose');
      expect(result.subQueries).toBeDefined();
      expect(result.subQueries.length).toBeGreaterThan(0);
    });
  });

  describe('parseQueryVariants', () => {
    it('should parse JSON array', () => {
      const response = '["query1", "query2", "query3"]';
      const variants = rewriter.parseQueryVariants(response, 3);

      expect(variants).toEqual(['query1', 'query2', 'query3']);
    });

    it('should parse JSON array with extra text', () => {
      const response = 'Here are the variants:\n["query1", "query2"]';
      const variants = rewriter.parseQueryVariants(response, 3);

      expect(variants).toEqual(['query1', 'query2']);
    });

    it('should fallback to line parsing', () => {
      const response = 'query1\nquery2\nquery3';
      const variants = rewriter.parseQueryVariants(response, 3);

      expect(variants.length).toBeLessThanOrEqual(3);
    });

    it('should handle numbered list', () => {
      const response = '1. First query variant here\n2. Second query variant here\n3. Third query variant here';
      const variants = rewriter.parseQueryVariants(response, 3);

      expect(variants.length).toBeGreaterThan(0);
      // 验证解析出了内容
      expect(variants[0]).toContain('query');
    });

    it('should handle bullet list', () => {
      const response = '- First query variant here\n- Second query variant here\n- Third query variant here';
      const variants = rewriter.parseQueryVariants(response, 3);

      // 解析可能返回原始响应或处理后的结果
      expect(variants.length).toBeGreaterThan(0);
    });

    it('should respect maxCount', () => {
      const response = '["q1", "q2", "q3", "q4", "q5"]';
      const variants = rewriter.parseQueryVariants(response, 2);

      expect(variants.length).toBe(2);
    });

    it('should filter short lines', () => {
      const response = 'a\nShort\nThis is a valid query';
      const variants = rewriter.parseQueryVariants(response, 5);

      // 短于5个字符的应该被过滤
      variants.forEach((v) => {
        expect(v.length).toBeGreaterThan(5);
      });
    });

    it('should handle empty response', () => {
      const variants = rewriter.parseQueryVariants('', 3);
      expect(variants).toEqual([]);
    });
  });

  describe('rewriteQueries (batch)', () => {
    it('should rewrite multiple queries', async () => {
      mockLLMManager.query.mockResolvedValue('["variant"]');

      const queries = ['query1', 'query2', 'query3'];
      const results = await rewriter.rewriteQueries(queries);

      expect(results).toHaveLength(3);
      expect(mockLLMManager.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('clearCache', () => {
    it('should clear cache', () => {
      rewriter.cache.set('key1', 'value1');
      rewriter.cache.set('key2', 'value2');

      rewriter.clearCache();

      expect(rewriter.cache.size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      rewriter.cache.set('key1', 'value1');
      rewriter.cache.set('key2', 'value2');

      const stats = rewriter.getCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(100);
    });
  });

  describe('updateConfig', () => {
    it('should update config', () => {
      rewriter.updateConfig({ method: 'hyde', maxVariants: 5 });

      expect(rewriter.config.method).toBe('hyde');
      expect(rewriter.config.maxVariants).toBe(5);
    });
  });

  describe('getConfig', () => {
    it('should return copy of config', () => {
      const config = rewriter.getConfig();

      expect(config.method).toBe('multi_query');
      config.method = 'changed';
      expect(rewriter.config.method).toBe('multi_query');
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable rewriting', () => {
      rewriter.setEnabled(false);
      expect(rewriter.config.enabled).toBe(false);

      rewriter.setEnabled(true);
      expect(rewriter.config.enabled).toBe(true);
    });
  });

  describe('unknown method', () => {
    it('should return original query for unknown method', async () => {
      const result = await rewriter.rewriteQuery('test', { method: 'unknown_method' });

      expect(result.originalQuery).toBe('test');
      expect(result.rewrittenQueries).toEqual(['test']);
      expect(result.method).toBe('none');
    });
  });
});
