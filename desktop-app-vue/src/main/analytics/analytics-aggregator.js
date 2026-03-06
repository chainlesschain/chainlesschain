/**
 * Analytics Aggregator - Unified metrics collector/aggregator
 *
 * Collects metrics from TokenTracker, SkillMetrics, ErrorMonitor,
 * and PerformanceMonitor, aggregates them on a periodic schedule,
 * and pushes real-time snapshots to the renderer process.
 *
 * @module analytics/analytics-aggregator
 * @version 1.0.0
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

class AnalyticsAggregator extends EventEmitter {
  constructor() {
    super();
    this.database = null;
    this.tokenTracker = null;
    this.skillMetrics = null;
    this.errorMonitor = null;
    this.performanceMonitor = null;
    this.initialized = false;
    this.aggregationInterval = null;
    this.realtimePushInterval = null;
    this.mainWindow = null;
    this.config = {
      aggregationIntervalMs: 300000, // 5 min
      realtimePushIntervalMs: 5000, // 5s for real-time dashboard
      retentionDays: 90,
    };
  }

  /**
   * Initialize the aggregator with dependencies
   * @param {Object} dependencies - External service references
   * @param {Object} dependencies.database - SQLite database instance
   * @param {Object} dependencies.tokenTracker - Token usage tracker
   * @param {Object} dependencies.skillMetrics - Skill metrics collector
   * @param {Object} dependencies.errorMonitor - Error monitor instance
   * @param {Object} dependencies.performanceMonitor - Performance monitor instance
   * @param {Object} dependencies.mainWindow - Electron BrowserWindow
   */
  async initialize(dependencies) {
    if (this.initialized) {
      logger.warn("[Analytics] Aggregator already initialized");
      return;
    }

    const {
      database,
      tokenTracker,
      skillMetrics,
      errorMonitor,
      performanceMonitor,
      mainWindow,
    } = dependencies || {};

    this.database = database || null;
    this.tokenTracker = tokenTracker || null;
    this.skillMetrics = skillMetrics || null;
    this.errorMonitor = errorMonitor || null;
    this.performanceMonitor = performanceMonitor || null;
    this.mainWindow = mainWindow || null;

    // Ensure aggregation table exists
    this._ensureTable();

    this.initialized = true;
    logger.info("[Analytics] Aggregator initialized");
  }

  /**
   * Create the analytics_aggregations table if it does not exist
   * @private
   */
  _ensureTable() {
    if (!this.database) {return;}

    try {
      const db = this.database.db || this.database;
      db.exec(`
        CREATE TABLE IF NOT EXISTS analytics_aggregations (
          id TEXT PRIMARY KEY,
          bucket_key TEXT NOT NULL,
          granularity TEXT NOT NULL DEFAULT 'hourly',
          metrics TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Index for time-range queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_analytics_agg_bucket
        ON analytics_aggregations (granularity, bucket_key)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_analytics_agg_created
        ON analytics_aggregations (created_at)
      `);
    } catch (error) {
      logger.warn(
        "[Analytics] Failed to ensure aggregation table:",
        error.message,
      );
    }
  }

  /**
   * Get the underlying DB connection (handles DatabaseManager wrappers)
   * @private
   * @returns {Object|null}
   */
  _getDb() {
    if (!this.database) {return null;}
    return this.database.db || this.database;
  }

  /**
   * Start periodic aggregation and real-time pushes
   */
  start() {
    if (this.aggregationInterval) {
      logger.warn("[Analytics] Already started");
      return;
    }

    this.aggregationInterval = setInterval(
      () => this._aggregate(),
      this.config.aggregationIntervalMs,
    );
    this.realtimePushInterval = setInterval(
      () => this._pushRealtime(),
      this.config.realtimePushIntervalMs,
    );

    logger.info("[Analytics] Started", {
      aggregationMs: this.config.aggregationIntervalMs,
      realtimeMs: this.config.realtimePushIntervalMs,
    });
  }

  /**
   * Stop periodic aggregation and real-time pushes
   */
  stop() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
    if (this.realtimePushInterval) {
      clearInterval(this.realtimePushInterval);
      this.realtimePushInterval = null;
    }
    logger.info("[Analytics] Stopped");
  }

  /**
   * Perform a single aggregation cycle: collect all metrics and persist
   * @private
   */
  async _aggregate() {
    try {
      const metrics = await this._collectAllMetrics();
      const bucketKey = this._getBucketKey("hourly");
      const db = this._getDb();

      if (db) {
        const stmt = db.prepare(
          `INSERT OR REPLACE INTO analytics_aggregations (id, bucket_key, granularity, metrics, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
        );
        stmt.run(uuidv4(), bucketKey, "hourly", JSON.stringify(metrics));
      }

      this.emit("aggregated", { bucketKey, metrics });
      logger.debug("[Analytics] Aggregation complete for bucket:", bucketKey);
    } catch (error) {
      logger.error("[Analytics] Aggregation failed:", error.message);
    }
  }

  /**
   * Push current metrics snapshot to the renderer via webContents.send
   * @private
   */
  async _pushRealtime() {
    if (!this.mainWindow?.webContents) {return;}
    try {
      const snapshot = await this._collectAllMetrics();
      this.mainWindow.webContents.send("analytics:realtime-update", snapshot);
    } catch (error) {
      // Silent fail to avoid log noise on push
    }
  }

  /**
   * Collect current metrics from all registered data sources
   * @private
   * @returns {Object} Unified metrics object
   */
  async _collectAllMetrics() {
    const metrics = {
      timestamp: Date.now(),
      ai: {
        totalCalls: 0,
        totalTokens: 0,
        avgLatency: 0,
        costEstimate: 0,
        byModel: {},
      },
      skills: {
        totalExecutions: 0,
        successRate: 0,
        topSkills: [],
        byCategory: {},
      },
      errors: {
        totalErrors: 0,
        errorRate: 0,
        byType: {},
        recentErrors: [],
      },
      system: {
        cpuUsage: 0,
        memoryUsage: 0,
        uptime: 0,
      },
      p2p: {
        activePeers: 0,
        messagesSent: 0,
        messagesReceived: 0,
      },
    };

    // Collect from tokenTracker
    if (this.tokenTracker) {
      try {
        const tokenStats =
          this.tokenTracker.getStats?.() ||
          this.tokenTracker.getSummary?.() ||
          {};
        metrics.ai.totalTokens = tokenStats.totalTokens || 0;
        metrics.ai.totalCalls =
          tokenStats.totalCalls || tokenStats.requestCount || 0;
        metrics.ai.avgLatency = tokenStats.avgLatency || 0;
        metrics.ai.costEstimate = tokenStats.totalCost || 0;
        metrics.ai.byModel = tokenStats.byModel || {};
      } catch (e) {
        logger.debug("[Analytics] TokenTracker collection failed:", e.message);
      }
    }

    // Collect from skillMetrics
    if (this.skillMetrics) {
      try {
        const skillStats =
          this.skillMetrics.getOverallStats?.() ||
          this.skillMetrics.getSummary?.() ||
          {};
        metrics.skills.totalExecutions = skillStats.totalExecutions || 0;
        metrics.skills.successRate = skillStats.successRate || 0;
        metrics.skills.topSkills = skillStats.topSkills || [];
        metrics.skills.byCategory = skillStats.byCategory || {};
      } catch (e) {
        logger.debug("[Analytics] SkillMetrics collection failed:", e.message);
      }
    }

    // Collect from errorMonitor
    if (this.errorMonitor) {
      try {
        const errorStats =
          this.errorMonitor.getStats?.() ||
          this.errorMonitor.getSummary?.() ||
          {};
        metrics.errors.totalErrors =
          errorStats.totalErrors || errorStats.errorCount || 0;
        metrics.errors.errorRate = errorStats.errorRate || 0;
        metrics.errors.byType =
          errorStats.byType || errorStats.byCategory || {};
        metrics.errors.recentErrors = (
          errorStats.recentErrors || []
        ).slice(0, 10);
      } catch (e) {
        logger.debug("[Analytics] ErrorMonitor collection failed:", e.message);
      }
    }

    // Collect from performanceMonitor
    if (this.performanceMonitor) {
      try {
        const perfStats = this.performanceMonitor.getSummary?.() || {};
        metrics.system.cpuUsage = perfStats.system?.cpu?.usage || 0;
        metrics.system.memoryUsage = perfStats.system?.memory?.usedPercent || 0;
        metrics.system.uptime = process.uptime();
      } catch (e) {
        logger.debug(
          "[Analytics] PerformanceMonitor collection failed:",
          e.message,
        );
      }
    }

    return metrics;
  }

  /**
   * Get time-bucket key for the given granularity
   * @private
   * @param {string} granularity - 'hourly' or 'daily'
   * @returns {string} Bucket key string
   */
  _getBucketKey(granularity) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");

    if (granularity === "hourly") {
      return `${year}-${month}-${day}T${hour}:00`;
    } else if (granularity === "daily") {
      return `${year}-${month}-${day}`;
    }
    return now.toISOString();
  }

  /**
   * Query time-series data for a specific metric path
   * @param {string} metric - Dot-notation metric path (e.g., 'ai.totalTokens')
   * @param {Object} options - Query options
   * @param {number|string} [options.from] - Start time (timestamp or ISO string)
   * @param {number|string} [options.to] - End time (timestamp or ISO string)
   * @param {string} [options.granularity='hourly'] - Bucket granularity
   * @returns {Array<{timestamp: string, value: number}>}
   */
  async getTimeSeries(metric, { from, to, granularity = "hourly" } = {}) {
    const db = this._getDb();
    if (!db) {return [];}

    try {
      let query =
        "SELECT bucket_key, metrics FROM analytics_aggregations WHERE granularity = ?";
      const params = [granularity];

      if (from) {
        query += " AND created_at >= ?";
        params.push(new Date(from).toISOString());
      }
      if (to) {
        query += " AND created_at <= ?";
        params.push(new Date(to).toISOString());
      }
      query += " ORDER BY bucket_key ASC";

      const stmt = db.prepare(query);
      const rows = stmt.all(...params);

      return rows.map((row) => {
        const metricsObj = JSON.parse(row.metrics || "{}");
        const value = metric
          .split(".")
          .reduce((obj, key) => obj?.[key], metricsObj);
        return { timestamp: row.bucket_key, value: value ?? 0 };
      });
    } catch (error) {
      logger.error("[Analytics] getTimeSeries failed:", error.message);
      return [];
    }
  }

  /**
   * Get a dashboard summary for the given time period
   * @param {string} [period='24h'] - Period string (e.g., '1h', '6h', '24h', '7d', '30d')
   * @returns {Object} Dashboard summary with current metrics and KPIs
   */
  async getDashboardSummary(period = "24h") {
    const fromTime = this._periodToTimestamp(period);
    const metrics = await this._collectAllMetrics();

    // Fetch aggregated history for the period
    let history = [];
    const db = this._getDb();
    if (db) {
      try {
        const stmt = db.prepare(
          "SELECT * FROM analytics_aggregations WHERE created_at >= ? ORDER BY bucket_key ASC",
        );
        history = stmt.all(new Date(fromTime).toISOString());
      } catch (error) {
        logger.debug(
          "[Analytics] Failed to fetch history for summary:",
          error.message,
        );
      }
    }

    return {
      current: metrics,
      period,
      historyCount: history.length,
      kpis: {
        totalAICalls: metrics.ai.totalCalls,
        totalTokens: metrics.ai.totalTokens,
        tokenCost: metrics.ai.costEstimate,
        skillExecutions: metrics.skills.totalExecutions,
        skillSuccessRate: metrics.skills.successRate,
        errorCount: metrics.errors.totalErrors,
        activePeers: metrics.p2p.activePeers,
        uptime: metrics.system.uptime,
        cpuUsage: metrics.system.cpuUsage,
        memoryUsage: metrics.system.memoryUsage,
      },
    };
  }

  /**
   * Get top N items for a given metric category
   * @param {string} metric - Metric category: 'skills', 'errors', or 'models'
   * @param {number} [n=10] - Number of top items to return
   * @param {string} [period='24h'] - Time period
   * @returns {Array<Object>} Sorted top items
   */
  async getTopN(metric, n = 10, period = "24h") {
    const summary = await this.getDashboardSummary(period);

    switch (metric) {
      case "skills":
        return (summary.current.skills.topSkills || []).slice(0, n);

      case "errors":
        return Object.entries(summary.current.errors.byType || {})
          .map(([type, count]) => ({ name: type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, n);

      case "models":
        return Object.entries(summary.current.ai.byModel || {})
          .map(([model, data]) => ({
            name: model,
            ...(typeof data === "object" ? data : { calls: data }),
          }))
          .sort((a, b) => (b.calls || 0) - (a.calls || 0))
          .slice(0, n);

      default:
        return [];
    }
  }

  /**
   * Generate an analytics report in the specified format
   * @param {Object} [options={}] - Report options
   * @param {string} [options.format='json'] - Output format: 'csv' or 'json'
   * @param {string} [options.period='7d'] - Time period for the report
   * @param {string[]} [options.metrics] - Specific metrics to include
   * @returns {Object|string} Report data or CSV string
   */
  async generateReport(options = {}) {
    const { format = "json", period = "7d" } = options;
    const summary = await this.getDashboardSummary(period);

    if (format === "csv") {
      return this._toCSV(summary);
    }
    return summary;
  }

  /**
   * Convert summary KPIs to CSV format
   * @private
   * @param {Object} data - Dashboard summary object
   * @returns {string} CSV string
   */
  _toCSV(data) {
    const lines = ["Metric,Value"];
    for (const [key, value] of Object.entries(data.kpis || {})) {
      // Escape values that might contain commas
      const escapedValue =
        typeof value === "string" ? `"${value}"` : String(value);
      lines.push(`${key},${escapedValue}`);
    }
    return lines.join("\n");
  }

  /**
   * Convert a period string to a timestamp
   * @private
   * @param {string} period - Period string (e.g., '24h', '7d', '4w', '1m')
   * @returns {number} Timestamp in milliseconds
   */
  _periodToTimestamp(period) {
    const now = Date.now();
    const units = {
      h: 3600000,
      d: 86400000,
      w: 604800000,
      m: 2592000000,
    };
    const match = period.match(/^(\d+)([hdwm])$/);
    if (match) {
      return now - parseInt(match[1], 10) * units[match[2]];
    }
    return now - 86400000; // default 24h
  }

  /**
   * Delete aggregation records older than the retention period
   * @param {number} [retentionDays] - Override default retention days
   * @returns {Object} Cleanup result with cutoff date
   */
  async cleanupOldData(retentionDays) {
    const days = retentionDays || this.config.retentionDays;
    const db = this._getDb();
    if (!db) {return { deleted: 0 };}

    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const stmt = db.prepare(
        "DELETE FROM analytics_aggregations WHERE created_at < ?",
      );
      const result = stmt.run(cutoff);
      const deletedCount = result.changes || 0;

      logger.info("[Analytics] Cleaned up old data", {
        retentionDays: days,
        cutoff,
        deleted: deletedCount,
      });

      return { deleted: deletedCount, before: cutoff };
    } catch (error) {
      logger.error("[Analytics] Cleanup failed:", error.message);
      return { deleted: 0, error: error.message };
    }
  }

  /**
   * Get aggregation history records with pagination
   * @param {Object} [options={}] - Pagination options
   * @param {number} [options.limit=50] - Max records to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Array<Object>} Aggregation records
   */
  async getAggregationHistory({ limit = 50, offset = 0 } = {}) {
    const db = this._getDb();
    if (!db) {return [];}

    try {
      const stmt = db.prepare(
        "SELECT * FROM analytics_aggregations ORDER BY created_at DESC LIMIT ? OFFSET ?",
      );
      const rows = stmt.all(limit, offset);

      return rows.map((row) => ({
        id: row.id,
        bucketKey: row.bucket_key,
        granularity: row.granularity,
        metrics: JSON.parse(row.metrics || "{}"),
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error("[Analytics] getAggregationHistory failed:", error.message);
      return [];
    }
  }

  /**
   * Collect AI-specific metrics
   * @returns {Object} AI metrics
   */
  async getAIMetrics() {
    const metrics = await this._collectAllMetrics();
    return metrics.ai;
  }

  /**
   * Collect skill-specific metrics
   * @returns {Object} Skill metrics
   */
  async getSkillMetrics() {
    const metrics = await this._collectAllMetrics();
    return metrics.skills;
  }

  /**
   * Collect error-specific metrics
   * @returns {Object} Error metrics
   */
  async getErrorMetrics() {
    const metrics = await this._collectAllMetrics();
    return metrics.errors;
  }

  /**
   * Collect system metrics
   * @returns {Object} System metrics
   */
  async getSystemMetrics() {
    const metrics = await this._collectAllMetrics();
    return metrics.system;
  }

  /**
   * Collect P2P metrics
   * @returns {Object} P2P metrics
   */
  async getP2PMetrics() {
    const metrics = await this._collectAllMetrics();
    return metrics.p2p;
  }
}

let instance = null;

/**
 * Get the singleton AnalyticsAggregator instance
 * @returns {AnalyticsAggregator}
 */
function getAnalyticsAggregator() {
  if (!instance) {
    instance = new AnalyticsAggregator();
  }
  return instance;
}

module.exports = { AnalyticsAggregator, getAnalyticsAggregator };
