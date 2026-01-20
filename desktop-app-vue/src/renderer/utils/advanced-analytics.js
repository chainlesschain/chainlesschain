/**
 * Advanced Analytics
 * Provides insights into usage patterns, performance trends, and optimization opportunities
 */

import { logger, createLogger } from "@/utils/logger";
import performanceTracker from "./performance-tracker";
import predictivePrefetcher from "./predictive-prefetcher";
import adaptivePerformance from "./adaptive-performance";

class AdvancedAnalytics {
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

    // 绑定事件处理器引用，以便后续移除
    this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
    this._handleError = this._handleError.bind(this);
    this._handleUnhandledRejection = this._handleUnhandledRejection.bind(this);

    // Start collecting
    this.startCollection();
    this.loadHistory();
  }

  /**
   * Handle beforeunload event
   */
  _handleBeforeUnload() {
    this.trackEvent("session-end", {
      duration: Date.now() - this.sessionStart,
    });
    this.saveData();
  }

  /**
   * Handle error event
   */
  _handleError(event) {
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
  _handleUnhandledRejection(event) {
    this.trackError({
      message: event.reason?.message || "Unhandled Promise Rejection",
      type: "promise",
    });
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Load historical data
   */
  loadHistory() {
    try {
      const stored = localStorage.getItem("analytics-history");
      if (stored) {
        const data = JSON.parse(stored);
        this.performanceTrends =
          data.performanceTrends || this.performanceTrends;
        this.featureUsage = new Map(data.featureUsage || []);

        logger.info("[Analytics] Loaded historical data");
      }
    } catch (error) {
      logger.error("[Analytics] Failed to load history:", error);
    }
  }

  /**
   * Save data to storage
   */
  saveData() {
    try {
      localStorage.setItem(
        "analytics-history",
        JSON.stringify({
          performanceTrends: this.performanceTrends,
          featureUsage: Array.from(this.featureUsage.entries()),
        }),
      );
    } catch (error) {
      logger.error("[Analytics] Failed to save data:", error);
    }
  }

  /**
   * Start data collection
   */
  startCollection() {
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
      5 * 60 * 1000,
    );

    // Track window/tab events - 使用绑定的处理器以便后续移除
    window.addEventListener("beforeunload", this._handleBeforeUnload);
    window.addEventListener("error", this._handleError);
    window.addEventListener(
      "unhandledrejection",
      this._handleUnhandledRejection,
    );
  }

  /**
   * Collect current metrics
   */
  collectMetrics() {
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
    if (performance.memory) {
      const memoryUsage = Math.round(
        (performance.memory.usedJSHeapSize /
          performance.memory.jsHeapSizeLimit) *
          100,
      );

      this.performanceTrends.memoryUsage.push({
        timestamp,
        value: memoryUsage,
      });
    }

    // Keep only last 100 data points for each metric
    Object.keys(this.performanceTrends).forEach((key) => {
      if (this.performanceTrends[key].length > 100) {
        this.performanceTrends[key] = this.performanceTrends[key].slice(-100);
      }
    });
  }

  /**
   * Track event
   */
  trackEvent(type, data = {}) {
    const event = {
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
    if (type.startsWith("file-")) {
      this.userBehavior.fileEdits.push(event);
      if (this.userBehavior.fileEdits.length > 100) {
        this.userBehavior.fileEdits.shift();
      }
    } else if (type.startsWith("navigate-")) {
      this.userBehavior.navigation.push(event);
      if (this.userBehavior.navigation.length > 100) {
        this.userBehavior.navigation.shift();
      }
    } else if (type === "search") {
      this.userBehavior.searches.push(event);
      if (this.userBehavior.searches.length > 100) {
        this.userBehavior.searches.shift();
      }
    }
  }

  /**
   * Track feature usage
   */
  trackFeature(feature, action = "used") {
    const key = `${feature}:${action}`;
    const count = this.featureUsage.get(key) || 0;
    this.featureUsage.set(key, count + 1);

    this.trackEvent("feature-usage", { feature, action });
  }

  /**
   * Track error
   */
  trackError(error) {
    this.errors.push({
      ...error,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });

    // Keep only last 50 errors
    if (this.errors.length > 50) {
      this.errors.shift();
    }

    this.trackEvent("error", error);
  }

  /**
   * Track warning
   */
  trackWarning(warning) {
    this.warnings.push({
      ...warning,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });

    // Keep only last 50 warnings
    if (this.warnings.length > 50) {
      this.warnings.shift();
    }

    this.trackEvent("warning", warning);
  }

  /**
   * Analyze collected data
   */
  analyze() {
    const insights = {
      performance: this.analyzePerformance(),
      usage: this.analyzeUsage(),
      patterns: this.analyzePatterns(),
    };

    logger.info("[Analytics] Analysis:", insights);
    return insights;
  }

  /**
   * Analyze performance trends
   */
  analyzePerformance() {
    const insights = {};

    // Analyze file load times
    if (this.performanceTrends.fileLoadTimes.length > 10) {
      const times = this.performanceTrends.fileLoadTimes.map((d) => d.value);
      const recent = times.slice(-10);
      const older = times.slice(-30, -10);

      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg =
        older.length > 0
          ? older.reduce((a, b) => a + b, 0) / older.length
          : recentAvg;

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
          usage.slice(-5).reduce((a, b) => a + b, 0) / 5 > avgUsage
            ? "increasing"
            : "stable",
      };
    }

    // Analyze cache performance
    if (this.performanceTrends.cachePerformance.length > 10) {
      const hitRates = this.performanceTrends.cachePerformance.map(
        (d) => d.hitRate,
      );
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
  analyzeUsage() {
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
  analyzePatterns() {
    const patterns = {};

    // File editing patterns
    if (this.userBehavior.fileEdits.length > 10) {
      const fileTypes = {};
      this.userBehavior.fileEdits.forEach((event) => {
        const ext = event.data?.path?.split(".").pop();
        if (ext) {
          fileTypes[ext] = (fileTypes[ext] || 0) + 1;
        }
      });

      patterns.preferredFileTypes = Object.entries(fileTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    }

    // Search patterns
    if (this.userBehavior.searches.length > 5) {
      const searchFrequency =
        this.userBehavior.searches.length /
        ((Date.now() - this.sessionStart) / (60 * 1000));

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
  generateRecommendations() {
    this.recommendations = [];

    const analysis = this.analyze();

    // Performance recommendations
    if (analysis.performance.fileLoadTrend?.change > 20) {
      this.recommendations.push({
        type: "performance",
        priority: "high",
        message:
          "File load times have increased by " +
          analysis.performance.fileLoadTrend.change +
          "%. Consider clearing cache or reducing batch sizes.",
        action: "optimize-file-loading",
      });
    }

    if (analysis.performance.memoryUsage?.average > 80) {
      this.recommendations.push({
        type: "memory",
        priority: "high",
        message:
          "Memory usage is high (avg " +
          analysis.performance.memoryUsage.average +
          "%). Consider closing unused files or clearing cache.",
        action: "reduce-memory",
      });
    }

    if (analysis.performance.cachePerformance?.averageHitRate < 50) {
      this.recommendations.push({
        type: "cache",
        priority: "medium",
        message:
          "Cache hit rate is low (" +
          analysis.performance.cachePerformance.averageHitRate +
          "%). Consider increasing cache size.",
        action: "increase-cache",
      });
    }

    // Feature recommendations
    const prefetcherStats = predictivePrefetcher.getStats();
    if (prefetcherStats.hitRate > 70) {
      this.recommendations.push({
        type: "feature",
        priority: "low",
        message:
          "Predictive prefetching is working well with " +
          prefetcherStats.hitRate +
          "% hit rate.",
        action: "keep-prefetching",
      });
    } else if (
      prefetcherStats.hitRate < 30 &&
      prefetcherStats.prefetches > 10
    ) {
      this.recommendations.push({
        type: "feature",
        priority: "medium",
        message:
          "Predictive prefetching has low accuracy (" +
          prefetcherStats.hitRate +
          "%). Consider adjusting settings or disabling.",
        action: "adjust-prefetching",
      });
    }

    // Error recommendations
    if (this.errors.length > 10) {
      const recentErrors = this.errors.slice(-10);
      const errorTypes = {};

      recentErrors.forEach((error) => {
        const key = error.message || "unknown";
        errorTypes[key] = (errorTypes[key] || 0) + 1;
      });

      const mostCommon = Object.entries(errorTypes).sort(
        (a, b) => b[1] - a[1],
      )[0];

      if (mostCommon && mostCommon[1] > 3) {
        this.recommendations.push({
          type: "error",
          priority: "high",
          message: `Recurring error detected: "${mostCommon[0]}" (${mostCommon[1]} times)`,
          action: "fix-error",
        });
      }
    }

    logger.info(
      "[Analytics] Generated",
      this.recommendations.length,
      "recommendations",
    );
  }

  /**
   * Get comprehensive report
   */
  getReport() {
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
  getSummary() {
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
  exportData() {
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
  clearData() {
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

    localStorage.removeItem("analytics-history");
    logger.info("[Analytics] Data cleared");
  }

  /**
   * Stop collection
   */
  stop() {
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

    // 移除事件监听器
    window.removeEventListener("beforeunload", this._handleBeforeUnload);
    window.removeEventListener("error", this._handleError);
    window.removeEventListener(
      "unhandledrejection",
      this._handleUnhandledRejection,
    );

    this.saveData();
    logger.info("[Analytics] Collection stopped");
  }
}

// Create singleton instance
const advancedAnalytics = new AdvancedAnalytics();

export default advancedAnalytics;

export { AdvancedAnalytics };
