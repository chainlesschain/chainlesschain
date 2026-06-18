/**
 * chat-core streaming stall guard.
 *
 * A streaming chat call must not hang forever if the LLM API accepts the
 * connection but then goes silent. Each stream helper arms an abort that fires
 * when no data arrives for STREAM_STALL_MS (reset on every chunk), surfacing a
 * clear "stalled" error instead of blocking the REPL / `cc chat` indefinitely.
 *
 * The env var is set BEFORE importing chat-core so the module-level
 * STREAM_STALL_MS picks up a tiny value (vitest isolates modules per file).
 */

import { describe, it, expect, afterEach } from "vitest";

process.env.CC_CHAT_STALL_MS = "60";
const { streamOllama, streamOpenAI, streamAnthropic, STREAM_STALL_MS } =
  await import("../../src/lib/chat-core.js");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// A body whose reader.read() only settles when the request's AbortSignal fires.
function stallingBody() {
  return {
    getReader() {
      return {
        read: () =>
          new Promise((_resolve, reject) => {
            stallingBody._signal?.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            });
          }),
      };
    },
  };
}

function makeReadableStream(chunks) {
  let i = 0;
  return {
    getReader() {
      return {
        read: () =>
          i < chunks.length
            ? Promise.resolve({
                done: false,
                value: new TextEncoder().encode(chunks[i++]),
              })
            : Promise.resolve({ done: true, value: undefined }),
      };
    },
  };
}

describe("chat-core stall guard", () => {
  it("picks up CC_CHAT_STALL_MS", () => {
    expect(STREAM_STALL_MS).toBe(60);
  });

  it("aborts streamOllama when the body stalls mid-stream", async () => {
    globalThis.fetch = (url, opts) => {
      stallingBody._signal = opts.signal;
      return Promise.resolve({ ok: true, body: stallingBody() });
    };
    await expect(streamOllama([], "m", "http://x", () => {})).rejects.toThrow(
      /stalled/i,
    );
  });

  it("aborts streamOpenAI when the request itself never responds", async () => {
    globalThis.fetch = (url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    await expect(
      streamOpenAI([], "m", "http://x", "key", () => {}),
    ).rejects.toThrow(/stalled/i);
  });

  it("aborts streamAnthropic when the body stalls", async () => {
    globalThis.fetch = (url, opts) => {
      stallingBody._signal = opts.signal;
      return Promise.resolve({ ok: true, body: stallingBody() });
    };
    await expect(
      streamAnthropic([], "m", "http://x", "key", () => {}),
    ).rejects.toThrow(/stalled/i);
  });

  it("still completes a healthy stream (control)", async () => {
    const chunk = JSON.stringify({ message: { content: "hi" }, done: true });
    globalThis.fetch = () =>
      Promise.resolve({ ok: true, body: makeReadableStream([chunk + "\n"]) });
    const tokens = [];
    const out = await streamOllama([], "m", "http://x", (t) => tokens.push(t));
    expect(out).toBe("hi");
    expect(tokens).toEqual(["hi"]);
  });
});
