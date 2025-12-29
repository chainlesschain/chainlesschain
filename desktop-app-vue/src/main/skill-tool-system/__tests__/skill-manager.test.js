/**
 * SkillManager 单元测试
 */

import './setup.js'; // 导入测试环境设置
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

// Mock dependencies
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test_id_123'),
}));

// 创建一个内存数据库实例进行测试
class MockDatabase {
  constructor() {
    this.data = {
      skills: [],
      skill_tools: [],
    };
  }

  prepare(query) {
    const lowerQuery = query.toLowerCase();

    return {
      run: (...args) => {
        if (lowerQuery.includes('insert into skills')) {
          const skill = this._parseInsertSkill(args);
          this.data.skills.push(skill);
          return { changes: 1 };
        } else if (lowerQuery.includes('delete from skills')) {
          const prevLength = this.data.skills.length;
          this.data.skills = this.data.skills.filter(s => s.id !== args[0]);
          return { changes: prevLength - this.data.skills.length };
        } else if (lowerQuery.includes('update skills')) {
          const index = this.data.skills.findIndex(s => s.id === args[args.length - 1]);
          if (index >= 0) {
            // 简化更新逻辑
            Object.assign(this.data.skills[index], { updated_at: Date.now() });
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        return { changes: 0 };
      },
      get: (...args) => {
        if (lowerQuery.includes('from skills where id')) {
          return this.data.skills.find(s => s.id === args[0]) || null;
        }
        return null;
      },
      all: (...args) => {
        if (lowerQuery.includes('from skills')) {
          return this.data.skills;
        }
        return [];
      },
    };
  }

  _parseInsertSkill(args) {
    return {
      id: args[0],
      name: args[1],
      display_name: args[2] || '',
      description: args[3] || '',
      category: args[4],
      icon: args[5] || '',
      enabled: args[6] !== undefined ? args[6] : 1,
      is_builtin: args[7] !== undefined ? args[7] : 0,
      plugin_id: args[8] || null,
      config: args[9] || '{}',
      tags: args[10] || '[]',
      doc_path: args[11] || '',
      usage_count: 0,
      success_count: 0,
      last_used_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }
}

// 动态导入 SkillManager
async function loadSkillManager() {
  const modulePath = path.resolve(__dirname, '../skill-manager.js');
  const SkillManager = (await import(modulePath)).default;
  return SkillManager;
}

describe('SkillManager', () => {
  let skillManager;
  let mockDb;

  beforeEach(async () => {
    mockDb = new MockDatabase();
    const SkillManager = await loadSkillManager();
    skillManager = new SkillManager(mockDb);
  });

  describe('创建技能', () => {
    it('应该成功创建技能', async () => {
      const skillData = {
        name: '测试技能',
        display_name: 'Test Skill',
        description: '这是一个测试技能',
        category: 'code',
        icon: 'test-icon',
        tags: ['测试', '单元测试'],
        config: { test: true },
      };

      const result = await skillManager.createSkill(skillData);

      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill.name).toBe('测试技能');
      expect(result.skill.category).toBe('code');
    });

    it('缺少必填字段应该失败', async () => {
      const skillData = {
        name: '测试技能',
        // 缺少 category
      };

      const result = await skillManager.createSkill(skillData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('获取技能', () => {
    beforeEach(async () => {
      // 预先添加一些测试数据
      await skillManager.createSkill({
        name: '技能1',
        category: 'code',
      });
      await skillManager.createSkill({
        name: '技能2',
        category: 'web',
      });
    });

    it('应该获取所有技能', async () => {
      const result = await skillManager.getAllSkills();

      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(2);
    });

    it('应该按分类筛选技能', async () => {
      const result = await skillManager.getSkillsByCategory('code');

      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].category).toBe('code');
    });

    it('应该通过ID获取单个技能', async () => {
      const all = await skillManager.getAllSkills();
      const skillId = all.skills[0].id;

      const result = await skillManager.getSkillById(skillId);

      expect(result.success).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.skill.id).toBe(skillId);
    });

    it('获取不存在的技能应返回null', async () => {
      const result = await skillManager.getSkillById('non_existent_id');

      expect(result.success).toBe(true);
      expect(result.skill).toBeNull();
    });
  });

  describe('更新技能', () => {
    let skillId;

    beforeEach(async () => {
      const created = await skillManager.createSkill({
        name: '原技能',
        category: 'code',
      });
      skillId = created.skill.id;
    });

    it('应该成功更新技能', async () => {
      const result = await skillManager.updateSkill(skillId, {
        name: '更新后的技能',
        description: '新描述',
      });

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });

    it('更新不存在的技能应返回0变更', async () => {
      const result = await skillManager.updateSkill('non_existent', {
        name: '测试',
      });

      expect(result.changes).toBe(0);
    });
  });

  describe('删除技能', () => {
    let skillId;

    beforeEach(async () => {
      const created = await skillManager.createSkill({
        name: '待删除技能',
        category: 'code',
      });
      skillId = created.skill.id;
    });

    it('应该成功删除技能', async () => {
      const result = await skillManager.deleteSkill(skillId);

      expect(result.success).toBe(true);
      expect(result.changes).toBe(1);

      // 验证已删除
      const getResult = await skillManager.getSkillById(skillId);
      expect(getResult.skill).toBeNull();
    });

    it('删除不存在的技能应返回0变更', async () => {
      const result = await skillManager.deleteSkill('non_existent');

      expect(result.success).toBe(true);
      expect(result.changes).toBe(0);
    });
  });

  describe('启用/禁用技能', () => {
    let skillId;

    beforeEach(async () => {
      const created = await skillManager.createSkill({
        name: '测试技能',
        category: 'code',
        enabled: 1,
      });
      skillId = created.skill.id;
    });

    it('应该成功禁用技能', async () => {
      const result = await skillManager.toggleSkillEnabled(skillId, false);

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });

    it('应该成功启用技能', async () => {
      await skillManager.toggleSkillEnabled(skillId, false);
      const result = await skillManager.toggleSkillEnabled(skillId, true);

      expect(result.success).toBe(true);
      expect(result.changes).toBeGreaterThan(0);
    });
  });

  describe('统计功能', () => {
    beforeEach(async () => {
      await skillManager.createSkill({
        name: '技能A',
        category: 'code',
      });
      await skillManager.createSkill({
        name: '技能B',
        category: 'web',
      });
      await skillManager.createSkill({
        name: '技能C',
        category: 'code',
      });
    });

    it('应该返回正确的技能数量', async () => {
      const result = await skillManager.getSkillCount();

      expect(result.count).toBe(3);
    });

    it('应该返回分类统计', async () => {
      const result = await skillManager.getSkillStats();

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.totalSkills).toBe(3);
      expect(result.stats.categories).toBeDefined();
      expect(result.stats.categories.code).toBe(2);
      expect(result.stats.categories.web).toBe(1);
    });
  });
});
