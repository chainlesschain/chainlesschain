/**
 * 响应缓存模块
 * 实现 LLM 响应的智能缓存，减少重复调用
 *
 * 缓存策略：
 * 1. 精确匹配：使用 SHA-256 哈希对 (provider, model, messages) 进行缓存
 * 2. TTL 管理：缓存有效期为 7 天
 * 3. LRU 淘汰：缓存数量超过限制时，淘汰最久未使用的条目
 *
 * 目标：缓存命中率 >20%
 *
 * @module response-cache
 */

const crypto = require('crypto');

/**
 * 计算缓存键（SHA-256 哈希）
 * @param {string} provider - 提供商
 * @param {string} model - 模型名称
 * @param {Array} messages - 消息数组
 * @returns {string} 缓存键
 */
function calculateCacheKey(provider, model, messages) {
  const payload = JSON.stringify({
    provider,
    model,
    messages,
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

class ResponseCache {
  /**
   * 创建响应缓存
   * @param {Object} database - 数据库实例
   * @param {Object} options - 配置选项
   * @param {number} [options.ttl=604800000] - 缓存有效期（默认 7 天，单位：毫秒）
   * @param {number} [options.maxSize=1000] - 最大缓存条目数
   * @param {boolean} [options.enableAutoCleanup=true] - 启用自动清理过期缓存
   * @param {number} [options.cleanupInterval=3600000] - 清理间隔（默认 1 小时）
   */
  constructor(database, options = {}) {
    this.db = database;
    this.ttl = options.ttl || 7 * 24 * 60 * 60 * 1000; // 7 天
    this.maxSize = options.maxSize || 1000;
    this.enableAutoCleanup = options.enableAutoCleanup !== false;
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000; // 1 小时

    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      expirations: 0,
    };

    console.log('[ResponseCache] 初始化完成，配置:', {
      TTL: `${this.ttl / 1000 / 60 / 60 / 24} 天`,
      最大条目数: this.maxSize,
      自动清理: this.enableAutoCleanup,
    });

    // 启动自动清理任务
    if (this.enableAutoCleanup) {
      this._startAutoCleanup();
    }
  }

  /**
   * 从缓存获取响应
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} options - 获取选项
   * @returns {Promise<Object>} {hit: boolean, response?: Object, tokensSaved?: number}
   */
  async get(provider, model, messages, options = {}) {
    try {
      const cacheKey = calculateCacheKey(provider, model, messages);
      const now = Date.now();

      // 查询缓存
      const cached = this.db.prepare(`
        SELECT id, response_content, response_tokens, hit_count, tokens_saved, expires_at
        FROM llm_cache
        WHERE cache_key = ?
      `).get(cacheKey);

      if (!cached) {
        this.stats.misses++;
        return { hit: false };
      }

      // 检查是否过期
      if (cached.expires_at < now) {
        console.log('[ResponseCache] 缓存已过期，删除');
        this._deleteCache(cached.id);
        this.stats.expirations++;
        this.stats.misses++;
        return { hit: false };
      }

      // 更新命中统计
      this._updateHitStats(cached.id, cached.hit_count, cached.tokens_saved, cached.response_tokens);

      this.stats.hits++;

      console.log(`[ResponseCache] 缓存命中! 节省 ${cached.response_tokens} tokens`);

      // 解析响应
      const response = JSON.parse(cached.response_content);

      return {
        hit: true,
        response,
        tokensSaved: cached.response_tokens || 0,
        cacheAge: now - (cached.expires_at - this.ttl), // 缓存年龄
      };

    } catch (error) {
      console.error('[ResponseCache] 获取缓存失败:', error);
      this.stats.misses++;
      return { hit: false };
    }
  }

  /**
   * 将响应存入缓存
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} response - LLM 响应对象
   * @param {Object} options - 存储选项
   * @returns {Promise<boolean>} 是否成功
   */
  async set(provider, model, messages, response, options = {}) {
    try {
      const cacheKey = calculateCacheKey(provider, model, messages);
      const now = Date.now();
      const expiresAt = now + this.ttl;

      // 估算 Token 数
      const responseTokens = response.usage?.total_tokens
        || response.tokens
        || this._estimateTokens(response.text || response.content || '');

      // 检查缓存大小，如果超过限制则执行 LRU 淘汰
      await this._enforceMaxSize();

      // 插入或更新缓存
      const id = `cache_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      this.db.prepare(`
        INSERT OR REPLACE INTO llm_cache (
          id, cache_key, provider, model, messages,
          response_content, response_tokens,
          hit_count, tokens_saved, cost_saved_usd,
          created_at, expires_at, last_hit_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cacheKey,
        provider,
        model,
        JSON.stringify(messages),
        JSON.stringify(response),
        responseTokens,
        0, // hit_count
        0, // tokens_saved
        0, // cost_saved_usd
        now,
        expiresAt,
        null
      );

      this.stats.sets++;

      console.log(`[ResponseCache] 缓存已保存: ${provider}/${model}, tokens: ${responseTokens}, 过期时间: ${new Date(expiresAt).toLocaleString()}`);

      return true;

    } catch (error) {
      console.error('[ResponseCache] 保存缓存失败:', error);
      return false;
    }
  }

  /**
   * 清除所有缓存
   * @returns {Promise<number>} 清除的条目数
   */
  async clear() {
    try {
      const result = this.db.prepare('DELETE FROM llm_cache').run();
      const deletedCount = result.changes || 0;

      console.log(`[ResponseCache] 已清除所有缓存: ${deletedCount} 条`);

      // 重置统计
      this.stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        expirations: 0,
      };

      return deletedCount;

    } catch (error) {
      console.error('[ResponseCache] 清除缓存失败:', error);
      return 0;
    }
  }

  /**
   * 清除过期缓存
   * @returns {Promise<number>} 清除的条目数
   */
  async clearExpired() {
    try {
      const now = Date.now();

      const result = this.db.prepare(`
        DELETE FROM llm_cache
        WHERE expires_at < ?
      `).run(now);

      const deletedCount = result.changes || 0;

      if (deletedCount > 0) {
        console.log(`[ResponseCache] 已清除过期缓存: ${deletedCount} 条`);
        this.stats.expirations += deletedCount;
      }

      return deletedCount;

    } catch (error) {
      console.error('[ResponseCache] 清除过期缓存失败:', error);
      return 0;
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    try {
      // 查询数据库统计
      const dbStats = this.db.prepare(`
        SELECT
          COUNT(*) as total_entries,
          SUM(hit_count) as total_hits,
          SUM(tokens_saved) as total_tokens_saved,
          SUM(cost_saved_usd) as total_cost_saved,
          AVG(hit_count) as avg_hits_per_entry
        FROM llm_cache
      `).get();

      const now = Date.now();
      const expiredCount = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM llm_cache
        WHERE expires_at < ?
      `).get(now);

      // 计算命中率
      const totalRequests = this.stats.hits + this.stats.misses;
      const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

      return {
        // 运行时统计
        runtime: {
          hits: this.stats.hits,
          misses: this.stats.misses,
          sets: this.stats.sets,
          evictions: this.stats.evictions,
          expirations: this.stats.expirations,
          hitRate: hitRate.toFixed(2) + '%',
        },
        // 数据库统计
        database: {
          totalEntries: dbStats.total_entries || 0,
          expiredEntries: expiredCount.count || 0,
          totalHits: dbStats.total_hits || 0,
          totalTokensSaved: dbStats.total_tokens_saved || 0,
          totalCostSaved: (dbStats.total_cost_saved || 0).toFixed(4),
          avgHitsPerEntry: (dbStats.avg_hits_per_entry || 0).toFixed(2),
        },
        // 配置
        config: {
          maxSize: this.maxSize,
          ttlDays: this.ttl / 1000 / 60 / 60 / 24,
          autoCleanup: this.enableAutoCleanup,
        },
      };

    } catch (error) {
      console.error('[ResponseCache] 获取统计信息失败:', error);
      return null;
    }
  }

  /**
   * 按提供商获取缓存统计
   * @returns {Promise<Array>} 统计信息数组
   */
  async getStatsByProvider() {
    try {
      const stats = this.db.prepare(`
        SELECT
          provider,
          COUNT(*) as entries,
          SUM(hit_count) as hits,
          SUM(tokens_saved) as tokens_saved,
          SUM(cost_saved_usd) as cost_saved
        FROM llm_cache
        GROUP BY provider
        ORDER BY entries DESC
      `).all();

      return stats.map(stat => ({
        provider: stat.provider,
        entries: stat.entries,
        hits: stat.hits || 0,
        tokensSaved: stat.tokens_saved || 0,
        costSaved: (stat.cost_saved || 0).toFixed(4),
      }));

    } catch (error) {
      console.error('[ResponseCache] 获取提供商统计失败:', error);
      return [];
    }
  }

  /**
   * 更新命中统计（私有方法）
   * @private
   */
  _updateHitStats(cacheId, currentHitCount, currentTokensSaved, responseTokens) {
    try {
      const now = Date.now();

      this.db.prepare(`
        UPDATE llm_cache
        SET
          hit_count = ?,
          tokens_saved = ?,
          last_hit_at = ?
        WHERE id = ?
      `).run(
        currentHitCount + 1,
        currentTokensSaved + responseTokens,
        now,
        cacheId
      );

    } catch (error) {
      console.error('[ResponseCache] 更新命中统计失败:', error);
    }
  }

  /**
   * 删除缓存条目（私有方法）
   * @private
   */
  _deleteCache(cacheId) {
    try {
      this.db.prepare('DELETE FROM llm_cache WHERE id = ?').run(cacheId);
    } catch (error) {
      console.error('[ResponseCache] 删除缓存失败:', error);
    }
  }

  /**
   * 执行 LRU 淘汰（私有方法）
   * @private
   */
  async _enforceMaxSize() {
    try {
      // 查询当前缓存数量
      const count = this.db.prepare('SELECT COUNT(*) as count FROM llm_cache').get();

      if (count.count >= this.maxSize) {
        // 计算需要删除的条目数
        const toDelete = count.count - this.maxSize + 1;

        console.log(`[ResponseCache] 缓存已满 (${count.count}/${this.maxSize})，执行 LRU 淘汰: ${toDelete} 条`);

        // 删除最久未使用的条目（按 last_hit_at 排序，NULL 视为最旧）
        this.db.prepare(`
          DELETE FROM llm_cache
          WHERE id IN (
            SELECT id FROM llm_cache
            ORDER BY
              CASE WHEN last_hit_at IS NULL THEN 0 ELSE last_hit_at END ASC,
              created_at ASC
            LIMIT ?
          )
        `).run(toDelete);

        this.stats.evictions += toDelete;
      }

    } catch (error) {
      console.error('[ResponseCache] LRU 淘汰失败:', error);
    }
  }

  /**
   * 估算 Token 数量（私有方法）
   * @private
   */
  _estimateTokens(text) {
    if (!text) return 0;

    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;

    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 启动自动清理任务（私有方法）
   * @private
   */
  _startAutoCleanup() {
    console.log('[ResponseCache] 启动自动清理任务，间隔:', this.cleanupInterval / 1000 / 60, '分钟');

    this.cleanupTimer = setInterval(async () => {
      console.log('[ResponseCache] 执行定时清理...');
      const deletedCount = await this.clearExpired();
      console.log(`[ResponseCache] 定时清理完成，清除 ${deletedCount} 条过期缓存`);
    }, this.cleanupInterval);

    // 立即执行一次清理
    this.clearExpired();
  }

  /**
   * 停止自动清理任务
   */
  stopAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[ResponseCache] 自动清理任务已停止');
    }
  }

  /**
   * 销毁缓存实例
   */
  destroy() {
    this.stopAutoCleanup();
    console.log('[ResponseCache] 缓存实例已销毁');
  }
}

module.exports = {
  ResponseCache,
  calculateCacheKey, // 导出供测试使用
};
