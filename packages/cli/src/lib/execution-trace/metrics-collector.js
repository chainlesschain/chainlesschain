/**
 * MetricsCollector - M3 轻量级指标收集器
 *
 * 收集CLI运行时的性能指标：
 * - 执行计数器
 * - 延迟直方图
 * - 标签化指标
 * - 自动与traceId关联
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { traceContext } from "./trace-context.js";

class MetricsCollector {
  constructor() {
    this._counters = new Map();
    this._histograms = new Map();
    this._gauges = new Map();
    this._flushedAt = Date.now();
  }

  /**
   * Increment a counter metric
   * @param {string} name - Metric name
   * @param {number} value - Value to increment by (default: 1)
   * @param {Object} labels - Key-value labels
   */
  increment(name, value = 1, labels = {}) {
    const key = this._metricKey(name, labels);
    const current = this._counters.get(key) || 0;
    this._counters.set(key, current + value);
  }

  /**
   * Record a value in a histogram (latency, sizes, etc.)
   * @param {string} name - Metric name
   * @param {number} value - Value to record
   * @param {Object} labels - Key-value labels
   */
  observe(name, value, labels = {}) {
    const key = this._metricKey(name, labels);
    const data = this._histograms.get(key) || {
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      values: [],
    };
    data.count += 1;
    data.sum += value;
    data.min = Math.min(data.min, value);
    data.max = Math.max(data.max, value);
    // Keep last 1000 values for percentile calculation
    if (data.values.length > 1000) {
      data.values.shift();
    }
    data.values.push(value);
    this._histograms.set(key, data);
  }

  /**
   * Set a gauge value
   * @param {string} name - Metric name
   * @param {number} value - Gauge value
   * @param {Object} labels - Key-value labels
   */
  setGauge(name, value, labels = {}) {
    const key = this._metricKey(name, labels);
    this._gauges.set(key, value);
  }

  /**
   * Time an async function and record latency
   * @param {string} name - Metric name
   * @param {Function} fn - Async function to time
   * @param {Object} labels - Key-value labels
   * @returns {Promise<*>} Function result
   */
  async time(name, fn, labels = {}) {
    const start = performance.now();
    try {
      const result = await fn();
      this.observe(name, performance.now() - start, {
        ...labels,
        status: "success",
      });
      this.increment(`${name}_total`, 1, { ...labels, status: "success" });
      return result;
    } catch (err) {
      this.observe(name, performance.now() - start, {
        ...labels,
        status: "error",
      });
      this.increment(`${name}_total`, 1, {
        ...labels,
        status: "error",
        errorType: err.name,
      });
      throw err;
    }
  }

  /**
   * Get all collected metrics as OTLP-compatible format
   * @returns {Object} OTLP metrics data
   */
  collect() {
    const metrics = [];

    // Convert counters
    for (const [key, value] of this._counters) {
      const { name, labels } = this._parseKey(key);
      metrics.push({
        name,
        type: "counter",
        value,
        labels,
        timestamp: Date.now(),
      });
    }

    // Convert histograms
    for (const [key, data] of this._histograms) {
      const { name, labels } = this._parseKey(key);
      data.values.sort((a, b) => a - b);
      const p50 = data.values[Math.floor(data.values.length * 0.5)];
      const p95 = data.values[Math.floor(data.values.length * 0.95)];
      const p99 = data.values[Math.floor(data.values.length * 0.99)];
      metrics.push({
        name,
        type: "histogram",
        count: data.count,
        sum: data.sum,
        min: data.min,
        max: data.max,
        avg: data.sum / data.count,
        p50,
        p95,
        p99,
        labels,
        timestamp: Date.now(),
      });
    }

    // Convert gauges
    for (const [key, value] of this._gauges) {
      const { name, labels } = this._parseKey(key);
      metrics.push({
        name,
        type: "gauge",
        value,
        labels,
        timestamp: Date.now(),
      });
    }

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: "chainlesschain-cli" },
              },
              {
                key: "service.version",
                value: { stringValue: "0.10.0-alpha.74" },
              },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "chainlesschain.cli" },
              metrics,
            },
          ],
        },
      ],
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this._counters.clear();
    this._histograms.clear();
    this._gauges.clear();
    this._flushedAt = Date.now();
  }

  _metricKey(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  _parseKey(key) {
    const match = key.match(/^([^{]+)(?:\{([^}]+)\})?$/);
    if (!match) return { name: key, labels: {} };
    const [, name, labelStr] = match;
    if (!labelStr) return { name, labels: {} };
    const labels = {};
    for (const pair of labelStr.split(",")) {
      const [k, v] = pair.split("=");
      if (k) labels[k] = v;
    }
    return { name, labels };
  }
}

export { MetricsCollector };
export const metricsCollector = new MetricsCollector();
export default metricsCollector;
