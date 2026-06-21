/**
 * chat-core retry-on-drop (cc chat/ask parity with cc agent).
 *
 * A transient connection drop is retried ONLY when it hits before any token
 * reached the user — otherwise re-issuing would duplicate the visible answer.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { chatStream } from "../../src/lib/chat-core.js";

const enc = new TextEncoder();

// A response body whose reader yields `chunks` (UTF-8), then either reports
// done or throws `errorAfterChunks`.
function fakeBody(chunks, errorToThrow) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
        if (errorToThrow) throw errorToThrow;
        return { done: true, value: undefined };
      },
    }),
  };
}

async function drain(gen) {
  const tokens = [];
  let content = null;
  for await (const ev of gen) {
    if (ev.type === "response-token") tokens.push(ev.token);
    else if (ev.type === "response-complete") content = ev.content;
  }
  return { tokens, content };
}

const okStream = [
  'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
  'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
  "data: [DONE]\n",
];

const baseOpts = {
  provider: "openai",
  model: "gpt-4o",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
};

afterEach(() => vi.unstubAllGlobals());

describe("chat-core retry-on-drop", () => {
  it("retries a zero-token connection drop, then streams once (no duplication)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed"); // 0 tokens emitted
        return { ok: true, body: fakeBody(okStream) };
      }),
    );
    const { tokens, content } = await drain(chatStream([{ role: "user", content: "hi" }], baseOpts));
    expect(calls).toBe(2);
    expect(tokens).toEqual(["Hel", "lo"]); // streamed exactly once
    expect(content).toBe("Hello");
  });

  it("does NOT retry once a token has been emitted (avoids duplication)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        // Emit one token, then the reader drops mid-stream.
        return {
          ok: true,
          body: fakeBody(
            ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n'],
            Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }),
          ),
        };
      }),
    );
    const tokens = [];
    await expect(
      (async () => {
        for await (const ev of chatStream([{ role: "user", content: "hi" }], baseOpts)) {
          if (ev.type === "response-token") tokens.push(ev.token);
        }
      })(),
    ).rejects.toThrow(/ECONNRESET/);
    expect(calls).toBe(1); // no retry
    expect(tokens).toEqual(["Hi"]); // the partial the user already saw
  });

  it("does NOT retry a non-retryable HTTP/auth error", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return { ok: false, status: 401, statusText: "Unauthorized" };
      }),
    );
    await expect(
      drain(chatStream([{ role: "user", content: "hi" }], baseOpts)),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });
});
