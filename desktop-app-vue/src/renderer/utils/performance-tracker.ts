/**
 * Performance Tracker
 * Tracks file operations, AI responses, and system metrics
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 文件操作数据
 */
export interface FileOperationData {
  operation: string;
  file: string;
  duration: number;
  timestamp: number;
}

/**
 * AI 响应数据
 */
export interface AiResponseData {
  model: string;
  tokens: number;
  duration: number;
  timestamp: number;
}

/**
 * 网络请求数据
 */
export interface NetworkRequestData {
  url: string;
  method: string;
  duration: number;
  success: boolean;
  timestamp: number;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

/**
 * 性能指标集合
 */
export interface TrackerMetrics {
  fileOperations: FileOperationData[];
  aiResponses: AiResponseData[];
  networkRequests: NetworkRequestData[];
  cacheHits: number;
  cacheMisses: number;
}

/**
 * 文件操作统计
 */
export interface FileOperationStats {
  total: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * AI 响应统计
 */
export interface AiResponseStats {
  total: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  p50: number;
  p95: number;
  p99: number;
  totalTokens: number;
}

/**
 * 网络统计
 */
export interface NetworkStats {
  total: number;
  successful: number;
  failed: number;
  avgTime: number;
}

/**
 * 所有指标汇总
 */
export interface AllMetrics {
  fileOperations: FileOperationStats;
  aiResponses: AiResponseStats;
  network: NetworkStats;
  cache: CacheStats;
}

/**
 * 性能事件类型
 */
export type PerformanceEventType =
  | 'fileOperation'
  | 'aiResponse'
  | 'networkRequest'
  | 'cacheHit'
  | 'cacheMiss'
  | 'clear';

/**
 * 性能事件监听器
 */
export type PerformanceEventListener = (
  event: PerformanceEventType,
  data: FileOperationData | AiResponseData | NetworkRequestData | CacheStats | Record<string, never>
) => void;

/**
 * 可测量的函数类型
 */
export type MeasurableFunction<T> = () => T | Promise<T>;

// ==================== 类实现 ====================

/**
 * Performance Tracker 类
 */
class PerformanceTracker {
  private listeners: PerformanceEventListener[];
  private metrics: TrackerMetrics;
  private originalFetch: typeof fetch | null;

  constructor() {
    this.listeners = [];
    this.metrics = {
      fileOperations: [],
      aiResponses: [],
      networkRequests: [],
      cacheHits: 0,
      cacheMisses: 0,
    };
    this.originalFetch = null;

    // Intercept fetch for network tracking
    this.interceptFetch();
  }

