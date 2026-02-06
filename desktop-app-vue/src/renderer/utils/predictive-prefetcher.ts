/**
 * Predictive Prefetcher
 * Predicts which files user will open next based on access patterns and prefetches them
 *
 * 预测性预取器
 * 基于访问模式预测用户下一个可能打开的文件并预取
 */

import { logger } from '@/utils/logger';

// ==================== 外部模块类型定义 ====================

/**
 * IndexedDB 缓存接口
 */
interface IndexedDBCacheInterface {
  getFile: (path: string) => Promise<unknown | null>;
  cacheFile: (path: string, content: unknown) => Promise<void>;
}

/**
 * 性能追踪器接口
 */
interface PerformanceTrackerInterface {
  trackFileOperation: (operation: string, file: string, startTime: number) => number;
}

// 导入外部模块
import { fileCacheManager } from './indexeddb-cache';
import performanceTrackerModule from './performance-tracker';

const indexedDBCache = fileCacheManager as unknown as IndexedDBCacheInterface;
const performanceTracker = performanceTrackerModule as unknown as PerformanceTrackerInterface;

// ==================== 类型定义 ====================

/**
 * 预取器配置选项
 */
export interface PredictivePrefetcherOptions {
  /** 最大预测数量 (默认: 5) */
  maxPredictions?: number;
  /** 最小置信度 (默认: 0.3) */
  minConfidence?: number;
  /** 预取延迟 (毫秒, 默认: 500) */
  prefetchDelay?: number;
  /** 历史记录大小 (默认: 100) */
  historySize?: number;
}

/**
 * 文件访问元数据
 */
export interface FileAccessMetadata {
  /** 文件所在目录 */
  directory?: string;
  /** 文件扩展名 */
  extension?: string;
  /** 项目ID */
  projectId?: string;
  /** 其他元数据 */
  [key: string]: unknown;
}

/**
 * 访问记录
 */
export interface AccessRecord {
  /** 文件路径 */
  path: string;
  /** 时间戳 */
  timestamp: number;
  /** 小时 (0-23) */
  hour: number;
  /** 星期几 (0-6, 0=周日) */
  dayOfWeek: number;
  /** 其他元数据 */
  [key: string]: unknown;
}

/**
 * 文件序列记录
 */
export interface FileSequence {
  /** 下一个文件路径 */
  nextPath: string;
  /** 访问次数 */
  count: number;
}

/**
 * 文件关系
 */
export interface FileRelationship {
  /** 相关文件 */
  related: Record<string, number>;
  /** 一起打开的文件 */
  openedWith: Record<string, number>;
}

/**
 * 时间模式数据
 */
export interface TimePatternData {
  /** 路径访问计数 */
  paths: Record<string, number>;
}

/**
 * 预测理由
 */
export type PredictionReason = 'sequence' | 'relationship' | 'time' | 'similar';

/**
 * 预测结果
 */
export interface Prediction {
  /** 文件路径 */
  path: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 预测理由 */
  reason: PredictionReason;
  /** 综合评分 */
  score: number;
}

/**
 * 预取的文件数据
 */
export interface PrefetchedFileData {
  /** 文件内容 */
  content: unknown;
  /** 预取时间 */
  prefetchedAt: number;
  /** 预测信息 */
  prediction: Prediction;
}

/**
 * 预取器统计
 */
export interface PrefetcherStats {
  /** 预测次数 */
  predictions: number;
  /** 预取次数 */
  prefetches: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 准确率 */
  accuracy: number;
}

/**
 * 扩展的预取器统计
 */
export interface ExtendedPrefetcherStats extends PrefetcherStats {
  /** 历史记录大小 */
  historySize: number;
  /** 序列数量 */
  sequences: number;
  /** 关系数量 */
  relationships: number;
  /** 已预取文件数量 */
  prefetchedFiles: number;
  /** 队列长度 */
  queueLength: number;
  /** 命中率 (百分比) */
  hitRate: number;
}

/**
 * 存储的历史数据
 */
