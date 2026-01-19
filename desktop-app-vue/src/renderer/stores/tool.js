/**
 * 工具管理 Store
 */
import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';

export const useToolStore = defineStore('tool', {
  state: () => ({
    // 工具列表
    tools: [],

    // 当前选中的工具
    currentTool: null,

    // 加载状态
    loading: false,

    // 分类筛选
    categoryFilter: 'all',

    // 搜索关键词
    searchKeyword: '',

    // 状态筛选
    statusFilter: 'all', // all, enabled, disabled

    // 统计数据
    statistics: null,
  }),

  getters: {
    /**
     * 启用的工具列表
     */
    enabledTools: (state) => {
      return state.tools.filter(tool => tool.enabled === 1);
    },

    /**
     * 禁用的工具列表
     */
    disabledTools: (state) => {
      return state.tools.filter(tool => tool.enabled === 0);
    },

    /**
     * 筛选后的工具列表
     */
    filteredTools: (state) => {
      let filtered = state.tools;

      // 分类筛选
      if (state.categoryFilter !== 'all') {
        filtered = filtered.filter(tool => tool.category === state.categoryFilter);
      }

      // 状态筛选
      if (state.statusFilter === 'enabled') {
        filtered = filtered.filter(tool => tool.enabled === 1);
      } else if (state.statusFilter === 'disabled') {
        filtered = filtered.filter(tool => tool.enabled === 0);
      }

      // 搜索筛选
      if (state.searchKeyword) {
        const keyword = state.searchKeyword.toLowerCase();
        filtered = filtered.filter(tool =>
          tool.name.toLowerCase().includes(keyword) ||
          (tool.display_name && tool.display_name.toLowerCase().includes(keyword)) ||
          (tool.description && tool.description.toLowerCase().includes(keyword))
        );
      }

      return filtered;
    },

    /**
     * 按分类分组的工具
     */
    toolsByCategory: (state) => {
      const grouped = {};
      state.tools.forEach(tool => {
        if (!grouped[tool.category]) {
          grouped[tool.category] = [];
        }
        grouped[tool.category].push(tool);
      });
      return grouped;
    },

    /**
     * 工具总数
     */
    totalCount: (state) => state.tools.length,

    /**
     * 启用工具数量
     */
    enabledCount: (state) => state.tools.filter(t => t.enabled === 1).length,

    /**
     * 内置工具数量
     */
    builtinCount: (state) => state.tools.filter(t => t.is_builtin === 1).length,

    /**
     * 插件工具数量
     */
    pluginCount: (state) => state.tools.filter(t => t.plugin_id).length,
  },

  actions: {
    /**
     * 获取所有工具
     */
    async fetchAll(options = {}) {
      this.loading = true;
      try {
        const toolAPI = window.electronAPI?.tool || window.electron?.api?.tool;
        if (!toolAPI?.getAll) {
          logger.error('[ToolStore] tool API 不可用 (缺少 getAll)');
          return;
        }
        const result = await toolAPI.getAll(options);
        if (result.success) {
          const tools = Array.isArray(result.data) ? result.data : (result.tools || result.content || []);
          this.tools = tools.map(tool => ({
            ...tool,
            parameters_schema: typeof tool.parameters_schema === 'string'
              ? JSON.parse(tool.parameters_schema)
              : (tool.parameters_schema || {}),
            return_schema: typeof tool.return_schema === 'string'
              ? JSON.parse(tool.return_schema)
              : (tool.return_schema || {}),
            required_permissions: typeof tool.required_permissions === 'string'
              ? JSON.parse(tool.required_permissions)
              : (tool.required_permissions || []),
          }));
        } else {
          logger.error('获取工具失败:', result.error);
        }
      } catch (error) {
        logger.error('获取工具失败:', error);
      } finally {
        this.loading = false;
      }
    },

    /**
     * 根据ID获取工具
     */
    async fetchById(toolId) {
      try {
        const toolAPI = window.electronAPI?.tool || window.electron?.api?.tool;
        if (!toolAPI?.getById) {
          logger.error('[ToolStore] tool API 不可用 (缺少 getById)');
          return null;
        }
        const result = await toolAPI.getById(toolId);
        if (result.success) {
          const data = result.data || result.tool || result.content;
          this.currentTool = data
            ? {
                ...data,
                parameters_schema: typeof data.parameters_schema === 'string'
                  ? JSON.parse(data.parameters_schema)
                  : (data.parameters_schema || {}),
                return_schema: typeof data.return_schema === 'string'
                  ? JSON.parse(data.return_schema)
                  : (data.return_schema || {}),
                required_permissions: typeof data.required_permissions === 'string'
                  ? JSON.parse(data.required_permissions)
                  : (data.required_permissions || []),
              }
            : null;
          return this.currentTool;
        } else {
          logger.error('获取工具失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取工具失败:', error);
        return null;
      }
    },

    /**
     * 根据分类获取工具
     */
    async fetchByCategory(category) {
      try {
        const toolAPI = window.electronAPI?.tool || window.electron?.api?.tool;
        if (!toolAPI?.getByCategory) {
          logger.error('[ToolStore] tool API 不可用 (缺少 getByCategory)');
          return [];
        }
        const result = await toolAPI.getByCategory(category);
        if (result.success) {
          return result.content ?? result.data ?? result.tools ?? [];
        } else {
          logger.error('获取工具失败:', result.error);
          return [];
        }
      } catch (error) {
        logger.error('获取工具失败:', error);
        return [];
      }
    },

    /**
     * 根据技能获取工具
     */
    async fetchBySkill(skillId) {
      try {
        const result = await window.electronAPI.tool.getBySkill(skillId);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取工具失败:', result.error);
          return [];
        }
      } catch (error) {
        logger.error('获取工具失败:', error);
        return [];
      }
    },

    /**
     * 启用工具
     */
    async enable(toolId) {
      try {
        const result = await window.electronAPI.tool.enable(toolId);
        if (result.success) {
          const tool = this.tools.find(t => t.id === toolId);
          if (tool) {
            tool.enabled = 1;
          }
          return true;
        } else {
          logger.error('启用工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('启用工具失败:', error);
        return false;
      }
    },

    /**
     * 禁用工具
     */
    async disable(toolId) {
      try {
        const result = await window.electronAPI.tool.disable(toolId);
        if (result.success) {
          const tool = this.tools.find(t => t.id === toolId);
          if (tool) {
            tool.enabled = 0;
          }
          return true;
        } else {
          logger.error('禁用工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('禁用工具失败:', error);
        return false;
      }
    },

    /**
     * 更新工具配置
     */
    async updateConfig(toolId, config) {
      try {
        const result = await window.electronAPI.tool.updateConfig(toolId, config);
        if (result.success) {
          const tool = this.tools.find(t => t.id === toolId);
          if (tool) {
            tool.config = config;
          }
          return true;
        } else {
          logger.error('更新工具配置失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新工具配置失败:', error);
        return false;
      }
    },

    /**
     * 更新工具Schema
     */
    async updateSchema(toolId, schema) {
      try {
        const result = await window.electronAPI.tool.updateSchema(toolId, schema);
        if (result.success) {
          const tool = this.tools.find(t => t.id === toolId);
          if (tool) {
            tool.parameters_schema = schema;
          }
          return true;
        } else {
          logger.error('更新工具Schema失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新工具Schema失败:', error);
        return false;
      }
    },

    /**
     * 更新工具
     */
    async update(toolId, updates) {
      try {
        const result = await window.electronAPI.tool.update(toolId, updates);
        if (result.success) {
          const index = this.tools.findIndex(t => t.id === toolId);
          if (index !== -1) {
            this.tools[index] = { ...this.tools[index], ...updates };
          }
          return true;
        } else {
          logger.error('更新工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新工具失败:', error);
        return false;
      }
    },

    /**
     * 获取工具统计
     */
    async fetchStats(toolId, dateRange = null) {
      try {
        const result = await window.electronAPI.tool.getStats(toolId, dateRange);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取工具统计失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取工具统计失败:', error);
        return null;
      }
    },

    /**
     * 获取工具文档
     */
    async fetchDoc(toolId) {
      try {
        const result = await window.electronAPI.tool.getDoc(toolId);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取工具文档失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取工具文档失败:', error);
        return null;
      }
    },

    /**
     * 测试工具
     */
    async test(toolId, params = {}) {
      try {
        const result = await window.electronAPI.tool.test(toolId, params);
        if (result.success) {
          return result.data;
        } else {
          logger.error('测试工具失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('测试工具失败:', error);
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
     * 设置状态筛选
     */
    setStatusFilter(status) {
      this.statusFilter = status;
    },

    /**
     * 设置搜索关键词
     */
    setSearchKeyword(keyword) {
      this.searchKeyword = keyword;
    },

    /**
     * 设置当前工具
     */
    setCurrentTool(tool) {
      this.currentTool = tool;
    },

    /**
     * 清除当前工具
     */
    clearCurrentTool() {
      this.currentTool = null;
    },
  },
});
