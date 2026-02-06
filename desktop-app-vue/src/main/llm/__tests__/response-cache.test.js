/**
 * Response Cache 模块测试
 *
 * 测试内容：
 * - ResponseCache 类的缓存操作
 * - calculateCacheKey 函数
 * - LRU 淘汰策略
 */

const { ResponseCache, calculateCacheKey } = require('../response-cache');

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('calculateCacheKey', () => {
  it('should generate consistent hash for same input', () => {
    const key1 = calculateCacheKey('openai', 'gpt-4', [
      { role: 'user', content: 'Hello' },
    ]);
    const key2 = calculateCacheKey('openai', 'gpt-4', [
      { role: 'user', content: 'Hello' },
    ]);

    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64); // SHA-256 hex length
  });

  it('should generate different hashes for different providers', () => {
    const key1 = calculateCacheKey('openai', 'gpt-4', []);
    const key2 = calculateCacheKey('anthropic', 'gpt-4', []);

    expect(key1).not.toBe(key2);
  });

  it('should generate different hashes for different models', () => {
    const key1 = calculateCacheKey('openai', 'gpt-4', []);
    const key2 = calculateCacheKey('openai', 'gpt-3.5', []);

    expect(key1).not.toBe(key2);
  });

  it('should generate different hashes for different messages', () => {
    const key1 = calculateCacheKey('openai', 'gpt-4', [
      { role: 'user', content: 'Hello' },
    ]);
    const key2 = calculateCacheKey('openai', 'gpt-4', [
      { role: 'user', content: 'Hi' },
    ]);

    expect(key1).not.toBe(key2);
  });
});

