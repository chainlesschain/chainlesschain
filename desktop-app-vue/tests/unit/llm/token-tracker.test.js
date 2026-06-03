/**
 * TokenTracker 单元测试
 * 测试目标: src/main/llm/token-tracker.js
 * 覆盖场景: Token追踪、成本计算、预算管理、使用统计
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

// Mock uuid
vi.mock("uuid", () => ({
  v4: vi.fn(() => "mocked-uuid-1234"),
}));

// Mock fs
vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
}));

// Mock volcengine-models (optional dependency)
vi.mock("../../../src/main/llm/volcengine-models.js", () => ({
  getModelSelector: vi.fn(),
  TaskTypes: {},
  VolcengineModels: {
    models: {
      "doubao-pro-32k": {
        pricing: { input: 0.0008, output: 0.002 },
      },
    },
  },
}));

describe("TokenTracker", () => {
  let TokenTracker;
  let PRICING_DATA;
  let tokenTracker;
  let mockDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database — better-sqlite3 style: db.prepare(...) returns stmt with run/get/all
    const mockStmt = {
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
      get: vi.fn(() => null),
      all: vi.fn(() => []),
    };
    mockDatabase = {
      prepare: vi.fn(() => mockStmt),
      run: vi.fn(async () => ({ lastID: 1 })),
      get: vi.fn(async () => null),
      all: vi.fn(async () => []),
      _stmt: mockStmt,
    };

    // Dynamic import
    const module = await import("../../../src/main/llm/token-tracker.js");
    TokenTracker = module.TokenTracker;
    PRICING_DATA = module.PRICING_DATA;
  });

  describe("PRICING_DATA常量", () => {
    it("应该定义OpenAI定价", () => {
      expect(PRICING_DATA.openai).toBeDefined();
      expect(PRICING_DATA.openai["gpt-4o"]).toEqual({
        input: 2.5,
        output: 10.0,
      });
      expect(PRICING_DATA.openai["gpt-4o-mini"]).toEqual({
        input: 0.15,
        output: 0.6,
      });
      expect(PRICING_DATA.openai["gpt-3.5-turbo"]).toEqual({
        input: 0.5,
        output: 1.5,
      });
    });

    it("应该定义Anthropic定价（含cache）", () => {
      expect(PRICING_DATA.anthropic).toBeDefined();
      expect(PRICING_DATA.anthropic["claude-3-5-sonnet-20241022"]).toEqual({
        input: 3.0,
        output: 15.0,
        cache: 0.3,
        cacheWrite: 3.75,
      });
    });

    it("应该定义DeepSeek定价", () => {
      expect(PRICING_DATA.deepseek).toBeDefined();
      expect(PRICING_DATA.deepseek["deepseek-chat"]).toEqual({
        input: 0.14,
        output: 0.28,
      });
    });

    it("应该定义Volcengine定价", () => {
      expect(PRICING_DATA.volcengine).toBeDefined();
    });

    it("应该定义Ollama定价（免费）", () => {
      expect(PRICING_DATA.ollama).toBeDefined();
      expect(PRICING_DATA.ollama["*"]).toEqual({ input: 0, output: 0 });
    });

    it("应该定义custom默认定价", () => {
      expect(PRICING_DATA.custom).toBeDefined();
      expect(PRICING_DATA.custom["*"]).toEqual({ input: 0.5, output: 1.5 });
    });
  });

  describe("构造函数", () => {
    it("应该创建实例", () => {
      tokenTracker = new TokenTracker(mockDatabase);

      expect(tokenTracker).toBeDefined();
      expect(tokenTracker.db).toBe(mockDatabase);
    });

    it("应该使用默认配置", () => {
      tokenTracker = new TokenTracker(mockDatabase);

      expect(tokenTracker.options.enableCostTracking).toBe(true);
      expect(tokenTracker.options.enableBudgetAlerts).toBe(true);
      expect(tokenTracker.options.exchangeRate).toBe(7.2);
    });

    it("应该接受自定义配置", () => {
      tokenTracker = new TokenTracker(mockDatabase, {
        enableCostTracking: false,
        exchangeRate: 7.0,
      });

      expect(tokenTracker.options.enableCostTracking).toBe(false);
      expect(tokenTracker.options.exchangeRate).toBe(7.0);
    });

    it("应该继承EventEmitter", () => {
      tokenTracker = new TokenTracker(mockDatabase);

      expect(typeof tokenTracker.on).toBe("function");
      expect(typeof tokenTracker.emit).toBe("function");
    });

    it("应该要求非空database参数", () => {
      expect(() => new TokenTracker(null)).toThrow("database 参数是必需的");
    });
  });

  describe("calculateCost", () => {
    beforeEach(() => {
      tokenTracker = new TokenTracker(mockDatabase);
    });

    it("应该计算OpenAI成本", () => {
      const result = tokenTracker.calculateCost("openai", "gpt-4o", 1000, 500);

      // input: 1000 * 2.5 / 1M = 0.0025 USD
      // output: 500 * 10.0 / 1M = 0.005 USD
      // total: 0.0075 USD
      expect(result.costUsd).toBeCloseTo(0.0075, 4);
      expect(result.costCny).toBeCloseTo(0.0075 * 7.2, 4);
    });

    it("应该计算Anthropic成本（含cache）", () => {
      const result = tokenTracker.calculateCost(
        "anthropic",
        "claude-3-5-sonnet-20241022",
        1000,
        500,
        2000, // cachedTokens
      );

      // input: 1000 * 3.0 / 1M = 0.003
      // output: 500 * 15.0 / 1M = 0.0075
      // cache: 2000 * 0.3 / 1M = 0.0006
      // total: 0.0111 USD
      expect(result.costUsd).toBeCloseTo(0.0111, 4);
    });

    it("应该计算Ollama成本（免费）", () => {
      const result = tokenTracker.calculateCost(
        "ollama",
        "llama2",
        10000,
        5000,
      );

      expect(result.costUsd).toBe(0);
      expect(result.costCny).toBe(0);
    });

    it("应该处理未知模型（使用通配符）", () => {
      const result = tokenTracker.calculateCost(
        "custom",
        "unknown-model",
        1000,
        500,
      );

      // custom/*: input 0.5, output 1.5
      expect(result.costUsd).toBeCloseTo(0.0005 + 0.00075, 5);
    });

    it("应该处理未知provider（使用默认定价）", () => {
      const result = tokenTracker.calculateCost("unknown", "test", 1000, 500);

      // Unknown provider defaults to 0.5/1.5
      expect(result.costUsd).toBeCloseTo(0.0005 + 0.00075, 5);
    });

    it("应该使用自定义汇率", () => {
      tokenTracker.options.exchangeRate = 6.5;

      const result = tokenTracker.calculateCost(
        "openai",
        "gpt-3.5-turbo",
        1000,
        1000,
      );

      expect(result.costCny).toBeCloseTo(result.costUsd * 6.5, 5);
    });

    it("应该处理0 tokens", () => {
      const result = tokenTracker.calculateCost("openai", "gpt-4o", 0, 0);

      expect(result.costUsd).toBe(0);
    });

    it("应该处理缺少cachedTokens参数", () => {
      const result = tokenTracker.calculateCost(
        "anthropic",
        "claude-3-opus-20240229",
        1000,
        500,
        // No cachedTokens parameter
      );

      // Should not throw, cachedTokens defaults to 0
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it("应该在禁用成本追踪时返回0", () => {
      tokenTracker.options.enableCostTracking = false;

      const result = tokenTracker.calculateCost("openai", "gpt-4o", 1000, 500);

      expect(result.costUsd).toBe(0);
      expect(result.costCny).toBe(0);
      expect(result.pricing).toBeNull();
    });
  });

  describe("updateConversationStats", () => {
    beforeEach(() => {
      tokenTracker = new TokenTracker(mockDatabase);
    });

    it("应该通过 prepare/stmt.run 更新会话统计", () => {
      tokenTracker.updateConversationStats("conv1", 100, 50, 0.01, 0.072);

      expect(mockDatabase.prepare).toHaveBeenCalled();
      expect(mockDatabase._stmt.run).toHaveBeenCalledWith(
        100,
        50,
        0.01,
        0.072,
        "conv1",
      );
    });

    it("捕获 DB 异常，不向外抛", () => {
      mockDatabase.prepare.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      expect(() =>
        tokenTracker.updateConversationStats("conv1", 1, 1, 0, 0),
      ).not.toThrow();
    });
  });

  describe("recordUsage", () => {
    beforeEach(() => {
      tokenTracker = new TokenTracker(mockDatabase);
    });

    it("应该计算成本并通过 stmt.run 写入使用日志", async () => {
      await tokenTracker.recordUsage({
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        conversationId: "conv1",
      });

      expect(mockDatabase.prepare).toHaveBeenCalled();
      expect(mockDatabase._stmt.run).toHaveBeenCalled();
      const args = mockDatabase._stmt.run.mock.calls[0];
      expect(args).toContain("conv1");
      expect(args).toContain("openai");
      expect(args).toContain("gpt-4o");
    });

    it("缺少 provider 或 model 时应提前返回不写入 DB", async () => {
      await tokenTracker.recordUsage({ inputTokens: 10, outputTokens: 5 });
      expect(mockDatabase.prepare).not.toHaveBeenCalled();
      expect(mockDatabase._stmt.run).not.toHaveBeenCalled();
    });
  });

  describe("边界情况", () => {
    it("应该处理空配置", () => {
      tokenTracker = new TokenTracker(mockDatabase, {});

      expect(tokenTracker.options.enableCostTracking).toBe(true);
    });

    it("应该处理负数tokens（calculateCost）", () => {
      tokenTracker = new TokenTracker(mockDatabase);

      const result = tokenTracker.calculateCost("openai", "gpt-4o", -100, -50);

      // Should treat negative as 0 or handle gracefully
      expect(result.costUsd).toBeLessThanOrEqual(0);
    });

    it("应该处理超大tokens（calculateCost）", () => {
      tokenTracker = new TokenTracker(mockDatabase);

      const result = tokenTracker.calculateCost(
        "openai",
        "gpt-4o",
        10000000, // 10M tokens
        5000000, // 5M tokens
      );

      expect(result.costUsd).toBeGreaterThan(0);
      expect(Number.isFinite(result.costUsd)).toBe(true);
    });
  });
});
