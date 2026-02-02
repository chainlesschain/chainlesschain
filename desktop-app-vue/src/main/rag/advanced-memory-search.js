/**
 * AdvancedMemorySearch - 高级记忆搜索
 *
 * 提供增强的记忆搜索功能：
 * 1. 时间范围过滤
 * 2. 分面搜索 (按类型、来源、重要性)
 * 3. 重要性排序
 * 4. 分层记忆搜索 (工作/召回/归档)
 *
 * @module advanced-memory-search
 * @version 1.0.0
 * @since 2026-02-02
 */

const { logger } = require("../utils/logger.js");

/**
 * 记忆层级定义
 */
const MEMORY_TIERS = {
  WORKING: "working",     // 工作记忆 - 最近 7 天
  RECALL: "recall",       // 召回记忆 - 8-30 天
  ARCHIVAL: "archival",   // 归档记忆 - 30 天以上
};

/**
 * 记忆类型
 */
const MEMORY_TYPES = {
  DAILY_NOTE: "daily_note",
  LONG_TERM: "long_term",
  CONVERSATION: "conversation",
  DISCOVERY: "discovery",
  SOLUTION: "solution",
  PREFERENCE: "preference",
};

/**
 * 重要性级别
 */
const IMPORTANCE_LEVELS = {
  CRITICAL: 5,  // 关键 - 永不过期
  HIGH: 4,      // 高 - 延长保留
  NORMAL: 3,    // 普通
  LOW: 2,       // 低 - 优先清理
  TRIVIAL: 1,   // 琐碎 - 可删除
};

/**
 * AdvancedMemorySearch 类
 */
class AdvancedMemorySearch {
  /**
   * 创建高级记忆搜索实例
   * @param {Object} options - 配置选项
   * @param {Object} options.database - 数据库实例
   * @param {Object} [options.hybridSearchEngine] - 混合搜索引擎
   * @param {Object} [options.semanticChunker] - 语义分块器
   */
  constructor(options = {}) {
    if (!options.database) {
      throw new Error("[AdvancedMemorySearch] database 参数是必需的");
    }

    this.db = options.database;
    this.hybridSearchEngine = options.hybridSearchEngine || null;
    this.semanticChunker = options.semanticChunker || null;

    // 层级时间阈值 (毫秒)
    this.tierThresholds = {
      working: 7 * 24 * 60 * 60 * 1000,      // 7 天
      recall: 30 * 24 * 60 * 60 * 1000,      // 30 天
    };

    // 缓存
    this.searchCache = new Map();
    this.cacheMaxSize = 100;
    this.cacheTTL = 5 * 60 * 1000; // 5 分钟

    logger.info("[AdvancedMemorySearch] 初始化完成");
  }

  /**
   * 高级搜索
   * @param {string} query - 搜索查询
   * @param {Object} options - 搜索选项
   * @returns {Promise<Object>} 搜索结果
   */
  async search(query, options = {}) {
    const startTime = Date.now();

    const {
      // 时间过滤
      dateFrom = null,
      dateTo = null,
      tier = null,           // 记忆层级: working, recall, archival, null (全部)

      // 类型过滤
      types = null,          // 记忆类型数组
      sources = null,        // 来源数组 (daily_notes, memory_md)

      // 重要性过滤
      minImportance = 1,
      maxImportance = 5,

      // 排序
      sortBy = "relevance",  // relevance, date, importance
      sortOrder = "desc",

      // 分页
      limit = 20,
      offset = 0,

      // 搜索选项
      useSemanticSearch = true,
      useBM25 = true,
      vectorWeight = 0.6,
      textWeight = 0.4,

      // 分面统计
      includeFacets = true,
    } = options;

    // 检查缓存
    const cacheKey = this._buildCacheKey(query, options);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // 构建时间范围
      const timeRange = this._buildTimeRange(dateFrom, dateTo, tier);

      // 执行搜索
      let results = [];
      let facets = null;

      if (this.hybridSearchEngine && (useSemanticSearch || useBM25)) {
        // 使用混合搜索引擎
        results = await this._hybridSearch(query, {
          timeRange,
          types,
          sources,
          minImportance,
          maxImportance,
          vectorWeight: useSemanticSearch ? vectorWeight : 0,
          textWeight: useBM25 ? textWeight : 0,
          limit: limit + offset + 50, // 获取更多用于后续过滤
        });
      } else {
        // 回退到数据库搜索
        results = await this._databaseSearch(query, {
          timeRange,
          types,
          sources,
          minImportance,
          maxImportance,
        });
      }

      // 应用后处理过滤
      results = this._applyFilters(results, {
        types,
        sources,
        minImportance,
        maxImportance,
        timeRange,
      });

      // 排序
      results = this._sortResults(results, sortBy, sortOrder);

      // 计算分面统计
      if (includeFacets) {
        facets = this._calculateFacets(results);
      }

      // 分页
      const total = results.length;
      results = results.slice(offset, offset + limit);

      // 添加层级信息
      results = results.map((r) => ({
        ...r,
        tier: this._determineTier(r.metadata?.date || r.metadata?.createdAt),
      }));

      const response = {
        query,
        results,
        total,
        facets,
        pagination: {
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        timing: {
          totalMs: Date.now() - startTime,
        },
      };

      // 缓存结果
      this._setCache(cacheKey, response);

      return response;
    } catch (error) {
      logger.error("[AdvancedMemorySearch] 搜索失败:", error);
      throw error;
    }
  }

