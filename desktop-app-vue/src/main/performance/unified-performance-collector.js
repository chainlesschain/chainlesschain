/**
 * Unified Performance Collector
 *
 * Aggregates metrics from all monitoring sources into a unified format:
 * - PerformanceMonitor (system CPU, memory, DB queries, IPC calls)
 * - MCP Performance Monitor (MCP server/tool latencies)
 * - File Performance Metrics (file I/O tracking)
 * - Token Tracker (LLM token usage and costs)
 * - Renderer metrics (FPS, DOM nodes, JS heap)
 *
 * Provides time-series queries with configurable granularity,
 * dashboard KPI summaries, and custom metric registration.
 *
 * @module performance/unified-performance-collector
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * Granularity durations in milliseconds
 */
const GRANULARITY_MS = {
  raw: 0,
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

class UnifiedPerformanceCollector extends EventEmitter {
  constructor() {
    super();

    /**
     * Ring buffer for collected samples
     * @type {Array<Object>}
     */
    this.buffer = [];

    /**
     * Maximum samples to retain (24h at 10s interval = 8640)
     * @type {number}
     */
    this.maxSamples = 8640;

    /**
     * Collection interval in milliseconds
     * @type {number}
     */
    this.collectionInterval = 10000;

    /**
     * Interval timer reference
     * @type {NodeJS.Timeout|null}
     */
    this._intervalId = null;

    /**
     * Whether collection is active
     * @type {boolean}
     */
    this.running = false;

    /**
     * Start time for uptime calculation
     * @type {number}
     */
    this.startTime = Date.now();

    /**
     * Dependency references
     * @type {Object}
     */
    this.deps = {
      performanceMonitor: null,
      mcpPerformanceMonitor: null,
      filePerformanceMetrics: null,
      tokenTracker: null,
    };

    /**
     * Custom metric definitions
     * @type {Map<string, { type: string, description: string }>}
     */
    this.customMetricDefs = new Map();

    /**
     * Custom metric current values
     * @type {Map<string, number>}
     */
    this.customMetricValues = new Map();

    /**
     * Latest renderer metrics received from the renderer process
     * @type {Object}
     */
    this.rendererMetrics = {
      fps: 0,
      domNodes: 0,
      jsHeap: { used: 0, total: 0, limit: 0 },
    };

    /**
     * Cumulative LLM call counter for dashboard KPI
     * @type {number}
     */
    this._totalAICalls = 0;

    /**
     * Cumulative LLM token counter for dashboard KPI
     * @type {number}
     */
    this._totalTokens = 0;

    /**
     * Cumulative error counter for error rate calculation
     * @type {number}
     */
    this._totalErrors = 0;

    /**
     * Cumulative request counter for error rate calculation
     * @type {number}
     */
    this._totalRequests = 0;
  }

  /**
   * Initialize with dependency references
   * @param {Object} dependencies
   * @param {Object} [dependencies.performanceMonitor] - System performance monitor
   * @param {Object} [dependencies.mcpPerformanceMonitor] - MCP performance monitor
   * @param {Object} [dependencies.filePerformanceMetrics] - File I/O metrics
   * @param {Object} [dependencies.tokenTracker] - LLM token tracker
   */
  initialize(dependencies = {}) {
    this.deps.performanceMonitor = dependencies.performanceMonitor || null;
    this.deps.mcpPerformanceMonitor =
      dependencies.mcpPerformanceMonitor || null;
    this.deps.filePerformanceMetrics =
      dependencies.filePerformanceMetrics || null;
    this.deps.tokenTracker = dependencies.tokenTracker || null;

    logger.info("[UnifiedPerformanceCollector] Initialized", {
      performanceMonitor: !!this.deps.performanceMonitor,
      mcpPerformanceMonitor: !!this.deps.mcpPerformanceMonitor,
      filePerformanceMetrics: !!this.deps.filePerformanceMetrics,
      tokenTracker: !!this.deps.tokenTracker,
    });
  }

  /**
   * Start periodic collection
   */
  start() {
    if (this.running) {
      logger.info(
        "[UnifiedPerformanceCollector] Collection already running",
      );
      return;
    }

    logger.info("[UnifiedPerformanceCollector] Starting collection", {
      intervalMs: this.collectionInterval,
      maxSamples: this.maxSamples,
    });

    this.running = true;
    this.startTime = Date.now();

    // Collect immediately, then on interval
    this._collect();
    this._intervalId = setInterval(() => {
      this._collect();
    }, this.collectionInterval);
  }

  /**
   * Stop periodic collection
   */
  stop() {
    if (!this.running) {
      return;
    }

    logger.info("[UnifiedPerformanceCollector] Stopping collection");
    this.running = false;

    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Collect metrics from all sources into unified format
   * @private
   */
  _collect() {
    try {
      const timestamp = Date.now();
      const sample = {
        timestamp,
        system: this._collectSystem(),
        llm: this._collectLLM(),
        ipc: this._collectIPC(),
        renderer: { ...this.rendererMetrics },
        custom: this._collectCustom(),
      };

      // Push to ring buffer
      this.buffer.push(sample);
      if (this.buffer.length > this.maxSamples) {
        this.buffer.shift();
      }

      this.emit("sample", sample);
    } catch (error) {
      logger.error(
        "[UnifiedPerformanceCollector] Collection error:",
        error.message,
      );
    }
  }

  /**
   * Collect system metrics (CPU, memory, disk) from PerformanceMonitor
   * @returns {Object}
   * @private
   */
  _collectSystem() {
    const result = { cpu: 0, memory: 0, disk: 0 };

    if (!this.deps.performanceMonitor) {
      return result;
    }

    try {
      const summary = this.deps.performanceMonitor.getSummary();
      result.cpu = summary.cpu?.current || 0;
      result.memory = summary.memory?.current || 0;

      // Disk usage from file performance metrics if available
      if (
        this.deps.filePerformanceMetrics &&
        typeof this.deps.filePerformanceMetrics.getDiskUsage === "function"
      ) {
        const diskInfo = this.deps.filePerformanceMetrics.getDiskUsage();
        result.disk = diskInfo?.usage || 0;
      }
    } catch (error) {
      logger.warn(
        "[UnifiedPerformanceCollector] System metrics error:",
        error.message,
      );
    }

    return result;
  }

  /**
   * Collect LLM metrics from TokenTracker
   * @returns {Object}
   * @private
   */
  _collectLLM() {
    const result = { calls: 0, tokens: 0, latency: 0 };

    if (!this.deps.tokenTracker) {
      return result;
    }

    try {
      if (typeof this.deps.tokenTracker.getStats === "function") {
        const stats = this.deps.tokenTracker.getStats();
        result.calls = stats.totalCalls || 0;
        result.tokens = stats.totalTokens || 0;
        result.latency = stats.avgLatency || 0;

        // Update cumulative KPIs
        this._totalAICalls = result.calls;
        this._totalTokens = result.tokens;
      } else if (typeof this.deps.tokenTracker.getSummary === "function") {
        const summary = this.deps.tokenTracker.getSummary();
        result.calls = summary.totalCalls || 0;
        result.tokens = summary.totalTokens || 0;
        result.latency = summary.avgLatency || 0;

        this._totalAICalls = result.calls;
        this._totalTokens = result.tokens;
      }
    } catch (error) {
      logger.warn(
        "[UnifiedPerformanceCollector] LLM metrics error:",
        error.message,
      );
    }

    return result;
  }

  /**
   * Collect IPC metrics from PerformanceMonitor
   * @returns {Object}
   * @private
   */
  _collectIPC() {
    const result = { avgLatency: 0, slowCalls: 0 };

    if (!this.deps.performanceMonitor) {
      return result;
    }

    try {
      const summary = this.deps.performanceMonitor.getSummary();
      result.avgLatency = summary.ipc?.averageCallTime || 0;
      result.slowCalls = summary.ipc?.slowCalls || 0;

      // Update error rate tracking
      this._totalRequests = summary.ipc?.totalCalls || 0;
    } catch (error) {
      logger.warn(
        "[UnifiedPerformanceCollector] IPC metrics error:",
        error.message,
      );
    }

    return result;
  }

  /**
   * Collect current custom metric values
   * @returns {Object}
   * @private
   */
  _collectCustom() {
    const custom = {};
    for (const [name, value] of this.customMetricValues) {
      custom[name] = value;
    }
    return custom;
  }

  /**
   * Get time-series data for a specific metric path
   * @param {string} metric - Dot-notation path e.g. 'system.cpu', 'llm.latency', 'renderer.fps'
   * @param {Object} [options]
   * @param {number} [options.from] - Start timestamp (ms)
   * @param {number} [options.to] - End timestamp (ms)
   * @param {string} [options.granularity='raw'] - One of 'raw', '1m', '5m', '1h', '1d'
   * @returns {Array<{ timestamp: number, value: number }>}
   */
  getTimeSeries(metric, options = {}) {
    const { from = 0, to = Date.now(), granularity = "raw" } = options;

    // Filter buffer by time range
    const filtered = this.buffer.filter(
      (s) => s.timestamp >= from && s.timestamp <= to,
    );

    // Extract metric values using dot-notation path
    const series = filtered.map((s) => ({
      timestamp: s.timestamp,
      value: this._extractMetric(s, metric),
    }));

    if (granularity === "raw" || !GRANULARITY_MS[granularity]) {
      return series;
    }

    return this._aggregateByGranularity(series, granularity);
  }

  /**
   * Extract a metric value from a sample using dot-notation path
   * @param {Object} sample
   * @param {string} path - e.g. 'system.cpu', 'llm.tokens', 'custom.myMetric'
   * @returns {number}
   * @private
   */
  _extractMetric(sample, path) {
    const parts = path.split(".");
    let current = sample;

    for (const part of parts) {
      if (current == null || typeof current !== "object") {
        return 0;
      }
      current = current[part];
    }

    return typeof current === "number" ? current : 0;
  }

  /**
   * Aggregate time-series data by granularity (time bucketing with averaging)
   * @param {Array<{ timestamp: number, value: number }>} data
   * @param {string} granularity - One of '1m', '5m', '1h', '1d'
   * @returns {Array<{ timestamp: number, value: number }>}
   * @private
   */
  _aggregateByGranularity(data, granularity) {
    const bucketSize = GRANULARITY_MS[granularity];
    if (!bucketSize || data.length === 0) {
      return data;
    }

    // Group into buckets
    const buckets = new Map();

    for (const point of data) {
      const bucketKey = Math.floor(point.timestamp / bucketSize) * bucketSize;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey).push(point.value);
    }

    // Average each bucket
    const result = [];
    for (const [timestamp, values] of buckets) {
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      result.push({ timestamp, value: avg });
    }

    // Sort by timestamp
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }

  /**
   * Get dashboard KPI summary for a given period
   * @param {string} [period='1h'] - One of '1m', '5m', '1h', '1d'
   * @returns {Object} KPIs
   */
  getDashboardSummary(period = "1h") {
    const periodMs = GRANULARITY_MS[period] || GRANULARITY_MS["1h"];
    const now = Date.now();
    const from = now - periodMs;

    // Filter buffer samples within period
    const samples = this.buffer.filter((s) => s.timestamp >= from);

    // Calculate averages from samples
    let avgLatency = 0;
    let avgCpu = 0;
    let avgMemory = 0;

    if (samples.length > 0) {
      avgLatency =
        samples.reduce((sum, s) => sum + (s.llm?.latency || 0), 0) /
        samples.length;
      avgCpu =
        samples.reduce((sum, s) => sum + (s.system?.cpu || 0), 0) /
        samples.length;
      avgMemory =
        samples.reduce((sum, s) => sum + (s.system?.memory || 0), 0) /
        samples.length;
    }

    // Count active connections from MCP monitor if available
    let activeConnections = 0;
    if (
      this.deps.mcpPerformanceMonitor &&
      typeof this.deps.mcpPerformanceMonitor.getActiveConnections === "function"
    ) {
      try {
        activeConnections =
          this.deps.mcpPerformanceMonitor.getActiveConnections();
      } catch {
        // Ignore
      }
    }

    // Calculate error rate
    const errorRate =
      this._totalRequests > 0
        ? (this._totalErrors / this._totalRequests) * 100
        : 0;

    return {
      totalAICalls: this._totalAICalls,
      totalTokens: this._totalTokens,
      avgLatency: Math.round(avgLatency * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      activeConnections,
      uptime: now - this.startTime,
      avgCpu: Math.round(avgCpu * 100) / 100,
      avgMemory: Math.round(avgMemory * 100) / 100,
      sampleCount: samples.length,
      period,
    };
  }

  /**
   * Register a custom metric
   * @param {string} name - Metric name (used under 'custom' namespace)
   * @param {Object} opts
   * @param {string} opts.type - One of 'gauge', 'counter', 'histogram'
   * @param {string} opts.description - Human-readable description
   */
  registerMetric(name, opts = {}) {
    const { type = "gauge", description = "" } = opts;

    if (this.customMetricDefs.has(name)) {
      logger.warn(
        `[UnifiedPerformanceCollector] Metric '${name}' already registered, overwriting`,
      );
    }

    this.customMetricDefs.set(name, { type, description });
    if (!this.customMetricValues.has(name)) {
      this.customMetricValues.set(name, 0);
    }

    logger.info(
      `[UnifiedPerformanceCollector] Registered custom metric: ${name} (${type})`,
    );
  }

  /**
   * Record a value for a custom metric
   * @param {string} name - Metric name
   * @param {number} value - Metric value
   */
  recordMetric(name, value) {
    if (!this.customMetricDefs.has(name)) {
      logger.warn(
        `[UnifiedPerformanceCollector] Metric '${name}' not registered, auto-registering as gauge`,
      );
      this.registerMetric(name, { type: "gauge", description: "Auto-registered" });
    }

    const def = this.customMetricDefs.get(name);

    if (def.type === "counter") {
      // Counters only increment
      const current = this.customMetricValues.get(name) || 0;
      this.customMetricValues.set(name, current + value);
    } else {
      // Gauges and histograms store latest value
      this.customMetricValues.set(name, value);
    }
  }

  /**
   * Receive renderer-side metrics (FPS, DOM node count, JS heap) from the renderer process
   * @param {Object} data
   * @param {number} [data.fps] - Frames per second
   * @param {number} [data.domNodes] - DOM node count
   * @param {Object} [data.jsHeap] - JS heap info { used, total, limit }
   */
  receiveRendererMetrics(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    if (typeof data.fps === "number") {
      this.rendererMetrics.fps = data.fps;
    }
    if (typeof data.domNodes === "number") {
      this.rendererMetrics.domNodes = data.domNodes;
    }
    if (data.jsHeap && typeof data.jsHeap === "object") {
      this.rendererMetrics.jsHeap = {
        used: data.jsHeap.used || 0,
        total: data.jsHeap.total || 0,
        limit: data.jsHeap.limit || 0,
      };
    }

    this.emit("renderer-metrics", this.rendererMetrics);
  }

  /**
   * Get a snapshot of current values for all metrics
   * @returns {Object}
   */
  getSnapshot() {
    const latest =
      this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;

    return {
      timestamp: Date.now(),
      system: latest?.system || { cpu: 0, memory: 0, disk: 0 },
      llm: latest?.llm || { calls: 0, tokens: 0, latency: 0 },
      ipc: latest?.ipc || { avgLatency: 0, slowCalls: 0 },
      renderer: { ...this.rendererMetrics },
      custom: this._collectCustom(),
      bufferSize: this.buffer.length,
      running: this.running,
      uptime: Date.now() - this.startTime,
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton UnifiedPerformanceCollector instance
 * @returns {UnifiedPerformanceCollector}
 */
function getUnifiedPerformanceCollector() {
  if (!instance) {
    instance = new UnifiedPerformanceCollector();
  }
  return instance;
}

module.exports = {
  UnifiedPerformanceCollector,
  getUnifiedPerformanceCollector,
};
