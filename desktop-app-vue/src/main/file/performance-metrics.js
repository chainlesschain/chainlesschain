/**
 * 性能指标收集器
 *
 * 职责：
 * - 收集运行时性能数据
 * - 计算平均值和统计数据
 * - 提供性能报告
 */

const { logger } = require('../utils/logger.js');

/**
 * 性能指标收集器类
 */
class PerformanceMetrics {
  constructor() {
    // 初始化指标
    this.metrics = {
      // 索引同步指标
      syncCount: 0,
      syncTotalDuration: 0,
      syncTotalFiles: 0,
      syncErrors: 0,
      lastSyncTime: null,

      // 文件传输指标
      transferCount: 0,
      transferTotalBytes: 0,
      transferTotalDuration: 0,
      transferErrors: 0,
      activeTransfers: 0,

      // 缓存指标
      cacheHits: 0,
      cacheMisses: 0,
      cacheEvictions: 0,
      totalCacheSize: 0,

      // 数据库指标
      dbQueryCount: 0,
      dbQueryTotalDuration: 0,

      // 错误指标
      totalErrors: 0,
      errorTypes: {},

      // 时间戳
      startTime: Date.now(),
      lastResetTime: Date.now(),
    };

    // 详细的传输记录（保留最近100条）
    this.recentTransfers = [];
    this.maxRecentTransfers = 100;

    // 详细的同步记录（保留最近50条）
    this.recentSyncs = [];
    this.maxRecentSyncs = 50;
  }

  /**
   * 记录索引同步
   * @param {number} duration - 同步耗时（毫秒）
   * @param {number} fileCount - 同步文件数量
   * @param {string} deviceId - 设备ID
   */
  recordSync(duration, fileCount, deviceId) {
    this.metrics.syncCount++;
    this.metrics.syncTotalDuration += duration;
    this.metrics.syncTotalFiles += fileCount;
    this.metrics.lastSyncTime = Date.now();

    // 记录详细信息
    this.recentSyncs.unshift({
      timestamp: Date.now(),
      duration,
      fileCount,
      deviceId,
      filesPerSecond: fileCount / (duration / 1000),
    });

    // 保持最近记录数量限制
    if (this.recentSyncs.length > this.maxRecentSyncs) {
      this.recentSyncs.pop();
    }

    logger.debug('[PerformanceMetrics] 记录同步:', {
      duration,
      fileCount,
      avgDuration: this.getAvgSyncDuration(),
    });
  }

  /**
   * 记录同步错误
   */
  recordSyncError(error) {
    this.metrics.syncErrors++;
    this.recordError('sync', error);
  }

  /**
   * 记录文件传输
   * @param {number} duration - 传输耗时（毫秒）
   * @param {number} bytes - 传输字节数
   * @param {string} fileId - 文件ID
   */
  recordTransfer(duration, bytes, fileId) {
    this.metrics.transferCount++;
    this.metrics.transferTotalBytes += bytes;
    this.metrics.transferTotalDuration += duration;

    // 记录详细信息
    const speedMBps = (bytes / 1024 / 1024) / (duration / 1000);

    this.recentTransfers.unshift({
      timestamp: Date.now(),
      duration,
      bytes,
      fileId,
      speedMBps,
    });

    // 保持最近记录数量限制
    if (this.recentTransfers.length > this.maxRecentTransfers) {
      this.recentTransfers.pop();
    }

    logger.debug('[PerformanceMetrics] 记录传输:', {
      bytes,
      duration,
      speedMBps: speedMBps.toFixed(2),
    });
  }

  /**
   * 记录传输错误
   */
  recordTransferError(error) {
    this.metrics.transferErrors++;
    this.recordError('transfer', error);
  }

  /**
   * 增加活跃传输计数
   */
  incrementActiveTransfers() {
    this.metrics.activeTransfers++;
  }

  /**
   * 减少活跃传输计数
   */
  decrementActiveTransfers() {
    this.metrics.activeTransfers = Math.max(0, this.metrics.activeTransfers - 1);
  }

