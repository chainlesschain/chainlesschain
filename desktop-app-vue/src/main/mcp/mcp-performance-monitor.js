/**
 * MCP Performance Monitor
 *
 * Tracks and analyzes performance metrics for MCP operations.
 * Helps identify bottlenecks and measure stdio overhead.
 *
 * @module MCPPerformanceMonitor
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

const DEFAULT_RETENTION = Object.freeze({
  connectionSamples: 512,
  latencySamplesPerSeries: 512,
  toolSeries: 256,
  serverSeries: 128,
  memorySamples: 100,
  errors: 100,
  seriesNameBytes: 256,
  errorTextBytes: 8192,
  errorContextBytes: 16384,
});
const MAX_RETENTION = Object.freeze({
  connectionSamples: 10000,
  latencySamplesPerSeries: 10000,
  toolSeries: 2048,
  serverSeries: 1024,
  memorySamples: 10000,
  errors: 1000,
  seriesNameBytes: 1024,
  errorTextBytes: 65536,
  errorContextBytes: 262144,
});
const OVERFLOW_SERIES = Symbol("mcp-performance-overflow");
const OVERFLOW_SERIES_NAME = "__other__";
const SUPPORTED_BASELINES = new Set(["directCall", "stdioCall"]);

function boundedPositiveInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function pushBounded(target, value, limit) {
  target.push(value);
  const dropped = Math.max(0, target.length - limit);
  if (dropped > 0) {
    target.splice(0, dropped);
  }
  return dropped;
}

class MCPPerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.retention = {
      connectionSamples: boundedPositiveInteger(
        config.maxConnectionSamples,
        DEFAULT_RETENTION.connectionSamples,
        MAX_RETENTION.connectionSamples,
      ),
      latencySamplesPerSeries: boundedPositiveInteger(
        config.maxLatencySamplesPerSeries,
        DEFAULT_RETENTION.latencySamplesPerSeries,
        MAX_RETENTION.latencySamplesPerSeries,
      ),
      toolSeries: boundedPositiveInteger(
        config.maxToolSeries,
        DEFAULT_RETENTION.toolSeries,
        MAX_RETENTION.toolSeries,
      ),
      serverSeries: boundedPositiveInteger(
        config.maxServerSeries,
        DEFAULT_RETENTION.serverSeries,
        MAX_RETENTION.serverSeries,
      ),
      memorySamples: boundedPositiveInteger(
        config.maxMemorySamples,
        DEFAULT_RETENTION.memorySamples,
        MAX_RETENTION.memorySamples,
      ),
      errors: boundedPositiveInteger(
        config.maxErrors,
        DEFAULT_RETENTION.errors,
        MAX_RETENTION.errors,
      ),
      seriesNameBytes: boundedPositiveInteger(
        config.maxSeriesNameBytes,
        DEFAULT_RETENTION.seriesNameBytes,
        MAX_RETENTION.seriesNameBytes,
      ),
      errorTextBytes: boundedPositiveInteger(
        config.maxErrorTextBytes,
        DEFAULT_RETENTION.errorTextBytes,
        MAX_RETENTION.errorTextBytes,
      ),
      errorContextBytes: boundedPositiveInteger(
        config.maxErrorContextBytes,
        DEFAULT_RETENTION.errorContextBytes,
        MAX_RETENTION.errorContextBytes,
      ),
    };
    this.retentionStats = this._createRetentionStats();

    // Performance metrics are retained in bounded recent windows. Lifetime
    // counters remain exact, while latency percentiles describe the retained
    // window advertised by getSummary().retention.
    this.metrics = this._createEmptyMetrics();

    // Benchmark baselines (for comparison)
    this.baselines = {
      directCall: null, // Direct function call latency
      stdioCall: null, // MCP stdio call latency
      overhead: null, // Calculated overhead
    };

    logger.info("[MCPPerformanceMonitor] Initialized");
  }

  /**
   * Record connection attempt
   * @param {string} serverName - Server identifier
   * @param {number} duration - Connection time in ms
   * @param {boolean} success - Whether connection succeeded
   */
  recordConnection(serverName, duration, success) {
    this.metrics.connections.total++;

    if (success) {
      this.metrics.connections.successful++;
      this.retentionStats.connectionSamplesDropped += pushBounded(
        this.metrics.connections.times,
        duration,
        this.retention.connectionSamples,
      );
    } else {
      this.metrics.connections.failed++;
    }

    logger.info(
      `[MCPPerformanceMonitor] Connection to ${serverName}: ${duration}ms (${success ? "success" : "failed"})`,
    );

    this.emit("connection-recorded", { serverName, duration, success });
  }

  /**
   * Record tool call
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {number} duration - Execution time in ms
   * @param {boolean} success - Whether call succeeded
   * @param {Object} metadata - Additional metadata
   */
  recordToolCall(serverName, toolName, duration, success, metadata = {}) {
    this.metrics.toolCalls.total++;

    if (success) {
      this.metrics.toolCalls.successful++;
    } else {
      this.metrics.toolCalls.failed++;
    }

    // Record by tool. Once the dimension cap is reached, unseen names are
    // aggregated into one fixed overflow bucket instead of becoming new keys.
    const toolMetrics = this._getOrCreateSeries(
      this.metrics.toolCalls.byTool,
      toolName,
      this.retention.toolSeries,
      "tool",
    );
    toolMetrics.count++;
    this.retentionStats.toolLatencySamplesDropped += pushBounded(
      toolMetrics.latencies,
      duration,
      this.retention.latencySamplesPerSeries,
    );
    if (!success) {
      toolMetrics.errors++;
    }

    // Record by server using the same bounded high-cardinality policy.
    const serverMetrics = this._getOrCreateSeries(
      this.metrics.toolCalls.byServer,
      serverName,
      this.retention.serverSeries,
      "server",
    );
    serverMetrics.count++;
    this.retentionStats.serverLatencySamplesDropped += pushBounded(
      serverMetrics.latencies,
      duration,
      this.retention.latencySamplesPerSeries,
    );
    if (!success) {
      serverMetrics.errors++;
    }

    this.emit("tool-call-recorded", {
      serverName,
      toolName,
      duration,
      success,
      metadata,
    });
  }

  /**
   * Record error
   * @param {string} type - Error type (connection, tool_call, etc.)
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  recordError(type, error, context = {}) {
    const errorType = this._boundText(type);
    const message = this._boundText(error?.message || String(error));
    const stack = this._boundText(error?.stack || "");
    const boundedContext = this._boundContext(context);
    this.retentionStats.errorPayloadsTruncated +=
      Number(errorType.truncated) +
      Number(message.truncated) +
      Number(stack.truncated) +
      Number(boundedContext.truncated);
    this.retentionStats.errorsDropped += pushBounded(
      this.metrics.errors,
      {
        timestamp: Date.now(),
        type: errorType.value,
        message: message.value,
        stack: stack.value,
        context: boundedContext.value,
      },
      this.retention.errors,
    );

    this.emit("error-recorded", { type, error, context });
  }

  /**
   * Sample memory usage
   */
  sampleMemory() {
    const usage = process.memoryUsage();

    const sample = {
      timestamp: Date.now(),
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
    };

    this.retentionStats.memorySamplesDropped += pushBounded(
      this.metrics.memory.samples,
      sample,
      this.retention.memorySamples,
    );
    this.metrics.memory.lastSample = sample;

    return sample;
  }

  /**
   * Set baseline performance (for comparison)
   * @param {string} type - Baseline type (directCall, stdioCall)
   * @param {number} latency - Average latency in ms
   */
  setBaseline(type, latency) {
    if (!SUPPORTED_BASELINES.has(type)) {
      throw new TypeError(`Unsupported MCP performance baseline: ${type}`);
    }
    this.baselines[type] = latency;

    // Calculate overhead if both baselines are set
    if (this.baselines.directCall && this.baselines.stdioCall) {
      this.baselines.overhead =
        this.baselines.stdioCall - this.baselines.directCall;

      logger.info("[MCPPerformanceMonitor] Baselines updated:");
      logger.info(`  Direct call: ${this.baselines.directCall.toFixed(2)}ms`);
      logger.info(`  stdio call: ${this.baselines.stdioCall.toFixed(2)}ms`);
      logger.info(`  Overhead: ${this.baselines.overhead.toFixed(2)}ms`);
    }
  }

  /**
   * Get performance summary
   * @returns {Object} Performance summary statistics
   */
  getSummary() {
    return {
      connections: {
        total: this.metrics.connections.total,
        successful: this.metrics.connections.successful,
        failed: this.metrics.connections.failed,
        successRate: this._calculateRate(
          this.metrics.connections.successful,
          this.metrics.connections.total,
        ),
        avgTime: this._average(this.metrics.connections.times),
        minTime: this._min(this.metrics.connections.times),
        maxTime: this._max(this.metrics.connections.times),
        p95Time: this._percentile(this.metrics.connections.times, 95),
      },

      toolCalls: {
        total: this.metrics.toolCalls.total,
        successful: this.metrics.toolCalls.successful,
        failed: this.metrics.toolCalls.failed,
        successRate: this._calculateRate(
          this.metrics.toolCalls.successful,
          this.metrics.toolCalls.total,
        ),
        avgLatency: this._getOverallToolCallLatency(),
        minLatency: this._getOverallToolCallMinLatency(),
        maxLatency: this._getOverallToolCallMaxLatency(),
        p95Latency: this._getOverallToolCallP95Latency(),
      },

      byTool: this._getToolStatistics(),
      byServer: this._getServerStatistics(),

      memory: this._getMemoryStatistics(),

      baselines: this.baselines,

      errors: {
        total: this.metrics.errors.length,
        recent: this.metrics.errors.slice(-10),
      },

      retention: {
        limits: { ...this.retention },
        retained: {
          connectionSamples: this.metrics.connections.times.length,
          toolSeries: this.metrics.toolCalls.byTool.size,
          serverSeries: this.metrics.toolCalls.byServer.size,
          memorySamples: this.metrics.memory.samples.length,
          errors: this.metrics.errors.length,
        },
        stats: { ...this.retentionStats },
        overflowSeriesName: OVERFLOW_SERIES_NAME,
      },
    };
  }

  /**
   * Generate performance report
   * @returns {string} Formatted report
   */
  generateReport() {
    const summary = this.getSummary();

    let report = "\n";
    report += "═══════════════════════════════════════════════════\n";
    report += "  MCP PERFORMANCE REPORT\n";
    report += "═══════════════════════════════════════════════════\n\n";

    // Connections
    report += "1. CONNECTION METRICS\n";
    report += "─────────────────────────────────────────────────\n";
    report += `  Total connections: ${summary.connections.total}\n`;
    report += `  Successful: ${summary.connections.successful} (${summary.connections.successRate})\n`;
    report += `  Failed: ${summary.connections.failed}\n`;
    report += `  Avg time: ${summary.connections.avgTime.toFixed(2)}ms\n`;
    report += `  P95 time: ${summary.connections.p95Time.toFixed(2)}ms\n\n`;

    // Tool Calls
    report += "2. TOOL CALL METRICS\n";
    report += "─────────────────────────────────────────────────\n";
    report += `  Total calls: ${summary.toolCalls.total}\n`;
    report += `  Successful: ${summary.toolCalls.successful} (${summary.toolCalls.successRate})\n`;
    report += `  Failed: ${summary.toolCalls.failed}\n\n`;

    // Per-Server Stats
    if (summary.byServer.length > 0) {
      report += "3. PER-SERVER STATISTICS\n";
      report += "─────────────────────────────────────────────────\n";
      summary.byServer.forEach((server) => {
        report += `  ${server.name}:\n`;
        report += `    Calls: ${server.count}\n`;
        report += `    Avg latency: ${server.avgLatency.toFixed(2)}ms\n`;
        report += `    P95 latency: ${server.p95Latency.toFixed(2)}ms\n`;
        report += `    Errors: ${server.errors}\n`;
      });
      report += "\n";
    }

    // Baselines
    if (this.baselines.overhead !== null) {
      report += "4. BASELINE COMPARISON\n";
      report += "─────────────────────────────────────────────────\n";
      report += `  Direct call: ${this.baselines.directCall.toFixed(2)}ms\n`;
      report += `  stdio call: ${this.baselines.stdioCall.toFixed(2)}ms\n`;
      report += `  Overhead: ${this.baselines.overhead.toFixed(2)}ms\n`;
      report += `  Overhead %: ${((this.baselines.overhead / this.baselines.directCall) * 100).toFixed(1)}%\n\n`;
    }

    // Memory
    if (summary.memory.avgHeapUsed > 0) {
      report += "5. MEMORY USAGE\n";
      report += "─────────────────────────────────────────────────\n";
      report += `  Avg heap: ${(summary.memory.avgHeapUsed / 1024 / 1024).toFixed(2)} MB\n`;
      report += `  Avg RSS: ${(summary.memory.avgRSS / 1024 / 1024).toFixed(2)} MB\n\n`;
    }

    report += "═══════════════════════════════════════════════════\n";

    return report;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = this._createEmptyMetrics();
    this.retentionStats = this._createRetentionStats();

    logger.info("[MCPPerformanceMonitor] Metrics reset");
  }

  // ===================================
  // Private Methods
  // ===================================

  _createEmptyMetrics() {
    return {
      connections: { total: 0, successful: 0, failed: 0, times: [] },
      toolCalls: {
        total: 0,
        successful: 0,
        failed: 0,
        byTool: new Map(),
        byServer: new Map(),
      },
      memory: { samples: [], lastSample: null },
      errors: [],
    };
  }

  _createRetentionStats() {
    return {
      connectionSamplesDropped: 0,
      toolLatencySamplesDropped: 0,
      serverLatencySamplesDropped: 0,
      memorySamplesDropped: 0,
      errorsDropped: 0,
      overflowToolCalls: 0,
      overflowServerCalls: 0,
      seriesNamesHashed: 0,
      errorPayloadsTruncated: 0,
    };
  }

  _normalizeSeriesName(value) {
    const name = String(value ?? "");
    if (
      name !== OVERFLOW_SERIES_NAME &&
      Buffer.byteLength(name, "utf8") <= this.retention.seriesNameBytes
    ) {
      return name;
    }
    this.retentionStats.seriesNamesHashed++;
    return `sha256:${crypto.createHash("sha256").update(name).digest("hex")}`;
  }

  _getOrCreateSeries(seriesMap, rawName, maxSeries, dimension) {
    const name = this._normalizeSeriesName(rawName);
    let key = name;
    if (!seriesMap.has(name) && seriesMap.size >= maxSeries - 1) {
      key = OVERFLOW_SERIES;
      if (dimension === "tool") {
        this.retentionStats.overflowToolCalls++;
      } else {
        this.retentionStats.overflowServerCalls++;
      }
    }

    if (!seriesMap.has(key)) {
      seriesMap.set(key, { count: 0, latencies: [], errors: 0 });
    }
    return seriesMap.get(key);
  }

  _boundText(value) {
    const text = String(value ?? "");
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length <= this.retention.errorTextBytes) {
      return { value: text, truncated: false };
    }

    let bounded = bytes
      .subarray(0, this.retention.errorTextBytes)
      .toString("utf8");
    while (
      bounded.length > 0 &&
      Buffer.byteLength(bounded, "utf8") > this.retention.errorTextBytes
    ) {
      bounded = bounded.slice(0, -1);
    }
    return { value: bounded, truncated: true };
  }

  _boundContext(context) {
    try {
      const serialized = JSON.stringify(context ?? {});
      if (serialized === undefined) {
        return { value: {}, truncated: true };
      }
      const byteLength = Buffer.byteLength(serialized, "utf8");
      if (byteLength <= this.retention.errorContextBytes) {
        return { value: JSON.parse(serialized), truncated: false };
      }
      return {
        value: {
          truncated: true,
          byteLength,
          sha256: crypto.createHash("sha256").update(serialized).digest("hex"),
        },
        truncated: true,
      };
    } catch (_error) {
      return {
        value: { truncated: true, reason: "unserializable" },
        truncated: true,
      };
    }
  }

  _getToolStatistics() {
    const stats = [];

    for (const [toolName, metrics] of this.metrics.toolCalls.byTool.entries()) {
      stats.push({
        name: toolName === OVERFLOW_SERIES ? OVERFLOW_SERIES_NAME : toolName,
        count: metrics.count,
        avgLatency: this._average(metrics.latencies),
        minLatency: this._min(metrics.latencies),
        maxLatency: this._max(metrics.latencies),
        p95Latency: this._percentile(metrics.latencies, 95),
        errors: metrics.errors,
      });
    }

    return stats.sort((a, b) => b.count - a.count);
  }

  _getServerStatistics() {
    const stats = [];

    for (const [
      serverName,
      metrics,
    ] of this.metrics.toolCalls.byServer.entries()) {
      stats.push({
        name:
          serverName === OVERFLOW_SERIES ? OVERFLOW_SERIES_NAME : serverName,
        count: metrics.count,
        avgLatency: this._average(metrics.latencies),
        minLatency: this._min(metrics.latencies),
        maxLatency: this._max(metrics.latencies),
        p95Latency: this._percentile(metrics.latencies, 95),
        errors: metrics.errors,
      });
    }

    return stats;
  }

  _getMemoryStatistics() {
    if (this.metrics.memory.samples.length === 0) {
      return { avgHeapUsed: 0, avgRSS: 0 };
    }

    const heapUsed = this.metrics.memory.samples.map((s) => s.heapUsed);
    const rss = this.metrics.memory.samples.map((s) => s.rss);

    return {
      avgHeapUsed: this._average(heapUsed),
      avgRSS: this._average(rss),
    };
  }

  _average(arr) {
    if (!arr || arr.length === 0) {
      return 0;
    }
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  // Guard empty arrays: Math.min(...[]) === Infinity and Math.max(...[]) ===
  // -Infinity, which leaked into getSummary/per-tool stats as "Infinity ms".
  _min(arr) {
    if (!arr || arr.length === 0) {
      return 0;
    }
    return Math.min(...arr);
  }

  _max(arr) {
    if (!arr || arr.length === 0) {
      return 0;
    }
    return Math.max(...arr);
  }

  _percentile(arr, p) {
    if (!arr || arr.length === 0) {
      return 0;
    }
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }

  _calculateRate(success, total) {
    if (total === 0) {
      return "0%";
    }
    return ((success / total) * 100).toFixed(1) + "%";
  }

  /**
   * Get all tool call latencies combined
   * @private
   */
  _getAllToolCallLatencies() {
    const allLatencies = [];
    for (const metrics of this.metrics.toolCalls.byTool.values()) {
      allLatencies.push(...metrics.latencies);
    }
    return allLatencies;
  }

  /**
   * Get overall average tool call latency
   * @private
   */
  _getOverallToolCallLatency() {
    return this._average(this._getAllToolCallLatencies());
  }

  /**
   * Get overall minimum tool call latency
   * @private
   */
  _getOverallToolCallMinLatency() {
    const latencies = this._getAllToolCallLatencies();
    if (latencies.length === 0) {
      return 0;
    }
    return Math.min(...latencies);
  }

  /**
   * Get overall maximum tool call latency
   * @private
   */
  _getOverallToolCallMaxLatency() {
    const latencies = this._getAllToolCallLatencies();
    if (latencies.length === 0) {
      return 0;
    }
    return Math.max(...latencies);
  }

  /**
   * Get overall P95 tool call latency
   * @private
   */
  _getOverallToolCallP95Latency() {
    return this._percentile(this._getAllToolCallLatencies(), 95);
  }
}

module.exports = MCPPerformanceMonitor;
