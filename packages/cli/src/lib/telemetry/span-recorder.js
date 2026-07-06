/**
 * TelemetryRecorder (Phase 7) — a dependency-free, OpenTelemetry-SHAPED span +
 * metrics recorder for the agent's real execution (model calls, tool calls,
 * cache, retries, failures). The plan asks to "引入 OpenTelemetry，覆盖模型、
 * 工具、缓存、重试和失败分类" — but pulling the `@opentelemetry/*` SDK in (a
 * heavy dep tree that also needs a running collector) is the wrong default for a
 * ~2 MB CLI. This records the SAME span/attribute model and can emit OTLP JSON
 * (`toOtlp()`) so a real collector can ingest it later, without the dependency.
 *
 * It captures the plan's metric set — per-name durations (avg/p50/p95/max),
 * counters (token / cost / cache-hit / retry), and failure classification — and
 * `summary()` renders them. The clock is injected so tests are deterministic.
 */

let _seq = 0;
function spanId() {
  _seq = (_seq + 1) % Number.MAX_SAFE_INTEGER;
  // 16-hex-ish id derived from a monotonic counter (deterministic, no RNG —
  // Math.random is intentionally avoided so callers can snapshot/replay).
  return _seq.toString(16).padStart(16, "0");
}

// One trace per recorder (a "run"). The OTLP/OTel spec treats an ALL-ZERO
// traceId as INVALID, so a strict collector would drop every span exported with
// `"0".repeat(32)` — defeating toOtlp()'s purpose. Derive a non-zero, monotonic
// (RNG-free, snapshot-replayable) 32-hex traceId per recorder instead.
let _traceSeq = 0;
function newTraceId() {
  _traceSeq = (_traceSeq + 1) % Number.MAX_SAFE_INTEGER;
  return _traceSeq.toString(16).padStart(32, "0"); // never all-zero (starts at 1)
}