  /**
   * 记录缓存命中
   */
  recordCacheHit() {
    this.metrics.cacheHits++;
  }

  /**
   * 记录缓存未命中
   */
  recordCacheMiss() {
    this.metrics.cacheMisses++;
  }

  /**
   * 记录缓存淘汰
   * @param {number} count - 淘汰的文件数量
   * @param {number} freedBytes - 释放的字节数
   */
  recordCacheEviction(count, freedBytes) {
    this.metrics.cacheEvictions += count;
    this.metrics.totalCacheSize -= freedBytes;

    logger.info('[PerformanceMetrics] 缓存淘汰:', {
      count,
      freedMB: (freedBytes / 1024 / 1024).toFixed(2),
    });
  }

  /**
   * 更新缓存大小
   * @param {number} size - 当前缓存总大小（字节）
   */
  updateCacheSize(size) {
    this.metrics.totalCacheSize = size;
  }

  /**
   * 记录数据库查询
   * @param {number} duration - 查询耗时（毫秒）
   */
  recordDbQuery(duration) {
    this.metrics.dbQueryCount++;
    this.metrics.dbQueryTotalDuration += duration;
  }

  /**
   * 记录错误
   * @param {string} type - 错误类型
   * @param {Error} error - 错误对象
   */
  recordError(type, error) {
    this.metrics.totalErrors++;

    if (!this.metrics.errorTypes[type]) {
      this.metrics.errorTypes[type] = 0;
    }
    this.metrics.errorTypes[type]++;

    logger.warn('[PerformanceMetrics] 记录错误:', {
      type,
      message: error?.message,
    });
  }

  /**
   * 获取平均同步耗时
   * @returns {number} 平均耗时（毫秒）
   */
  getAvgSyncDuration() {
    return this.metrics.syncCount > 0
      ? this.metrics.syncTotalDuration / this.metrics.syncCount
      : 0;
  }

  /**
   * 获取平均传输速度
   * @returns {number} 平均速度（MB/s）
   */
  getAvgTransferSpeed() {
    if (this.metrics.transferTotalDuration === 0) {
      return 0;
    }

    const totalMB = this.metrics.transferTotalBytes / 1024 / 1024;
    const totalSeconds = this.metrics.transferTotalDuration / 1000;

    return totalMB / totalSeconds;
  }

