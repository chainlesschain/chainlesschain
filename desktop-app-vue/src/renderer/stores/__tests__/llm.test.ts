/**
 * useLLMStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: currentProvider, currentProviderConfig, currentModel, isAvailable, isBusy, providerDisplayName
 *  - Config actions: loadConfig, saveConfig, updateConfig, updateProviderConfig
 *  - Provider switching: switchProvider
 *  - Status & models: checkStatus, listModels
 *  - Query: query (non-streaming)
 *  - Streaming: queryStream, cancelStream
 *  - Embeddings & context: embeddings, clearContext
 *  - Simple setters: setConversationId, setStatus, setQuerying, setStreaming, resetStats
 *  - Token tracking: loadTokenUsage, loadBudget, saveBudget, loadCacheStats, clearCache
 *  - Error handling for IPC failures
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

describe("useLLMStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockLlm: Record<string, ReturnType<typeof vi.fn>> = {};

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    // Build a mock electronAPI.llm namespace matching the store's usage
    const methods = [
      "getConfig",
      "setConfig",
      "checkStatus",
      "listModels",
      "query",
      "queryStream",
      "embeddings",
      "clearContext",
      "cancelStream",
      "getUsageStats",
      "getTimeSeries",
      "getCostBreakdown",
      "getBudget",
      "setBudget",
      "exportCostReport",
      "clearCache",
      "getCacheStats",
      "on",
      "off",
    ];
    for (const m of methods) {
      mockLlm[m] = vi.fn().mockResolvedValue(undefined);
    }
    // on/off are synchronous
    mockLlm.on = vi.fn();
    mockLlm.off = vi.fn();

    (window as any).electronAPI = {
      invoke: vi.fn(),
      llm: mockLlm,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("status starts as unavailable with no models", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.status).toEqual({
        available: false,
        provider: "",
        models: [],
        error: null,
      });
    });

    it("config.provider defaults to ollama", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.config.provider).toBe("ollama");
    });

    it("isQuerying and isStreaming start as false", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.isQuerying).toBe(false);
      expect(store.isStreaming).toBe(false);
    });

    it("currentConversationId starts as null", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.currentConversationId).toBeNull();
    });

    it("stats start at zero", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.stats).toEqual({
        totalQueries: 0,
        totalTokens: 0,
        averageResponseTime: 0,
      });
    });

    it("tokenUsage starts at zero with null lastUpdated", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.tokenUsage.totalTokens).toBe(0);
      expect(store.tokenUsage.lastUpdated).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("currentProvider returns config.provider", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.currentProvider).toBe("ollama");
    });

    it("currentProviderConfig returns ollama config by default", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.currentProviderConfig).toEqual(store.config.ollama);
    });

    it("currentProviderConfig switches when provider changes", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.config.provider = "openai";
      expect(store.currentProviderConfig).toEqual(store.config.openai);
    });

    it("currentModel returns the model for the active provider", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.currentModel).toBe("llama2");
      store.config.provider = "openai";
      expect(store.currentModel).toBe("gpt-3.5-turbo");
    });

    it("isAvailable reflects status.available", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.isAvailable).toBe(false);
      store.status.available = true;
      expect(store.isAvailable).toBe(true);
    });

    it("isBusy is true when querying or streaming", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.isBusy).toBe(false);
      store.isQuerying = true;
      expect(store.isBusy).toBe(true);
      store.isQuerying = false;
      store.isStreaming = true;
      expect(store.isBusy).toBe(true);
    });

    it("providerDisplayName returns a human-readable name", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      expect(store.providerDisplayName).toContain("Ollama");
      store.config.provider = "anthropic";
      expect(store.providerDisplayName).toContain("Anthropic");
    });
  });

  // -------------------------------------------------------------------------
  // Config actions
  // -------------------------------------------------------------------------

  describe("Config actions", () => {
    it("loadConfig() fetches config via IPC and updates state", async () => {
      const remoteConfig = {
        provider: "openai",
        ollama: {},
        openai: { model: "gpt-4" },
      };
      mockLlm.getConfig.mockResolvedValueOnce(remoteConfig);

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.loadConfig();

      expect(mockLlm.getConfig).toHaveBeenCalled();
      expect(store.config.provider).toBe("openai");
    });

    it("loadConfig() throws on IPC error", async () => {
      mockLlm.getConfig.mockRejectedValueOnce(new Error("IPC fail"));

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await expect(store.loadConfig()).rejects.toThrow("IPC fail");
    });

    it("saveConfig() calls setConfig IPC with current config", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.saveConfig();
      expect(mockLlm.setConfig).toHaveBeenCalledWith(store.config);
    });

    it("saveConfig(config) saves and applies the given config", async () => {
      const newConfig = { provider: "deepseek" } as any;
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.saveConfig(newConfig);
      expect(mockLlm.setConfig).toHaveBeenCalledWith(newConfig);
      expect(store.config.provider).toBe("deepseek");
    });

    it("updateConfig() merges partial updates into config", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.updateConfig({ streamEnabled: false });
      expect(store.config.streamEnabled).toBe(false);
      // other fields untouched
      expect(store.config.provider).toBe("ollama");
    });

    it("updateProviderConfig() merges into specific provider", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.updateProviderConfig("ollama", { model: "mistral" });
      expect(store.config.ollama.model).toBe("mistral");
      expect(store.config.ollama.url).toBe("http://localhost:11434");
    });
  });

  // -------------------------------------------------------------------------
  // Provider switching
  // -------------------------------------------------------------------------

  describe("switchProvider", () => {
    it("saves config and checks status after switching", async () => {
      mockLlm.checkStatus.mockResolvedValueOnce({
        available: true,
        provider: "anthropic",
        models: ["claude-3"],
        error: null,
      });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.switchProvider("anthropic");

      expect(store.config.provider).toBe("anthropic");
      expect(mockLlm.setConfig).toHaveBeenCalled();
      expect(mockLlm.checkStatus).toHaveBeenCalled();
      expect(store.status.available).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Status & models
  // -------------------------------------------------------------------------

  describe("Status & models", () => {
    it("checkStatus() updates store status from IPC", async () => {
      const mockStatus = {
        available: true,
        provider: "ollama",
        models: ["llama2"],
        error: null,
      };
      mockLlm.checkStatus.mockResolvedValueOnce(mockStatus);

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const result = await store.checkStatus();

      expect(result).toEqual(mockStatus);
      expect(store.status.available).toBe(true);
    });

    it("checkStatus() sets error status on failure", async () => {
      mockLlm.checkStatus.mockRejectedValueOnce(new Error("timeout"));

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await expect(store.checkStatus()).rejects.toThrow("timeout");
      expect(store.status.available).toBe(false);
      expect(store.status.error).toBe("timeout");
    });

    it("listModels() returns model list and updates status.models", async () => {
      mockLlm.listModels.mockResolvedValueOnce(["llama2", "mistral"]);

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const models = await store.listModels();

      expect(models).toEqual(["llama2", "mistral"]);
      expect(store.status.models).toEqual(["llama2", "mistral"]);
    });
  });

  // -------------------------------------------------------------------------
  // Query (non-streaming)
  // -------------------------------------------------------------------------

  describe("query()", () => {
    it("sends prompt via IPC and updates stats", async () => {
      mockLlm.query.mockResolvedValueOnce({ content: "Hello!", tokens: 50 });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const response = await store.query("Hi");

      expect(response.content).toBe("Hello!");
      expect(store.stats.totalQueries).toBe(1);
      expect(store.stats.totalTokens).toBe(50);
      expect(store.lastQueryTime).toBeTypeOf("number");
      expect(store.isQuerying).toBe(false);
    });

    it("resets isQuerying to false on error", async () => {
      mockLlm.query.mockRejectedValueOnce(new Error("query fail"));

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await expect(store.query("Hi")).rejects.toThrow("query fail");
      expect(store.isQuerying).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // cancelStream
  // -------------------------------------------------------------------------

  describe("cancelStream()", () => {
    it("returns unsuccessful when no stream is active", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const result = await store.cancelStream();
      expect(result.success).toBe(false);
    });

    it("calls IPC and resets streaming state", async () => {
      mockLlm.cancelStream.mockResolvedValueOnce({ success: true });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.currentStreamControllerId = "ctrl-1";
      store.isStreaming = true;

      const result = await store.cancelStream("user cancel");
      expect(mockLlm.cancelStream).toHaveBeenCalledWith(
        "ctrl-1",
        "user cancel",
      );
      expect(result.success).toBe(true);
      expect(store.isStreaming).toBe(false);
      expect(store.currentStreamControllerId).toBeNull();
    });

    it("resets state even when IPC cancel fails", async () => {
      mockLlm.cancelStream.mockRejectedValueOnce(new Error("cancel error"));

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.currentStreamControllerId = "ctrl-2";
      store.isStreaming = true;

      await expect(store.cancelStream()).rejects.toThrow("cancel error");
      expect(store.isStreaming).toBe(false);
      expect(store.currentStreamControllerId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Simple setters
  // -------------------------------------------------------------------------

  describe("Simple setters", () => {
    it("setConversationId() updates currentConversationId", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.setConversationId("conv-1");
      expect(store.currentConversationId).toBe("conv-1");
    });

    it("setStatus() replaces the status object", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const newStatus = {
        available: true,
        provider: "openai",
        models: ["gpt-4"],
        error: null,
      };
      store.setStatus(newStatus);
      expect(store.status.available).toBe(true);
      expect(store.status.provider).toBe("openai");
    });

    it("setQuerying() and setStreaming() update flags", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.setQuerying(true);
      expect(store.isQuerying).toBe(true);
      store.setStreaming(true);
      expect(store.isStreaming).toBe(true);
    });

    it("resetStats() zeros all statistics", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.stats.totalQueries = 10;
      store.stats.totalTokens = 5000;
      store.resetStats();
      expect(store.stats.totalQueries).toBe(0);
      expect(store.stats.totalTokens).toBe(0);
      expect(store.stats.averageResponseTime).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Token tracking & budget
  // -------------------------------------------------------------------------

  describe("Token tracking", () => {
    it("loadTokenUsage() populates tokenUsage from IPC", async () => {
      mockLlm.getUsageStats.mockResolvedValueOnce({
        totalTokens: 1000,
        totalCost: 0.05,
        todayTokens: 200,
        todayCost: 0.01,
        weekTokens: 500,
        weekCost: 0.025,
        cacheHitRate: 0.3,
        cachedTokens: 100,
        avgCostPerCall: 0.005,
        totalCalls: 10,
      });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.loadTokenUsage();

      expect(store.tokenUsage.totalTokens).toBe(1000);
      expect(store.tokenUsage.totalCost).toBe(0.05);
      expect(store.tokenUsage.lastUpdated).toBeTypeOf("number");
    });

    it("loadBudget() populates budget from IPC", async () => {
      mockLlm.getBudget.mockResolvedValueOnce({
        dailyLimit: 2.0,
        weeklyLimit: 10.0,
      });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.loadBudget();

      expect(store.budget.dailyLimit).toBe(2.0);
      expect(store.budget.weeklyLimit).toBe(10.0);
    });

    it("saveBudget() calls setBudget then reloads", async () => {
      mockLlm.getBudget.mockResolvedValue({ dailyLimit: 3.0 });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const result = await store.saveBudget({ dailyLimit: 3.0 });

      expect(result).toBe(true);
      expect(mockLlm.setBudget).toHaveBeenCalledWith("default", {
        dailyLimit: 3.0,
      });
      expect(mockLlm.getBudget).toHaveBeenCalled();
    });

    it("clearCache() calls IPC and reloads cache stats", async () => {
      mockLlm.clearCache.mockResolvedValueOnce({ cleared: 5 });
      mockLlm.getCacheStats.mockResolvedValueOnce({
        database: {
          totalEntries: 0,
          expiredEntries: 0,
          totalHits: 0,
          totalTokensSaved: 0,
          totalCostSaved: "0",
          avgHitsPerEntry: "0",
        },
        runtime: { hitRate: "0" },
      });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const result = await store.clearCache();

      expect(result).toEqual({ cleared: 5 });
      expect(mockLlm.getCacheStats).toHaveBeenCalled();
      expect(store.cacheStats.totalEntries).toBe(0);
    });

    it("loadCacheStats() parses database and runtime fields", async () => {
      mockLlm.getCacheStats.mockResolvedValueOnce({
        database: {
          totalEntries: 10,
          expiredEntries: 2,
          totalHits: 50,
          totalTokensSaved: 3000,
          totalCostSaved: "1.50",
          avgHitsPerEntry: "5.0",
        },
        runtime: { hitRate: "0.75" },
      });

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      await store.loadCacheStats();

      expect(store.cacheStats.totalEntries).toBe(10);
      expect(store.cacheStats.totalCostSaved).toBe(1.5);
      expect(store.cacheStats.hitRate).toBe(0.75);
    });
  });

  // -------------------------------------------------------------------------
  // Embeddings & context
  // -------------------------------------------------------------------------

  describe("Embeddings & context", () => {
    it("embeddings() returns vector from IPC", async () => {
      const vec = [0.1, 0.2, 0.3];
      mockLlm.embeddings.mockResolvedValueOnce(vec);

      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      const result = await store.embeddings("hello");

      expect(result).toEqual(vec);
      expect(mockLlm.embeddings).toHaveBeenCalledWith("hello");
    });

    it("clearContext() calls IPC and resets conversationId", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.currentConversationId = "conv-42";

      await store.clearContext();

      expect(mockLlm.clearContext).toHaveBeenCalledWith("conv-42");
      expect(store.currentConversationId).toBeNull();
    });

    it("clearContext(specificId) only resets if it matches current", async () => {
      const { useLLMStore } = await import("../llm");
      const store = useLLMStore();
      store.currentConversationId = "conv-42";

      await store.clearContext("conv-other");

      expect(mockLlm.clearContext).toHaveBeenCalledWith("conv-other");
      // Should NOT reset because the cleared id differs from current
      expect(store.currentConversationId).toBe("conv-42");
    });
  });
});
