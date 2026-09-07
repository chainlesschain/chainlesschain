import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const managerModule = require("../../../src/main/llm/llm-manager.js");
const {
  registerCoreHandlers,
} = require("../../../src/main/llm/llm-ipc-core.js");
const {
  registerSelectorHandlers,
} = require("../../../src/main/llm/llm-ipc-selector.js");
const {
  createDesktopModelIngressHost,
  bindDesktopModelIngressClient,
  prepareDesktopModelRequest,
} = require("../../../src/main/evolution/desktop-model-ingress.js");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  managerModule._setLLMDepsForTesting(null);
  managerModule._setLLMManagerInstance(null);
});

describe("native IPC configuration authority continuity", () => {
  it("routes image blocks to the multimodal Run bridge instead of text projection", async () => {
    const factory = vi.fn(async () => ({}));
    const client = bindDesktopModelIngressClient(
      {},
      createDesktopModelIngressHost(factory),
    );

    await expect(
      prepareDesktopModelRequest(client, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,aGVsbG8=" },
              },
            ],
          },
        ],
        tools: [],
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0]).toMatchObject({
      mode: "desktop-multimodal-model",
    });
  });

  it("only exposes the bootstrap singleton to auxiliary model callers", () => {
    expect(() => managerModule.getLLMManager()).toThrow(
      "Desktop LLM manager has not been bootstrapped",
    );
    expect(() => managerModule.getGovernedLLMManagerInstance()).toThrow(
      "Governed Desktop LLM manager is unavailable",
    );
    const manager = new managerModule.LLMManager(
      { provider: "openai", enableStateBus: false },
      createDesktopModelIngressHost(async () => {
        throw new Error("not reached");
      }),
    );
    managerModule._setLLMManagerInstance(manager);
    expect(managerModule.getGovernedLLMManagerInstance()).toBe(manager);
  });

  it("rejects every opaque Volcengine tool method on a governed manager", async () => {
    const manager = new managerModule.LLMManager(
      { provider: "volcengine", enableStateBus: false },
      createDesktopModelIngressHost(async () => {
        throw new Error("not reached");
      }),
    );
    manager.toolsClient = {
      chatWithWebSearch: vi.fn(),
      chatWithImageProcess: vi.fn(),
      chatWithKnowledgeBase: vi.fn(),
      chatWithFunctionCalling: vi.fn(),
      chatWithMultipleTools: vi.fn(),
    };
    const calls = [
      () => manager.chatWithWebSearch([]),
      () => manager.chatWithImageProcess([]),
      () => manager.chatWithKnowledgeBase([], "knowledge-base"),
      () => manager.chatWithFunctionCalling([], []),
      () => manager.chatWithMultipleTools([], {}),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      });
    }
    Object.values(manager.toolsClient).forEach((method) =>
      expect(method).not.toHaveBeenCalled(),
    );
  });

  it("fails closed instead of using Volcengine's opaque MCP tool loop", async () => {
    const manager = new managerModule.LLMManager(
      {
        provider: "volcengine",
        model: "test",
        enableStateBus: false,
        enableManusOptimizations: false,
      },
      createDesktopModelIngressHost(async () => {
        throw new Error("not reached");
      }),
    );
    manager.isInitialized = true;
    manager.toolsClient = { executeFunctionCalling: vi.fn() };
    const Executor = require("../../../src/main/mcp/mcp-function-executor.js");
    vi.spyOn(Executor.prototype, "getFunctions").mockResolvedValue([
      { name: "lookup", parameters: { type: "object", properties: {} } },
    ]);
    const handlers = new Map();
    registerCoreHandlers({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      managerRef: { current: manager },
      mcpClientManager: { getConnectedServers: () => ["test"] },
      mcpToolAdapter: {},
      errorMonitor: { analyzeError: vi.fn() },
    });

    await expect(
      handlers.get("llm:chat")(
        {},
        {
          messages: [{ role: "user", content: "look this up" }],
          enableRAG: false,
          enableMultiAgent: false,
          enableSessionTracking: false,
          enableManusOptimization: false,
          enableErrorPrecheck: false,
        },
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(manager.toolsClient.executeFunctionCalling).not.toHaveBeenCalled();
  });

  it.each(["rag", "agent", "mcp-request", "mcp-execute"])(
    "keeps %s evidence refusal terminal at the IPC boundary",
    async (mode) => {
      const manager = new managerModule.LLMManager(
        {
          provider: "openai",
          model: "test",
          enableStateBus: false,
          enableManusOptimizations: false,
        },
        createDesktopModelIngressHost(async () => {
          throw new Error("routing fixture");
        }),
      );
      const refusal = Object.assign(
        new Error("timeout in evidence authority"),
        { code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" },
      );
      manager.chatWithMessages = vi.fn(async () => {
        if (mode === "mcp-request") throw refusal;
        return {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call-one", function: { name: "lookup", arguments: "{}" } },
            ],
          },
        };
      });
      const ragManager = {
        enhanceQuery: vi.fn(async () => {
          throw refusal;
        }),
      };
      manager.chatWithGovernedFunctions = vi.fn(
        async (_messages, _functions, executor) => {
          if (mode === "mcp-request") throw refusal;
          await executor.execute("lookup", {});
        },
      );
      const agentOrchestrator = {
        getCapableAgents: () => [{ agentId: "test", score: 1 }],
        dispatch: vi.fn(async () => {
          throw refusal;
        }),
      };
      const errorMonitor = { analyzeError: vi.fn() };
      const handlers = new Map();
      const ctx = {
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        managerRef: { current: manager },
        detectTaskType: () => "code",
        errorMonitor,
      };
      let execute;
      if (mode.startsWith("mcp")) {
        const Executor = require("../../../src/main/mcp/mcp-function-executor.js");
        vi.spyOn(Executor.prototype, "getFunctions").mockResolvedValue([
          { name: "lookup", parameters: { type: "object", properties: {} } },
        ]);
        execute = vi
          .spyOn(Executor.prototype, "execute")
          .mockRejectedValue(refusal);
        ctx.mcpClientManager = { getConnectedServers: () => ["test"] };
        ctx.mcpToolAdapter = {};
      }
      if (mode === "rag") ctx.ragManager = ragManager;
      if (mode === "agent") ctx.agentOrchestrator = agentOrchestrator;
      registerCoreHandlers(ctx);
      await expect(
        handlers.get("llm:chat")(
          {},
          {
            messages: [{ role: "user", content: "Inspect this project" }],
            enableRAG: mode === "rag",
            enableMultiAgent: mode === "agent",
            enableSessionTracking: false,
            enableManusOptimization: false,
            enableErrorPrecheck: false,
          },
        ),
      ).rejects.toBe(refusal);
      expect(manager.chatWithMessages).not.toHaveBeenCalled();
      expect(manager.chatWithGovernedFunctions).toHaveBeenCalledTimes(
        mode.startsWith("mcp") ? 1 : 0,
      );
      if (execute)
        expect(execute).toHaveBeenCalledTimes(mode === "mcp-execute" ? 1 : 0);
      expect(errorMonitor.analyzeError).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "does not bypass manager evidence through IPC cache/compression (denied=%s)",
    async (denied) => {
      const manager = new managerModule.LLMManager(
        {
          provider: "openai",
          model: "test",
          enableStateBus: false,
          enableManusOptimizations: false,
        },
        createDesktopModelIngressHost(async () => {
          throw new Error("not used by routing test");
        }),
      );
      const refusal = Object.assign(new Error("evidence refused"), {
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      });
      manager.chatWithMessages = vi.fn(async () => {
        if (denied) throw refusal;
        return {
          text: "verified cached result",
          wasCached: true,
          wasCompressed: true,
          compressionRatio: 0.5,
          tokensSaved: 12,
        };
      });
      const cache = {
        get: vi.fn(async () => ({
          hit: true,
          response: { text: "unverified" },
        })),
        set: vi.fn(),
      };
      const compressor = { compress: vi.fn() };
      const errorMonitor = { analyzeError: vi.fn() };
      const handlers = new Map();
      registerCoreHandlers({
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        managerRef: { current: manager },
        responseCache: cache,
        promptCompressor: compressor,
        errorMonitor,
      });
      const request = {
        messages: Array.from({ length: 6 }, (_, i) => ({
          role: "user",
          content: `message ${i}`,
        })),
        enableRAG: false,
        enableMultiAgent: false,
        enableSessionTracking: false,
        enableManusOptimization: false,
        enableErrorPrecheck: false,
      };
      const pending = handlers.get("llm:chat")({}, request);
      if (denied) await expect(pending).rejects.toBe(refusal);
      else
        await expect(pending).resolves.toMatchObject({
          content: "verified cached result",
          wasCached: true,
          wasCompressed: true,
          compressionRatio: 0.5,
          tokensSaved: 12,
        });
      expect(manager.chatWithMessages).toHaveBeenCalledOnce();
      expect(manager.chatWithMessages.mock.calls[0][1]).toMatchObject({
        skipCache: false,
        skipCompression: false,
      });
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
      expect(compressor.compress).not.toHaveBeenCalled();
      expect(errorMonitor.analyzeError).not.toHaveBeenCalled();
    },
  );

  it("does not revive a manager closed during provider initialization", async () => {
    const tracker = new EventEmitter();
    const manager = new managerModule.LLMManager({
      provider: "ollama",
      tokenTracker: tracker,
      enableStateBus: false,
      enableManusOptimizations: false,
    });
    manager.isInitialized = true;
    let release;
    const status = new Promise((resolve) => {
      release = resolve;
    });
    const closeClient = vi.fn();
    managerModule._setLLMDepsForTesting({
      OpenAIClient: class {
        async checkStatus() {
          return status;
        }
        async close() {
          closeClient();
        }
      },
    });
    const pending = manager.switchProvider("openai");
    await manager.close();
    release({ available: true, models: [] });
    await expect(pending).rejects.toThrow("closed during provider switch");
    expect(manager.client).toBe(null);
    expect(manager.isInitialized).toBe(false);
    expect(manager.provider).toBe("ollama");
    expect(closeClient).toHaveBeenCalledOnce();
    expect(tracker.listenerCount("budget-alert")).toBe(0);
  });

  it("closes only its own budget listener on a shared tracker", async () => {
    const tracker = new EventEmitter();
    const observer = vi.fn();
    tracker.on("budget-alert", observer);
    const config = {
      tokenTracker: tracker,
      enableStateBus: false,
      enableManusOptimizations: false,
    };
    const oldManager = new managerModule.LLMManager(config);
    const nextManager = new managerModule.LLMManager(config);
    expect(tracker.listenerCount("budget-alert")).toBe(3);
    await oldManager.close();
    expect(tracker.listenerCount("budget-alert")).toBe(2);
    await oldManager.close();
    expect(tracker.listenerCount("budget-alert")).toBe(2);
    await nextManager.close();
    expect(tracker.listeners("budget-alert")).toEqual([observer]);
  });

  it("stages provider switches without exposing mixed configuration or losing authority", async () => {
    const tracker = new EventEmitter();
    const source = vi.fn(async () => {
      throw new Error("original authority");
    });
    const previous = new managerModule.LLMManager(
      {
        provider: "ollama",
        model: "original",
        tokenTracker: tracker,
        enableStateBus: false,
        enableManusOptimizations: false,
      },
      createDesktopModelIngressHost(source),
    );
    const originalClient = { close: vi.fn() };
    previous.client = originalClient;
    previous.isInitialized = true;
    const originalConfig = previous.config;
    const changed = vi.fn();
    previous.on("provider-changed", changed);
    await expect(previous.switchProvider("invalid-provider")).rejects.toThrow();
    expect(previous.provider).toBe("ollama");
    expect(previous.config).toBe(originalConfig);
    expect(previous.client).toBe(originalClient);
    expect(previous.isInitialized).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    expect(tracker.listenerCount("budget-alert")).toBe(1);
    let release;
    const status = new Promise((resolve) => {
      release = resolve;
    });
    managerModule._setLLMDepsForTesting({
      OpenAIClient: class {
        async checkStatus() {
          return status;
        }
      },
    });
    const pending = previous.switchProvider("openai", { model: "updated" });
    try {
      expect(previous.provider).toBe("ollama");
      expect(previous.config).toBe(originalConfig);
      expect(previous.client).toBe(originalClient);
      await expect(previous.switchProvider("openai")).rejects.toThrow(
        "already in progress",
      );
      release({ available: true, models: [] });
      await expect(pending).resolves.toBe(true);
      expect(previous.provider).toBe("openai");
      expect(previous.config.model).toBe("updated");
      expect(previous.client).not.toBe(originalClient);
      expect(originalClient.close).not.toHaveBeenCalled();
      expect(tracker.listenerCount("budget-alert")).toBe(1);
      await expect(
        prepareDesktopModelRequest(previous.client, {
          messages: [{ role: "user", content: "hello" }],
        }),
      ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
      expect(source).toHaveBeenCalledOnce();
    } finally {
      release({ available: true, models: [] });
      await pending.catch(() => {});
      await previous.close();
    }
  });

  it.each([
    ["llm:set-config", false],
    ["llm:set-config", true],
    ["llm:switch-provider", false],
    ["llm:switch-provider", true],
  ])(
    "preserves host and references for %s (failure=%s)",
    async (channel, failure) => {
      vi.stubEnv("MOCK_LLM", "false");
      const source = vi.fn(async () => {
        throw new Error("original evidence authority reached");
      });
      const forged = vi.fn(async () => {
        throw new Error("forged authority reached");
      });
      const host = createDesktopModelIngressHost(source);
      const settings = {
        provider: "openai",
        model: "updated",
        enableManusOptimizations: false,
        enableStateBus: false,
        desktopModelIngressHost: createDesktopModelIngressHost(forged),
      };
      const storedConfig = {
        set: vi.fn(),
        setProvider: vi.fn(),
        save: vi.fn(),
        getManagerConfig: () => settings,
      };
      const previous = new managerModule.LLMManager(
        { ...settings, model: "original" },
        host,
      );
      previous.tokenTracker = { recordUsage: vi.fn(), on: vi.fn() };
      previous.responseCache = { getEvidenceReceipt: vi.fn() };
      previous.promptCompressor = { llmManager: previous };
      managerModule._setLLMManagerInstance(previous);
      managerModule._setLLMDepsForTesting({
        OpenAIClient: class {
          constructor() {
            if (failure) throw new Error("client initialization denied");
          }
          async checkStatus() {
            return { available: true, models: [] };
          }
        },
      });
      const handlers = new Map();
      const managerRef = { current: previous };
      const app = { llmManager: previous };
      const ctx = {
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        managerRef,
        app,
        database: {},
        getLLMConfig: () => storedConfig,
      };
      registerCoreHandlers(ctx);
      registerSelectorHandlers(ctx);
      const pending = handlers.get(channel)(
        {},
        channel === "llm:set-config" ? { model: "updated" } : "openai",
      );
      expect(managerRef.current).toBe(previous);
      if (failure) {
        await expect(pending).rejects.toThrow("client initialization denied");
        expect(managerRef.current).toBe(previous);
        expect(app.llmManager).toBe(previous);
        expect(managerModule.getLLMManager()).toBe(previous);
        expect(previous.promptCompressor.llmManager).toBe(previous);
      } else {
        await expect(pending).resolves.toBe(true);
        const next = managerRef.current;
        expect(next).not.toBe(previous);
        expect(next).toBeInstanceOf(managerModule.LLMManager);
        expect(app.llmManager).toBe(next);
        expect(managerModule.getLLMManager()).toBe(next);
        expect(next.responseCache).toBe(previous.responseCache);
        expect(next.tokenTracker).toBe(previous.tokenTracker);
        expect(next.promptCompressor).toBe(previous.promptCompressor);
        expect(next.promptCompressor.llmManager).toBe(next);
        await expect(
          prepareDesktopModelRequest(next.client, {
            messages: [{ role: "user", content: "hello" }],
          }),
        ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
        expect(source).toHaveBeenCalledOnce();
        expect(forged).not.toHaveBeenCalled();
      }
    },
  );
});

describe("native conversation agent-chat governance", () => {
  it("uses the single-Run function workflow instead of its legacy tool loop", async () => {
    const {
      registerConversationIPC,
    } = require("../../../src/main/conversation/conversation-ipc.js");
    const ipcGuard = require("../../../src/main/ipc/ipc-guard.js");
    ipcGuard.resetAll();
    const manager = new managerModule.LLMManager(
      {
        provider: "openai",
        model: "test",
        enableStateBus: false,
        enableManusOptimizations: false,
      },
      createDesktopModelIngressHost(async () => {
        throw new Error("conversation routing fixture");
      }),
    );
    const governed = vi.fn(async (_messages, functions, executor, options) => {
      expect(functions.length).toBeGreaterThan(0);
      expect(executor).toMatchObject({ execute: expect.any(Function) });
      expect(options.maxToolIterations).toBe(10);
      return { message: { role: "assistant", content: "governed answer" } };
    });
    manager.chatWithGovernedFunctions = governed;
    manager.chat = vi.fn();
    const handlers = new Map();
    const sent = [];
    registerConversationIPC({
      database: {},
      llmManager: manager,
      mainWindow: null,
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    });
    await expect(
      handlers.get("conversation:agent-chat")(
        { sender: { send: (...event) => sent.push(event) } },
        { conversationId: "conversation-1", userMessage: "inspect it" },
      ),
    ).resolves.toEqual({
      success: true,
      content: "governed answer",
      agentMode: true,
    });
    expect(governed).toHaveBeenCalledOnce();
    expect(manager.chat).not.toHaveBeenCalled();
    expect(sent).toContainEqual([
      "conversation:agent-response",
      { conversationId: "conversation-1", content: "governed answer" },
    ]);
    ipcGuard.resetAll();
  });
});

describe("native queryStream governance", () => {
  it("routes the complete prompt through chatWithMessagesStream", async () => {
    const manager = new managerModule.LLMManager(
      {
        provider: "ollama",
        model: "test",
        enableStateBus: false,
        enableManusOptimizations: false,
      },
      createDesktopModelIngressHost(async () => {
        throw new Error("query stream routing fixture");
      }),
    );
    manager.isInitialized = true;
    manager.conversationContext.set("conversation-1", {
      messages: [{ role: "assistant", content: "prior answer" }],
      context: ["opaque legacy token"],
    });
    const stream = vi.fn(async () => ({
      text: "streamed answer",
      message: { role: "assistant", content: "streamed answer" },
      model: "test",
      tokens: 3,
    }));
    manager.chatWithMessagesStream = stream;
    manager.client = { generateStream: vi.fn(), chatStream: vi.fn() };
    const completed = vi.fn();
    manager.on("stream-completed", completed);
    await expect(
      manager.queryStream("next question", vi.fn(), {
        conversationId: "conversation-1",
        systemPrompt: "governed system",
      }),
    ).resolves.toMatchObject({ text: "streamed answer" });
    expect(stream).toHaveBeenCalledWith(
      [
        { role: "system", content: "governed system" },
        { role: "assistant", content: "prior answer" },
        { role: "user", content: "next question" },
      ],
      expect.any(Function),
      expect.objectContaining({ conversationId: "conversation-1" }),
    );
    expect(manager.client.generateStream).not.toHaveBeenCalled();
    expect(manager.client.chatStream).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledOnce();
    expect(manager.getContext("conversation-1").messages).toEqual([
      { role: "assistant", content: "prior answer" },
      { role: "user", content: "next question" },
      { role: "assistant", content: "streamed answer" },
    ]);
  });

  it("routes non-streaming query through chatWithMessages", async () => {
    const manager = new managerModule.LLMManager(
      {
        provider: "ollama",
        model: "test",
        enableStateBus: false,
        enableManusOptimizations: false,
      },
      createDesktopModelIngressHost(async () => {
        throw new Error("query routing fixture");
      }),
    );
    manager.isInitialized = true;
    const chat = vi.fn(async () => ({
      text: "answer",
      message: { role: "assistant", content: "answer" },
      model: "test",
      tokens: 2,
    }));
    manager.chatWithMessages = chat;
    manager.client = { generate: vi.fn(), chat: vi.fn() };
    await expect(
      manager.query("question", { systemPrompt: "governed system" }),
    ).resolves.toMatchObject({ text: "answer" });
    expect(chat).toHaveBeenCalledWith(
      [
        { role: "system", content: "governed system" },
        { role: "user", content: "question" },
      ],
      expect.objectContaining({ systemPrompt: "governed system" }),
    );
    expect(manager.client.generate).not.toHaveBeenCalled();
    expect(manager.client.chat).not.toHaveBeenCalled();
  });
});

describe("native stream lifecycle governance", () => {
  it("opens model admission before the provider stream starts", async () => {
    const source = vi.fn(async () => {
      throw new Error("stream admission denied");
    });
    const host = createDesktopModelIngressHost(source);
    const manager = new managerModule.LLMManager(
      {
        provider: "openai",
        model: "test",
        enableStateBus: false,
        enableManusOptimizations: false,
      },
      host,
    );
    manager.isInitialized = true;
    const stream = vi.fn();
    manager.client = bindDesktopModelIngressClient(
      { chatStream: stream },
      host,
    );
    await expect(
      manager.chatWithMessagesStream(
        [{ role: "user", content: "admit this stream" }],
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(source).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
  });
});
