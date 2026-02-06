/**
 * Advanced Analytics
 * Provides insights into usage patterns, performance trends, and optimization opportunities
 */

import { logger } from '@/utils/logger';
import performanceTracker from './performance-tracker';
import predictivePrefetcher from './predictive-prefetcher';
import adaptivePerformance from './adaptive-performance';

// ==================== 类型定义 ====================

/**
 * 分析事件
 */
export interface AnalyticsEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

/**
 * 用户行为数据
 */
export interface UserBehavior {
  fileEdits: AnalyticsEvent[];
  navigation: AnalyticsEvent[];
  searches: AnalyticsEvent[];
  interactions: AnalyticsEvent[];
}

/**
 * 性能趋势数据点
 */
export interface TrendDataPoint {
  timestamp: number;
  value: number;
}

/**
 * 缓存性能数据点
 */
export interface CacheTrendDataPoint {
  timestamp: number;
  hitRate: number;
}

/**
 * 性能趋势
 */
export interface PerformanceTrends {
  fileLoadTimes: TrendDataPoint[];
  renderTimes: TrendDataPoint[];
  memoryUsage: TrendDataPoint[];
  cachePerformance: CacheTrendDataPoint[];
}

/**
 * 错误记录
 */
export interface ErrorRecord {
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  type?: string;
  timestamp: number;
  sessionId: string;
  [key: string]: unknown;
}

/**
 * 警告记录
 */
export interface WarningRecord {
  message?: string;
  timestamp: number;
  sessionId: string;
  [key: string]: unknown;
}

/**
 * 推荐
 */
export interface Recommendation {
  type: 'performance' | 'memory' | 'cache' | 'feature' | 'error';
  priority: 'high' | 'medium' | 'low';
  message: string;
  action: string;
}

/**
 * 文件加载趋势洞察
 */
export interface FileLoadTrendInsight {
  recentAvg: number;
  olderAvg: number;
  change: number;
  improving: boolean;
}

/**
 * 内存使用洞察
 */
export interface MemoryUsageInsight {
  average: number;
  peak: number;
  trend: 'increasing' | 'stable';
}

/**
 * 缓存性能洞察
 */
export interface CachePerformanceInsight {
  averageHitRate: number;
  effective: boolean;
}

/**
 * 性能洞察
 */
export interface PerformanceInsights {
  fileLoadTrend?: FileLoadTrendInsight;
  memoryUsage?: MemoryUsageInsight;
  cachePerformance?: CachePerformanceInsight;
}

/**
 * 功能使用项
 */
export interface FeatureUsageItem {
  feature: string;
  count: number;
}

/**
 * 事件类型计数项
 */
export interface EventTypeCountItem {
  type: string;
  count: number;
}

/**
 * 使用洞察
 */
export interface UsageInsights {
  topFeatures: FeatureUsageItem[];
  topEventTypes: EventTypeCountItem[];
  sessionDuration: number;
  totalEvents: number;
}

/**
 * 文件类型偏好
 */
export type FileTypePreference = [string, number];

/**
 * 搜索使用洞察
 */
export interface SearchUsageInsight {
  frequency: number;
  heavy: boolean;
}

/**
 * 模式洞察
 */
export interface PatternInsights {
  preferredFileTypes?: FileTypePreference[];
  searchUsage?: SearchUsageInsight;
}

/**
 * 分析洞察
 */
export interface AnalysisInsights {
  performance: PerformanceInsights;
  usage: UsageInsights;
  patterns: PatternInsights;
}

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  duration: number;
  startTime: number;
}

/**
 * 综合报告
 */
export interface AnalyticsReport {
  session: SessionInfo;
  performance: {
    trends: PerformanceTrends;
    current: ReturnType<typeof performanceTracker.getAllMetrics>;
  };
  prefetcher: ReturnType<typeof predictivePrefetcher.getStats>;
  adaptive: ReturnType<typeof adaptivePerformance.getStats>;
  usage: UsageInsights;
  patterns: PatternInsights;
  recommendations: Recommendation[];
  errors: ErrorRecord[];
  warnings: WarningRecord[];
}

/**
 * 摘要统计
 */
