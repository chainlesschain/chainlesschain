import { describe, it, expect } from "vitest";
import {
  monitorEventId,
  capEventPayload,
  monitorEventEnvelope,
  DedupWindow,
  BoundedEventQueue,
  DEFAULT_MAX_EVENT_BYTES,
} from "../../src/lib/monitor-event.js";

describe("monitorEventId", () => {
  it("is deterministic for the same monitor id + payload", () => {
    const a = monitorEventId("mon-1", { line: "build failed" });
    const b = monitorEventId("mon-1", { line: "build failed" });
    expect(a).toBe(b);
    expect(a).toMatch(/^ev_[0-9a-f]{24}$/);
  });

  it("is key-order independent for object payloads", () => {
    expect(monitorEventId("m", { a: 1, b: 2 })).toBe(
      monitorEventId("m", { b: 2, a: 1 }),
    );
  });

  it("changes when the observation changes", () => {
    expect(monitorEventId("m", "a")).not.toBe(monitorEventId("m", "b"));
  });

  it("changes when the monitor id changes", () => {
    expect(monitorEventId("m1", "x")).not.toBe(monitorEventId("m2", "x"));
  });
});

describe("capEventPayload", () => {
  it("passes a small string through untouched", () => {
    const res = capEventPayload("hello", 1024);
    expect(res).toEqual({ value: "hello", truncated: false, bytes: 5 });
  });

  it("truncates an oversized string by UTF-8 byte length", () => {
    const big = "x".repeat(100);
    const res = capEventPayload(big, 10);
    expect(res.truncated).toBe(true);
    expect(res.bytes).toBeLessThanOrEqual(10);
    expect(res.value).toBe("x".repeat(10));
  });

  it("never splits a multi-byte code point", () => {
    // '★' is 3 UTF-8 bytes; a 4-byte cap must keep only the first star.
    const res = capEventPayload("★★★", 4);
    expect(res.truncated).toBe(true);
    expect(res.value).toBe("★");
    expect(Buffer.byteLength(res.value, "utf8")).toBe(3);
  });

  it("serializes and caps a non-string payload", () => {
    const res = capEventPayload({ a: "y".repeat(100) }, 20);
    expect(res.truncated).toBe(true);
    expect(typeof res.value).toBe("string");
    expect(res.bytes).toBeLessThanOrEqual(20);
  });

  it("a zero cap disables truncation", () => {
    const res = capEventPayload("anything", 0);
    expect(res.truncated).toBe(false);
    expect(res.value).toBe("anything");
  });

  it("defaults to the 64 KiB budget", () => {
    const res = capEventPayload("x".repeat(DEFAULT_MAX_EVENT_BYTES + 10));
    expect(res.truncated).toBe(true);
    expect(res.bytes).toBeLessThanOrEqual(DEFAULT_MAX_EVENT_BYTES);
  });
});

describe("monitorEventEnvelope", () => {
  it("stamps a SYSTEM-origin envelope that can only steer, never approve", () => {
    const env = monitorEventEnvelope("mon-1", "build failed", {
      at: 1000,
      source: "command",
    });
    expect(env.origin).toBe("system");
    expect(env.authority).toBe("steer");
    expect(env.canApprove).toBe(false);
    expect(env.event_id).toMatch(/^ev_/);
    expect(env.monitorId).toBe("mon-1");
    expect(env.source).toBe("command");
    expect(env.at).toBe(1000);
    expect(env.provenance).toContain("origin=system");
    expect(env.provenance).toContain("authority=steer");
  });

  it("carries the capped payload + truncated flag", () => {
    const env = monitorEventEnvelope("m", "z".repeat(100), { maxBytes: 8 });
    expect(env.truncated).toBe(true);
    expect(env.payload).toBe("z".repeat(8));
  });

  it("event_id matches the standalone helper for the same input", () => {
    const env = monitorEventEnvelope("m", { k: 1 });
    expect(env.event_id).toBe(monitorEventId("m", { k: 1 }));
  });
});

