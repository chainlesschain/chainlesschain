/**
 * Dependency-free OTLP/HTTP JSON exporter.
 *
 * The OpenTelemetry Collector accepts the proto3 JSON mapping at
 * `/v1/traces` and `/v1/metrics`. This exporter deliberately stays outside the
 * execution/audit layers: telemetry failure must never change command results.
 *
 * Supported OpenTelemetry environment variables:
 *   OTEL_SDK_DISABLED
 *   OTEL_SERVICE_NAME
 *   OTEL_RESOURCE_ATTRIBUTES
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}ENDPOINT
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}PROTOCOL
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}HEADERS
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}TIMEOUT
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}COMPRESSION
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}CERTIFICATE
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}CLIENT_CERTIFICATE
 *   OTEL_EXPORTER_OTLP_{,TRACES_,METRICS_}CLIENT_KEY
 *
 * ChainlessChain-only reliability controls:
 *   CC_OTEL_MAX_QUEUE_SIZE, CC_OTEL_MAX_EXPORT_BATCH_SIZE,
 *   CC_OTEL_MAX_ATTEMPTS, CC_OTEL_SPOOL_DIR.
 */

import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { URL } from "node:url";
import { getHomeDir } from "../paths.js";
import { redactSecrets } from "../secret-scan.js";

const SIGNALS = new Set(["traces", "metrics"]);
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SCHEDULE_DELAY_MS = 5_000;
const DEFAULT_MAX_QUEUE_SIZE = 2_048;
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 128;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30_000;
const MAX_RECOVERY_FILE_AGE_MS = 24 * 60 * 60 * 1_000;

function positiveInt(value, fallback, { min = 1, max = 1_000_000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded >= min && rounded <= max ? rounded : fallback;
}

function envValue(env, signal, suffix) {
  const scoped = env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_${suffix}`];
  return scoped == null || scoped === ""
    ? env[`OTEL_EXPORTER_OTLP_${suffix}`]
    : scoped;
}

function appendSignalPath(endpoint, signal) {
  const url = new URL(endpoint);
  const suffix = `/v1/${signal}`;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${suffix}`;
  return url.toString();
}

function normalizeProtocol(value) {
  const protocol = String(value || "http/json").toLowerCase();
  if (["http/json", "http/protobuf", "grpc"].includes(protocol)) {
    return { protocol, error: null };
  }
  return {
    protocol: null,
    error: `unsupported OTLP protocol: ${protocol}`,
  };
}

function resolveSignalEndpoint(options, env, signal, protocol) {
  const explicit = options[`${signal}Endpoint`];
  if (explicit) return new URL(explicit).toString();
  const scoped = envValue(env, signal, "ENDPOINT");
  const general =
    options.endpoint ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    (options.enabled === true ? "http://localhost:4318" : null);
  if (!scoped && !general) return null;
  return scoped
    ? new URL(scoped).toString()
    : protocol === "grpc"
      ? new URL(general).toString()
      : appendSignalPath(general, signal);
}

export function parseOtlpHeaders(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  const headers = {};
  for (const pair of String(value).split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    try {
      const key = decodeURIComponent(pair.slice(0, separator).trim());
      const headerValue = decodeURIComponent(pair.slice(separator + 1).trim());
      if (key) headers[key] = headerValue;
    } catch {
      // A malformed percent escape invalidates only that header.
    }
  }
  return headers;
}

export function parseResourceAttributes(value) {
  return parseOtlpHeaders(value);
}

function readTlsFile(filePath, readFileSync = fs.readFileSync) {
  if (!filePath) return undefined;
  return readFileSync(filePath);
}

function signalTlsOptions(options, env, signal, readFileSync) {
  const from = (suffix, optionKey) =>
    options[`${signal}${optionKey}`] ||
    options[optionKey[0].toLowerCase() + optionKey.slice(1)] ||
    envValue(env, signal, suffix);
  return {
    ca: readTlsFile(from("CERTIFICATE", "Certificate"), readFileSync),
    cert: readTlsFile(
      from("CLIENT_CERTIFICATE", "ClientCertificate"),
      readFileSync,
    ),
    key: readTlsFile(from("CLIENT_KEY", "ClientKey"), readFileSync),
  };
}

/**
 * Resolve standard OTel configuration without mutating `process.env`.
 * A Collector is opt-in: an endpoint (flag/env) or `enabled:true` is required.
 */
export function resolveOtlpConfig(options = {}, env = process.env, deps = {}) {
  const disabled =
    options.enabled === false ||
    String(env.OTEL_SDK_DISABLED || "").toLowerCase() === "true";
  const traceProtocol = normalizeProtocol(
    options.tracesProtocol || envValue(env, "traces", "PROTOCOL"),
  );
  const metricProtocol = normalizeProtocol(
    options.metricsProtocol || envValue(env, "metrics", "PROTOCOL"),
  );
  const tracesEndpoint =
    disabled || !traceProtocol.protocol
      ? null
      : resolveSignalEndpoint(options, env, "traces", traceProtocol.protocol);
  const metricsEndpoint =
    disabled || !metricProtocol.protocol
      ? null
      : resolveSignalEndpoint(options, env, "metrics", metricProtocol.protocol);
  const enabled = !disabled && Boolean(tracesEndpoint || metricsEndpoint);
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const commonHeaders = parseOtlpHeaders(
    options.headers || env.OTEL_EXPORTER_OTLP_HEADERS,
  );
  const signal = (name, endpoint, protocolConfig) => ({
    endpoint,
    protocol: protocolConfig.protocol,
    configError: protocolConfig.error,
    headers: {
      ...commonHeaders,
      ...parseOtlpHeaders(
        options[`${name}Headers`] ||
          env[`OTEL_EXPORTER_OTLP_${name.toUpperCase()}_HEADERS`],
      ),
    },
    timeoutMs: positiveInt(
      options[`${name}TimeoutMs`] || envValue(env, name, "TIMEOUT"),
      DEFAULT_TIMEOUT_MS,
      { max: 300_000 },
    ),
    compression: String(
      options[`${name}Compression`] ||
        envValue(env, name, "COMPRESSION") ||
        "none",
    ).toLowerCase(),
    tls: endpoint
      ? signalTlsOptions(options, env, name, readFileSync)
      : { ca: undefined, cert: undefined, key: undefined },
  });
  const serviceName =
    options.serviceName || env.OTEL_SERVICE_NAME || "chainlesschain-cli";
  const resourceAttributes = {
    ...parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES),
    ...(options.resourceAttributes || {}),
    "service.name": serviceName,
  };
  return {
    enabled,
    serviceName,
    resourceAttributes,
    traces: signal("traces", tracesEndpoint, traceProtocol),
    metrics: signal("metrics", metricsEndpoint, metricProtocol),
    scheduleDelayMs: positiveInt(
      options.scheduleDelayMs || env.OTEL_BSP_SCHEDULE_DELAY,
      DEFAULT_SCHEDULE_DELAY_MS,
      { max: 300_000 },
    ),
    maxQueueSize: positiveInt(
      options.maxQueueSize || env.CC_OTEL_MAX_QUEUE_SIZE,
      DEFAULT_MAX_QUEUE_SIZE,
      { max: 100_000 },
    ),
    maxExportBatchSize: positiveInt(
      options.maxExportBatchSize || env.CC_OTEL_MAX_EXPORT_BATCH_SIZE,
      DEFAULT_MAX_EXPORT_BATCH_SIZE,
      { max: 10_000 },
    ),
    maxAttempts: positiveInt(
      options.maxAttempts || env.CC_OTEL_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      { max: 20 },
    ),
    spoolDir:
      options.spoolDir ||
      env.CC_OTEL_SPOOL_DIR ||
      path.join(getHomeDir(), "telemetry", "otlp-queue"),
  };
}

