import { describe, it, expect, vi } from "vitest";
import {
  TraceStore,
  TRACE_TYPES,
  getDefaultTraceStore,
  setDefaultTraceStore,
} from "../lib/trace-store.js";

describe("TraceStore — record", () => {
  it("requires sessionId", () => {
    const s = new TraceStore();
    expect(() => s.record({ type: "message" })).toThrow(/sessionId required/);
  });

  it("requires type", () => {
    const s = new TraceStore();
    expect(() => s.record({ sessionId: "x" })).toThrow(/type required/);
  });

  it("rejects non-object event", () => {
    const s = new TraceStore();
    expect(() => s.record(null)).toThrow(/event object required/);
  });

  it("auto-fills ts and seq", () => {
    const s = new TraceStore({ now: () => 12345 });
    const e = s.record({ sessionId: "s1", type: "message" });
    expect(e.ts).toBe(12345);
    expect(e.seq).toBe(1);
  });

  it("seq increments monotonically", () => {
    const s = new TraceStore();
    const e1 = s.record({ sessionId: "s1", type: "message" });
    const e2 = s.record({ sessionId: "s2", type: "tool_call" });
    expect(e2.seq).toBe(e1.seq + 1);
  });

  it("emits 'event' on record", () => {
    const s = new TraceStore();
    const spy = vi.fn();
    s.on("event", spy);
    s.record({ sessionId: "s1", type: "message" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("TraceStore — query", () => {
  it("returns events in chronological order", () => {
    const s = new TraceStore();
    s.record({ sessionId: "s1", type: "message", ts: 100 });
    s.record({ sessionId: "s1", type: "tool_call", ts: 200 });
    s.record({ sessionId: "s1", type: "tool_result", ts: 300 });
    const res = s.query("s1");
    expect(res.map((e) => e.type)).toEqual(["message", "tool_call", "tool_result"]);
  });

  it("filters by types", () => {
    const s = new TraceStore();
    s.record({ sessionId: "s1", type: "message" });
    s.record({ sessionId: "s1", type: "tool_call" });
    s.record({ sessionId: "s1", type: "error" });
    const res = s.query("s1", { types: ["error"] });
    expect(res).toHaveLength(1);
    expect(res[0].type).toBe("error");
  });

  it("filters by since/until", () => {
    const s = new TraceStore();
    s.record({ sessionId: "s1", type: "message", ts: 100 });
    s.record({ sessionId: "s1", type: "message", ts: 200 });
    s.record({ sessionId: "s1", type: "message", ts: 300 });
    expect(s.query("s1", { since: 150 })).toHaveLength(2);
    expect(s.query("s1", { until: 150 })).toHaveLength(1);
    expect(s.query("s1", { since: 150, until: 250 })).toHaveLength(1);
  });

  it("applies limit", () => {
    const s = new TraceStore();
    for (let i = 0; i < 20; i++) {
      s.record({ sessionId: "s1", type: "message", ts: i });
    }
    expect(s.query("s1", { limit: 5 })).toHaveLength(5);
  });

  it("isolates sessions", () => {
    const s = new TraceStore();
    s.record({ sessionId: "a", type: "message" });
    s.record({ sessionId: "b", type: "message" });
    expect(s.query("a")).toHaveLength(1);
    expect(s.query("b")).toHaveLength(1);
    expect(s.query("nonexistent")).toEqual([]);
  });
});

describe("TraceStore — summarize", () => {
  it("aggregates cost events", () => {
    const s = new TraceStore();
    s.record({
      sessionId: "s1",
      type: TRACE_TYPES.COST,
      payload: { costUsd: 0.01, inputTokens: 100, outputTokens: 50 },
    });
    s.record({
      sessionId: "s1",
      type: TRACE_TYPES.COST,
      payload: { costUsd: 0.02, inputTokens: 200, outputTokens: 75 },
    });
    const sum = s.summarize("s1");
    expect(sum.totalCostUsd).toBeCloseTo(0.03);
    expect(sum.totalInputTokens).toBe(300);
    expect(sum.totalOutputTokens).toBe(125);
  });

  it("counts errors", () => {
    const s = new TraceStore();
    s.record({ sessionId: "s1", type: TRACE_TYPES.ERROR });
    s.record({ sessionId: "s1", type: TRACE_TYPES.ERROR });
    s.record({ sessionId: "s1", type: "message" });
    expect(s.summarize("s1").errorCount).toBe(2);
  });

  it("groups by type", () => {
    const s = new TraceStore();
    s.record({ sessionId: "s1", type: "message" });
    s.record({ sessionId: "s1", type: "message" });
    s.record({ sessionId: "s1", type: "tool_call" });
    expect(s.summarize("s1").byType).toEqual({ message: 2, tool_call: 1 });
  });
});

describe("TraceStore — ring buffer", () => {
  it("drops oldest when over maxEvents", () => {
    const s = new TraceStore({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      s.record({ sessionId: "s1", type: "message", ts: i });
    }
    const res = s.query("s1");
    expect(res).toHaveLength(3);
    expect(res.map((e) => e.ts)).toEqual([2, 3, 4]);
  });

  it("stats reflects compaction", () => {
    const s = new TraceStore({ maxEvents: 2 });
    for (let i = 0; i < 5; i++) {
      s.record({ sessionId: "s1", type: "message" });
    }
    expect(s.stats().totalEvents).toBe(2);
  });
});

describe("TraceStore — session lifecycle", () => {
  it("clearSession removes events", () => {
    const s = new TraceStore();
    s.record({ sessionId: "s1", type: "message" });
    s.record({ sessionId: "s1", type: "message" });
    const removed = s.clearSession("s1");
    expect(removed).toBe(2);
    expect(s.query("s1")).toEqual([]);
  });

  it("clearAll wipes everything", () => {
    const s = new TraceStore();
    s.record({ sessionId: "a", type: "message" });
    s.record({ sessionId: "b", type: "message" });
    s.clearAll();
    expect(s.listSessions()).toEqual([]);
  });

  it("listSessions returns active sessionIds", () => {
    const s = new TraceStore();
    s.record({ sessionId: "a", type: "message" });
    s.record({ sessionId: "b", type: "message" });
    expect(s.listSessions().sort()).toEqual(["a", "b"]);
  });
});

describe("TraceStore — sink", () => {
  it("calls sink asynchronously", async () => {
    const sink = vi.fn().mockResolvedValue(undefined);
    const s = new TraceStore({ sink });
    s.record({ sessionId: "s1", type: "message" });
    await new Promise((r) => setImmediate(r));
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("emits sink-error when sink fails", async () => {
    const sink = vi.fn().mockRejectedValue(new Error("boom"));
    const s = new TraceStore({ sink });
    const errSpy = vi.fn();
    s.on("sink-error", errSpy);
    s.record({ sessionId: "s1", type: "message" });
    await new Promise((r) => setImmediate(r));
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0].error.message).toBe("boom");
  });

  it("sink failure does not block record()", () => {
    const sink = vi.fn().mockRejectedValue(new Error("boom"));
    const s = new TraceStore({ sink });
    const e = s.record({ sessionId: "s1", type: "message" });
    expect(e.seq).toBe(1); // record returns synchronously
  });
});

describe("TraceStore — default singleton", () => {
  it("returns a stable instance", () => {
    const a = getDefaultTraceStore();
    const b = getDefaultTraceStore();
    expect(a).toBe(b);
  });

  it("setDefaultTraceStore overrides", () => {
    const custom = new TraceStore();
    setDefaultTraceStore(custom);
    expect(getDefaultTraceStore()).toBe(custom);
    setDefaultTraceStore(null); // reset so next call creates fresh
  });
});
