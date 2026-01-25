/**
 * AISkillScheduler 单元测试
 *
 * 测试AI智能调度器的核心功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Import after setup
const AISkillScheduler = require("../../src/main/skill-tool-system/ai-skill-scheduler");

// ===================== MOCK FACTORIES =====================

const createMockSkillManager = () => ({
  getAllSkills: vi.fn().mockResolvedValue([
    {
      id: "skill-1",
      name: "skill_web_development",
      display_name: "Web Development",
      category: "web",
      tags: ["html", "css", "website"],
      enabled: true,
      usage_count: 10,
      success_count: 9,
      config: { template: "modern" },
    },
    {
      id: "skill-2",
      name: "skill_code_development",
      display_name: "Code Development",
      category: "code",
      tags: ["javascript", "programming"],
      enabled: true,
      usage_count: 5,
      success_count: 4,
      config: {},
    },
    {
      id: "skill-3",
      name: "skill_disabled",
      display_name: "Disabled Skill",
      category: "test",
      tags: [],
      enabled: false,
      usage_count: 0,
      success_count: 0,
      config: {},
    },
  ]),
  getSkillById: vi.fn().mockImplementation((id) => {
    const skills = {
      "skill-1": {
        id: "skill-1",
        name: "skill_web_development",
        category: "web",
        enabled: true,
      },
    };
    return Promise.resolve(skills[id] || null);
  }),
  getSkillTools: vi.fn().mockResolvedValue([
    { id: "tool-1", name: "html_generator" },
    { id: "tool-2", name: "css_generator" },
  ]),
});

const createMockToolManager = () => ({
  getToolByName: vi.fn().mockResolvedValue({
    id: "tool-1",
    name: "html_generator",
    enabled: true,
  }),
});

const createMockSkillExecutor = () => ({
  executeSkill: vi.fn().mockResolvedValue({
    success: true,
    executionId: "exec_123",
    result: { output: "test result" },
  }),
});

const createMockLLMService = () => ({
  chat: vi.fn().mockResolvedValue(`{
    "action": "create",
    "target": "web",
    "entities": { "projectName": "my-website" },
    "confidence": 0.95
  }`),
});

// ===================== TESTS =====================

describe("AISkillScheduler", () => {
  let scheduler;
  let mockSkillMgr;
  let mockToolMgr;
  let mockExecutor;
  let mockLLM;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillMgr = createMockSkillManager();
    mockToolMgr = createMockToolManager();
    mockExecutor = createMockSkillExecutor();
    mockLLM = createMockLLMService();

    scheduler = new AISkillScheduler(
      mockSkillMgr,
      mockToolMgr,
      mockExecutor,
      mockLLM,
    );
  });

  describe("构造函数", () => {
    it("should create instance with dependencies", () => {
      expect(scheduler).toBeInstanceOf(AISkillScheduler);
      expect(scheduler.skillManager).toBe(mockSkillMgr);
      expect(scheduler.toolManager).toBe(mockToolMgr);
      expect(scheduler.skillExecutor).toBe(mockExecutor);
      expect(scheduler.llmService).toBe(mockLLM);
    });

    it("should initialize execution history", () => {
      expect(scheduler.executionHistory).toBeDefined();
      expect(Array.isArray(scheduler.executionHistory)).toBe(true);
    });

    it("should initialize user preferences", () => {
      expect(scheduler.userPreferences).toBeDefined();
      expect(scheduler.userPreferences instanceof Map).toBe(true);
    });

    it("should build intent mapping", () => {
      expect(scheduler.intentSkillMapping).toBeDefined();
      expect(scheduler.intentSkillMapping["create.web"]).toBe(
        "skill_web_development",
      );
    });
  });

  describe("smartSchedule()", () => {
    it("should schedule skill successfully", async () => {
      const result = await scheduler.smartSchedule("创建一个网页");

      expect(result.success).toBe(true);
      expect(result.intent).toBeDefined();
      expect(result.skill).toBeTruthy();
      expect(result.result).toBeDefined();
    });

    it("should handle empty input", async () => {
      const result = await scheduler.smartSchedule("");

      expect(result).toBeDefined();
      // Should still attempt processing even with empty input
    });

    it("should call analyzeIntent", async () => {
      const spy = vi.spyOn(scheduler, "analyzeIntent");
      await scheduler.smartSchedule("创建网页");

      expect(spy).toHaveBeenCalledWith("创建网页", {});
    });

    it("should call recommendSkills", async () => {
      const spy = vi.spyOn(scheduler, "recommendSkills");
      await scheduler.smartSchedule("创建网页");

      expect(spy).toHaveBeenCalled();
    });

    it("should execute selected skill", async () => {
      await scheduler.smartSchedule("创建网页");

      expect(mockExecutor.executeSkill).toHaveBeenCalled();
    });

    it("should learn from execution", async () => {
      const spy = vi.spyOn(scheduler, "learnFromExecution");
      await scheduler.smartSchedule("创建网页");

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("analyzeByKeywords()", () => {
    it("should detect create action", () => {
      const intent = scheduler.analyzeByKeywords("创建一个网页");

      expect(intent.action).toBe("create");
    });

    it("should detect read action", () => {
      const intent = scheduler.analyzeByKeywords("打开文件");

      expect(intent.action).toBe("read");
    });

    it("should detect edit action", () => {
      const intent = scheduler.analyzeByKeywords("修改代码");

      expect(intent.action).toBe("edit");
    });

    it("should detect delete action", () => {
      const intent = scheduler.analyzeByKeywords("删除文件");

      expect(intent.action).toBe("delete");
    });

    it("should detect web target", () => {
      const intent = scheduler.analyzeByKeywords("创建网页");

      expect(intent.target).toBe("web");
    });

    it("should detect code target", () => {
      const intent = scheduler.analyzeByKeywords("写代码");

      expect(intent.target).toBe("code");
    });

    it("should detect document target", () => {
      const intent = scheduler.analyzeByKeywords("处理文档");

      expect(intent.target).toBe("document");
    });

    it("should detect search action", () => {
      const intent = scheduler.analyzeByKeywords("搜索信息");

      expect(intent.action).toBe("search");
    });

    it("should extract entities", () => {
      const intent = scheduler.analyzeByKeywords("创建 test.html 文件");

      expect(intent.entities).toBeDefined();
    });

    it("should set confidence score", () => {
      const intent = scheduler.analyzeByKeywords("创建网页");

      expect(intent.confidence).toBeGreaterThan(0);
    });
  });

  describe("extractEntities()", () => {
    it("should extract file path", () => {
      const entities = scheduler.extractEntities("读取 /path/to/file.txt");

      expect(entities.filePath).toBeTruthy();
    });

    it("should extract project name", () => {
      const entities = scheduler.extractEntities("项目名：my-project");

      expect(entities.projectName).toBe("my-project");
    });

    it("should extract color value", () => {
      const entities = scheduler.extractEntities("使用颜色 #ff0000");

      expect(entities.color).toBe("#ff0000");
    });

    it("should handle no entities", () => {
      const entities = scheduler.extractEntities("简单的输入");

      expect(entities).toBeDefined();
      expect(Object.keys(entities).length).toBe(0);
    });
  });

  describe("analyzeByLLM()", () => {
    it("should call LLM service", async () => {
      await scheduler.analyzeByLLM("创建网页", {});

      expect(mockLLM.chat).toHaveBeenCalled();
    });

    it("should parse JSON response", async () => {
      const intent = await scheduler.analyzeByLLM("创建网页", {});

      expect(intent.action).toBe("create");
      expect(intent.target).toBe("web");
      expect(intent.confidence).toBe(0.95);
    });

    it("should handle markdown wrapped JSON", async () => {
      mockLLM.chat.mockResolvedValueOnce(
        '```json\n{"action":"create","target":"web","confidence":0.9}\n```',
      );

      const intent = await scheduler.analyzeByLLM("创建网页", {});

      expect(intent.action).toBe("create");
    });

    it("should handle parsing errors", async () => {
      mockLLM.chat.mockResolvedValueOnce("invalid json");

      const intent = await scheduler.analyzeByLLM("创建网页", {});

      expect(intent.confidence).toBe(0.3);
    });
  });

  describe("mergeIntents()", () => {
    it("should merge two intents", () => {
      const keywordIntent = {
        action: "create",
        target: "web",
        entities: { color: "#fff" },
        confidence: 0.8,
        rawInput: "test",
      };

      const llmIntent = {
        action: "create",
        target: "web",
        entities: { projectName: "my-project" },
        confidence: 0.95,
      };

      const merged = scheduler.mergeIntents(keywordIntent, llmIntent);

      expect(merged.action).toBe("create");
      expect(merged.confidence).toBe(0.95);
      expect(merged.entities.color).toBe("#fff");
      expect(merged.entities.projectName).toBe("my-project");
    });

    it("should prefer LLM values", () => {
      const keywordIntent = {
        action: null,
        target: "web",
        entities: {},
        confidence: 0.5,
        rawInput: "test",
      };

      const llmIntent = {
        action: "create",
        target: "code",
        entities: {},
        confidence: 0.9,
      };

      const merged = scheduler.mergeIntents(keywordIntent, llmIntent);

      expect(merged.action).toBe("create");
      expect(merged.target).toBe("code");
    });
  });

  describe("recommendSkills()", () => {
    it("should recommend enabled skills", async () => {
      const intent = {
        action: "create",
        target: "web",
        rawInput: "create web",
      };
      const recommendations = await scheduler.recommendSkills(intent, {});

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.every((s) => s.enabled)).toBe(true);
    });

    it("should score skills", async () => {
      const intent = {
        action: "create",
        target: "web",
        rawInput: "create web",
      };
      const recommendations = await scheduler.recommendSkills(intent, {});

      expect(recommendations[0]).toHaveProperty("score");
      expect(recommendations[0].score).toBeGreaterThan(0);
    });

    it("should filter low score skills", async () => {
      const intent = { action: "unknown", target: "unknown", rawInput: "xyz" };
      const recommendations = await scheduler.recommendSkills(intent, {});

      expect(recommendations.every((s) => s.score > 0.3)).toBe(true);
    });

    it("should sort by score descending", async () => {
      const intent = {
        action: "create",
        target: "web",
        rawInput: "create web",
      };
      const recommendations = await scheduler.recommendSkills(intent, {});

      if (recommendations.length > 1) {
        expect(recommendations[0].score).toBeGreaterThanOrEqual(
          recommendations[1].score,
        );
      }
    });

    it("should limit to top 5", async () => {
      const intent = { action: "create", target: "web", rawInput: "create" };
      const recommendations = await scheduler.recommendSkills(intent, {});

      expect(recommendations.length).toBeLessThanOrEqual(5);
    });
  });

  describe("calculateSkillScore()", () => {
    const testSkill = {
      id: "skill-1",
      category: "web",
      tags: ["html", "css"],
      usage_count: 10,
      success_count: 9,
    };

    it("should score category match", () => {
      const intent = { action: "create", target: "web", rawInput: "test" };
      const score = scheduler.calculateSkillScore(testSkill, intent, {});

      expect(score).toBeGreaterThan(0);
    });

    it("should score tag match", () => {
      const intent = {
        action: "create",
        target: "other",
        rawInput: "html css",
      };
      const score = scheduler.calculateSkillScore(testSkill, intent, {});

      expect(score).toBeGreaterThan(0);
    });

    it("should return score between 0 and 1", () => {
      const intent = { action: "create", target: "web", rawInput: "html" };
      const score = scheduler.calculateSkillScore(testSkill, intent, {});

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe("selectBestSkill()", () => {
    it("should select first skill from sorted recommendations", () => {
      // selectBestSkill expects recommendations to be pre-sorted
      const recommendations = [
        { id: "skill-2", score: 0.9 },
        { id: "skill-3", score: 0.7 },
        { id: "skill-1", score: 0.5 },
      ];

      const selected = scheduler.selectBestSkill(recommendations, {}, {});

      expect(selected.id).toBe("skill-2");
      expect(selected).toBe(recommendations[0]);
    });

    it("should throw error if no recommendations", () => {
      expect(() => scheduler.selectBestSkill([], {}, {})).toThrow(
        "没有找到合适的技能",
      );
    });
  });

  describe("generateParams()", () => {
    const testSkill = {
      id: "skill-1",
      name: "test_skill",
      config: { template: "modern", theme: "dark" },
    };

    it("should extract params from intent entities", async () => {
      const intent = {
        entities: { projectName: "my-project", color: "#fff" },
        confidence: 0.9,
      };

      const params = await scheduler.generateParams(testSkill, intent, {});

      expect(params.projectName).toBe("my-project");
      expect(params.color).toBe("#fff");
    });

    it("should merge config defaults", async () => {
      const intent = { entities: {}, confidence: 0.9 };

      const params = await scheduler.generateParams(testSkill, intent, {});

      expect(params.template).toBe("modern");
      expect(params.theme).toBe("dark");
    });

    it("should prefer intent entities over config", async () => {
      const intent = {
        entities: { template: "custom" },
        confidence: 0.9,
      };

      const params = await scheduler.generateParams(testSkill, intent, {});

      expect(params.template).toBe("custom");
    });

    it("should use LLM for low confidence", async () => {
      mockLLM.chat.mockResolvedValueOnce('{"extra": "param"}');

      const intent = { entities: {}, confidence: 0.5 };
      await scheduler.generateParams(testSkill, intent, {});

      expect(mockLLM.chat).toHaveBeenCalled();
    });
  });

  describe("learnFromExecution()", () => {
    it("should record execution history", () => {
      const skill = { id: "skill-1", name: "test_skill" };
      const result = { success: true };

      scheduler.learnFromExecution("test input", skill, result);

      expect(scheduler.executionHistory.length).toBe(1);
      expect(scheduler.executionHistory[0].skillId).toBe("skill-1");
    });

    it("should update user preferences on success", () => {
      const skill = { id: "skill-1", name: "test_skill" };
      const result = { success: true };

      scheduler.learnFromExecution("test input", skill, result);

      expect(scheduler.userPreferences.get("skill-1")).toBeGreaterThan(0);
    });

    it("should not update preferences on failure", () => {
      const skill = { id: "skill-1", name: "test_skill" };
      const result = { success: false };

      scheduler.learnFromExecution("test input", skill, result);

      expect(scheduler.userPreferences.get("skill-1")).toBeUndefined();
    });

    it("should limit history to 1000 records", () => {
      const skill = { id: "skill-1", name: "test_skill" };
      const result = { success: true };

      // Add 1005 records
      for (let i = 0; i < 1005; i++) {
        scheduler.learnFromExecution(`input ${i}`, skill, result);
      }

      expect(scheduler.executionHistory.length).toBe(1000);
    });
  });

  describe("getUserPreference()", () => {
    it("should return preference value", () => {
      scheduler.userPreferences.set("skill-1", 0.5);

      const pref = scheduler.getUserPreference("skill-1");

      expect(pref).toBe(0.5);
    });

    it("should return 0 for unknown skill", () => {
      const pref = scheduler.getUserPreference("unknown-skill");

      expect(pref).toBe(0);
    });

    it("should cap preference at 1.0", () => {
      scheduler.userPreferences.set("skill-1", 5.0);

      const pref = scheduler.getUserPreference("skill-1");

      expect(pref).toBe(1.0);
    });
  });

  describe("getSkillByIntentMapping()", () => {
    it("should return mapped skill name", () => {
      const intent = { action: "create", target: "web" };

      const skillName = scheduler.getSkillByIntentMapping(intent);

      expect(skillName).toBe("skill_web_development");
    });

    it("should return null for unmapped intent", () => {
      const intent = { action: "unknown", target: "unknown" };

      const skillName = scheduler.getSkillByIntentMapping(intent);

      expect(skillName).toBeNull();
    });
  });

  describe("processBatch()", () => {
    it("should process multiple inputs", async () => {
      const inputs = ["创建网页", "生成代码"];

      const result = await scheduler.processBatch(inputs);

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.results.length).toBe(2);
    });

    it("should update context between tasks", async () => {
      const inputs = ["任务1", "任务2"];

      const result = await scheduler.processBatch(inputs);

      expect(result.results).toBeDefined();
    });

    it("should handle empty input array", async () => {
      const result = await scheduler.processBatch([]);

      expect(result.total).toBe(0);
      expect(result.results.length).toBe(0);
    });
  });

  describe("getRecommendationStats()", () => {
    beforeEach(() => {
      // Add some execution history
      scheduler.executionHistory = [
        { skillId: "skill-1", skillName: "skill1" },
        { skillId: "skill-1", skillName: "skill1" },
        { skillId: "skill-2", skillName: "skill2" },
      ];
    });

    it("should return statistics", () => {
      const stats = scheduler.getRecommendationStats();

      expect(stats).toHaveProperty("totalExecutions");
      expect(stats).toHaveProperty("uniqueSkills");
      expect(stats).toHaveProperty("topSkills");
    });

    it("should count total executions", () => {
      const stats = scheduler.getRecommendationStats();

      expect(stats.totalExecutions).toBe(3);
    });

    it("should count unique skills", () => {
      const stats = scheduler.getRecommendationStats();

      expect(stats.uniqueSkills).toBe(2);
    });

    it("should sort top skills by usage", () => {
      const stats = scheduler.getRecommendationStats();

      expect(stats.topSkills[0].skillId).toBe("skill-1");
      expect(stats.topSkills[0].count).toBe(2);
    });

    it("should calculate percentages", () => {
      const stats = scheduler.getRecommendationStats();

      expect(stats.topSkills[0].percentage).toBeDefined();
    });

    it("should limit to top 10 skills", () => {
      // Add many different skills
      for (let i = 0; i < 20; i++) {
        scheduler.executionHistory.push({
          skillId: `skill-${i}`,
          skillName: `skill${i}`,
        });
      }

      const stats = scheduler.getRecommendationStats();

      expect(stats.topSkills.length).toBeLessThanOrEqual(10);
    });
  });
});
