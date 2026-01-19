/**
 * 性能监控管理器
 * 监控应用性能指标，包括内存、CPU、渲染性能等
 */

import { logger, createLogger } from '@/utils/logger';
import { ref, computed } from 'vue';

/**
 * 性能指标类型
 */
export const MetricType = {
  MEMORY: 'memory',
  CPU: 'cpu',
  FPS: 'fps',
  NETWORK: 'network',
  STORAGE: 'storage',
  RENDER: 'render',
};

/**
 * 性能指标类
 */
class PerformanceMetric {
  constructor(options = {}) {
    this.type = options.type || MetricType.MEMORY;
    this.value = options.value || 0;
    this.timestamp = options.timestamp || Date.now();
    this.metadata = options.metadata || {};
  }
}

/**
 * 性能监控管理器
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = ref({
      memory: [],
      cpu: [],
      fps: [],
      network: [],
      storage: [],
      render: [],
    });

    this.currentMetrics = ref({
      memory: { used: 0, total: 0, percentage: 0 },
      cpu: { usage: 0 },
      fps: { current: 0, average: 0 },
      network: { download: 0, upload: 0 },
      storage: { used: 0, total: 0, percentage: 0 },
      render: { time: 0, count: 0 },
    });

    this.isMonitoring = ref(false);
    this.monitorInterval = null;
    this.maxDataPoints = 60; // 保留最近60个数据点
    this.updateInterval = 1000; // 1秒更新一次

    // FPS 监控
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.fpsHistory = [];

    // 渲染性能监控
    this.renderObserver = null;
  }

  /**
   * 开始监控
   */
  start() {
    if (this.isMonitoring.value) {return;}

    this.isMonitoring.value = true;

    // 定期收集指标
    this.monitorInterval = setInterval(() => {
      this.collectMetrics();
    }, this.updateInterval);

    // 启动 FPS 监控
    this.startFPSMonitoring();

    // 启动渲染性能监控
    this.startRenderMonitoring();

    logger.info('[PerformanceMonitor] Monitoring started');
  }

  /**
   * 停止监控
   */
  stop() {
    if (!this.isMonitoring.value) {return;}

    this.isMonitoring.value = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.stopFPSMonitoring();
    this.stopRenderMonitoring();

    logger.info('[PerformanceMonitor] Monitoring stopped');
  }

  /**
   * 收集性能指标
   */
  async collectMetrics() {
    // 收集内存信息
    if (performance.memory) {
      const memory = {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        percentage: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100,
      };

      this.currentMetrics.value.memory = memory;
      this.addMetric(MetricType.MEMORY, memory.percentage, { ...memory });
    }

    // 收集存储信息
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const storage = {
          used: estimate.usage || 0,
          total: estimate.quota || 0,
          percentage: estimate.quota ? (estimate.usage / estimate.quota) * 100 : 0,
        };

        this.currentMetrics.value.storage = storage;
        this.addMetric(MetricType.STORAGE, storage.percentage, { ...storage });
      } catch (error) {
        logger.error('[PerformanceMonitor] Storage estimate error:', error);
      }
    }

    // 收集网络信息
    if (navigator.connection) {
      const network = {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData,
      };

      this.currentMetrics.value.network = network;
      this.addMetric(MetricType.NETWORK, network.downlink, { ...network });
    }
  }

  /**
   * 添加指标数据
   */
  addMetric(type, value, metadata = {}) {
    const metric = new PerformanceMetric({ type, value, metadata });

    if (!this.metrics.value[type]) {
      this.metrics.value[type] = [];
    }

    this.metrics.value[type].push(metric);

    // 限制数据点数量
    if (this.metrics.value[type].length > this.maxDataPoints) {
      this.metrics.value[type].shift();
    }
  }

  /**
   * 启动 FPS 监控
   */
  startFPSMonitoring() {
    const measureFPS = () => {
      if (!this.isMonitoring.value) {return;}

      this.frameCount++;
      const now = performance.now();
      const delta = now - this.lastFrameTime;

      if (delta >= 1000) {
        const fps = Math.round((this.frameCount * 1000) / delta);
        this.fpsHistory.push(fps);

        if (this.fpsHistory.length > 10) {
          this.fpsHistory.shift();
        }

        const averageFPS = Math.round(
          this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length
        );

        this.currentMetrics.value.fps = {
          current: fps,
          average: averageFPS,
        };

        this.addMetric(MetricType.FPS, fps, { average: averageFPS });

        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      requestAnimationFrame(measureFPS);
    };

    requestAnimationFrame(measureFPS);
  }

  /**
   * 停止 FPS 监控
   */
  stopFPSMonitoring() {
    this.frameCount = 0;
    this.fpsHistory = [];
  }

  /**
   * 启动渲染性能监控
   */
  startRenderMonitoring() {
    if (!window.PerformanceObserver) {return;}

    try {
      this.renderObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'measure') {
            this.currentMetrics.value.render = {
              time: entry.duration,
              count: (this.currentMetrics.value.render.count || 0) + 1,
            };

            this.addMetric(MetricType.RENDER, entry.duration, {
              name: entry.name,
              startTime: entry.startTime,
            });
          }
        });
      });

      this.renderObserver.observe({ entryTypes: ['measure'] });
    } catch (error) {
      logger.error('[PerformanceMonitor] Render monitoring error:', error);
    }
  }

  /**
   * 停止渲染性能监控
   */
  stopRenderMonitoring() {
    if (this.renderObserver) {
      this.renderObserver.disconnect();
      this.renderObserver = null;
    }
  }

  /**
   * 获取指标数据
   */
  getMetrics(type, limit = null) {
    const data = this.metrics.value[type] || [];
    return limit ? data.slice(-limit) : data;
  }

  /**
   * 获取当前指标
   */
  getCurrentMetrics() {
    return this.currentMetrics.value;
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport() {
    const report = {
      timestamp: Date.now(),
      current: this.currentMetrics.value,
      history: {},
      summary: {},
    };

    // 添加历史数据
    Object.keys(this.metrics.value).forEach((type) => {
      report.history[type] = this.getMetrics(type, 10);
    });

    // 计算摘要统计
    Object.keys(this.metrics.value).forEach((type) => {
      const data = this.metrics.value[type];
      if (data.length > 0) {
        const values = data.map((m) => m.value);
        report.summary[type] = {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          current: values[values.length - 1],
        };
      }
    });

    return report;
  }

  /**
   * 标记性能点
   */
  mark(name) {
    if (performance.mark) {
      performance.mark(name);
    }
  }

  /**
   * 测量性能
   */
  measure(name, startMark, endMark) {
    if (performance.measure) {
      try {
        performance.measure(name, startMark, endMark);
      } catch (error) {
        logger.error('[PerformanceMonitor] Measure error:', error);
      }
    }
  }

  /**
   * 清除标记
   */
  clearMarks(name = null) {
    if (performance.clearMarks) {
      if (name) {
        performance.clearMarks(name);
      } else {
        performance.clearMarks();
      }
    }
  }

  /**
   * 清除测量
   */
  clearMeasures(name = null) {
    if (performance.clearMeasures) {
      if (name) {
        performance.clearMeasures(name);
      } else {
        performance.clearMeasures();
      }
    }
  }

  /**
   * 清空所有数据
   */
  clear() {
    Object.keys(this.metrics.value).forEach((type) => {
      this.metrics.value[type] = [];
    });
  }

  /**
   * 导出性能数据
   */
  exportData() {
    return {
      metrics: this.metrics.value,
      currentMetrics: this.currentMetrics.value,
      exportTime: Date.now(),
    };
  }
}

// 创建全局实例
const performanceMonitor = new PerformanceMonitor();

// 自动开始监控
if (typeof window !== 'undefined') {
  performanceMonitor.start();
}

/**
 * 组合式函数：使用性能监控
 */
export function usePerformanceMonitor() {
  return {
    isMonitoring: computed(() => performanceMonitor.isMonitoring.value),
    currentMetrics: computed(() => performanceMonitor.currentMetrics.value),
    metrics: computed(() => performanceMonitor.metrics.value),
    start: () => performanceMonitor.start(),
    stop: () => performanceMonitor.stop(),
    getMetrics: (type, limit) => performanceMonitor.getMetrics(type, limit),
    getCurrentMetrics: () => performanceMonitor.getCurrentMetrics(),
    getPerformanceReport: () => performanceMonitor.getPerformanceReport(),
    mark: (name) => performanceMonitor.mark(name),
    measure: (name, startMark, endMark) => performanceMonitor.measure(name, startMark, endMark),
    clearMarks: (name) => performanceMonitor.clearMarks(name),
    clearMeasures: (name) => performanceMonitor.clearMeasures(name),
    clear: () => performanceMonitor.clear(),
    exportData: () => performanceMonitor.exportData(),
  };
}

export default performanceMonitor;
