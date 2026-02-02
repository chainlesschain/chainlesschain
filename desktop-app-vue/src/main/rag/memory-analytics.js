/**
 * MemoryAnalytics - 记忆分析服务
 *
 * 提供记忆系统的分析和统计功能：
 * 1. 使用趋势分析
 * 2. 知识图谱统计
 * 3. 搜索行为分析
 * 4. 记忆健康度评估
 *
 * @module memory-analytics
 * @version 1.0.0
 * @since 2026-02-02
 */

const { logger } = require("../utils/logger.js");

/**
 * MemoryAnalytics 类
 */
class MemoryAnalytics {
  /**
   * 创建记忆分析实例
   * @param {Object} options - 配置选项
   * @param {Object} options.database - 数据库实例
   */
  constructor(options = {}) {
    if (!options.database) {
      throw new Error("[MemoryAnalytics] database 参数是必需的");
    }

    this.db = options.database;
    logger.info("[MemoryAnalytics] 初始化完成");
  }

  /**
   * 获取综合仪表板数据
   * @returns {Promise<Object>} 仪表板数据
   */
  async getDashboardData() {
    try {
      const [
        overview,
        trends,
        topKeywords,
        searchStats,
        healthScore,
      ] = await Promise.all([
        this.getOverview(),
        this.getTrends(30),
        this.getTopKeywords(10),
        this.getSearchStatistics(),
        this.calculateHealthScore(),
      ]);

      return {
        overview,
        trends,
        topKeywords,
        searchStats,
        healthScore,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("[MemoryAnalytics] 获取仪表板数据失败:", error);
      throw error;
    }
  }

  /**
   * 获取概览统计
   * @returns {Promise<Object>} 概览数据
   */
  async getOverview() {
    try {
      // Daily Notes 统计
      const dailyNotesStats = this.db.prepare(`
        SELECT
          COUNT(*) as totalNotes,
          COALESCE(SUM(word_count), 0) as totalWords,
          COALESCE(SUM(conversation_count), 0) as totalConversations,
          COALESCE(SUM(discoveries_count), 0) as totalDiscoveries,
          COALESCE(SUM(completed_tasks), 0) as totalCompletedTasks,
          COALESCE(AVG(word_count), 0) as avgWordsPerNote
        FROM daily_notes_metadata
      `).get();

      // Memory Sections 统计
      const sectionsStats = this.db.prepare(`
        SELECT
          COUNT(*) as totalSections,
          COALESCE(AVG(importance), 3) as avgImportance
        FROM memory_sections
      `).get();

      // Embedding Cache 统计
      const cacheStats = this.db.prepare(`
        SELECT
          COUNT(*) as totalEmbeddings,
          COALESCE(SUM(access_count), 0) as totalAccesses
        FROM embedding_cache
      `).get();

      // 索引文件统计
      const indexStats = this.db.prepare(`
        SELECT
          COUNT(*) as totalFiles,
          SUM(CASE WHEN index_status = 'indexed' THEN 1 ELSE 0 END) as indexedFiles,
          SUM(CASE WHEN index_status = 'failed' THEN 1 ELSE 0 END) as failedFiles
        FROM memory_file_hashes
      `).get();

      return {
        dailyNotes: {
          total: dailyNotesStats?.totalNotes || 0,
          totalWords: dailyNotesStats?.totalWords || 0,
          totalConversations: dailyNotesStats?.totalConversations || 0,
          totalDiscoveries: dailyNotesStats?.totalDiscoveries || 0,
          totalCompletedTasks: dailyNotesStats?.totalCompletedTasks || 0,
          avgWordsPerNote: Math.round(dailyNotesStats?.avgWordsPerNote || 0),
        },
        memorySections: {
          total: sectionsStats?.totalSections || 0,
          avgImportance: Math.round((sectionsStats?.avgImportance || 3) * 10) / 10,
        },
        embeddingCache: {
          totalEmbeddings: cacheStats?.totalEmbeddings || 0,
          totalAccesses: cacheStats?.totalAccesses || 0,
        },
        index: {
          totalFiles: indexStats?.totalFiles || 0,
          indexedFiles: indexStats?.indexedFiles || 0,
          failedFiles: indexStats?.failedFiles || 0,
          indexRate: indexStats?.totalFiles > 0
            ? Math.round((indexStats.indexedFiles / indexStats.totalFiles) * 100)
            : 0,
        },
      };
    } catch (error) {
      logger.error("[MemoryAnalytics] 获取概览失败:", error);
      return {};
    }
  }

  /**
   * 获取趋势数据
   * @param {number} days - 天数
   * @returns {Promise<Object>} 趋势数据
   */
  async getTrends(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      // Daily Notes 趋势
      const dailyTrend = this.db.prepare(`
        SELECT
          date,
          word_count,
          conversation_count,
          discoveries_count,
          completed_tasks
        FROM daily_notes_metadata
        WHERE date >= ?
        ORDER BY date ASC
      `).all(cutoffStr);

      // 搜索趋势
      const searchTrend = this.db.prepare(`
        SELECT
          date,
          hybrid_search_count,
          vector_search_count,
          bm25_search_count,
          cache_hits,
          cache_misses
        FROM memory_stats
        WHERE date >= ?
        ORDER BY date ASC
      `).all(cutoffStr);

      // 计算每周汇总
      const weeklyStats = this._aggregateByWeek(dailyTrend);

      return {
        daily: {
          labels: dailyTrend.map((d) => d.date),
          wordCount: dailyTrend.map((d) => d.word_count || 0),
          conversationCount: dailyTrend.map((d) => d.conversation_count || 0),
          discoveriesCount: dailyTrend.map((d) => d.discoveries_count || 0),
          completedTasks: dailyTrend.map((d) => d.completed_tasks || 0),
        },
        search: {
          labels: searchTrend.map((d) => d.date),
          hybridSearchCount: searchTrend.map((d) => d.hybrid_search_count || 0),
          vectorSearchCount: searchTrend.map((d) => d.vector_search_count || 0),
          bm25SearchCount: searchTrend.map((d) => d.bm25_search_count || 0),
          cacheHitRate: searchTrend.map((d) => {
            const total = (d.cache_hits || 0) + (d.cache_misses || 0);
            return total > 0 ? Math.round((d.cache_hits / total) * 100) : 0;
          }),
        },
        weekly: weeklyStats,
      };
    } catch (error) {
      logger.error("[MemoryAnalytics] 获取趋势失败:", error);
      return { daily: {}, search: {}, weekly: {} };
    }
  }

