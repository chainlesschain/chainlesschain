/**
 * DID 缓存管理器
 *
 * 提供DID文档的本地缓存功能，减少DHT网络请求，提升解析性能
 *
 * 功能:
 * - LRU缓存策略
 * - TTL过期机制
 * - 缓存统计
 * - 持久化支持
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * DID缓存配置
 */
const DEFAULT_CONFIG = {
  maxSize: 1000, // 最大缓存数量
  ttl: 24 * 60 * 60 * 1000, // 缓存过期时间 (24小时)
  cleanupInterval: 60 * 60 * 1000, // 清理间隔 (1小时)
  enablePersistence: true, // 启用持久化
};

/**
 * DID缓存类
 */
class DIDCache extends EventEmitter {
  constructor(databaseManager, config = {}) {
    super();

    this.db = databaseManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 内存缓存 (LRU)
    this.cache = new Map();

    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };

    // 清理定时器
    this.cleanupTimer = null;

    logger.info("[DIDCache] DID缓存管理器已创建");
  }

  /**
   * 初始化缓存
   */
  async initialize() {
    logger.info("[DIDCache] 初始化DID缓存...");

    try {
      // 确保缓存表存在
      await this.ensureCacheTable();

      // 从数据库加载缓存
      if (this.config.enablePersistence) {
        await this.loadFromDatabase();
      }

      // 启动定期清理
      this.startCleanup();

      logger.info("[DIDCache] DID缓存初始化成功");
      this.emit("initialized");

      return true;
    } catch (error) {
      logger.error("[DIDCache] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保缓存表存在
   */
  async ensureCacheTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS did_cache (
          did TEXT PRIMARY KEY,
          document TEXT NOT NULL,
          cached_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          access_count INTEGER DEFAULT 0,
          last_accessed_at INTEGER
        )
      `);

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_did_cache_expires
        ON did_cache(expires_at)
      `);

      logger.info("[DIDCache] 缓存表已就绪");
    } catch (error) {
      logger.error("[DIDCache] 创建缓存表失败:", error);
      throw error;
    }
  }

  /**
   * 从数据库加载缓存
   */
  async loadFromDatabase() {
    try {
      const now = Date.now();

      const rows = this.db
        .prepare(
          `
        SELECT did, document, cached_at, expires_at, access_count
        FROM did_cache
        WHERE expires_at > ?
        ORDER BY last_accessed_at DESC
        LIMIT ?
      `,
        )
        .all(now, this.config.maxSize);

      if (!rows || rows.length === 0) {
        logger.info("[DIDCache] 数据库中无有效缓存");
        return;
      }
      let loadedCount = 0;

      for (const row of rows) {
        this.cache.set(row.did, {
          document: JSON.parse(row.document),
          cachedAt: row.cached_at,
          expiresAt: row.expires_at,
          accessCount: row.access_count,
        });

        loadedCount++;
      }

      logger.info(`[DIDCache] 从数据库加载了 ${loadedCount} 个缓存项`);
    } catch (error) {
      logger.error("[DIDCache] 从数据库加载缓存失败:", error);
    }
  }

  /**
   * 获取缓存的DID文档
   * @param {string} did - DID标识符
   * @returns {Object|null} DID文档或null
   */
  async get(did) {
    try {
      const cached = this.cache.get(did);

      if (!cached) {
        this.stats.misses++;
        this.emit("cache-miss", { did });
        return null;
      }

      const now = Date.now();

      // 检查是否过期
      if (now > cached.expiresAt) {
        this.stats.misses++;
        this.stats.expirations++;
        this.cache.delete(did);
        this.emit("cache-expired", { did });

        // 从数据库删除
        if (this.config.enablePersistence) {
          await this.deleteFromDatabase(did);
        }

        return null;
      }

      // 缓存命中
      this.stats.hits++;
      cached.accessCount++;
      cached.lastAccessedAt = now;

      // 更新LRU顺序 (删除后重新插入)
      this.cache.delete(did);
      this.cache.set(did, cached);

      // 更新数据库访问记录
      if (this.config.enablePersistence) {
        await this.updateAccessInDatabase(did, cached.accessCount, now);
      }

      this.emit("cache-hit", { did });

      return cached.document;
    } catch (error) {
      logger.error("[DIDCache] 获取缓存失败:", error);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * 设置缓存
   * @param {string} did - DID标识符
   * @param {Object} document - DID文档
   */
  async set(did, document) {
    try {
      const now = Date.now();
      const expiresAt = now + this.config.ttl;

      // 检查缓存大小，执行LRU淘汰
      if (this.cache.size >= this.config.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
        this.stats.evictions++;

        // 从数据库删除
        if (this.config.enablePersistence) {
          await this.deleteFromDatabase(firstKey);
        }

        this.emit("cache-evicted", { did: firstKey });
      }

      // 添加到缓存
      this.cache.set(did, {
        document,
        cachedAt: now,
        expiresAt,
        accessCount: 0,
        lastAccessedAt: now,
      });

      // 持久化到数据库
      if (this.config.enablePersistence) {
        await this.saveToDatabase(did, document, now, expiresAt);
      }

      this.emit("cache-set", { did });

      logger.info(`[DIDCache] 已缓存 DID: ${did}`);
    } catch (error) {
      logger.error("[DIDCache] 设置缓存失败:", error);
      throw error;
    }
  }

  /**
   * 清除缓存
   * @param {string} did - DID标识符 (可选，不传则清除所有)
   */
  async clear(did) {
    try {
      if (did) {
        // 清除单个DID
        this.cache.delete(did);

        if (this.config.enablePersistence) {
          await this.deleteFromDatabase(did);
        }

        this.emit("cache-cleared", { did });
        logger.info(`[DIDCache] 已清除缓存: ${did}`);
      } else {
        // 清除所有缓存
        const size = this.cache.size;
        this.cache.clear();

        if (this.config.enablePersistence) {
          this.db.prepare("DELETE FROM did_cache").run();
          this.db.saveToFile();
        }

        this.emit("cache-cleared-all", { count: size });
        logger.info(`[DIDCache] 已清除所有缓存 (${size}个)`);
      }
    } catch (error) {
      logger.error("[DIDCache] 清除缓存失败:", error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.config.maxSize,
      totalRequests,
      hitRate: (hitRate * 100).toFixed(2) + "%",
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };

    this.emit("stats-reset");
    logger.info("[DIDCache] 统计信息已重置");
  }

  /**
   * 估算内存使用量 (字节)
   */
  estimateMemoryUsage() {
    let totalSize = 0;

    for (const [did, cached] of this.cache.entries()) {
      // DID字符串大小
      totalSize += did.length * 2;

      // 文档JSON大小
      totalSize += JSON.stringify(cached.document).length * 2;

      // 元数据大小 (约40字节)
      totalSize += 40;
    }

    return totalSize;
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    logger.info("[DIDCache] 定期清理已启动");
  }

  /**
   * 停止定期清理
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info("[DIDCache] 定期清理已停止");
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanup() {
    try {
      const now = Date.now();
      const expiredKeys = [];

      // 查找过期的缓存项
      for (const [did, cached] of this.cache.entries()) {
        if (now > cached.expiresAt) {
          expiredKeys.push(did);
        }
      }

      // 删除过期项
      for (const did of expiredKeys) {
        this.cache.delete(did);
        this.stats.expirations++;

        if (this.config.enablePersistence) {
          await this.deleteFromDatabase(did);
        }
      }

      if (expiredKeys.length > 0) {
        this.emit("cleanup-completed", { count: expiredKeys.length });
        logger.info(`[DIDCache] 清理了 ${expiredKeys.length} 个过期缓存`);
      }
    } catch (error) {
      logger.error("[DIDCache] 清理失败:", error);
    }
  }

  /**
   * 保存到数据库
   */
  async saveToDatabase(did, document, cachedAt, expiresAt) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO did_cache (
          did, document, cached_at, expires_at, access_count, last_accessed_at
        ) VALUES (?, ?, ?, ?, 0, ?)
      `,
        )
        .run([did, JSON.stringify(document), cachedAt, expiresAt, cachedAt]);

      this.db.saveToFile();
    } catch (error) {
      logger.error("[DIDCache] 保存到数据库失败:", error);
    }
  }

  /**
   * 从数据库删除
   */
  async deleteFromDatabase(did) {
    try {
      this.db.prepare("DELETE FROM did_cache WHERE did = ?").run([did]);
      this.db.saveToFile();
    } catch (error) {
      logger.error("[DIDCache] 从数据库删除失败:", error);
    }
  }

  /**
   * 更新数据库访问记录
   */
  async updateAccessInDatabase(did, accessCount, lastAccessedAt) {
    try {
      this.db
        .prepare(
          `
        UPDATE did_cache
        SET access_count = ?, last_accessed_at = ?
        WHERE did = ?
      `,
        )
        .run([accessCount, lastAccessedAt, did]);

      // 不立即保存，减少I/O
    } catch (error) {
      logger.error("[DIDCache] 更新访问记录失败:", error);
    }
  }

  /**
   * 销毁缓存管理器
   */
  async destroy() {
    logger.info("[DIDCache] 销毁DID缓存管理器...");

    // 停止清理定时器
    this.stopCleanup();

    // 清空内存缓存
    this.cache.clear();

    // 移除所有监听器
    this.removeAllListeners();

    logger.info("[DIDCache] DID缓存管理器已销毁");
  }
}

module.exports = { DIDCache };
