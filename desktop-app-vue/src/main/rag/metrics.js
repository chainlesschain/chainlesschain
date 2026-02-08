/**
 * RAG性能监控模块
 * 用于跟踪和分析RAG系统的性能指标
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * 性能指标类型
 */
const MetricTypes = {
  RETRIEVAL: "retrieval", // 检索延迟
  RERANK: "rerank", // 重排序延迟
  EMBEDDING: "embedding", // 嵌入生成延迟
  QUERY_REWRITE: "query_rewrite", // 查询重写延迟
  TOTAL: "total", // 总延迟
  CACHE_HIT: "cache_hit", // 缓存命中
  CACHE_MISS: "cache_miss", // 缓存未命中
};

/**
 * 性能监控类
 */
class RAGMetrics extends EventEmitter {
  constructor() {
    super();

    // 指标存储
    this.metrics = {
      retrieval: [],
      rerank: [],
      embedding: [],
      queryRewrite: [],
      total: [],
    };

    // 统计数据
    this.stats = {
      totalQueries: 0,
      totalRetrievals: 0,
      totalReranks: 0,
      totalEmbeddings: 0,
      totalQueryRewrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    };

    // 滑动窗口大小（保留最近N条记录）
    this.windowSize = 1000;

    // 开始时间
    this.startTime = Date.now();
  }

  /**
   * 记录指标
   * @param {string} type - 指标类型
   * @param {number} value - 指标值（毫秒）
   * @param {Object} metadata - 额外元数据
   */
  record(type, value, metadata = {}) {
    const record = {
      type,
      value,
      timestamp: Date.now(),
      ...metadata,
    };

    // 根据类型存储
    const metricKey = this._getMetricKey(type);
    if (metricKey && this.metrics[metricKey]) {
      this.metrics[metricKey].push(record);

      // 限制窗口大小
      if (this.metrics[metricKey].length > this.windowSize) {
        this.metrics[metricKey].shift();
      }
    }

    // 更新统计
    this._updateStats(type, value);

    // 触发事件
    this.emit("metric-recorded", record);

    // 检查性能告警
    this._checkAlerts(type, value);
  }

  /**
   * 创建计时器
   * @param {string} type - 指标类型
   * @returns {Function} 停止计时函数
   */
  startTimer(type) {
    const startTime = Date.now();

    return (metadata = {}) => {
      const duration = Date.now() - startTime;
      this.record(type, duration, metadata);
      return duration;
    };
  }

  /**
   * 记录缓存命中
   */
  recordCacheHit() {
    this.stats.cacheHits++;
    this.emit("cache-hit");
  }

  /**
   * 记录缓存未命中
   */
  recordCacheMiss() {
    this.stats.cacheMisses++;
    this.emit("cache-miss");
  }

