/**
 * MetricsCollector - CLI runtime metrics collection (M3)
 *
 * Collects counters, gauges, histograms for performance monitoring
 * with OTLP export support (M8 integration)
 */

export class MetricsCollector {
  constructor() {
    this._counters = new Map();
    this._gauges = new Map();
    this._histograms = new Map();
  }

  /**
   * Increment a counter metric
   * @param {string} name - Metric name
   * @param {number} value - Increment amount (default 1)
   * @param {object} labels - Metric labels
   */
  counter(name, value = 1, labels = {}) {
    const key = this._key(name, labels);
    if (!this._counters.has(key)) {
      this._counters.set(key, { name, value: 0, labels });
    }
    this._counters.get(key).value += value;
  }

  /**
   * Set a gauge metric
   * @param {string} name - Metric name
   * @param {number} value - Gauge value
   * @param {object} labels - Metric labels
   */
  gauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this._gauges.set(key, { name, value, labels, timestamp: Date.now() });
  }

  /**
   * Record a histogram observation
   * @param {string} name - Metric name
   * @param {number} value - Observed value
   * @param {object} labels - Metric labels
   */
  histogram(name, value, labels = {}) {
    const key = this._key(name, labels);
    if (!this._histograms.has(key)) {
      this._histograms.set(key, {
        name,
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        labels,
        values: [],
      });
    }
    const h = this._histograms.get(key);
    h.count++;
    h.sum += value;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);
    // Keep last 1000 values for percentile calculation
    if (h.values.length < 1000) {
      h.values.push(value);
    } else {
      h.values[h.count % 1000] = value;
    }
  }

  /**
   * Time a function execution and record duration
   * @param {string} name - Metric name
   * @param {Function} fn - Function to time
   * @param {object} labels - Metric labels
   * @returns {*} Function result
   */
  async timer(name, fn, labels = {}) {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.histogram(name, duration, labels);
    }
  }

  /**
   * Get all collected metrics
   * @returns {object} All metrics
   */
  snapshot() {
    return {
      counters: Array.from(this._counters.values()),
      gauges: Array.from(this._gauges.values()),
      histograms: Array.from(this._histograms.values()).map((h) => ({
        name: h.name,
        count: h.count,
        sum: h.sum,
        min: h.min,
        max: h.max,
        avg: h.sum / h.count,
        labels: h.labels,
      })),
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this._counters.clear();
    this._gauges.clear();
    this._histograms.clear();
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
  }
}

export const metricsCollector = new MetricsCollector();
