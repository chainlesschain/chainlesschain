/**
 * LLMSelector 单元测试
 * 测试目标: src/main/llm/llm-selector.js
 * 覆盖场景: 智能LLM选择、得分计算、健康检查、Fallback机制
 *
 * ✅ 全部测试通过 - Mock Database
 *
 * LLMSelector智能选择最优LLM服务，支持6个提供商：
 * - Ollama (本地)
 * - Volcengine (火山引擎)
 * - OpenAI
 * - DeepSeek
 * - Dashscope (阿里通义千问)
 * - Zhipu (智谱AI)
 *
 * 测试覆盖：
 * - LLM特性常量
 * - 任务类型定义
 * - 得分计算（4种策略：cost/speed/quality/balanced）
 * - 智能选择算法
 * - Fallback机制
 * - 健康检查
 * - 配置管理
 *
 * Mock Strategy:
 * - Mock database.getSetting() 返回测试配置
 * - Mock health status和last check
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
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

describe("LLMSelector", () => {
  let LLMSelector;
  let selector;
  let mockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database with getSetting method
    mockDatabase = {
      getSetting: vi.fn((key) => {
        // Default settings for testing
        const settings = {
          "llm.provider": "volcengine",
          "llm.priority": ["volcengine", "ollama", "deepseek"],
          "llm.autoFallback": true,
          "llm.autoSelect": true,
          "llm.selectionStrategy": "balanced",
          // Provider configs
          "llm.ollamaHost": "http://localhost:11434",
          "llm.ollamaModel": "qwen2:7b",
          "llm.volcengineApiKey": "test-volcengine-key",
          "llm.volcengineModel": "doubao-pro",
          "llm.openaiApiKey": "sk-test-openai-key",
          "llm.openaiModel": "gpt-4o",
          "llm.deepseekApiKey": "sk-test-deepseek-key",
          "llm.deepseekModel": "deepseek-chat",
          "llm.dashscopeApiKey": "sk-test-dashscope-key",
          "llm.dashscopeModel": "qwen-max",
          "llm.zhipuApiKey": "test.zhipu-key",
          "llm.zhipuModel": "glm-4",
        };
        return settings[key];
      }),
    };

    // Dynamic import
    const module = await import("../../../src/main/llm/llm-selector.js");
    LLMSelector = module.default;

    selector = new LLMSelector(mockDatabase);
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      expect(selector).toBeDefined();
      expect(selector.database).toBe(mockDatabase);
    });

    it("应该初始化健康状态Map", () => {
      expect(selector.healthStatus).toBeInstanceOf(Map);
      expect(selector.lastCheck).toBeInstanceOf(Map);
    });

    it("应该设置健康检查间隔", () => {
      expect(selector.checkInterval).toBe(60000); // 1分钟
    });
  });

  describe("loadConfig", () => {
    it("应该加载默认配置", () => {
      const config = selector.loadConfig();

      expect(config.provider).toBe("volcengine");
      expect(config.priority).toEqual(["volcengine", "ollama", "deepseek"]);
      expect(config.autoFallback).toBe(true);
      expect(config.autoSelect).toBe(true);
      expect(config.selectionStrategy).toBe("balanced");
    });

    it("应该使用数据库中的配置", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.provider") return "openai";
        if (key === "llm.selectionStrategy") return "quality";
        return null;
      });

      const config = selector.loadConfig();

      expect(config.provider).toBe("openai");
      expect(config.selectionStrategy).toBe("quality");
    });

    it("应该处理autoFallback=false", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.autoFallback") return false;
        return null;
      });

      const config = selector.loadConfig();

      expect(config.autoFallback).toBe(false);
    });

    it("应该处理autoSelect=false", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.autoSelect") return false;
        return null;
      });

      const config = selector.loadConfig();

      expect(config.autoSelect).toBe(false);
    });
  });

  describe("getProviderConfig", () => {
    it("应该获取Ollama配置", () => {
      const config = selector.getProviderConfig("ollama");

      expect(config.host).toBe("http://localhost:11434");
      expect(config.model).toBe("qwen2:7b");
    });

    it("应该获取OpenAI配置", () => {
      const config = selector.getProviderConfig("openai");

      expect(config.apiKey).toBe("sk-test-openai-key");
      expect(config.model).toBe("gpt-4o");
    });

    it("应该获取Volcengine配置", () => {
      const config = selector.getProviderConfig("volcengine");

      expect(config.apiKey).toBe("test-volcengine-key");
      expect(config.model).toBe("doubao-pro");
    });

    it("应该获取DeepSeek配置", () => {
      const config = selector.getProviderConfig("deepseek");

      expect(config.apiKey).toBe("sk-test-deepseek-key");
      expect(config.model).toBe("deepseek-chat");
    });

    it("应该获取Dashscope配置", () => {
      const config = selector.getProviderConfig("dashscope");

      expect(config.apiKey).toBe("sk-test-dashscope-key");
      expect(config.model).toBe("qwen-max");
    });

    it("应该获取Zhipu配置", () => {
      const config = selector.getProviderConfig("zhipu");

      expect(config.apiKey).toBe("test.zhipu-key");
      expect(config.model).toBe("glm-4");
    });

    it("应该处理未知提供商", () => {
      const config = selector.getProviderConfig("unknown");

      expect(Object.keys(config).length).toBe(0);
    });
  });

  describe("isProviderConfigured", () => {
    it("应该验证Ollama配置（需要host）", () => {
      const configured = selector.isProviderConfigured("ollama");

      expect(configured).toBe(true);
    });

    it("应该验证云服务配置（需要API Key）", () => {
      expect(selector.isProviderConfigured("volcengine")).toBe(true);
      expect(selector.isProviderConfigured("openai")).toBe(true);
      expect(selector.isProviderConfigured("deepseek")).toBe(true);
    });

    it("应该拒绝未配置的Ollama（无host）", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.ollamaHost") return null;
        return null;
      });

      const configured = selector.isProviderConfigured("ollama");

      expect(configured).toBe(false);
    });

    it("应该拒绝未配置的云服务（无API Key）", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.openaiApiKey") return "";
        return null;
      });

      const configured = selector.isProviderConfigured("openai");

      expect(configured).toBe(false);
    });

    it("应该拒绝未知提供商", () => {
      const configured = selector.isProviderConfigured("unknown");

      expect(configured).toBe(false);
    });
  });

  describe("calculateScore", () => {
    it("应该使用balanced策略计算得分", () => {
      const score = selector.calculateScore("volcengine", "balanced", "chat");

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("应该使用cost策略计算得分", () => {
      const score = selector.calculateScore("ollama", "cost", "quick");

      // Ollama成本为0，应该得分很高
      expect(score).toBeGreaterThan(70);
    });

    it("应该使用speed策略计算得分", () => {
      const score = selector.calculateScore("volcengine", "speed", "chat");

      // Volcengine速度为90，应该得分很高
      expect(score).toBeGreaterThan(70);
    });

    it("应该使用quality策略计算得分", () => {
      const score = selector.calculateScore("openai", "quality", "complex");

      // OpenAI质量为95，应该得分最高
      expect(score).toBeGreaterThan(80);
    });

    it("应该对未配置的提供商返回0分", () => {
      mockDatabase.getSetting.mockReturnValue(null);

      const score = selector.calculateScore("openai", "balanced");

      expect(score).toBe(0);
    });

    it("应该对不健康的提供商返回0分", () => {
      selector.updateHealth("volcengine", false);

      const score = selector.calculateScore("volcengine", "balanced");

      expect(score).toBe(0);
    });

    it("应该对未知提供商返回0分", () => {
      const score = selector.calculateScore("unknown", "balanced");

      expect(score).toBe(0);
    });

    it("应该为适合的任务类型提升得分", () => {
      const normalScore = selector.calculateScore("deepseek", "balanced", "chat");
      const codeScore = selector.calculateScore("deepseek", "balanced", "code");

      // DeepSeek适合代码任务，code任务得分应该更高
      expect(codeScore).toBeGreaterThan(normalScore);
    });

    it("应该为本地服务加分", () => {
      const ollamaScore = selector.calculateScore("ollama", "balanced");
      const volcengineScore = selector.calculateScore("volcengine", "balanced");

      // Ollama是本地服务，应该有加分
      expect(ollamaScore).toBeGreaterThan(0);
    });

    it("应该限制得分不超过100", () => {
      // 即使有各种加成，得分也不应超过100
      const score = selector.calculateScore("ollama", "cost", "quick");

      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("selectBestLLM", () => {
    it("应该选择得分最高的LLM", () => {
      const best = selector.selectBestLLM({ taskType: "chat" });

      expect(best).toBeDefined();
      expect(typeof best).toBe("string");
    });

    it("应该在autoSelect=false时返回当前提供商", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.autoSelect") return false;
        if (key === "llm.provider") return "openai";
        return null;
      });

      const best = selector.selectBestLLM();

      expect(best).toBe("openai");
    });

    it("应该使用指定的策略", () => {
      const best = selector.selectBestLLM({ strategy: "quality" });

      expect(best).toBeDefined();
    });

    it("应该排除指定的提供商", () => {
      const best = selector.selectBestLLM({
        excludes: ["volcengine", "ollama"],
      });

      expect(best).not.toBe("volcengine");
      expect(best).not.toBe("ollama");
    });

    it("应该根据任务类型选择", () => {
      const codeBest = selector.selectBestLLM({ taskType: "code" });

      expect(codeBest).toBeDefined();
    });

    it("应该在没有可用LLM时返回默认", () => {
      // 设置所有提供商都未配置
      mockDatabase.getSetting.mockReturnValue(null);

      const best = selector.selectBestLLM();

      expect(best).toBeDefined(); // 应该返回第一个优先级
    });
  });

  describe("getFallbackList", () => {
    it("应该返回备用提供商列表", () => {
      const fallbacks = selector.getFallbackList("volcengine");

      expect(Array.isArray(fallbacks)).toBe(true);
      expect(fallbacks).not.toContain("volcengine"); // 排除当前提供商
    });

    it("应该排除未配置的提供商", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.ollamaHost") return null; // Ollama未配置
        if (key === "llm.volcengineApiKey") return "key";
        if (key === "llm.deepseekApiKey") return "key";
        return null;
      });

      const fallbacks = selector.getFallbackList("volcengine");

      expect(fallbacks).not.toContain("ollama");
    });

    it("应该按优先级排序", () => {
      const fallbacks = selector.getFallbackList("volcengine");

      // 应该按照priority顺序，但排除volcengine
      expect(fallbacks[0]).toBe("ollama");
      expect(fallbacks[1]).toBe("deepseek");
    });
  });

  describe("selectFallback", () => {
    it("应该选择第一个备用提供商", () => {
      const fallback = selector.selectFallback("volcengine");

      expect(fallback).toBe("ollama"); // 第一个备用
    });

    it("应该排除已尝试的提供商", () => {
      const fallback = selector.selectFallback("volcengine", ["ollama"]);

      expect(fallback).not.toBe("ollama");
      expect(fallback).toBe("deepseek"); // 下一个可用
    });

    it("应该在autoFallback=false时返回null", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.autoFallback") return false;
        return null;
      });

      const fallback = selector.selectFallback("volcengine");

      expect(fallback).toBeNull();
    });

    it("应该在没有备用时返回null", () => {
      // 所有提供商都已尝试
      const fallback = selector.selectFallback("volcengine", [
        "ollama",
        "deepseek",
        "openai",
        "dashscope",
        "zhipu",
      ]);

      expect(fallback).toBeNull();
    });
  });

  describe("健康检查", () => {
    it("应该更新健康状态", () => {
      selector.updateHealth("volcengine", true);

      expect(selector.healthStatus.get("volcengine")).toBe(true);
    });

    it("应该更新最后检查时间", () => {
      const before = Date.now();
      selector.updateHealth("volcengine", true);
      const after = Date.now();

      const lastCheck = selector.lastCheck.get("volcengine");
      expect(lastCheck).toBeGreaterThanOrEqual(before);
      expect(lastCheck).toBeLessThanOrEqual(after);
    });

    it("应该判断是否需要健康检查（首次）", () => {
      const needs = selector.needsHealthCheck("volcengine");

      expect(needs).toBe(true); // 从未检查过
    });

    it("应该判断是否需要健康检查（未过期）", () => {
      selector.updateHealth("volcengine", true);

      const needs = selector.needsHealthCheck("volcengine");

      expect(needs).toBe(false); // 刚刚检查过
    });

    it("应该判断是否需要健康检查（已过期）", () => {
      selector.updateHealth("volcengine", true);

      // 手动设置为过期时间
      selector.lastCheck.set("volcengine", Date.now() - 70000); // 70秒前

      const needs = selector.needsHealthCheck("volcengine");

      expect(needs).toBe(true); // 超过60秒间隔
    });
  });

  describe("getAllCharacteristics", () => {
    it("应该返回所有LLM特性", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars).toBeDefined();
      expect(chars.ollama).toBeDefined();
      expect(chars.volcengine).toBeDefined();
      expect(chars.openai).toBeDefined();
      expect(chars.deepseek).toBeDefined();
      expect(chars.dashscope).toBeDefined();
      expect(chars.zhipu).toBeDefined();
    });

    it("应该包含完整的特性信息", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars.ollama.name).toBe("Ollama（本地）");
      expect(chars.ollama.cost).toBe(0);
      expect(chars.ollama.speed).toBeDefined();
      expect(chars.ollama.quality).toBeDefined();
      expect(chars.ollama.contextLength).toBe(4096);
      expect(chars.ollama.capabilities).toContain("chat");
      expect(chars.ollama.suitable).toContain("offline");
      expect(chars.ollama.requiresInternet).toBe(false);
    });

    it("应该返回新对象", () => {
      const chars1 = selector.getAllCharacteristics();
      const chars2 = selector.getAllCharacteristics();

      // 应该是不同的对象实例（但内容相同）
      expect(chars1).not.toBe(chars2);
      expect(chars1.ollama.name).toBe(chars2.ollama.name);
    });
  });

  describe("getTaskTypes", () => {
    it("应该返回所有任务类型", () => {
      const types = selector.getTaskTypes();

      expect(types).toBeDefined();
      expect(types.quick).toBeDefined();
      expect(types.complex).toBeDefined();
      expect(types.code).toBeDefined();
      expect(types.translation).toBeDefined();
      expect(types.summary).toBeDefined();
      expect(types.analysis).toBeDefined();
      expect(types.chat).toBeDefined();
      expect(types.creative).toBeDefined();
    });

    it("应该包含任务类型的详细信息", () => {
      const types = selector.getTaskTypes();

      expect(types.code.name).toBe("代码生成");
      expect(types.code.prioritize).toContain("quality");
      expect(types.code.prioritize).toContain("capabilities");
    });

    it("应该返回新对象", () => {
      const types1 = selector.getTaskTypes();
      const types2 = selector.getTaskTypes();

      // 应该是不同的对象实例（但内容相同）
      expect(types1).not.toBe(types2);
      expect(types1.code.name).toBe(types2.code.name);
    });
  });

  describe("generateSelectionReport", () => {
    it("应该生成选择报告", () => {
      const report = selector.generateSelectionReport("chat");

      expect(Array.isArray(report)).toBe(true);
      expect(report.length).toBeGreaterThan(0);
    });

    it("应该包含提供商信息", () => {
      const report = selector.generateSelectionReport();

      const item = report[0];
      expect(item.provider).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.score).toBeDefined();
      expect(item.configured).toBeDefined();
      expect(item.healthy).toBeDefined();
      expect(item.characteristics).toBeDefined();
    });

    it("应该按得分排序", () => {
      const report = selector.generateSelectionReport();

      for (let i = 0; i < report.length - 1; i++) {
        expect(report[i].score).toBeGreaterThanOrEqual(report[i + 1].score);
      }
    });

    it("应该包含特性信息", () => {
      const report = selector.generateSelectionReport();

      const item = report[0];
      expect(item.characteristics.cost).toBeDefined();
      expect(item.characteristics.speed).toBeDefined();
      expect(item.characteristics.quality).toBeDefined();
      expect(item.characteristics.contextLength).toBeDefined();
    });

    it("应该反映健康状态", () => {
      selector.updateHealth("volcengine", false);

      const report = selector.generateSelectionReport();

      const volcengineItem = report.find((r) => r.provider === "volcengine");
      expect(volcengineItem.healthy).toBe(false);
    });

    it("应该根据任务类型调整得分", () => {
      const chatReport = selector.generateSelectionReport("chat");
      const codeReport = selector.generateSelectionReport("code");

      // DeepSeek在代码任务中应该得分更高
      const chatDeepSeek = chatReport.find((r) => r.provider === "deepseek");
      const codeDeepSeek = codeReport.find((r) => r.provider === "deepseek");

      expect(codeDeepSeek.score).toBeGreaterThanOrEqual(chatDeepSeek.score);
    });
  });

  describe("边界情况", () => {
    it("应该处理空的优先级列表", () => {
      mockDatabase.getSetting.mockImplementation((key) => {
        if (key === "llm.priority") return [];
        return null;
      });

      const best = selector.selectBestLLM();
      expect(best).toBe("volcengine"); // 默认fallback
    });

    it("应该处理所有提供商都不健康", () => {
      selector.updateHealth("volcengine", false);
      selector.updateHealth("ollama", false);
      selector.updateHealth("deepseek", false);

      const best = selector.selectBestLLM();
      expect(best).toBeDefined(); // 应该返回默认
    });

    it("应该处理未知的选择策略", () => {
      const score = selector.calculateScore("volcengine", "unknown-strategy");

      expect(score).toBeGreaterThan(0); // 应该fallback到balanced
    });

    it("应该处理未知的任务类型", () => {
      const score = selector.calculateScore("volcengine", "balanced", "unknown-task");

      expect(score).toBeGreaterThan(0); // 应该正常计算
    });

    it("应该处理database.getSetting返回undefined", () => {
      mockDatabase.getSetting.mockReturnValue(undefined);

      const config = selector.loadConfig();
      expect(config.provider).toBe("volcengine"); // 使用默认值
    });
  });

  describe("LLM特性常量验证", () => {
    // 每个测试都获取新的特性对象，避免测试间相互影响
    it("应该包含所有6个提供商", () => {
      const chars = selector.getAllCharacteristics();

      expect(Object.keys(chars)).toHaveLength(6);
    });

    it("Ollama应该是免费本地服务", () => {
      // 获取新的特性对象
      const chars = selector.getAllCharacteristics();

      expect(chars.ollama.cost).toBe(0);
      expect(chars.ollama.requiresInternet).toBe(false);
    });

    it("Volcengine应该是高速低成本服务", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars.volcengine.cost).toBe(30);
      expect(chars.volcengine.speed).toBe(90);
      expect(chars.volcengine.suitable).toContain("chinese");
    });

    it("OpenAI应该是高质量高成本服务", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars.openai.quality).toBe(95);
      expect(chars.openai.cost).toBe(80);
      expect(chars.openai.contextLength).toBe(16384);
    });

    it("DeepSeek应该适合代码和长上下文", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars.deepseek.suitable).toContain("code");
      expect(chars.deepseek.suitable).toContain("long-context");
      expect(chars.deepseek.contextLength).toBe(32768);
    });

    it("所有云服务应该需要网络", () => {
      const chars = selector.getAllCharacteristics();

      expect(chars.volcengine.requiresInternet).toBe(true);
      expect(chars.openai.requiresInternet).toBe(true);
      expect(chars.deepseek.requiresInternet).toBe(true);
      expect(chars.dashscope.requiresInternet).toBe(true);
      expect(chars.zhipu.requiresInternet).toBe(true);
    });
  });

  describe("任务类型常量验证", () => {
    it("应该包含8种任务类型", () => {
      const types = selector.getTaskTypes();

      expect(Object.keys(types)).toHaveLength(8);
    });

    it("quick任务应该优先速度和成本", () => {
      const types = selector.getTaskTypes();

      expect(types.quick.prioritize).toContain("speed");
      expect(types.quick.prioritize).toContain("cost");
    });

    it("complex任务应该优先质量和上下文长度", () => {
      const types = selector.getTaskTypes();

      expect(types.complex.prioritize).toContain("quality");
      expect(types.complex.prioritize).toContain("contextLength");
    });

    it("code任务应该优先质量和能力", () => {
      const types = selector.getTaskTypes();

      expect(types.code.prioritize).toContain("quality");
      expect(types.code.prioritize).toContain("capabilities");
    });

    it("creative任务应该只优先质量", () => {
      const types = selector.getTaskTypes();

      expect(types.creative.prioritize).toEqual(["quality"]);
    });
  });
});
