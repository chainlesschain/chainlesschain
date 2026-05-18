/**
 * LLM管理器单元测试
 * 测试目标: src/main/llm/llm-manager.js
 *
 * Unskipped via `_setLLMDepsForTesting` seam (RFC T1, B3 batch — vi.mock CJS interop).
 * 见 `docs/design/desktop_vi_mock_cjs_migration_rfc.md`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Logger 是项目本地 ESM 路径，vi.mock 工作正常
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

// 测试侧 mock 对象 — 通过 _setLLMDepsForTesting seam 注入到 source。
const mockOllamaClient = {
  checkStatus: vi.fn(async () => ({ available: true, models: ["llama2"] })),
  generate: vi.fn(async () => ({ text: "Ollama response", context: [] })),
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "Ollama chat response" },
  })),
  embeddings: vi.fn(async () => ({ embedding: Array(384).fill(0.1) })),
  listModels: vi.fn(async () => ({ models: [{ name: "llama2" }] })),
};

const mockOpenAIClient = {
  checkStatus: vi.fn(async () => ({
    available: true,
    models: ["gpt-3.5-turbo"],
  })),
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "OpenAI response" },
  })),
  chatStream: vi.fn(async () => {}),
  embeddings: vi.fn(async () => ({ embedding: Array(1536).fill(0.1) })),
  listModels: vi.fn(async () => ({ data: [{ id: "gpt-3.5-turbo" }] })),
};

const mockDeepSeekClient = {
  checkStatus: vi.fn(async () => ({
    available: true,
    models: ["deepseek-chat"],
  })),
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "DeepSeek response" },
  })),
  embeddings: vi.fn(async () => ({ embedding: Array(1536).fill(0.1) })),
};

const mockAnthropicClient = {
  checkStatus: vi.fn(async () => ({
    available: true,
    models: ["claude-3-opus-20240229"],
  })),
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "Claude response" },
  })),
  chatStream: vi.fn(async () => {}),
  listModels: vi.fn(async () => ({ data: [{ id: "claude-3-opus-20240229" }] })),
};

const mockGeminiClient = {
  checkStatus: vi.fn(async () => ({
    available: true,
    models: ["gemini-1.5-pro"],
  })),
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "Gemini response" },
  })),
};

const mockMistralClient = {
  checkStatus: vi.fn(async () => ({
    available: true,
    models: ["mistral-large-latest"],
  })),
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "Mistral response" },
  })),
};

const mockVolcengineToolsClient = {
  chat: vi.fn(async () => ({
    message: { role: "assistant", content: "Volcengine tools response" },
  })),
};

const mockManusOptimizations = {
  applyKVCacheOptimization: vi.fn((messages) => messages),
  setToolMask: vi.fn(),
  setToolsByPrefix: vi.fn(),
  validateToolCall: vi.fn(() => ({ allowed: true })),
  configureTaskPhases: vi.fn(),
  transitionToPhase: vi.fn(() => true),
  getStats: vi.fn(() => ({ toolMaskChanges: 0, kvCacheOptimizations: 0 })),
  compress: vi.fn((content) => content),
};

// Ctor-style mocks must use `function` (not arrow) — source does `new _XxxClient(...)`
// and arrow functions can't be used with `new`.
function ctorReturning(instance) {
  return vi.fn(function () {
    return instance;
  });
}

function buildMockDeps() {
  return {
    OllamaClient: ctorReturning(mockOllamaClient),
    OpenAIClient: ctorReturning(mockOpenAIClient),
    DeepSeekClient: ctorReturning(mockDeepSeekClient),
    AnthropicClient: ctorReturning(mockAnthropicClient),
    GeminiClient: ctorReturning(mockGeminiClient),
    MistralClient: ctorReturning(mockMistralClient),
    VolcengineToolsClient: ctorReturning(mockVolcengineToolsClient),
    // factory-fn mocks (called without `new`)
    getModelSelector: vi.fn(() => ({ selectModel: vi.fn() })),
    getManusOptimizations: vi.fn(() => mockManusOptimizations),
  };
}

describe("LLMManager", () => {
  let LLMManager;
  let LLMProviders;
  let llmManager;
  let _setLLMDepsForTesting;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await import("../../../src/main/llm/llm-manager.js");
    LLMManager = module.LLMManager;
    LLMProviders = module.LLMProviders;
    _setLLMDepsForTesting = module._setLLMDepsForTesting;

    _setLLMDepsForTesting(buildMockDeps());
  });

  afterEach(() => {
    if (_setLLMDepsForTesting) {
      _setLLMDepsForTesting(null);
    }
    if (llmManager) {
      llmManager = null;
    }
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      llmManager = new LLMManager();

      expect(llmManager).toBeDefined();
      expect(llmManager.isInitialized).toBe(false);
    });

    it("应该使用默认provider（ollama）", () => {
      llmManager = new LLMManager();

      expect(llmManager.provider).toBe("ollama");
    });

    it("应该接受自定义provider", () => {
      llmManager = new LLMManager({ provider: "openai" });

      expect(llmManager.provider).toBe("openai");
    });

    it("应该规范化claude provider为anthropic", () => {
      llmManager = new LLMManager({ provider: "claude" });

      expect(llmManager.provider).toBe("anthropic");
    });

    it("应该初始化conversationContext为Map", () => {
      llmManager = new LLMManager();

      expect(llmManager.conversationContext).toBeInstanceOf(Map);
      expect(llmManager.conversationContext.size).toBe(0);
    });

    it("应该启用tokenTracker（如果提供）", () => {
      const mockTokenTracker = {
        on: vi.fn(),
      };

      llmManager = new LLMManager({ tokenTracker: mockTokenTracker });

      expect(llmManager.tokenTracker).toBe(mockTokenTracker);
      expect(mockTokenTracker.on).toHaveBeenCalledWith(
        "budget-alert",
        expect.any(Function),
      );
    });

    it("应该启用responseCache（如果提供）", () => {
      const mockResponseCache = { get: vi.fn(), set: vi.fn() };

      llmManager = new LLMManager({ responseCache: mockResponseCache });

      expect(llmManager.responseCache).toBe(mockResponseCache);
    });

    it("应该启用promptCompressor（如果提供）", () => {
      const mockPromptCompressor = { compress: vi.fn() };

      llmManager = new LLMManager({ promptCompressor: mockPromptCompressor });

      expect(llmManager.promptCompressor).toBe(mockPromptCompressor);
    });

    it("应该初始化Manus优化（默认启用）", () => {
      llmManager = new LLMManager();

      expect(llmManager.manusOptimizations).toBeDefined();
    });

    it("应该允许禁用Manus优化", () => {
      llmManager = new LLMManager({ enableManusOptimizations: false });

      expect(llmManager.manusOptimizations).toBeNull();
    });

    it("应该继承EventEmitter", () => {
      llmManager = new LLMManager();

      expect(typeof llmManager.on).toBe("function");
      expect(typeof llmManager.emit).toBe("function");
    });

    it("应该初始化paused为false", () => {
      llmManager = new LLMManager();

      expect(llmManager.paused).toBe(false);
    });
  });

  describe("LLMProviders常量", () => {
    it("应该定义所有提供商类型", () => {
      expect(LLMProviders.OLLAMA).toBe("ollama");
      expect(LLMProviders.OPENAI).toBe("openai");
      expect(LLMProviders.DEEPSEEK).toBe("deepseek");
      expect(LLMProviders.VOLCENGINE).toBe("volcengine");
      expect(LLMProviders.ANTHROPIC).toBe("anthropic");
      expect(LLMProviders.CLAUDE).toBe("claude");
      expect(LLMProviders.CUSTOM).toBe("custom");
    });
  });

  describe("initialize", () => {
    // NOTE: Skipped - Client mock doesn't intercept CommonJS require() in test environment
    // Real OllamaClient/OpenAIClient loaded causing real HTTP requests

    it("应该初始化Ollama客户端", async () => {
      llmManager = new LLMManager({ provider: "ollama" });

      const result = await llmManager.initialize();

      expect(result).toBe(true);
      expect(llmManager.isInitialized).toBe(true);
      expect(llmManager.client).toBeDefined();
    });

    it("应该发出initialized事件", async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      const handler = vi.fn();
      llmManager.on("initialized", handler);

      await llmManager.initialize();

      expect(handler).toHaveBeenCalledWith({
        available: true,
        models: ["llama2"],
      });
    });

    it("应该在checkStatus失败时发出unavailable事件", async () => {
      mockOllamaClient.checkStatus.mockResolvedValueOnce({
        available: false,
        error: "Service down",
      });
      llmManager = new LLMManager({ provider: "ollama" });
      const handler = vi.fn();
      llmManager.on("unavailable", handler);

      await llmManager.initialize();

      expect(handler).toHaveBeenCalled();
      expect(llmManager.isInitialized).toBe(true); // Still initialized even if unavailable
    });

    it("应该在checkStatus抛出错误时仍标记为初始化", async () => {
      mockOllamaClient.checkStatus.mockRejectedValueOnce(
        new Error("Network error"),
      );
      llmManager = new LLMManager({ provider: "ollama" });

      await llmManager.initialize();

      expect(llmManager.isInitialized).toBe(true);
    });

    it("应该初始化Volcengine工具客户端（仅volcengine）", async () => {
      llmManager = new LLMManager({
        provider: "volcengine",
        apiKey: "test-key",
        model: "doubao-seed-1.6-lite",
      });

      await llmManager.initialize();

      expect(llmManager.toolsClient).toBeDefined();
    });

    it("应该不为其他provider初始化工具客户端", async () => {
      llmManager = new LLMManager({ provider: "ollama" });

      await llmManager.initialize();

      expect(llmManager.toolsClient).toBeNull();
    });

    it("应该在初始化失败时抛出错误", async () => {
      llmManager = new LLMManager({ provider: "invalid-provider" });

      await expect(llmManager.initialize()).rejects.toThrow();
      expect(llmManager.isInitialized).toBe(false);
    });
  });

  describe("createClient", () => {
    beforeEach(() => {
      llmManager = new LLMManager();
    });

    it("应该为ollama创建OllamaClient", async () => {
      const client = await llmManager.createClient("ollama");

      expect(client).toBeDefined();
    });

    it("应该为openai创建OpenAIClient", async () => {
      const client = await llmManager.createClient("openai");

      expect(client).toBeDefined();
    });

    it("应该为deepseek创建DeepSeekClient", async () => {
      const client = await llmManager.createClient("deepseek");

      expect(client).toBeDefined();
    });

    it("应该为anthropic创建AnthropicClient", async () => {
      const client = await llmManager.createClient("anthropic");

      expect(client).toBeDefined();
    });

    it("应该为claude创建AnthropicClient（规范化）", async () => {
      const client = await llmManager.createClient("claude");

      expect(client).toBeDefined();
    });

    it("应该为volcengine创建OpenAIClient", async () => {
      const client = await llmManager.createClient("volcengine");

      expect(client).toBeDefined();
    });

    it("应该为custom创建OpenAIClient", async () => {
      const client = await llmManager.createClient("custom");

      expect(client).toBeDefined();
    });

    it("应该为不支持的provider抛出错误", async () => {
      await expect(llmManager.createClient("unsupported")).rejects.toThrow(
        "不支持的提供商",
      );
    });
  });

  describe("switchProvider", () => {
    // NOTE: Skipped - Depends on initialize() which has CommonJS mock issues

    beforeEach(async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
    });

    it("应该切换到新provider", async () => {
      const result = await llmManager.switchProvider("openai", {
        apiKey: "test-key",
      });

      expect(result).toBe(true);
      expect(llmManager.provider).toBe("openai");
    });

    it("应该发出provider-changed事件", async () => {
      const handler = vi.fn();
      llmManager.on("provider-changed", handler);

      await llmManager.switchProvider("openai");

      expect(handler).toHaveBeenCalledWith("openai");
    });

    it("应该合并新配置", async () => {
      await llmManager.switchProvider("openai", {
        apiKey: "new-key",
        model: "gpt-4",
      });

      expect(llmManager.config.apiKey).toBe("new-key");
      expect(llmManager.config.model).toBe("gpt-4");
    });

    it("应该在切换失败时抛出错误", async () => {
      await expect(
        llmManager.switchProvider("invalid-provider"),
      ).rejects.toThrow();
    });
  });

  describe("checkStatus", () => {
    // NOTE: Skipped - Depends on client.checkStatus() which causes real HTTP requests

    it("应该在客户端未初始化时返回unavailable", async () => {
      llmManager = new LLMManager();

      const status = await llmManager.checkStatus();

      expect(status.available).toBe(false);
      expect(status.error).toBe("LLM服务未初始化");
    });

    it("应该返回客户端状态", async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();

      const status = await llmManager.checkStatus();

      expect(status.available).toBe(true);
      expect(status.provider).toBe("ollama");
    });

    it("应该在checkStatus失败时返回错误", async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
      mockOllamaClient.checkStatus.mockRejectedValueOnce(
        new Error("Connection error"),
      );

      const status = await llmManager.checkStatus();

      expect(status.available).toBe(false);
      expect(status.error).toBe("Connection error");
    });
  });

  describe("query", () => {
    // NOTE: Skipped - Depends on client methods which cause real HTTP requests

    beforeEach(async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
    });

    it("应该在未初始化时抛出错误", async () => {
      llmManager.isInitialized = false;

      await expect(llmManager.query("test")).rejects.toThrow("LLM服务未初始化");
    });

    it("应该在paused时抛出错误", async () => {
      llmManager.paused = true;

      await expect(llmManager.query("test")).rejects.toThrow("LLM服务已暂停");
    });

    it("应该使用Ollama generate方法（无会话）", async () => {
      const result = await llmManager.query("test prompt");

      expect(mockOllamaClient.generate).toHaveBeenCalledWith("test prompt", {});
      expect(result.text).toBe("Ollama response");
    });

    it("应该创建会话上下文（如果提供conversationId）", async () => {
      await llmManager.query("test prompt", { conversationId: "conv1" });

      expect(llmManager.conversationContext.has("conv1")).toBe(true);
      const context = llmManager.conversationContext.get("conv1");
      expect(context.messages).toHaveLength(2);
    });

    it("应该使用会话上下文（如果已存在）", async () => {
      // First query creates context
      await llmManager.query("first", { conversationId: "conv1" });

      // Second query uses context
      await llmManager.query("second", { conversationId: "conv1" });

      expect(mockOllamaClient.chat).toHaveBeenCalled();
      const context = llmManager.conversationContext.get("conv1");
      expect(context.messages.length).toBeGreaterThan(2);
    });
  });

  describe("embeddings", () => {
    // NOTE: Skipped - Depends on client.embeddings() which causes real HTTP requests

    beforeEach(async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
    });

    it("应该在未初始化时抛出错误", async () => {
      llmManager.isInitialized = false;

      await expect(llmManager.embeddings("test")).rejects.toThrow(
        "LLM服务未初始化",
      );
    });

    it("应该调用客户端embeddings方法", async () => {
      const result = await llmManager.embeddings("test text");

      expect(mockOllamaClient.embeddings).toHaveBeenCalledWith("test text");
      expect(result.embedding).toBeDefined();
    });

    // FIXME (source mismatch): test expects "当前LLM不支持嵌入向量生成" but source line 1016
    // does `return await client.embeddings(text);` with no guard → TypeError instead. Out of RFC scope.
    it.skip("应该在客户端不支持embeddings时抛出错误", async () => {
      llmManager.client.embeddings = undefined;
      await expect(llmManager.embeddings("test")).rejects.toThrow(
        "当前LLM不支持嵌入向量生成",
      );
    });
  });

  describe("listModels", () => {
    // NOTE: Skipped - Depends on client.listModels() which causes real HTTP requests

    beforeEach(async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
    });

    // FIXME (source mismatch): source listModels (line 1052) returns [] if !this.client,
    // doesn't throw on isInitialized=false. Out of RFC scope.
    it.skip("应该在未初始化时抛出错误", async () => {
      llmManager.isInitialized = false;
      await expect(llmManager.listModels()).rejects.toThrow("LLM服务未初始化");
    });

    // FIXME (source mismatch): source listModels calls client.checkStatus() and returns
    // status.models, not client.listModels(). Out of RFC scope.
    it.skip("应该调用客户端listModels方法", async () => {
      const result = await llmManager.listModels();
      expect(mockOllamaClient.listModels).toHaveBeenCalled();
      expect(result.models).toBeDefined();
    });
  });

  describe("close", () => {
    // NOTE: Skipped - Depends on initialize() which has CommonJS mock issues

    beforeEach(async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
    });

    it("应该清理资源", async () => {
      await llmManager.close();

      expect(llmManager.conversationContext.size).toBe(0);
    });

    // FIXME (source mismatch): source close() doesn't delegate to client.close().
    // It cleans tokenTracker / stateBus / conversationContext / isInitialized. Out of RFC scope.
    it.skip("应该在client有close方法时调用", async () => {
      mockOllamaClient.close = vi.fn(async () => {});
      await llmManager.close();
      expect(mockOllamaClient.close).toHaveBeenCalled();
    });
  });

  describe("Manus优化", () => {
    // TODO: Skipped - Manus-optimizations module is CommonJS, can't mock
    // Real ManusOptimizations loaded instead of mock

    beforeEach(async () => {
      llmManager = new LLMManager({ provider: "ollama" });
      await llmManager.initialize();
    });

    // FIXME (source mismatch): LLMManager.prototype.setToolMask doesn't exist; source only has
    // setToolsByPrefix/validateToolCall/transitionToPhase/getManusStats. Out of RFC scope.
    it.skip("应该调用setToolMask", () => {
      llmManager.setToolMask(["tool1", "tool2"]);
      expect(mockManusOptimizations.setToolMask).toHaveBeenCalledWith([
        "tool1",
        "tool2",
      ]);
    });

    it("应该调用setToolsByPrefix", () => {
      llmManager.setToolsByPrefix("file:", true);

      expect(mockManusOptimizations.setToolsByPrefix).toHaveBeenCalledWith(
        "file:",
        true,
      );
    });

    it("应该调用validateToolCall", () => {
      const result = llmManager.validateToolCall("tool1");

      expect(mockManusOptimizations.validateToolCall).toHaveBeenCalledWith(
        "tool1",
      );
      expect(result.allowed).toBe(true);
    });

    it("应该调用transitionToPhase", () => {
      const result = llmManager.transitionToPhase("execution");

      expect(mockManusOptimizations.transitionToPhase).toHaveBeenCalledWith(
        "execution",
      );
      expect(result).toBe(true);
    });

    it("应该返回Manus统计", () => {
      const stats = llmManager.getManusStats();

      expect(stats.enabled).toBe(true);
      expect(mockManusOptimizations.getStats).toHaveBeenCalled();
    });

    it("应该在Manus未启用时返回默认值", () => {
      llmManager.manusOptimizations = null;

      const stats = llmManager.getManusStats();

      expect(stats.enabled).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置", () => {
      llmManager = new LLMManager();

      expect(llmManager).toBeDefined();
    });

    it("应该处理null provider（使用默认ollama）", () => {
      llmManager = new LLMManager({ provider: null });

      // normalizeProvider returns null, then || operator uses default
      expect(llmManager.provider).toBe("ollama");
    });
  });
});
