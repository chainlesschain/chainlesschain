/**
 * Anomaly Detector — Statistical Anomaly Detection Engine (v3.3)
 *
 * Multi-algorithm anomaly detection for operational metrics:
 * - Z-Score: Sudden spike/drop detection (Gaussian assumption)
 * - IQR: Outlier detection (no distribution assumption)
 * - EWMA: Trend shift detection (exponentially weighted moving average)
 *
 * Features:
 * - Configurable baselines per metric
 * - Multi-dimensional metric monitoring
 * - Integration with ErrorMonitor and PerformanceMonitor
 * - Automatic baseline calibration
 * - Event emission for downstream processing
 *
 * @module ai-engine/cowork/anomaly-detector
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

// ============================================================
// Constants
// ============================================================

const DETECTION_METHODS = {
  Z_SCORE: "z-score",
  IQR: "iqr",
  EWMA: "ewma",
};

const ANOMALY_SEVERITY = {
  P0: "P0", // Critical — service down
  P1: "P1", // Major — significant degradation
  P2: "P2", // Minor — noticeable degradation
  P3: "P3", // Warning — potential issue
};

const DEFAULT_CONFIG = {
  "z-score": { threshold: 3.0, minSamples: 30 },
  iqr: { multiplier: 1.5, minSamples: 20 },
  ewma: { alpha: 0.3, threshold: 2.0, minSamples: 10 },
};

const WINDOW_PARSE = {
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
};

// ============================================================
// AnomalyDetector Class
// ============================================================

class AnomalyDetector extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // Baseline definitions: metric_name → baseline config
    this._baselines = new Map();

    // Rolling metric buffers: metric_name → { values: [], timestamps: [] }
    this._metricBuffers = new Map();

    // EWMA state: metric_name → { mean, variance }
    this._ewmaState = new Map();

    // Active monitoring intervals
    this._monitorIntervals = new Map();

    // Dependencies
    this._errorMonitor = null;
    this._performanceMonitor = null;
    this._incidentClassifier = null;

    // Config
    this._config = {
      bufferMaxSize: 1000,
      checkIntervalMs: 30000, // 30 seconds
      enabled: true,
    };
  }

  /**
   * Initialize with database and optional dependencies
   * @param {Object} db - Database instance
   * @param {Object} [deps] - Optional dependencies
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this._errorMonitor = deps.errorMonitor || null;
    this._performanceMonitor = deps.performanceMonitor || null;
    this._incidentClassifier = deps.incidentClassifier || null;

    this._ensureTables();
    await this._loadBaselines();

    this.initialized = true;
    logger.info(
      `[AnomalyDetector] Initialized: ${this._baselines.size} baselines loaded`,
    );
  }

  // ============================================================
  // Public API — Baseline Management
  // ============================================================

  /**
   * Get all configured baselines
   * @returns {Array} Baseline configurations
   */
  getBaselines() {
    return [...this._baselines.entries()].map(([name, config]) => ({
      metricName: name,
      ...config,
    }));
  }

  /**
   * Get baseline for a specific metric
   * @param {string} metricName
   * @returns {Object|null} Baseline config
   */
  getBaseline(metricName) {
    const baseline = this._baselines.get(metricName);
    return baseline ? { metricName, ...baseline } : null;
  }

  /**
   * Update or create baseline configuration for metrics
   * @param {Array} metrics - Array of metric baseline configs
   * @returns {Object} Result
   */
  async updateBaselines(metrics) {
    if (!Array.isArray(metrics)) {
      throw new Error("Metrics must be an array");
    }

    const updated = [];

    for (const metric of metrics) {
      const { name, method, threshold, window, ...extra } = metric;

      if (!name || !method) {
        logger.warn(
          `[AnomalyDetector] Skipping invalid metric config: ${JSON.stringify(metric)}`,
        );
        continue;
      }

      if (!Object.values(DETECTION_METHODS).includes(method)) {
        logger.warn(`[AnomalyDetector] Unknown detection method: ${method}`);
        continue;
      }

      const windowMs = window
        ? WINDOW_PARSE[window] || parseInt(window)
        : 300000;
      const defaults = DEFAULT_CONFIG[method] || {};
      const params = { ...defaults, ...extra };

      const baseline = {
        detectionMethod: method,
        threshold: threshold ?? defaults.threshold,
        window: window || "5m",
        windowMs,
        params,
        baselineValues: [],
        lastCalibrated: null,
      };

      this._baselines.set(name, baseline);

      // Persist
      this._saveBaseline(name, baseline);
      updated.push(name);
    }

    logger.info(
      `[AnomalyDetector] Updated ${updated.length} baselines: ${updated.join(", ")}`,
    );

    return { updated: updated.length, metrics: updated };
  }

  // ============================================================
  // Public API — Detection
  // ============================================================

  /**
   * Ingest a metric value and check for anomalies
   * @param {string} metricName - Metric name
   * @param {number} value - Metric value
   * @param {number} [timestamp] - Optional timestamp (default: now)
   * @returns {Object|null} Anomaly event if detected, null otherwise
   */
  ingestMetric(metricName, value, timestamp) {
    if (!this._config.enabled) {
      return null;
    }

    const ts = timestamp || Date.now();

    // Get or create buffer
    if (!this._metricBuffers.has(metricName)) {
      this._metricBuffers.set(metricName, { values: [], timestamps: [] });
    }

    const buffer = this._metricBuffers.get(metricName);
    buffer.values.push(value);
    buffer.timestamps.push(ts);

    // Trim buffer
    if (buffer.values.length > this._config.bufferMaxSize) {
      buffer.values = buffer.values.slice(-this._config.bufferMaxSize);
      buffer.timestamps = buffer.timestamps.slice(-this._config.bufferMaxSize);
    }

    // Check against baseline
    const baseline = this._baselines.get(metricName);
    if (!baseline) {
      return null;
    }

    const anomaly = this._detect(metricName, value, buffer, baseline);
    if (anomaly) {
      this.emit("anomaly:detected", anomaly);
      logger.warn(
        `[AnomalyDetector] Anomaly detected: ${metricName} = ${value} (${anomaly.method}, severity: ${anomaly.severity})`,
      );
    }

    return anomaly;
  }

  /**
   * Run detection on current buffer (for manual checks)
   * @param {string} metricName
   * @returns {Object|null} Detection result
   */
  checkMetric(metricName) {
    const buffer = this._metricBuffers.get(metricName);
    const baseline = this._baselines.get(metricName);

    if (!buffer || !baseline || buffer.values.length === 0) {
      return null;
    }

    const latestValue = buffer.values[buffer.values.length - 1];
    return this._detect(metricName, latestValue, buffer, baseline);
  }

  /**
   * Calibrate baseline from current buffer
   * @param {string} metricName
   * @returns {Object} Calibration result
   */
  calibrateBaseline(metricName) {
    const buffer = this._metricBuffers.get(metricName);
    const baseline = this._baselines.get(metricName);

    if (!buffer || !baseline) {
      throw new Error(`No data for metric: ${metricName}`);
    }

    if (buffer.values.length < 10) {
      throw new Error(
        `Insufficient data for calibration (need >= 10, have ${buffer.values.length})`,
      );
    }

    const values = buffer.values;
    baseline.baselineValues = this._computeStatistics(values);
    baseline.lastCalibrated = new Date().toISOString();

    this._saveBaseline(metricName, baseline);

    logger.info(
      `[AnomalyDetector] Calibrated baseline for ${metricName}: mean=${baseline.baselineValues.mean.toFixed(2)}, std=${baseline.baselineValues.std.toFixed(2)}`,
    );

    return {
      metricName,
      ...baseline.baselineValues,
      sampleSize: values.length,
      calibratedAt: baseline.lastCalibrated,
    };
  }

  /**
   * Get detection statistics
   * @returns {Object} Stats
   */
  getStats() {
    return {
      baselines: this._baselines.size,
      activeMetrics: this._metricBuffers.size,
      bufferSizes: Object.fromEntries(
        [...this._metricBuffers.entries()].map(([name, buf]) => [
          name,
          buf.values.length,
        ]),
      ),
      ewmaStates: this._ewmaState.size,
      config: this._config,
    };
  }

  /**
   * Get current configuration
   * @returns {Object}
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} config
   */
  configure(config = {}) {
    const allowed = ["bufferMaxSize", "checkIntervalMs", "enabled"];
    for (const key of allowed) {
      if (config[key] !== undefined) {
        this._config[key] = config[key];
      }
    }
    return this.getConfig();
  }

  // ============================================================
  // Detection Algorithms
  // ============================================================

  /**
   * Main detection dispatcher
   * @private
   */
  _detect(metricName, value, buffer, baseline) {
    const method = baseline.detectionMethod;

    switch (method) {
      case DETECTION_METHODS.Z_SCORE:
        return this._detectZScore(metricName, value, buffer, baseline);
      case DETECTION_METHODS.IQR:
        return this._detectIQR(metricName, value, buffer, baseline);
      case DETECTION_METHODS.EWMA:
        return this._detectEWMA(metricName, value, buffer, baseline);
      default:
        logger.warn(`[AnomalyDetector] Unknown method: ${method}`);
        return null;
    }
  }

  /**
   * Z-Score anomaly detection
   * Detects sudden spikes/drops assuming Gaussian distribution
   * @private
   */
  _detectZScore(metricName, value, buffer, baseline) {
    const minSamples =
      baseline.params.minSamples || DEFAULT_CONFIG["z-score"].minSamples;
    if (buffer.values.length < minSamples) {
      return null;
    }

    const stats = this._computeStatistics(buffer.values);
    if (stats.std === 0) {
      return null;
    }

    const zScore = Math.abs((value - stats.mean) / stats.std);
    const threshold = baseline.threshold;

    if (zScore > threshold) {
      return this._createAnomaly(metricName, value, {
        method: DETECTION_METHODS.Z_SCORE,
        zScore: parseFloat(zScore.toFixed(3)),
        threshold,
        baselineMean: parseFloat(stats.mean.toFixed(3)),
        baselineStd: parseFloat(stats.std.toFixed(3)),
        direction: value > stats.mean ? "above" : "below",
      });
    }

    return null;
  }

  /**
   * IQR (Interquartile Range) anomaly detection
   * Robust outlier detection without distribution assumptions
   * @private
   */
  _detectIQR(metricName, value, buffer, baseline) {
    const minSamples =
      baseline.params.minSamples || DEFAULT_CONFIG.iqr.minSamples;
    if (buffer.values.length < minSamples) {
      return null;
    }

    const sorted = [...buffer.values].sort((a, b) => a - b);
    const q1 = this._percentile(sorted, 25);
    const q3 = this._percentile(sorted, 75);
    const iqr = q3 - q1;

    if (iqr === 0) {
      return null;
    }

    const multiplier =
      baseline.params.multiplier || DEFAULT_CONFIG.iqr.multiplier;
    const lowerBound = q1 - multiplier * iqr;
    const upperBound = q3 + multiplier * iqr;

    if (value < lowerBound || value > upperBound) {
      return this._createAnomaly(metricName, value, {
        method: DETECTION_METHODS.IQR,
        q1: parseFloat(q1.toFixed(3)),
        q3: parseFloat(q3.toFixed(3)),
        iqr: parseFloat(iqr.toFixed(3)),
        multiplier,
        lowerBound: parseFloat(lowerBound.toFixed(3)),
        upperBound: parseFloat(upperBound.toFixed(3)),
        direction: value > upperBound ? "above" : "below",
      });
    }

    return null;
  }

  /**
   * EWMA (Exponentially Weighted Moving Average) anomaly detection
   * Detects gradual trend shifts
   * @private
   */
  _detectEWMA(metricName, value, buffer, baseline) {
    const minSamples =
      baseline.params.minSamples || DEFAULT_CONFIG.ewma.minSamples;
    if (buffer.values.length < minSamples) {
      return null;
    }

    const alpha = baseline.params.alpha || DEFAULT_CONFIG.ewma.alpha;
    const threshold = baseline.threshold || DEFAULT_CONFIG.ewma.threshold;

    // Get or initialize EWMA state
    let state = this._ewmaState.get(metricName);
    if (!state) {
      const stats = this._computeStatistics(buffer.values);
      state = {
        mean: stats.mean,
        variance: stats.std * stats.std,
      };
      this._ewmaState.set(metricName, state);
    }

    // Update EWMA
    const prevMean = state.mean;
    state.mean = alpha * value + (1 - alpha) * state.mean;
    state.variance =
      alpha * (value - prevMean) * (value - state.mean) +
      (1 - alpha) * state.variance;

    const ewmaStd = Math.sqrt(Math.max(state.variance, 0.0001));
    const deviation = Math.abs(value - state.mean) / ewmaStd;

    if (deviation > threshold) {
      return this._createAnomaly(metricName, value, {
        method: DETECTION_METHODS.EWMA,
        ewmaMean: parseFloat(state.mean.toFixed(3)),
        ewmaStd: parseFloat(ewmaStd.toFixed(3)),
        deviation: parseFloat(deviation.toFixed(3)),
        threshold,
        alpha,
        direction: value > state.mean ? "above" : "below",
      });
    }

    return null;
  }

  // ============================================================
  // Statistical Helpers
  // ============================================================

  /**
   * Compute basic statistics for an array of values
   * @private
   */
  _computeStatistics(values) {
    const n = values.length;
    if (n === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, median: 0 };
    }

    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    const squaredDiffs = values.map((v) => (v - mean) * (v - mean));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(variance);

    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[n - 1];
    const median = this._percentile(sorted, 50);

    return { mean, std, min, max, median };
  }

  /**
   * Compute percentile of a sorted array
   * @private
   */
  _percentile(sorted, p) {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sorted[lower];
    }

    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Create an anomaly event object
   * @private
   */
  _createAnomaly(metricName, value, details) {
    const baseline = this._baselines.get(metricName);
    const baselineValue =
      baseline?.baselineValues?.mean ??
      details.baselineMean ??
      details.ewmaMean ??
      0;

    // Determine severity based on deviation magnitude
    const deviationRatio =
      baselineValue !== 0
        ? Math.abs(value - baselineValue) / Math.abs(baselineValue)
        : Math.abs(value);

    let severity;
    if (deviationRatio > 5.0 || details.zScore > 5.0) {
      severity = ANOMALY_SEVERITY.P0;
    } else if (deviationRatio > 2.0 || details.zScore > 4.0) {
      severity = ANOMALY_SEVERITY.P1;
    } else if (deviationRatio > 1.0 || details.zScore > 3.5) {
      severity = ANOMALY_SEVERITY.P2;
    } else {
      severity = ANOMALY_SEVERITY.P3;
    }

    return {
      id: `anomaly-${uuidv4().slice(0, 8)}`,
      metricName,
      value,
      baselineValue: parseFloat(baselineValue.toFixed(3)),
      severity,
      ...details,
      detectedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // Database Operations
  // ============================================================

  _ensureTables() {
    try {
      this.db.prepare(`SELECT 1 FROM ops_metrics_baseline LIMIT 0`).get();
    } catch {
      logger.warn(
        "[AnomalyDetector] Tables not found — run database migration",
      );
    }
  }

  async _loadBaselines() {
    try {
      const rows = this.db.prepare(`SELECT * FROM ops_metrics_baseline`).all();

      for (const row of rows) {
        this._baselines.set(row.metric_name, {
          detectionMethod: row.detection_method,
          threshold: row.threshold,
          window: row.window,
          windowMs: WINDOW_PARSE[row.window] || 300000,
          params: JSON.parse(row.params || "{}"),
          baselineValues: JSON.parse(row.baseline_values || "[]"),
          lastCalibrated: row.last_calibrated,
        });
      }
    } catch (error) {
      logger.warn(
        `[AnomalyDetector] Failed to load baselines: ${error.message}`,
      );
    }
  }

  _saveBaseline(metricName, baseline) {
    try {
      const existing = this.db
        .prepare(`SELECT id FROM ops_metrics_baseline WHERE metric_name = ?`)
        .get(metricName);

      if (existing) {
        this.db
          .prepare(
            `UPDATE ops_metrics_baseline SET detection_method = ?, threshold = ?, window = ?, params = ?, baseline_values = ?, last_calibrated = ?, updated_at = datetime('now') WHERE metric_name = ?`,
          )
          .run(
            baseline.detectionMethod,
            baseline.threshold,
            baseline.window,
            JSON.stringify(baseline.params),
            JSON.stringify(baseline.baselineValues),
            baseline.lastCalibrated,
            metricName,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO ops_metrics_baseline (id, metric_name, detection_method, threshold, window, params, baseline_values, last_calibrated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `baseline-${uuidv4().slice(0, 8)}`,
            metricName,
            baseline.detectionMethod,
            baseline.threshold,
            baseline.window,
            JSON.stringify(baseline.params),
            JSON.stringify(baseline.baselineValues),
            baseline.lastCalibrated,
          );
      }
    } catch (error) {
      logger.error(`[AnomalyDetector] Save baseline error: ${error.message}`);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getAnomalyDetector() {
  if (!instance) {
    instance = new AnomalyDetector();
  }
  return instance;
}

module.exports = {
  AnomalyDetector,
  getAnomalyDetector,
  DETECTION_METHODS,
  ANOMALY_SEVERITY,
};
