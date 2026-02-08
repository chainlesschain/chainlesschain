const { logger } = require("../utils/logger.js");
const os = require("os");
const { performance } = require("perf_hooks");
const EventEmitter = require("events");

/**
 * 性能监控管理器
 * 收集系统资源、数据库查询、IPC通信等性能指标
 */
class PerformanceMonitor extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      system: {
        cpu: [],
        memory: [],
        disk: [],
      },
      database: {
        queries: [],
        slowQueries: [],
      },
      ipc: {
        calls: [],
        slowCalls: [],
      },
      app: {
        startupTime: null,
        uptime: 0,
      },
    };

    this.config = {
      sampleInterval: 5000, // 采样间隔（毫秒）
      maxSamples: 720, // 最大样本数（1小时，5秒间隔）
      slowQueryThreshold: 1000, // 慢查询阈值（毫秒）
      slowIPCThreshold: 500, // 慢IPC调用阈值（毫秒）
      alertThresholds: {
        cpuUsage: 80, // CPU使用率告警阈值（%）
        memoryUsage: 85, // 内存使用率告警阈值（%）
        diskUsage: 90, // 磁盘使用率告警阈值（%）
      },
    };

    this.monitoring = false;
    this.monitoringInterval = null;
    this.startTime = Date.now();
    this.cpuUsage = null;
  }

  /**
   * 启动性能监控
   */
  start() {
    if (this.monitoring) {
      logger.info("[PerformanceMonitor] 监控已在运行");
      return;
    }

    logger.info("[PerformanceMonitor] 启动性能监控");
    this.monitoring = true;
    this.metrics.app.startupTime = Date.now() - this.startTime;

    // 初始化CPU使用率基准
    this.cpuUsage = process.cpuUsage();

    // 定期采集系统指标
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.config.sampleInterval);

    // 立即采集一次
    this.collectSystemMetrics();
  }

  /**
   * 停止性能监控
   */
  stop() {
    if (!this.monitoring) {
      return;
    }

    logger.info("[PerformanceMonitor] 停止性能监控");
    this.monitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * 采集系统指标
   */
  collectSystemMetrics() {
    const timestamp = Date.now();

    // CPU使用率
    const cpuMetrics = this.getCPUMetrics();
    this.addMetric("system.cpu", {
      timestamp,
      usage: cpuMetrics.usage,
      loadAverage: cpuMetrics.loadAverage,
    });

    // 内存使用率
    const memoryMetrics = this.getMemoryMetrics();
    this.addMetric("system.memory", {
      timestamp,
      total: memoryMetrics.total,
      used: memoryMetrics.used,
      free: memoryMetrics.free,
      usage: memoryMetrics.usage,
      processMemory: memoryMetrics.processMemory,
    });

    // 检查告警
    this.checkAlerts(cpuMetrics, memoryMetrics);

    // 更新运行时间
    this.metrics.app.uptime = Date.now() - this.startTime;
  }

  /**
   * 获取CPU指标
   */
  getCPUMetrics() {
    const cpus = os.cpus();
    const loadAverage = os.loadavg();

    // 计算进程CPU使用率
    let processUsage = 0;
    if (this.cpuUsage) {
      const currentUsage = process.cpuUsage(this.cpuUsage);
      const totalUsage = currentUsage.user + currentUsage.system;
      const elapsedTime = this.config.sampleInterval * 1000; // 微秒
      processUsage = (totalUsage / elapsedTime) * 100;
    }
    this.cpuUsage = process.cpuUsage();

    // 计算系统CPU使用率
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const systemUsage = 100 - (100 * totalIdle) / totalTick;

    return {
      usage: Math.min(100, Math.max(0, processUsage)),
      systemUsage: Math.min(100, Math.max(0, systemUsage)),
      loadAverage: loadAverage[0],
      cores: cpus.length,
    };
  }

  /**
   * 获取内存指标
   */
  getMemoryMetrics() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;

    const processMemory = process.memoryUsage();

    return {
      total: totalMemory,
      used: usedMemory,
      free: freeMemory,
      usage: memoryUsage,
      processMemory: {
        rss: processMemory.rss,
        heapTotal: processMemory.heapTotal,
        heapUsed: processMemory.heapUsed,
        external: processMemory.external,
      },
    };
  }

  /**
   * 记录数据库查询性能
   */
  recordDatabaseQuery(query, duration, params = {}) {
    const record = {
      timestamp: Date.now(),
      query: query.substring(0, 200), // 限制长度
      duration,
      params: JSON.stringify(params).substring(0, 100),
    };

    this.addMetric("database.queries", record);

    // 记录慢查询
    if (duration > this.config.slowQueryThreshold) {
      this.addMetric("database.slowQueries", record);
      this.emit("slowQuery", record);
      logger.warn(
        `[PerformanceMonitor] 慢查询检测: ${duration}ms - ${query.substring(0, 100)}`,
      );
    }
  }

  /**
   * 记录IPC调用性能
   */
  recordIPCCall(channel, duration, params = {}) {
    const record = {
      timestamp: Date.now(),
      channel,
      duration,
      params: JSON.stringify(params).substring(0, 100),
    };

    this.addMetric("ipc.calls", record);

    // 记录慢IPC调用
    if (duration > this.config.slowIPCThreshold) {
      this.addMetric("ipc.slowCalls", record);
      this.emit("slowIPC", record);
      logger.warn(
        `[PerformanceMonitor] 慢IPC调用检测: ${duration}ms - ${channel}`,
      );
    }
  }

  /**
   * 添加指标数据
   */
  addMetric(path, data) {
    const parts = path.split(".");
    let target = this.metrics;

    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]];
    }

    const key = parts[parts.length - 1];
    target[key].push(data);

    // 限制数组大小
    if (target[key].length > this.config.maxSamples) {
      target[key].shift();
    }
  }

  /**
   * 检查告警
   */
  checkAlerts(cpuMetrics, memoryMetrics) {
    const alerts = [];

    // CPU告警
    if (cpuMetrics.usage > this.config.alertThresholds.cpuUsage) {
      const alert = {
        type: "cpu",
        level: "warning",
        message: `CPU使用率过高: ${cpuMetrics.usage.toFixed(2)}%`,
        value: cpuMetrics.usage,
        threshold: this.config.alertThresholds.cpuUsage,
        timestamp: Date.now(),
      };
      alerts.push(alert);
      this.emit("alert", alert);
    }

    // 内存告警
    if (memoryMetrics.usage > this.config.alertThresholds.memoryUsage) {
      const alert = {
        type: "memory",
        level: "warning",
        message: `内存使用率过高: ${memoryMetrics.usage.toFixed(2)}%`,
        value: memoryMetrics.usage,
        threshold: this.config.alertThresholds.memoryUsage,
        timestamp: Date.now(),
      };
      alerts.push(alert);
      this.emit("alert", alert);
    }

    return alerts;
  }

  /**
   * 获取性能摘要
   */
  getSummary() {
    const now = Date.now();
    const recentWindow = 60000; // 最近1分钟

    // CPU摘要
    const recentCPU = this.metrics.system.cpu.filter(
      (m) => now - m.timestamp < recentWindow,
    );
    const avgCPU =
      recentCPU.length > 0
        ? recentCPU.reduce((sum, m) => sum + m.usage, 0) / recentCPU.length
        : 0;

    // 内存摘要
    const recentMemory = this.metrics.system.memory.filter(
      (m) => now - m.timestamp < recentWindow,
    );
    const avgMemory =
      recentMemory.length > 0
        ? recentMemory.reduce((sum, m) => sum + m.usage, 0) /
          recentMemory.length
        : 0;

    // 数据库查询摘要
    const recentQueries = this.metrics.database.queries.filter(
      (q) => now - q.timestamp < recentWindow,
    );
    const avgQueryTime =
      recentQueries.length > 0
        ? recentQueries.reduce((sum, q) => sum + q.duration, 0) /
          recentQueries.length
        : 0;

    // IPC调用摘要
    const recentIPCCalls = this.metrics.ipc.calls.filter(
      (c) => now - c.timestamp < recentWindow,
    );
    const avgIPCTime =
      recentIPCCalls.length > 0
        ? recentIPCCalls.reduce((sum, c) => sum + c.duration, 0) /
          recentIPCCalls.length
        : 0;

    return {
      timestamp: now,
      uptime: this.metrics.app.uptime,
      startupTime: this.metrics.app.startupTime,
      cpu: {
        average: avgCPU,
        current:
          recentCPU.length > 0 ? recentCPU[recentCPU.length - 1].usage : 0,
        samples: recentCPU.length,
      },
      memory: {
        average: avgMemory,
        current:
          recentMemory.length > 0
            ? recentMemory[recentMemory.length - 1].usage
            : 0,
        samples: recentMemory.length,
      },
      database: {
        totalQueries: this.metrics.database.queries.length,
        recentQueries: recentQueries.length,
        slowQueries: this.metrics.database.slowQueries.length,
        averageQueryTime: avgQueryTime,
      },
      ipc: {
        totalCalls: this.metrics.ipc.calls.length,
        recentCalls: recentIPCCalls.length,
        slowCalls: this.metrics.ipc.slowCalls.length,
        averageCallTime: avgIPCTime,
      },
    };
  }

  /**
   * 获取详细指标
   */
  getMetrics() {
    return {
      ...this.metrics,
      summary: this.getSummary(),
    };
  }

  /**
   * 清除历史数据
   */
  clearHistory() {
    this.metrics.system.cpu = [];
    this.metrics.system.memory = [];
    this.metrics.database.queries = [];
    this.metrics.database.slowQueries = [];
    this.metrics.ipc.calls = [];
    this.metrics.ipc.slowCalls = [];
    logger.info("[PerformanceMonitor] 历史数据已清除");
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    logger.info("[PerformanceMonitor] 配置已更新:", this.config);
  }

  /**
   * 导出性能报告
   */
  exportReport() {
    const summary = this.getSummary();
    const report = {
      generatedAt: new Date().toISOString(),
      summary,
      metrics: this.metrics,
      config: this.config,
    };

    return report;
  }
}

// 单例实例
let performanceMonitorInstance = null;

/**
 * 获取性能监控器实例
 */
function getPerformanceMonitor() {
  if (!performanceMonitorInstance) {
    performanceMonitorInstance = new PerformanceMonitor();
  }
  return performanceMonitorInstance;
}

module.exports = {
  PerformanceMonitor,
  getPerformanceMonitor,
};
