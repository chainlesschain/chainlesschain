import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chat-core.js so the protocol doesn't actually hit any LLM. Use
// vi.hoisted so the fn exists when the vi.mock factory runs.
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock("../../../../src/lib/chat-core.js", () => ({
  chatWithStreaming: chatMock,
}));

import {
  handleChatIntentUnderstand,
  handleChatIntentClassifyFollowup,
} from "../../../../src/gateways/ws/chat-intent-protocol.js";

function makeFakeServer({ session = null } = {}) {
  return {
    _send: vi.fn(),
    sessionManager: session
      ? {
          getSession: vi.fn().mockReturnValue(session),
        }
      : null,
  };
}

const fakeWs = {};

describe("chat-intent-protocol — handleChatIntentUnderstand", () => {
  beforeEach(() => chatMock.mockReset());

  it("rejects empty userInput with BAD_REQUEST", async () => {
    const server = makeFakeServer();
    await handleChatIntentUnderstand(server, "req1", fakeWs, {
      userInput: "   ",
    });
    expect(server._send).toHaveBeenCalledTimes(1);
    const sent = server._send.mock.calls[0][1];
    expect(sent.type).toBe("error");
    expect(sent.code).toBe("BAD_REQUEST");
  });

  it("returns understand.response with success=false when no LLM creds available", async () => {
    // v5.0.3.45+ resolveLlmCreds also reads provider env vars (VOLCENGINE_API_KEY
    // etc.) so the intent flow works without `cc auth llm` for users who set
    // env. Strip them here so the "no creds anywhere" assertion stays valid.
    const ENV_KEYS = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "VOLCENGINE_API_KEY",
      "DEEPSEEK_API_KEY",
      "DASHSCOPE_API_KEY",
      "GEMINI_API_KEY",
      "MOONSHOT_API_KEY",
      "MINIMAX_API_KEY",
      "MISTRAL_API_KEY",
    ];
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    try {
      const server = makeFakeServer({ session: null });
      await handleChatIntentUnderstand(server, "req2", fakeWs, {
        userInput: "hello",
        contextMode: "project",
      });
      const sent = server._send.mock.calls[0][1];
      expect(sent.id).toBe("req2");
      expect(sent.type).toBe("chat.intent.understand.response");
      expect(sent.success).toBe(false);
      expect(sent.intent).toBe("general");
      expect(chatMock).not.toHaveBeenCalled();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });

  it("forwards LLM creds from session and emits parsed payload on success", async () => {
    const server = makeFakeServer({
      session: {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "sk-test",
      },
    });
    chatMock.mockResolvedValueOnce(
      '```json\n{"correctedInput":"a","intent":"do","keyPoints":["k"]}\n```',
    );
    await handleChatIntentUnderstand(server, "req3", fakeWs, {
      sessionId: "s1",
      userInput: "anything",
      contextMode: "project",
    });
    expect(server.sessionManager.getSession).toHaveBeenCalledWith("s1");
    const sent = server._send.mock.calls[0][1];
    expect(sent.type).toBe("chat.intent.understand.response");
    expect(sent.success).toBe(true);
    expect(sent.correctedInput).toBe("a");
    // The provider creds we pass should reach chatWithStreaming.
    const llmOpts = chatMock.mock.calls[0][1];
    expect(llmOpts.provider).toBe("anthropic");
    expect(llmOpts.model).toBe("claude-haiku-4-5-20251001");
    expect(llmOpts.apiKey).toBe("sk-test");
  });

  it("captures unexpected errors as INTENT_UNDERSTAND_FAILED", async () => {
    // resolveLlmOptions only touches sessionManager when sessionId is set —
    // include sessionId so the broken getter is actually exercised.
    const brokenServer = {
      _send: vi.fn(),
      get sessionManager() {
        throw new Error("boom-from-getter");
      },
    };
    await handleChatIntentUnderstand(brokenServer, "req4", fakeWs, {
      sessionId: "s-broken",
      userInput: "hi",
    });
    const sent = brokenServer._send.mock.calls[0][1];
    expect(sent.type).toBe("error");
    expect(sent.code).toBe("INTENT_UNDERSTAND_FAILED");
  });
});

describe("chat-intent-protocol — handleChatIntentClassifyFollowup", () => {
  beforeEach(() => chatMock.mockReset());

  it("returns rule-method when input is a high-confidence rule match", async () => {
    const server = makeFakeServer();
    await handleChatIntentClassifyFollowup(server, "req5", fakeWs, {
      input: "继续",
    });
    const sent = server._send.mock.calls[0][1];
    expect(sent.type).toBe("chat.intent.classify-followup.response");
    expect(sent.intent).toBe("CONTINUE_EXECUTION");
    expect(sent.method).toBe("rule");
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("invokes LLM with session creds for ambiguous inputs", async () => {
    const server = makeFakeServer({
      session: { provider: "ollama", model: "qwen2.5:7b", baseUrl: "x" },
    });
    chatMock.mockResolvedValueOnce(
      '```json\n{"intent":"MODIFY_REQUIREMENT","confidence":0.85,"reason":"r","extractedInfo":"info"}\n```',
    );
    await handleChatIntentClassifyFollowup(server, "req6", fakeWs, {
      sessionId: "s1",
      input: "嗯哼试试",
    });
    const sent = server._send.mock.calls[0][1];
    expect(sent.type).toBe("chat.intent.classify-followup.response");
    expect(sent.intent).toBe("MODIFY_REQUIREMENT");
    expect(sent.method).toBe("llm");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});