  /**
   * 获取热门关键词
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>} 关键词列表
   */
  async getTopKeywords(limit = 10) {
    try {
      // 从搜索历史提取
      const searchKeywords = this.db.prepare(`
        SELECT query, COUNT(*) as count
        FROM search_history
        GROUP BY query
        ORDER BY count DESC
        LIMIT ?
      `).all(limit);

      // 从标签提取
      const tagKeywords = this.db.prepare(`
        SELECT tags
        FROM memory_sections
        WHERE tags IS NOT NULL AND tags != '[]'
      `).all();

      // 合并标签统计
      const tagCounts = {};
      for (const row of tagKeywords) {
        try {
          const tags = JSON.parse(row.tags);
          for (const tag of tags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }

      // 合并结果
      const keywords = [
        ...searchKeywords.map((k) => ({
          keyword: k.query,
          count: k.count,
          source: "search",
        })),
        ...Object.entries(tagCounts)
          .map(([keyword, count]) => ({
            keyword,
            count,
            source: "tag",
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, limit),
      ];

      // 去重并排序
      const uniqueKeywords = [];
      const seen = new Set();
      for (const k of keywords) {
        if (!seen.has(k.keyword)) {
          seen.add(k.keyword);
          uniqueKeywords.push(k);
        }
      }

      return uniqueKeywords
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch (error) {
      logger.error("[MemoryAnalytics] 获取热门关键词失败:", error);
      return [];
    }
  }

  /**
   * 获取搜索统计
   * @returns {Promise<Object>} 搜索统计
   */
  async getSearchStatistics() {
    try {
      const today = new Date().toISOString().split("T")[0];

      // 今日统计
      const todayStats = this.db.prepare(`
        SELECT
          hybrid_search_count,
          vector_search_count,
          bm25_search_count,
          cache_hits,
          cache_misses,
          avg_search_latency
        FROM memory_stats
        WHERE date = ?
      `).get(today) || {};

      // 总体统计
      const totalStats = this.db.prepare(`
        SELECT
          SUM(hybrid_search_count) as totalHybrid,
          SUM(vector_search_count) as totalVector,
          SUM(bm25_search_count) as totalBm25,
          SUM(cache_hits) as totalCacheHits,
          SUM(cache_misses) as totalCacheMisses,
          AVG(avg_search_latency) as avgLatency
        FROM memory_stats
      `).get() || {};

      // 计算缓存命中率
      const totalHits = totalStats.totalCacheHits || 0;
      const totalMisses = totalStats.totalCacheMisses || 0;
      const totalRequests = totalHits + totalMisses;
      const cacheHitRate = totalRequests > 0
        ? Math.round((totalHits / totalRequests) * 100)
        : 0;

      return {
        today: {
          hybridSearchCount: todayStats.hybrid_search_count || 0,
          vectorSearchCount: todayStats.vector_search_count || 0,
          bm25SearchCount: todayStats.bm25_search_count || 0,
          cacheHits: todayStats.cache_hits || 0,
          cacheMisses: todayStats.cache_misses || 0,
          avgLatency: Math.round(todayStats.avg_search_latency || 0),
        },
        total: {
          hybridSearchCount: totalStats.totalHybrid || 0,
          vectorSearchCount: totalStats.totalVector || 0,
          bm25SearchCount: totalStats.totalBm25 || 0,
          cacheHitRate,
          avgLatency: Math.round(totalStats.avgLatency || 0),
        },
      };
    } catch (error) {
      logger.error("[MemoryAnalytics] 获取搜索统计失败:", error);
      return { today: {}, total: {} };
    }
  }

  /**
   * 计算记忆健康度评分
   * @returns {Promise<Object>} 健康度评分
   */
  async calculateHealthScore() {
    try {
      const scores = {
        coverage: 0,      // 覆盖度 (0-25)
        freshness: 0,     // 新鲜度 (0-25)
        organization: 0,  // 组织度 (0-25)
        utilization: 0,   // 利用率 (0-25)
      };

      // 1. 覆盖度评分 - 基于 Daily Notes 数量
      const recentDays = 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - recentDays);
      const dailyCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM daily_notes_metadata
        WHERE date >= ?
      `).get(cutoffDate.toISOString().split("T")[0])?.count || 0;

      scores.coverage = Math.min(25, Math.round((dailyCount / recentDays) * 25));

      // 2. 新鲜度评分 - 基于最近活动
      const lastWeekCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM daily_notes_metadata
        WHERE date >= ?
      `).get(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])?.count || 0;

      scores.freshness = Math.min(25, Math.round((lastWeekCount / 7) * 25));

      // 3. 组织度评分 - 基于标签和分类使用
      const taggedCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_sections
        WHERE tags IS NOT NULL AND tags != '[]'
      `).get()?.count || 0;

      const totalSections = this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_sections
      `).get()?.count || 1;

      scores.organization = Math.min(25, Math.round((taggedCount / totalSections) * 25));

      // 4. 利用率评分 - 基于搜索和缓存使用
      const searchStats = await this.getSearchStatistics();
      const totalSearches = (searchStats.total?.hybridSearchCount || 0) +
                           (searchStats.total?.vectorSearchCount || 0) +
                           (searchStats.total?.bm25SearchCount || 0);

      scores.utilization = Math.min(25, Math.round(Math.log10(totalSearches + 1) * 8));

      // 计算总分
      const totalScore = scores.coverage + scores.freshness + scores.organization + scores.utilization;

      // 生成建议
      const suggestions = [];
      if (scores.coverage < 15) {
        suggestions.push("建议每天记录 Daily Notes 以提高覆盖度");
      }
      if (scores.freshness < 15) {
        suggestions.push("最近活动较少，建议保持持续使用");
      }
      if (scores.organization < 15) {
        suggestions.push("建议为记忆添加标签以提高组织度");
      }
      if (scores.utilization < 15) {
        suggestions.push("建议多使用搜索功能以充分利用记忆系统");
      }

      return {
        totalScore,
        maxScore: 100,
        grade: this._getGrade(totalScore),
        breakdown: scores,
        suggestions,
      };
    } catch (error) {
      logger.error("[MemoryAnalytics] 计算健康度失败:", error);
      return {
        totalScore: 0,
        maxScore: 100,
        grade: "N/A",
        breakdown: {},
        suggestions: ["无法计算健康度评分"],
      };
    }
  }

  /**
   * 记录搜索事件
   * @param {string} searchType - 搜索类型 (hybrid, vector, bm25)
   * @param {number} latency - 延迟 (ms)
   * @param {boolean} cacheHit - 是否缓存命中
   */
  async recordSearchEvent(searchType, latency, cacheHit = false) {
    try {
      const today = new Date().toISOString().split("T")[0];

      // 确保今日记录存在
      this.db.prepare(`
        INSERT OR IGNORE INTO memory_stats (date, updated_at)
        VALUES (?, ?)
      `).run(today, Date.now());

      // 更新统计
      const columnMap = {
        hybrid: "hybrid_search_count",
        vector: "vector_search_count",
        bm25: "bm25_search_count",
      };

      const column = columnMap[searchType] || "hybrid_search_count";
      const cacheColumn = cacheHit ? "cache_hits" : "cache_misses";

      this.db.prepare(`
        UPDATE memory_stats
        SET ${column} = ${column} + 1,
            ${cacheColumn} = ${cacheColumn} + 1,
            avg_search_latency = (avg_search_latency * ${column} + ?) / (${column} + 1),
            updated_at = ?
        WHERE date = ?
      `).run(latency, Date.now(), today);
    } catch (error) {
      logger.warn("[MemoryAnalytics] 记录搜索事件失败:", error.message);
    }
  }

  // =============================================
  // 私有方法
  // =============================================

  /**
   * 按周聚合数据
   * @private
   */
  _aggregateByWeek(dailyData) {
    const weeks = {};

    for (const day of dailyData) {
      const date = new Date(day.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split("T")[0];

      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          wordCount: 0,
          conversationCount: 0,
          discoveriesCount: 0,
          completedTasks: 0,
          daysActive: 0,
        };
      }

      weeks[weekKey].wordCount += day.word_count || 0;
      weeks[weekKey].conversationCount += day.conversation_count || 0;
      weeks[weekKey].discoveriesCount += day.discoveries_count || 0;
      weeks[weekKey].completedTasks += day.completed_tasks || 0;
      weeks[weekKey].daysActive += 1;
    }

    return {
      labels: Object.keys(weeks),
      wordCount: Object.values(weeks).map((w) => w.wordCount),
      conversationCount: Object.values(weeks).map((w) => w.conversationCount),
      discoveriesCount: Object.values(weeks).map((w) => w.discoveriesCount),
      completedTasks: Object.values(weeks).map((w) => w.completedTasks),
      daysActive: Object.values(weeks).map((w) => w.daysActive),
    };
  }

  /**
   * 获取等级
   * @private
   */
  _getGrade(score) {
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B+";
    if (score >= 60) return "B";
    if (score >= 50) return "C+";
    if (score >= 40) return "C";
    if (score >= 30) return "D";
    return "F";
  }
}

module.exports = {
  MemoryAnalytics,
};
