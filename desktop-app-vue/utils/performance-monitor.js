/**
 * 性能监控器
 * 实时追踪应用性能指标
 */

const EventEmitter = require('events');
const os = require('os');

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      sampleInterval: options.sampleInterval || 1000, // 采样间隔(ms)
      historySize: options.historySize || 60, // 历史数据保留数量
      enableCPU: options.enableCPU !== false,
      enableMemory: options.enableMemory !== false,
      enableDatabase: options.enableDatabase !== false,
      enableP2P: options.enableP2P !== false,
      ...options,
    };

    this.metrics = {
      cpu: [],
      memory: [],
      database: [],
      p2p: [],
      custom: {},
    };

    this.startTime = Date.now();
    this.intervalId = null;
    this.queryLog = [];
    this.slowQueries = [];
  }

  /**
   * 启动监控
   */
  start() {
    if (this.intervalId) {
      console.warn('[PerformanceMonitor] 监控已在运行');
      return;
    }

    console.log('[PerformanceMonitor] 启动性能监控...');

    this.intervalId = setInterval(() => {
      this.collect();
    }, this.options.sampleInterval);

    this.emit('started');
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[PerformanceMonitor] 性能监控已停止');
      this.emit('stopped');
    }
  }

  /**
   * 采集性能数据
   */
  collect() {
    const timestamp = Date.now();

    // CPU使用率
    if (this.options.enableCPU) {
      const cpuUsage = this.getCPUUsage();
      this.addMetric('cpu', cpuUsage, timestamp);
    }

    // 内存使用
    if (this.options.enableMemory) {
      const memUsage = this.getMemoryUsage();
      this.addMetric('memory', memUsage, timestamp);
    }

    this.emit('metrics:collected', {
      timestamp,
      cpu: this.metrics.cpu[this.metrics.cpu.length - 1],
      memory: this.metrics.memory[this.metrics.memory.length - 1],
    });
  }

  /**
   * 获取CPU使用率
   */
  getCPUUsage() {
    const cpus = os.cpus();

    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - Math.floor((idle / total) * 100);

    return {
      usage,
      cores: cpus.length,
    };
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    const processMemory = process.memoryUsage();

    return {
      system: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usagePercent: Math.floor((usedMemory / totalMemory) * 100),
      },
      process: {
        rss: processMemory.rss,
        heapTotal: processMemory.heapTotal,
        heapUsed: processMemory.heapUsed,
        external: processMemory.external,
        arrayBuffers: processMemory.arrayBuffers,
      },
    };
  }

  /**
   * 添加指标数据
   */
  addMetric(type, value, timestamp = Date.now()) {
    if (!this.metrics[type]) {
      this.metrics[type] = [];
    }

    this.metrics[type].push({
      value,
      timestamp,
    });

    // 限制历史数据大小
    if (this.metrics[type].length > this.options.historySize) {
      this.metrics[type].shift();
    }
  }

  /**
   * 记录数据库查询
   */
  logQuery(query, duration, metadata = {}) {
    const log = {
      query,
      duration,
      timestamp: Date.now(),
      ...metadata,
    };

    this.queryLog.push(log);

    // 限制日志大小
    if (this.queryLog.length > 1000) {
      this.queryLog.shift();
    }

    // 记录慢查询
    const slowQueryThreshold = metadata.threshold || 100; // 默认100ms
    if (duration > slowQueryThreshold) {
      this.slowQueries.push(log);
      this.emit('query:slow', log);

      console.warn(`[PerformanceMonitor] 慢查询检测: ${duration.toFixed(2)}ms`, {
        query: query.substring(0, 100),
        duration,
      });
    }

    this.emit('query:logged', log);
  }

  /**
   * 记录P2P连接事件
   */
  logP2PEvent(event, data) {
    const log = {
      event,
      data,
      timestamp: Date.now(),
    };

    this.addMetric('p2p', log);
    this.emit('p2p:event', log);
  }

  /**
   * 添加自定义指标
   */
  addCustomMetric(name, value, timestamp = Date.now()) {
    if (!this.metrics.custom[name]) {
      this.metrics.custom[name] = [];
    }

    this.metrics.custom[name].push({
      value,
      timestamp,
    });

    // 限制大小
    if (this.metrics.custom[name].length > this.options.historySize) {
      this.metrics.custom[name].shift();
    }

    this.emit('custom:metric', { name, value, timestamp });
  }

  /**
   * 获取所有指标
   */
  getMetrics() {
    return {
      uptime: Date.now() - this.startTime,
      cpu: this.metrics.cpu,
      memory: this.metrics.memory,
      database: this.metrics.database,
      p2p: this.metrics.p2p,
      custom: this.metrics.custom,
    };
  }

  /**
   * 获取统计摘要
   */
  getStats() {
    const cpu = this.metrics.cpu;
    const memory = this.metrics.memory;

    return {
      uptime: Date.now() - this.startTime,
      cpu: cpu.length > 0 ? {
        current: cpu[cpu.length - 1].value.usage,
        average: this.calculateAverage(cpu.map(m => m.value.usage)),
        max: Math.max(...cpu.map(m => m.value.usage)),
      } : null,
      memory: memory.length > 0 ? {
        current: memory[memory.length - 1].value.process.heapUsed,
        average: this.calculateAverage(memory.map(m => m.value.process.heapUsed)),
        max: Math.max(...memory.map(m => m.value.process.heapUsed)),
      } : null,
      queries: {
        total: this.queryLog.length,
        slow: this.slowQueries.length,
        averageDuration: this.calculateAverage(this.queryLog.map(q => q.duration)),
      },
    };
  }

  /**
   * 获取慢查询
   */
  getSlowQueries(limit = 10) {
    return this.slowQueries
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  /**
   * 计算平均值
   */
  calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * 生成性能报告
   */
  generateReport() {
    const stats = this.getStats();
    const slowQueries = this.getSlowQueries(5);

    const report = {
      timestamp: new Date().toISOString(),
      uptime: this.formatUptime(stats.uptime),
      cpu: stats.cpu,
      memory: {
        ...stats.memory,
        current: this.formatBytes(stats.memory?.current || 0),
        average: this.formatBytes(stats.memory?.average || 0),
        max: this.formatBytes(stats.memory?.max || 0),
      },
      queries: stats.queries,
      slowQueries: slowQueries.map(q => ({
        query: q.query.substring(0, 100),
        duration: q.duration.toFixed(2) + 'ms',
        timestamp: new Date(q.timestamp).toLocaleString(),
      })),
    };

    return report;
  }

  /**
   * 打印性能报告
   */
  printReport() {
    const report = this.generateReport();

    console.log('\n' + '='.repeat(70));
    console.log('性能监控报告');
    console.log('='.repeat(70));

    console.log(`\n运行时间: ${report.uptime}`);

    if (report.cpu) {
      console.log(`\nCPU使用率:`);
      console.log(`  当前: ${report.cpu.current}%`);
      console.log(`  平均: ${report.cpu.average.toFixed(1)}%`);
      console.log(`  峰值: ${report.cpu.max}%`);
    }

    if (report.memory) {
      console.log(`\n内存使用:`);
      console.log(`  当前: ${report.memory.current}`);
      console.log(`  平均: ${report.memory.average}`);
      console.log(`  峰值: ${report.memory.max}`);
    }

    console.log(`\n数据库查询:`);
    console.log(`  总查询数: ${report.queries.total}`);
    console.log(`  慢查询数: ${report.queries.slow}`);
    console.log(`  平均耗时: ${report.queries.averageDuration.toFixed(2)}ms`);

    if (report.slowQueries.length > 0) {
      console.log(`\n慢查询列表 (Top 5):`);
      report.slowQueries.forEach((q, index) => {
        console.log(`  ${index + 1}. ${q.duration}`);
        console.log(`     ${q.query}...`);
      });
    }

    console.log('\n' + '='.repeat(70) + '\n');
  }

  /**
   * 格式化字节数
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 格式化运行时间
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 重置监控数据
   */
  reset() {
    this.metrics = {
      cpu: [],
      memory: [],
      database: [],
      p2p: [],
      custom: {},
    };
    this.queryLog = [];
    this.slowQueries = [];
    this.startTime = Date.now();

    this.emit('reset');
  }
}

// 单例模式
let instance = null;

function getPerformanceMonitor(options) {
  if (!instance) {
    instance = new PerformanceMonitor(options);
  }
  return instance;
}

module.exports = {
  PerformanceMonitor,
  getPerformanceMonitor,
};
