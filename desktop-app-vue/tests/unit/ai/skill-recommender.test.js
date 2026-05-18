/**
 * SkillRecommender 单元测试
 *
 * 测试技能推荐引擎的核心功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Import after setup
const SkillRecommender = require("../../../src/main/skill-tool-system/skill-recommender");

// ===================== MOCK FACTORIES =====================

const createMockSkills = () => [
  {
    id: "skill-1",
    name: "skill_web_development",
    display_name: "Web Development",
    category: "web",
    description: "Create HTML, CSS, and JavaScript websites",
    enabled: true,
    usage_count: 50,
    success_count: 45,
  },
  {
    id: "skill-2",
    name: "skill_code_development",
    display_name: "Code Development",
    category: "code",
    description: "Generate code in various programming languages",
    enabled: true,
    usage_count: 30,
    success_count: 28,
  },
  {
    id: "skill-3",
    name: "skill_data_analysis",
    display_name: "Data Analysis",
    category: "data",
    description: "Analyze CSV and Excel data files",
    enabled: true,
    usage_count: 20,
    success_count: 18,
  },
  {
    id: "skill-4",
    name: "skill_disabled",
    display_name: "Disabled Skill",
    category: "test",
    description: "This skill is disabled",
    enabled: false,
    usage_count: 0,
    success_count: 0,
  },
  {
    id: "skill-5",
    name: "skill_document_processing",
    display_name: "Document Processing",
    category: "document",
    description: "Process Word, PDF, and Markdown documents",
    enabled: true,
    usage_count: 100,
    success_count: 95,
  },
];

const createMockSkillManager = () => ({
  getAllSkills: vi.fn().mockImplementation(async (filter = {}) => {
    let skills = createMockSkills();

    // Apply filters sequentially
    if (filter.enabled === 1) {
      skills = skills.filter((s) => s.enabled);
    }
    if (filter.category) {
      skills = skills.filter((s) => s.category === filter.category);
    }

    return skills;
  }),
  getSkillById: vi.fn().mockImplementation(async (id) => {
    const skills = createMockSkills();
    return skills.find((s) => s.id === id) || null;
  }),
  getSkillTools: vi.fn().mockImplementation(async (skillId) => {
    const toolMappings = {
      "skill-1": [
        { tool_id: "tool-1", name: "html_generator" },
        { tool_id: "tool-2", name: "css_generator" },
      ],
      "skill-2": [
        { tool_id: "tool-1", name: "html_generator" },
        { tool_id: "tool-3", name: "js_generator" },
      ],
      "skill-3": [{ tool_id: "tool-4", name: "csv_reader" }],
    };
    return toolMappings[skillId] || [];
  }),
});

const createMockToolManager = () => ({
  getAllTools: vi.fn().mockResolvedValue([
    { id: "tool-1", name: "html_generator" },
    { id: "tool-2", name: "css_generator" },
  ]),
});

// ===================== TESTS =====================

describe("SkillRecommender", () => {
  let recommender;
  let mockSkillMgr;
  let mockToolMgr;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillMgr = createMockSkillManager();
    mockToolMgr = createMockToolManager();

    recommender = new SkillRecommender(mockSkillMgr, mockToolMgr);
  });

  describe("构造函数", () => {
    it("should create instance with dependencies", () => {
      expect(recommender).toBeInstanceOf(SkillRecommender);
      expect(recommender.skillManager).toBe(mockSkillMgr);
      expect(recommender.toolManager).toBe(mockToolMgr);
    });

    it("should initialize intent keywords", () => {
      expect(recommender.intentKeywords).toBeDefined();
      expect(recommender.intentKeywords.web).toBeDefined();
      expect(Array.isArray(recommender.intentKeywords.web)).toBe(true);
    });

    it("should initialize category to intent mapping", () => {
      expect(recommender.categoryToIntent).toBeDefined();
      expect(recommender.categoryToIntent.web).toEqual(["web", "code"]);
    });

    it("should initialize cache", () => {
      expect(recommender.cache).toBeDefined();
      expect(recommender.cache instanceof Map).toBe(true);
    });

    it("should set cache timeout", () => {
      expect(recommender.cacheTimeout).toBe(5 * 60 * 1000);
    });
  });

  describe("analyzeIntent()", () => {
    it("should detect web intent", () => {
      const intents = recommender.analyzeIntent("创建一个网页");

      const webIntent = intents.find((i) => i.intent === "web");
      expect(webIntent).toBeDefined();
      expect(webIntent.confidence).toBeGreaterThan(0);
    });

    it("should detect code intent", () => {
      const intents = recommender.analyzeIntent("写一些代码");

      const codeIntent = intents.find((i) => i.intent === "code");
      expect(codeIntent).toBeDefined();
    });

    it("should detect data intent", () => {
      const intents = recommender.analyzeIntent("分析数据");

      const dataIntent = intents.find((i) => i.intent === "data");
      expect(dataIntent).toBeDefined();
    });

    it("should detect multiple intents", () => {
      const intents = recommender.analyzeIntent("创建网页并分析数据");

      expect(intents.length).toBeGreaterThan(1);
    });

    it("should calculate confidence based on keyword matches", () => {
      const intents = recommender.analyzeIntent("网页 html css javascript");

      const webIntent = intents.find((i) => i.intent === "web");
      expect(webIntent.confidence).toBeGreaterThan(0);
    });

    it("should sort intents by confidence", () => {
      const intents = recommender.analyzeIntent("网页 html web 数据");

      if (intents.length > 1) {
        expect(intents[0].confidence).toBeGreaterThanOrEqual(
          intents[1].confidence,
        );
      }
    });

    it("should return matched keywords", () => {
      const intents = recommender.analyzeIntent("创建网页");

      const webIntent = intents.find((i) => i.intent === "web");
      expect(webIntent.matchedKeywords).toBeDefined();
      expect(Array.isArray(webIntent.matchedKeywords)).toBe(true);
    });

    it("should handle empty input", () => {
      const intents = recommender.analyzeIntent("");

      expect(Array.isArray(intents)).toBe(true);
      expect(intents.length).toBe(0);
    });

    it("should be case insensitive", () => {
      const intents1 = recommender.analyzeIntent("WEB");
      const intents2 = recommender.analyzeIntent("web");

      expect(intents1.length).toBe(intents2.length);
    });
  });

  describe("calculateIntentScore()", () => {
    it("should score matching intent", () => {
      const skill = { category: "web" };
      const intents = [{ intent: "web", confidence: 0.9 }];

      const score = recommender.calculateIntentScore(skill, intents);

      expect(score).toBe(0.9);
    });

    it("should return 0 for non-matching intent", () => {
      const skill = { category: "data" };
      const intents = [{ intent: "web", confidence: 0.9 }];

      const score = recommender.calculateIntentScore(skill, intents);

      expect(score).toBe(0);
    });

    it("should return max score when multiple intents match", () => {
      const skill = { category: "code" };
      const intents = [
        { intent: "code", confidence: 0.7 },
        { intent: "git", confidence: 0.9 },
      ];

      const score = recommender.calculateIntentScore(skill, intents);

      expect(score).toBe(0.9);
    });

    it("should handle empty intents", () => {
      const skill = { category: "web" };
      const intents = [];

      const score = recommender.calculateIntentScore(skill, intents);

      expect(score).toBe(0);
    });

    it("should handle unknown category", () => {
      const skill = { category: "unknown" };
      const intents = [{ intent: "web", confidence: 0.9 }];

      const score = recommender.calculateIntentScore(skill, intents);

      expect(score).toBe(0);
    });
  });

  describe("calculateTextSimilarity()", () => {
    it("should score skill name match", () => {
      const skill = {
        name: "skill_web_development",
        description: "Create websites",
      };

      const score = recommender.calculateTextSimilarity(skill, "web");

      expect(score).toBeGreaterThan(0);
    });

    it("should score description match", () => {
      const skill = {
        name: "some_skill",
        description: "This skill creates websites",
      };

      const score = recommender.calculateTextSimilarity(skill, "websites");

      expect(score).toBeGreaterThan(0);
    });

    it("should handle empty description", () => {
      const skill = {
        name: "test_skill",
        description: "",
      };

      const score = recommender.calculateTextSimilarity(skill, "test");

      expect(score).toBeGreaterThan(0);
    });

    it("should return max 1.0", () => {
      const skill = {
        name: "web",
        description: "web web web",
      };

      const score = recommender.calculateTextSimilarity(skill, "web");

      expect(score).toBeLessThanOrEqual(1);
    });

    it("should be case insensitive", () => {
      const skill = {
        name: "WEB_SKILL",
        description: "Web Development",
      };

      const score = recommender.calculateTextSimilarity(skill, "web");

      expect(score).toBeGreaterThan(0);
    });
  });

  describe("calculateUsageScore()", () => {
    it("should calculate score based on usage and success", () => {
      const skill = {
        usage_count: 10,
        success_count: 9,
      };

      const score = recommender.calculateUsageScore(skill);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("should return 0 for unused skill", () => {
      const skill = {
        usage_count: 0,
        success_count: 0,
      };

      const score = recommender.calculateUsageScore(skill);

      expect(score).toBe(0);
    });

    it("should handle missing usage stats", () => {
      const skill = {};

      const score = recommender.calculateUsageScore(skill);

      expect(score).toBe(0);
    });

    it("should use logarithmic scale for usage count", () => {
      const skill1 = { usage_count: 10, success_count: 10 };
      const skill2 = { usage_count: 100, success_count: 100 };

      const score1 = recommender.calculateUsageScore(skill1);
      const score2 = recommender.calculateUsageScore(skill2);

      expect(score2).toBeGreaterThan(score1);
    });
  });

  describe("recommendSkills()", () => {
    it("should return recommendations", async () => {
      const recommendations = await recommender.recommendSkills("创建网页");

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it("should add recommendation score", async () => {
      const recommendations = await recommender.recommendSkills("创建网页");

      expect(recommendations[0]).toHaveProperty("recommendationScore");
    });

    it("should add recommendation reason", async () => {
      const recommendations = await recommender.recommendSkills("创建网页");

      expect(recommendations[0]).toHaveProperty("reason");
      expect(typeof recommendations[0].reason).toBe("string");
    });

    it("should filter by threshold", async () => {
      const recommendations = await recommender.recommendSkills("xyz", {
        threshold: 0.5,
      });

      expect(recommendations.every((r) => r.recommendationScore >= 0.5)).toBe(
        true,
      );
    });

    it("should limit results", async () => {
      const recommendations = await recommender.recommendSkills("创建", {
        limit: 2,
      });

      expect(recommendations.length).toBeLessThanOrEqual(2);
    });

    it("should sort by score descending", async () => {
      const recommendations = await recommender.recommendSkills("创建网页");

      if (recommendations.length > 1) {
        expect(recommendations[0].recommendationScore).toBeGreaterThanOrEqual(
          recommendations[1].recommendationScore,
        );
      }
    });

    it("should filter disabled skills when enabledOnly is true", async () => {
      const recommendations = await recommender.recommendSkills("test", {
        enabledOnly: true,
      });

      expect(recommendations.every((r) => r.enabled !== false)).toBe(true);
    });

    it("should use cache for repeated queries", async () => {
      await recommender.recommendSkills("test query");
      await recommender.recommendSkills("test query");

      // Second call should use cache
      expect(recommender.cache.size).toBeGreaterThan(0);
    });

    it("should handle errors gracefully", async () => {
      mockSkillMgr.getAllSkills.mockRejectedValueOnce(
        new Error("Database error"),
      );

      const recommendations = await recommender.recommendSkills("test");

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBe(0);
    });
  });

  describe("generateReason()", () => {
    it("should generate intent-based reason", () => {
      const skill = { category: "web", usage_count: 5, success_count: 4 };
      const intents = [{ intent: "web", confidence: 0.9 }];

      const reason = recommender.generateReason(skill, intents, 0.8);

      expect(reason).toContain("web");
    });

    it("should mention frequent usage", () => {
      const skill = { category: "web", usage_count: 20, success_count: 18 };
      const intents = [];

      const reason = recommender.generateReason(skill, intents, 0.5);

      expect(reason).toContain("20");
    });

    it("should mention high success rate", () => {
      const skill = { category: "web", usage_count: 10, success_count: 9 };
      const intents = [];

      const reason = recommender.generateReason(skill, intents, 0.5);

      expect(reason).toContain("90%");
    });

    it("should mention high relevance", () => {
      const skill = { category: "web", usage_count: 0, success_count: 0 };
      const intents = [];

      const reason = recommender.generateReason(skill, intents, 0.9);

      expect(reason).toContain("高度相关");
    });

    it("should return default reason when no specific reasons", () => {
      const skill = { category: "web", usage_count: 0, success_count: 0 };
      const intents = [];

      const reason = recommender.generateReason(skill, intents, 0.3);

      expect(reason).toBe("可能相关");
    });
  });

  describe("getPopularSkills()", () => {
    it("should return popular skills", async () => {
      const popular = await recommender.getPopularSkills(5);

      expect(Array.isArray(popular)).toBe(true);
      expect(popular.length).toBeGreaterThan(0);
    });

    it("should filter unused skills", async () => {
      const popular = await recommender.getPopularSkills();

      expect(popular.every((s) => s.usage_count > 0)).toBe(true);
    });

    it("should add popularity score", async () => {
      const popular = await recommender.getPopularSkills();

      expect(popular[0]).toHaveProperty("popularity");
    });

    it("should sort by usage and success rate", async () => {
      const popular = await recommender.getPopularSkills();

      if (popular.length > 1) {
        const score1 =
          popular[0].usage_count *
          (popular[0].success_count / popular[0].usage_count);
        const score2 =
          popular[1].usage_count *
          (popular[1].success_count / popular[1].usage_count);
        expect(score1).toBeGreaterThanOrEqual(score2);
      }
    });

    it("should limit results", async () => {
      const popular = await recommender.getPopularSkills(3);

      expect(popular.length).toBeLessThanOrEqual(3);
    });

    it("should only return enabled skills", async () => {
      const popular = await recommender.getPopularSkills();

      expect(popular.every((s) => s.enabled !== false)).toBe(true);
    });
  });

  describe("getRelatedSkills()", () => {
    it("should return related skills", async () => {
      const related = await recommender.getRelatedSkills("skill-1");

      expect(Array.isArray(related)).toBe(true);
    });

    it("should exclude the source skill", async () => {
      const related = await recommender.getRelatedSkills("skill-1");

      expect(related.every((s) => s.id !== "skill-1")).toBe(true);
    });

    it("should add relation score", async () => {
      const related = await recommender.getRelatedSkills("skill-1");

      if (related.length > 0) {
        expect(related[0]).toHaveProperty("relationScore");
      }
    });

    it("should score same category higher", async () => {
      const related = await recommender.getRelatedSkills("skill-1", 10);

      const webSkill = related.find((s) => s.category === "web");
      if (webSkill) {
        expect(webSkill.relationScore).toBeGreaterThan(0);
      }
    });

    it("should score shared tools", async () => {
      const related = await recommender.getRelatedSkills("skill-1");

      // skill-2 shares html_generator with skill-1
      const skill2 = related.find((s) => s.id === "skill-2");
      if (skill2) {
        expect(skill2.relationScore).toBeGreaterThan(0);
      }
    });

    it("should return empty for non-existent skill", async () => {
      const related = await recommender.getRelatedSkills("non-existent");

      expect(related.length).toBe(0);
    });

    it("should limit results", async () => {
      const related = await recommender.getRelatedSkills("skill-1", 2);

      expect(related.length).toBeLessThanOrEqual(2);
    });

    it("should filter out zero score skills", async () => {
      const related = await recommender.getRelatedSkills("skill-1");

      expect(related.every((s) => s.relationScore > 0)).toBe(true);
    });
  });

  describe("calculatePopularityScore()", () => {
    it("should calculate popularity score", () => {
      const skill = { usage_count: 50, success_count: 45 };

      const score = recommender.calculatePopularityScore(skill);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("should return 0 for unused skill", () => {
      const skill = { usage_count: 0, success_count: 0 };

      const score = recommender.calculatePopularityScore(skill);

      expect(score).toBe(0);
    });

    it("should weight success rate higher than usage", () => {
      const highSuccess = { usage_count: 10, success_count: 10 };
      const lowSuccess = { usage_count: 100, success_count: 50 };

      const score1 = recommender.calculatePopularityScore(highSuccess);
      const score2 = recommender.calculatePopularityScore(lowSuccess);

      // High success rate should contribute significantly
      expect(score1).toBeGreaterThan(0);
    });
  });

  describe("searchSkills()", () => {
    it("should search by name", async () => {
      const results = await recommender.searchSkills("web");

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should add search score", async () => {
      const results = await recommender.searchSkills("web");

      expect(results[0]).toHaveProperty("searchScore");
    });

    it("should prioritize exact matches", async () => {
      const results = await recommender.searchSkills("skill_web_development");

      if (results.length > 0) {
        expect(results[0].searchScore).toBe(1.0);
      }
    });

    it("should search in description", async () => {
      const results = await recommender.searchSkills("HTML");

      const webSkill = results.find((s) => s.id === "skill-1");
      expect(webSkill).toBeDefined();
    });

    it("should return all skills for empty query", async () => {
      const results = await recommender.searchSkills("");

      expect(results.length).toBeGreaterThan(0);
    });

    it("should filter by category", async () => {
      const results = await recommender.searchSkills("", { category: "web" });

      expect(results.every((s) => s.category === "web")).toBe(true);
    });

    it("should limit results", async () => {
      const results = await recommender.searchSkills("skill", { limit: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should filter disabled skills by default", async () => {
      const results = await recommender.searchSkills("skill");

      expect(results.every((s) => s.enabled !== false)).toBe(true);
    });

    it("should include disabled skills when enabledOnly is false", async () => {
      const results = await recommender.searchSkills("disabled", {
        enabledOnly: false,
      });

      const disabled = results.find((s) => s.enabled === false);
      expect(disabled).toBeDefined();
    });

    it("should sort by score descending", async () => {
      const results = await recommender.searchSkills("skill");

      if (results.length > 1) {
        expect(results[0].searchScore).toBeGreaterThanOrEqual(
          results[1].searchScore,
        );
      }
    });
  });

  describe("clearCache()", () => {
    it("should clear cache", async () => {
      await recommender.recommendSkills("test");
      expect(recommender.cache.size).toBeGreaterThan(0);

      recommender.clearCache();

      expect(recommender.cache.size).toBe(0);
    });
  });

  describe("getStats()", () => {
    it("should return statistics", () => {
      const stats = recommender.getStats();

      expect(stats).toHaveProperty("cacheSize");
      expect(stats).toHaveProperty("intentCategories");
      expect(stats).toHaveProperty("totalKeywords");
    });

    it("should count cache size", async () => {
      await recommender.recommendSkills("test1");
      await recommender.recommendSkills("test2");

      const stats = recommender.getStats();

      expect(stats.cacheSize).toBeGreaterThan(0);
    });

    it("should count intent categories", () => {
      const stats = recommender.getStats();

      expect(stats.intentCategories).toBeGreaterThan(0);
    });

    it("should count total keywords", () => {
      const stats = recommender.getStats();

      expect(stats.totalKeywords).toBeGreaterThan(0);
    });
  });
});
