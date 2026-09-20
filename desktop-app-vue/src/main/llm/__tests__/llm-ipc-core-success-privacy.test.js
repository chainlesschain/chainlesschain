import { beforeEach, describe, expect, it, vi } from "vitest";

const { registerCoreHandlers } = require("../llm-ipc-core");
const { projectModelResponse } = require("../llm-ipc-success-projection");

function request(overrides = {}) {
  return {
    messages: [{ role: "user", content: "hello" }],
    enableRAG: false,
    enableCache: false,
    enableCompression: false,
    enableSessionTracking: false,
    enableManusOptimization: false,
    enableMultiAgent: false,
    enableErrorPrecheck: false,
    ...overrides,
  };
}

function allowCoreAuthorization() {
  return { authorize: vi.fn(async () => Object.freeze({})) };
}

describe("LLM core IPC success privacy", () => {
  let handlers;
  let sent;
  let manager;

  beforeEach(() => {
    handlers = new Map();
    sent = vi.fn();
    manager = {
      provider: "openai",
      config: { model: "public-model" },
      checkStatus: vi.fn(async () => ({
        available: true,
        provider: "openai",
        models: [
          {
            id: "public-model",
            name: "Public model",
            size: 42,
            endpoint: "https://private.example.test",
          },
        ],
        endpoint: "https://private.example.test",
      })),
      query: vi.fn(async () => ({
        text: "query answer",
        model: "public-model",
        tokens: 7,
        usage: { total_tokens: 7, billingAccount: "private-account" },
        providerResponse: { secret: "private-provider-payload" },
      })),
      queryStream: vi.fn(async (_prompt, onChunk) => {
        onChunk("stream", "stream answer");
        return {
          text: "stream answer",
          tokens: 2,
          privateTrace: "private-stream-trace",
        };
      }),
      chatWithMessages: vi.fn(async () => ({
        text: "chat answer",
        message: {
          role: "assistant",
          content: "chat answer",
          tool_calls: [{ private: "private-tool-call" }],
        },
        usage: { total_tokens: 3, tenantCost: "private-cost" },
        promptOptimization: { privatePrompt: "private-optimized-prompt" },
        providerResponse: "private-chat-provider-response",
      })),
      listModels: vi.fn(async () => [
        "plain-model",
        {
          id: "object-model",
          name: "Object model",
          size: 9,
          privateConfig: "private-model-config",
        },
      ]),
      embeddings: vi.fn(async () => ({
        embedding: [0.25, -0.5],
        model: "embedding-model",
        usage: { total_tokens: 1, privateCost: "private-embedding-cost" },
        rawResponse: "private-embedding-response",
      })),
    };
    registerCoreHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      managerRef: { current: manager },
      detectTaskType: () => "general",
      isTestMode: true,
      mainWindow: { webContents: { send: sent } },
      coreAuthorization: allowCoreAuthorization(),
    });
  });

  it("projects status, query, stream, models, templates, and embeddings", async () => {
    const status = await handlers.get("llm:check-status")();
    const query = await handlers.get("llm:query")({}, "prompt", {});
    const stream = await handlers.get("llm:query-stream")({}, "prompt", {});
    const models = await handlers.get("llm:list-models")();
    const template = await handlers.get("llm:chat-with-template")(
      {},
      { templateId: "summarize", variables: { text: "public" } },
    );
    const embedding = await handlers.get("llm:embeddings")({}, "public");

    expect(status).toEqual({
      available: true,
      provider: "openai",
      models: [{ id: "public-model", name: "Public model", size: 42 }],
      error: null,
    });
    expect(query).toEqual({
      content: "query answer",
      message: { role: "assistant", content: "query answer" },
      text: "query answer",
      tokens: 7,
      usage: { total_tokens: 7 },
      model: "public-model",
    });
    expect(stream.content).toBe("stream answer");
    expect(sent).toHaveBeenCalledWith("llm:stream-chunk", {
      chunk: "stream",
      fullText: "stream answer",
    });
    expect(models).toEqual([
      "plain-model",
      { id: "object-model", name: "Object model", size: 9 },
    ]);
    expect(template.message).toEqual({
      role: "assistant",
      content: "chat answer",
    });
    expect(embedding).toEqual({
      embedding: [0.25, -0.5],
      usage: { total_tokens: 1 },
      model: "embedding-model",
    });
    expect(
      JSON.stringify({ status, query, stream, models, template, embedding }),
    ).not.toContain("private-");
  });

  it("removes provider message fields and prompt optimization payloads from chat", async () => {
    const result = await handlers.get("llm:chat")({}, request());

    expect(result).toMatchObject({
      content: "chat answer",
      message: { role: "assistant", content: "chat answer" },
      usage: { total_tokens: 3 },
      promptOptimized: true,
    });
    expect(result).not.toHaveProperty("promptOptimization");
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("does not return the arbitrary multi-agent result or agent identifier", async () => {
    const agentOrchestrator = {
      getCapableAgents: () => [
        { agentId: "private-agent-identifier", score: 1 },
      ],
      dispatch: vi.fn(async () => ({
        response: "agent answer",
        usage: { total_tokens: 4, privateCost: "private-agent-cost" },
        privateMemory: "private-agent-memory",
      })),
    };
    handlers = new Map();
    registerCoreHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      managerRef: { current: manager },
      detectTaskType: () => "general",
      agentOrchestrator,
      coreAuthorization: allowCoreAuthorization(),
    });

    const result = await handlers.get("llm:chat")(
      {},
      request({ enableMultiAgent: true }),
    );

    expect(result).toMatchObject({
      content: "agent answer",
      usage: { total_tokens: 4 },
      multiAgentRouted: true,
      agentUsed: true,
    });
    expect(result).not.toHaveProperty("agentResult");
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("projects cached provider responses before returning them", async () => {
    const responseCache = {
      get: vi.fn(async () => ({
        hit: true,
        response: {
          text: "cached answer",
          message: {
            role: "assistant",
            content: "cached answer",
            providerPayload: "private-cached-message",
          },
          usage: { total_tokens: 6, privateCost: "private-cached-cost" },
          raw: "private-cached-response",
        },
        tokensSaved: 8,
        cacheAge: 10,
      })),
    };
    handlers = new Map();
    registerCoreHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      managerRef: { current: manager },
      detectTaskType: () => "general",
      responseCache,
      coreAuthorization: allowCoreAuthorization(),
    });

    const result = await handlers.get("llm:chat")(
      {},
      request({ enableCache: true }),
    );

    expect(result).toEqual({
      content: "cached answer",
      message: { role: "assistant", content: "cached answer" },
      usage: { total_tokens: 6 },
      wasCached: true,
      tokensSaved: 8,
      cacheAge: 10,
      retrievedDocs: [],
    });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(manager.chatWithMessages).not.toHaveBeenCalled();
  });

  it("ignores accessors and proxies instead of expanding them", () => {
    const accessor = vi.fn(() => "private-accessor");
    const response = {};
    Object.defineProperty(response, "text", {
      enumerable: true,
      get: accessor,
    });
    Object.defineProperty(response, "usage", {
      enumerable: true,
      value: new Proxy(
        { total_tokens: 99, secret: "private-proxy" },
        { get: () => "private-proxy" },
      ),
    });

    expect(projectModelResponse(response)).toEqual({
      content: "",
      message: { role: "assistant", content: "" },
      text: "",
      tokens: 0,
      usage: { total_tokens: 0 },
    });
    expect(accessor).not.toHaveBeenCalled();
  });
});