export interface StoredHistoryData {
  /** 访问历史 */
  history: AccessRecord[];
  /** 统计数据 */
  stats: PrefetcherStats;
}

/**
 * 导出的文件序列
 */
export interface ExportedSequence {
  /** 文件路径 */
  path: string;
  /** 序列数据 */
  sequences: FileSequence[];
}

/**
 * 导出的时间模式
 */
export interface ExportedTimePattern {
  /** 小时或星期 */
  hour?: number;
  day?: number;
  /** 最常访问的路径 */
  topPaths: [string, number][];
}

/**
 * 导出的文件关系
 */
export interface ExportedRelationship {
  /** 文件路径 */
  path: string;
  /** 相关文件 */
  related: [string, number][];
}

/**
 * 导出的模式数据
 */
export interface ExportedPatterns {
  /** 文件序列 */
  sequences: ExportedSequence[];
  /** 小时模式 */
  hourlyPatterns: ExportedTimePattern[];
  /** 星期模式 */
  dayOfWeekPatterns: ExportedTimePattern[];
  /** 文件关系 */
  relationships: ExportedRelationship[];
}

/**
 * Electron API 接口
 */
interface ElectronAPI {
  invoke: (channel: string, data: unknown) => Promise<unknown>;
}

/**
 * 扩展的 Window 接口
 */
declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

// ==================== 预取器类 ====================

/**
 * 预测性预取器
 */
class PredictivePrefetcher {
  private maxPredictions: number;
  private minConfidence: number;
  private prefetchDelay: number;
  private historySize: number;

  // 访问历史和模式
  private accessHistory: AccessRecord[] = [];
  private fileSequences: Map<string, FileSequence[]> = new Map();
  private fileRelationships: Map<string, FileRelationship> = new Map();
  private hourlyPatterns: Map<number, TimePatternData> = new Map();
  private dayOfWeekPatterns: Map<number, TimePatternData> = new Map();

  // 预取队列和缓存
  private prefetchQueue: Prediction[] = [];
  private prefetching: boolean = false;
  private prefetchedFiles: Map<string, PrefetchedFileData> = new Map();

  // 统计
  private stats: PrefetcherStats = {
    predictions: 0,
    prefetches: 0,
    hits: 0,
    misses: 0,
    accuracy: 0,
  };

  constructor(options: PredictivePrefetcherOptions = {}) {
    this.maxPredictions = options.maxPredictions ?? 5;
    this.minConfidence = options.minConfidence ?? 0.3;
    this.prefetchDelay = options.prefetchDelay ?? 500;
    this.historySize = options.historySize ?? 100;

    this.loadHistory();
  }

  /**
   * 从存储加载访问历史
   */
  private async loadHistory(): Promise<void> {
    try {
      const stored = localStorage.getItem('file-access-history');
      if (stored) {
        const data: StoredHistoryData = JSON.parse(stored);
        this.accessHistory = data.history || [];
        this.stats = data.stats || this.stats;

        // 从历史重建模式
        this.rebuildPatterns();

        logger.info('[Prefetcher] Loaded history:', {
          entries: this.accessHistory.length,
          sequences: this.fileSequences.size,
        });
      }
    } catch (error) {
      logger.error('[Prefetcher] Failed to load history:', error);
    }
  }

  /**
   * 保存访问历史到存储
   */
  private saveHistory(): void {
    try {
      const data: StoredHistoryData = {
        history: this.accessHistory.slice(-this.historySize),
        stats: this.stats,
      };
      localStorage.setItem('file-access-history', JSON.stringify(data));
    } catch (error) {
      logger.error('[Prefetcher] Failed to save history:', error);
    }
  }

