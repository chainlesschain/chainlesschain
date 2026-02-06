/**
 * 性能监控管理器
 * 监控应用性能指标，包括内存、CPU、渲染性能等
 */

import { logger } from '@/utils/logger';
import { ref, computed, type Ref, type ComputedRef } from 'vue';

// ==================== 类型定义 ====================

/**
 * 性能指标类型枚举
 */
export const MetricType = {
  MEMORY: 'memory',
  CPU: 'cpu',
  FPS: 'fps',
  NETWORK: 'network',
  STORAGE: 'storage',
  RENDER: 'render',
} as const;

export type MetricTypeValue = typeof MetricType[keyof typeof MetricType];

/**
 * 性能指标选项
 */
export interface MetricOptions {
  type?: MetricTypeValue;
  value?: number;
  timestamp?: number;
  metadata?: Record<string, any>;
}

/**
 * 内存指标
 */
export interface MemoryMetric {
  used: number;
  total: number;
  limit?: number;
  percentage: number;
}

/**
 * CPU 指标
 */
export interface CPUMetric {
  usage: number;
}

/**
 * FPS 指标
 */
export interface FPSMetric {
  current: number;
  average: number;
}

/**
 * 网络指标
 */
export interface NetworkMetric {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  download?: number;
  upload?: number;
}

/**
 * 存储指标
 */
export interface StorageMetric {
  used: number;
  total: number;
  percentage: number;
}

/**
 * 渲染指标
 */
export interface RenderMetric {
  time: number;
  count: number;
}

/**
 * 当前指标
 */
export interface CurrentMetrics {
  memory: MemoryMetric;
  cpu: CPUMetric;
  fps: FPSMetric;
  network: NetworkMetric;
  storage: StorageMetric;
  render: RenderMetric;
}

/**
 * 指标摘要
 */
export interface MetricSummary {
  min: number;
  max: number;
  avg: number;
  current: number;
}

/**
 * 性能报告
 */
export interface PerformanceReport {
  timestamp: number;
  current: CurrentMetrics;
  history: Record<string, PerformanceMetric[]>;
  summary: Record<string, MetricSummary>;
}

/**
 * 导出数据
 */
export interface ExportedData {
  metrics: Record<MetricTypeValue, PerformanceMetric[]>;
  currentMetrics: CurrentMetrics;
  exportTime: number;
}

/**
 * usePerformanceMonitor 返回类型
 */
export interface UsePerformanceMonitorReturn {
  isMonitoring: ComputedRef<boolean>;
  currentMetrics: ComputedRef<CurrentMetrics>;
  metrics: ComputedRef<Record<MetricTypeValue, PerformanceMetric[]>>;
  start: () => void;
  stop: () => void;
  getMetrics: (type: MetricTypeValue, limit?: number | null) => PerformanceMetric[];
  getCurrentMetrics: () => CurrentMetrics;
  getPerformanceReport: () => PerformanceReport;
  mark: (name: string) => void;
  measure: (name: string, startMark: string, endMark: string) => void;
  clearMarks: (name?: string | null) => void;
  clearMeasures: (name?: string | null) => void;
  clear: () => void;
  exportData: () => ExportedData;
}

// ==================== 扩展 Performance 接口 ====================

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }

  interface Navigator {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  }
}

// ==================== 类实现 ====================

/**
 * 性能指标类
 */
class PerformanceMetric {
  type: MetricTypeValue;
  value: number;
  timestamp: number;
  metadata: Record<string, any>;

  constructor(options: MetricOptions = {}) {
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
  metrics: Ref<Record<MetricTypeValue, PerformanceMetric[]>>;
  currentMetrics: Ref<CurrentMetrics>;
  isMonitoring: Ref<boolean>;
  private monitorInterval: ReturnType<typeof setInterval> | null;
  private maxDataPoints: number;
  private updateInterval: number;
  private frameCount: number;
  private lastFrameTime: number;
  private fpsHistory: number[];
  private renderObserver: PerformanceObserver | null;

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
    this.maxDataPoints = 60;
    this.updateInterval = 1000;

    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.fpsHistory = [];

    this.renderObserver = null;
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.isMonitoring.value) return;

    this.isMonitoring.value = true;

    this.monitorInterval = setInterval(() => {
      this.collectMetrics();
    }, this.updateInterval);

    this.startFPSMonitoring();
    this.startRenderMonitoring();

