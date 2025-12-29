/**
 * SkillManager单元测试
 * 
 * 测试技能管理器的核心功能
 */

const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const SkillManager = require('../../src/main/skill-tool-system/skill-manager');
const ToolManager = require('../../src/main/skill-tool-system/tool-manager');

describe('SkillManager', () => {
  let skillManager;
  let toolManager;
  let mockDatabase;

  beforeEach(async () => {
    // 创建模拟数据库
    mockDatabase = {
      prepare: jest.fn(),
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
    };

    // 创建ToolManager和SkillManager实例
    toolManager = new ToolManager(mockDatabase, {});
    skillManager = new SkillManager(mockDatabase, toolManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerSkill', () => {
    it('应该成功注册新技能', async () => {
      const skillData = {
        id: 'test_skill',
        name: '测试技能',
        category: 'test',
        enabled: 1,
        is_builtin: 0,
      };

      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await expect(skillManager.registerSkill(skillData)).resolves.not.toThrow();
    });

    it('应该验证必填字段', async () => {
      const invalidSkill = {
        id: 'test_skill',
        // 缺少name和category
      };

      await expect(skillManager.registerSkill(invalidSkill)).rejects.toThrow();
    });

    it('应该防止重复ID', async () => {
      const skillData = {
        id: 'test_skill',
        name: '测试技能',
        category: 'test',
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

  describe('getSkill', () => {
    it('应该返回存在的技能', async () => {
      const mockSkill = {
        id: 'test_skill',
        name: '测试技能',
        category: 'test',
      };

      mockDatabase.get.mockResolvedValue(mockSkill);

      const skill = await skillManager.getSkill('test_skill');
      expect(skill).toEqual(mockSkill);
    });

    it('应该在技能不存在时返回null', async () => {
      mockDatabase.get.mockResolvedValue(null);

      const skill = await skillManager.getSkill('nonexistent');
      expect(skill).toBeNull();
    });
  });

  describe('enableSkill / disableSkill', () => {
    it('应该启用技能', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.enableSkill('test_skill');

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE skills'),
        expect.objectContaining({ enabled: 1 })
      );
    });

    it('应该禁用技能', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.disableSkill('test_skill');

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE skills'),
        expect.objectContaining({ enabled: 0 })
      );
    });
  });

  describe('addToolToSkill', () => {
    it('应该成功添加工具到技能', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.addToolToSkill('test_skill', 'test_tool', 'primary');

      expect(mockDatabase.run).toHaveBeenCalled();
    });

    it('应该防止重复添加同一工具', async () => {
      // 第一次添加成功
      mockDatabase.get.mockResolvedValueOnce(null);
      mockDatabase.run.mockResolvedValue({ changes: 1 });
      await skillManager.addToolToSkill('test_skill', 'test_tool');

      // 第二次应该失败或更新
      mockDatabase.get.mockResolvedValueOnce({ skill_id: 'test_skill', tool_id: 'test_tool' });
      await expect(
        skillManager.addToolToSkill('test_skill', 'test_tool')
      ).rejects.toThrow();
    });
  });

  describe('getSkillsByCategory', () => {
    it('应该返回指定分类的所有技能', async () => {
      const mockSkills = [
        { id: 'skill1', category: 'code' },
        { id: 'skill2', category: 'code' },
      ];

      mockDatabase.all.mockResolvedValue(mockSkills);

      const skills = await skillManager.getSkillsByCategory('code');
      expect(skills).toHaveLength(2);
      expect(skills).toEqual(mockSkills);
    });
  });

  describe('recordSkillUsage', () => {
    it('应该记录技能使用统计', async () => {
      mockDatabase.run.mockResolvedValue({ changes: 1 });

      await skillManager.recordSkillUsage('test_skill', true, 1000);

      expect(mockDatabase.run).toHaveBeenCalled();
    });
  });
});
