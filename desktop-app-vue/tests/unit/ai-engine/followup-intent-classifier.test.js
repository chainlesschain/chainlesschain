/**
 * FollowupIntentClassifier 单元测试
 * 测试后续输入意图分类系统的所有功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("FollowupIntentClassifier", () => {
  let FollowupIntentClassifier;
  let classifier;
  let mockLLMService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock LLM service
    mockLLMService = {
      complete: vi.fn(),
    };

    // Dynamic import
    const module =
      await import("../../../src/main/ai-engine/followup-intent-classifier.js");
    FollowupIntentClassifier = module.default;

    classifier = new FollowupIntentClassifier(mockLLMService);
  });

  describe("初始化", () => {
    it("应该创建FollowupIntentClassifier实例", () => {
      expect(classifier).toBeInstanceOf(FollowupIntentClassifier);
      expect(classifier.llmService).toBe(mockLLMService);
    });

    it("应该初始化规则库", () => {
      expect(classifier.rules).toBeDefined();
      expect(classifier.rules.CONTINUE_EXECUTION).toBeDefined();
      expect(classifier.rules.MODIFY_REQUIREMENT).toBeDefined();
      expect(classifier.rules.CLARIFICATION).toBeDefined();
      expect(classifier.rules.CANCEL_TASK).toBeDefined();
    });

    it("应该包含关键词和模式", () => {
      expect(classifier.rules.CONTINUE_EXECUTION.keywords).toContain("继续");
      expect(classifier.rules.CONTINUE_EXECUTION.patterns).toHaveLength(3);
    });
  });

  describe("规则分类 - _ruleBasedClassify", () => {
    describe("CONTINUE_EXECUTION (继续执行)", () => {
      it("应该识别'继续'", () => {
        const result = classifier._ruleBasedClassify("继续");

        expect(result.intent).toBe("CONTINUE_EXECUTION");
        expect(result.confidence).toBeGreaterThan(0.8);
      });

      it("应该识别'好的'", () => {
        const result = classifier._ruleBasedClassify("好的");

        expect(result.intent).toBe("CONTINUE_EXECUTION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it("应该识别'ok'", () => {
        const result = classifier._ruleBasedClassify("ok");

        expect(result.intent).toBe("CONTINUE_EXECUTION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it("应该识别'快点开始'", () => {
        const result = classifier._ruleBasedClassify("快点开始");

        expect(result.intent).toBe("CONTINUE_EXECUTION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别空输入", () => {
        const result = classifier._ruleBasedClassify("");

        expect(result.intent).toBe("CONTINUE_EXECUTION");
        expect(result.confidence).toBe(0.9);
        expect(result.reason).toContain("空输入");
      });

      it("应该识别过短输入", () => {
        const result = classifier._ruleBasedClassify("嗯");

        expect(result.intent).toBe("CONTINUE_EXECUTION");
        expect(result.confidence).toBe(1.0);
      });
    });

    describe("MODIFY_REQUIREMENT (修改需求)", () => {
      it("应该识别'改成红色'", () => {
        const result = classifier._ruleBasedClassify("改成红色");

        expect(result.intent).toBe("MODIFY_REQUIREMENT");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'不要导航栏'", () => {
        const result = classifier._ruleBasedClassify("不要导航栏");

        expect(result.intent).toBe("MODIFY_REQUIREMENT");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'加上登录功能'", () => {
        const result = classifier._ruleBasedClassify("加上登录功能");

        expect(result.intent).toBe("MODIFY_REQUIREMENT");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'换成蓝色'", () => {
        const result = classifier._ruleBasedClassify("换成蓝色");

        expect(result.intent).toBe("MODIFY_REQUIREMENT");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'去掉按钮'", () => {
        const result = classifier._ruleBasedClassify("去掉按钮");

        expect(result.intent).toBe("MODIFY_REQUIREMENT");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });
    });

    describe("CLARIFICATION (补充说明)", () => {
      it("应该识别'用宋体'", () => {
        const result = classifier._ruleBasedClassify("用宋体");

        expect(result.intent).toBe("CLARIFICATION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'颜色是红色'", () => {
        const result = classifier._ruleBasedClassify("颜色是红色");

        expect(result.intent).toBe("CLARIFICATION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'字体用微软雅黑'", () => {
        const result = classifier._ruleBasedClassify("字体用微软雅黑");

        expect(result.intent).toBe("CLARIFICATION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'数据来源是users.csv'", () => {
        const result = classifier._ruleBasedClassify("数据来源是users.csv");

        expect(result.intent).toBe("CLARIFICATION");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });
    });

    describe("CANCEL_TASK (取消任务)", () => {
      it("应该识别'算了'", () => {
        const result = classifier._ruleBasedClassify("算了吧");

        expect(result.intent).toBe("CANCEL_TASK");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'不用了'", () => {
        const result = classifier._ruleBasedClassify("不用了");

        expect(result.intent).toBe("CANCEL_TASK");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'停止'", () => {
        const result = classifier._ruleBasedClassify("停止吧");

        expect(result.intent).toBe("CANCEL_TASK");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });

      it("应该识别'取消任务'", () => {
        const result = classifier._ruleBasedClassify("取消任务");

        expect(result.intent).toBe("CANCEL_TASK");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      });
    });

    it("应该返回分数对象", () => {
      const result = classifier._ruleBasedClassify("继续吧");

      expect(result.scores).toBeDefined();
      expect(result.scores.CONTINUE_EXECUTION).toBeGreaterThan(0);
    });

    it("应该返回置信度在0-1之间", () => {
      const result = classifier._ruleBasedClassify("继续继续继续");

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe("LLM分类 - _llmBasedClassify", () => {
    it("应该调用LLM服务", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CONTINUE_EXECUTION",
          confidence: 0.9,
          reason: "用户确认继续",
        }),
      });

      const result = await classifier._llmBasedClassify("继续", {});

      expect(mockLLMService.complete).toHaveBeenCalled();
      expect(result.intent).toBe("CONTINUE_EXECUTION");
    });

    it("应该传递上下文信息到LLM", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "MODIFY_REQUIREMENT",
          confidence: 0.8,
          reason: "用户修改需求",
        }),
      });

      const context = {
        currentTask: { name: "创建网页" },
        taskPlan: { steps: [] },
        conversationHistory: [{ role: "user", content: "创建一个网页" }],
      };

      await classifier._llmBasedClassify("改成红色", context);

      const callArgs = mockLLMService.complete.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[1].role).toBe("user");
    });

    it("应该设置低温度参数", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CLARIFICATION",
          confidence: 0.7,
          reason: "用户补充说明",
        }),
      });

      await classifier._llmBasedClassify("用宋体", {});

      const callArgs = mockLLMService.complete.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it("应该解析LLM返回的JSON", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CANCEL_TASK",
          confidence: 0.95,
          reason: "用户取消任务",
          extractedInfo: "停止执行",
        }),
      });

      const result = await classifier._llmBasedClassify("算了", {});

      expect(result.intent).toBe("CANCEL_TASK");
      expect(result.confidence).toBe(0.95);
      expect(result.reason).toBe("用户取消任务");
      expect(result.extractedInfo).toBe("停止执行");
    });
  });

  describe("JSON解析 - _parseJSON", () => {
    it("应该解析标准JSON", () => {
      const json = JSON.stringify({
        intent: "CONTINUE_EXECUTION",
        confidence: 0.9,
        reason: "测试",
      });

      const result = classifier._parseJSON(json);

      expect(result.intent).toBe("CONTINUE_EXECUTION");
      expect(result.confidence).toBe(0.9);
    });

    it("应该移除markdown代码块", () => {
      const json = `\`\`\`json
{
  "intent": "MODIFY_REQUIREMENT",
  "confidence": 0.8,
  "reason": "测试"
}
\`\`\``;

      const result = classifier._parseJSON(json);

      expect(result.intent).toBe("MODIFY_REQUIREMENT");
    });

    it("应该设置默认置信度", () => {
      const json = JSON.stringify({
        intent: "CLARIFICATION",
        reason: "测试",
      });

      const result = classifier._parseJSON(json);

      expect(result.confidence).toBe(0.7);
    });

    it("应该设置默认理由", () => {
      const json = JSON.stringify({
        intent: "CANCEL_TASK",
        confidence: 0.9,
      });

      const result = classifier._parseJSON(json);

      expect(result.reason).toBe("无理由");
    });

    it("应该验证意图类型", () => {
      const json = JSON.stringify({
        intent: "INVALID_INTENT",
        confidence: 0.9,
        reason: "测试",
      });

      expect(() => classifier._parseJSON(json)).toThrow(
        "Failed to parse LLM response",
      );
    });

    it("应该抛出JSON解析错误", () => {
      const invalidJson = "not a json";

      expect(() => classifier._parseJSON(invalidJson)).toThrow();
    });
  });

  describe("主分类方法 - classify", () => {
    it("应该使用规则分类（高置信度）", async () => {
      const result = await classifier.classify("继续");

      expect(result.intent).toBe("CONTINUE_EXECUTION");
      expect(result.method).toBe("rule");
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it("应该使用LLM分类（低置信度）", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "MODIFY_REQUIREMENT",
          confidence: 0.85,
          reason: "用户要修改颜色",
        }),
      });

      const result = await classifier.classify(
        "这个地方是不是可以优化一下",
        {},
      );

      expect(result.intent).toBe("MODIFY_REQUIREMENT");
      expect(result.method).toBe("llm");
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it("应该在LLM失败时降级到规则", async () => {
      mockLLMService.complete.mockRejectedValue(new Error("LLM服务错误"));

      const result = await classifier.classify("改成红色", {});

      expect(result.method).toBe("rule_fallback");
      expect(result.intent).toBeDefined();
    });

    it("应该在规则和LLM都失败时返回默认值", async () => {
      mockLLMService.complete.mockRejectedValue(new Error("LLM服务错误"));

      const result = await classifier.classify("一些模糊的输入", {});

      expect(result.intent).toBeDefined();
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it("应该传递上下文到LLM", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CLARIFICATION",
          confidence: 0.8,
          reason: "补充说明",
        }),
      });

      const context = {
        currentTask: { name: "创建网页" },
      };

      const result = await classifier.classify("模糊输入", context);

      expect(mockLLMService.complete).toHaveBeenCalled();
      expect(result.intent).toBe("CLARIFICATION");
    });
  });

  describe("批量分类 - classifyBatch", () => {
    it("应该分类多个输入", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CONTINUE_EXECUTION",
          confidence: 0.9,
          reason: "测试",
        }),
      });

      const inputs = ["继续", "好的", "ok"];
      const results = await classifier.classifyBatch(inputs);

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r.input).toBeDefined();
        expect(r.result.intent).toBeDefined();
      });
    });

    it("应该返回输入和结果的映射", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CONTINUE_EXECUTION",
          confidence: 0.9,
          reason: "测试",
        }),
      });

      const results = await classifier.classifyBatch(["继续"]);

      expect(results[0].input).toBe("继续");
      expect(results[0].result).toBeDefined();
    });

    it("应该处理空数组", async () => {
      const results = await classifier.classifyBatch([]);

      expect(results).toHaveLength(0);
    });
  });

  describe("统计信息 - getStats", () => {
    it("应该返回规则数量", () => {
      const stats = classifier.getStats();

      expect(stats.rulesCount).toBe(4);
    });

    it("应该返回关键词总数", () => {
      const stats = classifier.getStats();

      expect(stats.keywordsCount).toBeGreaterThan(0);
    });

    it("应该返回模式总数", () => {
      const stats = classifier.getStats();

      expect(stats.patternsCount).toBeGreaterThan(0);
    });

    it("应该包含所有统计字段", () => {
      const stats = classifier.getStats();

      expect(stats).toHaveProperty("rulesCount");
      expect(stats).toHaveProperty("keywordsCount");
      expect(stats).toHaveProperty("patternsCount");
    });
  });

  describe("边界情况", () => {
    it("应该处理空字符串", async () => {
      const result = await classifier.classify("");

      expect(result.intent).toBe("CONTINUE_EXECUTION");
      expect(result.confidence).toBe(0.9);
    });

    it("应该处理极长输入", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CLARIFICATION",
          confidence: 0.8,
          reason: "长文本",
        }),
      });

      const longInput = "这是一个非常长的输入".repeat(100);
      const result = await classifier.classify(longInput);

      expect(result.intent).toBeDefined();
    });

    it("应该处理特殊字符", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CLARIFICATION",
          confidence: 0.8,
          reason: "特殊字符",
        }),
      });

      const result = await classifier.classify("@#$%^&*()");

      expect(result.intent).toBeDefined();
    });

    it("应该处理Unicode字符", async () => {
      const result = await classifier.classify("继续 😀");

      expect(result.intent).toBeDefined();
    });

    it("应该处理空格前缀", async () => {
      const result = await classifier.classify("   继续   ");

      expect(result.intent).toBe("CONTINUE_EXECUTION");
    });

    it("应该处理无上下文", async () => {
      mockLLMService.complete.mockResolvedValue({
        content: JSON.stringify({
          intent: "CLARIFICATION",
          confidence: 0.8,
          reason: "无上下文",
        }),
      });

      const result = await classifier.classify("模糊输入");

      expect(result.intent).toBeDefined();
    });

    it("应该处理大小写混合", async () => {
      const result = await classifier.classify("OK");

      expect(result.intent).toBe("CONTINUE_EXECUTION");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe("性能测试", () => {
    it("规则分类应该快速完成", async () => {
      // Warm up to exclude one-time lazy-init cost from the measurement.
      await classifier.classify("继续");

      const start = Date.now();
      await classifier.classify("继续");
      const duration = Date.now() - start;

      // Rule-based classification does no network/LLM work, so it must stay
      // well under a second. A generous bound keeps this robust under heavy
      // parallel-test load while still catching a real regression (e.g. an
      // accidental LLM fallback, which would take multiple seconds).
      expect(duration).toBeLessThan(1000);
    });

    it("应该记录延迟时间", async () => {
      const result = await classifier.classify("继续");

      expect(result.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe("意图优先级", () => {
    it("完全匹配应该覆盖部分匹配", () => {
      const result = classifier._ruleBasedClassify("OK好的");

      expect(result.intent).toBe("CONTINUE_EXECUTION");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("应该选择最高分数的意图", () => {
      const result = classifier._ruleBasedClassify("改成红色继续");

      expect(result.scores).toBeDefined();
      expect(result.intent).toBeDefined();
    });
  });
});