export interface AnalyticsSummary {
  sessionDuration: number;
  eventsTracked: number;
  performance: PerformanceInsights;
  topFeatures: FeatureUsageItem[];
  recommendations: number;
  errors: number;
  warnings: number;
}

/**
 * 导出数据
 */
export interface ExportData {
  session: {
    id: string;
    start: number;
    duration: number;
  };
  events: AnalyticsEvent[];
  performanceTrends: PerformanceTrends;
  featureUsage: [string, number][];
  userBehavior: UserBehavior;
  errors: ErrorRecord[];
  warnings: WarningRecord[];
  recommendations: Recommendation[];
}

// ==================== 高级分析类 ====================

class AdvancedAnalytics {
  // Session tracking
  private sessionStart: number;
  private sessionId: string;

  // Event tracking
  private events: AnalyticsEvent[];
  private eventTypes: Map<string, number>;

  // User behavior
  private userBehavior: UserBehavior;

  // Performance trends
  private performanceTrends: PerformanceTrends;

  // Feature usage
  private featureUsage: Map<string, number>;

  // Errors and warnings
  private errors: ErrorRecord[];
  private warnings: WarningRecord[];

  // Recommendations
  private recommendations: Recommendation[];

  // Intervals
  private collectionInterval: ReturnType<typeof setInterval> | null = null;
  private analysisInterval: ReturnType<typeof setInterval> | null = null;
  private saveInterval: ReturnType<typeof setInterval> | null = null;

  // Bound event handlers
  private _handleBeforeUnload: () => void;
  private _handleError: (event: ErrorEvent) => void;
  private _handleUnhandledRejection: (event: PromiseRejectionEvent) => void;

  constructor() {
    // Session tracking
    this.sessionStart = Date.now();
    this.sessionId = this.generateSessionId();

    // Event tracking
    this.events = [];
    this.eventTypes = new Map();

    // User behavior
    this.userBehavior = {
      fileEdits: [],
      navigation: [],
      searches: [],
      interactions: [],
    };

    // Performance trends
    this.performanceTrends = {
      fileLoadTimes: [],
      renderTimes: [],
      memoryUsage: [],
      cachePerformance: [],
    };

    // Feature usage
    this.featureUsage = new Map();

    // Errors and warnings
    this.errors = [];
    this.warnings = [];

    // Recommendations
    this.recommendations = [];

    // Bind event handlers
    this._handleBeforeUnload = this.handleBeforeUnload.bind(this);
    this._handleError = this.handleError.bind(this);
    this._handleUnhandledRejection = this.handleUnhandledRejection.bind(this);

    // Start collecting
    this.startCollection();
    this.loadHistory();
  }

  /**
   * Handle beforeunload event
   */
  private handleBeforeUnload(): void {
    this.trackEvent('session-end', {
      duration: Date.now() - this.sessionStart,
    });
    this.saveData();
  }

  /**
   * Handle error event
   */
  private handleError(event: ErrorEvent): void {
    this.trackError({
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  }

  /**
   * Handle unhandled rejection event
   */
  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    this.trackError({
      message: event.reason?.message || 'Unhandled Promise Rejection',
      type: 'promise',
    });
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Load historical data
   */
  private loadHistory(): void {
    try {
      const stored = localStorage.getItem('analytics-history');
      if (stored) {
        const data = JSON.parse(stored) as {
          performanceTrends?: PerformanceTrends;
          featureUsage?: [string, number][];
        };
        this.performanceTrends = data.performanceTrends || this.performanceTrends;
        this.featureUsage = new Map(data.featureUsage || []);

        logger.info('[Analytics] Loaded historical data');
      }
    } catch (error) {
      logger.error('[Analytics] Failed to load history:', { error });
    }
  }

  /**
   * Save data to storage
   */
  private saveData(): void {
    try {
      localStorage.setItem(
        'analytics-history',
        JSON.stringify({
          performanceTrends: this.performanceTrends,
          featureUsage: Array.from(this.featureUsage.entries()),
        })
      );
    } catch (error) {
      logger.error('[Analytics] Failed to save data:', { error });
    }
  }

  /**
   * Start data collection
   */
  private startCollection(): void {
    // Collect metrics every 10 seconds
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
    }, 10000);

    // Analyze and generate recommendations every minute
    this.analysisInterval = setInterval(() => {
      this.analyze();
      this.generateRecommendations();
    }, 60000);

    // Save data every 5 minutes
    this.saveInterval = setInterval(
      () => {
        this.saveData();
      },
      5 * 60 * 1000
    );

    // Track window/tab events
    window.addEventListener('beforeunload', this._handleBeforeUnload);
    window.addEventListener('error', this._handleError);
    window.addEventListener('unhandledrejection', this._handleUnhandledRejection);
  }

