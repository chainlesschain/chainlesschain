/**
 * ComputerUseMetrics - 性能和使用统计
 *
 * 收集 Computer Use 操作的指标：
 * - 操作成功率
 * - 执行时间
 * - 资源使用
 * - 错误分析
 *
 * @module browser/actions/computer-use-metrics
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * 时间范围
 */
const TimeRange = {
  HOUR: 'hour',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  ALL: 'all'
};

/**
 * 指标类型
 */
const MetricType = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  SUMMARY: 'summary'
};

class ComputerUseMetrics extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      persistMetrics: config.persistMetrics || false,
      metricsDir: config.metricsDir || path.join(process.cwd(), '.chainlesschain', 'metrics'),
      flushInterval: config.flushInterval || 60000, // 1分钟
      retentionDays: config.retentionDays || 30,
      histogramBuckets: config.histogramBuckets || [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      ...config
    };

    // 操作计数器
    this.counters = new Map();

    // 仪表值
    this.gauges = new Map();

    // 直方图
    this.histograms = new Map();

    // 操作记录（用于计算汇总）
    this.operationLog = [];
    this.maxLogSize = 10000;

    // 会话统计
    this.sessionStats = {
      startTime: Date.now(),
      operations: 0,
      successes: 0,
      failures: 0,
      totalDuration: 0
    };

    // 按类型统计
    this.typeStats = new Map();

    // 错误统计
    this.errorStats = new Map();

    // 初始化
    this._initMetrics();

    // 定期刷新
    if (this.config.persistMetrics && this.config.flushInterval > 0) {
      this._startFlushInterval();
    }
  }

  /**
   * 初始化指标
   * @private
   */
  _initMetrics() {
    // 预定义计数器
    this._createCounter('operations_total', '总操作数');
    this._createCounter('operations_success', '成功操作数');
    this._createCounter('operations_failure', '失败操作数');
    this._createCounter('screenshots_taken', '截图次数');
    this._createCounter('elements_located', '元素定位次数');
    this._createCounter('vision_requests', 'Vision AI 请求次数');

    // 预定义仪表
    this._createGauge('active_recordings', '活跃录制数');
    this._createGauge('pending_confirmations', '待确认操作数');
    this._createGauge('workflow_running', '运行中的工作流');

    // 预定义直方图
    this._createHistogram('operation_duration_ms', '操作执行时间');
    this._createHistogram('screenshot_size_bytes', '截图大小');
    this._createHistogram('element_locate_time_ms', '元素定位时间');
  }

  /**
   * 创建计数器
   * @private
   */
  _createCounter(name, description) {
    this.counters.set(name, {
      name,
      description,
      type: MetricType.COUNTER,
      value: 0,
      labels: {}
    });
  }

  /**
   * 创建仪表
   * @private
   */
  _createGauge(name, description) {
    this.gauges.set(name, {
      name,
      description,
      type: MetricType.GAUGE,
      value: 0
    });
  }

  /**
   * 创建直方图
   * @private
   */
  _createHistogram(name, description) {
    const buckets = {};
    for (const bucket of this.config.histogramBuckets) {
      buckets[bucket] = 0;
    }
    buckets['+Inf'] = 0;

    this.histograms.set(name, {
      name,
      description,
      type: MetricType.HISTOGRAM,
      buckets,
      sum: 0,
      count: 0
    });
  }

  /**
   * 记录操作
   * @param {Object} operation - 操作信息
   */
  recordOperation(operation) {
    if (!this.config.enabled) return;

    const {
      type,
      action,
      success,
      duration,
      error,
      metadata = {}
    } = operation;

    const timestamp = Date.now();

    // 更新计数器
    this._incrementCounter('operations_total');
    if (success) {
      this._incrementCounter('operations_success');
    } else {
      this._incrementCounter('operations_failure');
    }

    // 更新直方图
    if (duration !== undefined) {
      this._observeHistogram('operation_duration_ms', duration);
    }

    // 更新会话统计
    this.sessionStats.operations++;
    if (success) {
      this.sessionStats.successes++;
    } else {
      this.sessionStats.failures++;
    }
    if (duration) {
      this.sessionStats.totalDuration += duration;
    }

    // 更新类型统计
    const typeKey = `${type}:${action}`;
    if (!this.typeStats.has(typeKey)) {
      this.typeStats.set(typeKey, {
        type,
        action,
        count: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0
      });
    }

    const typeData = this.typeStats.get(typeKey);
    typeData.count++;
    if (success) {
      typeData.successes++;
    } else {
      typeData.failures++;
    }
    if (duration !== undefined) {
      typeData.totalDuration += duration;
      typeData.minDuration = Math.min(typeData.minDuration, duration);
      typeData.maxDuration = Math.max(typeData.maxDuration, duration);
    }

    // 记录错误
    if (!success && error) {
      const errorKey = this._normalizeError(error);
      if (!this.errorStats.has(errorKey)) {
        this.errorStats.set(errorKey, {
          message: errorKey,
          count: 0,
          lastOccurred: null,
          types: new Set()
        });
      }
      const errorData = this.errorStats.get(errorKey);
      errorData.count++;
      errorData.lastOccurred = timestamp;
      errorData.types.add(type);
    }

    // 添加到操作日志
    this.operationLog.push({
      timestamp,
      type,
      action,
      success,
      duration,
      error: error ? this._normalizeError(error) : null,
      metadata
    });

    // 限制日志大小
    if (this.operationLog.length > this.maxLogSize) {
      this.operationLog = this.operationLog.slice(-this.maxLogSize / 2);
    }

    this.emit('operationRecorded', {
      type,
      action,
      success,
      duration
    });
  }

  /**
   * 增加计数器
   * @private
   */
  _incrementCounter(name, value = 1, labels = {}) {
    const counter = this.counters.get(name);
    if (counter) {
      counter.value += value;
    }
  }

  /**
   * 设置仪表值
   * @param {string} name - 仪表名称
   * @param {number} value - 值
   */
  setGauge(name, value) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value = value;
    }
  }

  /**
   * 增加仪表值
   * @param {string} name - 仪表名称
   * @param {number} delta - 增量
   */
  incrementGauge(name, delta = 1) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value += delta;
    }
  }

  /**
   * 减少仪表值
   * @param {string} name - 仪表名称
   * @param {number} delta - 减量
   */
  decrementGauge(name, delta = 1) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value -= delta;
    }
  }

  /**
   * 观测直方图值
   * @private
   */
  _observeHistogram(name, value) {
    const histogram = this.histograms.get(name);
    if (!histogram) return;

    histogram.sum += value;
    histogram.count++;

    for (const bucket of this.config.histogramBuckets) {
      if (value <= bucket) {
        histogram.buckets[bucket]++;
      }
    }
    histogram.buckets['+Inf']++;
  }

  /**
   * 规范化错误消息
   * @private
   */
  _normalizeError(error) {
    if (typeof error !== 'string') {
      error = error.message || String(error);
    }

    // 移除变量部分，保留错误模式
    return error
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8,}/gi, 'ID')
      .replace(/"[^"]+"/g, '"..."')
      .substring(0, 100);
  }

  /**
   * 获取会话统计
   * @returns {Object}
   */
  getSessionStats() {
    const uptime = Date.now() - this.sessionStats.startTime;
    const successRate = this.sessionStats.operations > 0
      ? (this.sessionStats.successes / this.sessionStats.operations * 100).toFixed(2)
      : 0;
    const avgDuration = this.sessionStats.operations > 0
      ? (this.sessionStats.totalDuration / this.sessionStats.operations).toFixed(2)
      : 0;

    return {
      uptime,
      uptimeFormatted: this._formatDuration(uptime),
      operations: this.sessionStats.operations,
      successes: this.sessionStats.successes,
      failures: this.sessionStats.failures,
      successRate: parseFloat(successRate),
      avgDuration: parseFloat(avgDuration),
      totalDuration: this.sessionStats.totalDuration
    };
  }

  /**
   * 获取类型统计
   * @returns {Array}
   */
  getTypeStats() {
    return Array.from(this.typeStats.values()).map(stat => ({
      ...stat,
      successRate: stat.count > 0
        ? parseFloat((stat.successes / stat.count * 100).toFixed(2))
        : 0,
      avgDuration: stat.count > 0
        ? parseFloat((stat.totalDuration / stat.count).toFixed(2))
        : 0,
      minDuration: stat.minDuration === Infinity ? 0 : stat.minDuration,
      maxDuration: stat.maxDuration
    })).sort((a, b) => b.count - a.count);
  }

  /**
   * 获取错误统计
   * @returns {Array}
   */
  getErrorStats() {
    return Array.from(this.errorStats.values())
      .map(stat => ({
        message: stat.message,
        count: stat.count,
        lastOccurred: stat.lastOccurred,
        types: Array.from(stat.types)
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 获取时间序列数据
   * @param {string} range - 时间范围
   * @param {string} metric - 指标名称
   * @returns {Array}
   */
  getTimeSeries(range = TimeRange.HOUR, metric = 'operations') {
    const now = Date.now();
    let startTime;
    let bucketSize;

    switch (range) {
      case TimeRange.HOUR:
        startTime = now - 3600000;
        bucketSize = 60000; // 1分钟
        break;
      case TimeRange.DAY:
        startTime = now - 86400000;
        bucketSize = 3600000; // 1小时
        break;
      case TimeRange.WEEK:
        startTime = now - 604800000;
        bucketSize = 86400000; // 1天
        break;
      case TimeRange.MONTH:
        startTime = now - 2592000000;
        bucketSize = 86400000; // 1天
        break;
      default:
        startTime = this.sessionStats.startTime;
        bucketSize = (now - startTime) / 24 || 3600000;
    }

    // 过滤相关操作日志
    const relevantLogs = this.operationLog.filter(log => log.timestamp >= startTime);

    // 分桶统计
    const buckets = new Map();

    for (const log of relevantLogs) {
      const bucketKey = Math.floor(log.timestamp / bucketSize) * bucketSize;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          timestamp: bucketKey,
          operations: 0,
          successes: 0,
          failures: 0,
          totalDuration: 0
        });
      }

      const bucket = buckets.get(bucketKey);
      bucket.operations++;
      if (log.success) {
        bucket.successes++;
      } else {
        bucket.failures++;
      }
      if (log.duration) {
        bucket.totalDuration += log.duration;
      }
    }

    // 填充空桶
    const series = [];
    for (let t = startTime; t <= now; t += bucketSize) {
      const bucketKey = Math.floor(t / bucketSize) * bucketSize;
      const bucket = buckets.get(bucketKey) || {
        timestamp: bucketKey,
        operations: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0
      };

      series.push({
        timestamp: bucket.timestamp,
        time: new Date(bucket.timestamp).toISOString(),
        [metric]: bucket[metric] || bucket.operations,
        successRate: bucket.operations > 0
          ? parseFloat((bucket.successes / bucket.operations * 100).toFixed(2))
          : 0
      });
    }

    return series;
  }

  /**
   * 获取所有指标
   * @returns {Object}
   */
  getAllMetrics() {
    const counters = {};
    for (const [name, counter] of this.counters) {
      counters[name] = counter.value;
    }

    const gauges = {};
    for (const [name, gauge] of this.gauges) {
      gauges[name] = gauge.value;
    }

    const histograms = {};
    for (const [name, histogram] of this.histograms) {
      histograms[name] = {
        sum: histogram.sum,
        count: histogram.count,
        avg: histogram.count > 0 ? histogram.sum / histogram.count : 0,
        buckets: histogram.buckets
      };
    }

    return {
      counters,
      gauges,
      histograms,
      session: this.getSessionStats(),
      typeStats: this.getTypeStats(),
      errorStats: this.getErrorStats()
    };
  }

  /**
   * 获取摘要报告
   * @returns {Object}
   */
  getSummary() {
    const session = this.getSessionStats();
    const types = this.getTypeStats();
    const errors = this.getErrorStats();

    // 找出最慢的操作
    const slowestOps = types
      .filter(t => t.count > 0)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 5);

    // 找出最常失败的操作
    const mostFailed = types
      .filter(t => t.failures > 0)
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 5);

    return {
      overview: {
        totalOperations: session.operations,
        successRate: session.successRate,
        avgDuration: session.avgDuration,
        uptime: session.uptimeFormatted
      },
      topOperations: types.slice(0, 10),
      slowestOperations: slowestOps,
      mostFailedOperations: mostFailed,
      topErrors: errors.slice(0, 5)
    };
  }

  /**
   * 格式化持续时间
   * @private
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * 开始定期刷新
   * @private
   */
  _startFlushInterval() {
    this.flushTimer = setInterval(() => {
      this._flushMetrics().catch(err => {
        this.emit('error', { error: err.message });
      });
    }, this.config.flushInterval);
  }

  /**
   * 刷新指标到文件
   * @private
   */
  async _flushMetrics() {
    if (!this.config.persistMetrics) return;

    await fs.mkdir(this.config.metricsDir, { recursive: true });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `metrics-${timestamp}.json`;
    const filepath = path.join(this.config.metricsDir, filename);

    const metrics = this.getAllMetrics();
    metrics.timestamp = new Date().toISOString();

    await fs.writeFile(filepath, JSON.stringify(metrics, null, 2));
  }

  /**
   * 重置统计
   */
  reset() {
    this.sessionStats = {
      startTime: Date.now(),
      operations: 0,
      successes: 0,
      failures: 0,
      totalDuration: 0
    };

    this.typeStats.clear();
    this.errorStats.clear();
    this.operationLog = [];

    for (const counter of this.counters.values()) {
      counter.value = 0;
    }

    for (const histogram of this.histograms.values()) {
      histogram.sum = 0;
      histogram.count = 0;
      for (const bucket of Object.keys(histogram.buckets)) {
        histogram.buckets[bucket] = 0;
      }
    }

    this.emit('reset');
  }

  /**
   * 停止指标收集
   */
  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// 单例
let metricsInstance = null;

function getComputerUseMetrics(config) {
  if (!metricsInstance) {
    metricsInstance = new ComputerUseMetrics(config);
  }
  return metricsInstance;
}

module.exports = {
  ComputerUseMetrics,
  TimeRange,
  MetricType,
  getComputerUseMetrics
};