  /**
   * Add listener for performance events
   */
  addListener(callback: PerformanceEventListener): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(
    event: PerformanceEventType,
    data: FileOperationData | AiResponseData | NetworkRequestData | CacheStats | Record<string, never>
  ): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event, data);
      } catch (error) {
        logger.error('Performance tracker listener error:', error);
      }
    });
  }

  /**
   * Track file operation
   */
  trackFileOperation(operation: string, file: string, startTime: number): number {
    const duration = performance.now() - startTime;
    const data: FileOperationData = {
      operation,
      file,
      duration: Math.round(duration),
      timestamp: Date.now(),
    };

    this.metrics.fileOperations.push(data);

    // Keep only last 1000 operations
    if (this.metrics.fileOperations.length > 1000) {
      this.metrics.fileOperations.shift();
    }

    this.emit('fileOperation', data);
    return duration;
  }

  /**
   * Track AI response
   */
  trackAiResponse(model: string, tokens: number, startTime: number): number {
    const duration = performance.now() - startTime;
    const data: AiResponseData = {
      model,
      tokens,
      duration: Math.round(duration),
      timestamp: Date.now(),
    };

    this.metrics.aiResponses.push(data);

    // Keep only last 1000 responses
    if (this.metrics.aiResponses.length > 1000) {
      this.metrics.aiResponses.shift();
    }

    this.emit('aiResponse', data);
    return duration;
  }

  /**
   * Track network request
   */
  trackNetworkRequest(
    url: string,
    method: string,
    startTime: number,
    success: boolean = true
  ): number {
    const duration = performance.now() - startTime;
    const data: NetworkRequestData = {
      url,
      method,
      duration: Math.round(duration),
      success,
      timestamp: Date.now(),
    };

    this.metrics.networkRequests.push(data);

    // Keep only last 1000 requests
    if (this.metrics.networkRequests.length > 1000) {
      this.metrics.networkRequests.shift();
    }

    this.emit('networkRequest', data);
    return duration;
  }

  /**
   * Track cache hit
   */
  trackCacheHit(): void {
    this.metrics.cacheHits++;
    this.emit('cacheHit', {
      hits: this.metrics.cacheHits,
      misses: this.metrics.cacheMisses,
      hitRate: this.getCacheHitRate(),
    });
  }

  /**
   * Track cache miss
   */
  trackCacheMiss(): void {
    this.metrics.cacheMisses++;
    this.emit('cacheMiss', {
      hits: this.metrics.cacheHits,
      misses: this.metrics.cacheMisses,
      hitRate: this.getCacheHitRate(),
    });
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    if (total === 0) {
      return 0;
    }
    return Math.round((this.metrics.cacheHits / total) * 100);
  }

  /**
   * Get file operation statistics
   */
  getFileOperationStats(): FileOperationStats {
    if (this.metrics.fileOperations.length === 0) {
      return {
        total: 0,
        avgTime: 0,
        minTime: 0,
        maxTime: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const times = this.metrics.fileOperations
      .map((op) => op.duration)
      .sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);

    return {
      total: this.metrics.fileOperations.length,
      avgTime: Math.round(sum / times.length),
      minTime: times[0],
      maxTime: times[times.length - 1],
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
    };
  }

  /**
   * Get AI response statistics
   */
  getAiResponseStats(): AiResponseStats {
    if (this.metrics.aiResponses.length === 0) {
      return {
        total: 0,
        avgTime: 0,
        minTime: 0,
        maxTime: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        totalTokens: 0,
      };
    }

    const times = this.metrics.aiResponses
      .map((res) => res.duration)
      .sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const totalTokens = this.metrics.aiResponses.reduce(
      (acc, res) => acc + res.tokens,
      0
    );

    return {
      total: this.metrics.aiResponses.length,
      avgTime: Math.round(sum / times.length),
      minTime: times[0],
      maxTime: times[times.length - 1],
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
      totalTokens,
    };
  }

  /**
   * Get network request statistics
   */
  getNetworkStats(): NetworkStats {
    if (this.metrics.networkRequests.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        avgTime: 0,
      };
    }

    const successful = this.metrics.networkRequests.filter(
      (req) => req.success
    ).length;
    const times = this.metrics.networkRequests.map((req) => req.duration);
    const sum = times.reduce((a, b) => a + b, 0);

    return {
      total: this.metrics.networkRequests.length,
      successful,
      failed: this.metrics.networkRequests.length - successful,
      avgTime: Math.round(sum / times.length),
    };
  }

  /**
   * Intercept fetch for network tracking
   */
  private interceptFetch(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.originalFetch = window.fetch;
    const tracker = this;

    window.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const startTime = performance.now();
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || 'GET';

      return tracker.originalFetch!.call(this, input, init)
        .then((response) => {
          tracker.trackNetworkRequest(url, method, startTime, response.ok);
          return response;
        })
        .catch((error) => {
          tracker.trackNetworkRequest(url, method, startTime, false);
          throw error;
        });
    };
  }

  /**
   * Measure function execution time
   */
  async measure<T>(name: string, fn: MeasurableFunction<T>): Promise<T> {
    const startTime = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      logger.info(`[Performance] ${name}: ${Math.round(duration)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error(
        `[Performance] ${name} failed after ${Math.round(duration)}ms:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a performance mark
   */
  mark(name: string): void {
    performance.mark(name);
  }

  /**
   * Measure between two marks
   */
  measureBetween(name: string, startMark: string, endMark: string): number {
    try {
      performance.measure(name, startMark, endMark);
      const measure = performance.getEntriesByName(name)[0];
      return measure.duration;
    } catch (error) {
      logger.error('Performance measure error:', error);
      return 0;
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.fileOperations = [];
    this.metrics.aiResponses = [];
    this.metrics.networkRequests = [];
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
    this.emit('clear', {});
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): AllMetrics {
    return {
      fileOperations: this.getFileOperationStats(),
      aiResponses: this.getAiResponseStats(),
      network: this.getNetworkStats(),
      cache: {
        hits: this.metrics.cacheHits,
        misses: this.metrics.cacheMisses,
        hitRate: this.getCacheHitRate(),
      },
    };
  }
}

// Create singleton instance
const performanceTracker = new PerformanceTracker();

export default performanceTracker;