export class TelemetryRecorder {
  constructor({
    now = () => Date.now(),
    serviceName = "chainlesschain-cli",
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this.serviceName = serviceName;
    this.traceId = newTraceId(); // one trace per recorder (valid non-zero id)
    this._spans = []; // completed spans
    this._counters = new Map(); // name → { total, byAttr }
    this._failures = new Map(); // category → count
  }

  /**
   * Start a span. Returns a handle; call `.end()` (optionally with a status /
   * extra attributes) to record it. Nesting is expressed via `parentId`.
   */
  startSpan(name, attributes = {}, { parentId = null } = {}) {
    const id = spanId();
    const start = this._now();
    const attrs = { ...attributes };
    const events = [];
    const self = this;
    let ended = false;
    return {
      id,
      name,
      setAttribute(k, v) {
        attrs[k] = v;
        return this;
      },
      addEvent(evName, evAttrs = {}) {
        events.push({
          name: evName,
          time: self._now(),
          attributes: { ...evAttrs },
        });
        return this;
      },
      /**
       * Record a failure on this span, classified into a category (defaults to
       * the error name) so `summary().failures` aggregates by cause.
       */
      recordException(err, category) {
        const cat = category || err?.code || err?.name || "error";
        attrs["failure.category"] = cat;
        attrs["error"] = true;
        events.push({
          name: "exception",
          time: self._now(),
          attributes: {
            "exception.message": err?.message || String(err),
            "exception.category": cat,
          },
        });
        self._failures.set(cat, (self._failures.get(cat) || 0) + 1);
        return this;
      },
      end(extra = {}) {
        if (ended) return; // idempotent
        ended = true;
        const endTime = self._now();
        Object.assign(attrs, extra.attributes || {});
        const status = extra.status || (attrs.error ? "error" : "ok");
        self._spans.push({
          id,
          parentId,
          name,
          startTime: start,
          endTime,
          durationMs: endTime - start,
          status,
          attributes: attrs,
          events,
        });
      },
    };
  }

  /** Increment a named counter (tokens, cost, cache.hit, retry, …). */
  counter(name, value = 1, attributes = {}) {
    const entry = this._counters.get(name) || { total: 0, byAttr: {} };
    entry.total += value;
    for (const [k, v] of Object.entries(attributes)) {
      const key = `${k}=${v}`;
      entry.byAttr[key] = (entry.byAttr[key] || 0) + value;
    }
    this._counters.set(name, entry);
    return entry.total;
  }

  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    // nearest-rank
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(rank, sorted.length) - 1];
  }

  /** Aggregate metrics across everything recorded so far. */
  summary() {
    const byName = {};
    for (const s of this._spans) {
      (byName[s.name] = byName[s.name] || []).push(s);
    }
    const durations = {};
    for (const [name, spans] of Object.entries(byName)) {
      const ds = spans.map((s) => s.durationMs).sort((a, b) => a - b);
      const total = ds.reduce((a, b) => a + b, 0);
      const errors = spans.filter((s) => s.status === "error").length;
      durations[name] = {
        count: spans.length,
        errors,
        totalMs: total,
        avgMs: Math.round(total / spans.length),
        p50Ms: this._percentile(ds, 50),
        p95Ms: this._percentile(ds, 95),
        maxMs: ds[ds.length - 1] || 0,
      };
    }
    const counters = {};
    for (const [name, entry] of this._counters) {
      counters[name] = { total: entry.total, byAttr: { ...entry.byAttr } };
    }
    const failures = {};
    let failureTotal = 0;
    for (const [cat, n] of this._failures) {
      failures[cat] = n;
      failureTotal += n;
    }
    return {
      spanCount: this._spans.length,
      durations,
      counters,
      failures,
      failureTotal,
    };
  }

  /** OTLP/JSON-shaped export (resourceSpans) — ingestible by an OTel collector. */
  toOtlp() {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: this.serviceName } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "chainlesschain.cli" },
              spans: this._spans.map((s) => ({
                traceId: this.traceId,
                spanId: s.id,
                parentSpanId: s.parentId || "",
                name: s.name,
                startTimeUnixNano: s.startTime * 1e6,
                endTimeUnixNano: s.endTime * 1e6,
                status: { code: s.status === "error" ? 2 : 1 },
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value:
                    typeof v === "number"
                      ? { doubleValue: v }
                      : typeof v === "boolean"
                        ? { boolValue: v }
                        : { stringValue: String(v) },
                })),
                events: s.events.map((e) => ({
                  name: e.name,
                  timeUnixNano: e.time * 1e6,
                  attributes: Object.entries(e.attributes).map(([k, v]) => ({
                    key: k,
                    value: { stringValue: String(v) },
                  })),
                })),
              })),
            },
          ],
        },
      ],
    };
  }

  spans() {
    return this._spans.slice();
  }

  reset() {
    this._spans = [];
    this._counters = new Map();
    this._failures = new Map();
  }
}

/** Render a summary as a compact text block. */
export function formatTelemetry(summary) {
  const lines = [];
  lines.push(`Telemetry: ${summary.spanCount} span(s)`);
  for (const [name, d] of Object.entries(summary.durations)) {
    lines.push(
      `  ${name}: n=${d.count}${d.errors ? ` err=${d.errors}` : ""} ` +
        `avg=${d.avgMs}ms p50=${d.p50Ms}ms p95=${d.p95Ms}ms max=${d.maxMs}ms`,
    );
  }
  for (const [name, c] of Object.entries(summary.counters)) {
    lines.push(`  ${name}: ${c.total}`);
  }
  if (summary.failureTotal > 0) {
    const parts = Object.entries(summary.failures)
      .map(([cat, n]) => `${cat}=${n}`)
      .join(", ");
    lines.push(`  failures: ${summary.failureTotal} (${parts})`);
  }
  return lines.join("\n");
}