function cloneAndRedact(value, redact = true) {
  if (Array.isArray(value))
    return value.map((item) => cloneAndRedact(item, redact));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (redact && key === "stringValue" && typeof child === "string") {
      out[key] = redactSecrets(child);
    } else {
      out[key] = cloneAndRedact(child, redact);
    }
  }
  return out;
}

function otlpValue(value, redact = true) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return {
    stringValue: redact ? redactSecrets(String(value)) : String(value),
  };
}

function resourceAttributes(attributes, redact = true) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: otlpValue(value, redact),
  }));
}

function protobufVarint(value) {
  let remaining = BigInt.asUintN(64, BigInt(value || 0));
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function protobufTag(field, wireType) {
  return protobufVarint((field << 3) | wireType);
}

function protobufBytes(field, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  return Buffer.concat([
    protobufTag(field, 2),
    protobufVarint(bytes.length),
    bytes,
  ]);
}

function protobufString(field, value) {
  return value == null || value === ""
    ? Buffer.alloc(0)
    : protobufBytes(field, Buffer.from(String(value), "utf8"));
}

function protobufMessage(field, chunks) {
  const body = Buffer.concat(chunks.filter((chunk) => chunk.length > 0));
  return body.length > 0 ? protobufBytes(field, body) : Buffer.alloc(0);
}

function protobufUInt(field, value) {
  return value == null || Number(value) === 0
    ? Buffer.alloc(0)
    : Buffer.concat([protobufTag(field, 0), protobufVarint(value)]);
}

function protobufFixed64(field, value) {
  if (value == null || value === "") return Buffer.alloc(0);
  return Buffer.concat([protobufTag(field, 1), protobufFixed64Body(value)]);
}

function protobufFixed64Body(value) {
  const body = Buffer.alloc(8);
  body.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)));
  return body;
}

