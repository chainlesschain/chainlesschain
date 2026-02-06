/**
 * Performance Benchmark Utility
 * 性能基准测试工具
 *
 * Features:
 * - Measure page load time
 * - FPS monitoring
 * - Memory usage tracking
 * - Network performance metrics
 * - Custom performance marks
 * - Generate performance reports
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 基准测试选项
 */
export interface BenchmarkOptions {
  enableAutoTracking?: boolean;
  sampleInterval?: number;
  debug?: boolean;
}

/**
 * 页面加载指标
 */
export interface PageLoadMetrics {
  dnsTime?: number;
  tcpTime?: number;
  requestTime?: number;
  responseTime?: number;
  domParseTime?: number;
  domReadyTime?: number;
  resourceLoadTime?: number;
  totalTime?: number;
  firstPaint?: number | null;
  navigationType?: string;
}

/**
 * FPS 样本
 */
export interface FPSSample {
  timestamp: number;
  fps: number;
}

/**
 * 内存样本
 */
export interface MemorySample {
  timestamp: number;
  usedJSHeapSizeMB: number;
  totalJSHeapSizeMB: number;
  heapSizeLimitMB: number;
}

/**
 * 自定义标记
 */
export interface CustomMark {
  name: string;
  timestamp: number;
}

/**
 * 网络资源类型统计
 */
export interface ResourceTypeStats {
  count: number;
  transferSize: number;
  duration: number;
}

/**
 * 网络指标
 */
export interface NetworkMetrics {
  totalRequests: number;
  totalTransferSize: number;
  totalDuration: number;
  byType: Record<string, ResourceTypeStats>;
}

/**
 * 所有基准指标
 */
export interface BenchmarkMetrics {
  pageLoad: PageLoadMetrics;
  fps: FPSSample[];
  memory: MemorySample[];
  network: NetworkMetrics;
  customMarks: CustomMark[];
}

/**
 * FPS 报告统计
 */
export interface FPSReportStats {
  average: number;
  samples: number;
  min: number;
  max: number;
}

/**
 * 内存报告统计
 */
export interface MemoryReportStats {
  current: MemorySample | null;
  samples: number;
}

/**
 * 视口信息
 */
export interface ViewportInfo {
  width: number;
  height: number;
}

/**
 * 性能报告
 */
export interface PerformanceReport {
  timestamp: string;
  score: number;
  pageLoad: PageLoadMetrics;
  fps: FPSReportStats;
  memory: MemoryReportStats;
  network: NetworkMetrics;
  customMarks: CustomMark[];
  userAgent: string;
  viewport: ViewportInfo;
}

/**
 * 性能比较结果
 */
export interface PerformanceComparison {
  score: {
    baseline: number;
    current: number;
    diff: number;
  };
  loadTime: {
    baseline: number;
    current: number;
    diff: number;
    improvement: string;
  };
  fps: {
    baseline: number;
    current: number;
    diff: number;
  };
  memory: {
    baseline: number;
    current: number;
    diff: number;
  };
}

/**
 * 资源类型
 */
export type ResourceType =
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'font'
  | 'video'
  | 'fetch'
  | 'other';

/**
 * 导航类型映射
 */
export type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'reserved' | 'unknown';

// ==================== 扩展全局接口 ====================

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

// ==================== 类实现 ====================

/**
 * Performance Benchmark 类
 */
class PerformanceBenchmark {
  private options: Required<BenchmarkOptions>;
  private metrics: BenchmarkMetrics;
  private startTime: number | null;
  private lastFrameTime: number | null;
  private frameCount: number;
  private sampleTimer: ReturnType<typeof setInterval> | null;

  constructor(options: BenchmarkOptions = {}) {
    this.options = {
      enableAutoTracking: options.enableAutoTracking !== false,
      sampleInterval: options.sampleInterval ?? 1000,
      debug: options.debug ?? false,
    };

    this.metrics = {
      pageLoad: {},
      fps: [],
      memory: [],
      network: {
        totalRequests: 0,
        totalTransferSize: 0,
        totalDuration: 0,
        byType: {},
      },
      customMarks: [],
    };

    this.startTime = null;
    this.lastFrameTime = null;
    this.frameCount = 0;
    this.sampleTimer = null;

    this.init();
  }

