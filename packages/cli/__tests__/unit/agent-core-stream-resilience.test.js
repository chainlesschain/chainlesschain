/**
 * Mid-stream connection-drop resilience (Claude-Code 2.1.179 parity).
 *
 * When a streaming LLM response drops mid-flight (ECONNRESET / "terminated" /
 * server hangup), the partial text the user already watched stream to their
 * terminal must be preserved and returned — not discarded in favour of a raw
 * network error. A genuine user abort (Esc / AbortController) and a drop that
 * produced no text both still surface the error.
 *
 * Two layers:
 *   1. _streamErrorDisposition — the pure rethrow-vs-preserve policy.
 *   2. chatWithTools (OpenAI-compatible streaming path) end-to-end, with a
 *      mocked global fetch whose body reader throws mid-stream.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";
import {
  _streamErrorDisposition,
  chatWithTools,
} from "../../src/runtime/agent-core.js";

describe("_streamErrorDisposition", () => {
  it("rethrows on an AbortError (name)", () => {
    const e = new Error("stop");
    e.name = "AbortError";
    expect(_streamErrorDisposition(e, null, "partial")).toBe("rethrow");
  });

  it("rethrows on an ABORT_ERR (code)", () => {
    const e = new Error("stop");
    e.code = "ABORT_ERR";
    expect(_streamErrorDisposition(e, null, "partial")).toBe("rethrow");
  });

  it("rethrows when the signal is already aborted", () => {
    const e = new Error("terminated");
    expect(_streamErrorDisposition(e, { aborted: true }, "partial")).toBe(
      "rethrow",
    );
  });

  it("preserves a genuine drop that produced partial text", () => {
    const e = new Error("terminated");
    e.code = "ECONNRESET";
    expect(_streamErrorDisposition(e, { aborted: false }, "some text")).toBe(
      "preserve",
    );
  });

  it("rethrows a genuine drop with no / blank text", () => {
    const e = new Error("ECONNRESET");
    expect(_streamErrorDisposition(e, null, "")).toBe("rethrow");
    expect(_streamErrorDisposition(e, null, "   ")).toBe("rethrow");
    expect(_streamErrorDisposition(e, null, null)).toBe("rethrow");
    expect(_streamErrorDisposition(e, null, undefined)).toBe("rethrow");
  });
});

describe("chatWithTools — streaming connection-drop resilience", () => {
  afterEach(() => vi.unstubAllGlobals());

  const enc = new TextEncoder();

  // Mock global fetch with a streaming body whose reader yields `chunks`
  // (UTF-8 encoded), then throws `errorToThrow` on the next read().
  const stubThrowingFetch = (chunks, errorToThrow) => {
    let i = 0;
    const reader = {
      read: async () => {
        if (i < chunks.length)
          return { done: false, value: enc.encode(chunks[i++]) };
        throw errorToThrow;
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body: { getReader: () => reader } })),
    );
  };

  const baseOpts = (over = {}) => ({
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "test-key",
    cwd: os.tmpdir(),
    ...over,
  });

  it("preserves partial text when the stream drops mid-response", async () => {
    const tokens = [];
    const err = new Error("terminated");
    err.code = "ECONNRESET";
    stubThrowingFetch(
      [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo wor"}}]}\n',
      ],
      err,
    );

    const out = await chatWithTools(
      [{ role: "user", content: "hi" }],
      baseOpts({ onToken: (t) => tokens.push(t) }),
    );

    // The user saw every token that arrived before the drop...
    expect(tokens).toEqual(["Hel", "lo wor"]);
    // ...and the finalized message keeps that partial text + a truncation flag.
    expect(out.message.content).toBe("Hello wor");
    expect(out.message._truncated).toBe(true);
  });

  it("drops a half-streamed tool_call when preserving a truncated answer", async () => {
    const err = new Error("socket hang up");
    stubThrowingFetch(
      [
        'data: {"choices":[{"delta":{"content":"thinking..."}}]}\n',
        // tool_call header + truncated JSON args, then the socket dies
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"ls","arguments":"{\\"p"}}]}}]}\n',
      ],
      err,
    );

    const out = await chatWithTools(
      [{ role: "user", content: "hi" }],
      baseOpts({ onToken: () => {} }),
    );

    expect(out.message.content).toBe("thinking...");
    // A truncated tool call is not safely executable — it must not survive.
    expect(out.message.tool_calls).toBeUndefined();
    expect(out.message._truncated).toBe(true);
  });

  it("re-throws on user abort instead of returning a partial", async () => {
    const abortErr = new Error("Agent loop interrupted");
    abortErr.name = "AbortError";
    stubThrowingFetch(
      ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n'],
      abortErr,
    );

    await expect(
      chatWithTools(
        [{ role: "user", content: "hi" }],
        baseOpts({ onToken: () => {} }),
      ),
    ).rejects.toThrow(/interrupted/i);
  });

  it("re-throws a mid-stream drop that produced no text", async () => {
    const err = new Error("socket hang up");
    stubThrowingFetch(
      // only a tool_call fragment arrived — nothing worth preserving
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"ls","arguments":"{"}}]}}]}\n',
      ],
      err,
    );

    await expect(
      chatWithTools(
        [{ role: "user", content: "hi" }],
        baseOpts({ onToken: () => {} }),
      ),
    ).rejects.toThrow(/socket hang up/);
  });
});
