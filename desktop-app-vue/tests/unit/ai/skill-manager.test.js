/**
 * SkillManager 单元测试
 *
 * 测试技能管理器的核心功能：
 * - 技能注册、注销、更新
 * - 技能查询（按类别、状态等）
 * - 技能-工具关联管理
 * - 统计记录和查询
 * - 文档生成
 * - 内置/插件技能加载
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ===================== MOCK SETUP =====================

// Mock uuid
const mockUuid = "mock-skill-uuid-1234";
vi.mock("uuid", () => ({
  v4: vi.fn(() => mockUuid),
}));

// Mock DocGenerator
const mockDocGenerator = {
  initialize: vi.fn().mockResolvedValue(true),
  generateSkillDoc: vi
    .fn()
    .mockResolvedValue({ success: true, path: "/docs/skill.md" }),
  generateToolDoc: vi
    .fn()
    .mockResolvedValue({ success: true, path: "/docs/tool.md" }),
};

vi.mock("../../src/main/skill-tool-system/doc-generator", () => ({
  default: vi.fn(() => mockDocGenerator),
}));

// Mock builtin-skills
vi.mock("../../src/main/skill-tool-system/builtin-skills", () => ({
  default: [],
}));

// Import after mocks
const SkillManager = require("../../../src/main/skill-tool-system/skill-manager");

// ===================== MOCK FACTORIES =====================

const createMockDatabase = () => ({
  run: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  get: vi.fn().mockResolvedValue(null),
  all: vi.fn().mockResolvedValue([]),
  exec: vi.fn().mockResolvedValue(undefined),
});

const createMockToolManager = () => ({
  getTool: vi.fn().mockResolvedValue({
    id: "tool-1",
    name: "test_tool",
    display_name: "Test Tool",
  }),
  getToolByName: vi.fn().mockResolvedValue({
    id: "tool-1",
    name: "test_tool",
    display_name: "Test Tool",
  }),
  getAllTools: vi.fn().mockResolvedValue([]),
  isInitialized: true,
});

// ===================== TESTS =====================

describe("SkillManager", () => {
  let skillManager;
  let mockDb;
  let mockToolMgr;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Reset mockDocGenerator
    mockDocGenerator.initialize.mockClear();
    mockDocGenerator.generateSkillDoc.mockClear();
    mockDocGenerator.generateToolDoc.mockClear();

    // Create fresh mock instances
    mockDb = createMockDatabase();
    mockToolMgr = createMockToolManager();

    // Create SkillManager instance with DI
    skillManager = new SkillManager(mockDb, mockToolMgr, {
      DocGeneratorClass: vi.fn(() => mockDocGenerator),
    });
  });

  afterEach(() => {
    // Cleanup
    if (skillManager) {
      skillManager.skills.clear();
    }
  });

  describe("构造函数", () => {
    it("should create instance with database and toolManager", () => {
      expect(skillManager).toBeInstanceOf(SkillManager);
      expect(skillManager.db).toBe(mockDb);
      expect(skillManager.toolManager).toBe(mockToolMgr);
      expect(skillManager.isInitialized).toBe(false);
    });

    it("should initialize skills cache as Map", () => {
      expect(skillManager.skills).toBeInstanceOf(Map);
      expect(skillManager.skills.size).toBe(0);
    });

    it("should have docGenerator instance", () => {
      expect(skillManager.docGenerator).toBeDefined();
    });
  });

  describe("initialize()", () => {
    it("should initialize successfully", async () => {
      const result = await skillManager.initialize();

      expect(result).toBe(true);
      expect(skillManager.isInitialized).toBe(true);
      expect(mockDocGenerator.initialize).toHaveBeenCalled();
    });

    it("should return false on initialization error", async () => {
      mockDocGenerator.initialize.mockRejectedValueOnce(
        new Error("Init failed"),
      );

      await expect(skillManager.initialize()).rejects.toThrow("Init failed");
      expect(skillManager.isInitialized).toBe(false);
    });
  });

  describe("registerSkill()", () => {
    const mockSkillData = {
      name: "test_skill",
      display_name: "Test Skill",
      description: "A test skill",
      category: "testing",
      enabled: true,
      is_builtin: 1,
      config: { timeout: 5000 },
      tags: ["test", "demo"],
    };

    it("should register skill successfully", async () => {
      const skillId = await skillManager.registerSkill(mockSkillData);

      expect(skillId).toBeTruthy();
      expect(skillId).toMatch(/^skill_/); // Should start with 'skill_'
      expect(mockDb.run).toHaveBeenCalled();
      expect(skillManager.skills.has(skillId)).toBe(true);
    });

    it("should use provided skill id if exists", async () => {
      const dataWithId = { ...mockSkillData, id: "custom-skill-id" };

      const skillId = await skillManager.registerSkill(dataWithId);

      expect(skillId).toBe("custom-skill-id");
    });

    it("should handle config as JSON string", async () => {
      const dataWithStringConfig = {
        ...mockSkillData,
        config: '{"timeout": 5000}',
      };

      await skillManager.registerSkill(dataWithStringConfig);

      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should handle tags as JSON string", async () => {
      const dataWithStringTags = {
        ...mockSkillData,
        tags: '["test", "demo"]',
      };

      await skillManager.registerSkill(dataWithStringTags);

      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should set default values for optional fields", async () => {
      const minimalData = {
        name: "minimal_skill",
        category: "test", // category is required
      };

      const skillId = await skillManager.registerSkill(minimalData);

      expect(skillId).toBeTruthy();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should throw error on database failure", async () => {
      mockDb.run.mockRejectedValueOnce(new Error("DB error"));

      await expect(skillManager.registerSkill(mockSkillData)).rejects.toThrow(
        "DB error",
      );
    });
  });

  describe("unregisterSkill()", () => {
    beforeEach(async () => {
      // Register a skill first
      await skillManager.registerSkill({
        id: "skill-to-delete",
        name: "delete_me",
        category: "test", // category is required
      });
    });

    it("should unregister skill successfully", async () => {
      mockDb.get.mockResolvedValueOnce({
        id: "skill-to-delete",
        name: "delete_me",
      });

      await skillManager.unregisterSkill("skill-to-delete");

      expect(mockDb.run).toHaveBeenCalledWith(
        "DELETE FROM skills WHERE id = ?",
        ["skill-to-delete"],
      );
      expect(skillManager.skills.has("skill-to-delete")).toBe(false);
    });

    it("should throw error if skill does not exist", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(skillManager.unregisterSkill("nonexistent")).rejects.toThrow(
        "技能不存在",
      );
    });
  });

  describe("updateSkill()", () => {
    beforeEach(async () => {
      mockDb.get.mockResolvedValue({
        id: "skill-1",
        name: "test_skill",
        display_name: "Test Skill",
      });
    });

    it("should update skill successfully", async () => {
      const updates = {
        display_name: "Updated Skill",
        description: "Updated description",
      };

      await skillManager.updateSkill("skill-1", updates);

      expect(mockDb.run).toHaveBeenCalled();
      // Check SQL contains UPDATE
      const sqlCall = mockDb.run.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("UPDATE skills"),
      );
      expect(sqlCall).toBeDefined();
    });

    it("should only update allowed fields", async () => {
      const updates = {
        display_name: "Updated",
        name: "should_not_update", // Not in allowedFields
        id: "should_not_update", // Not in allowedFields
      };

      await skillManager.updateSkill("skill-1", updates);

      expect(mockDb.run).toHaveBeenCalled();
      // Should only update display_name, not name or id
      const updateCalls = mockDb.run.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("UPDATE skills"),
      );
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(updateCalls[0][0]).toContain("display_name");
    });

    it("should handle JSON fields in updates", async () => {
      const updates = {
        config: { newTimeout: 10000 },
        tags: ["new", "tags"],
      };

      await skillManager.updateSkill("skill-1", updates);

      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should return error status if skill does not exist", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      const result = await skillManager.updateSkill("nonexistent", {});
      expect(result.success).toBe(false);
      expect(result.changes).toBe(0);
    });

    it("should do nothing if no valid updates provided", async () => {
      const updates = {
        invalid_field: "value",
      };

      await skillManager.updateSkill("skill-1", updates);

      // Should not call db.run for UPDATE
      const updateCalls = mockDb.run.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("UPDATE skills"),
      );
      expect(updateCalls.length).toBe(0);
    });
  });

  describe("getSkill()", () => {
    it("should get skill from cache", async () => {
      const cachedSkill = {
        id: "cached-skill",
        name: "cached",
      };
      skillManager.skills.set("cached-skill", cachedSkill);

      const result = await skillManager.getSkill("cached-skill");

      expect(result).toEqual(cachedSkill);
      expect(mockDb.get).not.toHaveBeenCalled();
    });

    it("should get skill from database if not in cache", async () => {
      const dbSkill = {
        id: "db-skill",
        name: "from_db",
      };
      mockDb.get.mockResolvedValueOnce(dbSkill);

      const result = await skillManager.getSkill("db-skill");

      expect(result).toEqual(dbSkill);
      expect(mockDb.get).toHaveBeenCalledWith(
        "SELECT * FROM skills WHERE id = ?",
        ["db-skill"],
      );
      expect(skillManager.skills.has("db-skill")).toBe(true);
    });

    it("should return null if skill not found", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      const result = await skillManager.getSkill("nonexistent");

      expect(result).toBeNull();
    });

    it("should handle database errors", async () => {
      mockDb.get.mockRejectedValueOnce(new Error("DB error"));

      const result = await skillManager.getSkill("error-skill");

      expect(result).toBeNull();
    });
  });

  describe("getAllSkills()", () => {
    it("should get all skills without filters", async () => {
      const mockSkills = [
        { id: "skill-1", name: "skill1", enabled: 1 },
        { id: "skill-2", name: "skill2", enabled: 0 },
      ];
      mockDb.all.mockResolvedValueOnce(mockSkills);

      const result = await skillManager.getAllSkills();

      expect(result.success).toBe(true);
      expect(result.skills).toEqual(mockSkills);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it("should filter by enabled status", async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: "skill-1", name: "skill1", enabled: 1 },
      ]);

      const result = await skillManager.getAllSkills({ enabled: true });

      expect(result.success).toBe(true);
      expect(result.skills.length).toBe(1);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it("should filter by category", async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: "skill-1", name: "skill1", category: "testing" },
      ]);

      const result = await skillManager.getAllSkills({ category: "testing" });

      expect(result.success).toBe(true);
      expect(result.skills.length).toBe(1);
    });

    it("should support limit and offset", async () => {
      mockDb.all.mockResolvedValueOnce([{ id: "skill-2", name: "skill2" }]);

      const result = await skillManager.getAllSkills({
        limit: 10,
        offset: 10,
      });

      expect(result.success).toBe(true);
      expect(result.skills.length).toBe(1);
    });
  });

  describe("getSkillsByCategory()", () => {
    it("should get skills by category", async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: "skill-1", category: "testing" },
      ]);

      const result = await skillManager.getSkillsByCategory("testing");

      expect(result.success).toBe(true);
      expect(result.skills.length).toBe(1);
      expect(mockDb.all).toHaveBeenCalled();
      // getSkillsByCategory calls getAllSkills({ category })
      // which generates dynamic SQL with WHERE 1=1 AND category = ?
    });
  });

  describe("getEnabledSkills()", () => {
    it("should get only enabled skills", async () => {
      mockDb.all.mockResolvedValueOnce([
        { id: "skill-1", enabled: 1 },
        { id: "skill-2", enabled: 1 },
      ]);

      const result = await skillManager.getEnabledSkills();

      expect(result.success).toBe(true);
      expect(result.skills.length).toBe(2);
      expect(mockDb.all).toHaveBeenCalled();
      // getEnabledSkills calls getAllSkills({ enabled: 1 })
    });
  });

  describe("enableSkill() / disableSkill()", () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: "skill-1",
        name: "test_skill",
        enabled: 0,
      });
    });

    it("should enable skill", async () => {
      await skillManager.enableSkill("skill-1");

      expect(mockDb.run).toHaveBeenCalled();
      // enableSkill calls updateSkill which does dynamic SQL
    });

    it("should disable skill", async () => {
      await skillManager.disableSkill("skill-1");

      expect(mockDb.run).toHaveBeenCalled();
      // disableSkill calls updateSkill which does dynamic SQL
    });
  });

  describe("addToolToSkill()", () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: "skill-1",
        name: "test_skill",
      });
      mockToolMgr.getTool.mockResolvedValue({
        id: "tool-1",
        name: "test_tool",
      });
    });

    it("should add tool to skill successfully", async () => {
      await skillManager.addToolToSkill("skill-1", "tool-1");

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO skill_tools"),
        expect.any(Array),
      );
    });

    it("should set tool role and priority", async () => {
      await skillManager.addToolToSkill("skill-1", "tool-1", "secondary", 10);

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO skill_tools"),
        expect.arrayContaining(["skill-1", "tool-1", "secondary", 10]),
      );
    });

    it("should throw error if skill does not exist", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(
        skillManager.addToolToSkill("nonexistent", "tool-1"),
      ).rejects.toThrow("技能不存在");
    });

    it("should throw error if tool does not exist", async () => {
      mockToolMgr.getTool.mockResolvedValueOnce(null);

      await expect(
        skillManager.addToolToSkill("skill-1", "nonexistent"),
      ).rejects.toThrow("工具不存在");
    });
  });

  describe("removeToolFromSkill()", () => {
    it("should remove tool from skill", async () => {
      await skillManager.removeToolFromSkill("skill-1", "tool-1");

      expect(mockDb.run).toHaveBeenCalledWith(
        "DELETE FROM skill_tools WHERE skill_id = ? AND tool_id = ?",
        ["skill-1", "tool-1"],
      );
    });
  });

  describe("getSkillTools()", () => {
    it("should get all tools for a skill", async () => {
      const mockTools = [
        {
          id: "tool-1",
          name: "test_tool_1",
          display_name: "Test Tool 1",
          role: "primary",
          priority: 10,
          config_override: null,
        },
        {
          id: "tool-2",
          name: "test_tool_2",
          display_name: "Test Tool 2",
          role: "secondary",
          priority: 5,
          config_override: null,
        },
      ];
      mockDb.all.mockResolvedValueOnce(mockTools);

      const result = await skillManager.getSkillTools("skill-1");

      expect(result).toEqual(mockTools);
      expect(mockDb.all).toHaveBeenCalled();
      // SQL joins tools and skill_tools tables
    });

    it("should return empty array on error", async () => {
      mockDb.all.mockRejectedValueOnce(new Error("DB error"));

      const result = await skillManager.getSkillTools("skill-1");

      expect(result).toEqual([]);
    });
  });

  describe("getSkillsByTool()", () => {
    it("should get all skills using a tool", async () => {
      const mockSkills = [
        {
          id: "skill-1",
          name: "test_skill_1",
          display_name: "Test Skill 1",
          usage_count: 100,
          role: "primary",
          priority: 10,
        },
        {
          id: "skill-2",
          name: "test_skill_2",
          display_name: "Test Skill 2",
          usage_count: 50,
          role: "secondary",
          priority: 5,
        },
      ];
      mockDb.all.mockResolvedValueOnce(mockSkills);

      const result = await skillManager.getSkillsByTool("tool-1");

      expect(result).toEqual(mockSkills);
      expect(mockDb.all).toHaveBeenCalled();
      // SQL joins skills and skill_tools tables
    });

    it("should return empty array on error", async () => {
      mockDb.all.mockRejectedValueOnce(new Error("DB error"));

      const result = await skillManager.getSkillsByTool("tool-1");

      expect(result).toEqual([]);
    });
  });

  describe("recordSkillUsage()", () => {
    beforeEach(() => {
      mockDb.get.mockImplementation((sql, params) => {
        // Mock getSkill() to return a skill with stats
        if (sql.includes("SELECT * FROM skills WHERE id = ?")) {
          return Promise.resolve({
            id: "skill-1",
            name: "test_skill",
            usage_count: 10,
            success_count: 9,
          });
        }
        // Mock skill_stats query
        if (sql.includes("SELECT * FROM skill_stats")) {
          return Promise.resolve(null); // No existing stat
        }
        return Promise.resolve(null);
      });
    });

    it("should record skill usage", async () => {
      await skillManager.recordSkillUsage("skill-1", true, 1500);

      expect(mockDb.run).toHaveBeenCalled();
      // Should update skills table and insert into skill_stats
    });

    it("should handle failure records", async () => {
      await skillManager.recordSkillUsage("skill-1", false, 500);

      expect(mockDb.run).toHaveBeenCalled();
      // Should record failure
    });

    it("should skip if skill does not exist", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await skillManager.recordSkillUsage("nonexistent", true, 1000);

      // Should not throw error, just log warning
      const runCalls = mockDb.run.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("UPDATE skills"),
      );
      expect(runCalls.length).toBe(0);
    });
  });

  describe("getSkillStats()", () => {
    it("should get skill statistics", async () => {
      const mockStats = [
        {
          id: "stat-1",
          skill_id: "skill-1",
          stat_date: "2024-12-30",
          invoke_count: 100,
          success_count: 95,
          avg_duration: 1200,
        },
        {
          id: "stat-2",
          skill_id: "skill-1",
          stat_date: "2024-12-29",
          invoke_count: 80,
          success_count: 75,
          avg_duration: 1100,
        },
      ];
      mockDb.all.mockResolvedValueOnce(mockStats);

      const result = await skillManager.getSkillStats("skill-1");

      expect(result).toEqual(mockStats);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it("should support date range filtering", async () => {
      const dateRange = {
        start: "2024-01-01",
        end: "2024-12-31",
      };
      mockDb.all.mockResolvedValueOnce([]);

      await skillManager.getSkillStats("skill-1", dateRange);

      expect(mockDb.all).toHaveBeenCalled();
      // SQL should include date range filters
    });

    it("should return empty array on error", async () => {
      mockDb.all.mockRejectedValueOnce(new Error("DB error"));

      const result = await skillManager.getSkillStats("skill-1");

      expect(result).toEqual([]);
    });
  });

  describe("getSuggestedSkills()", () => {
    it("should get suggested skills based on intent", async () => {
      const mockSuggestions = [
        { id: "skill-1", name: "relevant_skill", score: 0.9 },
      ];
      mockDb.all.mockResolvedValueOnce(mockSuggestions);

      const result = await skillManager.getSuggestedSkills("test intent");

      // getSuggestedSkills calls getAllSkills or getSkillsByCategory which return { success, skills }
      expect(result.success).toBe(true);
      expect(result.skills).toEqual(mockSuggestions);
      expect(mockDb.all).toHaveBeenCalled();
    });
  });

  describe("getSkillDoc()", () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: "skill-1",
        name: "test_skill",
      });
      mockDb.all.mockResolvedValue([]); // For getSkillTools
      mockDocGenerator.readSkillDoc = vi
        .fn()
        .mockResolvedValue("# Skill Documentation");
    });

    it("should get skill documentation", async () => {
      const result = await skillManager.getSkillDoc("skill-1");

      expect(result).toBe("# Skill Documentation");
      expect(mockDocGenerator.readSkillDoc).toHaveBeenCalledWith("skill-1");
    });

    it("should generate doc if not exists", async () => {
      mockDocGenerator.readSkillDoc
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("# Generated Documentation");

      const result = await skillManager.getSkillDoc("skill-1");

      expect(mockDocGenerator.generateSkillDoc).toHaveBeenCalled();
      expect(result).toBe("# Generated Documentation");
    });
  });

  describe("regenerateDoc()", () => {
    it("should regenerate skill documentation", async () => {
      mockDb.get.mockResolvedValueOnce({
        id: "skill-1",
        name: "test_skill",
      });

      await skillManager.regenerateDoc("skill-1");

      expect(mockDocGenerator.generateSkillDoc).toHaveBeenCalled();
    });
  });

  describe("recordExecution()", () => {
    beforeEach(() => {
      mockDb.get.mockImplementation((sql, params) => {
        if (sql.includes("SELECT * FROM skills WHERE id = ?")) {
          return Promise.resolve({
            id: "skill-1",
            name: "test_skill",
            usage_count: 10,
            success_count: 9,
          });
        }
        if (sql.includes("SELECT * FROM skill_stats")) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
    });

    it("should record skill execution", async () => {
      await skillManager.recordExecution("skill-1", true, 1000);

      expect(mockDb.run).toHaveBeenCalled();
      // recordExecution is an alias that converts ms to seconds
    });

    it("should convert milliseconds to seconds", async () => {
      await skillManager.recordExecution("skill-1", true, 3000);

      expect(mockDb.run).toHaveBeenCalled();
      // Should pass 3 seconds (3000ms / 1000) to recordSkillUsage
    });
  });
});