    logger.info('[PerformanceMonitor] Monitoring started');
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (!this.isMonitoring.value) return;

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
  async collectMetrics(): Promise<void> {
    // 收集内存信息
    if (performance.memory) {
      const memory: MemoryMetric = {
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
        const storage: StorageMetric = {
          used: estimate.usage || 0,
          total: estimate.quota || 0,
          percentage: estimate.quota ? ((estimate.usage || 0) / estimate.quota) * 100 : 0,
        };

        this.currentMetrics.value.storage = storage;
        this.addMetric(MetricType.STORAGE, storage.percentage, { ...storage });
      } catch (error) {
        logger.error('[PerformanceMonitor] Storage estimate error:', error);
      }
    }

    // 收集网络信息
    if (navigator.connection) {
      const network: NetworkMetric = {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData,
      };

      this.currentMetrics.value.network = network;
      this.addMetric(MetricType.NETWORK, network.downlink || 0, { ...network });
    }
  }

  /**
   * 添加指标数据
   */
  addMetric(type: MetricTypeValue, value: number, metadata: Record<string, any> = {}): void {
    const metric = new PerformanceMetric({ type, value, metadata });

    if (!this.metrics.value[type]) {
      this.metrics.value[type] = [];
    }

    this.metrics.value[type].push(metric);

    if (this.metrics.value[type].length > this.maxDataPoints) {
      this.metrics.value[type].shift();
    }
  }

  /**
   * 启动 FPS 监控
   */
  private startFPSMonitoring(): void {
    const measureFPS = (): void => {
      if (!this.isMonitoring.value) return;

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
  private stopFPSMonitoring(): void {
    this.frameCount = 0;
    this.fpsHistory = [];
  }

  /**
   * 启动渲染性能监控
   */
  private startRenderMonitoring(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) return;

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
  private stopRenderMonitoring(): void {
    if (this.renderObserver) {
      this.renderObserver.disconnect();
      this.renderObserver = null;
    }
  }

  /**
   * 获取指标数据
   */
  getMetrics(type: MetricTypeValue, limit: number | null = null): PerformanceMetric[] {
    const data = this.metrics.value[type] || [];
    return limit ? data.slice(-limit) : data;
  }

  /**
   * 获取当前指标
   */
  getCurrentMetrics(): CurrentMetrics {
    return this.currentMetrics.value;
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(): PerformanceReport {
    const report: PerformanceReport = {
      timestamp: Date.now(),
      current: this.currentMetrics.value,
      history: {},
      summary: {},
    };

    Object.keys(this.metrics.value).forEach((type) => {
      report.history[type] = this.getMetrics(type as MetricTypeValue, 10);
    });

    Object.keys(this.metrics.value).forEach((type) => {
      const data = this.metrics.value[type as MetricTypeValue];
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
  mark(name: string): void {
    if (performance.mark) {
      performance.mark(name);
    }
  }

  /**
   * 测量性能
   */
  measure(name: string, startMark: string, endMark: string): void {
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
  clearMarks(name: string | null = null): void {
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
  clearMeasures(name: string | null = null): void {
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
  clear(): void {
    Object.keys(this.metrics.value).forEach((type) => {
      this.metrics.value[type as MetricTypeValue] = [];
    });
  }

  /**
   * 导出性能数据
   */
  exportData(): ExportedData {
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
export function usePerformanceMonitor(): UsePerformanceMonitorReturn {
  return {
    isMonitoring: computed(() => performanceMonitor.isMonitoring.value),
    currentMetrics: computed(() => performanceMonitor.currentMetrics.value),
    metrics: computed(() => performanceMonitor.metrics.value),
    start: () => performanceMonitor.start(),
    stop: () => performanceMonitor.stop(),
    getMetrics: (type: MetricTypeValue, limit?: number | null) => performanceMonitor.getMetrics(type, limit),
    getCurrentMetrics: () => performanceMonitor.getCurrentMetrics(),
    getPerformanceReport: () => performanceMonitor.getPerformanceReport(),
    mark: (name: string) => performanceMonitor.mark(name),
    measure: (name: string, startMark: string, endMark: string) => performanceMonitor.measure(name, startMark, endMark),
    clearMarks: (name?: string | null) => performanceMonitor.clearMarks(name),
    clearMeasures: (name?: string | null) => performanceMonitor.clearMeasures(name),
    clear: () => performanceMonitor.clear(),
    exportData: () => performanceMonitor.exportData(),
  };
}

export default performanceMonitor;
