/**
 * SkillManager单元测试
 *
 * 测试技能管理器的核心功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 动态导入CommonJS模块
let SkillManager;
let ToolManager;

describe("SkillManager", () => {
  let skillManager;
  let toolManager;
  let mockDatabase;

  beforeEach(async () => {
    // 动态导入模块
    SkillManager = (
      await import("../../src/main/skill-tool-system/skill-manager.js")
    ).default;
    ToolManager = (
      await import("../../src/main/skill-tool-system/tool-manager.js")
    ).default;

    // 创建模拟数据库
    mockDatabase = {
      prepare: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    };

    // 创建ToolManager和SkillManager实例
    toolManager = new ToolManager(mockDatabase, {});
    skillManager = new SkillManager(mockDatabase, toolManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("registerSkill", () => {
    it("应该成功注册新技能", async () => {
      const skillData = {
        id: "test_skill",
        name: "测试技能",
        category: "test",
        enabled: 1,
        is_builtin: 0,
      };

      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await expect(
        skillManager.registerSkill(skillData),
      ).resolves.not.toThrow();
    });

    it("应该验证必填字段", async () => {
      const invalidSkill = {
        id: "test_skill",
        // 缺少name和category
      };

      await expect(skillManager.registerSkill(invalidSkill)).rejects.toThrow();
    });

    it("应该防止重复ID", async () => {
      const skillData = {
        id: "test_skill",
        name: "测试技能",
        category: "test",
      };

      // 第一次注册成功
      mockDatabase.get.mockResolvedValueOnce(null);
      mockDatabase.run.mockResolvedValue({ changes: 1 });
      await skillManager.registerSkill(skillData);

      // 第二次应该失败
      mockDatabase.get.mockResolvedValueOnce(skillData);
      await expect(skillManager.registerSkill(skillData)).rejects.toThrow();
    });
  });

  describe("getSkill", () => {
    it("应该返回存在的技能", async () => {
      const mockSkill = {
        id: "test_skill",
        name: "测试技能",
        category: "test",
      };

      mockDatabase.get.mockResolvedValue(mockSkill);

      const skill = await skillManager.getSkill("test_skill");
      expect(skill).toEqual(mockSkill);
    });

    it("应该在技能不存在时返回null", async () => {
      mockDatabase.get.mockResolvedValue(null);

      const skill = await skillManager.getSkill("nonexistent");
      expect(skill).toBeNull();
    });
  });

  describe("enableSkill / disableSkill", () => {
    it("应该启用技能", async () => {
      const mockSkill = { id: "test_skill", name: "测试技能" };
      mockDatabase.get.mockResolvedValue(mockSkill);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.enableSkill("test_skill");

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE skills"),
        expect.arrayContaining([1]), // enabled = 1
      );
    });

    it("应该禁用技能", async () => {
      const mockSkill = { id: "test_skill", name: "测试技能" };
      mockDatabase.get.mockResolvedValue(mockSkill);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.disableSkill("test_skill");

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE skills"),
        expect.arrayContaining([0]), // enabled = 0
      );
    });
  });

  describe("addToolToSkill", () => {
    it("应该成功添加工具到技能", async () => {
      const mockSkill = { id: "test_skill", name: "测试技能" };
      const mockTool = { id: "test_tool", name: "测试工具" };

      mockDatabase.get.mockResolvedValueOnce(mockSkill); // getSkill
      // Mock toolManager.getTool - need to set up the method
      skillManager.toolManager.getTool = vi.fn().mockResolvedValue(mockTool);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.addToolToSkill("test_skill", "test_tool", "primary");

      expect(mockDatabase.run).toHaveBeenCalled();
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO skill_tools"),
        expect.any(Array),
      );
    });

    it("应该允许更新现有工具关联", async () => {
      const mockSkill = { id: "test_skill", name: "测试技能" };
      const mockTool = { id: "test_tool", name: "测试工具" };

      // 第一次添加
      mockDatabase.get.mockResolvedValue(mockSkill);
      skillManager.toolManager.getTool = vi.fn().mockResolvedValue(mockTool);
      mockDatabase.run.mockResolvedValue({ changes: 1 });
      await skillManager.addToolToSkill("test_skill", "test_tool", "primary");

      // 第二次更新（不应该失败）
      mockDatabase.get.mockResolvedValue(mockSkill);
      await expect(
        skillManager.addToolToSkill("test_skill", "test_tool", "secondary"),
      ).resolves.not.toThrow();
    });
  });

  describe("getSkillsByCategory", () => {
    it("应该返回指定分类的所有技能", async () => {
      const mockSkills = [
        { id: "skill1", category: "code", config: "{}", tags: "[]" },
        { id: "skill2", category: "code", config: "{}", tags: "[]" },
      ];

      mockDatabase.all.mockResolvedValue(mockSkills);

      const result = await skillManager.getSkillsByCategory("code");
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(2);
      expect(result.skills[0].id).toBe("skill1");
      expect(result.skills[1].id).toBe("skill2");
    });
  });

  describe("recordSkillUsage", () => {
    it("应该记录技能使用统计", async () => {
      const mockSkill = {
        id: "test_skill",
        name: "测试技能",
        usage_count: 5,
        success_count: 3,
      };

      mockDatabase.get.mockResolvedValue(mockSkill);
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.recordSkillUsage("test_skill", true, 1000);

      // 应该调用db.run更新usage_count和success_count
      expect(mockDatabase.run).toHaveBeenCalled();
      // 第一次调用应该是更新skills表
      const firstCall = mockDatabase.run.mock.calls[0];
      expect(firstCall[0]).toContain("UPDATE skills");
      expect(firstCall[1]).toContain(6); // usage_count + 1
      expect(firstCall[1]).toContain(4); // success_count + 1
    });
  });
});
