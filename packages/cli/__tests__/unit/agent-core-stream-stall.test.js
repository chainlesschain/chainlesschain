/**
 * Stream-stall hint (Claude-Code 2.1.185 parity).
 *
 * When a streaming LLM response goes silent mid-flight — the TCP connection is
 * alive but no bytes arrive (a slow / overloaded API) — cc surfaces a "waiting
 * for API response" hint instead of leaving the user staring at a frozen
 * spinner. The mechanism is `_iterateStreamWithStall`: it wraps a stream reader
 * and fires `onStall(elapsedMs)` at most once per silent gap longer than
 * `stallMs`, while never dropping or double-reading a chunk.
 *
 * Two layers:
 *   1. _iterateStreamWithStall — the pure watchdog generator (real timers,
 *      tiny stallMs so the tests stay fast and load-robust).
 *   2. chatWithTools (OpenAI-compatible streaming path) end-to-end, proving the
 *      onStall hook + streamStallMs override thread all the way through.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";
import {
  _iterateStreamWithStall,
  _isRetryableStreamError,
  chatWithTools,
} from "../../src/runtime/agent-core.js";

// A reader whose Nth read() resolves after `gaps[N]` ms (0 = immediate), then
// reports done. Mirrors the ReadableStreamDefaultReader contract cc consumes.
function makeReader(values, gaps = []) {
  let i = 0;
  return {
    read: () => {
      if (i >= values.length)
        return Promise.resolve({ done: true, value: undefined });
      const value = values[i];
      const gap = gaps[i] || 0;
      i++;
      if (!gap) return Promise.resolve({ done: false, value });
      return new Promise((resolve) =>
        setTimeout(() => resolve({ done: false, value }), gap),
      );
    },
  };
}

async function drain(gen) {
  const out = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("_iterateStreamWithStall (watchdog generator)", () => {
  it("yields every chunk in order on the plain (no-onStall) path", async () => {
    const reader = makeReader([1, 2, 3]);
    expect(await drain(_iterateStreamWithStall(reader))).toEqual([1, 2, 3]);
  });

  it("does not fire onStall when chunks arrive faster than stallMs", async () => {
    const stalls = [];
    const reader = makeReader([1, 2]); // immediate
    const out = await drain(
      _iterateStreamWithStall(reader, {
        stallMs: 10000,
        onStall: (ms) => stalls.push(ms),
      }),
    );
    expect(out).toEqual([1, 2]);
    expect(stalls).toHaveLength(0);
  });

  it("fires onStall once for a silent gap, then still yields the chunk", async () => {
    const stalls = [];
    const reader = makeReader([42], [60]); // one chunk, 60ms late
    const out = await drain(
      _iterateStreamWithStall(reader, {
        stallMs: 10,
        onStall: (ms) => stalls.push(ms),
      }),
    );
    expect(out).toEqual([42]);
    // Exactly one notification per gap — the re-armed timer is guarded.
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toBeGreaterThanOrEqual(10);
  });

  it("re-arms per gap: two silent gaps → two notifications", async () => {
    const stalls = [];
    const reader = makeReader([1, 2], [60, 60]);
    const out = await drain(
      _iterateStreamWithStall(reader, {
        stallMs: 10,
        onStall: () => stalls.push(1),
      }),
    );
    expect(out).toEqual([1, 2]);
    expect(stalls).toHaveLength(2);
  });

  it("propagates a reader error (abort / connection drop) out of the loop", async () => {
    const reader = {
      read: () => Promise.reject(new Error("boom")),
    };
    await expect(
      drain(_iterateStreamWithStall(reader, { stallMs: 10, onStall() {} })),
    ).rejects.toThrow("boom");
  });

  it("never lets a throwing onStall break the stream (best-effort)", async () => {
    const reader = makeReader([7], [40]);
    const out = await drain(
      _iterateStreamWithStall(reader, {
        stallMs: 10,
        onStall: () => {
          throw new Error("hint blew up");
        },
      }),
    );
    expect(out).toEqual([7]);
  });
});

describe("chatWithTools streaming → onStall wiring", () => {
  afterEach(() => vi.unstubAllGlobals());

  const enc = new TextEncoder();

  // Mock fetch whose body reader delays the first SSE chunk by `gapMs`, then
  // delivers the answer and closes.
  const stubDelayedFetch = (gapMs) => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      "data: [DONE]\n",
    ];
    let i = 0;
    const reader = {
      read: () => {
        if (i >= chunks.length)
          return Promise.resolve({ done: true, value: undefined });
        const value = enc.encode(chunks[i]);
        const delay = i === 0 ? gapMs : 0;
        i++;
        return new Promise((resolve) =>
          setTimeout(() => resolve({ done: false, value }), delay),
        );
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body: { getReader: () => reader } })),
    );
  };

  it("fires the onStall hook through the full streaming dispatch", async () => {
    stubDelayedFetch(60);
    const stalls = [];
    const tokens = [];
    const out = await chatWithTools([{ role: "user", content: "hi" }], {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
      cwd: os.tmpdir(),
      onToken: (t) => tokens.push(t),
      onStall: (ms) => stalls.push(ms),
      streamStallMs: 10,
    });
    expect(tokens).toEqual(["hi"]);
    expect(out.message.content).toBe("hi");
    expect(stalls.length).toBeGreaterThanOrEqual(1);
  });

  it("stays silent when the response streams without stalling", async () => {
    stubDelayedFetch(0);
    const stalls = [];
    const out = await chatWithTools([{ role: "user", content: "hi" }], {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
      cwd: os.tmpdir(),
      onToken: () => {},
      onStall: (ms) => stalls.push(ms),
      streamStallMs: 10000,
    });
    expect(out.message.content).toBe("hi");
    expect(stalls).toHaveLength(0);
  });
});

describe("_iterateStreamWithStall (hard inactivity timeout)", () => {
  // A reader that never resolves read() — a dead-but-open connection.
  const makeSilentReader = () => {
    let cancelled = false;
    return {
      read: () => new Promise(() => {}), // never settles
      cancel: () => {
        cancelled = true;
        return Promise.resolve();
      },
      get cancelled() {
        return cancelled;
      },
    };
  };

  it("throws a RETRYABLE ETIMEDOUT after stallTimeoutMs of silence", async () => {
    const reader = makeSilentReader();
    let thrown;
    try {
      await drain(_iterateStreamWithStall(reader, { stallTimeoutMs: 30 }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe("ETIMEDOUT");
    expect(thrown.message).toMatch(/stalled/i);
    // The dead stream was cancelled so the socket is released before retry.
    expect(reader.cancelled).toBe(true);
    // The error must be classified retryable so the dispatch seam re-issues it.
    expect(_isRetryableStreamError(thrown, null)).toBe(true);
  });

  it("fires the stall hint before the hard timeout when both are set", async () => {
    const reader = makeSilentReader();
    const stalls = [];
    await expect(
      drain(
        _iterateStreamWithStall(reader, {
          stallMs: 10,
          stallTimeoutMs: 50,
          onStall: (ms) => stalls.push(ms),
        }),
      ),
    ).rejects.toThrow(/stalled/i);
    // The hint fired (once) during the silence that preceded the timeout.
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toBeGreaterThanOrEqual(10);
  });

  it("a chunk arriving under the timeout is delivered (no spurious abort)", async () => {
    // 60ms-late chunk, explicit generous timeout — must not trip.
    const reader = makeReader([99], [60]);
    const out = await drain(
      _iterateStreamWithStall(reader, { stallMs: 10000, stallTimeoutMs: 5000 }),
    );
    expect(out).toEqual([99]);
  });

  it("stallTimeoutMs:0 disables the hard timeout (hint still fires)", async () => {
    const stalls = [];
    // 80ms-late chunk: the 10ms hint fires, but a 0 timeout never aborts.
    const reader = makeReader([7], [80]);
    const out = await drain(
      _iterateStreamWithStall(reader, {
        stallMs: 10,
        stallTimeoutMs: 0,
        onStall: () => stalls.push(1),
      }),
    );
    expect(out).toEqual([7]);
    expect(stalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("chatWithTools streaming → hard timeout recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a permanently silent stream, then surfaces the timeout", async () => {
    // Fresh never-resolving reader per fetch attempt (the retry layer re-fetches).
    let fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetches++;
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: () => new Promise(() => {}),
              cancel: () => Promise.resolve(),
            }),
          },
        };
      }),
    );
    await expect(
      chatWithTools([{ role: "user", content: "hi" }], {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "test-key",
        cwd: os.tmpdir(),
        onToken: () => {},
        streamStallTimeoutMs: 20,
      }),
    ).rejects.toThrow(/stalled|ETIMEDOUT/i);
    // 1 initial attempt + STREAM_RETRY_MAX(2) retries = 3 fetches.
    expect(fetches).toBe(3);
  }, 10000);
});