describe('ResponseCache', () => {
  let cache;
  let mockDb;

  beforeEach(() => {
    // Create mock database
    mockDb = {
      prepare: jest.fn(() => ({
        get: jest.fn(),
        run: jest.fn(() => ({ changes: 1 })),
        all: jest.fn(() => []),
      })),
    };

    cache = new ResponseCache(mockDb, {
      ttl: 7 * 24 * 60 * 60 * 1000,
      maxSize: 100,
      enableAutoCleanup: false, // Disable for tests
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultCache = new ResponseCache(mockDb, {
        enableAutoCleanup: false,
      });
      expect(defaultCache.ttl).toBe(7 * 24 * 60 * 60 * 1000);
      expect(defaultCache.maxSize).toBe(1000);
      defaultCache.destroy();
    });

    it('should initialize with custom options', () => {
      const customCache = new ResponseCache(mockDb, {
        ttl: 1000,
        maxSize: 50,
        enableAutoCleanup: false,
      });
      expect(customCache.ttl).toBe(1000);
      expect(customCache.maxSize).toBe(50);
      customCache.destroy();
    });

    it('should initialize stats', () => {
      expect(cache.stats).toEqual({
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        expirations: 0,
      });
    });
  });

  describe('get', () => {
    it('should return miss when cache is empty', async () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      const result = await cache.get('openai', 'gpt-4', []);

      expect(result.hit).toBe(false);
      expect(cache.stats.misses).toBe(1);
    });

    it('should return hit when cache contains valid entry', async () => {
      const cachedResponse = {
        text: 'Hello there!',
        usage: { total_tokens: 50 },
      };

      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: 'cache-1',
          response_content: JSON.stringify(cachedResponse),
          response_tokens: 50,
          hit_count: 5,
          tokens_saved: 250,
          expires_at: Date.now() + 100000,
        }),
        run: jest.fn(),
      });

      const result = await cache.get('openai', 'gpt-4', []);

      expect(result.hit).toBe(true);
      expect(result.response).toEqual(cachedResponse);
      expect(result.tokensSaved).toBe(50);
      expect(cache.stats.hits).toBe(1);
    });

    it('should return miss for expired entries', async () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          id: 'cache-1',
          response_content: '{}',
          expires_at: Date.now() - 1000, // Expired
        }),
        run: jest.fn(),
      });

      const result = await cache.get('openai', 'gpt-4', []);

      expect(result.hit).toBe(false);
      expect(cache.stats.expirations).toBe(1);
      expect(cache.stats.misses).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await cache.get('openai', 'gpt-4', []);

      expect(result.hit).toBe(false);
      expect(cache.stats.misses).toBe(1);
    });
  });

  describe('set', () => {
    it('should store response in cache', async () => {
      const mockRun = jest.fn();
      const mockGet = jest.fn().mockReturnValue({ count: 0 });

      mockDb.prepare.mockReturnValue({
        run: mockRun,
        get: mockGet,
      });

      const response = {
        text: 'Test response',
        usage: { total_tokens: 100 },
      };

      const result = await cache.set('openai', 'gpt-4', [], response);

      expect(result).toBe(true);
      expect(cache.stats.sets).toBe(1);
      expect(mockRun).toHaveBeenCalled();
    });

    it('should estimate tokens when not provided', async () => {
      const mockRun = jest.fn();
      mockDb.prepare.mockReturnValue({
        run: mockRun,
        get: jest.fn().mockReturnValue({ count: 0 }),
      });

      const response = {
        text: 'This is a test response with some content',
      };

      await cache.set('openai', 'gpt-4', [], response);

      expect(cache.stats.sets).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await cache.set('openai', 'gpt-4', [], {});

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 50 }),
      });

      const count = await cache.clear();

      expect(count).toBe(50);
      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(0);
      expect(cache.stats.sets).toBe(0);
    });
  });

  describe('clearExpired', () => {
    it('should clear expired entries', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 10 }),
      });

      const count = await cache.clearExpired();

      expect(count).toBe(10);
      expect(cache.stats.expirations).toBe(10);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      // Set up some stats
      cache.stats.hits = 10;
      cache.stats.misses = 5;
      cache.stats.sets = 15;

      mockDb.prepare
        .mockReturnValueOnce({
          get: jest.fn().mockReturnValue({
            total_entries: 100,
            total_hits: 500,
            total_tokens_saved: 10000,
            avg_hits_per_entry: 5,
          }),
        })
        .mockReturnValueOnce({
          get: jest.fn().mockReturnValue({ count: 3 }),
        });

      const stats = await cache.getStats();

      expect(stats.runtime.hits).toBe(10);
      expect(stats.runtime.misses).toBe(5);
      expect(stats.runtime.hitRate).toBe('66.67%');
      expect(stats.database.totalEntries).toBe(100);
      expect(stats.database.totalTokensSaved).toBe(10000);
      expect(stats.config.maxSize).toBe(100);
    });
  });

  describe('getStatsByProvider', () => {
    it('should return provider-grouped statistics', async () => {
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { provider: 'openai', entries: 50, hits: 200, tokens_saved: 5000 },
          { provider: 'anthropic', entries: 30, hits: 100, tokens_saved: 3000 },
        ]),
      });

      const stats = await cache.getStatsByProvider();

      expect(stats).toHaveLength(2);
      expect(stats[0].provider).toBe('openai');
      expect(stats[0].tokensSaved).toBe(5000);
    });
  });

  describe('_estimateTokens', () => {
    it('should estimate tokens for mixed content', () => {
      // Chinese characters count more
      const text = 'Hello 你好世界';
      const tokens = cache._estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty string', () => {
      expect(cache._estimateTokens('')).toBe(0);
      expect(cache._estimateTokens(null)).toBe(0);
    });
  });

  describe('_enforceMaxSize', () => {
    it('should evict entries when cache is full', async () => {
      const mockRun = jest.fn();
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({ count: 100 }), // At max size
        run: mockRun,
      });

      cache.maxSize = 100;
      await cache._enforceMaxSize();

      expect(cache.stats.evictions).toBeGreaterThan(0);
    });

    it('should not evict when under limit', async () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({ count: 50 }),
      });

      const initialEvictions = cache.stats.evictions;
      await cache._enforceMaxSize();

      expect(cache.stats.evictions).toBe(initialEvictions);
    });
  });

  describe('auto cleanup', () => {
    it('should start cleanup timer when enabled', () => {
      const autoCache = new ResponseCache(mockDb, {
        enableAutoCleanup: true,
        cleanupInterval: 1000,
      });

      expect(autoCache.cleanupTimer).toBeDefined();
      autoCache.destroy();
    });

    it('should stop cleanup timer on destroy', () => {
      const autoCache = new ResponseCache(mockDb, {
        enableAutoCleanup: true,
      });

      autoCache.destroy();
      expect(autoCache.cleanupTimer).toBeNull();
    });
  });
});