function protobufFixed32(field, value) {
  if (value == null || Number(value) === 0) return Buffer.alloc(0);
  const body = Buffer.alloc(4);
  body.writeUInt32LE(Number(value) >>> 0);
  return Buffer.concat([protobufTag(field, 5), body]);
}

function protobufDouble(field, value) {
  if (value == null) return Buffer.alloc(0);
  const body = Buffer.alloc(8);
  body.writeDoubleLE(Number(value), 0);
  return Buffer.concat([protobufTag(field, 1), body]);
}

function protobufHexBytes(field, value, expectedBytes) {
  if (!value) return Buffer.alloc(0);
  const normalized = String(value).replace(/[^a-fA-F0-9]/g, "");
  if (normalized.length !== expectedBytes * 2) return Buffer.alloc(0);
  return protobufBytes(field, Buffer.from(normalized, "hex"));
}

function encodeAnyValue(value = {}) {
  if (Object.hasOwn(value, "stringValue")) {
    return protobufBytes(1, Buffer.from(String(value.stringValue), "utf8"));
  }
  if (Object.hasOwn(value, "boolValue")) {
    return Buffer.concat([
      protobufTag(2, 0),
      protobufVarint(value.boolValue ? 1 : 0),
    ]);
  }
  if (Object.hasOwn(value, "intValue")) {
    return Buffer.concat([protobufTag(3, 0), protobufVarint(value.intValue)]);
  }
  if (Object.hasOwn(value, "doubleValue")) {
    return protobufDouble(4, value.doubleValue);
  }
  if (value.arrayValue?.values) {
    return protobufMessage(
      5,
      value.arrayValue.values.map((item) =>
        protobufMessage(1, [encodeAnyValue(item)]),
      ),
    );
  }
  if (value.kvlistValue?.values) {
    return protobufMessage(
      6,
      value.kvlistValue.values.map((item) =>
        protobufMessage(1, [encodeKeyValue(item)]),
      ),
    );
  }
  if (value.bytesValue) {
    return protobufBytes(7, Buffer.from(value.bytesValue, "base64"));
  }
  return Buffer.alloc(0);
}

function encodeKeyValue(attribute = {}) {
  return Buffer.concat([
    protobufString(1, attribute.key),
    protobufMessage(2, [encodeAnyValue(attribute.value)]),
  ]);
}

function encodeAttributes(attributes = [], field = 1) {
  return attributes.map((attribute) =>
    protobufMessage(field, [encodeKeyValue(attribute)]),
  );
}

function encodeResource(resource = {}) {
  return Buffer.concat([
    ...encodeAttributes(resource.attributes, 1),
    protobufUInt(2, resource.droppedAttributesCount),
  ]);
}

function encodeScope(scope = {}) {
  return Buffer.concat([
    protobufString(1, scope.name),
    protobufString(2, scope.version),
    ...encodeAttributes(scope.attributes, 3),
    protobufUInt(4, scope.droppedAttributesCount),
  ]);
}

function encodeSpanEvent(event = {}) {
  return Buffer.concat([
    protobufFixed64(1, event.timeUnixNano),
    protobufString(2, event.name),
    ...encodeAttributes(event.attributes, 3),
    protobufUInt(4, event.droppedAttributesCount),
  ]);
}

function encodeSpanStatus(status = {}) {
  return Buffer.concat([
    protobufString(2, status.message),
    protobufUInt(3, status.code),
  ]);
}

function encodeSpan(span = {}) {
  return Buffer.concat([
    protobufHexBytes(1, span.traceId, 16),
    protobufHexBytes(2, span.spanId, 8),
    protobufString(3, span.traceState),
    protobufHexBytes(4, span.parentSpanId, 8),
    protobufString(5, span.name),
    protobufUInt(6, span.kind),
    protobufFixed64(7, span.startTimeUnixNano),
    protobufFixed64(8, span.endTimeUnixNano),
    ...encodeAttributes(span.attributes, 9),
    protobufUInt(10, span.droppedAttributesCount),
    ...(span.events || []).map((event) =>
      protobufMessage(11, [encodeSpanEvent(event)]),
    ),
    protobufUInt(12, span.droppedEventsCount),
    protobufMessage(15, [encodeSpanStatus(span.status)]),
    protobufFixed32(16, span.flags),
  ]);
}

function encodeScopeSpans(scopeSpans = {}) {
  return Buffer.concat([
    protobufMessage(1, [encodeScope(scopeSpans.scope)]),
    ...(scopeSpans.spans || []).map((span) =>
      protobufMessage(2, [encodeSpan(span)]),
    ),
    protobufString(3, scopeSpans.schemaUrl),
  ]);
}

function encodeResourceSpans(resourceSpans = {}) {
  return Buffer.concat([
    protobufMessage(1, [encodeResource(resourceSpans.resource)]),
    ...(resourceSpans.scopeSpans || []).map((scope) =>
      protobufMessage(2, [encodeScopeSpans(scope)]),
    ),
    protobufString(3, resourceSpans.schemaUrl),
  ]);
}

