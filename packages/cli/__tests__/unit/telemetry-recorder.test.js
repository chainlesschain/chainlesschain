import { describe, it, expect } from "vitest";
import {
  TelemetryRecorder,
  formatTelemetry,
} from "../../src/lib/telemetry/span-recorder.js";

function makeClock(start = 0) {
  const c = { t: start };
  return { now: () => c.t, advance: (ms) => (c.t += ms) };
}

describe("TelemetryRecorder spans", () => {
  it("records a span's duration from the injected clock", () => {
    const clock = makeClock(100);
    const rec = new TelemetryRecorder({ now: clock.now });
    const span = rec.startSpan("tool_call", { tool: "read_file" });
    clock.advance(42);
    span.end();
    const s = rec.spans();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      name: "tool_call",
      durationMs: 42,
      status: "ok",
    });
    expect(s[0].attributes.tool).toBe("read_file");
  });

  it("end() is idempotent", () => {
    const clock = makeClock();
    const rec = new TelemetryRecorder({ now: clock.now });
    const span = rec.startSpan("x");
    span.end();
    span.end();
    expect(rec.spans()).toHaveLength(1);
  });

  it("classifies a failure and aggregates it by category", () => {
    const clock = makeClock();
    const rec = new TelemetryRecorder({ now: clock.now });
    const span = rec.startSpan("model_call", { model: "opus" });
    const err = new Error("rate limited");
    err.code = "rate_limit";
    span.recordException(err);
    span.end();
    const sum = rec.summary();
    expect(sum.failures).toEqual({ rate_limit: 1 });
    expect(sum.failureTotal).toBe(1);
    expect(rec.spans()[0].status).toBe("error");
  });
});

describe("TelemetryRecorder counters + summary", () => {
  it("aggregates counters with per-attribute breakdown", () => {
    const rec = new TelemetryRecorder();
    rec.counter("tokens", 100, { kind: "input" });
    rec.counter("tokens", 40, { kind: "output" });
    rec.counter("cache.hit", 1);
    const sum = rec.summary();
    expect(sum.counters.tokens.total).toBe(140);
    expect(sum.counters.tokens.byAttr).toEqual({
      "kind=input": 100,
      "kind=output": 40,
    });
    expect(sum.counters["cache.hit"].total).toBe(1);
  });

  it("computes per-name duration stats (avg/p50/p95/max, errors)", () => {
    const clock = makeClock();
    const rec = new TelemetryRecorder({ now: clock.now });
    for (const d of [10, 20, 30, 100]) {
      const span = rec.startSpan("tool_call");
      clock.advance(d);
      if (d === 100) span.recordException(new Error("boom"), "timeout");
      span.end();
      // reset the clock delta by not advancing between spans beyond d
    }
    const stats = rec.summary().durations.tool_call;
    expect(stats.count).toBe(4);
    expect(stats.errors).toBe(1);
    expect(stats.maxMs).toBe(100);
    expect(stats.avgMs).toBe(40); // (10+20+30+100)/4
    expect(stats.p50Ms).toBe(20); // nearest-rank at 50%
    expect(stats.p95Ms).toBe(100);
  });
});

describe("TelemetryRecorder OTLP export", () => {
  it("emits an OTLP resourceSpans shape with typed attribute values", () => {
    const clock = makeClock(1000);
    const rec = new TelemetryRecorder({ now: clock.now, serviceName: "svc" });
    const span = rec.startSpan("model_call", {
      model: "opus",
      tokens: 128,
      cached: true,
    });
    clock.advance(5);
    span.end();
    const otlp = rec.toOtlp();
    const rs = otlp.resourceSpans[0];
    expect(rs.resource.attributes[0]).toEqual({
      key: "service.name",
      value: { stringValue: "svc" },
    });
    const otlpSpan = rs.scopeSpans[0].spans[0];
    expect(otlpSpan.name).toBe("model_call");
    expect(otlpSpan.startTimeUnixNano).toBe(1000 * 1e6);
    expect(otlpSpan.endTimeUnixNano).toBe(1005 * 1e6);
    expect(otlpSpan.status.code).toBe(1); // ok
    const attrMap = Object.fromEntries(
      otlpSpan.attributes.map((a) => [a.key, a.value]),
    );
    expect(attrMap.model).toEqual({ stringValue: "opus" });
    expect(attrMap.tokens).toEqual({ doubleValue: 128 });
    expect(attrMap.cached).toEqual({ boolValue: true });
  });

  it("exports a VALID (non-zero) traceId, shared by all spans of one recorder", () => {
    const clock = makeClock(1000);
    const rec = new TelemetryRecorder({ now: clock.now });
    const a = rec.startSpan("model_call");
    clock.advance(2);
    a.end();
    const b = rec.startSpan("tool_call");
    clock.advance(3);
    b.end();
    const spans = rec.toOtlp().resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    for (const s of spans) {
      // 32 hex chars and NOT all-zero (an all-zero traceId is invalid OTLP and a
      // strict collector drops the span).
      expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(s.traceId).not.toBe("0".repeat(32));
    }
    // All spans of one run belong to one trace (proper trace correlation).
    expect(spans[0].traceId).toBe(spans[1].traceId);
  });

  it("gives two recorders distinct traceIds", () => {
    const r1 = new TelemetryRecorder();
    const r2 = new TelemetryRecorder();
    expect(r1.traceId).not.toBe(r2.traceId);
  });
});

describe("formatTelemetry", () => {
  it("renders spans, counters and failures", () => {
    const clock = makeClock();
    const rec = new TelemetryRecorder({ now: clock.now });
    const s = rec.startSpan("tool_call");
    clock.advance(15);
    s.end();
    rec.counter("tokens", 200);
    const bad = rec.startSpan("model_call");
    bad.recordException(new Error("x"), "overloaded");
    bad.end();
    const text = formatTelemetry(rec.summary());
    expect(text).toMatch(/tool_call: n=1/);
    expect(text).toMatch(/tokens: 200/);
    expect(text).toMatch(/failures: 1 \(overloaded=1\)/);
  });
});