describe("DedupWindow", () => {
  it("emits a new id once, suppresses the repeat", () => {
    const w = new DedupWindow({ windowMs: 1000 });
    expect(w.shouldEmit("ev_a", 0)).toBe(true);
    expect(w.shouldEmit("ev_a", 100)).toBe(false);
  });

  it("re-emits after the window elapses", () => {
    const w = new DedupWindow({ windowMs: 1000 });
    expect(w.shouldEmit("ev_a", 0)).toBe(true);
    expect(w.shouldEmit("ev_a", 500)).toBe(false); // still in window (refreshes)
    // The refresh at 500 pushed lastSeen forward, so the window is measured
    // from 500: at 1600 that's 1100ms later → expired.
    expect(w.shouldEmit("ev_a", 1600)).toBe(true);
  });

  it("distinct ids do not suppress each other", () => {
    const w = new DedupWindow({ windowMs: 1000 });
    expect(w.shouldEmit("ev_a", 0)).toBe(true);
    expect(w.shouldEmit("ev_b", 0)).toBe(true);
  });

  it("enforces the count cap by evicting the oldest", () => {
    const w = new DedupWindow({ windowMs: 10 ** 9, maxEntries: 2 });
    w.shouldEmit("ev_1", 0);
    w.shouldEmit("ev_2", 1);
    w.shouldEmit("ev_3", 2); // evicts ev_1
    expect(w.size).toBe(2);
    // ev_1 was evicted → treated as new again.
    expect(w.shouldEmit("ev_1", 3)).toBe(true);
  });

  it("windowMs=0 disables time expiry — ids persist until cleared/capped", () => {
    const w = new DedupWindow({ windowMs: 0 });
    expect(w.shouldEmit("ev_a", 0)).toBe(true);
    // No time sweep, so the id stays tracked and repeats stay suppressed even
    // at a much later tick.
    expect(w.shouldEmit("ev_a", 10 ** 9)).toBe(false);
    w.clear();
    expect(w.shouldEmit("ev_a", 0)).toBe(true);
  });

  it("expires a later entry even when an earlier one was refreshed", () => {
    // ev_a inserted first (t=0), ev_b second (t=100). Refreshing ev_a at t=900
    // updates its timestamp but keeps its Map position — timestamps are no
    // longer monotonic in iteration order. A sweep at t=1200 (window 1000,
    // cutoff 200) must still expire ev_b (ts=100) despite ev_a (ts=900) sitting
    // ahead of it, so ev_b's re-emit is not wrongly suppressed.
    const w = new DedupWindow({ windowMs: 1000 });
    w.shouldEmit("ev_a", 0);
    w.shouldEmit("ev_b", 100);
    w.shouldEmit("ev_a", 900); // refresh ev_a in place
    expect(w.shouldEmit("ev_b", 1200)).toBe(true); // ev_b expired → new again
  });

  it("clear() forgets everything", () => {
    const w = new DedupWindow({ windowMs: 1000 });
    w.shouldEmit("ev_a", 0);
    w.clear();
    expect(w.size).toBe(0);
    expect(w.shouldEmit("ev_a", 1)).toBe(true);
  });
});

describe("BoundedEventQueue", () => {
  it("accepts up to maxSize without dropping", () => {
    const q = new BoundedEventQueue({ maxSize: 3 });
    expect(q.push("a")).toEqual({ accepted: true, dropped: null });
    q.push("b");
    q.push("c");
    expect(q.size).toBe(3);
    expect(q.dropped).toBe(0);
  });

  it("oldest policy evicts the head to admit a newcomer", () => {
    const q = new BoundedEventQueue({ maxSize: 2, dropPolicy: "oldest" });
    q.push("a");
    q.push("b");
    const res = q.push("c");
    expect(res).toEqual({ accepted: true, dropped: "a" });
    expect(q.drain()).toEqual(["b", "c"]);
    expect(q.dropped).toBe(1);
  });

  it("newest policy rejects the incoming event when full", () => {
    const q = new BoundedEventQueue({ maxSize: 2, dropPolicy: "newest" });
    q.push("a");
    q.push("b");
    const res = q.push("c");
    expect(res).toEqual({ accepted: false, dropped: "c" });
    expect(q.drain()).toEqual(["a", "b"]);
    expect(q.dropped).toBe(1);
  });

  it("shift() and drain() empty the queue", () => {
    const q = new BoundedEventQueue({ maxSize: 3 });
    q.push("a");
    q.push("b");
    expect(q.shift()).toBe("a");
    expect(q.drain()).toEqual(["b"]);
    expect(q.size).toBe(0);
  });

  it("an unknown dropPolicy falls back to oldest", () => {
    const q = new BoundedEventQueue({ maxSize: 1, dropPolicy: "weird" });
    q.push("a");
    const res = q.push("b");
    expect(res.accepted).toBe(true);
    expect(res.dropped).toBe("a");
  });
});
