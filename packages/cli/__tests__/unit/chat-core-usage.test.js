import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cli-chat-usage-"));
  vi.resetModules();
  vi.doMock("../../src/lib/paths.js", () => ({
    getHomeDir: () => tmpHome,
    getBinDir: () => path.join(tmpHome, "bin"),
    getConfigPath: () => path.join(tmpHome, "config.json"),
    getStatePath: () => path.join(tmpHome, "state"),
    getPidFilePath: () => path.join(tmpHome, "state", "app.pid"),
    getServicesDir: () => path.join(tmpHome, "services"),
  }));
  vi.doMock("../../src/lib/llm-providers.js", () => ({
    BUILT_IN_PROVIDERS: {
      ollama: {
        name: "ollama",
        baseUrl: "http://localhost:11434",
        apiKeyEnv: null,
      },
      openai: {
        name: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      anthropic: {
        name: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKeyEnv: "ANTHROPIC_API_KEY",
      },
    },
  }));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.doUnmock("../../src/lib/paths.js");
  vi.doUnmock("../../src/lib/llm-providers.js");
});

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

describe("chat-core — onUsage callback", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("streamOllama emits usage from terminal done chunk", async () => {
    const { streamOllama } = await import("../../src/lib/chat-core.js");
    const chunks = [
      '{"message":{"content":"Hi"}}\n',
      '{"done":true,"prompt_eval_count":12,"eval_count":34}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const usages = [];
    await streamOllama(
      [{ role: "user", content: "hi" }],
      "m",
      "http://localhost:11434",
      () => {},
      (u) => usages.push(u),
    );
    expect(usages).toEqual([{ inputTokens: 12, outputTokens: 34 }]);
  });

  it("streamOllama skips onUsage when counts are zero", async () => {
    const { streamOllama } = await import("../../src/lib/chat-core.js");
    const chunks = ['{"done":true,"prompt_eval_count":0,"eval_count":0}\n'];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });
    const usages = [];
    await streamOllama(
      [],
      "m",
      "http://localhost:11434",
      () => {},
      (u) => usages.push(u),
    );
    expect(usages).toEqual([]);
  });

  it("streamOpenAI emits usage from terminal chunk", async () => {
    const { streamOpenAI } = await import("../../src/lib/chat-core.js");
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12}}\n',
      "data: [DONE]\n",
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const usages = [];
    await streamOpenAI(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      () => {},
      (u) => usages.push(u),
    );
    expect(usages).toEqual([{ inputTokens: 7, outputTokens: 5 }]);
  });

  it("streamOpenAI sends stream_options.include_usage in body", async () => {
    const { streamOpenAI } = await import("../../src/lib/chat-core.js");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(["data: [DONE]\n"]),
    });
    globalThis.fetch = fetchSpy;
    await streamOpenAI(
      [{ role: "user", content: "hi" }],
      "gpt-4o",
      "https://api.openai.com/v1",
      "sk-test",
      () => {},
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("chatStream auto-records token_usage to JSONL when sessionId given", async () => {
    const { chatStream } = await import("../../src/lib/chat-core.js");
    const { sessionPath, startSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const sid = startSession(null, { title: "chat-usage" });

    const chunks = [
      '{"message":{"content":"Hi"}}\n',
      '{"done":true,"prompt_eval_count":100,"eval_count":50}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const events = [];
    for await (const ev of chatStream([{ role: "user", content: "hi" }], {
      provider: "ollama",
      model: "qwen2:7b",
      baseUrl: "http://localhost:11434",
      sessionId: sid,
    })) {
      events.push(ev);
    }

    const lines = fs
      .readFileSync(sessionPath(sid), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const tokenUsageEvents = lines.filter((e) => e.type === "token_usage");
    expect(tokenUsageEvents).toHaveLength(1);
    expect(tokenUsageEvents[0].data).toMatchObject({
      provider: "ollama",
      model: "qwen2:7b",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });

  it("streamAnthropic emits content and usage from SSE events", async () => {
    const { streamAnthropic } = await import("../../src/lib/chat-core.js");
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":42,"output_tokens":1}}}\n',
      'data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n',
      'data: {"type":"content_block_delta","delta":{"text":" there"}}\n',
      'data: {"type":"message_delta","usage":{"output_tokens":23}}\n',
      'data: {"type":"message_stop"}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });

    const tokens = [];
    const usages = [];
    const text = await streamAnthropic(
      [
        { role: "system", content: "You are X" },
        { role: "user", content: "hi" },
      ],
      "claude-opus-4-6",
      "https://api.anthropic.com/v1",
      "sk-ant-test",
      (t) => tokens.push(t),
      (u) => usages.push(u),
    );
    expect(text).toBe("Hi there");
    expect(tokens).toEqual(["Hi", " there"]);
    expect(usages).toEqual([{ inputTokens: 42, outputTokens: 23 }]);
  });

  it("streamAnthropic splits system role into top-level system field", async () => {
    const { streamAnthropic } = await import("../../src/lib/chat-core.js");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream([]),
    });
    globalThis.fetch = fetchSpy;
    await streamAnthropic(
      [
        { role: "system", content: "sys prompt" },
        { role: "user", content: "hi" },
      ],
      "claude-opus-4-6",
      "https://api.anthropic.com/v1",
      "sk-ant-test",
      () => {},
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.system).toBe("sys prompt");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("chatStream routes anthropic provider + auto-records usage", async () => {
    const { chatStream } = await import("../../src/lib/chat-core.js");
    const { sessionPath, startSession } =
      await import("../../src/harness/jsonl-session-store.js");
    const sid = startSession(null, {});
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}\n',
      'data: {"type":"content_block_delta","delta":{"text":"ok"}}\n',
      'data: {"type":"message_delta","usage":{"output_tokens":9}}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });
    for await (const _ev of chatStream([{ role: "user", content: "hi" }], {
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "sk-ant-test",
      sessionId: sid,
    })) {
      /* drain */
    }
    const lines = fs
      .readFileSync(sessionPath(sid), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const tokenUsage = lines.filter((e) => e.type === "token_usage");
    expect(tokenUsage).toHaveLength(1);
    expect(tokenUsage[0].data).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-6",
      usage: { input_tokens: 11, output_tokens: 9 },
    });
  });

  it("chatStream anthropic requires API key", async () => {
    const { chatStream } = await import("../../src/lib/chat-core.js");
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const gen = chatStream([{ role: "user", content: "hi" }], {
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    await expect(gen.next()).rejects.toThrow("API key required");
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("chatStream skips autorecord when sessionId is absent", async () => {
    const { chatStream } = await import("../../src/lib/chat-core.js");
    const chunks = [
      '{"message":{"content":"x"}}\n',
      '{"done":true,"prompt_eval_count":5,"eval_count":3}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeReadableStream(chunks),
    });
    const events = [];
    for await (const ev of chatStream([{ role: "user", content: "hi" }], {
      provider: "ollama",
      model: "m",
      baseUrl: "http://localhost:11434",
    })) {
      events.push(ev);
    }
    // Directory may not exist at all — no autorecord happened
    const sessionsDir = path.join(tmpHome, "sessions");
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir);
      expect(files).toEqual([]);
    }
  });
});
