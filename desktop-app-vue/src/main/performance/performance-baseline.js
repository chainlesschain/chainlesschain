/**
 * Performance Baseline Manager
 *
 * Production hardening - performance baseline collection and regression detection:
 * - Collect IPC latency (p50/p95/p99)
 * - Memory RSS/heap snapshots
 * - DB query timing
 * - Save/compare baselines
 * - Detect regressions
 *
 * @module performance/performance-baseline
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const BASELINE_STATUS = {
  COLLECTING: "collecting",
  COMPLETE: "complete",
  FAILED: "failed",
};

const METRIC_TYPES = {
  IPC_LATENCY: "ipc_latency",
  MEMORY: "memory",
  DB_QUERY: "db_query",
  STARTUP: "startup",
};

// ============================================================
// PerformanceBaseline
// ============================================================

class PerformanceBaseline extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._baselines = new Map();
    this._samples = [];
    this._maxSamples = 1000;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_baselines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT,
        status TEXT DEFAULT 'collecting',
        metrics TEXT,
        environment TEXT,
        sample_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_perf_baselines_name ON performance_baselines(name);
      CREATE INDEX IF NOT EXISTS idx_perf_baselines_status ON performance_baselines(status);
    `);
  }

  async initialize() {
    logger.info("[PerformanceBaseline] Initializing...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const baselines = this.database.db
          .prepare(
            "SELECT * FROM performance_baselines ORDER BY created_at DESC LIMIT 50",
          )
          .all();
        for (const b of baselines) {
          this._baselines.set(b.id, {
            ...b,
            metrics: b.metrics ? JSON.parse(b.metrics) : {},
            environment: b.environment ? JSON.parse(b.environment) : {},
          });
        }
        logger.info(
          `[PerformanceBaseline] Loaded ${baselines.length} baselines`,
        );
      } catch (err) {
        logger.error("[PerformanceBaseline] Failed to load baselines:", err);
      }
    }

    this.initialized = true;
    logger.info("[PerformanceBaseline] Initialized");
  }

  /**
   * Collect a performance baseline
   * @param {Object} params
   * @param {string} params.name - Baseline name
   * @param {string} [params.version] - App version
   * @returns {Object} Baseline result
   */
  async collectBaseline({ name, version } = {}) {
    if (!name) {
      throw new Error("Baseline name is required");
    }

    const id = uuidv4();
    const now = Date.now();

    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const ipcSamples = this._samples.filter(
      (s) => s.type === METRIC_TYPES.IPC_LATENCY,
    );
    const dbSamples = this._samples.filter(
      (s) => s.type === METRIC_TYPES.DB_QUERY,
    );

    const metrics = {
      ipc: {
        p50: this._percentile(
          ipcSamples.map((s) => s.duration),
          50,
        ),
        p95: this._percentile(
          ipcSamples.map((s) => s.duration),
          95,
        ),
        p99: this._percentile(
          ipcSamples.map((s) => s.duration),
          99,
        ),
        count: ipcSamples.length,
      },
      memory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
      },
      db: {
        p50: this._percentile(
          dbSamples.map((s) => s.duration),
          50,
        ),
        p95: this._percentile(
          dbSamples.map((s) => s.duration),
          95,
        ),
        count: dbSamples.length,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
    };

    const environment = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      uptime: process.uptime(),
    };

    const baseline = {
      id,
      name,
      version: version || "unknown",
      status: BASELINE_STATUS.COMPLETE,
      metrics,
      environment,
      sample_count: ipcSamples.length + dbSamples.length,
      created_at: now,
      completed_at: Date.now(),
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO performance_baselines (id, name, version, status, metrics, environment, sample_count, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          name,
          baseline.version,
          baseline.status,
          JSON.stringify(metrics),
          JSON.stringify(environment),
          baseline.sample_count,
          now,
          baseline.completed_at,
        );
    }

    this._baselines.set(id, baseline);
    this.emit("baseline-collected", baseline);
    logger.info(`[PerformanceBaseline] Baseline collected: ${name} (${id})`);
    return baseline;
  }

  /**
   * Record a performance sample
   * @param {string} type - Metric type
   * @param {number} duration - Duration in ms
   * @param {Object} [meta] - Additional metadata
   */
  recordSample(type, duration, meta = {}) {
    this._samples.push({
      type,
      duration,
      timestamp: Date.now(),
      ...meta,
    });
    if (this._samples.length > this._maxSamples) {
      this._samples = this._samples.slice(-this._maxSamples);
    }
  }

  /**
   * Compare two baselines for regressions
   * @param {Object} params
   * @param {string} params.baselineId - Baseline to compare against
   * @param {string} [params.currentId] - Current baseline (or latest)
   * @param {Object} [params.thresholds] - Regression thresholds
   * @returns {Object} Comparison result
   */
  async compareBaseline({ baselineId, currentId, thresholds = {} } = {}) {
    if (!baselineId) {
      throw new Error("Baseline ID is required");
    }

    const baseline = this._baselines.get(baselineId);
    if (!baseline) {
      throw new Error(`Baseline not found: ${baselineId}`);
    }

    let current;
    if (currentId) {
      current = this._baselines.get(currentId);
      if (!current) {
        throw new Error(`Current baseline not found: ${currentId}`);
      }
    } else {
      // Use latest
      const sorted = Array.from(this._baselines.values()).sort(
        (a, b) => b.created_at - a.created_at,
      );
      current = sorted[0];
      if (!current || current.id === baselineId) {
        throw new Error("No current baseline available for comparison");
      }
    }

    const defaultThresholds = {
      ipcLatencyP95: thresholds.ipcLatencyP95 || 1.5,
      memoryRss: thresholds.memoryRss || 1.3,
      dbQueryP95: thresholds.dbQueryP95 || 1.5,
    };

    const regressions = [];

    // Check IPC latency regression
    if (baseline.metrics.ipc.p95 > 0 && current.metrics.ipc.p95 > 0) {
      const ratio = current.metrics.ipc.p95 / baseline.metrics.ipc.p95;
      if (ratio > defaultThresholds.ipcLatencyP95) {
        regressions.push({
          metric: "ipc_latency_p95",
          baseline: baseline.metrics.ipc.p95,
          current: current.metrics.ipc.p95,
          ratio,
          threshold: defaultThresholds.ipcLatencyP95,
        });
      }
    }

    // Check memory regression
    if (baseline.metrics.memory.rss > 0 && current.metrics.memory.rss > 0) {
      const ratio = current.metrics.memory.rss / baseline.metrics.memory.rss;
      if (ratio > defaultThresholds.memoryRss) {
        regressions.push({
          metric: "memory_rss",
          baseline: baseline.metrics.memory.rss,
          current: current.metrics.memory.rss,
          ratio,
          threshold: defaultThresholds.memoryRss,
        });
      }
    }

    // Check DB query regression
    if (baseline.metrics.db.p95 > 0 && current.metrics.db.p95 > 0) {
      const ratio = current.metrics.db.p95 / baseline.metrics.db.p95;
      if (ratio > defaultThresholds.dbQueryP95) {
        regressions.push({
          metric: "db_query_p95",
          baseline: baseline.metrics.db.p95,
          current: current.metrics.db.p95,
          ratio,
          threshold: defaultThresholds.dbQueryP95,
        });
      }
    }

    const result = {
      baselineId: baseline.id,
      currentId: current.id,
      hasRegressions: regressions.length > 0,
      regressions,
      summary: {
        baselineName: baseline.name,
        currentName: current.name,
        regressionCount: regressions.length,
      },
    };

    this.emit("baseline-compared", result);
    return result;
  }

  /**
   * Get all baselines
   * @param {Object} [filter]
   * @param {number} [filter.limit] - Max results
   * @returns {Array} Baselines
   */
  async getBaselines(filter = {}) {
    if (this.database && this.database.db) {
      try {
        const sql =
          "SELECT * FROM performance_baselines ORDER BY created_at DESC LIMIT ?";
        const rows = this.database.db.prepare(sql).all(filter.limit || 50);
        return rows.map((r) => ({
          ...r,
          metrics: r.metrics ? JSON.parse(r.metrics) : {},
          environment: r.environment ? JSON.parse(r.environment) : {},
        }));
      } catch (err) {
        logger.error("[PerformanceBaseline] Failed to get baselines:", err);
      }
    }

    const baselines = Array.from(this._baselines.values());
    baselines.sort((a, b) => b.created_at - a.created_at);
    return baselines.slice(0, filter.limit || 50);
  }

  /**
   * Calculate percentile from sorted values
   */
  _percentile(values, p) {
    if (!values || values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  async close() {
    this.removeAllListeners();
    this._baselines.clear();
    this._samples = [];
    this.initialized = false;
    logger.info("[PerformanceBaseline] Closed");
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getPerformanceBaseline(database) {
  if (!_instance) {
    _instance = new PerformanceBaseline(database);
  }
  return _instance;
}

export {
  PerformanceBaseline,
  getPerformanceBaseline,
  BASELINE_STATUS,
  METRIC_TYPES,
};
export default PerformanceBaseline;