  /**
   * Collect current metrics
   */
  private collectMetrics(): void {
    const timestamp = Date.now();

    // Performance metrics
    const perfMetrics = performanceTracker.getAllMetrics();

    if (perfMetrics.fileOperations.avgTime) {
      this.performanceTrends.fileLoadTimes.push({
        timestamp,
        value: perfMetrics.fileOperations.avgTime,
      });
    }

    if (perfMetrics.cache.hitRate !== undefined) {
      this.performanceTrends.cachePerformance.push({
        timestamp,
        hitRate: perfMetrics.cache.hitRate,
      });
    }

    // Memory usage
    const extendedPerformance = performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
    if (extendedPerformance.memory) {
      const memoryUsage = Math.round(
        (extendedPerformance.memory.usedJSHeapSize /
          extendedPerformance.memory.jsHeapSizeLimit) *
          100
      );

      this.performanceTrends.memoryUsage.push({
        timestamp,
        value: memoryUsage,
      });
    }

    // Keep only last 100 data points for each metric
    (Object.keys(this.performanceTrends) as (keyof PerformanceTrends)[]).forEach((key) => {
      if (this.performanceTrends[key].length > 100) {
        this.performanceTrends[key] = this.performanceTrends[key].slice(-100) as typeof this.performanceTrends[typeof key];
      }
    });
  }

  /**
   * Track event
   */
  trackEvent(type: string, data: Record<string, unknown> = {}): void {
    const event: AnalyticsEvent = {
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      data,
    };

    this.events.push(event);

    // Update event type counter
    const count = this.eventTypes.get(type) || 0;
    this.eventTypes.set(type, count + 1);

    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events.shift();
    }

