/**
 * 技能管理 Store
 */
import { logger, createLogger } from "@/utils/logger";
import { defineStore } from "pinia";

export const useSkillStore = defineStore("skill", {
  state: () => ({
    // 技能列表
    skills: [],

    // 当前选中的技能
    currentSkill: null,

    // 加载状态
    loading: false,

    // 分类筛选
    categoryFilter: "all",

    // 搜索关键词
    searchKeyword: "",

    // 统计数据
    statistics: null,
  }),

  getters: {
    /**
     * 启用的技能列表
     */
    enabledSkills: (state) => {
      return state.skills.filter((skill) => skill.enabled === 1);
    },

    /**
     * 禁用的技能列表
     */
    disabledSkills: (state) => {
      return state.skills.filter((skill) => skill.enabled === 0);
    },

    /**
     * 按分类筛选的技能
     */
    filteredSkills: (state) => {
      let filtered = state.skills;

      // 分类筛选
      if (state.categoryFilter !== "all") {
        filtered = filtered.filter(
          (skill) => skill.category === state.categoryFilter,
        );
      }

      // 搜索筛选
      if (state.searchKeyword) {
        const keyword = state.searchKeyword.toLowerCase();
        filtered = filtered.filter(
          (skill) =>
            skill.name.toLowerCase().includes(keyword) ||
            (skill.display_name &&
              skill.display_name.toLowerCase().includes(keyword)) ||
            (skill.description &&
              skill.description.toLowerCase().includes(keyword)),
        );
      }

      return filtered;
    },

    /**
     * 按分类分组的技能
     */
    skillsByCategory: (state) => {
      const grouped = {};
      state.skills.forEach((skill) => {
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
    totalCount: (state) => state.skills.length,

    /**
     * 启用技能数量
     */
    enabledCount: (state) => state.skills.filter((s) => s.enabled === 1).length,
  },

  actions: {
    /**
     * 安全解析 JSON 字符串
     * @param {string|any} value - 要解析的值
     * @param {any} defaultValue - 解析失败时的默认值
     * @returns {any} 解析后的值或默认值
     */
    _safeParseJSON(value, defaultValue = null) {
      if (value == null) {
        return defaultValue;
      }
      if (typeof value !== "string") {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch (error) {
        logger.warn("[SkillStore] JSON 解析失败:", error.message);
        return defaultValue;
      }
    },

    /**
     * 获取所有技能
     */
    async fetchAll(options = {}) {
      this.loading = true;
      try {
        const skillAPI =
          window.electronAPI?.skill || window.electron?.api?.skill;
        if (!skillAPI?.getAll) {
          logger.error("[SkillStore] skill API 不可用 (缺少 getAll)");
          return;
        }
        const result = await skillAPI.getAll(options);
        if (result.success) {
          const skills = Array.isArray(result.data)
            ? result.data
            : result.skills || result.content || [];
          this.skills = skills.map((skill) => ({
            ...skill,
            tags: this._safeParseJSON(skill.tags, []),
            config: this._safeParseJSON(skill.config, {}),
          }));
        } else {
          logger.error("获取技能失败:", result.error);
        }
      } catch (error) {
        logger.error("获取技能失败:", error);
      } finally {
        this.loading = false;
      }
    },

    /**
     * 根据ID获取技能
     */
    async fetchById(skillId) {
      try {
        const skillAPI =
          window.electronAPI?.skill || window.electron?.api?.skill;
        if (!skillAPI?.getById) {
          logger.error("[SkillStore] skill API 不可用 (缺少 getById)");
          return null;
        }
        const result = await skillAPI.getById(skillId);
        if (result.success) {
          const data = result.data || result.skill || result.content;
          this.currentSkill = data
            ? {
                ...data,
                tags: this._safeParseJSON(data.tags, []),
                config: this._safeParseJSON(data.config, {}),
              }
            : null;
          return this.currentSkill;
        } else {
          logger.error("获取技能失败:", result.error);
          return null;
        }
      } catch (error) {
        logger.error("获取技能失败:", error);
        return null;
      }
    },

    /**
     * 根据分类获取技能
     */
    async fetchByCategory(category) {
      try {
        const skillAPI =
          window.electronAPI?.skill || window.electron?.api?.skill;
        if (!skillAPI?.getByCategory) {
          logger.error("[SkillStore] skill API 不可用 (缺少 getByCategory)");
          return [];
        }
        const result = await skillAPI.getByCategory(category);
        if (result.success) {
          return result.content ?? result.data ?? result.skills ?? [];
        } else {
          logger.error("获取技能失败:", result.error);
          return [];
        }
      } catch (error) {
        logger.error("获取技能失败:", error);
        return [];
      }
    },

    /**
     * 启用技能
     */
    async enable(skillId) {
      try {
        const result = await window.electronAPI.skill.enable(skillId);
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find((s) => s.id === skillId);
          if (skill) {
            skill.enabled = 1;
          }
          return true;
        } else {
          logger.error("启用技能失败:", result.error);
          return false;
        }
      } catch (error) {
        logger.error("启用技能失败:", error);
        return false;
      }
    },

    /**
     * 禁用技能
     */
    async disable(skillId) {
      try {
        const result = await window.electronAPI.skill.disable(skillId);
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find((s) => s.id === skillId);
          if (skill) {
            skill.enabled = 0;
          }
          return true;
        } else {
          logger.error("禁用技能失败:", result.error);
          return false;
        }
      } catch (error) {
        logger.error("禁用技能失败:", error);
        return false;
      }
    },

    /**
     * 更新技能配置
     */
    async updateConfig(skillId, config) {
      try {
        const result = await window.electronAPI.skill.updateConfig(
          skillId,
          config,
        );
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find((s) => s.id === skillId);
          if (skill) {
            skill.config = config;
          }
          return true;
        } else {
          logger.error("更新技能配置失败:", result.error);
          return false;
        }
      } catch (error) {
        logger.error("更新技能配置失败:", error);
        return false;
      }
    },

    /**
     * 更新技能信息
     */
    async update(skillId, updates) {
      try {
        const result = await window.electronAPI.skill.update(skillId, updates);
        if (result.success) {
          // 更新本地状态
          const index = this.skills.findIndex((s) => s.id === skillId);
          if (index !== -1) {
            this.skills[index] = { ...this.skills[index], ...updates };
          }
          return true;
        } else {
          logger.error("更新技能失败:", result.error);
          return false;
        }
      } catch (error) {
        logger.error("更新技能失败:", error);
        return false;
      }
    },

    /**
     * 获取技能统计
     */
    async fetchStats(skillId, dateRange = null) {
      try {
        const result = await window.electronAPI.skill.getStats(
          skillId,
          dateRange,
        );
        if (result.success) {
          return result.data;
        } else {
          logger.error("获取技能统计失败:", result.error);
          return null;
        }
      } catch (error) {
        logger.error("获取技能统计失败:", error);
        return null;
      }
    },

    /**
     * 获取技能包含的工具
     */
    async fetchTools(skillId) {
      try {
        const result = await window.electronAPI.skill.getTools(skillId);
        if (result.success) {
          return result.data;
        } else {
          logger.error("获取技能工具失败:", result.error);
          return [];
        }
      } catch (error) {
        logger.error("获取技能工具失败:", error);
        return [];
      }
    },

    /**
     * 添加工具到技能
     */
    async addTool(skillId, toolId, role = "primary") {
      try {
        const result = await window.electronAPI.skill.addTool(
          skillId,
          toolId,
          role,
        );
        if (result.success) {
          return true;
        } else {
          logger.error("添加工具失败:", result.error);
          return false;
        }
      } catch (error) {
        logger.error("添加工具失败:", error);
        return false;
      }
    },

    /**
     * 从技能移除工具
     */
    async removeTool(skillId, toolId) {
      try {
        const result = await window.electronAPI.skill.removeTool(
          skillId,
          toolId,
        );
        if (result.success) {
          return true;
        } else {
          logger.error("移除工具失败:", result.error);
          return false;
        }
      } catch (error) {
        logger.error("移除工具失败:", error);
        return false;
      }
    },

    /**
     * 获取技能文档
     */
    async fetchDoc(skillId) {
      try {
        const result = await window.electronAPI.skill.getDoc(skillId);
        if (result.success) {
          return result.data;
        } else {
          logger.error("获取技能文档失败:", result.error);
          return null;
        }
      } catch (error) {
        logger.error("获取技能文档失败:", error);
        return null;
      }
    },

    /**
     * 设置分类筛选
     */
    setCategoryFilter(category) {
      this.categoryFilter = category;
    },

    /**
     * 设置搜索关键词
     */
    setSearchKeyword(keyword) {
      this.searchKeyword = keyword;
    },

    /**
     * 设置当前技能
     */
    setCurrentSkill(skill) {
      this.currentSkill = skill;
    },

    /**
     * 清除当前技能
     */
    clearCurrentSkill() {
      this.currentSkill = null;
    },
  },
});
