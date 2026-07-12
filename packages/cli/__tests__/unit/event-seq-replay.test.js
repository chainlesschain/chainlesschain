/**
 * Event-stream gap-detection + replay primitives (src/lib/event-seq-replay.js)
 * — the server→client counterpart to RemoteCommandLedger. EventReplayBuffer is
 * the producer (bounded retain + replay-since-cursor); SeqGapTracker is the
 * consumer (contiguity / gap / duplicate). Pure, deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  EventReplayBuffer,
  SeqGapTracker,
} from "../../src/lib/event-seq-replay.js";

describe("EventReplayBuffer.record + accessors", () => {
  it("stamps a monotonic 1-based seq and returns the stamped frame", () => {
    const buf = new EventReplayBuffer();
    const a = buf.record({ type: "bg-event", event: { type: "turn-started" } });
    const b = buf.record({ type: "bg-log", chunk: "x" });
    expect(a).toEqual({
      type: "bg-event",
      event: { type: "turn-started" },
      seq: 1,
    });
    expect(b).toEqual({ type: "bg-log", chunk: "x", seq: 2 });
    expect(buf.latestSeq).toBe(2);
    expect(buf.oldestSeq).toBe(1);
    expect(buf.size).toBe(2);
  });

  it("does not mutate the caller's frame object", () => {
    const buf = new EventReplayBuffer();
    const frame = { type: "bg-log", chunk: "y" };
    buf.record(frame);
    expect(frame).toEqual({ type: "bg-log", chunk: "y" }); // no seq leaked back
  });

  it("empty buffer reports oldestSeq === latestSeq", () => {
    const buf = new EventReplayBuffer();
    expect(buf.oldestSeq).toBe(0);
    expect(buf.latestSeq).toBe(0);
  });
});

describe("EventReplayBuffer eviction", () => {
  it("evicts oldest frames beyond maxEvents but keeps seq advancing", () => {
    const buf = new EventReplayBuffer({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) buf.record({ n: i });
    expect(buf.size).toBe(3);
    expect(buf.latestSeq).toBe(5);
    expect(buf.oldestSeq).toBe(3); // seq 1,2 evicted
  });

  it("evicts by byte budget but always keeps the newest frame", () => {
    // Each frame counts as 10 bytes; a 25-byte budget retains ~2 frames.
    const buf = new EventReplayBuffer({ maxBytes: 25, sizeOf: () => 10 });
    for (let i = 0; i < 6; i++) buf.record({ n: i });
    expect(buf.size).toBe(2);
    expect(buf.latestSeq).toBe(6);
  });

  it("keeps the single newest frame even if it alone exceeds maxBytes", () => {
    const buf = new EventReplayBuffer({ maxBytes: 5, sizeOf: () => 100 });
    buf.record({ big: true });
    expect(buf.size).toBe(1);
  });
});

describe("EventReplayBuffer.replaySince", () => {
  const seed = () => {
    const buf = new EventReplayBuffer();
    for (let i = 1; i <= 5; i++) buf.record({ type: "bg-event", n: i });
    return buf;
  };

  it("returns the exact tail after a cursor inside the window", () => {
    const r = seed().replaySince(3);
    expect(r.truncated).toBe(false);
    expect(r.frames.map((f) => f.seq)).toEqual([4, 5]);
    expect(r).toMatchObject({ from: 3, to: 5 });
  });

  it("returns everything for cursor 0 when nothing was evicted", () => {
    const r = seed().replaySince(0);
    expect(r.truncated).toBe(false);
    expect(r.frames.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns nothing when the cursor is already current or ahead", () => {
    const buf = seed();
    expect(buf.replaySince(5)).toMatchObject({ frames: [], truncated: false });
    expect(buf.replaySince(9)).toMatchObject({ frames: [], truncated: false });
  });

  it("flags truncated when the missed range was already evicted", () => {
    const buf = new EventReplayBuffer({ maxEvents: 2 });
    for (let i = 1; i <= 5; i++) buf.record({ n: i }); // retains seq 4,5
    const r = buf.replaySince(1); // 2,3 are gone
    expect(r.truncated).toBe(true);
    expect(r.frames.map((f) => f.seq)).toEqual([4, 5]); // only the suffix
  });

  it("treats a cursor exactly at the retained floor as clean (not truncated)", () => {
    const buf = new EventReplayBuffer({ maxEvents: 2 });
    for (let i = 1; i <= 5; i++) buf.record({ n: i }); // retains 4,5; floor = 3
    expect(buf.replaySince(3)).toMatchObject({ truncated: false });
    expect(buf.replaySince(2)).toMatchObject({ truncated: true });
  });

  it("defaults / non-finite cursor behaves like 0", () => {
    const buf = seed();
    expect(buf.replaySince().frames.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(buf.replaySince(NaN).frames.map((f) => f.seq)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});

describe("SeqGapTracker", () => {
  it("accepts the first frame and contiguous successors as ok", () => {
    const t = new SeqGapTracker();
    expect(t.observe(1)).toEqual({ status: "ok" });
    expect(t.observe(2)).toEqual({ status: "ok" });
    expect(t.observe(3)).toEqual({ status: "ok" });
    expect(t.lastSeq).toBe(3);
  });

  it("starts clean at any seq (mid-stream attach)", () => {
    const t = new SeqGapTracker();
    expect(t.observe(42)).toEqual({ status: "ok" });
    expect(t.observe(43)).toEqual({ status: "ok" });
  });

  it("reports a gap with the missed range and adopts the new position", () => {
    const t = new SeqGapTracker();
    t.observe(1);
    expect(t.observe(5)).toEqual({ status: "gap", from: 1, to: 5 });
    expect(t.lastSeq).toBe(5);
    expect(t.observe(6)).toEqual({ status: "ok" }); // contiguous after the gap
  });

  it("flags a re-sent frame as duplicate", () => {
    const t = new SeqGapTracker();
    t.observe(1);
    t.observe(2);
    expect(t.observe(2)).toEqual({ status: "duplicate" });
    expect(t.observe(1)).toEqual({ status: "duplicate" });
    expect(t.lastSeq).toBe(2); // duplicates don't move the cursor
  });

  it("tolerates unstamped frames (older producer) as ok", () => {
    const t = new SeqGapTracker();
    t.observe(1);
    expect(t.observe(undefined)).toEqual({ status: "ok" });
    expect(t.observe(NaN)).toEqual({ status: "ok" });
    expect(t.lastSeq).toBe(1); // unstamped frames don't move the cursor
  });

  it("reset() forgets history so a fresh producer epoch starts clean", () => {
    const t = new SeqGapTracker();
    t.observe(10);
    t.observe(11);
    t.reset();
    expect(t.observe(1)).toEqual({ status: "ok" }); // seq rewound, no false gap
    expect(t.lastSeq).toBe(1);
  });
});