function encodeNumberDataPoint(point = {}) {
  const chunks = [
    ...encodeAttributes(point.attributes, 7),
    protobufFixed64(2, point.startTimeUnixNano),
    protobufFixed64(3, point.timeUnixNano),
  ];
  if (Object.hasOwn(point, "asDouble")) {
    chunks.push(protobufDouble(4, point.asDouble));
  } else if (Object.hasOwn(point, "asInt")) {
    chunks.push(protobufFixed64(6, point.asInt));
  }
  chunks.push(protobufUInt(8, point.flags));
  return Buffer.concat(chunks);
}

function encodeGauge(gauge = {}) {
  return Buffer.concat(
    (gauge.dataPoints || []).map((point) =>
      protobufMessage(1, [encodeNumberDataPoint(point)]),
    ),
  );
}

function encodeSum(sum = {}) {
  return Buffer.concat([
    ...(sum.dataPoints || []).map((point) =>
      protobufMessage(1, [encodeNumberDataPoint(point)]),
    ),
    protobufUInt(2, sum.aggregationTemporality),
    ...(sum.isMonotonic
      ? [Buffer.concat([protobufTag(3, 0), protobufVarint(1)])]
      : []),
  ]);
}

function encodeHistogramPoint(point = {}) {
  const bucketCounts = (point.bucketCounts || []).map((value) =>
    protobufFixed64Body(value),
  );
  const bounds = (point.explicitBounds || []).map((value) => {
    const body = Buffer.alloc(8);
    body.writeDoubleLE(Number(value), 0);
    return body;
  });
  return Buffer.concat([
    ...encodeAttributes(point.attributes, 9),
    protobufFixed64(2, point.startTimeUnixNano),
    protobufFixed64(3, point.timeUnixNano),
    protobufFixed64(4, point.count || 0),
    ...(Object.hasOwn(point, "sum") ? [protobufDouble(5, point.sum)] : []),
    ...(bucketCounts.length > 0
      ? [protobufBytes(6, Buffer.concat(bucketCounts))]
      : []),
    ...(bounds.length > 0 ? [protobufBytes(7, Buffer.concat(bounds))] : []),
    protobufUInt(10, point.flags),
    ...(Object.hasOwn(point, "min") ? [protobufDouble(11, point.min)] : []),
    ...(Object.hasOwn(point, "max") ? [protobufDouble(12, point.max)] : []),
  ]);
}

function encodeHistogram(histogram = {}) {
  return Buffer.concat([
    ...(histogram.dataPoints || []).map((point) =>
      protobufMessage(1, [encodeHistogramPoint(point)]),
    ),
    protobufUInt(2, histogram.aggregationTemporality),
  ]);
}

function encodeMetric(metric = {}) {
  return Buffer.concat([
    protobufString(1, metric.name),
    protobufString(2, metric.description),
    protobufString(3, metric.unit),
    ...(metric.gauge ? [protobufMessage(5, [encodeGauge(metric.gauge)])] : []),
    ...(metric.sum ? [protobufMessage(7, [encodeSum(metric.sum)])] : []),
    ...(metric.histogram
      ? [protobufMessage(9, [encodeHistogram(metric.histogram)])]
      : []),
  ]);
}

function encodeScopeMetrics(scopeMetrics = {}) {
  return Buffer.concat([
    protobufMessage(1, [encodeScope(scopeMetrics.scope)]),
    ...(scopeMetrics.metrics || []).map((metric) =>
      protobufMessage(2, [encodeMetric(metric)]),
    ),
    protobufString(3, scopeMetrics.schemaUrl),
  ]);
}

function encodeResourceMetrics(resourceMetrics = {}) {
  return Buffer.concat([
    protobufMessage(1, [encodeResource(resourceMetrics.resource)]),
    ...(resourceMetrics.scopeMetrics || []).map((scope) =>
      protobufMessage(2, [encodeScopeMetrics(scope)]),
    ),
    protobufString(3, resourceMetrics.schemaUrl),
  ]);
}

/** Encode an OTLP JSON-shaped request as its canonical protobuf message. */
export function encodeOtlpProtobuf(signal, payload) {
  if (signal === "traces") {
    return Buffer.concat(
      (payload?.resourceSpans || []).map((resource) =>
        protobufMessage(1, [encodeResourceSpans(resource)]),
      ),
    );
  }
  if (signal === "metrics") {
    return Buffer.concat(
      (payload?.resourceMetrics || []).map((resource) =>
        protobufMessage(1, [encodeResourceMetrics(resource)]),
      ),
    );
  }
  throw new RangeError(`Unsupported OTLP signal: ${signal}`);
}