  /**
   * 记录错误
   * @param {string} type - 错误类型
   * @param {Error} error - 错误对象
   */
  recordError(type, error) {
    this.stats.errors++;

    this.emit("error", {
      type,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取性能统计
   * @param {string} type - 指标类型（可选）
   * @returns {Object} 统计信息
   */
  getStats(type = null) {
    if (type) {
      const metricKey = this._getMetricKey(type);
      if (!metricKey || !this.metrics[metricKey]) {
        return null;
      }

      return this._calculateStats(this.metrics[metricKey]);
    }

    // 返回所有统计
    const allStats = {
      overall: { ...this.stats },
      uptime: Date.now() - this.startTime,
      cacheHitRate: this._calculateHitRate(),
    };

    // 各类型详细统计
    for (const [key, records] of Object.entries(this.metrics)) {
      if (records.length > 0) {
        allStats[key] = this._calculateStats(records);
      }
    }

    return allStats;
  }

  /**
   * 计算统计信息
   * @private
   */
  _calculateStats(records) {
    if (records.length === 0) {
      return {
        count: 0,
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const values = records.map((r) => r.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: this._percentile(values, 0.5),
      p95: this._percentile(values, 0.95),
      p99: this._percentile(values, 0.99),
    };
  }

  /**
   * 计算百分位数
   * @private
   */
  _percentile(sortedValues, percentile) {
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * 计算缓存命中率
   * @private
   */
  _calculateHitRate() {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return total > 0 ? this.stats.cacheHits / total : 0;
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats(type, value) {
    switch (type) {
      case MetricTypes.RETRIEVAL:
        this.stats.totalRetrievals++;
        break;
      case MetricTypes.RERANK:
        this.stats.totalReranks++;
        break;
      case MetricTypes.EMBEDDING:
        this.stats.totalEmbeddings++;
        break;
      case MetricTypes.QUERY_REWRITE:
        this.stats.totalQueryRewrites++;
        break;
      case MetricTypes.TOTAL:
        this.stats.totalQueries++;
        break;
    }
  }

  /**
   * 获取指标键名
   * @private
   */
  _getMetricKey(type) {
    const keyMap = {
      [MetricTypes.RETRIEVAL]: "retrieval",
      [MetricTypes.RERANK]: "rerank",
      [MetricTypes.EMBEDDING]: "embedding",
      [MetricTypes.QUERY_REWRITE]: "queryRewrite",
      [MetricTypes.TOTAL]: "total",
    };

    return keyMap[type];
  }

  /**
   * 检查性能告警
   * @private
   */
  _checkAlerts(type, value) {
    // 延迟阈值（毫秒）
    const thresholds = {
      [MetricTypes.RETRIEVAL]: 500, // 检索>500ms告警
      [MetricTypes.RERANK]: 3000, // 重排序>3s告警
      [MetricTypes.EMBEDDING]: 200, // 嵌入>200ms告警
      [MetricTypes.QUERY_REWRITE]: 2000, // 查询重写>2s告警
      [MetricTypes.TOTAL]: 5000, // 总延迟>5s告警
    };

    const threshold = thresholds[type];
    if (threshold && value > threshold) {
      this.emit("alert", {
        type,
        value,
        threshold,
        message: `${type}延迟过高: ${value}ms (阈值: ${threshold}ms)`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 获取实时性能概览
   */
  getRealTimeOverview() {
    const now = Date.now();
    const recentWindow = 60000; // 最近1分钟

    const getRecentAvg = (records) => {
      const recent = records.filter((r) => now - r.timestamp < recentWindow);
      if (recent.length === 0) {
        return 0;
      }
      const sum = recent.reduce((acc, r) => acc + r.value, 0);
      return sum / recent.length;
    };

    return {
      timestamp: now,
      uptime: now - this.startTime,
      queries: {
        total: this.stats.totalQueries,
        recentAvgLatency: getRecentAvg(this.metrics.total),
      },
      cache: {
        hitRate: this._calculateHitRate(),
        hits: this.stats.cacheHits,
        misses: this.stats.cacheMisses,
      },
      retrieval: {
        total: this.stats.totalRetrievals,
        recentAvgLatency: getRecentAvg(this.metrics.retrieval),
      },
      rerank: {
        total: this.stats.totalReranks,
        recentAvgLatency: getRecentAvg(this.metrics.rerank),
      },
      embedding: {
        total: this.stats.totalEmbeddings,
        recentAvgLatency: getRecentAvg(this.metrics.embedding),
      },
      errors: this.stats.errors,
    };
  }

  /**
   * 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）
   */
  getPerformanceReport(timeRange = 3600000) {
    const now = Date.now();
    const cutoff = now - timeRange;

    const filterRecent = (records) => {
      return records.filter((r) => r.timestamp >= cutoff);
    };

    const report = {
      timeRange: timeRange,
      startTime: cutoff,
      endTime: now,
      summary: {},
    };

    // 生成各类型报告
    for (const [key, records] of Object.entries(this.metrics)) {
      const recentRecords = filterRecent(records);
      if (recentRecords.length > 0) {
        report.summary[key] = this._calculateStats(recentRecords);
      }
    }

    // 添加缓存统计
    report.cache = {
      hitRate: this._calculateHitRate(),
      hits: this.stats.cacheHits,
      misses: this.stats.cacheMisses,
    };

    // 添加错误统计
    report.errors = this.stats.errors;

    return report;
  }

  /**
   * 导出指标数据
   * @returns {Object} 指标数据
   */
  exportMetrics() {
    return {
      metrics: this.metrics,
      stats: this.stats,
      startTime: this.startTime,
      exportTime: Date.now(),
    };
  }

  /**
   * 重置所有指标
   */
  reset() {
    this.metrics = {
      retrieval: [],
      rerank: [],
      embedding: [],
      queryRewrite: [],
      total: [],
    };

    this.stats = {
      totalQueries: 0,
      totalRetrievals: 0,
      totalReranks: 0,
      totalEmbeddings: 0,
      totalQueryRewrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    };

    this.startTime = Date.now();

    this.emit("reset");
    logger.info("[RAGMetrics] 指标已重置");
  }

  /**
   * 清理旧数据
   * @param {number} maxAge - 最大年龄（毫秒）
   */
  cleanOldMetrics(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;

    for (const [key, records] of Object.entries(this.metrics)) {
      this.metrics[key] = records.filter((r) => r.timestamp >= cutoff);
    }

    this.emit("cleaned", { cutoff, remaining: this._countTotalRecords() });
  }

  /**
   * 统计总记录数
   * @private
   */
  _countTotalRecords() {
    let count = 0;
    for (const records of Object.values(this.metrics)) {
      count += records.length;
    }
    return count;
  }
}

// 全局单例
let globalMetrics = null;

/**
 * 获取全局指标实例
 */
function getGlobalMetrics() {
  if (!globalMetrics) {
    globalMetrics = new RAGMetrics();
  }
  return globalMetrics;
}

module.exports = {
  RAGMetrics,
  MetricTypes,
  getGlobalMetrics,
};