  /**
   * 记录文件访问
   * @param path - 文件路径
   * @param metadata - 访问元数据
   */
  recordAccess(path: string, metadata: FileAccessMetadata = {}): void {
    const access: AccessRecord = {
      path,
      timestamp: Date.now(),
      hour: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      ...metadata,
    };

    this.accessHistory.push(access);

    // 保持历史大小在限制内
    if (this.accessHistory.length > this.historySize) {
      this.accessHistory.shift();
    }

    // 更新模式
    this.updatePatterns(access);

    // 定期保存
    if (this.accessHistory.length % 10 === 0) {
      this.saveHistory();
    }

    // 进行预测和预取
    this.predictAndPrefetch(path, metadata);
  }

  /**
   * 更新访问模式
   * @param access - 访问记录
   */
  private updatePatterns(access: AccessRecord): void {
    const { path, hour, dayOfWeek } = access;

    // 更新文件序列 (这个文件之后打开什么)
    if (this.accessHistory.length >= 2) {
      const previousPath = this.accessHistory[this.accessHistory.length - 2]?.path;

      if (previousPath && previousPath !== path) {
        if (!this.fileSequences.has(previousPath)) {
          this.fileSequences.set(previousPath, []);
        }

        const sequences = this.fileSequences.get(previousPath)!;
        const existing = sequences.find((s) => s.nextPath === path);

        if (existing) {
          existing.count++;
        } else {
          sequences.push({ nextPath: path, count: 1 });
        }

        // 按计数排序
        sequences.sort((a, b) => b.count - a.count);
      }
    }

    // 更新小时模式
    if (!this.hourlyPatterns.has(hour)) {
      this.hourlyPatterns.set(hour, { paths: {} });
    }

    const hourlyData = this.hourlyPatterns.get(hour)!;
    hourlyData.paths[path] = (hourlyData.paths[path] || 0) + 1;

    // 更新星期模式
    if (!this.dayOfWeekPatterns.has(dayOfWeek)) {
      this.dayOfWeekPatterns.set(dayOfWeek, { paths: {} });
    }

    const dayData = this.dayOfWeekPatterns.get(dayOfWeek)!;
    dayData.paths[path] = (dayData.paths[path] || 0) + 1;

    // 更新文件关系 (一起打开的文件)
    const recentFiles = this.accessHistory.slice(-10).map((a) => a.path);

    if (!this.fileRelationships.has(path)) {
      this.fileRelationships.set(path, { related: {}, openedWith: {} });
    }

    const relationships = this.fileRelationships.get(path)!;

    recentFiles.forEach((relatedPath) => {
      if (relatedPath !== path) {
        relationships.openedWith[relatedPath] =
          (relationships.openedWith[relatedPath] || 0) + 1;
      }
    });
  }

  /**
   * 从历史重建模式
   */
  private rebuildPatterns(): void {
    this.fileSequences.clear();
    this.hourlyPatterns.clear();
    this.dayOfWeekPatterns.clear();
    this.fileRelationships.clear();

    this.accessHistory.forEach((access, index) => {
      // 临时设置历史以正确构建模式
      const tempHistory = this.accessHistory.slice(0, index + 1);
      const savedHistory = this.accessHistory;
      this.accessHistory = tempHistory;

      this.updatePatterns(access);

      this.accessHistory = savedHistory;
    });
  }

