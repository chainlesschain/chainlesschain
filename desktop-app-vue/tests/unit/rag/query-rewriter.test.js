/**
 * Query Rewriter 单元测试
 * 测试目标: src/main/rag/query-rewriter.js
 *
 * 覆盖场景:
 * - Multi-Query 重写
 * - HyDE (Hypothetical Document Embeddings) 重写
 * - Step-Back 抽象化重写
 * - Query Decompose 分解重写
 * - 查询缓存机制
 * - LLM 响应解析
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(),
}));

describe('QueryRewriter', () => {
  let QueryRewriter;
  let queryRewriter;
  let mockLLMManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock LLM Manager
    mockLLMManager = {
      query: vi.fn().mockResolvedValue('Mock LLM response'),
    };

    // 动态导入 QueryRewriter
    const module = await import('../../../src/main/rag/query-rewriter.js');
    QueryRewriter = module.QueryRewriter;

    queryRewriter = new QueryRewriter(mockLLMManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryRewriter = null;
  });

  // =====================================================================
  // 构造函数测试
  // =====================================================================

  describe('构造函数', () => {
    it('应该正确初始化 QueryRewriter', () => {
      expect(queryRewriter.llmManager).toBe(mockLLMManager);
      expect(queryRewriter.cache).toBeInstanceOf(Map);
      expect(queryRewriter.cache.size).toBe(0);
    });

    it('应该使用默认配置', () => {
      expect(queryRewriter.config).toMatchObject({
        enabled: true,
        method: 'multi_query',
        maxVariants: 3,
        temperature: 0.7,
        enableCache: true,
      });
    });

    it('应该支持自定义配置', () => {
      const customConfig = {
        enabled: false,
        method: 'hyde',
        maxVariants: 5,
      };

      const customRewriter = new QueryRewriter(mockLLMManager, customConfig);

      expect(customRewriter.config.enabled).toBe(false);
      expect(customRewriter.config.method).toBe('hyde');
      expect(customRewriter.config.maxVariants).toBe(5);
    });
  });

  // =====================================================================
  // 基本重写功能测试
  // =====================================================================

  describe('rewriteQuery - 基本功能', () => {
    it('禁用时应该返回原始查询', async () => {
      queryRewriter.config.enabled = false;

      const result = await queryRewriter.rewriteQuery('test query');

      expect(result.originalQuery).toBe('test query');
      expect(result.rewrittenQueries).toEqual(['test query']);
      expect(result.method).toBe('none');
    });

    it('应该触发 rewrite-start 事件', async () => {
      const startSpy = vi.fn();
      queryRewriter.on('rewrite-start', startSpy);

      await queryRewriter.rewriteQuery('test query');

      expect(startSpy).toHaveBeenCalledWith({
        query: 'test query',
        method: 'multi_query',
      });
    });

    it('应该触发 rewrite-complete 事件', async () => {
      const completeSpy = vi.fn();
      queryRewriter.on('rewrite-complete', completeSpy);

      mockLLMManager.query = vi.fn().mockResolvedValue('["variant1", "variant2"]');

      await queryRewriter.rewriteQuery('test query');

      expect(completeSpy).toHaveBeenCalled();
      expect(completeSpy.mock.calls[0][0]).toHaveProperty('query', 'test query');
      expect(completeSpy.mock.calls[0][0]).toHaveProperty('method', 'multi_query');
    });

    it('失败时应该返回 fallback 结果', async () => {
      mockLLMManager.query = vi.fn().mockRejectedValue(new Error('LLM error'));

      const result = await queryRewriter.rewriteQuery('test query');

      expect(result.method).toBe('fallback');
      expect(result.rewrittenQueries).toEqual(['test query']);
      expect(result.error).toBe('LLM error');
    });

    it('失败时应该触发 rewrite-error 事件', async () => {
      const errorSpy = vi.fn();
      queryRewriter.on('rewrite-error', errorSpy);

      mockLLMManager.query = vi.fn().mockRejectedValue(new Error('LLM error'));

      await queryRewriter.rewriteQuery('test query');

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // Multi-Query 重写测试
  // =====================================================================

  describe('multiQueryRewrite', () => {
    it('应该生成多个查询变体', async () => {
      const mockResponse = JSON.stringify([
        'How to read CSV in Python?',
        'Python CSV file reading methods',
        'Load CSV data using Python',
      ]);

      mockLLMManager.query = vi.fn().mockResolvedValue(mockResponse);

      const result = await queryRewriter.multiQueryRewrite('How to read CSV files in Python');

      expect(result.method).toBe('multi_query');
      expect(result.rewrittenQueries.length).toBeGreaterThan(1);
      expect(result.variants).toHaveLength(3);
    });

    it('应该包含原始查询', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant1", "variant2"]');

      const originalQuery = 'original query';
      const result = await queryRewriter.multiQueryRewrite(originalQuery);

      expect(result.rewrittenQueries[0]).toBe(originalQuery);
    });

    it('应该限制变体数量', async () => {
      const mockResponse = JSON.stringify([
        'variant1',
        'variant2',
        'variant3',
        'variant4',
        'variant5',
      ]);

      mockLLMManager.query = vi.fn().mockResolvedValue(mockResponse);

      const result = await queryRewriter.multiQueryRewrite('test', { maxVariants: 2 });

      expect(result.variants.length).toBeLessThanOrEqual(2);
    });

    it('应该使用正确的温度参数', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant1"]');

      await queryRewriter.multiQueryRewrite('test');

      expect(mockLLMManager.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          temperature: 0.7,
        })
      );
    });
  });

  // =====================================================================
  // HyDE 重写测试
  // =====================================================================

  describe('hydeRewrite', () => {
    it('应该生成假设答案', async () => {
      const hypotheticalAnswer = 'Python provides the csv module for reading CSV files. You can use csv.reader() or csv.DictReader().';

      mockLLMManager.query = vi.fn().mockResolvedValue(hypotheticalAnswer);

      const result = await queryRewriter.hydeRewrite('How to read CSV files in Python?');

      expect(result.method).toBe('hyde');
      expect(result.hypotheticalDocument).toBe(hypotheticalAnswer);
      expect(result.rewrittenQueries).toContain(hypotheticalAnswer);
    });

    it('应该包含原始查询和假设文档', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('Hypothetical answer');

      const originalQuery = 'test query';
      const result = await queryRewriter.hydeRewrite(originalQuery);

      expect(result.rewrittenQueries).toHaveLength(2);
      expect(result.rewrittenQueries[0]).toBe(originalQuery);
    });

    it('应该使用较低的温度参数', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('Answer');

      await queryRewriter.hydeRewrite('test');

      expect(mockLLMManager.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          temperature: 0.5,
        })
      );
    });
  });

  // =====================================================================
  // Step-Back 重写测试
  // =====================================================================

  describe('stepBackRewrite', () => {
    it('应该生成抽象查询', async () => {
      const abstractQuery = 'Python file I/O operations';

      mockLLMManager.query = vi.fn().mockResolvedValue(abstractQuery);

      const result = await queryRewriter.stepBackRewrite('How to read CSV files in Python?');

      expect(result.method).toBe('step_back');
      expect(result.abstractQuery).toBe(abstractQuery);
      expect(result.rewrittenQueries).toContain(abstractQuery);
    });

    it('应该移除具体细节', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('General concept');

      const result = await queryRewriter.stepBackRewrite('Specific detail query');

      expect(result.rewrittenQueries).toHaveLength(2);
    });

    it('应该使用低温度参数', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('Abstract query');

      await queryRewriter.stepBackRewrite('test');

      expect(mockLLMManager.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          temperature: 0.3,
        })
      );
    });
  });

  // =====================================================================
  // Query Decompose 测试
  // =====================================================================

  describe('decomposeQuery', () => {
    it('应该将复杂查询分解为多个子查询', async () => {
      const mockResponse = JSON.stringify([
        'What is RAG system implementation?',
        'What are RAG optimization methods?',
      ]);

      mockLLMManager.query = vi.fn().mockResolvedValue(mockResponse);

      const result = await queryRewriter.decomposeQuery('RAG system implementation and optimization');

      expect(result.method).toBe('decompose');
      expect(result.subQueries.length).toBeGreaterThan(0);
      expect(result.rewrittenQueries.length).toBeGreaterThan(1);
    });

    it('应该包含原始查询和子查询', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["sub1", "sub2"]');

      const originalQuery = 'complex query';
      const result = await queryRewriter.decomposeQuery(originalQuery);

      expect(result.rewrittenQueries[0]).toBe(originalQuery);
    });
  });

  // =====================================================================
  // LLM 响应解析测试
  // =====================================================================

  describe('parseQueryVariants', () => {
    it('应该解析 JSON 数组格式', () => {
      const response = '["variant1", "variant2", "variant3"]';

      const variants = queryRewriter.parseQueryVariants(response, 3);

      expect(variants).toEqual(['variant1', 'variant2', 'variant3']);
    });

    it('应该限制解析数量', () => {
      const response = '["v1", "v2", "v3", "v4", "v5"]';

      const variants = queryRewriter.parseQueryVariants(response, 2);

      expect(variants).toHaveLength(2);
    });

    it('应该处理包含额外文本的 JSON', () => {
      const response = 'Here are the variants:\n["variant1", "variant2"]\nThat\'s all.';

      const variants = queryRewriter.parseQueryVariants(response, 3);

      expect(variants).toContain('variant1');
      expect(variants).toContain('variant2');
    });

    it('JSON 解析失败时应该按行分割', () => {
      const response = `
1. First variant
2. Second variant
3. Third variant
      `.trim();

      const variants = queryRewriter.parseQueryVariants(response, 3);

      expect(variants.length).toBeGreaterThan(0);
    });

    it('应该过滤空行和符号', () => {
      const response = `
[
"variant1"
]
      `.trim();

      const variants = queryRewriter.parseQueryVariants(response, 3);

      expect(variants).not.toContain('[');
      expect(variants).not.toContain(']');
    });

    it.skip('应该移除编号标记', () => {
      const response = `
1. First query
2) Second query
3、Third query
      `.trim();

      const variants = queryRewriter.parseQueryVariants(response, 3);

      expect(variants.some(v => v.startsWith('1.'))).toBe(false);
      expect(variants.some(v => v.startsWith('2)'))).toBe(false);
      expect(variants.some(v => v.startsWith('3、'))).toBe(false);
    });

    it('应该清理引号', () => {
      const response = '"Quoted variant"';

      const variants = queryRewriter.parseQueryVariants(response, 1);

      expect(variants[0]).toBe('Quoted variant');
    });

    it('完全解析失败时应该返回清理后的原文', () => {
      const response = 'Just a simple text response';

      const variants = queryRewriter.parseQueryVariants(response, 1);

      expect(variants).toHaveLength(1);
      expect(variants[0]).toBe('Just a simple text response');
    });
  });

  // =====================================================================
  // 缓存功能测试
  // =====================================================================

  describe('缓存功能', () => {
    beforeEach(() => {
      queryRewriter.config.enableCache = true;
    });

    it('应该缓存重写结果', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant1"]');

      const query = 'test query';
      await queryRewriter.rewriteQuery(query);
      await queryRewriter.rewriteQuery(query);

      // LLM 应该只调用一次
      expect(mockLLMManager.query).toHaveBeenCalledTimes(1);
    });

    it('应该返回缓存的结果', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant1"]');

      const query = 'test query';
      const result1 = await queryRewriter.rewriteQuery(query);
      const result2 = await queryRewriter.rewriteQuery(query);

      expect(result1).toEqual(result2);
    });

    it('不同方法应该使用不同的缓存键', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('variant');

      const query = 'test query';
      await queryRewriter.rewriteQuery(query, { method: 'multi_query' });
      await queryRewriter.rewriteQuery(query, { method: 'hyde' });

      // 不同方法应该分别调用 LLM
      expect(mockLLMManager.query).toHaveBeenCalledTimes(2);
    });

    it('应该限制缓存大小', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant"]');

      // 添加 101 个查询，应该淘汰第一个
      for (let i = 0; i < 101; i++) {
        await queryRewriter.rewriteQuery(`query${i}`);
      }

      expect(queryRewriter.cache.size).toBeLessThanOrEqual(100);
    });

    it('禁用缓存时不应该缓存', async () => {
      queryRewriter.config.enableCache = false;
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant"]');

      const query = 'test query';
      await queryRewriter.rewriteQuery(query);
      await queryRewriter.rewriteQuery(query);

      expect(mockLLMManager.query).toHaveBeenCalledTimes(2);
    });

    it('应该清除缓存', () => {
      queryRewriter.cache.set('key1', 'value1');
      queryRewriter.cache.set('key2', 'value2');

      queryRewriter.clearCache();

      expect(queryRewriter.cache.size).toBe(0);
    });

    it('应该获取缓存统计', () => {
      queryRewriter.cache.set('key1', 'value1');
      queryRewriter.cache.set('key2', 'value2');

      const stats = queryRewriter.getCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(100);
    });
  });

  // =====================================================================
  // 批量重写测试
  // =====================================================================

  describe('rewriteQueries - 批量重写', () => {
    it('应该批量重写多个查询', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant"]');

      const queries = ['query1', 'query2', 'query3'];
      const results = await queryRewriter.rewriteQueries(queries);

      expect(results).toHaveLength(3);
      expect(results[0].originalQuery).toBe('query1');
      expect(results[1].originalQuery).toBe('query2');
      expect(results[2].originalQuery).toBe('query3');
    });

    it('应该使用相同的选项', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('variant');

      const queries = ['query1', 'query2'];
      await queryRewriter.rewriteQueries(queries, { method: 'hyde' });

      expect(mockLLMManager.query).toHaveBeenCalledTimes(2);
    });
  });

  // =====================================================================
  // 配置管理测试
  // =====================================================================

  describe('配置管理', () => {
    it('应该更新配置', () => {
      queryRewriter.updateConfig({ maxVariants: 5, temperature: 0.9 });

      expect(queryRewriter.config.maxVariants).toBe(5);
      expect(queryRewriter.config.temperature).toBe(0.9);
    });

    it('应该获取当前配置', () => {
      const config = queryRewriter.getConfig();

      expect(config).toMatchObject({
        enabled: true,
        method: 'multi_query',
        maxVariants: 3,
      });
    });

    it('应该启用/禁用查询重写', () => {
      queryRewriter.setEnabled(false);
      expect(queryRewriter.config.enabled).toBe(false);

      queryRewriter.setEnabled(true);
      expect(queryRewriter.config.enabled).toBe(true);
    });
  });

  // =====================================================================
  // 边界情况测试
  // =====================================================================

  describe('边界情况', () => {
    it('应该处理空查询', async () => {
      const result = await queryRewriter.rewriteQuery('');

      expect(result.originalQuery).toBe('');
      expect(result.rewrittenQueries).toContain('');
    });

    it('应该处理 LLM 返回空响应', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('');

      const result = await queryRewriter.rewriteQuery('test query');

      expect(result.rewrittenQueries).toContain('test query');
    });

    it('应该处理未知的重写方法', async () => {
      const result = await queryRewriter.rewriteQuery('test', { method: 'unknown' });

      expect(result.method).toBe('none');
      expect(result.rewrittenQueries).toEqual(['test']);
    });

    it('应该处理 LLM 返回无效 JSON', async () => {
      mockLLMManager.query = vi.fn().mockResolvedValue('not a json array');

      const result = await queryRewriter.multiQueryRewrite('test');

      expect(result.rewrittenQueries).toBeDefined();
      expect(result.variants).toBeDefined();
    });

    it('应该处理超长查询', async () => {
      const longQuery = 'a'.repeat(10000);
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant"]');

      const result = await queryRewriter.rewriteQuery(longQuery);

      expect(result.originalQuery).toBe(longQuery);
    });

    it('应该处理特殊字符', async () => {
      const specialQuery = 'Query with "quotes" and \'apostrophes\' and \n newlines';
      mockLLMManager.query = vi.fn().mockResolvedValue('["variant"]');

      const result = await queryRewriter.rewriteQuery(specialQuery);

      expect(result.originalQuery).toBe(specialQuery);
    });
  });
});
