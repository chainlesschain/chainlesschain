/**
 * LLMManager 类别路由 (Category Routing) 单元测试 (S2, v5.0.2.9)
 *
 * 借鉴 oh-my-openagent：技能声明 category 而非硬编码 model。
 * 路由自动扫描 llm-config.js 的已配置 provider，挑选最优匹配。
 *
 * 使用 _deps 注入模式（Vitest 对 CJS require 的 vi.mock 拦不住）。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger 必须在 require 源模块之前
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Electron app (llm-config.js 依赖)
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
  },
}));

// Mock secure-config-storage (llm-config.js 依赖，避免真实文件 IO)
vi.mock("../secure-config-storage", () => ({
  getSecureConfigStorage: vi.fn(() => ({
    load: vi.fn(() => null),
    save: vi.fn(() => true),
  })),
  extractSensitiveFields: vi.fn(() => ({})),
  mergeSensitiveFields: vi.fn(),
  sanitizeConfig: vi.fn((c) => c),
  SENSITIVE_FIELDS: [],
}));

const mod = require("../llm-manager");
const {
  LLMManager,
  LLM_CATEGORIES,
  CATEGORY_PROVIDER_PRIORITY,
  CATEGORY_OPTIONS,
  inferCategoryFromModelHints,
  pickProviderForCategory,
  isProviderConfigured,
  _deps,
} = mod;

/**
 * 构造一个 fake LLMConfig 对象，只暴露 getAll()。
 */
function makeFakeConfig(partial) {
  const full = {
    provider: "ollama",
    ollama: { url: "http://localhost:11434", model: "llama2" },
    openai: {
      apiKey: "",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4o",
    },
    anthropic: {
      apiKey: "",
      baseURL: "https://api.anthropic.com",
      model: "claude-3-opus-20240229",
    },
    deepseek: { apiKey: "", baseURL: "", model: "deepseek-chat" },
    volcengine: { apiKey: "", baseURL: "", model: "doubao-seed-1-6-251015" },
    gemini: { apiKey: "", baseURL: "", model: "gemini-1.5-pro" },
    mistral: { apiKey: "", baseURL: "", model: "mistral-large-latest" },
    custom: { apiKey: "", baseURL: "", model: "" },
    ...partial,
  };
  return { getAll: () => full };
}

