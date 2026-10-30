import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/lib/llm-providers.js", async (importOriginal) => ({
  ...(await importOriginal()),
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
    anthropic: {
      name: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    },
    gemini: {
      name: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKeyEnv: "GEMINI_API_KEY",
    },
  },
}));

const {
  chatStream,
  chatWithStreaming,
  streamOllama,
  streamOpenAI,
  streamGemini,
} = await import("../../src/lib/chat-core.js");

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
      "http://localhost:11434/v1/",
      (token) => tokens.push(token),
    );

    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "http://localhost:11434/api/chat",
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
      "https://api.openai.com/v1/",
      "sk-test",
      (token) => tokens.push(token),
    );

    expect(tokens).toEqual(["Hi", " there"]);
    expect(result).toBe("Hi there");
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
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

describe("streamGemini", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses Gemini's native streaming protocol, filters thoughts, and records usage", async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"private"},{"text":"Hi"}]}}]}\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2,"thoughtsTokenCount":1,"cachedContentTokenCount":3}}\n\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });
    const tokens = [];
    const usage = [];
    const result = await streamGemini(
      [
        { role: "system", content: "Follow the system rule" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "previous reply" },
      ],
      "gemini-2.0-flash",
      "https://generativelanguage.googleapis.com/v1beta/",
      "secret",
      (token) => tokens.push(token),
      (value) => usage.push(value),
      undefined,
      { requireCompletion: true },
    );
    const [url, request] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
    expect(request.headers["x-goog-api-key"]).toBe("secret");
    expect(url).not.toContain("secret");
    expect(JSON.parse(request.body)).toMatchObject({
      systemInstruction: { parts: [{ text: "Follow the system rule" }] },
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "previous reply" }] },
      ],
    });
    expect(tokens).toEqual(["Hi", " there"]);
    expect(result).toBe("Hi there");
    expect(usage).toEqual([
      { inputTokens: 4, outputTokens: 3, cacheReadTokens: 3 },
    ]);
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

  it("dispatches Gemini through the native generateContent stream", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]},"finishReason":"STOP"}]}\n',
      ]),
    });
    const events = [];
    for await (const event of chatStream([{ role: "user", content: "hi" }], {
      provider: "gemini",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
      apiKey: "test-key",
    })) {
      events.push(event);
    }
    expect(globalThis.fetch.mock.calls[0][0]).toContain(
      "/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
    expect(events.at(-1)).toMatchObject({
      type: "response-complete",
      content: "Gemini",
    });
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
