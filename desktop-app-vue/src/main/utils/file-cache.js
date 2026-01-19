/**
 * 文件处理缓存管理器
 * 实现LRU缓存策略，优化文件重复读取性能
 */

const { logger, createLogger } = require('./logger.js');
const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');

// 缓存配置
const CACHE_CONFIG = {
  // 最大缓存条目数
  MAX_ENTRIES: 100,
  // 最大缓存大小（100MB）
  MAX_SIZE: 100 * 1024 * 1024,
  // 缓存过期时间（30分钟）
  TTL: 30 * 60 * 1000,
  // 是否启用持久化缓存
  ENABLE_PERSISTENCE: false,
};

/**
 * LRU缓存实现
 */
class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || CACHE_CONFIG.MAX_ENTRIES;
    this.maxBytes = options.maxBytes || CACHE_CONFIG.MAX_SIZE;
    this.ttl = options.ttl || CACHE_CONFIG.TTL;

    this.cache = new Map();
    this.currentBytes = 0;
  }

  /**
   * 获取缓存项
   */
  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - item.timestamp > this.ttl) {
      this.delete(key);
      return null;
    }

    // LRU：移到最后（最近使用）
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  /**
   * 设置缓存项
   */
  set(key, value, size = 0) {
    // 如果已存在，先删除旧的
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // 检查大小限制
    while (this.currentBytes + size > this.maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }

    // 检查条目数限制
    while (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    // 添加新项
    const item = {
      value,
      size,
      timestamp: Date.now(),
    };

    this.cache.set(key, item);
    this.currentBytes += size;
  }

  /**
   * 删除缓存项
   */
  delete(key) {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.currentBytes -= item.size;
      return true;
    }
    return false;
  }

  /**
   * 驱逐最旧的缓存项
   */
  evictOldest() {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.delete(firstKey);
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.currentBytes = 0;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      entries: this.cache.size,
      bytes: this.currentBytes,
      maxEntries: this.maxSize,
      maxBytes: this.maxBytes,
      utilizationPercent: ((this.currentBytes / this.maxBytes) * 100).toFixed(2),
    };
  }

  /**
   * 检查是否包含key
   */
  has(key) {
    return this.cache.has(key) && this.get(key) !== null;
  }
}

/**
 * 文件缓存管理器
 */
class FileCacheManager {
  constructor(options = {}) {
    this.options = {
      ...CACHE_CONFIG,
      ...options,
    };

    // 文件内容缓存
    this.contentCache = new LRUCache({
      maxSize: this.options.MAX_ENTRIES,
      maxBytes: this.options.MAX_SIZE,
      ttl: this.options.TTL,
    });

    // 文件元数据缓存
    this.metadataCache = new LRUCache({
      maxSize: this.options.MAX_ENTRIES * 2,
      maxBytes: 10 * 1024 * 1024, // 10MB for metadata
      ttl: this.options.TTL,
    });

    // 解析结果缓存
    this.parseCache = new LRUCache({
      maxSize: this.options.MAX_ENTRIES,
      maxBytes: this.options.MAX_SIZE * 2,
      ttl: this.options.TTL,
    });

    // 缓存命中统计
    this.stats = {
      contentHits: 0,
      contentMisses: 0,
      metadataHits: 0,
      metadataMisses: 0,
      parseHits: 0,
      parseMisses: 0,
    };
  }

  /**
   * 生成文件缓存key
   */
  async generateFileKey(filePath, options = {}) {
    try {
      const stat = await fs.stat(filePath);

      // 使用文件路径、大小、修改时间生成唯一key
      const keyData = {
        path: path.normalize(filePath),
        size: stat.size,
        mtime: stat.mtimeMs,
        ...options,
      };

      const hash = crypto
        .createHash('md5')
        .update(JSON.stringify(keyData))
        .digest('hex');

      return `file:${hash}`;
    } catch (error) {
      // 如果文件不存在，使用路径生成key
      return `file:${crypto.createHash('md5').update(filePath).digest('hex')}`;
    }
  }

  /**
   * 缓存文件内容
   */
  async cacheFileContent(filePath, content) {
    const key = await this.generateFileKey(filePath);
    const size = Buffer.byteLength(content);

    this.contentCache.set(key, content, size);

    logger.info(`[FileCache] 缓存文件内容: ${path.basename(filePath)}, 大小: ${(size / 1024).toFixed(2)}KB`);
  }

  /**
   * 获取缓存的文件内容
   */
  async getCachedFileContent(filePath) {
    const key = await this.generateFileKey(filePath);
    const content = this.contentCache.get(key);

    if (content) {
      this.stats.contentHits++;
      logger.info(`[FileCache] 命中缓存: ${path.basename(filePath)}`);
      return content;
    }

    this.stats.contentMisses++;
    return null;
  }

  /**
   * 缓存文件元数据
   */
  async cacheFileMetadata(filePath, metadata) {
    const key = await this.generateFileKey(filePath, { type: 'metadata' });
    const size = JSON.stringify(metadata).length;

    this.metadataCache.set(key, metadata, size);
  }

  /**
   * 获取缓存的文件元数据
   */
  async getCachedFileMetadata(filePath) {
    const key = await this.generateFileKey(filePath, { type: 'metadata' });
    const metadata = this.metadataCache.get(key);

    if (metadata) {
      this.stats.metadataHits++;
      return metadata;
    }

    this.stats.metadataMisses++;
    return null;
  }

