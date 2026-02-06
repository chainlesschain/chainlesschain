/**
 * Performance Tracker 类型定义
 */

/**
 * 性能事件监听器
 */
export type PerformanceEventListener = (event: string, data: any) => void;

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
export interface AiResponseStats extends FileOperationStats {
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
 * 所有指标
 */
export interface AllMetrics {
  fileOperations: FileOperationStats;
  aiResponses: AiResponseStats;
  network: NetworkStats;
  cache: CacheStats;
}

/**
 * 性能追踪器类
 */
declare class PerformanceTracker {
  /**
   * 添加事件监听器
   */
  addListener(callback: PerformanceEventListener): () => void;

  /**
   * 触发事件
   */
  emit(event: string, data: any): void;

  /**
   * 追踪文件操作
   */
  trackFileOperation(operation: string, file: string, startTime: number): number;

  /**
   * 追踪 AI 响应
   */
  trackAiResponse(model: string, tokens: number, startTime: number): number;

  /**
   * 追踪网络请求
   */
  trackNetworkRequest(url: string, method: string, startTime: number, success?: boolean): number;

  /**
   * 追踪缓存命中
   */
  trackCacheHit(): void;

  /**
   * 追踪缓存未命中
   */
  trackCacheMiss(): void;

  /**
   * 获取缓存命中率
   */
  getCacheHitRate(): number;

  /**
   * 获取文件操作统计
   */
  getFileOperationStats(): FileOperationStats;

  /**
   * 获取 AI 响应统计
   */
  getAiResponseStats(): AiResponseStats;

  /**
   * 获取网络统计
   */
  getNetworkStats(): NetworkStats;

  /**
   * 测量函数执行时间
   */
  measure<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /**
   * 创建性能标记
   */
  mark(name: string): void;

  /**
   * 测量两个标记之间的时间
   */
  measureBetween(name: string, startMark: string, endMark: string): number;

  /**
   * 清除所有指标
   */
  clear(): void;

  /**
   * 获取所有指标
   */
  getAllMetrics(): AllMetrics;
}

declare const performanceTracker: PerformanceTracker;

export { PerformanceTracker };
export default performanceTracker;
