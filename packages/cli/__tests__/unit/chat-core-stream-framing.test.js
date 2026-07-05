import { describe, it, expect, vi, afterEach } from "vitest";

// Regression: streamOllama / streamOpenAI split each stream CHUNK into lines in
// isolation and dropped any partial line. A JSON/SSE line split across two
// reads (TCP doesn't align to '\n') was therefore lost entirely — both halves
// fail JSON.parse — silently dropping that token's content. streamAnthropic
// already buffered the trailing partial; these two now match it.

function makeReadableStream(chunks) {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(chunks[i++]) };
        },
      };
    },
  };
}

describe("chat-core — stream line framing across chunk boundaries", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("streamOllama reassembles a JSON line split across two chunks", async () => {
    const { streamOllama } = await import("../../src/lib/chat-core.js");
    // "Hello World" split mid-line, with the newline only on the second chunk.
    const chunks = ['{"message":{"content":"Hello ', 'World"}}\n'];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const tokens = [];
    const full = await streamOllama(
      [{ role: "user", content: "hi" }],
      "m",
      "http://localhost:11434",
      (t) => tokens.push(t),
    );
    expect(tokens.join("")).toBe("Hello World");
    expect(full).toBe("Hello World");
  });

  it("streamOpenAI reassembles an SSE data line split across two chunks", async () => {
    const { streamOpenAI } = await import("../../src/lib/chat-core.js");
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello ',
      'World"}}]}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const tokens = [];
    const full = await streamOpenAI(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      (t) => tokens.push(t),
    );
    expect(tokens.join("")).toBe("Hello World");
    expect(full).toBe("Hello World");
  });
});
