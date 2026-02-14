/**
 * 远程命令日志与统计系统
 *
 * 整合 CommandLogger 和 StatisticsCollector，提供统一的接口
 *
 * @module remote/logging
 */

const { CommandLogger, LogLevel } = require('./command-logger');
const { StatisticsCollector, TimePeriod } = require('./statistics-collector');
const { logger } = require('../../utils/logger');

/**
 * 日志与统计管理器
 */
class LoggingManager {
  constructor(database, options = {}) {
    this.database = database;
    this.options = options;

    // 创建 CommandLogger（过滤 undefined 值，避免覆盖子模块默认配置）
    const loggerOpts = {
      enableAutoCleanup: options.enableAutoCleanup !== false
    };
    if (options.maxLogAge != null) loggerOpts.maxLogAge = options.maxLogAge;
    if (options.maxLogCount != null) loggerOpts.maxLogCount = options.maxLogCount;
    if (options.autoCleanupInterval != null) loggerOpts.autoCleanupInterval = options.autoCleanupInterval;
    this.commandLogger = new CommandLogger(database, loggerOpts);

    // 创建 StatisticsCollector（过滤 undefined 值，避免覆盖子模块默认配置）
    const statsOpts = {
      enableRealTimeStats: options.enableRealTimeStats !== false,
      enablePersistentStats: options.enablePersistentStats !== false
    };
    if (options.statsAggregationInterval != null) statsOpts.statsAggregationInterval = options.statsAggregationInterval;
    if (options.maxStatsAge != null) statsOpts.maxStatsAge = options.maxStatsAge;
    this.statisticsCollector = new StatisticsCollector(database, statsOpts);

    // 监听日志事件，自动更新统计
    this.commandLogger.on('log', (logEntry) => {
      this.statisticsCollector.record({
        deviceDid: logEntry.deviceDid,
        namespace: logEntry.namespace,
        action: logEntry.action,
        status: logEntry.status,
        duration: logEntry.duration,
        timestamp: logEntry.timestamp
      });
    });

    // 监听统计更新事件
    this.statisticsCollector.on('stats-updated', (stats) => {
      // 可以在这里添加其他逻辑，比如通知 UI
    });

    logger.info('[LoggingManager] 日志与统计管理器已初始化');
  }

  /**
   * 记录命令执行日志
   *
   * @param {Object} logEntry - 日志条目
   * @returns {number} 日志 ID
   */
  log(logEntry) {
    return this.commandLogger.log(logEntry);
  }

  /**
   * 记录成功的命令
   */
  logSuccess(logEntry) {
    return this.commandLogger.logSuccess(logEntry);
  }

  /**
   * 记录失败的命令
   */
  logFailure(logEntry) {
    return this.commandLogger.logFailure(logEntry);
  }

  /**
   * 记录警告
   */
  logWarning(logEntry) {
    return this.commandLogger.logWarning(logEntry);
  }

  /**
   * 查询日志
   */
  queryLogs(options) {
    return this.commandLogger.query(options);
  }

  /**
   * 获取日志详情
   */
  getLogById(id) {
    return this.commandLogger.getLogById(id);
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(limit) {
    return this.commandLogger.getRecentLogs(limit);
  }

  /**
   * 获取设备的日志
   */
  getLogsByDevice(deviceDid, limit, offset) {
    return this.commandLogger.getLogsByDevice(deviceDid, limit, offset);
  }

  /**
   * 获取失败的日志
   */
  getFailureLogs(limit, offset) {
    return this.commandLogger.getFailureLogs(limit, offset);
  }

  /**
   * 获取日志统计
   */
  getLogStats(options) {
    return this.commandLogger.getStats(options);
  }

  /**
   * 导出日志
   */
  exportLogs(options) {
    return this.commandLogger.exportLogs(options);
  }

  /**
   * 清理旧日志
   */
  cleanupLogs() {
    return this.commandLogger.cleanup();
  }

  /**
   * 获取实时统计
   */
  getRealTimeStats() {
    return this.statisticsCollector.getRealTimeStats();
  }

  /**
   * 查询统计数据
   */
  queryStats(options) {
    return this.statisticsCollector.queryStats(options);
  }

  /**
   * 获取设备活跃度
   */
  getDeviceActivity(days) {
    return this.statisticsCollector.getDeviceActivity(days);
  }

  /**
   * 获取命令排行
   */
  getCommandRanking(limit) {
    return this.statisticsCollector.getCommandRanking(limit);
  }

  /**
   * 获取趋势数据
   */
  getTrend(periodType, days) {
    return this.statisticsCollector.getTrend(periodType, days);
  }

  /**
   * 聚合统计数据
   */
  async aggregateStats() {
    return await this.statisticsCollector.aggregate();
  }

  /**
   * 清理旧统计数据
   */
  cleanupStats() {
    return this.statisticsCollector.cleanup();
  }

  /**
   * 重置实时统计
   */
  resetRealTimeStats() {
    return this.statisticsCollector.resetRealTimeStats();
  }

  /**
   * 获取综合仪表板数据
   */
  getDashboard(options = {}) {
    const { days = 7 } = options;

    try {
      return {
        realTime: this.getRealTimeStats(),
        logStats: this.getLogStats({
          startTime: Date.now() - days * 24 * 60 * 60 * 1000
        }),
        deviceActivity: this.getDeviceActivity(days),
        commandRanking: this.getCommandRanking(10),
        trend: this.getTrend(TimePeriod.DAY, days),
        recentLogs: this.getRecentLogs(20)
      };
    } catch (error) {
      logger.error('[LoggingManager] 获取仪表板数据失败:', error);
      throw error;
    }
  }

  /**
   * 销毁
   */
  destroy() {
    this.commandLogger.destroy();
    this.statisticsCollector.destroy();
    logger.info('[LoggingManager] 日志与统计管理器已销毁');
  }
}

// 导出
module.exports = {
  LoggingManager,
  CommandLogger,
  StatisticsCollector,
  LogLevel,
  TimePeriod
};
