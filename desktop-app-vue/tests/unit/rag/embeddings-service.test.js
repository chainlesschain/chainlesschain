/**
 * 嵌入向量服务单元测试
 * 测试目标: src/main/rag/embeddings-service.js
 * 覆盖场景: 向量生成、缓存管理、相似度计算、降级方案
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ============================================================
// CRITICAL: Mock ALL dependencies BEFORE any imports
// ============================================================

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
};

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger)
}));

// Mock lru-cache (CommonJS - may not work fully)
const mockLRUCache = vi.fn(function(options) {
  const cache = new Map();
  const mockCache = {
    get: (key) => cache.get(key),
    set: (key, value) => cache.set(key, value),
    has: (key) => cache.has(key),
    clear: vi.fn(() => cache.clear()),
    reset: vi.fn(() => cache.clear()),
    dump: vi.fn(() => Array.from(cache.entries()).map(([k, v]) => ({ k, v }))),
    max: options.max,
    maxAge: options.maxAge
  };

  // Make size a getter so it updates dynamically
  Object.defineProperty(mockCache, 'size', {
    get: () => cache.size
  });

  return mockCache;
});

vi.mock('lru-cache', () => mockLRUCache);

describe('EmbeddingsService', () => {
  let EmbeddingsService;
  let service;
  let mockLLMManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock LLM Manager
    mockLLMManager = {
      isInitialized: true,
      embeddings: vi.fn(async (text) => {
        // Mock vector generation - return a simple vector
        return Array(384).fill(0).map((_, i) => Math.sin(i * text.length / 100));
      })
    };

    // Dynamic import of module under test
    const module = await import('../../../src/main/rag/embeddings-service.js');
    EmbeddingsService = module.EmbeddingsService;
  });

  afterEach(() => {
    if (service) {
      service.clearCache();
      service = null;
    }
  });

  describe('构造函数', () => {
    it('应该创建实例并存储llmManager', () => {
      service = new EmbeddingsService(mockLLMManager);

      expect(service.llmManager).toBe(mockLLMManager);
      expect(service.isInitialized).toBe(false);
    });

    it('应该初始化缓存统计', () => {
      service = new EmbeddingsService(mockLLMManager);

      expect(service.cacheHits).toBe(0);
      expect(service.cacheMisses).toBe(0);
    });

    it('应该继承EventEmitter', () => {
      service = new EmbeddingsService(mockLLMManager);

      // Check for EventEmitter methods instead of instanceof due to CommonJS/ESM differences
      expect(typeof service.on).toBe('function');
      expect(typeof service.emit).toBe('function');
      expect(typeof service.removeListener).toBe('function');
    });

    it.skip('应该使用LRU缓存（如果可用）', () => {
      // TODO: lru-cache mock doesn't work with CommonJS require()
    });

    it('应该使用Map作为降级方案', () => {
      service = new EmbeddingsService(mockLLMManager);

      // Map should be available
      expect(service.cache).toBeDefined();
      expect(service.cache instanceof Map || service.cache.set).toBeTruthy();
    });
  });

  describe('initialize', () => {
    it('应该在LLM服务可用时初始化成功', async () => {
      service = new EmbeddingsService(mockLLMManager);

      const result = await service.initialize();

      expect(result).toBe(true);
      expect(service.isInitialized).toBe(true);
    });

    it('应该在LLM服务未初始化时返回false', async () => {
      mockLLMManager.isInitialized = false;
      service = new EmbeddingsService(mockLLMManager);

      const result = await service.initialize();

      expect(result).toBe(false);
      expect(service.isInitialized).toBe(false);
    });

    it('应该在llmManager为null时返回false', async () => {
      service = new EmbeddingsService(null);

      const result = await service.initialize();

      expect(result).toBe(false);
      expect(service.isInitialized).toBe(false);
    });

    it('应该在llmManager为undefined时返回false', async () => {
      service = new EmbeddingsService(undefined);

      const result = await service.initialize();

      expect(result).toBe(false);
      expect(service.isInitialized).toBe(false);
    });
  });

  describe('generateEmbedding', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该生成文本嵌入向量', async () => {
      const text = 'Hello world';

      const embedding = await service.generateEmbedding(text);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      expect(mockLLMManager.embeddings).toHaveBeenCalledWith(text);
    });

    it('应该在文本为空时抛出错误', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow('文本内容不能为空');
    });

    it('应该在文本为纯空格时抛出错误', async () => {
      await expect(service.generateEmbedding('   ')).rejects.toThrow('文本内容不能为空');
    });

    it('应该在文本为null时抛出错误', async () => {
      await expect(service.generateEmbedding(null)).rejects.toThrow('文本内容不能为空');
    });

    it('应该缓存生成的向量', async () => {
      const text = 'Test text';

      const embedding1 = await service.generateEmbedding(text);
      const embedding2 = await service.generateEmbedding(text);

      expect(embedding1).toEqual(embedding2);
      expect(mockLLMManager.embeddings).toHaveBeenCalledTimes(1); // Only called once
      expect(service.cacheHits).toBe(1);
      expect(service.cacheMisses).toBe(1);
    });

    it('应该在skipCache选项时跳过缓存', async () => {
      const text = 'Test text';

      await service.generateEmbedding(text);
      await service.generateEmbedding(text, { skipCache: true });

      expect(mockLLMManager.embeddings).toHaveBeenCalledTimes(2);
      expect(service.cacheMisses).toBe(2);
    });

    it('应该在LLM返回非数组时使用简单嵌入', async () => {
      mockLLMManager.embeddings.mockResolvedValueOnce(null);

      const embedding = await service.generateEmbedding('test');

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(128); // Simple embedding dimension
    });

    it('应该在LLM抛出错误时降级到简单嵌入', async () => {
      mockLLMManager.embeddings.mockRejectedValueOnce(new Error('LLM error'));

      const embedding = await service.generateEmbedding('test');

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(128);
    });
  });

  describe('generateEmbeddings', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该批量生成嵌入向量', async () => {
      const texts = ['text1', 'text2', 'text3'];

      const embeddings = await service.generateEmbeddings(texts);

      expect(embeddings).toHaveLength(3);
      expect(embeddings.every(e => Array.isArray(e))).toBe(true);
      expect(mockLLMManager.embeddings).toHaveBeenCalledTimes(3);
    });

    it('应该处理空数组', async () => {
      const embeddings = await service.generateEmbeddings([]);

      expect(embeddings).toEqual([]);
    });

    it('应该在单个文本失败时返回null', async () => {
      mockLLMManager.embeddings
        .mockResolvedValueOnce([1, 2, 3])
        .mockRejectedValueOnce(new Error('Failed'));

      const embeddings = await service.generateEmbeddings(['text1', '']);

      expect(embeddings).toHaveLength(2);
      expect(embeddings[0]).toBeDefined();
      expect(embeddings[1]).toBeNull();
    });

    it('应该支持缓存批量请求', async () => {
      const texts = ['same', 'same', 'different'];

      await service.generateEmbeddings(texts);

      // 'same' should be cached after first call
      expect(mockLLMManager.embeddings).toHaveBeenCalledTimes(2); // Only 'same' and 'different'
    });
  });

  describe('cosineSimilarity', () => {
    beforeEach(() => {
      service = new EmbeddingsService(mockLLMManager);
    });

    it('应该计算相同向量的相似度为1', () => {
      const vec = [1, 2, 3, 4];

      const similarity = service.cosineSimilarity(vec, vec);

      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('应该计算正交向量的相似度为0', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];

      const similarity = service.cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(0, 5);
    });

    it('应该计算相反向量的相似度为-1', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [-1, -2, -3];

      const similarity = service.cosineSimilarity(vec1, vec2);

      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    it('应该处理零向量', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];

      const similarity = service.cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(0);
    });

    it('应该在向量长度不同时返回0', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2];

      const similarity = service.cosineSimilarity(vec1, vec2);

      expect(similarity).toBe(0);
    });

    it('应该在向量为null时返回0', () => {
      const similarity = service.cosineSimilarity(null, [1, 2, 3]);

      expect(similarity).toBe(0);
    });

    it('应该处理高维向量', () => {
      const vec1 = Array(384).fill(0).map((_, i) => Math.sin(i));
      const vec2 = Array(384).fill(0).map((_, i) => Math.cos(i));

      const similarity = service.cosineSimilarity(vec1, vec2);

      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('generateSimpleEmbedding', () => {
    beforeEach(() => {
      service = new EmbeddingsService(mockLLMManager);
    });

    it('应该生成128维向量', () => {
      const embedding = service.generateSimpleEmbedding('test text');

      expect(embedding).toHaveLength(128);
    });

    it('应该对相同文本生成相同向量', () => {
      const text = 'Hello world';

      const emb1 = service.generateSimpleEmbedding(text);
      const emb2 = service.generateSimpleEmbedding(text);

      expect(emb1).toEqual(emb2);
    });

    it('应该对不同文本生成不同向量', () => {
      const emb1 = service.generateSimpleEmbedding('hello');
      const emb2 = service.generateSimpleEmbedding('world');

      expect(emb1).not.toEqual(emb2);
    });

    it('应该归一化向量值到0-1', () => {
      const embedding = service.generateSimpleEmbedding('test text with many words');

      const allInRange = embedding.every(val => val >= 0 && val <= 1);
      expect(allInRange).toBe(true);
    });

    it('应该处理空字符串', () => {
      const embedding = service.generateSimpleEmbedding('');

      expect(embedding).toHaveLength(128);
      // Empty string splits to [""], so features[64] gets incremented
      // After normalization, features[64] = 1 and rest are 0
      expect(embedding.filter(val => val === 0).length).toBe(127);
      expect(embedding[64]).toBe(1);
    });

    it('应该处理大小写不敏感', () => {
      const emb1 = service.generateSimpleEmbedding('HELLO');
      const emb2 = service.generateSimpleEmbedding('hello');

      expect(emb1).toEqual(emb2);
    });

    it('应该处理中文文本', () => {
      const embedding = service.generateSimpleEmbedding('你好世界');

      expect(embedding).toHaveLength(128);
      expect(embedding.some(val => val > 0)).toBe(true);
    });
  });

  describe('getCacheKey', () => {
    beforeEach(() => {
      service = new EmbeddingsService(mockLLMManager);
    });

    it('应该为相同文本生成相同的键', () => {
      const text = 'test text';

      const key1 = service.getCacheKey(text);
      const key2 = service.getCacheKey(text);

      expect(key1).toBe(key2);
    });

    it('应该为不同文本生成不同的键', () => {
      const key1 = service.getCacheKey('text1');
      const key2 = service.getCacheKey('text2');

      expect(key1).not.toBe(key2);
    });

    it('应该返回字符串', () => {
      const key = service.getCacheKey('test');

      expect(typeof key).toBe('string');
    });

    it('应该处理空字符串', () => {
      const key = service.getCacheKey('');

      expect(typeof key).toBe('string');
    });

    it('应该处理长文本', () => {
      const longText = 'a'.repeat(10000);

      const key = service.getCacheKey(longText);

      expect(typeof key).toBe('string');
    });
  });

  describe('clearCache', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该清除缓存', async () => {
      await service.generateEmbedding('test1');
      await service.generateEmbedding('test2');

      // Cache should have entries
      const sizeBefore = service.cache instanceof Map ? service.cache.size :
                        (service.cache.dump ? service.cache.dump().length : 0);
      expect(sizeBefore).toBeGreaterThan(0);

      service.clearCache();

      const sizeAfter = service.cache instanceof Map ? service.cache.size :
                       (service.cache.dump ? service.cache.dump().length : 0);
      expect(sizeAfter).toBe(0);
    });

    it('应该重置缓存统计', async () => {
      await service.generateEmbedding('test');
      await service.generateEmbedding('test'); // Cache hit

      expect(service.cacheHits).toBe(1);
      expect(service.cacheMisses).toBe(1);

      service.clearCache();

      expect(service.cacheHits).toBe(0);
      expect(service.cacheMisses).toBe(0);
    });

    it('应该在空缓存时不抛出错误', () => {
      expect(() => service.clearCache()).not.toThrow();
    });
  });

  describe('getCacheStats', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该返回缓存统计信息', () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('cacheType');
    });

    it('应该计算正确的命中率', async () => {
      await service.generateEmbedding('test1');
      await service.generateEmbedding('test1'); // Cache hit
      await service.generateEmbedding('test2');
      await service.generateEmbedding('test1'); // Cache hit

      const stats = service.getCacheStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.totalRequests).toBe(4);
      expect(stats.hitRate).toBeCloseTo(0.5, 2);
    });

    it('应该在无请求时返回0命中率', () => {
      const stats = service.getCacheStats();

      expect(stats.hitRate).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });

    it.skip('应该显示缓存大小', async () => {
      // TODO: LRU cache mock doesn't work with CommonJS require()
      // The mock's size getter returns undefined because Vitest vi.mock()
      // cannot intercept CommonJS require() calls
      await service.generateEmbedding('test1');
      await service.generateEmbedding('test2');

      const stats = service.getCacheStats();

      // Size should reflect the number of cached items
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.size).toBeLessThanOrEqual(2);
    });

    it('应该显示最大缓存大小', () => {
      const stats = service.getCacheStats();

      expect(stats.maxSize).toBe(2000);
    });
  });

  describe('缓存管理', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it.skip('应该在超过2000条时自动清理（Map模式）', async () => {
      // TODO: This would require generating 2000+ embeddings which is too slow for unit tests
      // Should be tested in integration tests
    });

    it('应该正确跟踪缓存命中', async () => {
      await service.generateEmbedding('test');
      expect(service.cacheHits).toBe(0);
      expect(service.cacheMisses).toBe(1);

      await service.generateEmbedding('test');
      expect(service.cacheHits).toBe(1);
      expect(service.cacheMisses).toBe(1);
    });
  });

  describe('错误处理', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该处理LLM服务错误', async () => {
      mockLLMManager.embeddings.mockRejectedValueOnce(new Error('Network error'));

      const embedding = await service.generateEmbedding('test');

      expect(embedding).toBeDefined();
      expect(embedding).toHaveLength(128); // Fallback to simple embedding
    });

    it('应该处理无效的向量', async () => {
      mockLLMManager.embeddings.mockResolvedValueOnce(undefined);

      const embedding = await service.generateEmbedding('test');

      expect(embedding).toBeDefined();
      expect(embedding).toHaveLength(128);
    });

    it('应该在批量处理中继续处理其他文本', async () => {
      const texts = ['valid', '', 'also valid'];

      const embeddings = await service.generateEmbeddings(texts);

      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toBeDefined();
      expect(embeddings[1]).toBeNull(); // Empty text fails
      expect(embeddings[2]).toBeDefined();
    });
  });

  describe('边界情况', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该处理超长文本', async () => {
      const longText = 'a'.repeat(100000);

      const embedding = await service.generateEmbedding(longText);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
    });

    it('应该处理特殊字符', async () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:,.<>?';

      const embedding = await service.generateEmbedding(specialText);

      expect(embedding).toBeDefined();
    });

    it('应该处理Unicode字符', async () => {
      const unicodeText = '你好世界🌍😀';

      const embedding = await service.generateEmbedding(unicodeText);

      expect(embedding).toBeDefined();
    });

    it('应该处理换行符', async () => {
      const multilineText = 'line1\nline2\rline3\r\nline4';

      const embedding = await service.generateEmbedding(multilineText);

      expect(embedding).toBeDefined();
    });
  });

  describe('性能优化', () => {
    beforeEach(async () => {
      service = new EmbeddingsService(mockLLMManager);
      await service.initialize();
    });

    it('应该通过缓存减少LLM调用', async () => {
      const text = 'repeated text';

      await service.generateEmbedding(text);
      await service.generateEmbedding(text);
      await service.generateEmbedding(text);

      expect(mockLLMManager.embeddings).toHaveBeenCalledTimes(1);
    });

    it('应该正确计算缓存命中率', async () => {
      // 3 unique texts, 2 repeated
      await service.generateEmbedding('text1');
      await service.generateEmbedding('text2');
      await service.generateEmbedding('text3');
      await service.generateEmbedding('text1'); // hit
      await service.generateEmbedding('text2'); // hit

      const stats = service.getCacheStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(3);
      expect(stats.hitRate).toBeCloseTo(0.4, 2);
    });
  });
});