    // Track user behavior based on event type
    if (type.startsWith('file-')) {
      this.userBehavior.fileEdits.push(event);
      if (this.userBehavior.fileEdits.length > 100) {
        this.userBehavior.fileEdits.shift();
      }
    } else if (type.startsWith('navigate-')) {
      this.userBehavior.navigation.push(event);
      if (this.userBehavior.navigation.length > 100) {
        this.userBehavior.navigation.shift();
      }
    } else if (type === 'search') {
      this.userBehavior.searches.push(event);
      if (this.userBehavior.searches.length > 100) {
        this.userBehavior.searches.shift();
      }
    }
  }

  /**
   * Track feature usage
   */
  trackFeature(feature: string, action: string = 'used'): void {
    const key = `${feature}:${action}`;
    const count = this.featureUsage.get(key) || 0;
    this.featureUsage.set(key, count + 1);

    this.trackEvent('feature-usage', { feature, action });
  }

  /**
   * Track error
   */
  trackError(error: Omit<ErrorRecord, 'timestamp' | 'sessionId'>): void {
    this.errors.push({
      ...error,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });

    // Keep only last 50 errors
    if (this.errors.length > 50) {
      this.errors.shift();
    }

    this.trackEvent('error', error as Record<string, unknown>);
  }

  /**
   * Track warning
   */
  trackWarning(warning: Omit<WarningRecord, 'timestamp' | 'sessionId'>): void {
    this.warnings.push({
      ...warning,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });

    // Keep only last 50 warnings
    if (this.warnings.length > 50) {
      this.warnings.shift();
    }

    this.trackEvent('warning', warning as Record<string, unknown>);
  }

  /**
   * Analyze collected data
   */
  analyze(): AnalysisInsights {
    const insights: AnalysisInsights = {
      performance: this.analyzePerformance(),
      usage: this.analyzeUsage(),
      patterns: this.analyzePatterns(),
    };

    logger.info('[Analytics] Analysis:', insights);
    return insights;
  }

  /**
   * Analyze performance trends
   */
  private analyzePerformance(): PerformanceInsights {
    const insights: PerformanceInsights = {};

    // Analyze file load times
    if (this.performanceTrends.fileLoadTimes.length > 10) {
      const times = this.performanceTrends.fileLoadTimes.map((d) => d.value);
      const recent = times.slice(-10);
      const older = times.slice(-30, -10);

      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg =
        older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;

      insights.fileLoadTrend = {
        recentAvg: Math.round(recentAvg),
        olderAvg: Math.round(olderAvg),
        change: Math.round(((recentAvg - olderAvg) / olderAvg) * 100),
        improving: recentAvg < olderAvg,
      };
    }

    // Analyze memory usage
    if (this.performanceTrends.memoryUsage.length > 10) {
      const usage = this.performanceTrends.memoryUsage.map((d) => d.value);
      const avgUsage = usage.reduce((a, b) => a + b, 0) / usage.length;
      const maxUsage = Math.max(...usage);

      insights.memoryUsage = {
        average: Math.round(avgUsage),
        peak: maxUsage,
        trend:
          usage.slice(-5).reduce((a, b) => a + b, 0) / 5 > avgUsage ? 'increasing' : 'stable',
      };
    }

    // Analyze cache performance
    if (this.performanceTrends.cachePerformance.length > 10) {
      const hitRates = this.performanceTrends.cachePerformance.map((d) => d.hitRate);
      const avgHitRate = hitRates.reduce((a, b) => a + b, 0) / hitRates.length;

      insights.cachePerformance = {
        averageHitRate: Math.round(avgHitRate),
        effective: avgHitRate > 60,
      };
    }

    return insights;
  }

  /**
   * Analyze feature usage
   */
  private analyzeUsage(): UsageInsights {
    const topFeatures = Array.from(this.featureUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([feature, count]) => ({ feature, count }));

    const eventTypeCounts = Array.from(this.eventTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    return {
      topFeatures,
      topEventTypes: eventTypeCounts,
      sessionDuration: Date.now() - this.sessionStart,
      totalEvents: this.events.length,
    };
  }

  /**
   * Analyze user behavior patterns
   */
  private analyzePatterns(): PatternInsights {
    const patterns: PatternInsights = {};

    // File editing patterns
    if (this.userBehavior.fileEdits.length > 10) {
      const fileTypes: Record<string, number> = {};
      this.userBehavior.fileEdits.forEach((event) => {
        const path = event.data?.path as string | undefined;
        const ext = path?.split('.').pop();
        if (ext) {
          fileTypes[ext] = (fileTypes[ext] || 0) + 1;
        }
      });

      patterns.preferredFileTypes = Object.entries(fileTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5) as FileTypePreference[];
    }

    // Search patterns
    if (this.userBehavior.searches.length > 5) {
      const searchFrequency =
        this.userBehavior.searches.length / ((Date.now() - this.sessionStart) / (60 * 1000));

      patterns.searchUsage = {
        frequency: searchFrequency, // searches per minute
        heavy: searchFrequency > 1,
      };
    }

    return patterns;
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(): void {
    this.recommendations = [];

    const analysis = this.analyze();

    // Performance recommendations
    if (analysis.performance.fileLoadTrend?.change && analysis.performance.fileLoadTrend.change > 20) {
      this.recommendations.push({
        type: 'performance',
        priority: 'high',
        message:
          'File load times have increased by ' +
          analysis.performance.fileLoadTrend.change +
          '%. Consider clearing cache or reducing batch sizes.',
        action: 'optimize-file-loading',
      });
    }

    if (analysis.performance.memoryUsage?.average && analysis.performance.memoryUsage.average > 80) {
      this.recommendations.push({
        type: 'memory',
        priority: 'high',
        message:
          'Memory usage is high (avg ' +
          analysis.performance.memoryUsage.average +
          '%). Consider closing unused files or clearing cache.',
        action: 'reduce-memory',
      });
    }

    if (analysis.performance.cachePerformance?.averageHitRate !== undefined &&
        analysis.performance.cachePerformance.averageHitRate < 50) {
      this.recommendations.push({
        type: 'cache',
        priority: 'medium',
        message:
          'Cache hit rate is low (' +
          analysis.performance.cachePerformance.averageHitRate +
          '%). Consider increasing cache size.',
        action: 'increase-cache',
      });
    }

    // Feature recommendations
    const prefetcherStats = predictivePrefetcher.getStats();
    if (prefetcherStats.hitRate > 70) {
      this.recommendations.push({
        type: 'feature',
        priority: 'low',
        message:
          'Predictive prefetching is working well with ' + prefetcherStats.hitRate + '% hit rate.',
        action: 'keep-prefetching',
      });
    } else if (prefetcherStats.hitRate < 30 && prefetcherStats.prefetches > 10) {
      this.recommendations.push({
        type: 'feature',
        priority: 'medium',
        message:
          'Predictive prefetching has low accuracy (' +
          prefetcherStats.hitRate +
          '%). Consider adjusting settings or disabling.',
        action: 'adjust-prefetching',
      });
    }

    // Error recommendations
    if (this.errors.length > 10) {
      const recentErrors = this.errors.slice(-10);
      const errorTypes: Record<string, number> = {};

      recentErrors.forEach((error) => {
        const key = error.message || 'unknown';
        errorTypes[key] = (errorTypes[key] || 0) + 1;
      });

      const mostCommon = Object.entries(errorTypes).sort((a, b) => b[1] - a[1])[0];

      if (mostCommon && mostCommon[1] > 3) {
        this.recommendations.push({
          type: 'error',
          priority: 'high',
          message: `Recurring error detected: "${mostCommon[0]}" (${mostCommon[1]} times)`,
          action: 'fix-error',
        });
      }
    }

    logger.info(`[Analytics] Generated ${this.recommendations.length} recommendations`);
  }

  /**
   * Get comprehensive report
   */
  getReport(): AnalyticsReport {
    return {
      session: {
        id: this.sessionId,
        duration: Date.now() - this.sessionStart,
        startTime: this.sessionStart,
      },
      performance: {
        trends: this.performanceTrends,
        current: performanceTracker.getAllMetrics(),
      },
      prefetcher: predictivePrefetcher.getStats(),
      adaptive: adaptivePerformance.getStats(),
      usage: this.analyzeUsage(),
      patterns: this.analyzePatterns(),
      recommendations: this.recommendations,
      errors: this.errors.slice(-10),
      warnings: this.warnings.slice(-10),
    };
  }

  /**
   * Get summary statistics
   */
  getSummary(): AnalyticsSummary {
    const analysis = this.analyze();

    return {
      sessionDuration: Math.round((Date.now() - this.sessionStart) / 1000 / 60), // minutes
      eventsTracked: this.events.length,
      performance: analysis.performance,
      topFeatures: analysis.usage.topFeatures.slice(0, 5),
      recommendations: this.recommendations.length,
      errors: this.errors.length,
      warnings: this.warnings.length,
    };
  }

  /**
   * Export data for analysis
   */
  exportData(): ExportData {
    return {
      session: {
        id: this.sessionId,
        start: this.sessionStart,
        duration: Date.now() - this.sessionStart,
      },
      events: this.events,
      performanceTrends: this.performanceTrends,
      featureUsage: Array.from(this.featureUsage.entries()),
      userBehavior: this.userBehavior,
      errors: this.errors,
      warnings: this.warnings,
      recommendations: this.recommendations,
    };
  }

  /**
   * Clear all data
   */
  clearData(): void {
    this.events = [];
    this.eventTypes.clear();
    this.userBehavior = {
      fileEdits: [],
      navigation: [],
      searches: [],
      interactions: [],
    };
    this.performanceTrends = {
      fileLoadTimes: [],
      renderTimes: [],
      memoryUsage: [],
      cachePerformance: [],
    };
    this.featureUsage.clear();
    this.errors = [];
    this.warnings = [];
    this.recommendations = [];

    localStorage.removeItem('analytics-history');
    logger.info('[Analytics] Data cleared');
  }

  /**
   * Stop collection
   */
  stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    // Remove event listeners
    window.removeEventListener('beforeunload', this._handleBeforeUnload);
    window.removeEventListener('error', this._handleError);
    window.removeEventListener('unhandledrejection', this._handleUnhandledRejection);

    this.saveData();
    logger.info('[Analytics] Collection stopped');
  }
}

// Create singleton instance
const advancedAnalytics = new AdvancedAnalytics();

export default advancedAnalytics;

export { AdvancedAnalytics };
