import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mocks above the SUT import — chat-core's stream* are the seam we
// stub so we can simulate token-by-token producers without real HTTP.
vi.mock("../../../../src/lib/chat-core.js", () => ({
  streamOllama: vi.fn(),
  streamOpenAI: vi.fn(),
  streamAnthropic: vi.fn(),
}));

import { handleLlmChat } from "../../../../src/gateways/ws/llm-chat-protocol.js";
import {
  streamOllama,
  streamOpenAI,
  streamAnthropic,
} from "../../../../src/lib/chat-core.js";

function makeServer({ session = null } = {}) {
  const sent = [];
  return {
    _send: (_ws, frame) => sent.push(frame),
    sessionManager: session
      ? { getSession: () => session }
      : { getSession: () => null },
    _sent: sent,
  };
}

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  // Strip any provider env vars that might leak in from the host shell so
  // tests asserting "no creds" stay deterministic.
  for (const k of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "VOLCENGINE_API_KEY",
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "GEMINI_API_KEY",
    "MOONSHOT_API_KEY",
    "MINIMAX_API_KEY",
    "MISTRAL_API_KEY",
  ]) {
    delete process.env[k];
  }
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe("handleLlmChat — frame protocol", () => {
  it("validation: empty messages → ok:false result frame", async () => {
    const server = makeServer();
    await handleLlmChat(server, "id-1", null, { id: "id-1", messages: [] });
    expect(server._sent).toEqual([
      {
        id: "id-1",
        type: "llm.chat.result",
        ok: false,
        error: "messages_required",
      },
    ]);
  });

  it("validation: malformed message shape → ok:false invalid_message_shape", async () => {
    const server = makeServer();
    await handleLlmChat(server, "id-2", null, {
      id: "id-2",
      messages: [{ role: "user" }], // missing content
    });
    expect(server._sent[0]).toMatchObject({
      ok: false,
      error: "invalid_message_shape",
    });
  });

  it("no creds → fail-fast with actionable error (no 60s hang)", async () => {
    const server = makeServer();
    await handleLlmChat(server, "id-3", null, {
      id: "id-3",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(server._sent).toHaveLength(1);
    expect(server._sent[0]).toMatchObject({
      type: "llm.chat.result",
      ok: false,
    });
    expect(server._sent[0].error).toMatch(/no_llm_provider_configured/);
    expect(streamOpenAI).not.toHaveBeenCalled();
  });

  it("explicit options.provider w/o apiKey for cloud → missing_api_key", async () => {
    const server = makeServer();
    await handleLlmChat(server, "id-mk", null, {
      id: "id-mk",
      messages: [{ role: "user", content: "hi" }],
      options: { provider: "volcengine" }, // no apiKey, no env var
    });
    expect(server._sent[0]).toMatchObject({
      type: "llm.chat.result",
      ok: false,
    });
    expect(server._sent[0].error).toMatch(/missing_api_key for volcengine/);
  });

  it("ollama path: no apiKey is OK; streams chunks then result frame", async () => {
    streamOllama.mockImplementation(
      async (_msgs, _model, _baseUrl, onToken, onUsage) => {
        onToken("hel");
        onToken("lo");
        onUsage({ inputTokens: 3, outputTokens: 2 });
        return "hello";
      },
    );
    const server = makeServer();
    await handleLlmChat(server, "id-ol", null, {
      id: "id-ol",
      messages: [{ role: "user", content: "hi" }],
      options: { provider: "ollama", model: "qwen2.5:7b" },
    });
    const sent = server._sent;
    expect(sent[0]).toEqual({
      id: "id-ol",
      type: "llm.chat.chunk",
      chunk: { delta: "hel", content: "hel" },
    });
    expect(sent[1]).toEqual({
      id: "id-ol",
      type: "llm.chat.chunk",
      chunk: { delta: "lo", content: "hello" },
    });
    expect(sent[2]).toMatchObject({
      type: "llm.chat.result",
      ok: true,
      result: {
        message: { role: "assistant", content: "hello" },
        model: "qwen2.5:7b",
        provider: "ollama",
        tokens: 2,
        promptTokens: 3,
      },
    });
  });

  it("openai-compat path (volcengine doubao): env var key + provider baseUrl", async () => {
    process.env.VOLCENGINE_API_KEY = "sk-test";
    streamOpenAI.mockImplementation(async (_m, _model, url, key, onToken) => {
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3");
      expect(key).toBe("sk-test");
      onToken("我是");
      onToken("豆包");
      return "我是豆包";
    });
    const server = makeServer();
    await handleLlmChat(server, "id-vo", null, {
      id: "id-vo",
      messages: [{ role: "user", content: "你是谁" }],
      // No explicit provider — env-fallback picks volcengine first.
    });
    expect(streamOpenAI).toHaveBeenCalledOnce();
    const result = server._sent.find((f) => f.type === "llm.chat.result");
    expect(result).toMatchObject({
      ok: true,
      result: {
        provider: "volcengine",
        message: { role: "assistant", content: "我是豆包" },
      },
    });
  });

  it("session creds preferred over env when explicit options absent", async () => {
    process.env.VOLCENGINE_API_KEY = "env-key";
    const session = {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      apiKey: "session-key",
    };
    streamAnthropic.mockImplementation(
      async (_m, _model, _url, key, onToken) => {
        expect(key).toBe("session-key");
        onToken("ok");
        return "ok";
      },
    );
    const server = makeServer({ session });
    await handleLlmChat(server, "id-ses", null, {
      id: "id-ses",
      sessionId: "S1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(streamAnthropic).toHaveBeenCalledOnce();
    expect(streamOpenAI).not.toHaveBeenCalled();
  });

  it("explicit options override session creds", async () => {
    const session = { provider: "anthropic", apiKey: "s" };
    process.env.OPENAI_API_KEY = "env-openai";
    streamOpenAI.mockImplementation(async (_m, _model, _url, key, onToken) => {
      expect(key).toBe("explicit");
      onToken("x");
      return "x";
    });
    const server = makeServer({ session });
    await handleLlmChat(server, "id-ov", null, {
      id: "id-ov",
      sessionId: "S1",
      messages: [{ role: "user", content: "hi" }],
      options: { provider: "openai", apiKey: "explicit", model: "gpt-4o-mini" },
    });
    expect(streamAnthropic).not.toHaveBeenCalled();
    expect(streamOpenAI).toHaveBeenCalledOnce();
  });

  it("provider exception surfaces as ok:false with error message", async () => {
    streamOllama.mockRejectedValueOnce(new Error("connection refused"));
    const server = makeServer();
    await handleLlmChat(server, "id-er", null, {
      id: "id-er",
      messages: [{ role: "user", content: "hi" }],
      options: { provider: "ollama" },
    });
    const result = server._sent.find((f) => f.type === "llm.chat.result");
    expect(result).toEqual({
      id: "id-er",
      type: "llm.chat.result",
      ok: false,
      error: "connection refused",
    });
  });

  it("empty token strings skipped; final accumulator stays clean", async () => {
    streamOllama.mockImplementation(async (_m, _model, _u, onToken) => {
      onToken("");
      onToken("a");
      onToken(undefined);
      onToken("b");
      return "ab";
    });
    const server = makeServer();
    await handleLlmChat(server, "id-sk", null, {
      id: "id-sk",
      messages: [{ role: "user", content: "hi" }],
      options: { provider: "ollama" },
    });
    const chunks = server._sent.filter((f) => f.type === "llm.chat.chunk");
    expect(chunks.map((c) => c.chunk.delta)).toEqual(["a", "b"]);
    expect(chunks[chunks.length - 1].chunk.content).toBe("ab");
  });
});
