/**
 * MCP Performance Monitor
 *
 * Tracks and analyzes performance metrics for MCP operations.
 * Helps identify bottlenecks and measure stdio overhead.
 *
 * @module MCPPerformanceMonitor
 */

const EventEmitter = require("events");

class MCPPerformanceMonitor extends EventEmitter {
  constructor() {
    super();

    // Performance metrics
    this.metrics = {
      // Connection metrics
      connections: {
        total: 0,
        successful: 0,
        failed: 0,
        times: [], // Connection times in ms
      },

      // Tool call metrics
      toolCalls: {
        total: 0,
        successful: 0,
        failed: 0,
        byTool: new Map(), // toolName -> { count, latencies, errors }
        byServer: new Map(), // serverName -> { count, latencies, errors }
      },

      // Memory usage
      memory: {
        samples: [],
        lastSample: null,
      },

      // Error tracking
      errors: [],
    };

    // Benchmark baselines (for comparison)
    this.baselines = {
      directCall: null, // Direct function call latency
      stdioCall: null, // MCP stdio call latency
      overhead: null, // Calculated overhead
    };

    console.log("[MCPPerformanceMonitor] Initialized");
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
      this.metrics.connections.times.push(duration);
    } else {
      this.metrics.connections.failed++;
    }

    console.log(
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

    // Record by tool
    if (!this.metrics.toolCalls.byTool.has(toolName)) {
      this.metrics.toolCalls.byTool.set(toolName, {
        count: 0,
        latencies: [],
        errors: 0,
      });
    }

    const toolMetrics = this.metrics.toolCalls.byTool.get(toolName);
    toolMetrics.count++;
    toolMetrics.latencies.push(duration);
    if (!success) {toolMetrics.errors++;}

    // Record by server
    if (!this.metrics.toolCalls.byServer.has(serverName)) {
      this.metrics.toolCalls.byServer.set(serverName, {
        count: 0,
        latencies: [],
        errors: 0,
      });
    }

    const serverMetrics = this.metrics.toolCalls.byServer.get(serverName);
    serverMetrics.count++;
    serverMetrics.latencies.push(duration);
    if (!success) {serverMetrics.errors++;}

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
    this.metrics.errors.push({
      timestamp: Date.now(),
      type,
      message: error.message,
      stack: error.stack,
      context,
    });

    // Keep only last 100 errors
    if (this.metrics.errors.length > 100) {
      this.metrics.errors.shift();
    }

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

    this.metrics.memory.samples.push(sample);
    this.metrics.memory.lastSample = sample;

    // Keep only last 100 samples
    if (this.metrics.memory.samples.length > 100) {
      this.metrics.memory.samples.shift();
    }

    return sample;
  }

  /**
   * Set baseline performance (for comparison)
   * @param {string} type - Baseline type (directCall, stdioCall)
   * @param {number} latency - Average latency in ms
   */
  setBaseline(type, latency) {
    this.baselines[type] = latency;

    // Calculate overhead if both baselines are set
    if (this.baselines.directCall && this.baselines.stdioCall) {
      this.baselines.overhead =
        this.baselines.stdioCall - this.baselines.directCall;

      console.log("[MCPPerformanceMonitor] Baselines updated:");
      console.log(`  Direct call: ${this.baselines.directCall.toFixed(2)}ms`);
      console.log(`  stdio call: ${this.baselines.stdioCall.toFixed(2)}ms`);
      console.log(`  Overhead: ${this.baselines.overhead.toFixed(2)}ms`);
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
        minTime: Math.min(...(this.metrics.connections.times || [0])),
        maxTime: Math.max(...(this.metrics.connections.times || [0])),
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
    this.metrics = {
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

    console.log("[MCPPerformanceMonitor] Metrics reset");
  }

  // ===================================
  // Private Methods
  // ===================================

  _getToolStatistics() {
    const stats = [];

    for (const [toolName, metrics] of this.metrics.toolCalls.byTool.entries()) {
      stats.push({
        name: toolName,
        count: metrics.count,
        avgLatency: this._average(metrics.latencies),
        minLatency: Math.min(...metrics.latencies),
        maxLatency: Math.max(...metrics.latencies),
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
        name: serverName,
        count: metrics.count,
        avgLatency: this._average(metrics.latencies),
        minLatency: Math.min(...metrics.latencies),
        maxLatency: Math.max(...metrics.latencies),
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
    if (!arr || arr.length === 0) {return 0;}
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  _percentile(arr, p) {
    if (!arr || arr.length === 0) {return 0;}
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }

  _calculateRate(success, total) {
    if (total === 0) {return "0%";}
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
    if (latencies.length === 0) {return 0;}
    return Math.min(...latencies);
  }

  /**
   * Get overall maximum tool call latency
   * @private
   */
  _getOverallToolCallMaxLatency() {
    const latencies = this._getAllToolCallLatencies();
    if (latencies.length === 0) {return 0;}
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