function mergePayloads(signal, payloads) {
  const field = signal === "traces" ? "resourceSpans" : "resourceMetrics";
  return {
    [field]: payloads.flatMap((payload) =>
      Array.isArray(payload?.[field]) ? payload[field] : [],
    ),
  };
}

function retryAfterMs(headers, now = Date.now()) {
  const value = headers?.["retry-after"];
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function safeTransportHeaders(headers) {
  const reserved = new Set([
    "content-length",
    "content-type",
    "content-encoding",
    "grpc-encoding",
    "te",
  ]);
  return Object.fromEntries(
    Object.entries(headers || {})
      .map(([key, value]) => [key.toLowerCase(), String(value)])
      .filter(([key]) => !key.startsWith(":") && !reserved.has(key)),
  );
}

function backoffMs(attempt) {
  return Math.min(MAX_BACKOFF_MS, 250 * 2 ** Math.max(0, attempt - 1));
}

function endpointKey(config) {
  return createHash("sha256")
    .update(
      `${config.traces.protocol || ""}\0${config.traces.endpoint || ""}\0${config.metrics.protocol || ""}\0${config.metrics.endpoint || ""}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class OtlpExporter {
  constructor(options = {}, deps = {}) {
    this._env = deps.env || process.env;
    this.config = options.config || resolveOtlpConfig(options, this._env, deps);
    this._http = deps.http || http;
    this._http2 = deps.http2 || http2;
    this._https = deps.https || https;
    this._fs = deps.fs || fs;
    this._now = deps.now || (() => Date.now());
    this._setInterval = deps.setInterval || setInterval;
    this._clearInterval = deps.clearInterval || clearInterval;
    this._sleep =
      deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this._isPidAlive = deps.isPidAlive || isPidAlive;
    this._pid = deps.pid || process.pid;
    this._instanceId = deps.instanceId || randomUUID();
    this._queue = [];
    this._flushPromise = null;
    this._timer = null;
    this._closed = false;
    this._stats = {
      enqueued: 0,
      exported: 0,
      retried: 0,
      dropped: 0,
      permanentFailures: 0,
      recovered: 0,
      spoolErrors: 0,
      configurationErrors: [
        this.config.traces.configError,
        this.config.metrics.configError,
      ]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index),
      lastError: null,
    };
    this._spoolKey = endpointKey(this.config);
    this._spoolFile = path.join(
      this.config.spoolDir,
      `active-${this._spoolKey}-${this._pid}-${this._instanceId}.json`,
    );
    if (this.config.enabled) {
      this._recoverSpool();
      this._startTimer();
    }
  }

  get enabled() {
    return this.config.enabled && !this._closed;
  }

  _startTimer() {
    this._timer = this._setInterval(
      () => void this.flush(),
      this.config.scheduleDelayMs,
    );
    this._timer?.unref?.();
  }

  _recoverSpool() {
    try {
      this._fs.mkdirSync(this.config.spoolDir, {
        recursive: true,
        mode: 0o700,
      });
      const prefix = `active-${this._spoolKey}-`;
      const files = this._fs
        .readdirSync(this.config.spoolDir)
        .filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
      for (const name of files) {
        const source = path.join(this.config.spoolDir, name);
        if (source === this._spoolFile) continue;
        const match = name.match(/^active-[^-]+-(\d+)-/);
        const ownerPid = match ? Number(match[1]) : 0;
        let stat;
        try {
          stat = this._fs.statSync(source);
        } catch {
          continue;
        }
        const recentlyOwned =
          this._now() - stat.mtimeMs < MAX_RECOVERY_FILE_AGE_MS;
        if (recentlyOwned && this._isPidAlive(ownerPid)) continue;
        const claimed = `${source}.claim-${this._instanceId}`;
        try {
          this._fs.renameSync(source, claimed);
        } catch {
          continue;
        }
        try {
          const parsed = JSON.parse(this._fs.readFileSync(claimed, "utf8"));
          const recovered = Array.isArray(parsed?.queue) ? parsed.queue : [];
          for (const item of recovered) this._push(item, { recovered: true });
        } catch (error) {
          this._stats.spoolErrors++;
          this._stats.lastError = `spool recovery: ${error.message}`;
        } finally {
          try {
            this._fs.unlinkSync(claimed);
          } catch {
            // A leftover claimed file is ignored by later recovery scans.
          }
        }
      }
      this._persist();
    } catch (error) {
      this._stats.spoolErrors++;
      this._stats.lastError = `spool init: ${error.message}`;
    }
  }

  _persist() {
    if (!this.config.enabled) return;
    try {
      this._fs.mkdirSync(this.config.spoolDir, {
        recursive: true,
        mode: 0o700,
      });
      if (this._queue.length === 0) {
        try {
          this._fs.unlinkSync(this._spoolFile);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        return;
      }
      const temporary = `${this._spoolFile}.tmp`;
      this._fs.writeFileSync(
        temporary,
        `${JSON.stringify({
          version: 1,
          ownerPid: this._pid,
          endpointKey: this._spoolKey,
          updatedAt: this._now(),
          queue: this._queue,
        })}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      this._fs.renameSync(temporary, this._spoolFile);
    } catch (error) {
      this._stats.spoolErrors++;
      this._stats.lastError = `spool persist: ${error.message}`;
    }
  }

  _push(item, { recovered = false } = {}) {
    if (!item || !SIGNALS.has(item.signal) || !item.payload) return false;
    while (this._queue.length >= this.config.maxQueueSize) {
      this._queue.shift();
      this._stats.dropped++;
    }
    this._queue.push({
      id: item.id || randomUUID(),
      signal: item.signal,
      payload: item.payload,
      attempts: Number(item.attempts) || 0,
      nextAttemptAt: Number(item.nextAttemptAt) || 0,
      enqueuedAt: Number(item.enqueuedAt) || this._now(),
    });
    if (recovered) this._stats.recovered++;
    else this._stats.enqueued++;
    return true;
  }

  enqueue(signal, payload, { redact = true } = {}) {
    if (!this.enabled || !SIGNALS.has(signal)) return false;
    const target = this.config[signal];
    if (!target?.endpoint) return false;
    const accepted = this._push({
      signal,
      payload: cloneAndRedact(payload, redact),
      attempts: 0,
      nextAttemptAt: 0,
      enqueuedAt: this._now(),
    });
    this._persist();
    if (this._queue.length >= this.config.maxExportBatchSize) {
      void this.flush();
    }
    return accepted;
  }

  exportTracePayload(payload, options) {
    return this.enqueue("traces", payload, options);
  }

  exportMetricsPayload(payload, options) {
    return this.enqueue("metrics", payload, options);
  }

  exportSpans(spans, { redact = true } = {}) {
    if (!Array.isArray(spans) || spans.length === 0) return false;
    const attrs = resourceAttributes(this.config.resourceAttributes, redact);
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: attrs },
          scopeSpans: [
            {
              scope: { name: "chainlesschain.cli" },
              spans: spans.map((span) => this._toOtlpSpan(span, redact)),
            },
          ],
        },
      ],
    };
    return this.exportTracePayload(payload, { redact });
  }

  _toOtlpSpan(span, redact = true) {
    const start = Number(span.startTime) || this._now();
    const end = Number(span.endTime) || this._now();
    const statusCode =
      span.status?.code === "ERROR" || span.status?.code === 2 || span.error
        ? 2
        : 1;
    return {
      traceId: span.traceId || "",
      spanId: span.spanId || span.id || "",
      parentSpanId: span.parentSpanId || span.parentId || "",
      name: span.name || "unknown",
      kind: Number(span.kind) || 1,
      startTimeUnixNano: String(Math.round(start * 1e6)),
      endTimeUnixNano: String(Math.round(end * 1e6)),
      attributes: resourceAttributes(
        span.attributes || span.metadata || {},
        redact,
      ),
      status: {
        code: statusCode,
        ...(span.status?.message
          ? {
              message: redact
                ? redactSecrets(String(span.status.message))
                : String(span.status.message),
            }
          : {}),
      },
      events: (span.events || []).map((event) => ({
        name: event.name || "event",
        timeUnixNano: String(
          Math.round((Number(event.time) || this._now()) * 1e6),
        ),
        attributes: resourceAttributes(event.attributes || {}, redact),
      })),
    };
  }

  exportMetrics(metrics, { redact = true } = {}) {
    if (!Array.isArray(metrics) || metrics.length === 0) return false;
    const nowNano = String(Math.round(this._now() * 1e6));
    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: resourceAttributes(
              this.config.resourceAttributes,
              redact,
            ),
          },
          scopeMetrics: [
            {
              scope: { name: "chainlesschain.cli" },
              metrics: metrics.map((metric) =>
                this._toOtlpMetric(metric, nowNano, redact),
              ),
            },
          ],
        },
      ],
    };
    return this.exportMetricsPayload(payload, { redact });
  }

  _toOtlpMetric(metric, nowNano, redact = true) {
    const point = {
      attributes: resourceAttributes(
        metric.attributes || metric.labels || {},
        redact,
      ),
      timeUnixNano: String(metric.timeUnixNano || nowNano),
    };
    if (metric.type === "histogram") {
      return {
        name: metric.name,
        description: metric.description || "",
        unit: metric.unit || "1",
        histogram: {
          aggregationTemporality: metric.aggregationTemporality === 1 ? 1 : 2,
          dataPoints: [
            {
              ...point,
              count: String(metric.count ?? metric.value?.count ?? 0),
              sum: Number(metric.sum ?? metric.value?.sum ?? 0),
              bucketCounts: (metric.bucketCounts || []).map(String),
              explicitBounds: metric.explicitBounds || [],
            },
          ],
        },
      };
    }
    const number =
      typeof metric.value === "bigint"
        ? { asInt: metric.value.toString() }
        : Number.isInteger(metric.value)
          ? { asInt: String(metric.value) }
          : { asDouble: Number(metric.value) || 0 };
    const data = { dataPoints: [{ ...point, ...number }] };
    if (metric.type === "sum" || metric.type === "counter") {
      data.aggregationTemporality = metric.aggregationTemporality === 1 ? 1 : 2;
      data.isMonotonic = metric.monotonic !== false;
      return {
        name: metric.name,
        description: metric.description || "",
        unit: metric.unit || "1",
        sum: data,
      };
    }
    return {
      name: metric.name,
      description: metric.description || "",
      unit: metric.unit || "1",
      gauge: data,
    };
  }

  async _postHttp(signal, payload) {
    const target = this.config[signal];
    if (!target?.endpoint) {
      return { ok: false, retryable: false, error: "endpoint not configured" };
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const url = new URL(target.endpoint);
        const protobuf = target.protocol === "http/protobuf";
        const raw = protobuf
          ? encodeOtlpProtobuf(signal, payload)
          : Buffer.from(JSON.stringify(payload), "utf8");
        const compressed = target.compression === "gzip";
        const body = compressed ? gzipSync(raw) : raw;
        const mod = url.protocol === "https:" ? this._https : this._http;
        const request = mod.request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            headers: {
              "Content-Type": protobuf
                ? "application/x-protobuf"
                : "application/json",
              "Content-Length": String(body.length),
              ...(compressed ? { "Content-Encoding": "gzip" } : {}),
              ...safeTransportHeaders(target.headers),
            },
            timeout: target.timeoutMs,
            ...(url.protocol === "https:" ? target.tls : {}),
          },
          (response) => {
            response.resume();
            const statusCode = response.statusCode || 0;
            if (statusCode >= 200 && statusCode < 300) {
              finish({ ok: true, statusCode });
              return;
            }
            finish({
              ok: false,
              statusCode,
              retryable: RETRYABLE_STATUS.has(statusCode) || statusCode >= 500,
              retryAfterMs: retryAfterMs(response.headers, this._now()),
              error: `HTTP ${statusCode}`,
            });
          },
        );
        request.once("error", (error) =>
          finish({ ok: false, retryable: true, error: error.message }),
        );
        request.once("timeout", () => {
          request.destroy(new Error("OTLP export timeout"));
          finish({ ok: false, retryable: true, error: "request timeout" });
        });
        request.end(body);
      } catch (error) {
        finish({ ok: false, retryable: false, error: error.message });
      }
    });
  }

  async _postGrpc(signal, payload) {
    const target = this.config[signal];
    if (!target?.endpoint) {
      return { ok: false, retryable: false, error: "endpoint not configured" };
    }
    return new Promise((resolve) => {
      let settled = false;
      let session;
      let request;
      let httpStatus = 0;
      let grpcStatus = null;
      let grpcMessage = "";
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try {
          request?.close();
        } catch {
          // The stream may already be closed by the peer.
        }
        try {
          session?.close();
        } catch {
          // The connection may have failed before opening.
        }
        resolve(value);
      };
      try {
        const url = new URL(target.endpoint);
        const method =
          signal === "traces"
            ? "/opentelemetry.proto.collector.trace.v1.TraceService/Export"
            : "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export";
        const basePath = url.pathname.replace(/\/+$/, "");
        const rpcPath = basePath.endsWith("/Export")
          ? basePath
          : `${basePath === "/" ? "" : basePath}${method}`;
        const message = encodeOtlpProtobuf(signal, payload);
        const compressed = target.compression === "gzip";
        const body = compressed ? gzipSync(message) : message;
        const frame = Buffer.alloc(5 + body.length);
        frame[0] = compressed ? 1 : 0;
        frame.writeUInt32BE(body.length, 1);
        body.copy(frame, 5);
        const customHeaders = safeTransportHeaders(target.headers);
        session = this._http2.connect(url.origin, {
          ...(url.protocol === "https:" ? target.tls : {}),
        });
        session.once("error", (error) =>
          finish({ ok: false, retryable: true, error: error.message }),
        );
        request = session.request({
          ":method": "POST",
          ":path": rpcPath,
          "content-type": "application/grpc",
          te: "trailers",
          ...(compressed ? { "grpc-encoding": "gzip" } : {}),
          ...customHeaders,
        });
        request.setTimeout(target.timeoutMs, () => {
          finish({ ok: false, retryable: true, error: "request timeout" });
        });
        const readStatus = (headers) => {
          if (headers[":status"] != null) {
            httpStatus = Number(headers[":status"]);
          }
          if (headers["grpc-status"] != null) {
            grpcStatus = Number(headers["grpc-status"]);
          }
          if (headers["grpc-message"] != null) {
            try {
              grpcMessage = decodeURIComponent(String(headers["grpc-message"]));
            } catch {
              grpcMessage = String(headers["grpc-message"]);
            }
          }
        };
        request.on("response", readStatus);
        request.on("trailers", readStatus);
        request.once("error", (error) =>
          finish({ ok: false, retryable: true, error: error.message }),
        );
        request.once("end", () => {
          if (httpStatus >= 200 && httpStatus < 300 && grpcStatus === 0) {
            finish({ ok: true, statusCode: httpStatus, grpcStatus: 0 });
            return;
          }
          const retryableGrpc = new Set([4, 8, 10, 13, 14]);
          finish({
            ok: false,
            statusCode: httpStatus,
            grpcStatus,
            retryable:
              retryableGrpc.has(grpcStatus) ||
              RETRYABLE_STATUS.has(httpStatus) ||
              httpStatus >= 500,
            error:
              grpcMessage ||
              (grpcStatus == null
                ? `HTTP ${httpStatus || "connection failure"}`
                : `gRPC ${grpcStatus}`),
          });
        });
        request.resume();
        request.end(frame);
      } catch (error) {
        finish({ ok: false, retryable: false, error: error.message });
      }
    });
  }

  async _post(signal, payload) {
    return this.config[signal]?.protocol === "grpc"
      ? this._postGrpc(signal, payload)
      : this._postHttp(signal, payload);
  }

  async _flush({ force = false } = {}) {
    const now = this._now();
    const due = this._queue
      .filter((item) => force || item.nextAttemptAt <= now)
      .slice(0, this.config.maxExportBatchSize);
    if (due.length === 0) return this.getStats();
    let batchFailed = false;
    for (const signal of SIGNALS) {
      const batch = due.filter((item) => item.signal === signal);
      if (batch.length === 0) continue;
      const result = await this._post(
        signal,
        mergePayloads(
          signal,
          batch.map((item) => item.payload),
        ),
      );
      if (result.ok) {
        const ids = new Set(batch.map((item) => item.id));
        this._queue = this._queue.filter((item) => !ids.has(item.id));
        this._stats.exported += batch.length;
        continue;
      }
      batchFailed = true;
      this._stats.lastError = result.error || "OTLP export failed";
      const idsToDrop = new Set();
      for (const item of batch) {
        item.attempts += 1;
        if (!result.retryable || item.attempts >= this.config.maxAttempts) {
          idsToDrop.add(item.id);
          this._stats.permanentFailures++;
          continue;
        }
        item.nextAttemptAt =
          this._now() +
          (result.retryAfterMs == null
            ? backoffMs(item.attempts)
            : result.retryAfterMs);
        this._stats.retried++;
      }
      if (idsToDrop.size > 0) {
        this._queue = this._queue.filter((item) => !idsToDrop.has(item.id));
      }
    }
    if (!batchFailed) this._stats.lastError = null;
    this._persist();
    return this.getStats();
  }

  flush(options = {}) {
    if (!this.enabled) return Promise.resolve(this.getStats());
    if (!this._flushPromise) {
      this._flushPromise = this._flush(options).finally(() => {
        this._flushPromise = null;
      });
    }
    return this._flushPromise;
  }

  async forceFlush({ timeoutMs = 2_000 } = {}) {
    if (!this.enabled) return this.getStats();
    const deadline = this._now() + Math.max(0, timeoutMs);
    while (this._queue.length > 0 && this._now() <= deadline) {
      const before = this._queue.length;
      await this.flush({ force: true });
      if (this._queue.length === 0) break;
      if (this._queue.length >= before) {
        const wait = Math.min(100, Math.max(0, deadline - this._now()));
        if (wait === 0) break;
        await this._sleep(wait);
      }
    }
    this._persist();
    return this.getStats();
  }

  async shutdown(options = {}) {
    if (this._closed) return this.getStats();
    if (this._timer) this._clearInterval(this._timer);
    await this.forceFlush(options);
    this._closed = true;
    this._persist();
    return this.getStats();
  }

  getStats() {
    const queued = this._queue.length;
    const max = this.config.maxQueueSize;
    return {
      enabled: this.enabled,
      protocol:
        this.config.traces.protocol === this.config.metrics.protocol
          ? this.config.traces.protocol
          : "mixed",
      tracesProtocol: this.config.traces.protocol,
      metricsProtocol: this.config.metrics.protocol,
      tracesEndpoint: this.config.traces.endpoint,
      metricsEndpoint: this.config.metrics.endpoint,
      queued,
      queueCapacity: max,
      queuePressure:
        queued >= max
          ? "full"
          : queued >= Math.ceil(max * 0.8)
            ? "high"
            : "normal",
      ...this._stats,
    };
  }
}

export default OtlpExporter;