  /**
   * Initialize benchmark
   */
  private init(): void {
    if (this.options.enableAutoTracking) {
      this.trackPageLoad();
      this.startFPSMonitoring();
      this.startMemoryMonitoring();
    }

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Initialized');
    }
  }

  /**
   * Track page load metrics
   */
  private trackPageLoad(): void {
    if (typeof window === 'undefined' || !performance.timing) {
      return;
    }

    window.addEventListener('load', () => {
      const timing = performance.timing;
      const navigation = performance.navigation;

      this.metrics.pageLoad = {
        dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
        tcpTime: timing.connectEnd - timing.connectStart,
        requestTime: timing.responseStart - timing.requestStart,
        responseTime: timing.responseEnd - timing.responseStart,
        domParseTime: timing.domInteractive - timing.responseEnd,
        domReadyTime:
          timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
        resourceLoadTime:
          timing.loadEventStart - timing.domContentLoadedEventEnd,
        totalTime: timing.loadEventEnd - timing.navigationStart,
        firstPaint: this.getFirstPaint(),
        navigationType: this.getNavigationType(navigation.type),
      };

      if (this.options.debug) {
        logger.info(
          '[PerformanceBenchmark] Page load metrics:',
          this.metrics.pageLoad
        );
      }
    });
  }

  /**
   * Get First Paint time
   */
  private getFirstPaint(): number | null {
    const paintEntries = performance.getEntriesByType('paint');
    const firstPaint = paintEntries.find(
      (entry) => entry.name === 'first-paint'
    );
    return firstPaint ? Math.round(firstPaint.startTime) : null;
  }

  /**
   * Get navigation type
   */
  private getNavigationType(type: number): NavigationType {
    const types: Record<number, NavigationType> = {
      0: 'navigate',
      1: 'reload',
      2: 'back_forward',
      255: 'reserved',
    };
    return types[type] || 'unknown';
  }

  /**
   * Start FPS monitoring
   */
  private startFPSMonitoring(): void {
    this.lastFrameTime = performance.now();
    this.frameCount = 0;

    const measureFPS = (currentTime: number): void => {
      this.frameCount++;

      const elapsed = currentTime - (this.lastFrameTime || currentTime);

      if (elapsed >= this.options.sampleInterval) {
        const fps = Math.round((this.frameCount * 1000) / elapsed);

        this.metrics.fps.push({
          timestamp: Date.now(),
          fps,
        });

        // Keep only last 100 samples
        if (this.metrics.fps.length > 100) {
          this.metrics.fps.shift();
        }

        this.frameCount = 0;
        this.lastFrameTime = currentTime;
      }

      requestAnimationFrame(measureFPS);
    };

    requestAnimationFrame(measureFPS);

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] FPS monitoring started');
    }
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    if (!performance.memory) {
      logger.warn('[PerformanceBenchmark] Memory API not available');
      return;
    }

    this.sampleTimer = setInterval(() => {
      if (!performance.memory) {
        return;
      }

      const memoryInfo: MemorySample = {
        timestamp: Date.now(),
        usedJSHeapSizeMB: Math.round(
          performance.memory.usedJSHeapSize / 1024 / 1024
        ),
        totalJSHeapSizeMB: Math.round(
          performance.memory.totalJSHeapSize / 1024 / 1024
        ),
        heapSizeLimitMB: Math.round(
          performance.memory.jsHeapSizeLimit / 1024 / 1024
        ),
      };

      this.metrics.memory.push(memoryInfo);

      // Keep only last 100 samples
      if (this.metrics.memory.length > 100) {
        this.metrics.memory.shift();
      }
    }, this.options.sampleInterval);

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Memory monitoring started');
    }
  }

  /**
   * Measure network performance
   */
  measureNetwork(): NetworkMetrics {
    if (
      typeof window === 'undefined' ||
      !performance.getEntriesByType
    ) {
      return this.metrics.network;
    }

    const resources = performance.getEntriesByType(
      'resource'
    ) as PerformanceResourceTiming[];

    const networkMetrics: NetworkMetrics = {
      totalRequests: resources.length,
      totalTransferSize: 0,
      totalDuration: 0,
      byType: {},
    };

    resources.forEach((resource) => {
      // Total transfer size
      networkMetrics.totalTransferSize += resource.transferSize || 0;

      // Total duration
      networkMetrics.totalDuration += resource.duration;

      // Group by type
      const type = this.getResourceType(resource.name);

      if (!networkMetrics.byType[type]) {
        networkMetrics.byType[type] = {
          count: 0,
          transferSize: 0,
          duration: 0,
        };
      }

      networkMetrics.byType[type].count++;
      networkMetrics.byType[type].transferSize += resource.transferSize || 0;
      networkMetrics.byType[type].duration += resource.duration;
    });

    this.metrics.network = networkMetrics;

    return networkMetrics;
  }

  /**
   * Get resource type from URL
   */
  private getResourceType(url: string): ResourceType {
    if (url.match(/\.(js|mjs)$/)) {
      return 'script';
    }
    if (url.match(/\.(css)$/)) {
      return 'stylesheet';
    }
    if (url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/)) {
      return 'image';
    }
    if (url.match(/\.(woff|woff2|ttf|otf)$/)) {
      return 'font';
    }
    if (url.match(/\.(mp4|webm|ogg)$/)) {
      return 'video';
    }
    if (url.match(/\.(json)$/)) {
      return 'fetch';
    }
    return 'other';
  }

  /**
   * Create custom performance mark
   */
  mark(name: string): void {
    if (performance.mark) {
      performance.mark(name);

      this.metrics.customMarks.push({
        name,
        timestamp: performance.now(),
      });

      if (this.options.debug) {
        logger.info(`[PerformanceBenchmark] Mark: ${name}`);
      }
    }
  }

  /**
   * Measure time between two marks
   */
  measure(name: string, startMark: string, endMark: string): number | null {
    if (performance.measure) {
      try {
        performance.measure(name, startMark, endMark);

        const measureEntry = performance.getEntriesByName(name, 'measure')[0];

        if (this.options.debug) {
          logger.info(
            `[PerformanceBenchmark] Measure: ${name} = ${Math.round(measureEntry.duration)}ms`
          );
        }

        return measureEntry.duration;
      } catch (error) {
        logger.error('[PerformanceBenchmark] Measure error:', error);
        return null;
      }
    }

    return null;
  }

  /**
   * Get average FPS
   */
  getAverageFPS(): number {
    if (this.metrics.fps.length === 0) {
      return 0;
    }

    const sum = this.metrics.fps.reduce((acc, sample) => acc + sample.fps, 0);
    return Math.round(sum / this.metrics.fps.length);
  }

  /**
   * Get current memory usage
   */
  getCurrentMemory(): MemorySample | null {
    if (this.metrics.memory.length === 0) {
      return null;
    }

    return this.metrics.memory[this.metrics.memory.length - 1];
  }

  /**
   * Get performance score (0-100)
   */
  getPerformanceScore(): number {
    let score = 100;

    // Page load time (< 3s = good)
    const loadTime = this.metrics.pageLoad.totalTime || 0;
    if (loadTime > 5000) {
      score -= 30;
    } else if (loadTime > 3000) {
      score -= 15;
    }

    // FPS (>= 55 = good)
    const avgFPS = this.getAverageFPS();
    if (avgFPS < 30) {
      score -= 30;
    } else if (avgFPS < 55) {
      score -= 15;
    }

    // Memory usage (< 100MB = good)
    const memory = this.getCurrentMemory();
    if (memory && memory.usedJSHeapSizeMB > 200) {
      score -= 20;
    } else if (memory && memory.usedJSHeapSizeMB > 100) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  /**
   * Generate performance report
   */
  generateReport(): PerformanceReport {
    this.measureNetwork();

    const fpsValues = this.metrics.fps.map((s) => s.fps);

    const report: PerformanceReport = {
      timestamp: new Date().toISOString(),
      score: this.getPerformanceScore(),
      pageLoad: this.metrics.pageLoad,
      fps: {
        average: this.getAverageFPS(),
        samples: this.metrics.fps.length,
        min: fpsValues.length > 0 ? Math.min(...fpsValues) : 0,
        max: fpsValues.length > 0 ? Math.max(...fpsValues) : 0,
      },
      memory: {
        current: this.getCurrentMemory(),
        samples: this.metrics.memory.length,
      },
      network: this.metrics.network,
      customMarks: this.metrics.customMarks,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      viewport: {
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
      },
    };

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Performance Report:', report);
    }

    return report;
  }

  /**
   * Export report as JSON
   */
  exportReport(filename: string = `performance-report-${Date.now()}.json`): void {
    const report = this.generateReport();
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);

    if (this.options.debug) {
      logger.info(`[PerformanceBenchmark] Report exported: ${filename}`);
    }
  }

  /**
   * Log report to console (formatted)
   */
  logReport(): PerformanceReport {
    const report = this.generateReport();

    console.group('Performance Report');
    logger.info(`Score: ${report.score}/100`);
    logger.info(`Page Load Time: ${report.pageLoad.totalTime}ms`);
    logger.info(`Average FPS: ${report.fps.average}`);
    logger.info(`Memory Usage: ${report.memory.current?.usedJSHeapSizeMB}MB`);
    logger.info(`Network Requests: ${report.network.totalRequests}`);
    logger.info(
      `Transfer Size: ${Math.round(report.network.totalTransferSize / 1024)}KB`
    );
    console.groupEnd();

    return report;
  }

  /**
   * Compare with baseline
   */
  compare(baseline: PerformanceReport): PerformanceComparison {
    const current = this.generateReport();

    const comparison: PerformanceComparison = {
      score: {
        baseline: baseline.score,
        current: current.score,
        diff: current.score - baseline.score,
      },
      loadTime: {
        baseline: baseline.pageLoad.totalTime || 0,
        current: current.pageLoad.totalTime || 0,
        diff: (current.pageLoad.totalTime || 0) - (baseline.pageLoad.totalTime || 0),
        improvement:
          ((1 - (current.pageLoad.totalTime || 0) / (baseline.pageLoad.totalTime || 1)) * 100).toFixed(2) + '%',
      },
      fps: {
        baseline: baseline.fps.average,
        current: current.fps.average,
        diff: current.fps.average - baseline.fps.average,
      },
      memory: {
        baseline: baseline.memory.current?.usedJSHeapSizeMB || 0,
        current: current.memory.current?.usedJSHeapSizeMB || 0,
        diff:
          (current.memory.current?.usedJSHeapSizeMB || 0) -
          (baseline.memory.current?.usedJSHeapSizeMB || 0),
      },
    };

    logger.info('Performance Comparison:', comparison);

    return comparison;
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }

    if (this.options.debug) {
      logger.info('[PerformanceBenchmark] Stopped');
    }
  }
}

// Singleton instance
let benchmarkInstance: PerformanceBenchmark | null = null;

/**
 * Get or create performance benchmark instance
 */
export function getPerformanceBenchmark(
  options?: BenchmarkOptions
): PerformanceBenchmark {
  if (!benchmarkInstance) {
    benchmarkInstance = new PerformanceBenchmark(options);
  }
  return benchmarkInstance;
}

/**
 * Convenience functions
 */
export function mark(name: string): void {
  const benchmark = getPerformanceBenchmark();
  return benchmark.mark(name);
}

export function measure(
  name: string,
  startMark: string,
  endMark: string
): number | null {
  const benchmark = getPerformanceBenchmark();
  return benchmark.measure(name, startMark, endMark);
}

export function generateReport(): PerformanceReport {
  const benchmark = getPerformanceBenchmark();
  return benchmark.generateReport();
}

export function exportReport(filename?: string): void {
  const benchmark = getPerformanceBenchmark();
  return benchmark.exportReport(filename);
}

export default PerformanceBenchmark;
