/**
 * Tool Store - 工具管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 工具参数 Schema
 */
export interface ToolParametersSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

/**
 * 工具返回值 Schema
 */
export interface ToolReturnSchema {
  type?: string;
  properties?: Record<string, any>;
  [key: string]: any;
}

/**
 * 工具配置
 */
export interface ToolConfig {
  [key: string]: any;
}

/**
 * 工具信息
 */
export interface Tool {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  category: string;
  enabled: 0 | 1;
  is_builtin: 0 | 1;
  plugin_id?: string;
  parameters_schema: ToolParametersSchema;
  return_schema: ToolReturnSchema;
  required_permissions: string[];
  config?: ToolConfig;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 获取工具选项
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
 * 工具统计数据
 */
export interface ToolStats {
  totalCalls: number;
  successRate: number;
  averageResponseTime: number;
  [key: string]: any;
}

/**
 * 工具文档
 */
export interface ToolDoc {
  content: string;
  format: string;
  [key: string]: any;
}

/**
 * 工具测试结果
 */
export interface ToolTestResult {
  success: boolean;
  output?: any;
  error?: string;
  duration?: number;
  [key: string]: any;
}

/**
 * 按分类分组的工具
 */
export interface ToolsByCategory {
  [category: string]: Tool[];
}

/**
 * 状态筛选类型
 */
export type StatusFilter = 'all' | 'enabled' | 'disabled';

/**
 * Tool Store 状态
 */
export interface ToolState {
  tools: Tool[];
  currentTool: Tool | null;
  loading: boolean;
  categoryFilter: string;
  searchKeyword: string;
  statusFilter: StatusFilter;
  statistics: ToolStats | null;
}

// ==================== Store ====================

export const useToolStore = defineStore('tool', {
  state: (): ToolState => ({
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
    statusFilter: 'all',

    // 统计数据
    statistics: null,
  }),

  getters: {
    /**
     * 启用的工具列表
     */
    enabledTools(): Tool[] {
      return this.tools.filter((tool) => tool.enabled === 1);
    },

    /**
     * 禁用的工具列表
     */
    disabledTools(): Tool[] {
      return this.tools.filter((tool) => tool.enabled === 0);
    },

    /**
     * 筛选后的工具列表
     */
    filteredTools(): Tool[] {
      let filtered = this.tools;

      // 分类筛选
      if (this.categoryFilter !== 'all') {
        filtered = filtered.filter((tool) => tool.category === this.categoryFilter);
      }

      // 状态筛选
      if (this.statusFilter === 'enabled') {
        filtered = filtered.filter((tool) => tool.enabled === 1);
      } else if (this.statusFilter === 'disabled') {
        filtered = filtered.filter((tool) => tool.enabled === 0);
      }

      // 搜索筛选
      if (this.searchKeyword) {
        const keyword = this.searchKeyword.toLowerCase();
        filtered = filtered.filter(
          (tool) =>
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
    toolsByCategory(): ToolsByCategory {
      const grouped: ToolsByCategory = {};
      this.tools.forEach((tool) => {
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
    totalCount(): number {
      return this.tools.length;
    },

    /**
     * 启用工具数量
     */
    enabledCount(): number {
      return this.tools.filter((t) => t.enabled === 1).length;
    },

    /**
     * 内置工具数量
     */
    builtinCount(): number {
      return this.tools.filter((t) => t.is_builtin === 1).length;
    },

    /**
     * 插件工具数量
     */
    pluginCount(): number {
      return this.tools.filter((t) => t.plugin_id).length;
    },
  },

  actions: {
    /**
     * 获取所有工具
     */
    async fetchAll(options: FetchAllOptions = {}): Promise<void> {
      this.loading = true;
      try {
        const toolAPI = (window as any).electronAPI?.tool || (window as any).electron?.api?.tool;
        if (!toolAPI?.getAll) {
          logger.error('[ToolStore] tool API 不可用 (缺少 getAll)');
          return;
        }
        const result = await toolAPI.getAll(options);
        if (result.success) {
          const tools: any[] = Array.isArray(result.data)
            ? result.data
            : result.tools || result.content || [];
          this.tools = tools.map((tool) => ({
            ...tool,
            parameters_schema:
              typeof tool.parameters_schema === 'string'
                ? JSON.parse(tool.parameters_schema)
                : tool.parameters_schema || {},
            return_schema:
              typeof tool.return_schema === 'string'
                ? JSON.parse(tool.return_schema)
                : tool.return_schema || {},
            required_permissions:
              typeof tool.required_permissions === 'string'
                ? JSON.parse(tool.required_permissions)
                : tool.required_permissions || [],
          }));
        } else {
          logger.error('获取工具失败:', result.error);
        }
      } catch (error) {
        logger.error('获取工具失败:', error as any);
      } finally {
        this.loading = false;
      }
    },

    /**
     * 根据ID获取工具
     */
    async fetchById(toolId: string): Promise<Tool | null> {
      try {
        const toolAPI = (window as any).electronAPI?.tool || (window as any).electron?.api?.tool;
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
                parameters_schema:
                  typeof data.parameters_schema === 'string'
                    ? JSON.parse(data.parameters_schema)
                    : data.parameters_schema || {},
                return_schema:
                  typeof data.return_schema === 'string'
                    ? JSON.parse(data.return_schema)
                    : data.return_schema || {},
                required_permissions:
                  typeof data.required_permissions === 'string'
                    ? JSON.parse(data.required_permissions)
                    : data.required_permissions || [],
              }
            : null;
          return this.currentTool;
        } else {
          logger.error('获取工具失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取工具失败:', error as any);
        return null;
      }
    },

    /**
     * 根据分类获取工具
     */
    async fetchByCategory(category: string): Promise<Tool[]> {
      try {
        const toolAPI = (window as any).electronAPI?.tool || (window as any).electron?.api?.tool;
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
        logger.error('获取工具失败:', error as any);
        return [];
      }
    },

    /**
     * 根据技能获取工具
     */
    async fetchBySkill(skillId: string): Promise<Tool[]> {
      try {
        const result = await (window as any).electronAPI.tool.getBySkill(skillId);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取工具失败:', result.error);
          return [];
        }
      } catch (error) {
        logger.error('获取工具失败:', error as any);
        return [];
      }
    },

    /**
     * 启用工具
     */
    async enable(toolId: string): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.tool.enable(toolId);
        if (result.success) {
          const tool = this.tools.find((t) => t.id === toolId);
          if (tool) {
            tool.enabled = 1;
          }
          return true;
        } else {
          logger.error('启用工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('启用工具失败:', error as any);
        return false;
      }
    },

    /**
     * 禁用工具
     */
    async disable(toolId: string): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.tool.disable(toolId);
        if (result.success) {
          const tool = this.tools.find((t) => t.id === toolId);
          if (tool) {
            tool.enabled = 0;
          }
          return true;
        } else {
          logger.error('禁用工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('禁用工具失败:', error as any);
        return false;
      }
    },

    /**
     * 更新工具配置
     */
    async updateConfig(toolId: string, config: ToolConfig): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.tool.updateConfig(toolId, config);
        if (result.success) {
          const tool = this.tools.find((t) => t.id === toolId);
          if (tool) {
            tool.config = config;
          }
          return true;
        } else {
          logger.error('更新工具配置失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新工具配置失败:', error as any);
        return false;
      }
    },

    /**
     * 更新工具Schema
     */
    async updateSchema(toolId: string, schema: ToolParametersSchema): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.tool.updateSchema(toolId, schema);
        if (result.success) {
          const tool = this.tools.find((t) => t.id === toolId);
          if (tool) {
            tool.parameters_schema = schema;
          }
          return true;
        } else {
          logger.error('更新工具Schema失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新工具Schema失败:', error as any);
        return false;
      }
    },

    /**
     * 更新工具
     */
    async update(toolId: string, updates: Partial<Tool>): Promise<boolean> {
      try {
        const result = await (window as any).electronAPI.tool.update(toolId, updates);
        if (result.success) {
          const index = this.tools.findIndex((t) => t.id === toolId);
          if (index !== -1) {
            this.tools[index] = { ...this.tools[index], ...updates };
          }
          return true;
        } else {
          logger.error('更新工具失败:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('更新工具失败:', error as any);
        return false;
      }
    },

    /**
     * 获取工具统计
     */
    async fetchStats(toolId: string, dateRange: DateRange | null = null): Promise<ToolStats | null> {
      try {
        const result = await (window as any).electronAPI.tool.getStats(toolId, dateRange);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取工具统计失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取工具统计失败:', error as any);
        return null;
      }
    },

    /**
     * 获取工具文档
     */
    async fetchDoc(toolId: string): Promise<ToolDoc | null> {
      try {
        const result = await (window as any).electronAPI.tool.getDoc(toolId);
        if (result.success) {
          return result.data;
        } else {
          logger.error('获取工具文档失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('获取工具文档失败:', error as any);
        return null;
      }
    },

    /**
     * 测试工具
     */
    async test(toolId: string, params: Record<string, any> = {}): Promise<ToolTestResult | null> {
      try {
        const result = await (window as any).electronAPI.tool.test(toolId, params);
        if (result.success) {
          return result.data;
        } else {
          logger.error('测试工具失败:', result.error);
          return null;
        }
      } catch (error) {
        logger.error('测试工具失败:', error as any);
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
     * 设置状态筛选
     */
    setStatusFilter(status: StatusFilter): void {
      this.statusFilter = status;
    },

    /**
     * 设置搜索关键词
     */
    setSearchKeyword(keyword: string): void {
      this.searchKeyword = keyword;
    },

    /**
     * 设置当前工具
     */
    setCurrentTool(tool: Tool | null): void {
      this.currentTool = tool;
    },

    /**
     * 清除当前工具
     */
    clearCurrentTool(): void {
      this.currentTool = null;
    },
  },
});
