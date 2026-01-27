/**
 * SmartPlanCache - 智能任务计划缓存
 *
 * 使用语义相似度匹配历史任务计划，大幅提升缓存命中率
 *
 * 核心功能:
 * 1. LLM Embedding向量化
 * 2. 余弦相似度匹配
 * 3. LRU淘汰策略
 * 4. 统计和监控
 *
 * @module ai-engine/smart-plan-cache
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

/**
 * LRU缓存条目
 */
class CacheEntry {
  constructor(key, request, plan, embedding) {
    this.id = uuidv4().slice(0, 8);
    this.key = key; // 原始请求的hash（快速查找）
    this.request = request; // 原始请求文本
    this.plan = plan; // 任务计划
    this.embedding = embedding; // 请求的embedding向量
    this.hits = 0; // 命中次数
    this.createdAt = Date.now();
    this.lastHitAt = null;
    this.lastAccessAt = Date.now();
  }
}

/**
 * SmartPlanCache 类
 */
class SmartPlanCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000; // 最大缓存条目数
    this.similarityThreshold = options.similarityThreshold || 0.85; // 相似度阈值（0-1）
    this.ttl = options.ttl || 7 * 24 * 60 * 60 * 1000; // 7天TTL
    this.enabled = options.enabled !== false;
    this.llmManager = options.llmManager; // LLM管理器（用于embedding）

    // 缓存存储: Map<key, CacheEntry>
    this.cache = new Map();

    // 访问顺序（LRU）: Array<key>
    this.accessOrder = [];

    // 统计信息
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      semanticHits: 0, // 语义匹配命中
      exactHits: 0, // 精确匹配命中
      evictions: 0, // 淘汰次数
      embeddingCalls: 0, // embedding调用次数
      embeddingFailures: 0,
    };

    // 定期清理过期条目
    this.cleanupInterval = setInterval(() => {
      this._cleanupExpired();
    }, 60 * 60 * 1000); // 每小时清理一次

    logger.info('[SmartPlanCache] 智能计划缓存已初始化', {
      maxSize: this.maxSize,
      similarityThreshold: this.similarityThreshold,
      ttl: `${this.ttl / 1000 / 60 / 60 / 24}天`,
    });
  }

  /**
   * 获取缓存（支持语义匹配）
   * @param {string} request - 用户请求
   * @returns {Promise<Object|null>} 缓存的计划或null
   */
  async get(request) {
    if (!this.enabled) {
      return null;
    }

    this.stats.totalRequests++;

    // 1. 尝试精确匹配（快速路径）
    const exactKey = this._hash(request);
    const exactEntry = this.cache.get(exactKey);

    if (exactEntry && !this._isExpired(exactEntry)) {
      this._recordHit(exactEntry, 'exact');
      this.stats.exactHits++;
      this.stats.cacheHits++;

      logger.debug(`[SmartPlanCache] ✅ 精确命中: ${exactEntry.id}, 命中次数: ${exactEntry.hits}`);

      return exactEntry.plan;
    }

    // 2. 语义相似度匹配
    const semanticPlan = await this._semanticSearch(request);

    if (semanticPlan) {
      this.stats.semanticHits++;
      this.stats.cacheHits++;
      return semanticPlan;
    }

    // 3. 缓存未命中
    this.stats.cacheMisses++;
    logger.debug('[SmartPlanCache] ❌ 缓存未命中');

    return null;
  }

  /**
   * 设置缓存
   * @param {string} request - 用户请求
   * @param {Object} plan - 任务计划
   */
  async set(request, plan) {
    if (!this.enabled) {
      return;
    }

    const key = this._hash(request);

    // 检查是否已存在
    if (this.cache.has(key)) {
      logger.debug(`[SmartPlanCache] 更新现有缓存: ${key}`);
      const entry = this.cache.get(key);
      entry.plan = plan;
      entry.lastAccessAt = Date.now();
      this._updateAccessOrder(key);
      return;
    }

    // 计算embedding
    const embedding = await this._getEmbedding(request);

    if (!embedding) {
      logger.warn('[SmartPlanCache] Embedding失败，跳过缓存');
      return;
    }

    // 创建新条目
    const entry = new CacheEntry(key, request, plan, embedding);

    // 检查缓存是否已满
    if (this.cache.size >= this.maxSize) {
      this._evictLRU();
    }

    // 添加到缓存
    this.cache.set(key, entry);
    this.accessOrder.push(key);

    logger.debug(`[SmartPlanCache] ✅ 缓存已添加: ${entry.id}, 缓存大小: ${this.cache.size}/${this.maxSize}`);
  }

  /**
   * 语义搜索
   * @private
   */
  async _semanticSearch(request) {
    // 计算请求的embedding
    const requestEmbedding = await this._getEmbedding(request);

    if (!requestEmbedding) {
      return null;
    }

    let bestMatch = null;
    let bestSimilarity = 0;

    // 遍历所有缓存条目，计算相似度
    for (const entry of this.cache.values()) {
      if (this._isExpired(entry)) {
        continue;
      }

      const similarity = this._cosineSimilarity(requestEmbedding, entry.embedding);

      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      this._recordHit(bestMatch, 'semantic');
      logger.debug(`[SmartPlanCache] ✅ 语义命中: ${bestMatch.id}, 相似度: ${(bestSimilarity * 100).toFixed(2)}%, 命中次数: ${bestMatch.hits}`);
      return bestMatch.plan;
    }

    return null;
  }

  /**
   * 获取文本的embedding向量
   * @private
   */
  async _getEmbedding(text) {
    if (!this.llmManager) {
      logger.warn('[SmartPlanCache] LLM管理器未配置，无法生成embedding');
      return null;
    }

    this.stats.embeddingCalls++;

    try {
      // 尝试调用LLM的embedding API
      // 注意：这需要LLM管理器支持embedding功能
      if (typeof this.llmManager.getEmbedding === 'function') {
        const embedding = await this.llmManager.getEmbedding(text);
        return embedding;
      }

      // 如果LLM管理器不支持embedding，使用简单的TF-IDF向量化作为后备
      logger.warn('[SmartPlanCache] LLM管理器不支持embedding，使用TF-IDF后备方案');
      return this._simpleTFIDFVector(text);

    } catch (error) {
      this.stats.embeddingFailures++;
      logger.error('[SmartPlanCache] Embedding生成失败:', error.message);
      return null;
    }
  }

  /**
   * 简单的TF-IDF向量化（后备方案）
   * @private
   */
  _simpleTFIDFVector(text) {
    // 分词（简单空格分割）
    const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    // 计算词频
    const freq = {};
    for (const token of tokens) {
      freq[token] = (freq[token] || 0) + 1;
    }

    // 归一化（简化版）
    const totalTokens = tokens.length;
    const vector = [];

    // 使用固定词汇表（简化实现）
    const vocab = this._getVocab();

    for (const word of vocab) {
      const tf = (freq[word] || 0) / totalTokens;
      vector.push(tf);
    }

    return vector;
  }

  /**
   * 获取词汇表（简化实现）
   * @private
   */
  _getVocab() {
    // 简化的词汇表（实际应该是从所有请求中提取）
    return [
      'create', 'add', 'build', 'generate', 'implement',
      'update', 'modify', 'change', 'edit', 'refactor',
      'delete', 'remove', 'clean', 'clear',
      'test', 'check', 'validate', 'verify',
      'file', 'code', 'function', 'class', 'component',
      'api', 'database', 'server', 'client',
      'feature', 'bug', 'fix', 'improve', 'optimize',
    ];
  }

  /**
   * 余弦相似度计算
   * @private
   */
  _cosineSimilarity(vec1, vec2) {
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

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);

    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * 记录缓存命中
   * @private
   */
  _recordHit(entry, type = 'unknown') {
    entry.hits++;
    entry.lastHitAt = Date.now();
    entry.lastAccessAt = Date.now();
    this._updateAccessOrder(entry.key);
  }

  /**
   * 更新访问顺序（LRU）
   * @private
   */
  _updateAccessOrder(key) {
    // 从旧位置移除
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }

    // 添加到末尾（最近访问）
    this.accessOrder.push(key);
  }

  /**
   * LRU淘汰
   * @private
   */
  _evictLRU() {
    if (this.accessOrder.length === 0) {
      return;
    }

    // 淘汰最久未使用的条目
    const lruKey = this.accessOrder.shift();
    const evictedEntry = this.cache.get(lruKey);

    if (evictedEntry) {
      this.cache.delete(lruKey);
      this.stats.evictions++;

      logger.debug(`[SmartPlanCache] 🗑️ LRU淘汰: ${evictedEntry.id}, 命中次数: ${evictedEntry.hits}`);
    }
  }

  /**
   * 检查条目是否过期
   * @private
   */
  _isExpired(entry) {
    return Date.now() - entry.createdAt > this.ttl;
  }

  /**
   * 清理过期条目
   * @private
   */
  _cleanupExpired() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this._isExpired(entry)) {
        this.cache.delete(key);
        const index = this.accessOrder.indexOf(key);
        if (index !== -1) {
          this.accessOrder.splice(index, 1);
        }
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[SmartPlanCache] 🧹 清理过期条目: ${cleanedCount}个`);
    }
  }

  /**
   * 计算字符串哈希
   * @private
   */
  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const hitRate = this.stats.totalRequests > 0
      ? ((this.stats.cacheHits / this.stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    const semanticRate = this.stats.cacheHits > 0
      ? ((this.stats.semanticHits / this.stats.cacheHits) * 100).toFixed(2)
      : '0.00';

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      semanticRate: `${semanticRate}%`,
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
    logger.info('[SmartPlanCache] 缓存已清空');
  }

  /**
   * 销毁缓存
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.clear();
    logger.info('[SmartPlanCache] 缓存已销毁');
  }
}

module.exports = { SmartPlanCache, CacheEntry };
