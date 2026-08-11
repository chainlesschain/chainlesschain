/**
 * Shared W3C trace-context implementation for CommonJS and ESM consumers.
 *
 * Keep the implementation and singleton in this CommonJS module. The sibling
 * trace-context.js file is an ESM wrapper around these exact exports so the
 * ProcessExecutionBroker and observability code share one AsyncLocalStorage.
 */

const { AsyncLocalStorage } = require("node:async_hooks");
const { randomBytes } = require("node:crypto");

class TraceContext {
  constructor() {
    this._asyncLocalStorage = new AsyncLocalStorage();
    this._spans = new Map();
    this._listeners = new Set();
  }

  generateTraceId() {
    return randomBytes(16).toString("hex");
  }

  generateSpanId() {
    return randomBytes(8).toString("hex");
  }

  parseTraceparent(traceparent) {
    if (!traceparent) return null;
    const parts = traceparent.split("-");
    if (parts.length !== 4) return null;
    const [version, traceId, parentId, traceFlags] = parts;
    if (
      version.length !== 2 ||
      traceId.length !== 32 ||
      parentId.length !== 16 ||
      traceFlags.length !== 2
    ) {
      return null;
    }
    return { version, traceId, parentId, traceFlags: parseInt(traceFlags, 16) };
  }

  formatTraceparent(traceId, spanId, traceFlags = 0x01) {
    return `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, "0")}`;
  }

  getCurrentContext() {
    return this._asyncLocalStorage.getStore();
  }

  startRootSpan(name, attributes = {}) {
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    const context = {
      traceId,
      spanId,
      parentSpanId: null,
      name,
      attributes,
      startTime: Date.now(),
      tracestate: "",
      baggage: {},
    };
    this._spans.set(spanId, context);
    this._emit("span:start", context);
    return context;
  }

  startSpan(name, attributes = {}) {
    const parent = this.getCurrentContext();
    if (!parent) {
      return this.startRootSpan(name, attributes);
    }
    const spanId = this.generateSpanId();
    const context = {
      traceId: parent.traceId,
      spanId,
      parentSpanId: parent.spanId,
      name,
      attributes: { ...attributes },
      startTime: Date.now(),
      tracestate: parent.tracestate || "",
      baggage: { ...(parent.baggage || {}) },
    };
    this._spans.set(spanId, context);
    this._emit("span:start", context);
    return context;
  }

  endSpan(span, status = { code: "OK" }) {
    if (!span || !this._spans.has(span.spanId)) return;
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    this._emit("span:end", span);
    this._spans.delete(span.spanId);
  }

  async runInContext(context, fn) {
    return this._asyncLocalStorage.run(context, fn);
  }

  getPropagationEnv() {
    const ctx = this.getCurrentContext();
    if (!ctx) return {};
    const env = {
      TRACEPARENT: this.formatTraceparent(ctx.traceId, ctx.spanId),
    };
    if (ctx.tracestate) {
      env.TRACESTATE = ctx.tracestate;
    }
    if (ctx.baggage && Object.keys(ctx.baggage).length > 0) {
      env.BAGGAGE = Object.entries(ctx.baggage)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join(",");
    }
    return env;
  }

  extractFromEnv(env = process.env) {
    const traceparent = env.TRACEPARENT || env.traceparent;
    if (!traceparent) return null;
    const parsed = this.parseTraceparent(traceparent);
    if (!parsed) return null;
    const context = {
      traceId: parsed.traceId,
      spanId: parsed.parentId,
      parentSpanId: null,
      name: "inherited",
      attributes: {},
      startTime: Date.now(),
      tracestate: env.TRACESTATE || env.tracestate || "",
      baggage: this._parseBaggage(env.BAGGAGE || env.baggage),
    };
    return context;
  }

  on(event, listener) {
    this._listeners.add({ event, listener });
  }

  off(event, listener) {
    for (const entry of this._listeners) {
      if (entry.event === event && entry.listener === listener) {
        this._listeners.delete(entry);
        break;
      }
    }
  }

  _emit(event, data) {
    for (const { event: ev, listener } of this._listeners) {
      if (ev === event) {
        try {
          listener(data);
        } catch {
          // Listener failures must not break tracing or the caller.
        }
      }
    }
  }

  _parseBaggage(baggage) {
    if (!baggage) return {};
    const result = {};
    for (const pair of baggage.split(",")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eqIdx).trim());
      const value = decodeURIComponent(pair.slice(eqIdx + 1).trim());
      result[key] = value;
    }
    return result;
  }
}

const traceContext = new TraceContext();

module.exports = { TraceContext, traceContext };
