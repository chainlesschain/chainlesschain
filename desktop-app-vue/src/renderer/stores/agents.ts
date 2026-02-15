/**
 * Agents Store - Pinia 状态管理
 * 管理专业化多代理系统的模板、实例、任务、编排和性能分析
 *
 * @module agents-store
 * @version 1.0.0
 * @since 2026-02-15
 */

import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';

const agentsLogger = createLogger('agents-store');

// ==================== 类型定义 ====================

/**
 * 代理模板
 */
export interface AgentTemplate {
  id: string;
  name: string;
  type: string;
  description?: string;
  capabilities: string;
  tools: string;
  system_prompt?: string;
  config?: string;
  version: string;
  enabled: boolean;
  created_at: number;
}

/**
 * 代理实例
 */
export interface AgentInstance {
  id: string;
  templateId: string;
  templateType: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  currentTask?: string;
  createdAt: number;
}

/**
 * 代理任务历史
 */
export interface AgentTaskHistory {
  id: string;
  agent_id: string;
  template_type: string;
  task_description?: string;
  started_at?: number;
  completed_at?: number;
  success?: boolean;
  result?: string;
  tokens_used?: number;
}

/**
 * 代理性能统计
 */
export interface AgentPerformance {
  templateType: string;
  totalTasks: number;
  successRate: number;
  avgDuration: number;
  totalTokens: number;
}

/**
 * 编排计划
 */
