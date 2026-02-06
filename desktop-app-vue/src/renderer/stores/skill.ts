/**
 * Skill Store - 技能管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 技能配置
 */
export interface SkillConfig {
  [key: string]: any;
}

/**
 * 技能信息
 */
export interface Skill {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  category: string;
  tags: string[];
  config: SkillConfig;
  enabled: 0 | 1;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 获取技能选项
 */
export interface FetchAllOptions {
  category?: string;
  enabled?: boolean;
  [key: string]: any;
}

/**
 * 日期范围
 */
export interface DateRange {
  start: number | string;
  end: number | string;
}

/**
 * 技能统计数据
 */
export interface SkillStats {
  totalCalls: number;
  successRate: number;
  averageResponseTime: number;
  [key: string]: any;
}

/**
 * 技能工具信息
 */
export interface SkillTool {
  id: string;
  name: string;
  role: string;
  [key: string]: any;
}

/**
 * 技能文档
 */
export interface SkillDoc {
  content: string;
  format: string;
  [key: string]: any;
}

/**
 * 按分类分组的技能
 */
export interface SkillsByCategory {
  [category: string]: Skill[];
}

/**
 * Skill Store 状态
 */
export interface SkillState {
  skills: Skill[];
  currentSkill: Skill | null;
  loading: boolean;
  categoryFilter: string;
  searchKeyword: string;
  statistics: SkillStats | null;
}

// ==================== Store ====================

export const useSkillStore = defineStore('skill', {
  state: (): SkillState => ({
    // 技能列表
    skills: [],

    // 当前选中的技能
    currentSkill: null,

    // 加载状态
    loading: false,

    // 分类筛选
    categoryFilter: 'all',

    // 搜索关键词
    searchKeyword: '',

    // 统计数据
    statistics: null,
  }),

  getters: {
    /**
     * 启用的技能列表
     */
    enabledSkills(): Skill[] {
      return this.skills.filter((skill) => skill.enabled === 1);
    },

    /**
     * 禁用的技能列表
     */
    disabledSkills(): Skill[] {
      return this.skills.filter((skill) => skill.enabled === 0);
    },

    /**
     * 按分类筛选的技能
     */
    filteredSkills(): Skill[] {
      let filtered = this.skills;

      // 分类筛选
      if (this.categoryFilter !== 'all') {
        filtered = filtered.filter((skill) => skill.category === this.categoryFilter);
      }

      // 搜索筛选
      if (this.searchKeyword) {
        const keyword = this.searchKeyword.toLowerCase();
        filtered = filtered.filter(
          (skill) =>
            skill.name.toLowerCase().includes(keyword) ||
            (skill.display_name && skill.display_name.toLowerCase().includes(keyword)) ||
            (skill.description && skill.description.toLowerCase().includes(keyword))
        );
      }

      return filtered;
    },

    /**
     * 按分类分组的技能
     */
    skillsByCategory(): SkillsByCategory {
      const grouped: SkillsByCategory = {};
      this.skills.forEach((skill) => {
        if (!grouped[skill.category]) {
          grouped[skill.category] = [];
        }
        grouped[skill.category].push(skill);
      });
      return grouped;
    },

    /**
     * 技能总数统计
     */
    totalCount(): number {
      return this.skills.length;
    },

    /**
     * 启用技能数量
     */
    enabledCount(): number {
      return this.skills.filter((s) => s.enabled === 1).length;
    },
  },

  actions: {
    /**
     * 安全解析 JSON 字符串
     * @param value - 要解析的值
     * @param defaultValue - 解析失败时的默认值
     * @returns 解析后的值或默认值
     */
    _safeParseJSON<T>(value: string | T | null | undefined, defaultValue: T): T {
      if (value == null) {
        return defaultValue;
      }
      if (typeof value !== 'string') {
        return value as T;
      }
      try {
        return JSON.parse(value) as T;
      } catch (error) {
        logger.warn('[SkillStore] JSON 解析失败:', (error as Error).message);
        return defaultValue;
      }
    },

    /**
     * 获取所有技能
     */
    async fetchAll(options: FetchAllOptions = {}): Promise<void> {
      this.loading = true;
      try {
        const skillAPI =
          (window as any).electronAPI?.skill || (window as any).electron?.api?.skill;
        if (!skillAPI?.getAll) {
          logger.error('[SkillStore] skill API 不可用 (缺少 getAll)');
          return;
        }
        const result = await skillAPI.getAll(options);
        if (result.success) {
          const skills: any[] = Array.isArray(result.data)
            ? result.data
            : result.skills || result.content || [];
          this.skills = skills.map((skill) => ({
            ...skill,
            tags: this._safeParseJSON(skill.tags, [] as string[]),
            config: this._safeParseJSON(skill.config, {} as SkillConfig),
          }));
        } else {
          logger.error('获取技能失败:', result.error);
        }
      } catch (error) {
        logger.error('获取技能失败:', error as any);
      } finally {
        this.loading = false;
      }
    },

    /**
     * 根据ID获取技能
     */
    async fetchById(skillId: string): Promise<Skill | null> {
      try {
        const skillAPI =
          (window as any).electronAPI?.skill || (window as any).electron?.api?.skill;
        if (!skillAPI?.getById) {
          logger.error('[SkillStore] skill API 不可用 (缺少 getById)');
          return null;
        }
        const result = await skillAPI.getById(skillId);
        if (result.success) {
          const data = result.data || result.skill || result.content;
          this.currentSkill = data
            ? {
                ...data,
                tags: this._safeParseJSON(data.tags, [] as string[]),
                config: this._safeParseJSON(data.config, {} as SkillConfig),
              }
            : null;
          return this.currentSkill;
        } else {
          logger.error('获取技能失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取技能失败:', error as any);
        return null;
      }
    },

    /**
     * 根据分类获取技能
     */
    async fetchByCategory(category: string): Promise<Skill[]> {
      try {
        const skillAPI =
          (window as any).electronAPI?.skill || (window as any).electron?.api?.skill;
        if (!skillAPI?.getByCategory) {
          logger.error('[SkillStore] skill API 不可用 (缺少 getByCategory)');
          return [];
        }
        const result = await skillAPI.getByCategory(category);
        if (result.success) {
          return result.content ?? result.data ?? result.skills ?? [];
        } else {
          logger.error('获取技能失败:', result.error);
          return [];
        }
      } catch (error) {
        logger.error('获取技能失败:', error as any);
        return [];
      }
    },

    /**
     * 启用技能
     */
    async enable(skillId: string): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.skill.enable(skillId);
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find((s) => s.id === skillId);
          if (skill) {
            skill.enabled = 1;
          }
          return true;
        } else {
          logger.error('启用技能失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('启用技能失败:', error as any);
        return false;
      }
    },

    /**
     * 禁用技能
     */
    async disable(skillId: string): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.skill.disable(skillId);
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find((s) => s.id === skillId);
          if (skill) {
            skill.enabled = 0;
          }
          return true;
        } else {
          logger.error('禁用技能失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('禁用技能失败:', error as any);
        return false;
      }
    },

    /**
     * 更新技能配置
     */
    async updateConfig(skillId: string, config: SkillConfig): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.skill.updateConfig(skillId, config);
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find((s) => s.id === skillId);
          if (skill) {
            skill.config = config;
          }
          return true;
        } else {
          logger.error('更新技能配置失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新技能配置失败:', error as any);
        return false;
      }
    },

