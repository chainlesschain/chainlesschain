import { describe, it, expect, vi } from "vitest";
import {
  sseResponseHeaders,
  formatEnvelopeAsSse,
  formatSseComment,
  envelopeStreamToSse,
} from "../lib/envelope-sse.js";
import { createEnvelope } from "../lib/service-envelope.js";

describe("sseResponseHeaders", () => {
  it("returns a fresh copy of the canonical SSE headers", () => {
    const a = sseResponseHeaders();
    const b = sseResponseHeaders();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a["Content-Type"]).toMatch(/text\/event-stream/);
    expect(a["Cache-Control"]).toContain("no-cache");
    expect(a.Connection).toBe("keep-alive");
    expect(a["X-Accel-Buffering"]).toBe("no");
  });
});

describe("formatEnvelopeAsSse", () => {
  it("emits id / event / data lines terminated by a blank line", () => {
    const env = createEnvelope({
      type: "run.token",
      sessionId: "sess_1",
      ts: 1700000000000,
      payload: { content: "hi" },
    });
    const out = formatEnvelopeAsSse(env);
    expect(out).toContain("event: run.token");
    expect(out).toContain("id: run.token:1700000000000");
    expect(out).toContain('data: {"v":1,"type":"run.token"');
    expect(out.endsWith("\n\n")).toBe(true);
  });

  it("honors a caller-provided id", () => {
    const env = createEnvelope({ type: "run.message", sessionId: "s" });
    const out = formatEnvelopeAsSse(env, { id: "abc" });
    expect(out).toContain("id: abc");
  });

  it("rejects an invalid envelope", () => {
    expect(() => formatEnvelopeAsSse({ v: 1, type: "bad", payload: {} })).toThrow(
      /invalid envelope/
    );
  });
});

describe("formatSseComment", () => {
  it("prefixes a colon and terminates with a blank line", () => {
    expect(formatSseComment("ping")).toBe(": ping\n\n");
  });

  it("flattens embedded newlines so the comment stays single-line", () => {
    expect(formatSseComment("a\nb")).toBe(": a b\n\n");
  });
});

describe("envelopeStreamToSse", () => {
  async function collect(iter) {
    const out = [];
    for await (const chunk of iter) out.push(chunk);
    return out;
  }

  async function* envelopeGen(envelopes) {
    for (const e of envelopes) yield e;
  }

  it("converts a finite envelope stream to SSE chunks", async () => {
    const envs = [
      createEnvelope({ type: "run.started", sessionId: "s", runId: "r1" }),
      createEnvelope({
        type: "run.token",
        sessionId: "s",
        runId: "r1",
        payload: { content: "hi" },
      }),
      createEnvelope({ type: "run.ended", sessionId: "s", runId: "r1" }),
    ];

    const chunks = await collect(
      envelopeStreamToSse(envelopeGen(envs), { heartbeatMs: 0 })
    );
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("event: run.started");
    expect(chunks[1]).toContain("event: run.token");
    expect(chunks[2]).toContain("event: run.ended");
  });

  it("emits a heartbeat comment when the source idles", async () => {
    vi.useFakeTimers();
    let resolveSecond;
    const source = (async function* () {
      yield createEnvelope({ type: "run.started", sessionId: "s", runId: "r1" });
      // Park here until the test releases us.
      await new Promise((r) => {
        resolveSecond = r;
      });
      yield createEnvelope({ type: "run.ended", sessionId: "s", runId: "r1" });
    })();

    const chunks = [];
    const consumer = (async () => {
      for await (const chunk of envelopeStreamToSse(source, {
        heartbeatMs: 100,
      })) {
        chunks.push(chunk);
        if (chunks.length === 3) break;
      }
    })();

    // Drain microtasks so the iterator yields the first envelope, then trip
    // the heartbeat timer twice.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    resolveSecond();
    await vi.advanceTimersByTimeAsync(0);
    await consumer;

    expect(chunks[0]).toContain("event: run.started");
    expect(chunks[1]).toBe(": keep-alive\n\n");
    expect(chunks[2]).toBe(": keep-alive\n\n");

    vi.useRealTimers();
  });

  it("stops when the abort signal fires", async () => {
    const ac = new AbortController();
    let release;
    const source = (async function* () {
      yield createEnvelope({ type: "run.started", sessionId: "s", runId: "r1" });
      await new Promise((r) => {
        release = r;
      });
      yield createEnvelope({ type: "run.ended", sessionId: "s", runId: "r1" });
    })();

    const chunks = [];
    const consumer = (async () => {
      for await (const chunk of envelopeStreamToSse(source, {
        heartbeatMs: 0,
        signal: ac.signal,
      })) {
        chunks.push(chunk);
      }
    })();

    // Yield once so the first envelope is consumed.
    await new Promise((r) => setImmediate(r));
    ac.abort();
    release();
    await consumer;

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("event: run.started");
  });
});
