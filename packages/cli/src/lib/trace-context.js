/**
 * TraceContext - Distributed trace context propagation (W3C Trace Context compatible)
 *
 * Implements end-to-end tracing for the CLI runtime:
 * - Generates traceId/spanId pairs
 * - Propagates context across shell commands, MCP calls, sub-agents
 * - Hooks into RuntimeProvenanceLedger for immutable lineage recording
 */

import { randomUUID, randomBytes } from "node:crypto";

// TraceContext header constant (W3C standard)
export const TRACEPARENT_HEADER = "traceparent";

export class TraceContext {
  constructor(options = {}) {
    this.traceId = options.traceId || TraceContext.generateTraceId();
    this.spanId = options.spanId || TraceContext.generateSpanId();
    this.parentSpanId = options.parentSpanId || null;
    this.sampled = options.sampled !== false;
    this.traceState = options.traceState || new Map();
    this.baggage = options.baggage || new Map();
    this.attributes = options.attributes || {};
  }

  /**
   * Generate a valid W3C trace ID (16 random bytes = 32 hex chars)
   */
  static generateTraceId() {
    return randomBytes(16).toString("hex");
  }

  /**
   * Generate a valid W3C span ID (8 random bytes = 16 hex chars)
   */
  static generateSpanId() {
    return randomBytes(8).toString("hex");
  }

  /**
   * Parse a W3C traceparent header
   */
  static parseTraceParent(header) {
    if (!header) return null;
    const parts = header.split("-");
    if (parts.length !== 4) return null;
    const [version, traceId, spanId, flags] = parts;
    if (version !== "00") return null;
    return {
      traceId,
      spanId,
      sampled: parseInt(flags, 16) & 0x1 === 0x1,
    };
  }

  /**
   * Create a child span for a downstream operation
   */
  childSpan(name) {
    return new TraceContext({
      traceId: this.traceId,
      parentSpanId: this.spanId,
      sampled: this.sampled,
      traceState: new Map(this.traceState),
      baggage: new Map(this.baggage),
      attributes: {
        ...this.attributes,
        "span.name": name,
      },
    });
  }

  /**
   * Add baggage key/value (propagated across all spans)
   */
  setBaggage(key, value) {
    this.baggage.set(key, value);
    return this;
  }

  /**
   * Get baggage value
   */
  getBaggage(key) {
    return this.baggage.get(key);
  }

  /**
   * Set span attribute
   */
  setAttribute(key, value) {
    this.attributes[key] = value;
    return this;
  }

  /**
   * Serialize to W3C traceparent header
   */
  toTraceParent() {
    const flags = this.sampled ? "01" : "00";
    return `00-${this.traceId}-${this.spanId}-${flags}`;
  }

  /**
   * Serialize to W3C tracestate header
   */
  toTraceState() {
    if (this.traceState.size === 0) return "";
    return Array.from(this.traceState.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
  }

  /**
   * Inject trace context into environment variables for child processes
   */
  injectIntoEnv(env = process.env) {
    return {
      ...env,
      TRACEPARENT: this.toTraceParent(),
      TRACESTATE: this.toTraceState(),
      BAGGAGE: Array.from(this.baggage.entries())
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join(","),
    };
  }

  /**
   * Extract trace context from environment variables
   */
  static extractFromEnv(env = process.env) {
    const parsed = TraceContext.parseTraceParent(env.TRACEPARENT);
    if (!parsed) return null;
    const ctx = new TraceContext({
      traceId: parsed.traceId,
      spanId: parsed.spanId,
      sampled: parsed.sampled,
    });
    // Parse baggage
    if (env.BAGGAGE) {
      for (const kv of env.BAGGAGE.split(",")) {
        const [k, ...rest] = kv.split("=");
        if (k) ctx.setBaggage(k.trim(), decodeURIComponent(rest.join("=")));
      }
    }
    return ctx;
  }
}

// Export global singleton instance
const traceContext = new TraceContext();
export default traceContext;
export { traceContext };
