/**
 * 技能管理 Store
 */
import { defineStore } from 'pinia';

export const useSkillStore = defineStore('skill', {
  state: () => ({
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
    enabledSkills: (state) => {
      return state.skills.filter(skill => skill.enabled === 1);
    },

    /**
     * 禁用的技能列表
     */
    disabledSkills: (state) => {
      return state.skills.filter(skill => skill.enabled === 0);
    },

    /**
     * 按分类筛选的技能
     */
    filteredSkills: (state) => {
      let filtered = state.skills;

      // 分类筛选
      if (state.categoryFilter !== 'all') {
        filtered = filtered.filter(skill => skill.category === state.categoryFilter);
      }

      // 搜索筛选
      if (state.searchKeyword) {
        const keyword = state.searchKeyword.toLowerCase();
        filtered = filtered.filter(skill =>
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
    skillsByCategory: (state) => {
      const grouped = {};
      state.skills.forEach(skill => {
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
    enabledCount: (state) => state.skills.filter(s => s.enabled === 1).length,
  },

  actions: {
    /**
     * 获取所有技能
     */
    async fetchAll(options = {}) {
      this.loading = true;
      try {
        const result = await window.electronAPI.skill.getAll(options);
        if (result.success) {
          this.skills = result.data.map(skill => ({
            ...skill,
            tags: typeof skill.tags === 'string' ? JSON.parse(skill.tags) : (skill.tags || []),
            config: typeof skill.config === 'string' ? JSON.parse(skill.config) : (skill.config || {}),
          }));
        } else {
          console.error('获取技能失败:', result.error);
        }
      } catch (error) {
        console.error('获取技能失败:', error);
      } finally {
        this.loading = false;
      }
    },

    /**
     * 根据ID获取技能
     */
    async fetchById(skillId) {
      try {
        const result = await window.electronAPI.skill.getById(skillId);
        if (result.success) {
          this.currentSkill = {
            ...result.data,
            tags: typeof result.data.tags === 'string' ? JSON.parse(result.data.tags) : (result.data.tags || []),
            config: typeof result.data.config === 'string' ? JSON.parse(result.data.config) : (result.data.config || {}),
          };
          return this.currentSkill;
        } else {
          console.error('获取技能失败:', result.error);
          return null;
        }
      } catch (error) {
        console.error('获取技能失败:', error);
        return null;
      }
    },

    /**
     * 根据分类获取技能
     */
    async fetchByCategory(category) {
      try {
        const result = await window.electronAPI.skill.getByCategory(category);
        if (result.success) {
          return result.data;
        } else {
          console.error('获取技能失败:', result.error);
          return [];
        }
      } catch (error) {
        console.error('获取技能失败:', error);
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
          const skill = this.skills.find(s => s.id === skillId);
          if (skill) {
            skill.enabled = 1;
          }
          return true;
        } else {
          console.error('启用技能失败:', result.error);
          return false;
        }
      } catch (error) {
        console.error('启用技能失败:', error);
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
          const skill = this.skills.find(s => s.id === skillId);
          if (skill) {
            skill.enabled = 0;
          }
          return true;
        } else {
          console.error('禁用技能失败:', result.error);
          return false;
        }
      } catch (error) {
        console.error('禁用技能失败:', error);
        return false;
      }
    },

    /**
     * 更新技能配置
     */
    async updateConfig(skillId, config) {
      try {
        const result = await window.electronAPI.skill.updateConfig(skillId, config);
        if (result.success) {
          // 更新本地状态
          const skill = this.skills.find(s => s.id === skillId);
          if (skill) {
            skill.config = config;
          }
          return true;
        } else {
          console.error('更新技能配置失败:', result.error);
          return false;
        }
      } catch (error) {
        console.error('更新技能配置失败:', error);
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
          const index = this.skills.findIndex(s => s.id === skillId);
          if (index !== -1) {
            this.skills[index] = { ...this.skills[index], ...updates };
          }
          return true;
        } else {
          console.error('更新技能失败:', result.error);
          return false;
        }
      } catch (error) {
        console.error('更新技能失败:', error);
        return false;
      }
    },

    /**
     * 获取技能统计
     */
    async fetchStats(skillId, dateRange = null) {
      try {
        const result = await window.electronAPI.skill.getStats(skillId, dateRange);
        if (result.success) {
          return result.data;
        } else {
          console.error('获取技能统计失败:', result.error);
          return null;
        }
      } catch (error) {
        console.error('获取技能统计失败:', error);
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
          console.error('获取技能工具失败:', result.error);
          return [];
        }
      } catch (error) {
        console.error('获取技能工具失败:', error);
        return [];
      }
    },

    /**
     * 添加工具到技能
     */
    async addTool(skillId, toolId, role = 'primary') {
      try {
        const result = await window.electronAPI.skill.addTool(skillId, toolId, role);
        if (result.success) {
          return true;
        } else {
          console.error('添加工具失败:', result.error);
          return false;
        }
      } catch (error) {
        console.error('添加工具失败:', error);
        return false;
      }
    },

    /**
     * 从技能移除工具
     */
    async removeTool(skillId, toolId) {
      try {
        const result = await window.electronAPI.skill.removeTool(skillId, toolId);
        if (result.success) {
          return true;
        } else {
          console.error('移除工具失败:', result.error);
          return false;
        }
      } catch (error) {
        console.error('移除工具失败:', error);
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
          console.error('获取技能文档失败:', result.error);
          return null;
        }
      } catch (error) {
        console.error('获取技能文档失败:', error);
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