describe("LLMManager Category Routing", () => {
  beforeEach(() => {
    // 重置 _deps 注入
    _deps.getLLMConfig = null;
  });

  // --------------------------------------------------------------------------
  // 纯函数：isProviderConfigured
  // --------------------------------------------------------------------------
  describe("isProviderConfigured", () => {
    it("ollama 始终视为已配置（本地服务）", () => {
      const cfg = { ollama: { url: "http://localhost:11434" } };
      expect(isProviderConfigured("ollama", cfg)).toBe(true);
    });

    it("openai 需要 apiKey", () => {
      expect(isProviderConfigured("openai", { openai: { apiKey: "" } })).toBe(
        false,
      );
      expect(
        isProviderConfigured("openai", { openai: { apiKey: "sk-x" } }),
      ).toBe(true);
    });

    it("custom 需要 baseURL 而非 apiKey", () => {
      expect(
        isProviderConfigured("custom", {
          custom: { apiKey: "x", baseURL: "" },
        }),
      ).toBe(false);
      expect(
        isProviderConfigured("custom", {
          custom: { apiKey: "", baseURL: "http://x" },
        }),
      ).toBe(true);
    });

    it("缺失 section 或 null config 返回 false", () => {
      expect(isProviderConfigured("openai", null)).toBe(false);
      expect(isProviderConfigured("openai", {})).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 纯函数：inferCategoryFromModelHints
  // --------------------------------------------------------------------------
  describe("inferCategoryFromModelHints", () => {
    it("null / undefined / 空对象 → quick", () => {
      expect(inferCategoryFromModelHints(null)).toBe("quick");
      expect(inferCategoryFromModelHints(undefined)).toBe("quick");
      expect(inferCategoryFromModelHints({})).toBe("quick");
    });

    it("context-window: large + capability: reasoning → reasoning", () => {
      expect(
        inferCategoryFromModelHints({
          "context-window": "large",
          capability: "reasoning",
        }),
      ).toBe("reasoning");
    });

    it("context-window: large (alone) → deep", () => {
      expect(inferCategoryFromModelHints({ "context-window": "large" })).toBe(
        "deep",
      );
    });

    it("支持 camelCase contextWindow 字段", () => {
      expect(inferCategoryFromModelHints({ contextWindow: "large" })).toBe(
        "deep",
      );
    });

    it("capability: vision → vision", () => {
      expect(inferCategoryFromModelHints({ capability: "vision" })).toBe(
        "vision",
      );
    });

    it("capability: reasoning (no large context) → reasoning", () => {
      expect(inferCategoryFromModelHints({ capability: "reasoning" })).toBe(
        "reasoning",
      );
    });

    it("capability: creative → creative", () => {
      expect(inferCategoryFromModelHints({ capability: "creative" })).toBe(
        "creative",
      );
    });

    it("未知 capability → quick", () => {
      expect(inferCategoryFromModelHints({ capability: "unknown-cap" })).toBe(
        "quick",
      );
    });
  });

  // --------------------------------------------------------------------------
  // 纯函数：pickProviderForCategory
  // --------------------------------------------------------------------------
  describe("pickProviderForCategory", () => {
    it("只配置了 anthropic → deep 选中 anthropic", () => {
      const cfg = makeFakeConfig({
        anthropic: {
          apiKey: "sk-ant",
          baseURL: "https://api.anthropic.com",
          model: "claude-3-opus-20240229",
        },
      }).getAll();
      const r = pickProviderForCategory("deep", cfg, "ollama");
      expect(r.provider).toBe("anthropic");
      expect(r.model).toBe("claude-3-opus-20240229");
      expect(r.options.maxTokens).toBe(8192);
    });

    it("只有 ollama → vision 退回 ollama（但在 vision 优先级末尾）", () => {
      const cfg = makeFakeConfig().getAll();
      const r = pickProviderForCategory("vision", cfg, "ollama");
      expect(r.provider).toBe("ollama");
      expect(r.options.requireMultimodal).toBe(true);
    });

    it("国内场景：deepseek + volcengine 配置 → reasoning 优先 deepseek", () => {
      const cfg = makeFakeConfig({
        deepseek: {
          apiKey: "ds-x",
          baseURL: "",
          model: "deepseek-reasoner",
        },
        volcengine: {
          apiKey: "vc-x",
          baseURL: "",
          model: "doubao-seed-1-6-251015",
        },
      }).getAll();
      const r = pickProviderForCategory("reasoning", cfg, "deepseek");
      expect(r.provider).toBe("deepseek");
      expect(r.model).toBe("deepseek-reasoner");
      expect(r.options.temperature).toBe(0.1);
    });

    it("quick 类别优先本地 ollama（省成本）", () => {
      const cfg = makeFakeConfig({
        openai: { apiKey: "sk-x", baseURL: "", model: "gpt-4o" },
      }).getAll();
      const r = pickProviderForCategory("quick", cfg, "openai");
      expect(r.provider).toBe("ollama");
      expect(r.options.temperature).toBe(0.3);
    });

    it("creative 类别优先 anthropic 再 openai", () => {
      const cfg = makeFakeConfig({
        openai: { apiKey: "sk-x", baseURL: "", model: "gpt-4o" },
        anthropic: {
          apiKey: "sk-ant",
          baseURL: "",
          model: "claude-3-opus-20240229",
        },
      }).getAll();
      const r = pickProviderForCategory("creative", cfg, "openai");
      expect(r.provider).toBe("anthropic");
      expect(r.options.temperature).toBe(0.9);
    });

    it("未知 category → null", () => {
      expect(
        pickProviderForCategory(
          "nonsense",
          makeFakeConfig().getAll(),
          "ollama",
        ),
      ).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // LLMManager.resolveCategory（带缓存）
  // --------------------------------------------------------------------------
  describe("LLMManager.prototype.resolveCategory", () => {
    let manager;

    beforeEach(() => {
      manager = new LLMManager({
        provider: "ollama",
        enableStateBus: false, // 避免副作用
        enableManusOptimizations: false,
      });
    });

    it("注入 fake config，deep → anthropic", () => {
      _deps.getLLMConfig = vi.fn(() =>
        makeFakeConfig({
          anthropic: {
            apiKey: "sk-ant",
            baseURL: "",
            model: "claude-3-opus-20240229",
          },
        }),
      );
      const r = manager.resolveCategory("deep");
      expect(r.provider).toBe("anthropic");
      expect(r.model).toBe("claude-3-opus-20240229");
    });

    it("结果缓存：二次调用不再读 llm-config", () => {
      const spy = vi.fn(() => makeFakeConfig());
      _deps.getLLMConfig = spy;
      manager.resolveCategory("quick");
      manager.resolveCategory("quick");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("rebuildCategoryMapping 清空缓存后重新读取", () => {
      const spy = vi.fn(() => makeFakeConfig());
      _deps.getLLMConfig = spy;
      manager.resolveCategory("quick");
      manager.rebuildCategoryMapping();
      manager.resolveCategory("quick");
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("未知 category 自动降级到 quick", () => {
      _deps.getLLMConfig = vi.fn(() => makeFakeConfig());
      const r = manager.resolveCategory("made-up");
      expect(r.provider).toBe("ollama"); // quick 优先 ollama
    });

    it("getLLMConfig 抛异常 → 退回 this.provider", () => {
      _deps.getLLMConfig = vi.fn(() => {
        throw new Error("config load failed");
      });
      manager.config = { model: "fallback-model" };
      const r = manager.resolveCategory("deep");
      expect(r.provider).toBe("ollama");
      expect(r.model).toBe("fallback-model");
    });

    it("skill 驱动：不传 category，从 skill.modelHints 反推", () => {
      _deps.getLLMConfig = vi.fn(() => makeFakeConfig());
      const skill = {
        modelHints: { "context-window": "large", capability: "reasoning" },
      };
      const r = manager.resolveCategory(undefined, { skill });
      // reasoning 优先 deepseek 但 ollama-only → 退到 ollama
      expect(r.options.temperature).toBe(0.1); // reasoning 的附加参数
    });
  });

  // --------------------------------------------------------------------------
  // inferCategoryFromSkill 便捷方法
  // --------------------------------------------------------------------------
  describe("LLMManager.prototype.inferCategoryFromSkill", () => {
    it("从 skill 对象推断", () => {
      const manager = new LLMManager({
        provider: "ollama",
        enableStateBus: false,
        enableManusOptimizations: false,
      });
      expect(
        manager.inferCategoryFromSkill({
          modelHints: { capability: "vision" },
        }),
      ).toBe("vision");
      expect(manager.inferCategoryFromSkill({})).toBe("quick");
      expect(manager.inferCategoryFromSkill(null)).toBe("quick");
    });
  });

  // --------------------------------------------------------------------------
  // 常量完整性
  // --------------------------------------------------------------------------
  describe("常量一致性", () => {
    it("所有 LLM_CATEGORIES 在 PRIORITY 和 OPTIONS 中都存在", () => {
      for (const cat of Object.values(LLM_CATEGORIES)) {
        expect(CATEGORY_PROVIDER_PRIORITY[cat]).toBeDefined();
        expect(Array.isArray(CATEGORY_PROVIDER_PRIORITY[cat])).toBe(true);
        expect(CATEGORY_OPTIONS[cat]).toBeDefined();
      }
    });
  });
});
