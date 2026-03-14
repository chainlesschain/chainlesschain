import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/lib/llm-providers.js", () => ({
  BUILT_IN_PROVIDERS: {
    ollama: {
      name: "ollama",
      displayName: "Ollama (Local)",
      baseUrl: "http://localhost:11434",
      apiKeyEnv: null,
    },
    openai: {
      name: "openai",
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  },
}));

const { chatStream, chatWithStreaming, streamOllama, streamOpenAI } =
  await import("../../src/lib/chat-core.js");

/**
 * Helper: build a ReadableStream from an array of string chunks.
 */
function makeReadableStream(chunks) {
  let index = 0;
  const encoder = new TextEncoder();
  return {
    getReader() {
      return {
        async read() {
          if (index >= chunks.length) {
            return { done: true, value: undefined };
          }
          const value = encoder.encode(chunks[index++]);
          return { done: false, value };
        },
      };
    },
  };
}

describe("streamOllama", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses JSON lines correctly", async () => {
    const chunks = [
      '{"message":{"content":"Hello"}}\n{"message":{"content":" world"}}\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const tokens = [];
    const result = await streamOllama(
      [{ role: "user", content: "hi" }],
      "test-model",
      "http://localhost:11434",
      (token) => tokens.push(token),
    );

    expect(tokens).toEqual(["Hello", " world"]);
    expect(result).toBe("Hello world");
  });

  it("throws on ollama error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(
      streamOllama([], "model", "http://localhost:11434", () => {}),
    ).rejects.toThrow("Ollama error: 500");
  });
});

describe("streamOpenAI", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses SSE data correctly", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\ndata: {"choices":[{"delta":{"content":" there"}}]}\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const tokens = [];
    const result = await streamOpenAI(
      [{ role: "user", content: "hello" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      (token) => tokens.push(token),
    );

    expect(tokens).toEqual(["Hi", " there"]);
    expect(result).toBe("Hi there");
  });

  it("handles [DONE] marker", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"done"}}]}\ndata: [DONE]\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const tokens = [];
    const result = await streamOpenAI(
      [],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      (token) => tokens.push(token),
    );

    expect(tokens).toEqual(["done"]);
    expect(result).toBe("done");
  });

  it("throws on openai error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(
      streamOpenAI(
        [],
        "gpt-4o",
        "https://api.openai.com/v1",
        "bad-key",
        () => {},
      ),
    ).rejects.toThrow("API error: 401");
  });
});

describe("chatStream", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("yields response-token events", async () => {
    const chunks = [
      '{"message":{"content":"A"}}\n{"message":{"content":"B"}}\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const events = [];
    for await (const event of chatStream([{ role: "user", content: "hi" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    const tokenEvents = events.filter((e) => e.type === "response-token");
    expect(tokenEvents.length).toBe(2);
    expect(tokenEvents[0].token).toBe("A");
    expect(tokenEvents[1].token).toBe("B");
  });

  it("yields response-complete event", async () => {
    const chunks = ['{"message":{"content":"Full response"}}\n'];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const events = [];
    for await (const event of chatStream([{ role: "user", content: "hi" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(event);
    }

    const completeEvent = events.find((e) => e.type === "response-complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.content).toBe("Full response");
  });

  it("requires API key for non-ollama providers", async () => {
    // No API key set in env
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const gen = chatStream([{ role: "user", content: "hi" }], {
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "http://localhost:11434",
    });

    await expect(gen.next()).rejects.toThrow("API key required");

    // Restore
    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });
});

describe("chatWithStreaming", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns full content", async () => {
    const chunks = [
      '{"message":{"content":"Hello"}}\n{"message":{"content":" world"}}\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const result = await chatWithStreaming([{ role: "user", content: "hi" }], {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
    });

    expect(result).toBe("Hello world");
  });

  it("calls onEvent callback", async () => {
    const chunks = ['{"message":{"content":"Token"}}\n'];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const events = [];
    await chatWithStreaming(
      [{ role: "user", content: "hi" }],
      {
        provider: "ollama",
        model: "test",
        baseUrl: "http://localhost:11434",
      },
      (event) => events.push(event),
    );

    expect(events.length).toBeGreaterThan(0);
    const types = events.map((e) => e.type);
    expect(types).toContain("response-token");
    expect(types).toContain("response-complete");
  });
});
