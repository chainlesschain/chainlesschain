import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  BUILT_IN_PROVIDERS,
  LLMProviderRegistry,
} from "../../src/lib/llm-providers.js";
import { LLM_PROVIDERS } from "../../src/constants.js";

describe("LLM Providers", () => {
  // ─── BUILT_IN_PROVIDERS ───────────────────────────────────────

  describe("BUILT_IN_PROVIDERS", () => {
    it("should have 10 built-in providers", () => {
      expect(Object.keys(BUILT_IN_PROVIDERS)).toHaveLength(10);
    });

    it("should include expected providers", () => {
      expect(BUILT_IN_PROVIDERS.ollama).toBeDefined();
      expect(BUILT_IN_PROVIDERS.openai).toBeDefined();
      expect(BUILT_IN_PROVIDERS.anthropic).toBeDefined();
      expect(BUILT_IN_PROVIDERS.deepseek).toBeDefined();
      expect(BUILT_IN_PROVIDERS.dashscope).toBeDefined();
      expect(BUILT_IN_PROVIDERS.gemini).toBeDefined();
      expect(BUILT_IN_PROVIDERS.mistral).toBeDefined();
      expect(BUILT_IN_PROVIDERS.volcengine).toBeDefined();
      expect(BUILT_IN_PROVIDERS.kimi).toBeDefined();
      expect(BUILT_IN_PROVIDERS.minimax).toBeDefined();
    });

    it("should have correct Ollama config", () => {
      const ollama = BUILT_IN_PROVIDERS.ollama;
      expect(ollama.baseUrl).toBe("http://localhost:11434");
      expect(ollama.free).toBe(true);
      expect(ollama.apiKeyEnv).toBeNull();
      expect(ollama.models.length).toBeGreaterThan(0);
    });

    it("should have correct Anthropic config", () => {
      const anthropic = BUILT_IN_PROVIDERS.anthropic;
      expect(anthropic.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
      expect(anthropic.models).toContain("claude-opus-4-6");
    });

    it("should have correct OpenAI config", () => {
      const openai = BUILT_IN_PROVIDERS.openai;
      expect(openai.apiKeyEnv).toBe("OPENAI_API_KEY");
      expect(openai.models).toContain("gpt-4o");
    });

    it("should have correct Volcengine config", () => {
      const volcengine = BUILT_IN_PROVIDERS.volcengine;
      expect(volcengine.apiKeyEnv).toBe("VOLCENGINE_API_KEY");
      expect(volcengine.baseUrl).toBe(
        "https://ark.cn-beijing.volces.com/api/v3",
      );
      expect(volcengine.models).toContain("doubao-seed-1-6-251015");
      expect(volcengine.models).toContain("doubao-seed-code");
      expect(volcengine.free).toBe(false);
    });

    it("should have correct Kimi config", () => {
      const kimi = BUILT_IN_PROVIDERS.kimi;
      expect(kimi.apiKeyEnv).toBe("MOONSHOT_API_KEY");
      expect(kimi.baseUrl).toBe("https://api.moonshot.cn/v1");
      expect(kimi.models).toContain("moonshot-v1-auto");
      expect(kimi.free).toBe(false);
    });

    it("should have correct MiniMax config", () => {
      const minimax = BUILT_IN_PROVIDERS.minimax;
      expect(minimax.apiKeyEnv).toBe("MINIMAX_API_KEY");
      expect(minimax.baseUrl).toBe("https://api.minimax.chat/v1");
      expect(minimax.models).toContain("MiniMax-Text-01");
      expect(minimax.free).toBe(false);
    });

    it("all providers should have name, displayName, baseUrl, models", () => {
      for (const [key, provider] of Object.entries(BUILT_IN_PROVIDERS)) {
        expect(provider.name).toBe(key);
        expect(provider.displayName).toBeTruthy();
        expect(provider.baseUrl).toBeTruthy();
        expect(Array.isArray(provider.models)).toBe(true);
        expect(provider.models.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── LLMProviderRegistry ──────────────────────────────────────

  describe("LLMProviderRegistry", () => {
    let db;
    let registry;

    beforeEach(() => {
      db = new MockDatabase();
      registry = new LLMProviderRegistry(db);
    });

    it("should create llm_providers table", () => {
      expect(db.tables.has("llm_providers")).toBe(true);
    });

    it("should have all 10 built-in providers loaded", () => {
      const providers = registry.list();
      expect(providers.length).toBeGreaterThanOrEqual(10);
    });

    it("should get a specific provider", () => {
      const ollama = registry.get("ollama");
      expect(ollama).toBeTruthy();
      expect(ollama.name).toBe("ollama");
    });

    it("should return null for unknown provider", () => {
      expect(registry.get("nonexistent")).toBeNull();
    });

    it("should add a custom provider", () => {
      const provider = registry.addProvider("my-llm", {
        displayName: "My Custom LLM",
        baseUrl: "http://localhost:5000",
        apiKeyEnv: "MY_LLM_KEY",
        models: ["model-a", "model-b"],
      });

      expect(provider.name).toBe("my-llm");
      expect(provider.custom).toBe(true);
      expect(registry.get("my-llm")).toBeTruthy();
    });

    it("should remove a custom provider", () => {
      registry.addProvider("custom", {
        displayName: "Custom",
        baseUrl: "http://x",
      });
      const removed = registry.removeProvider("custom");
      expect(removed).toBe(true);
      expect(registry.get("custom")).toBeNull();
    });

    it("should not allow removing built-in providers", () => {
      expect(() => registry.removeProvider("ollama")).toThrow(
        "Cannot remove built-in",
      );
    });

    it("should return false when removing non-existent provider", () => {
      expect(registry.removeProvider("nonexistent")).toBe(false);
    });

    it("should default active provider to ollama", () => {
      const active = registry.getActive();
      expect(active).toBe("ollama");
    });

    it("should switch active provider", () => {
      registry.setActive("openai");
      const active = registry.getActive();
      expect(active).toBe("openai");
    });

    it("should throw when switching to unknown provider", () => {
      expect(() => registry.setActive("nonexistent")).toThrow("not found");
    });

    it("should report API key status", () => {
      const providers = registry.list();
      const ollama = providers.find((p) => p.name === "ollama");
      expect(ollama.hasApiKey).toBe(true); // Ollama has no key requirement

      const openai = providers.find((p) => p.name === "openai");
      // hasApiKey depends on env, but in test it should be false (no env set)
      expect(typeof openai.hasApiKey).toBe("boolean");
    });

    it("should return null for getApiKey of keyless provider", () => {
      expect(registry.getApiKey("ollama")).toBeNull();
    });

    it("should return null for getApiKey of unknown provider", () => {
      expect(registry.getApiKey("nonexistent")).toBeNull();
    });

    it("should list custom providers as custom=true", () => {
      registry.addProvider("my-api", {
        displayName: "My API",
        baseUrl: "http://x",
      });
      const providers = registry.list();
      const custom = providers.find((p) => p.name === "my-api");
      expect(custom.custom).toBe(true);
    });

    it("should get volcengine provider with correct config", () => {
      const volcengine = registry.get("volcengine");
      expect(volcengine).toBeTruthy();
      expect(volcengine.name).toBe("volcengine");
      expect(volcengine.displayName).toBe("Volcengine (火山引擎/豆包)");
      expect(volcengine.baseUrl).toContain("ark.cn-beijing.volces.com");
      expect(volcengine.apiKeyEnv).toBe("VOLCENGINE_API_KEY");
      expect(volcengine.models).toContain("doubao-seed-code");
      expect(volcengine.custom).toBe(false);
    });

    it("should switch active provider to volcengine", () => {
      const provider = registry.setActive("volcengine");
      expect(provider.name).toBe("volcengine");
      expect(registry.getActive()).toBe("volcengine");
    });

    it("should list volcengine in providers list", () => {
      const providers = registry.list();
      const volcengine = providers.find((p) => p.name === "volcengine");
      expect(volcengine).toBeTruthy();
      expect(volcengine.displayName).toBe("Volcengine (火山引擎/豆包)");
      expect(volcengine.free).toBe(false);
    });

    it("should return null for volcengine API key when not set", () => {
      // VOLCENGINE_API_KEY is not set in test environment
      expect(registry.getApiKey("volcengine")).toBeNull();
    });

    it("should not allow removing volcengine (built-in)", () => {
      expect(() => registry.removeProvider("volcengine")).toThrow(
        "Cannot remove built-in",
      );
    });

    it("should get kimi provider with correct config", () => {
      const kimi = registry.get("kimi");
      expect(kimi).toBeTruthy();
      expect(kimi.name).toBe("kimi");
      expect(kimi.displayName).toBe("Kimi (月之暗面)");
      expect(kimi.baseUrl).toBe("https://api.moonshot.cn/v1");
      expect(kimi.apiKeyEnv).toBe("MOONSHOT_API_KEY");
      expect(kimi.models).toContain("moonshot-v1-auto");
      expect(kimi.custom).toBe(false);
    });

    it("should switch active provider to kimi", () => {
      const provider = registry.setActive("kimi");
      expect(provider.name).toBe("kimi");
      expect(registry.getActive()).toBe("kimi");
    });

    it("should not allow removing kimi (built-in)", () => {
      expect(() => registry.removeProvider("kimi")).toThrow(
        "Cannot remove built-in",
      );
    });

    it("should get minimax provider with correct config", () => {
      const minimax = registry.get("minimax");
      expect(minimax).toBeTruthy();
      expect(minimax.name).toBe("minimax");
      expect(minimax.displayName).toBe("MiniMax (海螺AI)");
      expect(minimax.baseUrl).toBe("https://api.minimax.chat/v1");
      expect(minimax.apiKeyEnv).toBe("MINIMAX_API_KEY");
      expect(minimax.models).toContain("MiniMax-Text-01");
      expect(minimax.custom).toBe(false);
    });

    it("should switch active provider to minimax", () => {
      const provider = registry.setActive("minimax");
      expect(provider.name).toBe("minimax");
      expect(registry.getActive()).toBe("minimax");
    });

    it("should not allow removing minimax (built-in)", () => {
      expect(() => registry.removeProvider("minimax")).toThrow(
        "Cannot remove built-in",
      );
    });
  });

  // ─── LLM_PROVIDERS (constants.js - setup wizard) ─────────────

  describe("LLM_PROVIDERS (constants.js - setup wizard)", () => {
    it("should have 14 provider entries", () => {
      expect(Object.keys(LLM_PROVIDERS)).toHaveLength(14);
    });

    it("should have volcengine as first provider", () => {
      const keys = Object.keys(LLM_PROVIDERS);
      expect(keys[0]).toBe("volcengine");
    });

    it("should have proxy entries with isProxy flag", () => {
      expect(LLM_PROVIDERS["openai-proxy"].isProxy).toBe(true);
      expect(LLM_PROVIDERS["anthropic-proxy"].isProxy).toBe(true);
      expect(LLM_PROVIDERS["gemini-proxy"].isProxy).toBe(true);
    });

    it("should have correct default config for volcengine", () => {
      expect(LLM_PROVIDERS.volcengine.defaultBaseUrl).toBe(
        "https://ark.cn-beijing.volces.com/api/v3",
      );
      expect(LLM_PROVIDERS.volcengine.defaultModel).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(LLM_PROVIDERS.volcengine.requiresApiKey).toBe(true);
    });

    it("should include kimi and minimax", () => {
      expect(LLM_PROVIDERS.kimi).toBeDefined();
      expect(LLM_PROVIDERS.kimi.name).toBe("Kimi (月之暗面)");
      expect(LLM_PROVIDERS.minimax).toBeDefined();
      expect(LLM_PROVIDERS.minimax.name).toBe("MiniMax (海螺AI)");
    });

    it("proxy entries should have empty defaultBaseUrl", () => {
      expect(LLM_PROVIDERS["openai-proxy"].defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS["anthropic-proxy"].defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS["gemini-proxy"].defaultBaseUrl).toBe("");
    });

    it("custom entry should have empty defaults", () => {
      expect(LLM_PROVIDERS.custom.defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS.custom.defaultModel).toBe("");
    });

    it("should have volcengine as default in DEFAULT_CONFIG", async () => {
      const { DEFAULT_CONFIG } = await import("../../src/constants.js");
      expect(DEFAULT_CONFIG.llm.provider).toBe("volcengine");
      expect(DEFAULT_CONFIG.llm.baseUrl).toContain("ark.cn-beijing.volces.com");
    });
  });
});