    /**
     * 更新技能信息
     */
    async update(skillId: string, updates: Partial<Skill>): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.skill.update(skillId, updates);
        if (result.success) {
          // 更新本地状态
          const index = this.skills.findIndex((s) => s.id === skillId);
          if (index !== -1) {
            this.skills[index] = { ...this.skills[index], ...updates };
          }
          return true;
        } else {
          logger.error('更新技能失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新技能失败:', error as any);
        return false;
      }
    },

    /**
     * 获取技能统计
     */
    async fetchStats(skillId: string, dateRange: DateRange | null = null): Promise<SkillStats | null> {
      try {
        const result = await (window as any).electronAPI.skill.getStats(skillId, dateRange);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取技能统计失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取技能统计失败:', error as any);
        return null;
      }
    },

    /**
     * 获取技能包含的工具
     */
    async fetchTools(skillId: string): Promise<SkillTool[]> {
      try {
        const result = await (window as any).electronAPI.skill.getTools(skillId);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取技能工具失败:', result.error);
          return [];
        }
      } catch (error) {
        logger.error('获取技能工具失败:', error as any);
        return [];
      }
    },

    /**
     * 添加工具到技能
     */
    async addTool(skillId: string, toolId: string, role: string = 'primary'): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.skill.addTool(skillId, toolId, role);
        if (result.success) {
          return true;
        } else {
          logger.error('添加工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('添加工具失败:', error as any);
        return false;
      }
    },

    /**
     * 从技能移除工具
     */
    async removeTool(skillId: string, toolId: string): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.skill.removeTool(skillId, toolId);
        if (result.success) {
          return true;
        } else {
          logger.error('移除工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('移除工具失败:', error as any);
        return false;
      }
    },

    /**
     * 获取技能文档
     */
    async fetchDoc(skillId: string): Promise<SkillDoc | null> {
      try {
        const result = await (window as any).electronAPI.skill.getDoc(skillId);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取技能文档失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取技能文档失败:', error as any);
        return null;
      }
    },

    /**
     * 设置分类筛选
     */
    setCategoryFilter(category: string): void {
      this.categoryFilter = category;
    },

    /**
     * 设置搜索关键词
     */
    setSearchKeyword(keyword: string): void {
      this.searchKeyword = keyword;
    },

    /**
     * 设置当前技能
     */
    setCurrentSkill(skill: Skill | null): void {
      this.currentSkill = skill;
    },

    /**
     * 清除当前技能
     */
    clearCurrentSkill(): void {
      this.currentSkill = null;
    },
  },
});
