/**
 * Streaming-delta coalescing (Claude-Code 2.1.191 streaming-CPU optimization):
 * adjacent partial-message text/thinking deltas batch into one `stream_event`
 * line, flushing on a short timer, on a kind change, before any non-delta line
 * (ordering preserved), and at stream end. CC_STREAM_COALESCE_MS=0 restores the
 * legacy per-token emit. These exercise the pure helpers directly with injected
 * writeOut + timer seams, so they are deterministic (no real timers).
 */
import { describe, it, expect } from "vitest";
import {
  createStreamCoalescer,
  resolveStreamCoalesceMs,
} from "../../src/runtime/headless-stream.js";

function capture({ coalesceMs } = {}) {
  const lines = [];
  // Manual timer seam: startTimer records the callback; fireTimer() runs it.
  let pendingCb = null;
  const c = createStreamCoalescer({
    writeOut: (s) => lines.push(JSON.parse(s.replace(/\n$/, ""))),
    coalesceMs,
    setTimer: (fn) => {
      pendingCb = fn;
      return { _seam: true };
    },
    clearTimer: () => {
      pendingCb = null;
    },
  });
  return {
    coalescer: c,
    lines,
    fireTimer: () => {
      const fn = pendingCb;
      pendingCb = null;
      if (fn) fn();
    },
    hasTimer: () => pendingCb != null,
  };
}

const textDeltas = (lines) =>
  lines
    .filter(
      (l) => l.type === "stream_event" && l.event?.delta?.type === "text_delta",
    )
    .map((l) => l.event.delta.text);

describe("createStreamCoalescer", () => {
  it("batches consecutive text deltas into a single line on timer flush", () => {
    const { coalescer, lines, fireTimer, hasTimer } = capture({
      coalesceMs: 50,
    });
    coalescer.emitTextDelta("Hel");
    coalescer.emitTextDelta("lo, ");
    coalescer.emitTextDelta("world");
    expect(lines).toHaveLength(0); // nothing emitted yet — buffered
    expect(hasTimer()).toBe(true);
    fireTimer();
    expect(textDeltas(lines)).toEqual(["Hello, world"]);
    expect(hasTimer()).toBe(false); // timer cleared after flush
  });

  it("flushes pending deltas before any non-delta line (ordering preserved)", () => {
    const { coalescer, lines } = capture({ coalesceMs: 50 });
    coalescer.emitTextDelta("calling ");
    coalescer.emitTextDelta("tool");
    coalescer.emit({ type: "tool_use", tool: "read_file" });
    // The batched text run lands BEFORE the tool_use line. Every line is
    // stamped with the monotonic protocol-v1 `seq` (see test below).
    expect(lines).toEqual([
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "calling tool" },
        },
        seq: 1,
      },
      { type: "tool_use", tool: "read_file", seq: 2 },
    ]);
  });

  it("stamps every emitted line with a monotonic 1-based seq (one per LINE)", () => {
    const { coalescer, lines, fireTimer } = capture({ coalesceMs: 50 });
    coalescer.emit({ type: "system", subtype: "init", session_id: "s" });
    coalescer.emitTextDelta("a");
    coalescer.emitTextDelta("b"); // batched with "a" → ONE line, ONE seq
    fireTimer();
    coalescer.emit({ type: "result", subtype: "success", is_error: false });
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    // seq is stamped at write time — a batched run consumes a single number.
    expect(lines[1].event.delta.text).toBe("ab");
  });

  it("stampSeq:false restores the unstamped legacy output", () => {
    const lines = [];
    const c = createStreamCoalescer({
      writeOut: (s) => lines.push(JSON.parse(s)),
      coalesceMs: 0,
      stampSeq: false,
    });
    c.emit({ type: "tool_use", tool: "read_file" });
    expect(lines).toEqual([{ type: "tool_use", tool: "read_file" }]);
  });

  it("flushes the prior run when the delta kind changes (text → thinking)", () => {
    const { coalescer, lines, fireTimer } = capture({ coalesceMs: 50 });
    coalescer.emitTextDelta("answer");
    coalescer.emitThinkingDelta("reasoning"); // kind change → flush text first
    fireTimer(); // flush the thinking run
    expect(lines.map((l) => l.event.delta)).toEqual([
      { type: "text_delta", text: "answer" },
      { type: "thinking_delta", thinking: "reasoning" },
    ]);
  });

  it("emits each delta immediately when coalesceMs <= 0 (legacy behavior)", () => {
    const { coalescer, lines, hasTimer } = capture({ coalesceMs: 0 });
    coalescer.emitTextDelta("a");
    coalescer.emitTextDelta("b");
    expect(textDeltas(lines)).toEqual(["a", "b"]); // one line per token
    expect(hasTimer()).toBe(false); // no timer armed when disabled
  });

  it("flush() is idempotent and drains the final partial run at stream end", () => {
    const { coalescer, lines } = capture({ coalesceMs: 50 });
    coalescer.emitTextDelta("tail");
    coalescer.flush();
    coalescer.flush(); // second flush is a no-op
    expect(textDeltas(lines)).toEqual(["tail"]);
  });

  it("a single timer batches a whole run (one flush, not one-per-token)", () => {
    const { coalescer, lines, fireTimer } = capture({ coalesceMs: 50 });
    for (let i = 0; i < 200; i++) coalescer.emitTextDelta("x");
    expect(lines).toHaveLength(0);
    fireTimer();
    expect(textDeltas(lines)).toEqual(["x".repeat(200)]);
  });
});

describe("resolveStreamCoalesceMs", () => {
  it("defaults to 50ms", () => {
    expect(resolveStreamCoalesceMs({}, {})).toBe(50);
  });

  it("honors an explicit numeric option over the env var", () => {
    expect(
      resolveStreamCoalesceMs(
        { streamCoalesceMs: 120 },
        { CC_STREAM_COALESCE_MS: "10" },
      ),
    ).toBe(120);
  });

  it("reads CC_STREAM_COALESCE_MS when no explicit option", () => {
    expect(resolveStreamCoalesceMs({}, { CC_STREAM_COALESCE_MS: "0" })).toBe(0);
    expect(resolveStreamCoalesceMs({}, { CC_STREAM_COALESCE_MS: "100" })).toBe(
      100,
    );
  });

  it("falls back to 50 for blank / negative / non-numeric values", () => {
    expect(resolveStreamCoalesceMs({}, { CC_STREAM_COALESCE_MS: "" })).toBe(50);
    expect(resolveStreamCoalesceMs({}, { CC_STREAM_COALESCE_MS: "-5" })).toBe(
      50,
    );
    expect(resolveStreamCoalesceMs({}, { CC_STREAM_COALESCE_MS: "abc" })).toBe(
      50,
    );
  });

  it("treats explicit 0 as disabled", () => {
    expect(resolveStreamCoalesceMs({ streamCoalesceMs: 0 }, {})).toBe(0);
  });
});