  /**
   * 预测下一个文件
   * @param currentPath - 当前文件路径
   * @param metadata - 文件元数据
   * @returns 预测结果数组
   */
  predictNextFiles(currentPath: string, metadata: FileAccessMetadata = {}): Prediction[] {
    const predictions: Prediction[] = [];
    this.stats.predictions++;

    // 1. 基于序列的预测
    const sequences = this.fileSequences.get(currentPath) || [];
    sequences.slice(0, 3).forEach(({ nextPath, count }) => {
      const totalAccess = this.accessHistory.filter((a) => a.path === currentPath).length;
      const confidence = count / Math.max(totalAccess, 1);

      predictions.push({
        path: nextPath,
        confidence,
        reason: 'sequence',
        score: confidence * 2, // 序列具有高预测性
      });
    });

    // 2. 基于文件关系的预测
    const relationships = this.fileRelationships.get(currentPath);
    if (relationships) {
      Object.entries(relationships.openedWith).forEach(([relatedPath, count]) => {
        const totalAccess = this.accessHistory.filter((a) => a.path === currentPath).length;
        const confidence = count / Math.max(totalAccess, 1);

        const existing = predictions.find((p) => p.path === relatedPath);
        if (existing) {
          existing.score += confidence;
        } else {
          predictions.push({
            path: relatedPath,
            confidence,
            reason: 'relationship',
            score: confidence,
          });
        }
      });
    }

    // 3. 基于时间的预测
    const currentHour = new Date().getHours();
    const hourlyData = this.hourlyPatterns.get(currentHour);

    if (hourlyData) {
      const totalHourAccess = Object.values(hourlyData.paths).reduce((a, b) => a + b, 0);

      Object.entries(hourlyData.paths).forEach(([path, count]) => {
        if (path !== currentPath) {
          const confidence = count / totalHourAccess;

          const existing = predictions.find((p) => p.path === path);
          if (existing) {
            existing.score += confidence * 0.5;
          } else {
            predictions.push({
              path,
              confidence,
              reason: 'time',
              score: confidence * 0.5,
            });
          }
        }
      });
    }

    // 4. 相似文件预测 (同目录, 同扩展名)
    if (metadata.directory) {
      const similarFiles = this.accessHistory
        .filter((a) => a.path !== currentPath && a.path.startsWith(metadata.directory!))
        .slice(-10);

      similarFiles.forEach(({ path }) => {
        const existing = predictions.find((p) => p.path === path);
        if (existing) {
          existing.score += 0.3;
        } else {
          predictions.push({
            path,
            confidence: 0.3,
            reason: 'similar',
            score: 0.3,
          });
        }
      });
    }

    // 按评分和置信度排序
    predictions.sort((a, b) => b.score - a.score);

    // 按最小置信度过滤
    const filtered = predictions
      .filter((p) => p.confidence >= this.minConfidence)
      .slice(0, this.maxPredictions);

    return filtered;
  }

  /**
   * 预测并预取文件
   * @param currentPath - 当前文件路径
   * @param metadata - 文件元数据
   */
  private async predictAndPrefetch(
    currentPath: string,
    metadata: FileAccessMetadata = {}
  ): Promise<void> {
    try {
      const predictions = this.predictNextFiles(currentPath, metadata);

      if (predictions.length === 0) {
        return;
      }

      logger.info(
        '[Prefetcher] Predictions:',
        predictions.map((p) => ({
          path: p.path.split('/').pop(),
          confidence: Math.round(p.confidence * 100) + '%',
          reason: p.reason,
        }))
      );

      // 添加到预取队列
      predictions.forEach((prediction) => {
        if (!this.prefetchQueue.find((p) => p.path === prediction.path)) {
          this.prefetchQueue.push(prediction);
        }
      });

      // 如果尚未运行，开始预取
      if (!this.prefetching) {
        setTimeout(() => this.processPrefetchQueue(), this.prefetchDelay);
      }
    } catch (error) {
      logger.error('[Prefetcher] Prediction error:', error);
    }
  }

