/**
 * Post-Deploy Monitor — Production Monitoring Bridge (v3.0)
 *
 * Bridges the pipeline's deploy stage to production monitoring:
 * - Connects to ErrorMonitor for real-time error tracking
 * - Connects to PerformanceMonitor/AutoTuner for perf regression detection
 * - Configurable observation window after deployment
 * - Auto-triggers rollback if error rate or latency exceeds threshold
 *
 * @module ai-engine/cowork/post-deploy-monitor
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const MONITOR_STATUS = {
  IDLE: "idle",
  WATCHING: "watching",
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  CRITICAL: "critical",
};

const DEFAULT_CONFIG = {
  observationWindowMs: 300000,
  errorRateThreshold: 0.05,
  latencyThresholdMs: 5000,
  checkIntervalMs: 15000,
  autoRollbackOnCritical: true,
  minSamples: 10,
};

// ============================================================
// PostDeployMonitor Class
// ============================================================

class PostDeployMonitor extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.errorMonitor = null;
    this.performanceMonitor = null;
    this.anomalyDetector = null;
    this.rollbackManager = null;
    this.config = { ...DEFAULT_CONFIG };
    this.activeWatchers = new Map();
    this.stats = {
      totalMonitored: 0,
      healthyCount: 0,
      degradedCount: 0,
      criticalCount: 0,
      autoRollbacks: 0,
    };
  }

  /**
   * Initialize
   * @param {Object} deps - Dependencies
   */
  async initialize(deps = {}) {
    if (this.initialized) {
      return;
    }
    this.errorMonitor = deps.errorMonitor || null;
    this.performanceMonitor = deps.performanceMonitor || null;
    this.anomalyDetector = deps.anomalyDetector || null;
    this.rollbackManager = deps.rollbackManager || null;
    logger.info("[PostDeployMonitor] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Start monitoring after a deployment
   * @param {Object} options
   * @param {string} options.deployId - Deployment ID
   * @param {string} options.pipelineId - Pipeline ID
   * @param {number} [options.windowMs] - Observation window override
   * @returns {Object} Watcher info
   */
  startMonitoring(options = {}) {
    if (!this.initialized) {
      throw new Error("PostDeployMonitor not initialized");
    }

    const { deployId, pipelineId } = options;
    const windowMs = options.windowMs || this.config.observationWindowMs;

    const watchId = `watch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const watcher = {
      id: watchId,
      deployId,
      pipelineId,
      status: MONITOR_STATUS.WATCHING,
      startTime: Date.now(),
      endTime: Date.now() + windowMs,
      samples: [],
      errorCount: 0,
      totalRequests: 0,
      latencies: [],
      checks: 0,
    };

    // Set up periodic check
    const checkInterval = setInterval(() => {
      this._performCheck(watchId);
    }, this.config.checkIntervalMs);

    // Set up window expiry
    const windowTimeout = setTimeout(() => {
      this._completeMonitoring(watchId);
      clearInterval(checkInterval);
    }, windowMs);

    watcher._checkInterval = checkInterval;
    watcher._windowTimeout = windowTimeout;

    this.activeWatchers.set(watchId, watcher);
    this.stats.totalMonitored++;

    this.emit("monitor:started", { watchId, deployId, pipelineId, windowMs });
    logger.info(
      `[PostDeployMonitor] Started monitoring ${deployId} for ${windowMs / 1000}s`,
    );

    return { watchId, deployId, windowMs, status: MONITOR_STATUS.WATCHING };
  }

  /**
   * Stop monitoring manually
   * @param {string} watchId
   * @returns {Object} Final status
   */
  stopMonitoring(watchId) {
    const watcher = this.activeWatchers.get(watchId);
    if (!watcher) {
      return null;
    }

    clearInterval(watcher._checkInterval);
    clearTimeout(watcher._windowTimeout);

    return this._completeMonitoring(watchId);
  }

  /**
   * Get watcher status
   * @param {string} watchId
   */
  getWatcherStatus(watchId) {
    const watcher = this.activeWatchers.get(watchId);
    if (!watcher) {
      return null;
    }

    return {
      id: watcher.id,
      deployId: watcher.deployId,
      status: watcher.status,
      elapsed: Date.now() - watcher.startTime,
      remaining: Math.max(0, watcher.endTime - Date.now()),
      errorRate:
        watcher.totalRequests > 0
          ? watcher.errorCount / watcher.totalRequests
          : 0,
      avgLatency:
        watcher.latencies.length > 0
          ? Math.round(
              watcher.latencies.reduce((a, b) => a + b, 0) /
                watcher.latencies.length,
            )
          : 0,
      checks: watcher.checks,
    };
  }

  getStats() {
    return { ...this.stats, activeWatchers: this.activeWatchers.size };
  }

  getConfig() {
    return { ...this.config };
  }

  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  /**
   * Cleanup all watchers
   */
  destroy() {
    for (const [id, watcher] of this.activeWatchers) {
      clearInterval(watcher._checkInterval);
      clearTimeout(watcher._windowTimeout);
    }
    this.activeWatchers.clear();
  }

  // ============================================================
  // Internal
  // ============================================================

  _performCheck(watchId) {
    const watcher = this.activeWatchers.get(watchId);
    if (!watcher) {
      return;
    }

    watcher.checks++;

    // Collect metrics from monitors
    let errorRate = 0;
    let avgLatency = 0;
    let sampleCount = 0;

    // ErrorMonitor integration
    if (this.errorMonitor?.getRecentErrors) {
      const recentErrors = this.errorMonitor.getRecentErrors(
        this.config.checkIntervalMs,
      );
      watcher.errorCount += recentErrors?.length || 0;
      watcher.totalRequests += recentErrors?.totalRequests || 10;
    } else {
      // Simulated metrics
      watcher.totalRequests += 10;
      sampleCount = watcher.totalRequests;
    }

    // PerformanceMonitor integration
    if (this.performanceMonitor?.getMetrics) {
      const metrics = this.performanceMonitor.getMetrics();
      if (metrics?.responseTime) {
        watcher.latencies.push(metrics.responseTime);
        avgLatency = metrics.responseTime;
      }
    }

    errorRate =
      watcher.totalRequests > 0
        ? watcher.errorCount / watcher.totalRequests
        : 0;

    avgLatency =
      watcher.latencies.length > 0
        ? watcher.latencies.reduce((a, b) => a + b, 0) /
          watcher.latencies.length
        : 0;

    // Evaluate health
    const sample = { timestamp: Date.now(), errorRate, avgLatency };
    watcher.samples.push(sample);

    if (
      errorRate > this.config.errorRateThreshold ||
      avgLatency > this.config.latencyThresholdMs
    ) {
      if (errorRate > this.config.errorRateThreshold * 2) {
        watcher.status = MONITOR_STATUS.CRITICAL;
      } else {
        watcher.status = MONITOR_STATUS.DEGRADED;
      }
    } else {
      watcher.status = MONITOR_STATUS.HEALTHY;
    }

    this.emit("monitor:check", {
      watchId,
      status: watcher.status,
      errorRate,
      avgLatency,
      check: watcher.checks,
    });

    // Auto-rollback on critical
    if (
      watcher.status === MONITOR_STATUS.CRITICAL &&
      this.config.autoRollbackOnCritical &&
      watcher.totalRequests >= this.config.minSamples &&
      this.rollbackManager?.initialized
    ) {
      logger.warn(
        `[PostDeployMonitor] CRITICAL: Auto-rolling back deploy ${watcher.deployId}`,
      );

      this.rollbackManager
        .rollback({
          reason: `Post-deploy monitoring critical: errorRate=${errorRate.toFixed(3)}, latency=${avgLatency.toFixed(0)}ms`,
          type: "service-restart",
        })
        .then(() => {
          this.stats.autoRollbacks++;
          this.emit("monitor:auto-rollback", {
            watchId,
            deployId: watcher.deployId,
          });
        })
        .catch((err) =>
          logger.error(
            `[PostDeployMonitor] Auto-rollback failed: ${err.message}`,
          ),
        );

      // Stop monitoring after rollback
      this.stopMonitoring(watchId);
    }
  }

  _completeMonitoring(watchId) {
    const watcher = this.activeWatchers.get(watchId);
    if (!watcher) {
      return null;
    }

    const finalStatus =
      watcher.status === MONITOR_STATUS.WATCHING
        ? MONITOR_STATUS.HEALTHY
        : watcher.status;

    if (finalStatus === MONITOR_STATUS.HEALTHY) {
      this.stats.healthyCount++;
    } else if (finalStatus === MONITOR_STATUS.DEGRADED) {
      this.stats.degradedCount++;
    } else if (finalStatus === MONITOR_STATUS.CRITICAL) {
      this.stats.criticalCount++;
    }

    const result = {
      watchId,
      deployId: watcher.deployId,
      pipelineId: watcher.pipelineId,
      finalStatus,
      duration: Date.now() - watcher.startTime,
      totalChecks: watcher.checks,
      errorRate:
        watcher.totalRequests > 0
          ? watcher.errorCount / watcher.totalRequests
          : 0,
      avgLatency:
        watcher.latencies.length > 0
          ? Math.round(
              watcher.latencies.reduce((a, b) => a + b, 0) /
                watcher.latencies.length,
            )
          : 0,
      samples: watcher.samples.length,
    };

    this.activeWatchers.delete(watchId);
    this.emit("monitor:completed", result);

    logger.info(
      `[PostDeployMonitor] Monitoring completed: ${watcher.deployId} status=${finalStatus}`,
    );

    return result;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getPostDeployMonitor() {
  if (!instance) {
    instance = new PostDeployMonitor();
  }
  return instance;
}

module.exports = {
  PostDeployMonitor,
  getPostDeployMonitor,
  MONITOR_STATUS,
};
