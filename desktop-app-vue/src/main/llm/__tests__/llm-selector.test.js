/**
 * LLM Selector 单元测试
 *
 * 测试内容：
 * - LLMSelector 类的构造函数
 * - loadConfig 配置加载
 * - getProviderConfig 提供商配置
 * - isProviderConfigured 配置检查
 * - calculateScore 得分计算
 * - selectBestLLM 最优选择
 * - getFallbackList 备用列表
 * - selectFallback 回退选择
 * - updateHealth 健康状态更新
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const LLMSelector = require("../llm-selector");

describe("LLMSelector", () => {
  let selector;
  let mockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建 mock database
    mockDatabase = {
      getSetting: vi.fn((key) => {
        const settings = {
          "llm.provider": "volcengine",
          "llm.priority": ["volcengine", "ollama", "deepseek"],
          "llm.autoFallback": true,
          "llm.autoSelect": true,
          "llm.selectionStrategy": "balanced",
          "llm.ollamaHost": "http://localhost:11434",
          "llm.ollamaModel": "llama2",
          "llm.openaiApiKey": "sk-test-key",
          "llm.openaiBaseUrl": "https://api.openai.com/v1",
          "llm.openaiModel": "gpt-4",
          "llm.volcengineApiKey": "vol-test-key",
          "llm.volcengineModel": "doubao-pro",
          "llm.deepseekApiKey": "ds-test-key",
          "llm.deepseekModel": "deepseek-chat",
          "llm.dashscopeApiKey": "dash-test-key",
          "llm.dashscopeModel": "qwen-turbo",
          "llm.zhipuApiKey": "zhipu-test-key",
          "llm.zhipuModel": "glm-4",
        };
        return settings[key];
      }),
    };

    selector = new LLMSelector(mockDatabase);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with database", () => {
      expect(selector.database).toBe(mockDatabase);
      expect(selector.healthStatus).toBeInstanceOf(Map);
      expect(selector.lastCheck).toBeInstanceOf(Map);
      expect(selector.checkInterval).toBe(60000);
    });
  });

  describe("loadConfig", () => {
    it("should load config from database", () => {
      const config = selector.loadConfig();

      expect(config.provider).toBe("volcengine");
      expect(config.priority).toEqual(["volcengine", "ollama", "deepseek"]);
      expect(config.autoFallback).toBe(true);
      expect(config.autoSelect).toBe(true);
      expect(config.selectionStrategy).toBe("balanced");
    });

    it("should use defaults when settings not found", () => {
      mockDatabase.getSetting = vi.fn(() => null);

      const config = selector.loadConfig();

      expect(config.provider).toBe("volcengine");
      expect(config.priority).toEqual(["volcengine", "ollama", "deepseek"]);
      expect(config.autoFallback).toBe(true);
      expect(config.autoSelect).toBe(true);
      expect(config.selectionStrategy).toBe("balanced");
    });
  });

  describe("getProviderConfig", () => {
    it("should get ollama config", () => {
      const config = selector.getProviderConfig("ollama");

      expect(config.host).toBe("http://localhost:11434");
      expect(config.model).toBe("llama2");
    });

    it("should get openai config", () => {
      const config = selector.getProviderConfig("openai");

      expect(config.apiKey).toBe("sk-test-key");
      expect(config.baseUrl).toBe("https://api.openai.com/v1");
      expect(config.model).toBe("gpt-4");
    });

    it("should get volcengine config", () => {
      const config = selector.getProviderConfig("volcengine");

      expect(config.apiKey).toBe("vol-test-key");
      expect(config.model).toBe("doubao-pro");
    });

    it("should get deepseek config", () => {
      const config = selector.getProviderConfig("deepseek");

      expect(config.apiKey).toBe("ds-test-key");
      expect(config.model).toBe("deepseek-chat");
    });

    it("should get dashscope config", () => {
      const config = selector.getProviderConfig("dashscope");

      expect(config.apiKey).toBe("dash-test-key");
      expect(config.model).toBe("qwen-turbo");
    });

    it("should get zhipu config", () => {
      const config = selector.getProviderConfig("zhipu");

      expect(config.apiKey).toBe("zhipu-test-key");
      expect(config.model).toBe("glm-4");
    });

    it("should return empty config for unknown provider", () => {
      const config = selector.getProviderConfig("unknown");
      expect(config).toEqual({});
    });
  });

  describe("isProviderConfigured", () => {
    it("should return true for configured ollama", () => {
      expect(selector.isProviderConfigured("ollama")).toBe(true);
    });

    it("should return true for configured cloud providers", () => {
      expect(selector.isProviderConfigured("openai")).toBe(true);
      expect(selector.isProviderConfigured("volcengine")).toBe(true);
      expect(selector.isProviderConfigured("deepseek")).toBe(true);
    });

    it("should return false for unconfigured ollama", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.ollamaHost") {
          return null;
        }
        return null;
      });

      expect(selector.isProviderConfigured("ollama")).toBe(false);
    });

    it("should return false for unconfigured cloud provider", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.openaiApiKey") {
          return "";
        }
        return null;
      });

      expect(selector.isProviderConfigured("openai")).toBe(false);
    });

    it("should return false for unknown provider", () => {
      expect(selector.isProviderConfigured("unknown")).toBe(false);
    });
  });

  describe("calculateScore", () => {
    it("should calculate score for balanced strategy", () => {
      const score = selector.calculateScore("volcengine", "balanced", "chat");

      // volcengine: quality=85, speed=90, cost=30
      // balanced: quality*0.4 + speed*0.3 + (100-cost)*0.3
      // = 85*0.4 + 90*0.3 + 70*0.3 = 34 + 27 + 21 = 82
      // 加上任务匹配和本地服务加成
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("should calculate score for cost strategy", () => {
      const score = selector.calculateScore("ollama", "cost", "chat");

      // ollama: cost=0, quality=75, speed=70
      // cost: (100-cost)*0.7 + quality*0.2 + speed*0.1
      // = 100*0.7 + 75*0.2 + 70*0.1 = 70 + 15 + 7 = 92
      // 本地服务加成 *1.1
      expect(score).toBeGreaterThan(80);
    });

    it("should calculate score for speed strategy", () => {
      const score = selector.calculateScore("volcengine", "speed", "chat");

      // volcengine: speed=90
      // speed: speed*0.7 + quality*0.2 + (100-cost)*0.1
      expect(score).toBeGreaterThan(60);
    });

    it("should calculate score for quality strategy", () => {
      const score = selector.calculateScore("openai", "quality", "chat");

      // openai: quality=95
      // quality: quality*0.7 + speed*0.2 + (100-cost)*0.1
      expect(score).toBeGreaterThan(70);
    });

    it("should return 0 for unconfigured provider", () => {
      mockDatabase.getSetting = vi.fn(() => null);

      const score = selector.calculateScore("openai", "balanced", "chat");
      expect(score).toBe(0);
    });

    it("should return 0 for unhealthy provider", () => {
      selector.healthStatus.set("volcengine", false);

      const score = selector.calculateScore("volcengine", "balanced", "chat");
      expect(score).toBe(0);
    });

    it("should boost score for matching task type", () => {
      const codeScore = selector.calculateScore("deepseek", "balanced", "code");
      const chatScore = selector.calculateScore("deepseek", "balanced", "chat");

      // deepseek suitable for 'code'
      expect(codeScore).toBeGreaterThan(chatScore);
    });

    it("should return 0 for unknown provider", () => {
      const score = selector.calculateScore("unknown", "balanced", "chat");
      expect(score).toBe(0);
    });
  });

  describe("selectBestLLM", () => {
    it("should select best LLM based on strategy", () => {
      const best = selector.selectBestLLM({
        taskType: "chat",
        strategy: "balanced",
      });

      expect([
        "volcengine",
        "ollama",
        "deepseek",
        "openai",
        "dashscope",
        "zhipu",
      ]).toContain(best);
    });

    it("should return current provider when autoSelect is disabled", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.autoSelect") {
          return false;
        }
        if (key === "llm.provider") {
          return "openai";
        }
        return null;
      });

      const best = selector.selectBestLLM();
      expect(best).toBe("openai");
    });

    it("should exclude specified providers", () => {
      const best = selector.selectBestLLM({
        taskType: "chat",
        excludes: ["volcengine", "ollama"],
      });

      expect(best).not.toBe("volcengine");
      expect(best).not.toBe("ollama");
    });

    it("should return first priority when no provider is available", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.priority") {
          return ["volcengine", "ollama"];
        }
        if (key === "llm.autoSelect") {
          return true;
        }
        return null;
      });

      // 所有提供商都不可用
      selector.healthStatus.set("volcengine", false);
      selector.healthStatus.set("ollama", false);

      const best = selector.selectBestLLM();
      expect(best).toBe("volcengine");
    });
  });

  describe("getFallbackList", () => {
    it("should return fallback list excluding current provider", () => {
      const fallbacks = selector.getFallbackList("volcengine");

      expect(fallbacks).not.toContain("volcengine");
      expect(fallbacks.length).toBeGreaterThan(0);
    });

    it("should only include configured providers", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.priority") {
          return ["volcengine", "ollama", "openai"];
        }
        if (key === "llm.volcengineApiKey") {
          return "key";
        }
        if (key === "llm.ollamaHost") {
          return "http://localhost:11434";
        }
        // openai 未配置
        return null;
      });

      const fallbacks = selector.getFallbackList("volcengine");

      expect(fallbacks).toContain("ollama");
      expect(fallbacks).not.toContain("openai");
    });
  });

  describe("selectFallback", () => {
    it("should select next available provider", () => {
      const fallback = selector.selectFallback("volcengine", []);

      expect(fallback).not.toBe("volcengine");
      expect(fallback).not.toBeNull();
    });

    it("should skip already tried providers", () => {
      const fallback = selector.selectFallback("volcengine", ["ollama"]);

      expect(fallback).not.toBe("volcengine");
      expect(fallback).not.toBe("ollama");
    });

    it("should return null when autoFallback is disabled", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.autoFallback") {
          return false;
        }
        return null;
      });

      const fallback = selector.selectFallback("volcengine", []);
      expect(fallback).toBeNull();
    });

    it("should return null when all providers tried", () => {
      mockDatabase.getSetting = vi.fn((key) => {
        if (key === "llm.priority") {
          return ["volcengine", "ollama"];
        }
        if (key === "llm.autoFallback") {
          return true;
        }
        if (key === "llm.ollamaHost") {
          return "http://localhost:11434";
        }
        return null;
      });

      const fallback = selector.selectFallback("volcengine", ["ollama"]);
      expect(fallback).toBeNull();
    });
  });

  describe("updateHealth", () => {
    it("should update health status", () => {
      selector.updateHealth("volcengine", true);

      expect(selector.healthStatus.get("volcengine")).toBe(true);
      expect(selector.lastCheck.get("volcengine")).toBeDefined();
    });

    it("should update health to unhealthy", () => {
      selector.updateHealth("ollama", false);

      expect(selector.healthStatus.get("ollama")).toBe(false);
    });
  });

  describe("needsHealthCheck", () => {
    it("should return true when never checked", () => {
      expect(selector.needsHealthCheck("volcengine")).toBe(true);
    });

    it("should return false when recently checked", () => {
      selector.lastCheck.set("volcengine", Date.now());

      expect(selector.needsHealthCheck("volcengine")).toBe(false);
    });

    it("should return true when check is stale", () => {
      selector.lastCheck.set("volcengine", Date.now() - 70000);

      expect(selector.needsHealthCheck("volcengine")).toBe(true);
    });
  });

  describe("getAllCharacteristics", () => {
    it("should return all LLM characteristics", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars).toHaveProperty("ollama");
      expect(chars).toHaveProperty("volcengine");
      expect(chars).toHaveProperty("openai");
      expect(chars).toHaveProperty("deepseek");
      expect(chars).toHaveProperty("dashscope");
      expect(chars).toHaveProperty("zhipu");
    });

    it("should return characteristics object", () => {
      const chars = selector.getAllCharacteristics();

      // 验证返回的对象包含所有预期的属性
      expect(chars.ollama).toBeDefined();
      expect(chars.ollama.name).toBe("Ollama（本地）");
      expect(chars.ollama.cost).toBe(0);
      expect(chars.ollama.requiresInternet).toBe(false);
    });
  });

  describe("getTaskTypes", () => {
    it("should return all task types", () => {
      const types = selector.getTaskTypes();

      expect(types).toHaveProperty("quick");
      expect(types).toHaveProperty("complex");
      expect(types).toHaveProperty("code");
      expect(types).toHaveProperty("translation");
      expect(types).toHaveProperty("summary");
      expect(types).toHaveProperty("analysis");
      expect(types).toHaveProperty("chat");
      expect(types).toHaveProperty("creative");
    });
  });

  describe("generateSelectionReport", () => {
    it("should generate selection report", () => {
      const report = selector.generateSelectionReport("chat");

      expect(Array.isArray(report)).toBe(true);
      expect(report.length).toBeGreaterThan(0);

      const firstItem = report[0];
      expect(firstItem).toHaveProperty("provider");
      expect(firstItem).toHaveProperty("name");
      expect(firstItem).toHaveProperty("score");
      expect(firstItem).toHaveProperty("configured");
      expect(firstItem).toHaveProperty("healthy");
      expect(firstItem).toHaveProperty("characteristics");
    });

    it("should sort report by score descending", () => {
      const report = selector.generateSelectionReport("chat");

      for (let i = 0; i < report.length - 1; i++) {
        expect(report[i].score).toBeGreaterThanOrEqual(report[i + 1].score);
      }
    });

    it("should include characteristics in report", () => {
      const report = selector.generateSelectionReport("chat");
      const item = report.find((r) => r.provider === "volcengine");

      if (item) {
        expect(item.characteristics).toHaveProperty("cost");
        expect(item.characteristics).toHaveProperty("speed");
        expect(item.characteristics).toHaveProperty("quality");
        expect(item.characteristics).toHaveProperty("contextLength");
      }
    });
  });
});