export interface OrchestrationPlan {
  id: string;
  taskDescription: string;
  steps: OrchestrationStep[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
}

/**
 * 编排步骤
 */
export interface OrchestrationStep {
  agentType: string;
  action: string;
  dependencies?: string[];
  status?: string;
}

/**
 * 统计信息
 */
export interface AgentStatistics {
  totalTemplates: number;
  enabledTemplates: number;
  activeInstances: number;
  totalTasksCompleted: number;
  overallSuccessRate: number;
  totalTokensUsed: number;
  [key: string]: any;
}

/**
 * IPC 响应结果
 */
interface IPCResult<T = any> {
  success: boolean;
  data?: T;
  template?: AgentTemplate;
  templates?: AgentTemplate[];
  instance?: AgentInstance;
  instances?: AgentInstance[];
  task?: AgentTaskHistory;
  history?: AgentTaskHistory[];
  plan?: OrchestrationPlan;
  performance?: AgentPerformance[];
  statistics?: AgentStatistics;
  status?: any;
  error?: string;
  message?: string;
}

/**
 * Agents Store 状态
 */
export interface AgentsState {
  templates: AgentTemplate[];
  instances: AgentInstance[];
  taskHistory: AgentTaskHistory[];
  performance: AgentPerformance[];
  statistics: AgentStatistics | null;
  currentTemplate: AgentTemplate | null;
  orchestrationPlan: OrchestrationPlan | null;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useAgentsStore = defineStore('agents', {
  state: (): AgentsState => ({
    // 代理模板列表
    templates: [],

    // 运行中的代理实例列表
    instances: [],

    // 任务历史记录
    taskHistory: [],

    // 性能分析数据
    performance: [],

    // 全局统计信息
    statistics: null,

    // 当前选中的模板（用于详情展示）
    currentTemplate: null,

    // 当前编排计划
    orchestrationPlan: null,

    // 加载状态
    loading: false,

    // 错误状态
    error: null,
  }),

  getters: {
    // ==========================================
    // 模板相关 Getters
    // ==========================================

    /**
     * 已启用的模板列表
     */
    enabledTemplates(): AgentTemplate[] {
      return this.templates.filter((t) => t.enabled);
    },

    /**
     * 已禁用的模板列表
     */
    disabledTemplates(): AgentTemplate[] {
      return this.templates.filter((t) => !t.enabled);
    },

    /**
     * 按类型分组的模板
     */
    templatesByType(): Record<string, AgentTemplate[]> {
      const grouped: Record<string, AgentTemplate[]> = {};
      this.templates.forEach((template) => {
        const type = template.type || 'other';
        if (!grouped[type]) {
          grouped[type] = [];
        }
        grouped[type].push(template);
      });
      return grouped;
    },

    /**
     * 模板总数
     */
    totalTemplates(): number {
      return this.templates.length;
    },

    // ==========================================
    // 实例相关 Getters
    // ==========================================

    /**
     * 活跃实例列表（运行中或空闲）
     */
    activeInstances(): AgentInstance[] {
      return this.instances.filter((i) => i.status === 'running' || i.status === 'idle');
    },

    /**
     * 运行中的实例数
     */
    runningInstanceCount(): number {
      return this.instances.filter((i) => i.status === 'running').length;
    },

    // ==========================================
    // 任务相关 Getters
    // ==========================================

    /**
     * 已完成的任务数
     */
    completedTaskCount(): number {
      return this.taskHistory.filter((t) => t.success === true).length;
    },

    /**
     * 整体成功率
     */
    overallSuccessRate(): number {
      if (this.taskHistory.length === 0) return 0;
      const successCount = this.taskHistory.filter((t) => t.success === true).length;
      return Math.round((successCount / this.taskHistory.length) * 100);
    },
  },

  actions: {
    // ==========================================
    // 模板管理 Actions
    // ==========================================

    /**
     * 获取所有代理模板
     */
    async fetchTemplates(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentTemplate[]> = await (window as any).electronAPI.invoke(
          'agents:template-list'
        );

        if (result.success) {
          this.templates = result.templates || result.data || [];
          agentsLogger.info(`加载代理模板成功: ${this.templates.length} 个模板`);
        } else {
          this.error = result.error || '获取模板列表失败';
          agentsLogger.error('[AgentsStore] 获取模板列表失败:', result.error);
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取模板列表异常:', error as any);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取单个代理模板详情
     */
    async getTemplate(templateId: string): Promise<AgentTemplate | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentTemplate> = await (window as any).electronAPI.invoke(
          'agents:template-get',
          { templateId }
        );

        if (result.success) {
          const template = result.template || result.data || null;
          this.currentTemplate = template;
          agentsLogger.info(`获取模板详情成功: ${templateId}`);
          return template;
        } else {
          this.error = result.error || '获取模板详情失败';
          agentsLogger.error('[AgentsStore] 获取模板详情失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取模板详情异常:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 创建代理模板
     */
    async createTemplate(templateData: Partial<AgentTemplate>): Promise<AgentTemplate | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentTemplate> = await (window as any).electronAPI.invoke(
          'agents:template-create',
          { templateData }
        );

        if (result.success) {
          const template = result.template || result.data || null;
          if (template) {
            this.templates.unshift(template);
          }
          agentsLogger.info(`创建代理模板成功: ${templateData.name}`);
          return template;
        } else {
          this.error = result.error || '创建模板失败';
          agentsLogger.error('[AgentsStore] 创建模板失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 创建模板异常:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 更新代理模板
     */
    async updateTemplate(
      templateId: string,
      updates: Partial<AgentTemplate>
    ): Promise<boolean> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agents:template-update',
          { templateId, updates }
        );

        if (result.success) {
          // 更新本地缓存
          const index = this.templates.findIndex((t) => t.id === templateId);
          if (index !== -1) {
            this.templates[index] = { ...this.templates[index], ...updates };
          }

          // 更新当前选中模板
          if (this.currentTemplate && this.currentTemplate.id === templateId) {
            this.currentTemplate = { ...this.currentTemplate, ...updates };
          }

          agentsLogger.info(`更新代理模板成功: ${templateId}`);
          return true;
        } else {
          this.error = result.error || '更新模板失败';
          agentsLogger.error('[AgentsStore] 更新模板失败:', result.error);
          return false;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 更新模板异常:', error as any);
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 删除代理模板
     */
    async deleteTemplate(templateId: string): Promise<boolean> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agents:template-delete',
          { templateId }
        );

        if (result.success) {
          // 从列表中移除
          const index = this.templates.findIndex((t) => t.id === templateId);
          if (index !== -1) {
            this.templates.splice(index, 1);
          }

          // 清除当前模板
          if (this.currentTemplate && this.currentTemplate.id === templateId) {
            this.currentTemplate = null;
          }

          agentsLogger.info(`删除代理模板成功: ${templateId}`);
          return true;
        } else {
          this.error = result.error || '删除模板失败';
          agentsLogger.error('[AgentsStore] 删除模板失败:', result.error);
          return false;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 删除模板异常:', error as any);
        this.error = (error as Error).message;
        return false;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 部署与实例管理 Actions
    // ==========================================

    /**
     * 部署代理（根据模板创建实例）
     */
    async deployAgent(templateId: string, config?: Record<string, any>): Promise<AgentInstance | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentInstance> = await (window as any).electronAPI.invoke(
          'agents:deploy',
          { templateId, config }
        );

        if (result.success) {
          const instance = result.instance || result.data || null;
          if (instance) {
            this.instances.unshift(instance);
          }
          agentsLogger.info(`部署代理成功: 模板 ${templateId}`);
          return instance;
        } else {
          this.error = result.error || '部署代理失败';
          agentsLogger.error('[AgentsStore] 部署代理失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 部署代理异常:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 终止代理实例
     */
    async terminateAgent(instanceId: string, reason: string = ''): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agents:terminate',
          { instanceId, reason }
        );

        if (result.success) {
          // 从实例列表中移除
          const index = this.instances.findIndex((i) => i.id === instanceId);
          if (index !== -1) {
            this.instances.splice(index, 1);
          }

          agentsLogger.info(`终止代理实例成功: ${instanceId}`, reason);
          return true;
        } else {
          this.error = result.error || '终止代理失败';
          agentsLogger.error('[AgentsStore] 终止代理失败:', result.error);
          return false;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 终止代理异常:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    /**
     * 获取所有代理实例
     */
    async fetchInstances(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentInstance[]> = await (window as any).electronAPI.invoke(
          'agents:instance-list'
        );

        if (result.success) {
          this.instances = result.instances || result.data || [];
          agentsLogger.info(`加载代理实例成功: ${this.instances.length} 个实例`);
        } else {
          this.error = result.error || '获取实例列表失败';
          agentsLogger.error('[AgentsStore] 获取实例列表失败:', result.error);
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取实例列表异常:', error as any);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取代理实例状态
     */
    async getStatus(instanceId: string): Promise<any> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agents:get-status',
          { instanceId }
        );

        if (result.success) {
          // 更新实例列表中的状态
          const index = this.instances.findIndex((i) => i.id === instanceId);
          if (index !== -1 && result.status) {
            this.instances[index] = { ...this.instances[index], ...result.status };
          }
          agentsLogger.info(`获取代理状态成功: ${instanceId}`);
          return result.status || result.data;
        } else {
          this.error = result.error || '获取代理状态失败';
          agentsLogger.error('[AgentsStore] 获取代理状态失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取代理状态异常:', error as any);
        this.error = (error as Error).message;
        return null;
      }
    },

    // ==========================================
    // 任务管理 Actions
    // ==========================================

    /**
     * 分配任务给代理实例
     */
    async assignTask(
      instanceId: string,
      taskDescription: string,
      context?: Record<string, any>
    ): Promise<AgentTaskHistory | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentTaskHistory> = await (window as any).electronAPI.invoke(
          'agents:task-assign',
          { instanceId, taskDescription, context }
        );

        if (result.success) {
          const task = result.task || result.data || null;
          if (task) {
            this.taskHistory.unshift(task);
          }

          // 更新实例状态为 running
          const instIndex = this.instances.findIndex((i) => i.id === instanceId);
          if (instIndex !== -1) {
            this.instances[instIndex].status = 'running';
            this.instances[instIndex].currentTask = taskDescription;
          }

          agentsLogger.info(`分配任务成功: ${instanceId} -> ${taskDescription}`);
          return task;
        } else {
          this.error = result.error || '分配任务失败';
          agentsLogger.error('[AgentsStore] 分配任务失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 分配任务异常:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取任务状态
     */
    async getTaskStatus(taskId: string): Promise<AgentTaskHistory | null> {
      this.error = null;

      try {
        const result: IPCResult<AgentTaskHistory> = await (window as any).electronAPI.invoke(
          'agents:task-status',
          { taskId }
        );

        if (result.success) {
          const task = result.task || result.data || null;

          // 更新任务历史列表中的记录
          if (task) {
            const index = this.taskHistory.findIndex((t) => t.id === taskId);
            if (index !== -1) {
              this.taskHistory[index] = { ...this.taskHistory[index], ...task };
            }
          }

          agentsLogger.info(`获取任务状态成功: ${taskId}`);
          return task;
        } else {
          this.error = result.error || '获取任务状态失败';
          agentsLogger.error('[AgentsStore] 获取任务状态失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取任务状态异常:', error as any);
        this.error = (error as Error).message;
        return null;
      }
    },

    /**
     * 取消任务
     */
    async cancelTask(taskId: string, reason: string = ''): Promise<boolean> {
      this.error = null;

      try {
        const result: IPCResult = await (window as any).electronAPI.invoke(
          'agents:task-cancel',
          { taskId, reason }
        );

        if (result.success) {
          // 更新任务历史记录
          const index = this.taskHistory.findIndex((t) => t.id === taskId);
          if (index !== -1) {
            this.taskHistory[index].success = false;
            this.taskHistory[index].completed_at = Date.now();
            this.taskHistory[index].result = `已取消: ${reason}`;
          }

          agentsLogger.info(`取消任务成功: ${taskId}`, reason);
          return true;
        } else {
          this.error = result.error || '取消任务失败';
          agentsLogger.error('[AgentsStore] 取消任务失败:', result.error);
          return false;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 取消任务异常:', error as any);
        this.error = (error as Error).message;
        return false;
      }
    },

    // ==========================================
    // 编排协调 Actions
    // ==========================================

    /**
     * 编排任务（自动分析并分配给合适的代理）
     */
    async orchestrate(taskDescription: string, options?: Record<string, any>): Promise<OrchestrationPlan | null> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<OrchestrationPlan> = await (window as any).electronAPI.invoke(
          'agents:orchestrate',
          { taskDescription, options }
        );

        if (result.success) {
          const plan = result.plan || result.data || null;
          this.orchestrationPlan = plan;
          agentsLogger.info(`编排任务成功: ${taskDescription}`);
          return plan;
        } else {
          this.error = result.error || '编排任务失败';
          agentsLogger.error('[AgentsStore] 编排任务失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 编排任务异常:', error as any);
        this.error = (error as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取当前编排计划
     */
    async getPlan(planId: string): Promise<OrchestrationPlan | null> {
      this.error = null;

      try {
        const result: IPCResult<OrchestrationPlan> = await (window as any).electronAPI.invoke(
          'agents:get-plan',
          { planId }
        );

        if (result.success) {
          const plan = result.plan || result.data || null;
          this.orchestrationPlan = plan;
          agentsLogger.info(`获取编排计划成功: ${planId}`);
          return plan;
        } else {
          this.error = result.error || '获取编排计划失败';
          agentsLogger.error('[AgentsStore] 获取编排计划失败:', result.error);
          return null;
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取编排计划异常:', error as any);
        this.error = (error as Error).message;
        return null;
      }
    },

    // ==========================================
    // 分析统计 Actions
    // ==========================================

    /**
     * 获取性能分析数据
     */
    async fetchPerformance(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentPerformance[]> = await (window as any).electronAPI.invoke(
          'agents:performance'
        );

        if (result.success) {
          this.performance = result.performance || result.data || [];
          agentsLogger.info(`加载性能数据成功: ${this.performance.length} 条记录`);
        } else {
          this.error = result.error || '获取性能数据失败';
          agentsLogger.error('[AgentsStore] 获取性能数据失败:', result.error);
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取性能数据异常:', error as any);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取全局统计信息
     */
    async fetchStatistics(): Promise<void> {
      this.loading = true;
      this.error = null;

      try {
        const result: IPCResult<AgentStatistics> = await (window as any).electronAPI.invoke(
          'agents:statistics'
        );

        if (result.success) {
          this.statistics = result.statistics || result.data || null;
          agentsLogger.info('加载统计信息成功:', this.statistics);
        } else {
          this.error = result.error || '获取统计信息失败';
          agentsLogger.error('[AgentsStore] 获取统计信息失败:', result.error);
        }
      } catch (error) {
        agentsLogger.error('[AgentsStore] 获取统计信息异常:', error as any);
        this.error = (error as Error).message;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 重置 Store
    // ==========================================

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
      agentsLogger.info('Store 已重置');
    },
  },
});
