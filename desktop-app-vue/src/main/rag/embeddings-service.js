/**
 * 嵌入向量服务
 *
 * 负责文本向量化和相似度计算
 * 支持双层缓存：内存 LRU 缓存 + SQLite 持久化缓存
 */

const { logger, createLogger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { EmbeddingCache } = require("./embedding-cache.js");

// 尝试使用lru-cache，如果不可用则降级到Map
let LRUCache;
try {
  LRUCache = require("lru-cache");
} catch (error) {
  logger.warn("[EmbeddingsService] lru-cache未安装，使用Map作为降级方案");
  LRUCache = null;
}

/**
 * 嵌入向量服务类
 */
class EmbeddingsService extends EventEmitter {
  /**
   * 创建嵌入向量服务
   * @param {Object} llmManager - LLM 管理器实例
   * @param {Object} options - 配置选项
   * @param {Object} [options.database] - 数据库实例（用于持久化缓存）
   * @param {boolean} [options.enablePersistentCache=true] - 启用持久化缓存
   * @param {string} [options.defaultModel='default'] - 默认模型名称
   */
  constructor(llmManager, options = {}) {
    super();
    this.llmManager = llmManager;
    this.defaultModel = options.defaultModel || "default";

    // 内存 LRU 缓存（第一层）
    if (LRUCache) {
      this.cache = new LRUCache({
        max: 2000, // 最多2000条
        maxAge: 1000 * 60 * 60, // 1小时过期
        updateAgeOnGet: true, // 访问时更新时间
      });
      this.useLRU = true;
      logger.info("[EmbeddingsService] 使用LRU缓存");
    } else {
      this.cache = new Map();
      this.useLRU = false;
      logger.info("[EmbeddingsService] 使用Map缓存（降级）");
    }

    // 持久化缓存（第二层）
    this.persistentCache = null;
    this.enablePersistentCache = options.enablePersistentCache !== false;

    if (this.enablePersistentCache && options.database) {
      try {
        this.persistentCache = new EmbeddingCache({
          database: options.database,
          maxCacheSize: 100000,
          cacheExpiration: 30 * 24 * 60 * 60 * 1000, // 30天
          enableAutoCleanup: true,
          storeOriginalContent: false,
        });
        logger.info("[EmbeddingsService] 持久化缓存已启用");
      } catch (error) {
        logger.warn("[EmbeddingsService] 持久化缓存初始化失败:", error.message);
      }
    }

    this.cacheHits = 0; // 缓存命中次数
    this.cacheMisses = 0; // 缓存未命中次数
    this.persistentCacheHits = 0; // 持久化缓存命中次数
    this.isInitialized = false;
  }

  /**
   * 初始化服务
   */
  async initialize() {
    logger.info("[EmbeddingsService] 初始化嵌入向量服务...");

    try {
      // 检查LLM服务是否可用
      if (!this.llmManager || !this.llmManager.isInitialized) {
        logger.warn("[EmbeddingsService] LLM服务未初始化");
        this.isInitialized = false;
        return false;
      }

      this.isInitialized = true;
      logger.info("[EmbeddingsService] 嵌入向量服务初始化成功");
      return true;
    } catch (error) {
      logger.error("[EmbeddingsService] 初始化失败:", error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * 生成文本嵌入向量
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @param {boolean} [options.skipCache=false] - 跳过缓存
   * @param {string} [options.model] - 模型名称
   * @returns {Promise<Array>} 向量数组
   */
  async generateEmbedding(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error("文本内容不能为空");
    }

    const model = options.model || this.defaultModel;
    const cacheKey = this.getCacheKey(text);

    // 第一层：检查内存缓存
    if (this.cache.has(cacheKey) && !options.skipCache) {
      this.cacheHits++;
      logger.info("[EmbeddingsService] 使用内存缓存的向量");
      return this.cache.get(cacheKey);
    }

    // 第二层：检查持久化缓存
    if (this.persistentCache && !options.skipCache) {
      const persistedEmbedding = this.persistentCache.get(text, model);
      if (persistedEmbedding) {
        this.persistentCacheHits++;
        // 同时更新内存缓存
        this.cache.set(cacheKey, persistedEmbedding);
        logger.info("[EmbeddingsService] 使用持久化缓存的向量");
        return persistedEmbedding;
      }
    }

    this.cacheMisses++;

    try {
      // 调用LLM服务生成嵌入
      const embedding = await this.llmManager.embeddings(text);

      if (!embedding || !Array.isArray(embedding)) {
        // 如果LLM不支持embeddings，使用简单的文本特征
        logger.warn("[EmbeddingsService] LLM不支持embeddings，使用简单特征");
        const simpleEmbedding = this.generateSimpleEmbedding(text);
        this.cache.set(cacheKey, simpleEmbedding);
        return simpleEmbedding;
      }

      // 更新内存缓存
      this.cache.set(cacheKey, embedding);

      // 更新持久化缓存
      if (this.persistentCache) {
        this.persistentCache.set(text, embedding, model);
      }

      // LRU缓存会自动管理大小，Map需要手动限制
      if (!this.useLRU && this.cache.size > 2000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return embedding;
    } catch (error) {
      logger.error("[EmbeddingsService] 生成嵌入失败:", error);

      // 降级到简单嵌入
      logger.info("[EmbeddingsService] 使用简单嵌入作为降级方案");
      return this.generateSimpleEmbedding(text);
    }
  }

  /**
   * 批量生成嵌入向量
   * @param {Array<string>} texts - 文本数组
   * @param {Object} options - 选项
   * @returns {Promise<Array<Array>>} 向量数组
   */
  async generateEmbeddings(texts, options = {}) {
    const embeddings = [];

    for (const text of texts) {
      try {
        const embedding = await this.generateEmbedding(text, options);
        embeddings.push(embedding);
      } catch (error) {
        logger.error("[EmbeddingsService] 批量生成失败:", error);
        embeddings.push(null);
      }
    }

    return embeddings;
  }

  /**
   * 计算余弦相似度
   * @param {Array} vec1 - 向量1
   * @param {Array} vec2 - 向量2
   * @returns {number} 相似度 (0-1)
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * 生成简单的文本嵌入（降级方案）
   * 使用TF-IDF和词频特征
   * @param {string} text - 文本内容
   * @returns {Array} 简化的向量
   */
  generateSimpleEmbedding(text) {
    // 简单的特征提取：字符频率 + 词长度分布
    const features = new Array(128).fill(0);

    // 清理文本
    const cleanText = text.toLowerCase().trim();

    // 字符频率 (前64维)
    for (let i = 0; i < cleanText.length; i++) {
      const charCode = cleanText.charCodeAt(i);
      if (charCode < 128) {
        features[charCode % 64]++;
      }
    }

    // 词长度分布 (后64维)
    const words = cleanText.split(/\s+/);
    for (const word of words) {
      const len = Math.min(word.length, 63);
      features[64 + len]++;
    }

    // 归一化
    const max = Math.max(...features);
    if (max > 0) {
      for (let i = 0; i < features.length; i++) {
        features[i] = features[i] / max;
      }
    }

    return features;
  }

  /**
   * 获取缓存键
   * @param {string} text - 文本
   * @returns {string} 缓存键
   */
  getCacheKey(text) {
    // 简单的hash函数
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  /**
   * 清除缓存
   * @param {Object} options - 选项
   * @param {boolean} [options.clearPersistent=false] - 是否同时清除持久化缓存
   */
  clearCache(options = {}) {
    // 清除内存缓存
    // 兼容 LRU-cache 不同版本的 API
    if (this.useLRU) {
      // LRU-cache v4-5 使用 reset(), v6+ 使用 clear()
      if (typeof this.cache.reset === "function") {
        this.cache.reset();
      } else if (typeof this.cache.clear === "function") {
        this.cache.clear();
      }
    } else {
      // Map 使用 clear()
      this.cache.clear();
    }

    // 清除持久化缓存
    if (options.clearPersistent && this.persistentCache) {
      this.persistentCache.clear();
    }

    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.persistentCacheHits = 0;
    logger.info("[EmbeddingsService] 缓存已清除", {
      内存缓存: "已清除",
      持久化缓存: options.clearPersistent ? "已清除" : "保留",
    });
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    const stats = {
      memoryCache: {
        size: this.cache.size,
        maxSize: 2000,
        hitRate: hitRate,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        totalRequests: totalRequests,
        cacheType: this.useLRU ? "LRU" : "Map (FIFO)",
      },
      // 兼容旧版 API
      size: this.cache.size,
      maxSize: 2000,
      hitRate: hitRate,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      totalRequests: totalRequests,
      cacheType: this.useLRU ? "LRU" : "Map (FIFO)",
    };

    // 如果使用LRU，添加额外统计
    if (this.useLRU && this.cache.dump) {
      const dump = this.cache.dump();
      stats.entries = dump.length;
      stats.memoryCache.entries = dump.length;
    }

    // 持久化缓存统计
    if (this.persistentCache) {
      stats.persistentCache = this.persistentCache.getStats();
      stats.persistentCacheHits = this.persistentCacheHits;
    }

    return stats;
  }

  /**
   * 启动持久化缓存自动清理
   */
  startPersistentCacheCleanup() {
    if (this.persistentCache) {
      this.persistentCache.startAutoCleanup();
    }
  }

  /**
   * 停止持久化缓存自动清理
   */
  stopPersistentCacheCleanup() {
    if (this.persistentCache) {
      this.persistentCache.stopAutoCleanup();
    }
  }

  /**
   * 销毁服务
   */
  destroy() {
    this.clearCache();
    if (this.persistentCache) {
      this.persistentCache.destroy();
    }
    logger.info("[EmbeddingsService] 服务已销毁");
  }
}

module.exports = {
  EmbeddingsService,
};