  /**
   * 获取缓存命中率
   * @returns {number} 命中率（0-1）
   */
  getCacheHitRate() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? this.metrics.cacheHits / total : 0;
  }

  /**
   * 获取平均数据库查询时间
   * @returns {number} 平均耗时（毫秒）
   */
  getAvgDbQueryDuration() {
    return this.metrics.dbQueryCount > 0
      ? this.metrics.dbQueryTotalDuration / this.metrics.dbQueryCount
      : 0;
  }

  /**
   * 获取运行时长
   * @returns {number} 运行时长（毫秒）
   */
  getUptime() {
    return Date.now() - this.metrics.startTime;
  }

  /**
   * 获取完整统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const uptime = this.getUptime();
    const uptimeSeconds = uptime / 1000;

    return {
      // 原始指标
      ...this.metrics,

      // 计算指标
      avgSyncDuration: this.getAvgSyncDuration(),
      avgSyncFileCount: this.metrics.syncCount > 0
        ? this.metrics.syncTotalFiles / this.metrics.syncCount
        : 0,
      avgTransferSpeed: this.getAvgTransferSpeed(),
      cacheHitRate: this.getCacheHitRate(),
      avgDbQueryDuration: this.getAvgDbQueryDuration(),

      // 速率指标
      syncsPerMinute: (this.metrics.syncCount / uptimeSeconds) * 60,
      transfersPerMinute: (this.metrics.transferCount / uptimeSeconds) * 60,

      // 系统状态
      uptime,
      uptimeHours: (uptime / 1000 / 60 / 60).toFixed(2),

      // 健康度指标
      errorRate: this.metrics.syncCount + this.metrics.transferCount > 0
        ? this.metrics.totalErrors / (this.metrics.syncCount + this.metrics.transferCount)
        : 0,
      syncSuccessRate: this.metrics.syncCount > 0
        ? 1 - (this.metrics.syncErrors / this.metrics.syncCount)
        : 1,
      transferSuccessRate: this.metrics.transferCount > 0
        ? 1 - (this.metrics.transferErrors / this.metrics.transferCount)
        : 1,
    };
  }

  /**
   * 获取最近的传输记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 传输记录
   */
  getRecentTransfers(limit = 10) {
    return this.recentTransfers.slice(0, limit);
  }

  /**
   * 获取最近的同步记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 同步记录
   */
  getRecentSyncs(limit = 10) {
    return this.recentSyncs.slice(0, limit);
  }

  /**
   * 重置统计信息
   */
  reset() {
    const startTime = this.metrics.startTime;

    this.metrics = {
      syncCount: 0,
      syncTotalDuration: 0,
      syncTotalFiles: 0,
      syncErrors: 0,
      lastSyncTime: null,
      transferCount: 0,
      transferTotalBytes: 0,
      transferTotalDuration: 0,
      transferErrors: 0,
      activeTransfers: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheEvictions: 0,
      totalCacheSize: 0,
      dbQueryCount: 0,
      dbQueryTotalDuration: 0,
      totalErrors: 0,
      errorTypes: {},
      startTime,
      lastResetTime: Date.now(),
    };

    this.recentTransfers = [];
    this.recentSyncs = [];

    logger.info('[PerformanceMetrics] 统计信息已重置');
  }

  /**
   * 导出统计信息为JSON
   * @returns {string} JSON字符串
   */
  exportToJSON() {
    return JSON.stringify({
      stats: this.getStats(),
      recentTransfers: this.recentTransfers,
      recentSyncs: this.recentSyncs,
      exportTime: Date.now(),
    }, null, 2);
  }

  /**
   * 生成性能报告
   * @returns {string} 性能报告文本
   */
  generateReport() {
    const stats = this.getStats();

    return `
性能指标报告
============================================================
生成时间: ${new Date().toLocaleString()}
运行时长: ${stats.uptimeHours} 小时

索引同步
------------------------------------------------------------
总同步次数: ${stats.syncCount}
总同步文件: ${stats.syncTotalFiles}
平均耗时: ${stats.avgSyncDuration.toFixed(2)} ms
平均文件数: ${stats.avgSyncFileCount.toFixed(0)} files/sync
同步成功率: ${(stats.syncSuccessRate * 100).toFixed(2)}%
同步速率: ${stats.syncsPerMinute.toFixed(2)} syncs/min

文件传输
------------------------------------------------------------
总传输次数: ${stats.transferCount}
总传输数据: ${(stats.transferTotalBytes / 1024 / 1024).toFixed(2)} MB
平均传输速度: ${stats.avgTransferSpeed.toFixed(2)} MB/s
传输成功率: ${(stats.transferSuccessRate * 100).toFixed(2)}%
传输速率: ${stats.transfersPerMinute.toFixed(2)} transfers/min
活跃传输: ${stats.activeTransfers}

缓存
------------------------------------------------------------
缓存命中: ${stats.cacheHits}
缓存未命中: ${stats.cacheMisses}
缓存命中率: ${(stats.cacheHitRate * 100).toFixed(2)}%
缓存淘汰次数: ${stats.cacheEvictions}
当前缓存大小: ${(stats.totalCacheSize / 1024 / 1024).toFixed(2)} MB

数据库
------------------------------------------------------------
查询次数: ${stats.dbQueryCount}
平均查询时间: ${stats.avgDbQueryDuration.toFixed(2)} ms

错误统计
------------------------------------------------------------
总错误数: ${stats.totalErrors}
错误率: ${(stats.errorRate * 100).toFixed(2)}%
同步错误: ${stats.syncErrors}
传输错误: ${stats.transferErrors}

============================================================
    `.trim();
  }
}

module.exports = PerformanceMetrics;