  /**
   * 缓存解析结果
   */
  async cacheParseResult(filePath, parseType, result) {
    const key = await this.generateFileKey(filePath, { type: 'parse', parseType });
    const size = JSON.stringify(result).length;

    this.parseCache.set(key, result, size);

    logger.info(
      `[FileCache] 缓存解析结果: ${path.basename(filePath)} (${parseType}), 大小: ${(size / 1024).toFixed(2)}KB`
    );
  }

  /**
   * 获取缓存的解析结果
   */
  async getCachedParseResult(filePath, parseType) {
    const key = await this.generateFileKey(filePath, { type: 'parse', parseType });
    const result = this.parseCache.get(key);

    if (result) {
      this.stats.parseHits++;
      logger.info(`[FileCache] 命中解析缓存: ${path.basename(filePath)} (${parseType})`);
      return result;
    }

    this.stats.parseMisses++;
    return null;
  }

  /**
   * 使缓存失效
   */
  async invalidateFile(filePath) {
    const keys = [
      await this.generateFileKey(filePath),
      await this.generateFileKey(filePath, { type: 'metadata' }),
    ];

    // 删除所有可能的解析类型缓存
    const parseTypes = ['csv', 'excel', 'word', 'pdf', 'markdown'];
    for (const parseType of parseTypes) {
      keys.push(await this.generateFileKey(filePath, { type: 'parse', parseType }));
    }

    let invalidatedCount = 0;
    for (const key of keys) {
      if (this.contentCache.delete(key)) {invalidatedCount++;}
      if (this.metadataCache.delete(key)) {invalidatedCount++;}
      if (this.parseCache.delete(key)) {invalidatedCount++;}
    }

    if (invalidatedCount > 0) {
      logger.info(`[FileCache] 使缓存失效: ${path.basename(filePath)}, 删除 ${invalidatedCount} 个条目`);
    }

    return invalidatedCount;
  }

  /**
   * 批量使缓存失效
   */
  async invalidateFiles(filePaths) {
    let totalInvalidated = 0;

    for (const filePath of filePaths) {
      totalInvalidated += await this.invalidateFile(filePath);
    }

    return totalInvalidated;
  }

  /**
   * 清空所有缓存
   */
  clearAll() {
    this.contentCache.clear();
    this.metadataCache.clear();
    this.parseCache.clear();

    logger.info('[FileCache] 已清空所有缓存');
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const hitRate = (hits, misses) => {
      const total = hits + misses;
      return total > 0 ? ((hits / total) * 100).toFixed(2) : '0.00';
    };

    return {
      content: {
        ...this.contentCache.getStats(),
        hits: this.stats.contentHits,
        misses: this.stats.contentMisses,
        hitRate: `${hitRate(this.stats.contentHits, this.stats.contentMisses)}%`,
      },
      metadata: {
        ...this.metadataCache.getStats(),
        hits: this.stats.metadataHits,
        misses: this.stats.metadataMisses,
        hitRate: `${hitRate(this.stats.metadataHits, this.stats.metadataMisses)}%`,
      },
      parse: {
        ...this.parseCache.getStats(),
        hits: this.stats.parseHits,
        misses: this.stats.parseMisses,
        hitRate: `${hitRate(this.stats.parseHits, this.stats.parseMisses)}%`,
      },
    };
  }

  /**
   * 打印缓存统计
   */
  printStats() {
    const stats = this.getStats();

    logger.info('\n=== 文件缓存统计 ===');
    logger.info('\n内容缓存:');
    logger.info(`  条目: ${stats.content.entries}/${stats.content.maxEntries}`);
    logger.info(`  大小: ${(stats.content.bytes / 1024 / 1024).toFixed(2)}MB/${(stats.content.maxBytes / 1024 / 1024).toFixed(2)}MB`);
    logger.info(`  命中率: ${stats.content.hitRate}`);

    logger.info('\n元数据缓存:');
    logger.info(`  条目: ${stats.metadata.entries}/${stats.metadata.maxEntries}`);
    logger.info(`  大小: ${(stats.metadata.bytes / 1024).toFixed(2)}KB`);
    logger.info(`  命中率: ${stats.metadata.hitRate}`);

    logger.info('\n解析缓存:');
    logger.info(`  条目: ${stats.parse.entries}/${stats.parse.maxEntries}`);
    logger.info(`  大小: ${(stats.parse.bytes / 1024 / 1024).toFixed(2)}MB/${(stats.parse.maxBytes / 1024 / 1024).toFixed(2)}MB`);
    logger.info(`  命中率: ${stats.parse.hitRate}\n`);
  }

  /**
   * 监听文件变化，自动使缓存失效
   */
  watchFile(filePath, callback) {
    const watcher = fs.watch(filePath, async (eventType) => {
      if (eventType === 'change') {
        await this.invalidateFile(filePath);

        if (callback) {
          callback(filePath, eventType);
        }
      }
    });

    return () => watcher.close();
  }
}

// 单例实例
let fileCacheInstance = null;

/**
 * 获取FileCacheManager单例
 */
function getFileCache(options) {
  if (!fileCacheInstance) {
    fileCacheInstance = new FileCacheManager(options);
  }
  return fileCacheInstance;
}

module.exports = {
  LRUCache,
  FileCacheManager,
  getFileCache,
  CACHE_CONFIG,
};
