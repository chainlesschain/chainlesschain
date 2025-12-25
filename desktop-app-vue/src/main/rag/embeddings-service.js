/**
 * 嵌入向量服务
 *
 * 负责文本向量化和相似度计算
 */

const EventEmitter = require('events');

// 尝试使用lru-cache，如果不可用则降级到Map
let LRUCache;
try {
  LRUCache = require('lru-cache');
} catch (error) {
  console.warn('[EmbeddingsService] lru-cache未安装，使用Map作为降级方案');
  LRUCache = null;
}

/**
 * 嵌入向量服务类
 */
class EmbeddingsService extends EventEmitter {
  constructor(llmManager) {
    super();
    this.llmManager = llmManager;

    // 使用LRU缓存或Map
    if (LRUCache) {
      this.cache = new LRUCache({
        max: 2000,                // 最多2000条
        maxAge: 1000 * 60 * 60,   // 1小时过期
        updateAgeOnGet: true,     // 访问时更新时间
      });
      this.useLRU = true;
      console.log('[EmbeddingsService] 使用LRU缓存');
    } else {
      this.cache = new Map();
      this.useLRU = false;
      console.log('[EmbeddingsService] 使用Map缓存（降级）');
    }

    this.cacheHits = 0; // 缓存命中次数
    this.cacheMisses = 0; // 缓存未命中次数
    this.isInitialized = false;
  }

  /**
   * 初始化服务
   */
  async initialize() {
    console.log('[EmbeddingsService] 初始化嵌入向量服务...');

    try {
      // 检查LLM服务是否可用
      if (!this.llmManager || !this.llmManager.isInitialized) {
        console.warn('[EmbeddingsService] LLM服务未初始化');
        this.isInitialized = false;
        return false;
      }

      this.isInitialized = true;
      console.log('[EmbeddingsService] 嵌入向量服务初始化成功');
      return true;
    } catch (error) {
      console.error('[EmbeddingsService] 初始化失败:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * 生成文本嵌入向量
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 向量数组
   */
  async generateEmbedding(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('文本内容不能为空');
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(text);
    if (this.cache.has(cacheKey) && !options.skipCache) {
      this.cacheHits++;
      console.log('[EmbeddingsService] 使用缓存的向量');
      return this.cache.get(cacheKey);
    }

    this.cacheMisses++;

    try {
      // 调用LLM服务生成嵌入
      const embedding = await this.llmManager.embeddings(text);

      if (!embedding || !Array.isArray(embedding)) {
        // 如果LLM不支持embeddings，使用简单的文本特征
        console.warn('[EmbeddingsService] LLM不支持embeddings，使用简单特征');
        const simpleEmbedding = this.generateSimpleEmbedding(text);
        this.cache.set(cacheKey, simpleEmbedding);
        return simpleEmbedding;
      }

      // 缓存结果
      this.cache.set(cacheKey, embedding);

      // LRU缓存会自动管理大小，Map需要手动限制
      if (!this.useLRU && this.cache.size > 2000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return embedding;
    } catch (error) {
      console.error('[EmbeddingsService] 生成嵌入失败:', error);

      // 降级到简单嵌入
      console.log('[EmbeddingsService] 使用简单嵌入作为降级方案');
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
        console.error('[EmbeddingsService] 批量生成失败:', error);
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
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    console.log('[EmbeddingsService] 缓存已清除');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    const stats = {
      size: this.cache.size,
      maxSize: 2000,
      hitRate: hitRate,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      totalRequests: totalRequests,
      cacheType: this.useLRU ? 'LRU' : 'Map (FIFO)',
    };

    // 如果使用LRU，添加额外统计
    if (this.useLRU && this.cache.dump) {
      const dump = this.cache.dump();
      stats.entries = dump.length;
    }

    return stats;
  }
}

module.exports = {
  EmbeddingsService,
};
