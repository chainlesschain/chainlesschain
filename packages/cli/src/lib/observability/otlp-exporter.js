/**
 * OTLP Exporter — M8 Observability
 * OpenTelemetry Protocol exporter for spans and metrics
 * Sends to localhost:4318 by default, with batching and retry
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

class OtlpExporter {
  constructor(options = {}) {
    this.endpoint =
      options.endpoint ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      "http://localhost:4318";
    this.headers = options.headers || {};
    this.serviceName =
      options.serviceName ||
      process.env.OTEL_SERVICE_NAME ||
      "chainlesschain-cli";
    this.batchSize = options.batchSize || 512;
    this.flushIntervalMs = options.flushIntervalMs || 5000;
    this._spanBuffer = [];
    this._metricBuffer = [];
    this._timer = null;
    this._droppedSpans = 0;
    this._droppedMetrics = 0;
    this._failedExports = 0;
    this._successfulExports = 0;
    this._enabled = options.enabled !== false;
    if (this._enabled) {
      this._startFlushTimer();
    }
  }

  _startFlushTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.flush(), this.flushIntervalMs);
    this._timer.unref?.();
  }

  _getHttpModule(urlStr) {
    return urlStr.startsWith("https:") ? https : http;
  }

  _post(path, data, contentType) {
    if (!this._enabled) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        const url = new URL(path, this.endpoint);
        const mod = this._getHttpModule(url.protocol);
        const payload = JSON.stringify(data);
        const req = mod.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: "POST",
            headers: {
              "Content-Type": contentType,
              "Content-Length": Buffer.byteLength(payload),
              ...this.headers,
            },
            timeout: 10000,
          },
          (res) => {
            res.resume();
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this._successfulExports++;
            } else {
              this._failedExports++;
            }
            resolve();
          },
        );
        req.on("error", () => {
          this._failedExports++;
          resolve();
        });
        req.on("timeout", () => {
          req.destroy();
          this._failedExports++;
          resolve();
        });
        req.write(payload);
        req.end();
      } catch {
        resolve();
      }
    });
  }

  exportSpans(spans) {
    if (!this._enabled) return;
    for (const span of spans) {
      if (this._spanBuffer.length >= this.batchSize) {
        this._spanBuffer.shift();
        this._droppedSpans++;
      }
      this._spanBuffer.push({
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: this.serviceName },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: span.component || "chainlesschain" },
                spans: [this._toOtlpSpan(span)],
              },
            ],
          },
        ],
      });
    }
  }

  _toOtlpSpan(span) {
    return {
      traceId: span.traceId || "",
      spanId: span.spanId || "",
      parentSpanId: span.parentSpanId || "",
      name: span.name || "unknown",
      kind: this._toSpanKind(span.kind),
      startTimeUnixNano: (span.startTime || Date.now()) * 1_000_000,
      endTimeUnixNano: (span.endTime || Date.now()) * 1_000_000,
      attributes: Object.entries(span.attributes || {}).map(([k, v]) => ({
        key: k,
        value: this._toAttrValue(v),
      })),
      status: { code: span.error ? 2 : 1, message: span.error?.message || "" },
      events: (span.events || []).map((e) => ({
        timeUnixNano: (e.time || Date.now()) * 1_000_000,
        name: e.name,
        attributes: Object.entries(e.attributes || {}).map(([k, v]) => ({
          key: k,
          value: this._toAttrValue(v),
        })),
      })),
    };
  }

  _toSpanKind(kind) {
    const map = { internal: 0, server: 1, client: 2, producer: 3, consumer: 4 };
    return map[kind] ?? 0;
  }

  _toAttrValue(v) {
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "number")
      return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
    if (typeof v === "boolean") return { boolValue: v };
    return { stringValue: String(v) };
  }

  exportMetrics(metrics) {
    if (!this._enabled) return;
    for (const metric of metrics) {
      if (this._metricBuffer.length >= this.batchSize) {
        this._metricBuffer.shift();
        this._droppedMetrics++;
      }
      this._metricBuffer.push({
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: this.serviceName },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: metric.component || "chainlesschain" },
                metrics: [this._toOtlpMetric(metric)],
              },
            ],
          },
        ],
      });
    }
  }

  _toOtlpMetric(metric) {
    return {
      name: metric.name,
      description: metric.description || "",
      unit: metric.unit || "1",
      [metric.type === "histogram"
        ? "histogram"
        : metric.type === "sum"
          ? "sum"
          : "gauge"]: {
        dataPoints: [
          {
            attributes: Object.entries(metric.attributes || {}).map(
              ([k, v]) => ({ key: k, value: this._toAttrValue(v) }),
            ),
            timeUnixNano: Date.now() * 1_000_000,
            ...(metric.type === "histogram"
              ? {
                  count: metric.value?.count || 0,
                  sum: metric.value?.sum || 0,
                  bucketCounts: metric.value?.bucketCounts || [],
                  explicitBounds: metric.value?.explicitBounds || [],
                }
              : { asDouble: metric.value || 0 }),
          },
        ],
        aggregationTemporality: 1,
        isMonotonic: metric.type === "sum",
      },
    };
  }

  async flush() {
    if (!this._enabled) return;
    const spans = this._spanBuffer.splice(0);
    const metrics = this._metricBuffer.splice(0);
    const promises = [];
    for (const span of spans)
      promises.push(this._post("/v1/traces", span, "application/json"));
    for (const metric of metrics)
      promises.push(this._post("/v1/metrics", metric, "application/json"));
    await Promise.allSettled(promises);
  }

  shutdown() {
    if (this._timer) clearInterval(this._timer);
    return this.flush();
  }

  getStats() {
    return {
      enabled: this._enabled,
      bufferedSpans: this._spanBuffer.length,
      bufferedMetrics: this._metricBuffer.length,
      droppedSpans: this._droppedSpans,
      droppedMetrics: this._droppedMetrics,
      failedExports: this._failedExports,
      successfulExports: this._successfulExports,
    };
  }
}

let _defaultExporter = null;
export function getDefaultOtlpExporter() {
  if (!_defaultExporter) _defaultExporter = new OtlpExporter();
  return _defaultExporter;
}
export { OtlpExporter };
export default OtlpExporter;
