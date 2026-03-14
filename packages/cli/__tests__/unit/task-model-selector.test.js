import { describe, it, expect } from "vitest";
import {
  detectTaskType,
  selectModelForTask,
  getTaskName,
  getTaskTypes,
  TaskType,
} from "../../src/lib/task-model-selector.js";

describe("Task Model Selector", () => {
  // ─── detectTaskType ─────────────────────────────────────────

  describe("detectTaskType", () => {
    it("should default to chat for empty input", () => {
      expect(detectTaskType("").taskType).toBe(TaskType.CHAT);
      expect(detectTaskType(null).taskType).toBe(TaskType.CHAT);
      expect(detectTaskType(undefined).taskType).toBe(TaskType.CHAT);
    });

    it("should default to chat for non-string input", () => {
      expect(detectTaskType(123).taskType).toBe(TaskType.CHAT);
      expect(detectTaskType({}).taskType).toBe(TaskType.CHAT);
      expect(detectTaskType(false).taskType).toBe(TaskType.CHAT);
    });

    it("should default to chat for generic messages", () => {
      const result = detectTaskType("hello, how are you?");
      expect(result.taskType).toBe(TaskType.CHAT);
      expect(result.confidence).toBe(0);
      expect(result.name).toBeTruthy();
    });

    it("should detect code tasks (English)", () => {
      expect(detectTaskType("write a function to sort an array").taskType).toBe(
        TaskType.CODE,
      );
      expect(detectTaskType("debug this javascript error").taskType).toBe(
        TaskType.CODE,
      );
      expect(detectTaskType("refactor the API endpoint").taskType).toBe(
        TaskType.CODE,
      );
      expect(detectTaskType("implement a binary search").taskType).toBe(
        TaskType.CODE,
      );
    });

    it("should detect code tasks (Chinese)", () => {
      expect(detectTaskType("写一个Python函数").taskType).toBe(TaskType.CODE);
      expect(detectTaskType("帮我调试这段代码").taskType).toBe(TaskType.CODE);
      expect(detectTaskType("重构这个方法").taskType).toBe(TaskType.CODE);
      expect(detectTaskType("实现一个排序算���").taskType).toBe(TaskType.CODE);
    });

    it("should detect code tasks from language keywords", () => {
      expect(detectTaskType("how to use React hooks").taskType).toBe(
        TaskType.CODE,
      );
      expect(detectTaskType("fix the SQL query").taskType).toBe(TaskType.CODE);
      expect(detectTaskType("create a Vue component").taskType).toBe(
        TaskType.CODE,
      );
      expect(detectTaskType("install npm packages").taskType).toBe(
        TaskType.CODE,
      );
      expect(detectTaskType("git commit and push").taskType).toBe(
        TaskType.CODE,
      );
    });

    it("should detect code tasks from code blocks", () => {
      const msg = "What does this do?\n```\nconst x = 1;\n```";
      expect(detectTaskType(msg).taskType).toBe(TaskType.CODE);
    });

    it("should detect reasoning tasks (English)", () => {
      expect(
        detectTaskType("analyze the pros and cons of this approach").taskType,
      ).toBe(TaskType.REASONING);
      expect(
        detectTaskType("explain why this algorithm is O(n log n)").taskType,
      ).toBe(TaskType.REASONING);
      expect(detectTaskType("step by step think through this").taskType).toBe(
        TaskType.REASONING,
      );
      expect(detectTaskType("compare microservices vs monolith").taskType).toBe(
        TaskType.REASONING,
      );
      expect(detectTaskType("evaluate these two options").taskType).toBe(
        TaskType.REASONING,
      );
    });

    it("should detect reasoning tasks (Chinese)", () => {
      expect(detectTaskType("分析这个方案的优缺点").taskType).toBe(
        TaskType.REASONING,
      );
      expect(detectTaskType("逐步推理这个问题").taskType).toBe(
        TaskType.REASONING,
      );
      expect(detectTaskType("深度思考一下").taskType).toBe(TaskType.REASONING);
    });

    it("should detect translation tasks (English)", () => {
      expect(detectTaskType("translate this to Chinese").taskType).toBe(
        TaskType.TRANSLATE,
      );
      expect(detectTaskType("what is the translation of hello").taskType).toBe(
        TaskType.TRANSLATE,
      );
    });

    it("should detect translation tasks (Chinese)", () => {
      expect(detectTaskType("翻译成英文").taskType).toBe(TaskType.TRANSLATE);
      expect(detectTaskType("英译中这段话").taskType).toBe(TaskType.TRANSLATE);
    });

    it("should detect creative tasks (English)", () => {
      expect(detectTaskType("write a short story about AI").taskType).toBe(
        TaskType.CREATIVE,
      );
      expect(detectTaskType("compose an essay about space").taskType).toBe(
        TaskType.CREATIVE,
      );
      expect(detectTaskType("create a poem about nature").taskType).toBe(
        TaskType.CREATIVE,
      );
    });

    it("should detect creative tasks (Chinese)", () => {
      expect(detectTaskType("写一篇关于AI的文章").taskType).toBe(
        TaskType.CREATIVE,
      );
      expect(detectTaskType("创作一首诗").taskType).toBe(TaskType.CREATIVE);
    });

    it("should detect fast response tasks (English)", () => {
      expect(detectTaskType("quick question about dates").taskType).toBe(
        TaskType.FAST,
      );
      expect(detectTaskType("give me a brief answer").taskType).toBe(
        TaskType.FAST,
      );
      expect(detectTaskType("short summary please").taskType).toBe(
        TaskType.FAST,
      );
    });

    it("should detect fast response tasks (Chinese)", () => {
      expect(detectTaskType("简短回答一下").taskType).toBe(TaskType.FAST);
      expect(detectTaskType("一句话总结").taskType).toBe(TaskType.FAST);
    });

    it("should prioritize code over creative for ambiguous messages", () => {
      // "write a function" matches both CREATIVE (write) and CODE (function)
      // CODE has higher priority (10 > 7)
      const result = detectTaskType("write a function");
      expect(result.taskType).toBe(TaskType.CODE);
    });

    it("should prioritize translate over reasoning for 'translate' keyword", () => {
      // "translate" is TRANSLATE (priority 9) > "analyze" is REASONING (priority 8)
      const result = detectTaskType("translate and analyze this document");
      expect(result.taskType).toBe(TaskType.TRANSLATE);

      const result2 = detectTaskType("translate this text to English");
      expect(result2.taskType).toBe(TaskType.TRANSLATE);
    });

    it("should have confidence > 0 for detected tasks", () => {
      const result = detectTaskType("debug this code");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should have higher confidence with multiple keyword matches", () => {
      const singleMatch = detectTaskType("debug something");
      const multiMatch = detectTaskType(
        "debug this javascript code and refactor",
      );
      expect(multiMatch.confidence).toBeGreaterThanOrEqual(
        singleMatch.confidence,
      );
    });

    it("should return name field for all detected types", () => {
      expect(detectTaskType("write code").name).toBeTruthy();
      expect(detectTaskType("analyze this").name).toBeTruthy();
      expect(detectTaskType("translate").name).toBeTruthy();
      expect(detectTaskType("hello").name).toBeTruthy();
    });
  });

  // ─── selectModelForTask ─────────────────────────────────────

  describe("selectModelForTask", () => {
    const ALL_PROVIDERS = [
      "volcengine",
      "openai",
      "anthropic",
      "deepseek",
      "dashscope",
      "gemini",
      "mistral",
      "ollama",
    ];

    it("should return correct volcengine models for all task types", () => {
      expect(selectModelForTask("volcengine", TaskType.CHAT)).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(selectModelForTask("volcengine", TaskType.CODE)).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(selectModelForTask("volcengine", TaskType.REASONING)).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(selectModelForTask("volcengine", TaskType.FAST)).toBe(
        "doubao-seed-1-6-lite-251015",
      );
      expect(selectModelForTask("volcengine", TaskType.TRANSLATE)).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(selectModelForTask("volcengine", TaskType.CREATIVE)).toBe(
        "doubao-seed-1-6-251015",
      );
    });

    it("should return correct openai models", () => {
      expect(selectModelForTask("openai", TaskType.CODE)).toBe("gpt-4o");
      expect(selectModelForTask("openai", TaskType.FAST)).toBe("gpt-4o-mini");
      expect(selectModelForTask("openai", TaskType.REASONING)).toBe("o1");
    });

    it("should return correct anthropic models", () => {
      expect(selectModelForTask("anthropic", TaskType.CODE)).toBe(
        "claude-sonnet-4-6",
      );
      expect(selectModelForTask("anthropic", TaskType.REASONING)).toBe(
        "claude-opus-4-6",
      );
      expect(selectModelForTask("anthropic", TaskType.FAST)).toBe(
        "claude-haiku-4-5-20251001",
      );
    });

    it("should return correct deepseek models", () => {
      expect(selectModelForTask("deepseek", TaskType.CODE)).toBe(
        "deepseek-coder",
      );
      expect(selectModelForTask("deepseek", TaskType.REASONING)).toBe(
        "deepseek-reasoner",
      );
      expect(selectModelForTask("deepseek", TaskType.CHAT)).toBe(
        "deepseek-chat",
      );
    });

    it("should have a model for every provider × task type combination", () => {
      const taskTypes = Object.values(TaskType);
      for (const provider of ALL_PROVIDERS) {
        for (const taskType of taskTypes) {
          const model = selectModelForTask(provider, taskType);
          expect(
            model,
            `Missing model for ${provider}/${taskType}`,
          ).toBeTruthy();
        }
      }
    });

    it("should return null for unknown provider", () => {
      expect(selectModelForTask("unknown-provider", TaskType.CODE)).toBeNull();
    });

    it("should return null for unknown task type", () => {
      expect(selectModelForTask("volcengine", "nonexistent")).toBeNull();
    });

    it("should return different models for fast vs reasoning on volcengine", () => {
      const fastModel = selectModelForTask("volcengine", TaskType.FAST);
      const reasoningModel = selectModelForTask(
        "volcengine",
        TaskType.REASONING,
      );
      expect(fastModel).not.toBe(reasoningModel);
    });
  });

  // ─── getTaskName ────────────────────────────────────────────

  describe("getTaskName", () => {
    it("should return task names for all known types", () => {
      const taskTypes = Object.values(TaskType);
      for (const type of taskTypes) {
        const name = getTaskName(type);
        expect(name).toBeTruthy();
        expect(name).not.toBe(type); // Should be a display name, not the enum value
      }
    });

    it("should return task type string for unknown types", () => {
      expect(getTaskName("unknown")).toBe("unknown");
    });
  });

  // ─── getTaskTypes ───────────────────────────────────────────

  describe("getTaskTypes", () => {
    it("should return all 6 task types", () => {
      const types = getTaskTypes();
      expect(Object.keys(types)).toHaveLength(6);
      expect(types.CHAT).toBe("chat");
      expect(types.CODE).toBe("code");
      expect(types.REASONING).toBe("reasoning");
      expect(types.FAST).toBe("fast");
      expect(types.TRANSLATE).toBe("translate");
      expect(types.CREATIVE).toBe("creative");
    });

    it("should return a copy (not reference)", () => {
      const types1 = getTaskTypes();
      const types2 = getTaskTypes();
      types1.CUSTOM = "custom";
      expect(types2.CUSTOM).toBeUndefined();
    });
  });
});
