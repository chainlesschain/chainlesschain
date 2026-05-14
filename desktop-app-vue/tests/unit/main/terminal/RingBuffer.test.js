import { describe, it, expect } from "vitest";
import pkg from "../../../../src/main/terminal/RingBuffer.js";
const { RingBuffer } = pkg;

describe("RingBuffer", () => {
  it("assigns monotonic seq starting at 1", () => {
    const rb = new RingBuffer({ maxBytes: 1024 });
    expect(rb.push("a")).toBe(1);
    expect(rb.push("b")).toBe(2);
    expect(rb.push("c")).toBe(3);
    expect(rb.lastSeq).toBe(3);
  });

  it("retains all entries when under cap", () => {
    const rb = new RingBuffer({ maxBytes: 1024 });
    rb.push("hello");
    rb.push("world");
    const { chunks, truncated } = rb.since(0);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].data.toString()).toBe("hello");
    expect(chunks[1].data.toString()).toBe("world");
    expect(truncated).toBe(false);
  });

  it("evicts oldest entries when total bytes exceed cap", () => {
    // 3-byte cap, push 1+1+1+1 → first entry evicted
    const rb = new RingBuffer({ maxBytes: 3 });
    rb.push("a");
    rb.push("b");
    rb.push("c");
    rb.push("d");
    expect(rb.size).toBe(3);
    expect(rb.totalBytes).toBe(3);
    const { chunks } = rb.since(0);
    expect(chunks.map((c) => c.data.toString())).toEqual(["b", "c", "d"]);
  });

  it("since(fromSeq) returns only chunks with seq >= fromSeq", () => {
    const rb = new RingBuffer({ maxBytes: 1024 });
    rb.push("a");
    rb.push("b");
    rb.push("c");
    const { chunks } = rb.since(2);
    expect(chunks.map((c) => c.seq)).toEqual([2, 3]);
  });

  it("flags truncated when fromSeq predates retained range", () => {
    const rb = new RingBuffer({ maxBytes: 2 });
    rb.push("a"); // seq=1, evicted
    rb.push("b"); // seq=2
    rb.push("c"); // seq=3
    // After push c, total=3 > 2 → evict a. firstRetained=2.
    const { chunks, truncated } = rb.since(1);
    expect(truncated).toBe(true);
    expect(chunks.map((c) => c.seq)).toEqual([2, 3]);
  });

  it("computes byte cost from utf-8 byte length, not char count", () => {
    // "中" is 3 bytes UTF-8. Cap=4 → two pushes fit, third evicts first.
    const rb = new RingBuffer({ maxBytes: 4 });
    rb.push("中"); // 3 bytes, total=3
    rb.push("a"); // 1 byte, total=4
    rb.push("b"); // pushes over → evict "中"
    const { chunks } = rb.since(0);
    expect(chunks.map((c) => c.data.toString())).toEqual(["a", "b"]);
  });

  it("rejects non-positive maxBytes", () => {
    expect(() => new RingBuffer({ maxBytes: 0 })).toThrow();
    expect(() => new RingBuffer({ maxBytes: -1 })).toThrow();
  });
});
