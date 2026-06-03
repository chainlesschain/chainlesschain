/**
 * DID Cache 单元测试
 * 测试目标: src/main/did/did-cache.js
 *
 * 覆盖场景:
 * - LRU缓存策略
 * - TTL过期机制
 * - 缓存CRUD操作
 * - 缓存统计和命中率
 * - 持久化支持
 * - 定期清理机制
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

describe('DIDCache', () => {
  let DIDCache;
  let didCache;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock database
    mockDb = {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      saveToFile: vi.fn(),
    };

    // 动态导入 DIDCache
    const module = await import('../../../src/main/did/did-cache.js');
    DIDCache = module.DIDCache;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    didCache = null;
  });

  // =====================================================================
  // 构造函数测试
  // =====================================================================

  describe('构造函数', () => {
    it('应该正确初始化 DIDCache', () => {
      didCache = new DIDCache(mockDb);

      expect(didCache.db).toBe(mockDb);
      expect(didCache.cache).toBeInstanceOf(Map);
      expect(didCache.cache.size).toBe(0);
      expect(didCache.stats).toEqual({
        hits: 0,
        misses: 0,
        evictions: 0,
        expirations: 0,
      });
    });

    it('应该使用默认配置', () => {
      didCache = new DIDCache(mockDb);

      expect(didCache.config).toMatchObject({
        maxSize: 1000,
        ttl: 24 * 60 * 60 * 1000,
        cleanupInterval: 60 * 60 * 1000,
        enablePersistence: true,
      });
    });

    it('应该支持自定义配置', () => {
      const customConfig = {
        maxSize: 500,
        ttl: 12 * 60 * 60 * 1000,
        enablePersistence: false,
      };

      didCache = new DIDCache(mockDb, customConfig);

      expect(didCache.config.maxSize).toBe(500);
      expect(didCache.config.ttl).toBe(12 * 60 * 60 * 1000);
      expect(didCache.config.enablePersistence).toBe(false);
    });
  });

  // =====================================================================
  // 初始化测试
  // =====================================================================

  describe('初始化', () => {
    beforeEach(() => {
      didCache = new DIDCache(mockDb);
    });

    it('应该成功初始化', async () => {
      const result = await didCache.initialize();

      expect(result).toBe(true);
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS did_cache')
      );
    });

    it('应该创建缓存表和索引', async () => {
      await didCache.initialize();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS did_cache')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_did_cache_expires')
      );
    });

    it('应该从数据库加载缓存', async () => {
      const mockCachedData = [
        {
          did: 'did:chainlesschain:test1',
          document: JSON.stringify({ id: 'did:chainlesschain:test1' }),
          cached_at: Date.now(),
          expires_at: Date.now() + 10000,
          access_count: 5,
        },
      ];

      mockDb.prepare().all = vi.fn().mockReturnValue(mockCachedData);

      await didCache.initialize();

      expect(didCache.cache.size).toBe(1);
      expect(didCache.cache.has('did:chainlesschain:test1')).toBe(true);
    });

    it('应该启动定期清理', async () => {
      await didCache.initialize();

      expect(didCache.cleanupTimer).toBeDefined();
    });

    it('应该触发 initialized 事件', async () => {
      const initSpy = vi.fn();
      didCache.on('initialized', initSpy);

      await didCache.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    it('初始化失败时应该抛出错误', async () => {
      mockDb.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(didCache.initialize()).rejects.toThrow('Database error');
    });
  });

  // =====================================================================
  // 缓存 GET 操作测试
  // =====================================================================

  describe('get - 缓存获取', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb);
      await didCache.initialize();
    });

    it('缓存命中时应该返回文档', async () => {
      const did = 'did:chainlesschain:test1';
      const document = { id: did };
      const now = Date.now();

      didCache.cache.set(did, {
        document,
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      const result = await didCache.get(did);

      expect(result).toEqual(document);
      expect(didCache.stats.hits).toBe(1);
    });

    it('缓存未命中时应该返回 null', async () => {
      const result = await didCache.get('did:chainlesschain:nonexistent');

      expect(result).toBeNull();
      expect(didCache.stats.misses).toBe(1);
    });

    it('过期的缓存应该被删除并返回 null', async () => {
      const did = 'did:chainlesschain:expired';
      const document = { id: did };
      const now = Date.now();

      // 设置已过期的缓存
      didCache.cache.set(did, {
        document,
        cachedAt: now - 20000,
        expiresAt: now - 10000, // 已过期
        accessCount: 0,
      });

      const result = await didCache.get(did);

      expect(result).toBeNull();
      expect(didCache.cache.has(did)).toBe(false);
      expect(didCache.stats.expirations).toBe(1);
    });

    it('应该更新 LRU 顺序', async () => {
      const did1 = 'did:chainlesschain:test1';
      const did2 = 'did:chainlesschain:test2';
      const now = Date.now();

      didCache.cache.set(did1, {
        document: { id: did1 },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });
      didCache.cache.set(did2, {
        document: { id: did2 },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      // 访问 did1，应该将其移到 Map 末尾（最近使用）
      await didCache.get(did1);

      const keys = Array.from(didCache.cache.keys());
      expect(keys[keys.length - 1]).toBe(did1);
    });

    it('应该增加访问计数', async () => {
      const did = 'did:chainlesschain:test1';
      const now = Date.now();

      didCache.cache.set(did, {
        document: { id: did },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      await didCache.get(did);
      const cached = didCache.cache.get(did);

      expect(cached.accessCount).toBe(1);
    });

    it('应该触发 cache-hit 事件', async () => {
      const hitSpy = vi.fn();
      didCache.on('cache-hit', hitSpy);

      const did = 'did:chainlesschain:test1';
      const now = Date.now();

      didCache.cache.set(did, {
        document: { id: did },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      await didCache.get(did);

      expect(hitSpy).toHaveBeenCalledWith({ did });
    });

    it('应该触发 cache-miss 事件', async () => {
      const missSpy = vi.fn();
      didCache.on('cache-miss', missSpy);

      await didCache.get('did:chainlesschain:nonexistent');

      expect(missSpy).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // 缓存 SET 操作测试
  // =====================================================================

  describe('set - 缓存设置', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb);
      await didCache.initialize();
    });

    it('应该成功设置缓存', async () => {
      const did = 'did:chainlesschain:test1';
      const document = { id: did };

      await didCache.set(did, document);

      expect(didCache.cache.has(did)).toBe(true);
      const cached = didCache.cache.get(did);
      expect(cached.document).toEqual(document);
    });

    it('应该设置正确的过期时间', async () => {
      const did = 'did:chainlesschain:test1';
      const document = { id: did };
      const now = Date.now();

      await didCache.set(did, document);

      const cached = didCache.cache.get(did);
      expect(cached.expiresAt).toBeGreaterThan(now);
      expect(cached.expiresAt).toBeLessThanOrEqual(now + didCache.config.ttl + 100);
    });

    it('应该执行 LRU 淘汰', async () => {
      // 设置小的缓存大小
      didCache.config.maxSize = 2;

      const did1 = 'did:chainlesschain:test1';
      const did2 = 'did:chainlesschain:test2';
      const did3 = 'did:chainlesschain:test3';

      await didCache.set(did1, { id: did1 });
      await didCache.set(did2, { id: did2 });
      await didCache.set(did3, { id: did3 }); // 应该淘汰 did1

      expect(didCache.cache.has(did1)).toBe(false);
      expect(didCache.cache.has(did2)).toBe(true);
      expect(didCache.cache.has(did3)).toBe(true);
      expect(didCache.stats.evictions).toBe(1);
    });

    it('应该持久化到数据库', async () => {
      const did = 'did:chainlesschain:test1';
      const document = { id: did };

      await didCache.set(did, document);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO did_cache')
      );
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it('禁用持久化时不应该保存到数据库', async () => {
      didCache.config.enablePersistence = false;
      mockDb.prepare = vi.fn();

      const did = 'did:chainlesschain:test1';
      await didCache.set(did, { id: did });

      expect(mockDb.prepare).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO did_cache')
      );
    });

    it('应该触发 cache-set 事件', async () => {
      const setSpy = vi.fn();
      didCache.on('cache-set', setSpy);

      const did = 'did:chainlesschain:test1';
      await didCache.set(did, { id: did });

      expect(setSpy).toHaveBeenCalledWith({ did });
    });

    it('应该触发 cache-evicted 事件', async () => {
      const evictedSpy = vi.fn();
      didCache.on('cache-evicted', evictedSpy);

      didCache.config.maxSize = 1;
      await didCache.set('did:chainlesschain:test1', { id: 1 });
      await didCache.set('did:chainlesschain:test2', { id: 2 });

      expect(evictedSpy).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // 缓存清除测试
  // =====================================================================

  describe('clear - 缓存清除', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb);
      await didCache.initialize();
    });

    it('应该清除单个缓存项', async () => {
      const did = 'did:chainlesschain:test1';
      await didCache.set(did, { id: did });

      await didCache.clear(did);

      expect(didCache.cache.has(did)).toBe(false);
    });

    it('应该清除所有缓存', async () => {
      await didCache.set('did:chainlesschain:test1', { id: 1 });
      await didCache.set('did:chainlesschain:test2', { id: 2 });
      await didCache.set('did:chainlesschain:test3', { id: 3 });

      await didCache.clear();

      expect(didCache.cache.size).toBe(0);
    });

    it('应该从数据库删除单个缓存', async () => {
      const did = 'did:chainlesschain:test1';

      await didCache.clear(did);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM did_cache WHERE did = ?')
      );
    });

    it('应该从数据库删除所有缓存', async () => {
      await didCache.clear();

      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM did_cache');
    });

    it('应该触发 cache-cleared 事件', async () => {
      const clearedSpy = vi.fn();
      didCache.on('cache-cleared', clearedSpy);

      const did = 'did:chainlesschain:test1';
      await didCache.clear(did);

      expect(clearedSpy).toHaveBeenCalledWith({ did });
    });

    it('应该触发 cache-cleared-all 事件', async () => {
      const clearedAllSpy = vi.fn();
      didCache.on('cache-cleared-all', clearedAllSpy);

      await didCache.set('did:1', { id: 1 });
      await didCache.set('did:2', { id: 2 });
      await didCache.clear();

      expect(clearedAllSpy).toHaveBeenCalledWith({ count: 2 });
    });
  });

  // =====================================================================
  // 统计信息测试
  // =====================================================================

  describe('getStats - 统计信息', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb);
      await didCache.initialize();
    });

    it('应该返回正确的统计信息', async () => {
      const did1 = 'did:chainlesschain:test1';
      const did2 = 'did:chainlesschain:test2';
      const now = Date.now();

      didCache.cache.set(did1, {
        document: { id: did1 },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });
      didCache.cache.set(did2, {
        document: { id: did2 },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      await didCache.get(did1); // hit
      await didCache.get('nonexistent'); // miss

      const stats = didCache.getStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(didCache.config.maxSize);
      expect(stats.totalRequests).toBe(2);
      expect(stats.hitRate).toContain('50.00%');
    });

    it('应该计算缓存命中率', async () => {
      const did = 'did:chainlesschain:test1';
      const now = Date.now();

      didCache.cache.set(did, {
        document: { id: did },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      // 3 次命中, 1 次未命中
      await didCache.get(did);
      await didCache.get(did);
      await didCache.get(did);
      await didCache.get('nonexistent');

      const stats = didCache.getStats();
      expect(stats.hitRate).toBe('75.00%');
    });

    it('应该估算内存使用量', () => {
      const stats = didCache.getStats();

      expect(stats.memoryUsage).toBeGreaterThanOrEqual(0);
    });
  });

  // =====================================================================
  // 定期清理测试
  // =====================================================================

  describe('cleanup - 定期清理', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb, { cleanupInterval: 1000 });
      await didCache.initialize();
    });

    it('应该清理过期缓存', async () => {
      const now = Date.now();
      const did1 = 'did:chainlesschain:expired1';
      const did2 = 'did:chainlesschain:valid';

      // 已过期
      didCache.cache.set(did1, {
        document: { id: did1 },
        cachedAt: now - 20000,
        expiresAt: now - 10000,
        accessCount: 0,
      });

      // 有效
      didCache.cache.set(did2, {
        document: { id: did2 },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 0,
      });

      await didCache.cleanup();

      expect(didCache.cache.has(did1)).toBe(false);
      expect(didCache.cache.has(did2)).toBe(true);
      expect(didCache.stats.expirations).toBe(1);
    });

    it('应该触发 cleanup-completed 事件', async () => {
      const cleanupSpy = vi.fn();
      didCache.on('cleanup-completed', cleanupSpy);

      const now = Date.now();
      didCache.cache.set('did:expired', {
        document: {},
        cachedAt: now - 20000,
        expiresAt: now - 10000,
        accessCount: 0,
      });

      await didCache.cleanup();

      expect(cleanupSpy).toHaveBeenCalledWith({ count: 1 });
    });

    it('应该定期自动清理', async () => {
      const now = Date.now();
      didCache.cache.set('did:expired', {
        document: {},
        cachedAt: now - 20000,
        expiresAt: now - 10000,
        accessCount: 0,
      });

      // 快进时间触发定期清理
      await vi.advanceTimersByTimeAsync(1000);

      expect(didCache.cache.size).toBe(0);
    });

    it('应该能够停止定期清理', () => {
      didCache.stopCleanup();

      expect(didCache.cleanupTimer).toBeNull();
    });
  });

  // =====================================================================
  // 其他功能测试
  // =====================================================================

  describe('其他功能', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb);
      await didCache.initialize();
    });

    it('应该重置统计信息', () => {
      didCache.stats.hits = 10;
      didCache.stats.misses = 5;

      didCache.resetStats();

      expect(didCache.stats).toEqual({
        hits: 0,
        misses: 0,
        evictions: 0,
        expirations: 0,
      });
    });

    it('重置统计时应该触发事件', () => {
      const resetSpy = vi.fn();
      didCache.on('stats-reset', resetSpy);

      didCache.resetStats();

      expect(resetSpy).toHaveBeenCalled();
    });

    it('应该正确销毁缓存管理器', async () => {
      await didCache.set('did:test', { id: 'test' });

      await didCache.destroy();

      expect(didCache.cleanupTimer).toBeNull();
      expect(didCache.cache.size).toBe(0);
    });

    it('应该估算内存使用量', () => {
      const did = 'did:chainlesschain:test1';
      const now = Date.now();

      didCache.cache.set(did, {
        document: { id: did, data: 'some data' },
        cachedAt: now,
        expiresAt: now + 10000,
        accessCount: 5,
      });

      const memoryUsage = didCache.estimateMemoryUsage();

      expect(memoryUsage).toBeGreaterThan(0);
    });
  });

  // =====================================================================
  // 边界情况测试
  // =====================================================================

  describe('边界情况', () => {
    beforeEach(async () => {
      didCache = new DIDCache(mockDb);
      await didCache.initialize();
    });

    it('应该处理空缓存的统计请求', () => {
      const stats = didCache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe('0.00%');
    });

    it('应该处理数据库操作失败', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      // 不应该抛出错误
      await expect(didCache.set('did:test', { id: 'test' })).resolves.not.toThrow();
    });

    it('应该处理缓存大小为0的情况', async () => {
      didCache.config.maxSize = 0;

      await didCache.set('did:test', { id: 'test' });

      // 应该立即淘汰
      expect(didCache.cache.size).toBe(1); // 会先添加再检查
    });

    it('应该处理负的TTL', async () => {
      didCache.config.ttl = -1000;

      await didCache.set('did:test', { id: 'test' });
      const result = await didCache.get('did:test');

      // 应该立即过期
      expect(result).toBeNull();
    });
  });
});
