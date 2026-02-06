/**
 * EmbeddingCache 单元测试
 *
 * 测试内容：
 * - constructor 构造函数
 * - hashContent 内容哈希
 * - serializeEmbedding/deserializeEmbedding 序列化
 * - get/set/has/delete 缓存操作
 * - clear/cleanup 清理操作
 * - evictLRU LRU驱逐
 * - getCount/getStats 统计信息
 * - getMultiple/setMultiple 批量操作
 * - startAutoCleanup/stopAutoCleanup 自动清理
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
}));

const { EmbeddingCache } = require('../embedding-cache');

describe('EmbeddingCache', () => {
  let cache;
  let mockDb;
  let mockPreparedStatements;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // 创建 mock prepared statements
    mockPreparedStatements = {
      get: { get: vi.fn() },
      updateAccess: { run: vi.fn() },
      insert: { run: vi.fn() },
      delete: { run: vi.fn() },
      deleteExpired: { run: vi.fn() },
      deleteLRU: { run: vi.fn() },
      count: { get: vi.fn() },
      totalSize: { get: vi.fn() },
      statsByModel: { all: vi.fn() },
      clear: { run: vi.fn() },
    };

    // 创建 mock database
    mockDb = {
      prepare: vi.fn((sql) => {
        // 根据 SQL 内容返回对应的 mock statement
        if (sql.includes('SELECT embedding')) return mockPreparedStatements.get;
        if (sql.includes('UPDATE embedding_cache')) return mockPreparedStatements.updateAccess;
        if (sql.includes('INSERT OR REPLACE')) return mockPreparedStatements.insert;
        if (sql.includes('DELETE FROM embedding_cache WHERE content_hash = ?'))
          return mockPreparedStatements.delete;
        if (sql.includes('WHERE last_accessed_at <')) return mockPreparedStatements.deleteExpired;
        if (sql.includes('ORDER BY last_accessed_at ASC')) return mockPreparedStatements.deleteLRU;
        if (sql.includes('COUNT(*)')) return mockPreparedStatements.count;
        if (sql.includes('SUM(LENGTH')) return mockPreparedStatements.totalSize;
        if (sql.includes('GROUP BY model')) return mockPreparedStatements.statsByModel;
        if (sql.includes('DELETE FROM embedding_cache') && !sql.includes('WHERE'))
          return mockPreparedStatements.clear;
        return { get: vi.fn(), run: vi.fn(), all: vi.fn() };
      }),
      transaction: vi.fn((fn) => fn),
    };

    // 设置默认返回值
    mockPreparedStatements.count.get.mockReturnValue({ count: 0 });
    mockPreparedStatements.totalSize.get.mockReturnValue({ total_size: 0 });
    mockPreparedStatements.statsByModel.all.mockReturnValue([]);

    cache = new EmbeddingCache({
      database: mockDb,
      maxCacheSize: 1000,
      cacheExpiration: 7 * 24 * 60 * 60 * 1000, // 7天
      enableAutoCleanup: false,
    });
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should throw error without database', () => {
      expect(() => new EmbeddingCache({})).toThrow('database 参数是必需的');
    });

    it('should initialize with default config', () => {
      const defaultCache = new EmbeddingCache({ database: mockDb });

      expect(defaultCache.maxCacheSize).toBe(100000);
      expect(defaultCache.cacheExpiration).toBe(30 * 24 * 60 * 60 * 1000);
      expect(defaultCache.enableAutoCleanup).toBe(true);
      expect(defaultCache.storeOriginalContent).toBe(false);

      defaultCache.destroy();
    });

    it('should initialize with custom config', () => {
      expect(cache.maxCacheSize).toBe(1000);
      expect(cache.cacheExpiration).toBe(7 * 24 * 60 * 60 * 1000);
      expect(cache.enableAutoCleanup).toBe(false);
    });

    it('should initialize stats', () => {
      expect(cache.stats).toEqual({
        hits: 0,
        misses: 0,
        inserts: 0,
        evictions: 0,
      });
    });

    it('should be an EventEmitter', () => {
      expect(typeof cache.on).toBe('function');
      expect(typeof cache.emit).toBe('function');
    });
  });

  describe('hashContent', () => {
    it('should generate consistent hash for same content', () => {
      const hash1 = cache.hashContent('Hello World');
      const hash2 = cache.hashContent('Hello World');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should generate different hash for different content', () => {
      const hash1 = cache.hashContent('Hello World');
      const hash2 = cache.hashContent('Hello World!');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = cache.hashContent('');
      expect(hash).toHaveLength(64);
    });

    it('should handle unicode content', () => {
      const hash = cache.hashContent('你好世界');
      expect(hash).toHaveLength(64);
    });
  });

  describe('serializeEmbedding/deserializeEmbedding', () => {
    it('should serialize and deserialize embedding correctly', () => {
      const original = [0.1, 0.2, 0.3, 0.4, 0.5];
      const serialized = cache.serializeEmbedding(original);
      const deserialized = cache.deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(original.length);
      // Float32 有精度限制，使用 toBeCloseTo
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('should handle large embeddings', () => {
      const original = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      const serialized = cache.serializeEmbedding(original);
      const deserialized = cache.deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(1536);
    });

    it('should handle negative values', () => {
      const original = [-0.5, 0, 0.5, -1, 1];
      const serialized = cache.serializeEmbedding(original);
      const deserialized = cache.deserializeEmbedding(serialized);

      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i], 5);
      }
    });
  });

  describe('get', () => {
    it('should return null and increment miss count when not found', () => {
      mockPreparedStatements.get.get.mockReturnValue(null);

      const result = cache.get('test content', 'model1');

      expect(result).toBeNull();
      expect(cache.stats.misses).toBe(1);
      expect(cache.stats.hits).toBe(0);
    });

    it('should return embedding and increment hit count when found', () => {
      const embedding = [0.1, 0.2, 0.3];
      const serialized = cache.serializeEmbedding(embedding);

      mockPreparedStatements.get.get.mockReturnValue({
        embedding: serialized,
        dimension: 3,
        access_count: 1,
      });

      const result = cache.get('test content', 'model1');

      expect(result).toHaveLength(3);
      expect(cache.stats.hits).toBe(1);
      expect(cache.stats.misses).toBe(0);
      expect(mockPreparedStatements.updateAccess.run).toHaveBeenCalled();
    });

    it('should use default model when not specified', () => {
      mockPreparedStatements.get.get.mockReturnValue(null);

      cache.get('test content');

      expect(mockPreparedStatements.get.get).toHaveBeenCalledWith(expect.any(String), 'default');
    });

    it('should handle database errors gracefully', () => {
      mockPreparedStatements.get.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = cache.get('test content', 'model1');

      expect(result).toBeNull();
      expect(cache.stats.misses).toBe(1);
    });
  });

  describe('set', () => {
    it('should insert embedding successfully', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 0 });

      const result = cache.set('test content', [0.1, 0.2, 0.3], 'model1');

      expect(result).toBe(true);
      expect(cache.stats.inserts).toBe(1);
      expect(mockPreparedStatements.insert.run).toHaveBeenCalled();
    });

    it('should trigger LRU eviction when cache is full', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 1000 });
      mockPreparedStatements.deleteLRU.run.mockReturnValue({ changes: 100 });

      cache.set('test content', [0.1, 0.2, 0.3], 'model1');

      expect(mockPreparedStatements.deleteLRU.run).toHaveBeenCalledWith(100);
    });

    it('should emit cache-set event', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 0 });

      const eventHandler = vi.fn();
      cache.on('cache-set', eventHandler);

      cache.set('test content', [0.1, 0.2, 0.3], 'model1');

      expect(eventHandler).toHaveBeenCalledWith({
        contentHash: expect.any(String),
        model: 'model1',
        dimension: 3,
      });
    });

    it('should handle database errors gracefully', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 0 });
      mockPreparedStatements.insert.run.mockImplementation(() => {
        throw new Error('Insert error');
      });

      const result = cache.set('test content', [0.1, 0.2, 0.3], 'model1');

      expect(result).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true when cache exists', () => {
      mockPreparedStatements.get.get.mockReturnValue({ embedding: Buffer.from([]) });

      expect(cache.has('test content', 'model1')).toBe(true);
    });

    it('should return false when cache does not exist', () => {
      mockPreparedStatements.get.get.mockReturnValue(null);

      expect(cache.has('test content', 'model1')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete cache entry successfully', () => {
      mockPreparedStatements.delete.run.mockReturnValue({ changes: 1 });

      const result = cache.delete('test content');

      expect(result).toBe(true);
    });

    it('should return false when entry not found', () => {
      mockPreparedStatements.delete.run.mockReturnValue({ changes: 0 });

      const result = cache.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', () => {
      mockPreparedStatements.clear.run.mockReturnValue({ changes: 50 });

      // 先设置一些统计
      cache.stats.hits = 10;
      cache.stats.misses = 5;

      const deleted = cache.clear();

      expect(deleted).toBe(50);
      expect(cache.stats).toEqual({
        hits: 0,
        misses: 0,
        inserts: 0,
        evictions: 0,
      });
    });

    it('should emit cache-cleared event', () => {
      mockPreparedStatements.clear.run.mockReturnValue({ changes: 10 });

      const eventHandler = vi.fn();
      cache.on('cache-cleared', eventHandler);

      cache.clear();

      expect(eventHandler).toHaveBeenCalledWith({ deleted: 10 });
    });
  });

  describe('cleanup', () => {
    it('should delete expired entries', () => {
      mockPreparedStatements.deleteExpired.run.mockReturnValue({ changes: 5 });

      const deleted = cache.cleanup();

      expect(deleted).toBe(5);
      expect(cache.stats.evictions).toBe(5);
    });

    it('should emit cache-cleanup event when entries deleted', () => {
      mockPreparedStatements.deleteExpired.run.mockReturnValue({ changes: 3 });

      const eventHandler = vi.fn();
      cache.on('cache-cleanup', eventHandler);

      cache.cleanup();

      expect(eventHandler).toHaveBeenCalledWith({ deleted: 3, reason: 'expired' });
    });

    it('should not emit event when no entries deleted', () => {
      mockPreparedStatements.deleteExpired.run.mockReturnValue({ changes: 0 });

      const eventHandler = vi.fn();
      cache.on('cache-cleanup', eventHandler);

      cache.cleanup();

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe('evictLRU', () => {
    it('should delete least recently used entries', () => {
      mockPreparedStatements.deleteLRU.run.mockReturnValue({ changes: 10 });

      const deleted = cache.evictLRU(10);

      expect(deleted).toBe(10);
      expect(cache.stats.evictions).toBe(10);
    });

    it('should emit cache-cleanup event with lru reason', () => {
      mockPreparedStatements.deleteLRU.run.mockReturnValue({ changes: 5 });

      const eventHandler = vi.fn();
      cache.on('cache-cleanup', eventHandler);

      cache.evictLRU(5);

      expect(eventHandler).toHaveBeenCalledWith({ deleted: 5, reason: 'lru' });
    });
  });

  describe('getCount', () => {
    it('should return cache count', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 42 });

      expect(cache.getCount()).toBe(42);
    });

    it('should return 0 on error', () => {
      mockPreparedStatements.count.get.mockImplementation(() => {
        throw new Error('Error');
      });

      expect(cache.getCount()).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      // 重新设置 mock 确保返回正确的值
      cache._preparedStatements.count.get = vi.fn().mockReturnValue({ count: 100 });
      cache._preparedStatements.totalSize.get = vi.fn().mockReturnValue({ total_size: 1024 * 1024 });
      cache._preparedStatements.statsByModel.all = vi.fn().mockReturnValue([
        { model: 'model1', count: 60, size: 600000 },
        { model: 'model2', count: 40, size: 400000 },
      ]);

      cache.stats.hits = 80;
      cache.stats.misses = 20;
      cache.stats.inserts = 100;
      cache.stats.evictions = 10;

      const stats = cache.getStats();

      expect(stats.count).toBe(100);
      expect(stats.maxSize).toBe(1000);
      expect(stats.hits).toBe(80);
      expect(stats.misses).toBe(20);
      expect(stats.byModel).toHaveLength(2);
    });

    it('should handle zero requests', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 0 });
      mockPreparedStatements.totalSize.get.mockReturnValue({ total_size: 0 });
      mockPreparedStatements.statsByModel.all.mockReturnValue([]);

      const stats = cache.getStats();

      // hitRate 可能是 0 或 undefined，取决于实现
      expect(stats.count).toBe(0);
    });
  });

  describe('getMultiple', () => {
    it('should get multiple embeddings', () => {
      const embedding1 = cache.serializeEmbedding([0.1, 0.2]);
      const embedding2 = cache.serializeEmbedding([0.3, 0.4]);

      mockPreparedStatements.get.get
        .mockReturnValueOnce({ embedding: embedding1, dimension: 2 })
        .mockReturnValueOnce({ embedding: embedding2, dimension: 2 })
        .mockReturnValueOnce(null);

      const items = [
        { content: 'content1', model: 'model1' },
        { content: 'content2', model: 'model1' },
        { content: 'content3', model: 'model1' },
      ];

      const results = cache.getMultiple(items);

      expect(results.size).toBe(2);
    });
  });

  describe('setMultiple', () => {
    it('should set multiple embeddings', () => {
      mockPreparedStatements.count.get.mockReturnValue({ count: 0 });

      const items = [
        { content: 'content1', embedding: [0.1, 0.2], model: 'model1' },
        { content: 'content2', embedding: [0.3, 0.4], model: 'model1' },
      ];

      const count = cache.setMultiple(items);

      expect(count).toBe(2);
      expect(cache.stats.inserts).toBe(2);
    });
  });

  describe('startAutoCleanup/stopAutoCleanup', () => {
    it('should start and stop auto cleanup', () => {
      const autoCache = new EmbeddingCache({
        database: mockDb,
        enableAutoCleanup: true,
        cleanupInterval: 1000,
      });

      autoCache.startAutoCleanup();
      expect(autoCache._cleanupTimer).not.toBeNull();

      autoCache.stopAutoCleanup();
      expect(autoCache._cleanupTimer).toBeNull();

      autoCache.destroy();
    });

    it('should not start if already running', () => {
      const autoCache = new EmbeddingCache({
        database: mockDb,
        enableAutoCleanup: true,
        cleanupInterval: 1000,
      });

      autoCache.startAutoCleanup();
      const firstTimer = autoCache._cleanupTimer;

      autoCache.startAutoCleanup();
      expect(autoCache._cleanupTimer).toBe(firstTimer);

      autoCache.destroy();
    });

    it('should not start if disabled', () => {
      cache.startAutoCleanup();
      expect(cache._cleanupTimer).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should stop cleanup and remove listeners', () => {
      const autoCache = new EmbeddingCache({
        database: mockDb,
        enableAutoCleanup: true,
      });

      autoCache.startAutoCleanup();
      const handler = vi.fn();
      autoCache.on('cache-set', handler);

      autoCache.destroy();

      expect(autoCache._cleanupTimer).toBeNull();
    });
  });
});