  /**
   * 处理预取队列
   */
  private async processPrefetchQueue(): Promise<void> {
    if (this.prefetchQueue.length === 0) {
      this.prefetching = false;
      return;
    }

    this.prefetching = true;
    const prediction = this.prefetchQueue.shift()!;

    try {
      // 检查是否已预取
      if (this.prefetchedFiles.has(prediction.path)) {
        return;
      }

      // 检查是否在缓存中
      const cached = await indexedDBCache.getFile(prediction.path);
      if (cached) {
        const cachedData = typeof cached === 'object' && cached !== null ? cached : {};
        this.prefetchedFiles.set(prediction.path, {
          ...(cachedData as Record<string, unknown>),
          prefetchedAt: Date.now(),
          prediction,
        } as PrefetchedFileData);
        return;
      }

      // 预取文件
      const startTime = performance.now();
      const content = await window.electron?.invoke('read-file', { path: prediction.path });

      if (content) {
        // 缓存它
        await indexedDBCache.cacheFile(prediction.path, content);

        this.prefetchedFiles.set(prediction.path, {
          content,
          prefetchedAt: Date.now(),
          prediction,
        });

        this.stats.prefetches++;

        performanceTracker.trackFileOperation('prefetch-file', prediction.path, startTime);

        logger.info('[Prefetcher] Prefetched:', prediction.path.split('/').pop());
      }
    } catch (error) {
      logger.error('[Prefetcher] Prefetch error:', error);
    } finally {
      // 清理旧的预取文件 (保留5分钟)
      const now = Date.now();
      for (const [path, data] of this.prefetchedFiles.entries()) {
        if (now - data.prefetchedAt > 5 * 60 * 1000) {
          this.prefetchedFiles.delete(path);
        }
      }

      // 继续处理队列
      setTimeout(() => this.processPrefetchQueue(), 100);
    }
  }

  /**
   * 获取预取的文件
   * @param path - 文件路径
   * @returns 文件内容或null
   */
  getPrefetched(path: string): unknown | null {
    const data = this.prefetchedFiles.get(path);

    if (data) {
      this.stats.hits++;
      this.stats.accuracy = this.stats.hits / (this.stats.hits + this.stats.misses);

      logger.info('[Prefetcher] Prefetch hit:', path.split('/').pop());
      return data.content;
    }

    this.stats.misses++;
    this.stats.accuracy = this.stats.hits / (this.stats.hits + this.stats.misses);

    return null;
  }

  /**
   * 检查文件是否已预取
   * @param path - 文件路径
   * @returns 是否已预取
   */
  isPrefetched(path: string): boolean {
    return this.prefetchedFiles.has(path);
  }

  /**
   * 获取统计信息
   * @returns 扩展的统计信息
   */
  getStats(): ExtendedPrefetcherStats {
    return {
      ...this.stats,
      historySize: this.accessHistory.length,
      sequences: this.fileSequences.size,
      relationships: this.fileRelationships.size,
      prefetchedFiles: this.prefetchedFiles.size,
      queueLength: this.prefetchQueue.length,
      hitRate:
        this.stats.hits + this.stats.misses > 0
          ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
          : 0,
    };
  }

  /**
   * 清除历史
   */
  clearHistory(): void {
    this.accessHistory = [];
    this.fileSequences.clear();
    this.fileRelationships.clear();
    this.hourlyPatterns.clear();
    this.dayOfWeekPatterns.clear();
    this.saveHistory();
  }

  /**
   * 清除预取缓存
   */
  clearPrefetchCache(): void {
    this.prefetchedFiles.clear();
    this.prefetchQueue = [];
  }

  /**
   * 导出模式用于分析
   * @returns 导出的模式数据
   */
  exportPatterns(): ExportedPatterns {
    return {
      sequences: Array.from(this.fileSequences.entries()).map(([path, sequences]) => ({
        path,
        sequences: sequences.slice(0, 5),
      })),
      hourlyPatterns: Array.from(this.hourlyPatterns.entries()).map(([hour, data]) => ({
        hour,
        topPaths: Object.entries(data.paths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5) as [string, number][],
      })),
      dayOfWeekPatterns: Array.from(this.dayOfWeekPatterns.entries()).map(([day, data]) => ({
        day,
        topPaths: Object.entries(data.paths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5) as [string, number][],
      })),
      relationships: Array.from(this.fileRelationships.entries()).map(([path, rel]) => ({
        path,
        related: Object.entries(rel.openedWith)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5) as [string, number][],
      })),
    };
  }
}

// ==================== 单例实例 ====================

/** 预测性预取器单例实例 */
const predictivePrefetcher = new PredictivePrefetcher({
  maxPredictions: 5,
  minConfidence: 0.2,
  prefetchDelay: 500,
  historySize: 200,
});

export default predictivePrefetcher;

export { PredictivePrefetcher };