  /**
   * 按层级搜索
   * @param {string} query - 搜索查询
   * @param {string} tier - 层级 (working, recall, archival)
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchByTier(query, tier, options = {}) {
    return this.search(query, { ...options, tier });
  }

  /**
   * 按类型搜索
   * @param {string} query - 搜索查询
   * @param {Array<string>} types - 类型数组
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchByTypes(query, types, options = {}) {
    return this.search(query, { ...options, types });
  }

  /**
   * 按时间范围搜索
   * @param {string} query - 搜索查询
   * @param {string|Date} dateFrom - 开始日期
   * @param {string|Date} dateTo - 结束日期
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchByDateRange(query, dateFrom, dateTo, options = {}) {
    return this.search(query, { ...options, dateFrom, dateTo });
  }

  /**
   * 获取重要记忆
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 重要记忆列表
   */
  async getImportantMemories(options = {}) {
    const { minImportance = 4, limit = 50 } = options;

    try {
      // 从数据库获取标记为重要的记忆
      const stmt = this.db.prepare(`
        SELECT * FROM memory_sections
        WHERE importance >= ?
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(minImportance, limit);

      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        category: row.category,
        subcategory: row.subcategory,
        importance: row.importance,
        tags: row.tags ? JSON.parse(row.tags) : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tier: MEMORY_TIERS.WORKING, // 重要记忆始终在工作层
      }));
    } catch (error) {
      logger.error("[AdvancedMemorySearch] 获取重要记忆失败:", error);
      return [];
    }
  }

  /**
   * 获取最近记忆
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 最近记忆列表
   */
  async getRecentMemories(options = {}) {
    const { days = 7, limit = 50, types = null } = options;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const stmt = this.db.prepare(`
        SELECT * FROM daily_notes_metadata
        WHERE date >= ?
        ORDER BY date DESC
        LIMIT ?
      `);

      const rows = stmt.all(cutoffStr, limit);

      return rows.map((row) => ({
        id: `daily-${row.date}`,
        date: row.date,
        title: row.title,
        conversationCount: row.conversation_count,
        completedTasks: row.completed_tasks,
        pendingTasks: row.pending_tasks,
        discoveriesCount: row.discoveries_count,
        wordCount: row.word_count,
        tier: this._determineTier(row.date),
        type: MEMORY_TYPES.DAILY_NOTE,
      }));
    } catch (error) {
      logger.error("[AdvancedMemorySearch] 获取最近记忆失败:", error);
      return [];
    }
  }

  /**
   * 设置记忆重要性
   * @param {string} memoryId - 记忆 ID
   * @param {number} importance - 重要性级别 (1-5)
   * @returns {Promise<boolean>} 是否成功
   */
  async setImportance(memoryId, importance) {
    if (importance < 1 || importance > 5) {
      throw new Error("[AdvancedMemorySearch] 重要性必须在 1-5 之间");
    }

    try {
      const stmt = this.db.prepare(`
        UPDATE memory_sections
        SET importance = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(importance, Date.now(), memoryId);

      // 清除缓存
      this.searchCache.clear();

      logger.info("[AdvancedMemorySearch] 重要性已更新:", { memoryId, importance });
      return true;
    } catch (error) {
      logger.error("[AdvancedMemorySearch] 设置重要性失败:", error);
      return false;
    }
  }

  /**
   * 获取记忆统计
   * @returns {Promise<Object>} 统计信息
   */
  async getMemoryStats() {
    try {
      const now = Date.now();
      const workingCutoff = now - this.tierThresholds.working;
      const recallCutoff = now - this.tierThresholds.recall;

      // Daily Notes 统计
      const dailyStats = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(word_count) as totalWords,
          SUM(conversation_count) as totalConversations,
          SUM(discoveries_count) as totalDiscoveries
        FROM daily_notes_metadata
      `).get();

      // 按层级统计
      const tierStats = {
        working: this._countByTier(workingCutoff, now),
        recall: this._countByTier(recallCutoff, workingCutoff),
        archival: this._countByTier(0, recallCutoff),
      };

      // 重要性分布
      const importanceStats = this.db.prepare(`
        SELECT importance, COUNT(*) as count
        FROM memory_sections
        GROUP BY importance
      `).all();

      // 搜索统计
      const searchStats = this.db.prepare(`
        SELECT
          hybrid_search_count,
          vector_search_count,
          bm25_search_count,
          cache_hits,
          cache_misses,
          avg_search_latency
        FROM memory_stats
        WHERE date = ?
      `).get(new Date().toISOString().split("T")[0]) || {};

      return {
        dailyNotes: dailyStats,
        tiers: tierStats,
        importance: importanceStats.reduce((acc, row) => {
          acc[row.importance] = row.count;
          return acc;
        }, {}),
        search: searchStats,
        cacheSize: this.searchCache.size,
      };
    } catch (error) {
      logger.error("[AdvancedMemorySearch] 获取统计失败:", error);
      return {};
    }
  }

  // =============================================
  // 私有方法
  // =============================================

  /**
   * 构建时间范围
   * @private
   */
  _buildTimeRange(dateFrom, dateTo, tier) {
    const now = Date.now();
    let from = dateFrom ? new Date(dateFrom).getTime() : 0;
    let to = dateTo ? new Date(dateTo).getTime() : now;

    // 按层级覆盖时间范围
    if (tier) {
      switch (tier) {
        case MEMORY_TIERS.WORKING:
          from = Math.max(from, now - this.tierThresholds.working);
          break;
        case MEMORY_TIERS.RECALL:
          from = Math.max(from, now - this.tierThresholds.recall);
          to = Math.min(to, now - this.tierThresholds.working);
          break;
        case MEMORY_TIERS.ARCHIVAL:
          to = Math.min(to, now - this.tierThresholds.recall);
          break;
      }
    }

    return { from, to };
  }

  /**
   * 混合搜索
   * @private
   */
  async _hybridSearch(query, options) {
    if (!this.hybridSearchEngine) {
      return [];
    }

    try {
      const results = await this.hybridSearchEngine.search(query, {
        limit: options.limit,
        vectorWeight: options.vectorWeight,
        textWeight: options.textWeight,
      });

      return results.map((r) => ({
        id: r.document?.id || r.id,
        content: r.document?.content || r.content,
        score: r.score,
        metadata: r.document?.metadata || r.metadata || {},
        source: "hybrid",
      }));
    } catch (error) {
      logger.warn("[AdvancedMemorySearch] 混合搜索失败，回退到数据库搜索:", error.message);
      return this._databaseSearch(query, options);
    }
  }

  /**
   * 数据库搜索
   * @private
   */
  async _databaseSearch(query, options) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    try {
      // 搜索 Daily Notes
      const dailyNotes = this.db.prepare(`
        SELECT * FROM daily_notes_metadata
        WHERE title LIKE ? OR date LIKE ?
        ORDER BY date DESC
        LIMIT 100
      `).all(`%${query}%`, `%${query}%`);

      for (const note of dailyNotes) {
        results.push({
          id: `daily-${note.date}`,
          content: note.title,
          score: 0.5,
          metadata: {
            type: MEMORY_TYPES.DAILY_NOTE,
            date: note.date,
            importance: 3,
          },
          source: "database",
        });
      }

      // 搜索 Memory Sections
      const sections = this.db.prepare(`
        SELECT * FROM memory_sections
        WHERE content LIKE ? OR category LIKE ?
        ORDER BY importance DESC, updated_at DESC
        LIMIT 100
      `).all(`%${query}%`, `%${query}%`);

      for (const section of sections) {
        results.push({
          id: section.id,
          content: section.content,
          score: 0.3 + (section.importance || 3) * 0.1,
          metadata: {
            type: MEMORY_TYPES.LONG_TERM,
            category: section.category,
            subcategory: section.subcategory,
            importance: section.importance,
            createdAt: section.created_at,
          },
          source: "database",
        });
      }

      return results;
    } catch (error) {
      logger.error("[AdvancedMemorySearch] 数据库搜索失败:", error);
      return [];
    }
  }

  /**
   * 应用过滤器
   * @private
   */
  _applyFilters(results, filters) {
    return results.filter((r) => {
      const metadata = r.metadata || {};

      // 类型过滤
      if (filters.types && filters.types.length > 0) {
        if (!filters.types.includes(metadata.type)) {
          return false;
        }
      }

      // 来源过滤
      if (filters.sources && filters.sources.length > 0) {
        const source = metadata.type === MEMORY_TYPES.DAILY_NOTE
          ? "daily_notes"
          : "memory_md";
        if (!filters.sources.includes(source)) {
          return false;
        }
      }

      // 重要性过滤
      const importance = metadata.importance || 3;
      if (importance < filters.minImportance || importance > filters.maxImportance) {
        return false;
      }

      // 时间过滤
      if (filters.timeRange) {
        const date = metadata.date || metadata.createdAt;
        if (date) {
          const timestamp = new Date(date).getTime();
          if (timestamp < filters.timeRange.from || timestamp > filters.timeRange.to) {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * 排序结果
   * @private
   */
  _sortResults(results, sortBy, sortOrder) {
    const multiplier = sortOrder === "asc" ? 1 : -1;

    return results.sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case "date":
          valueA = new Date(a.metadata?.date || a.metadata?.createdAt || 0).getTime();
          valueB = new Date(b.metadata?.date || b.metadata?.createdAt || 0).getTime();
          break;
        case "importance":
          valueA = a.metadata?.importance || 3;
          valueB = b.metadata?.importance || 3;
          break;
        case "relevance":
        default:
          valueA = a.score || 0;
          valueB = b.score || 0;
          break;
      }

      return (valueA - valueB) * multiplier;
    });
  }

  /**
   * 计算分面统计
   * @private
   */
  _calculateFacets(results) {
    const facets = {
      types: {},
      tiers: {},
      importance: {},
      sources: {},
    };

    for (const r of results) {
      const metadata = r.metadata || {};

      // 类型统计
      const type = metadata.type || "unknown";
      facets.types[type] = (facets.types[type] || 0) + 1;

      // 层级统计
      const tier = this._determineTier(metadata.date || metadata.createdAt);
      facets.tiers[tier] = (facets.tiers[tier] || 0) + 1;

      // 重要性统计
      const importance = metadata.importance || 3;
      facets.importance[importance] = (facets.importance[importance] || 0) + 1;

      // 来源统计
      const source = metadata.type === MEMORY_TYPES.DAILY_NOTE
        ? "daily_notes"
        : "memory_md";
      facets.sources[source] = (facets.sources[source] || 0) + 1;
    }

    return facets;
  }

  /**
   * 确定记忆层级
   * @private
   */
  _determineTier(dateStr) {
    if (!dateStr) {
      return MEMORY_TIERS.ARCHIVAL;
    }

    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const age = now - date;

    if (age <= this.tierThresholds.working) {
      return MEMORY_TIERS.WORKING;
    } else if (age <= this.tierThresholds.recall) {
      return MEMORY_TIERS.RECALL;
    } else {
      return MEMORY_TIERS.ARCHIVAL;
    }
  }

  /**
   * 按层级统计
   * @private
   */
  _countByTier(fromMs, toMs) {
    try {
      const fromDate = new Date(fromMs).toISOString().split("T")[0];
      const toDate = new Date(toMs).toISOString().split("T")[0];

      const row = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM daily_notes_metadata
        WHERE date >= ? AND date < ?
      `).get(fromDate, toDate);

      return row?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 构建缓存键
   * @private
   */
  _buildCacheKey(query, options) {
    return JSON.stringify({ query, ...options });
  }

  /**
   * 从缓存获取
   * @private
   */
  _getFromCache(key) {
    const cached = this.searchCache.get(key);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.searchCache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * 设置缓存
   * @private
   */
  _setCache(key, data) {
    // LRU 淘汰
    if (this.searchCache.size >= this.cacheMaxSize) {
      const firstKey = this.searchCache.keys().next().value;
      this.searchCache.delete(firstKey);
    }

    this.searchCache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.searchCache.clear();
    logger.info("[AdvancedMemorySearch] 缓存已清除");
  }
}

module.exports = {
  AdvancedMemorySearch,
  MEMORY_TIERS,
  MEMORY_TYPES,
  IMPORTANCE_LEVELS,
};
