/**
 * chat-core stall HINT (cc chat/ask parity with cc agent).
 *
 * Before the hard stall-abort, fire a "waiting for API response" hint once per
 * silent gap so the user isn't staring at a frozen cursor. Purely informational
 * — it never aborts.
 *
 * Env is set BEFORE import so the module's STREAM_STALL_* consts pick it up:
 * abort far away (so it never trips here), hint fast.
 */
import { describe, it, expect, afterEach } from "vitest";

process.env.CC_CHAT_STALL_MS = "5000";
process.env.CC_CHAT_STALL_HINT_MS = "20";
const { streamOpenAI, STREAM_STALL_HINT_MS } =
  await import("../../src/lib/chat-core.js");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Body whose first read settles after `delayMs` (a silent gap), then streams the
// chunks and ends.
function delayedBody(chunks, delayMs) {
  let i = 0;
  return {
    getReader() {
      return {
        read: () => {
          if (i >= chunks.length)
            return Promise.resolve({ done: true, value: undefined });
          const v = chunks[i];
          const wait = i === 0 ? delayMs : 0;
          i++;
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({ done: false, value: new TextEncoder().encode(v) }),
              wait,
            ),
          );
        },
      };
    },
  };
}

describe("chat-core stall hint", () => {
  it("picks up CC_CHAT_STALL_HINT_MS", () => {
    expect(STREAM_STALL_HINT_MS).toBe(20);
  });

  it("fires onStall during a silent gap, then completes normally", async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        body: delayedBody(
          [
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
            "data: [DONE]\n",
          ],
          80, // first chunk 80ms late: > 20ms hint, < 5000ms abort
        ),
      });
    const stalls = [];
    const text = await streamOpenAI(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      () => {},
      null,
      (ms) => stalls.push(ms),
    );
    expect(text).toBe("hi"); // streamed normally (no abort)
    expect(stalls.length).toBeGreaterThanOrEqual(1);
  });

  it("passes the abort deadline (stallMs) as onStall's 2nd arg", async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        body: delayedBody(
          [
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
            "data: [DONE]\n",
          ],
          80,
        ),
      });
    const calls = [];
    await streamOpenAI(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      () => {},
      null,
      (ms, timeoutMs) => calls.push([ms, timeoutMs]),
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // CC_CHAT_STALL_MS=5000 set at top of file → the hard abort deadline.
    expect(calls[0][1]).toBe(5000);
  });

  it("does not fire onStall when data arrives promptly", async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        body: delayedBody(
          [
            'data: {"choices":[{"delta":{"content":"yo"}}]}\n',
            "data: [DONE]\n",
          ],
          0, // immediate
        ),
      });
    const stalls = [];
    await streamOpenAI(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      () => {},
      null,
      (ms) => stalls.push(ms),
    );
    expect(stalls).toHaveLength(0);
  });
});
