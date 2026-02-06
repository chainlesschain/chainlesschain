/**
 * 工作流状态管理 Store
 *
 * 管理工作流的创建、执行、监控等状态
 *
 * v0.27.0: 新建文件
 * v0.30.0: 迁移到 TypeScript
 */

import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { message } from 'ant-design-vue';

// ==================== 类型定义 ====================

/**
 * 工作流状态类型
 */
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * 工作流总体状态
 */
export interface WorkflowOverall {
  status: WorkflowStatus;
  percent: number;
  message?: string;
  [key: string]: any;
}

/**
 * 工作流日志
 */
export interface WorkflowLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  [key: string]: any;
}

/**
 * 工作流
 */
export interface Workflow {
  workflowId: string;
  name?: string;
  description?: string;
  overall?: WorkflowOverall;
  recentLogs?: WorkflowLog[];
  createdAt?: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * 工作流创建选项
 */
export interface WorkflowCreateOptions {
  name?: string;
  description?: string;
  steps?: any[];
  config?: Record<string, any>;
  [key: string]: any;
}

/**
 * 工作流启动上下文
 */
export interface WorkflowContext {
  [key: string]: any;
}

/**
 * IPC 响应结果
 */
export interface IPCResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 工作流进度数据
 */
export interface WorkflowProgressData {
  workflowId: string;
  overall?: WorkflowOverall;
  recentLogs?: WorkflowLog[];
  [key: string]: any;
}

// ==================== Store ====================

export const useWorkflowStore = defineStore('workflow', () => {
  // ==================== State ====================

  // 所有工作流列表
  const workflows: Ref<Workflow[]> = ref([]);

  // 当前选中的工作流ID
  const currentWorkflowId: Ref<string | null> = ref(null);

  // 当前工作流详情
  const currentWorkflow: Ref<Workflow | null> = ref(null);

  // 加载状态
  const loading: Ref<boolean> = ref(false);

  // 最近的执行日志
  const recentLogs: Ref<WorkflowLog[]> = ref([]);

  // ==================== Getters ====================

  /**
   * 获取运行中的工作流
   */
  const runningWorkflows: ComputedRef<Workflow[]> = computed(() => {
    return workflows.value.filter((w) => w.overall?.status === 'running');
  });

  /**
   * 获取已完成的工作流
   */
  const completedWorkflows: ComputedRef<Workflow[]> = computed(() => {
    return workflows.value.filter((w) => w.overall?.status === 'completed');
  });

  /**
   * 获取失败的工作流
   */
  const failedWorkflows: ComputedRef<Workflow[]> = computed(() => {
    return workflows.value.filter((w) => w.overall?.status === 'failed');
  });

  /**
   * 当前工作流是否正在运行
   */
  const isCurrentRunning: ComputedRef<boolean> = computed(() => {
    return currentWorkflow.value?.overall?.status === 'running';
  });

  /**
   * 当前工作流是否已暂停
   */
  const isCurrentPaused: ComputedRef<boolean> = computed(() => {
    return currentWorkflow.value?.overall?.status === 'paused';
  });

  /**
   * 当前工作流进度
   */
  const currentProgress: ComputedRef<number> = computed(() => {
    return currentWorkflow.value?.overall?.percent || 0;
  });

  // ==================== Actions ====================

  /**
   * 加载所有工作流
   */
  async function loadWorkflows(): Promise<void> {
    loading.value = true;
    try {
      const result: IPCResult<Workflow[]> = await (window as any).ipc.invoke('workflow:get-all');
      if (result.success && result.data) {
        workflows.value = result.data;
      }
    } catch (error) {
      console.error('加载工作流失败:', error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建工作流
   * @param options - 工作流选项
   * @returns 创建结果
   */
  async function createWorkflow(options: WorkflowCreateOptions): Promise<Workflow | null> {
    loading.value = true;
    try {
      const result: IPCResult<Workflow> = await (window as any).ipc.invoke(
        'workflow:create',
        options
      );
      if (result.success && result.data) {
        await loadWorkflows();
        return result.data;
      } else {
        message.error(result.error || '创建失败');
        return null;
      }
    } catch (error) {
      message.error('创建失败: ' + (error as Error).message);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建并启动工作流
   * @param options - 工作流选项
   * @returns 创建结果
   */
  async function createAndStartWorkflow(
    options: WorkflowCreateOptions
  ): Promise<{ workflowId: string } | null> {
    loading.value = true;
    try {
      const result: IPCResult<{ workflowId: string }> = await (window as any).ipc.invoke(
        'workflow:create-and-start',
        options
      );
      if (result.success && result.data) {
        currentWorkflowId.value = result.data.workflowId;
        await loadWorkflows();
        return result.data;
      } else {
        message.error(result.error || '创建失败');
        return null;
      }
    } catch (error) {
      message.error('创建失败: ' + (error as Error).message);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 启动工作流
   * @param workflowId - 工作流ID
   * @param input - 输入数据
   * @param context - 上下文
   */
  async function startWorkflow(
    workflowId: string,
    input: any,
    context: WorkflowContext = {}
  ): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:start', {
        workflowId,
        input,
        context,
      });
      if (!result.success) {
        message.error(result.error || '启动失败');
      }
      return result;
    } catch (error) {
      message.error('启动失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 暂停工作流
   * @param workflowId - 工作流ID
   */
  async function pauseWorkflow(workflowId: string): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:pause', { workflowId });
      if (result.success) {
        message.success('工作流已暂停');
      } else {
        message.error(result.error || '暂停失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 恢复工作流
   * @param workflowId - 工作流ID
   */
  async function resumeWorkflow(workflowId: string): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:resume', { workflowId });
      if (result.success) {
        message.success('工作流已恢复');
      } else {
        message.error(result.error || '恢复失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 取消工作流
   * @param workflowId - 工作流ID
   * @param reason - 取消原因
   */
  async function cancelWorkflow(
    workflowId: string,
    reason: string = '用户取消'
  ): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:cancel', {
        workflowId,
        reason,
      });
      if (result.success) {
        message.success('工作流已取消');
        await loadWorkflows();
      } else {
        message.error(result.error || '取消失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 重试工作流
   * @param workflowId - 工作流ID
   */
  async function retryWorkflow(workflowId: string): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:retry', { workflowId });
      if (result.success) {
        message.success('工作流重试中');
      } else {
        message.error(result.error || '重试失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 删除工作流
   * @param workflowId - 工作流ID
   */
  async function deleteWorkflow(workflowId: string): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:delete', { workflowId });
      if (result.success) {
        message.success('工作流已删除');
        if (currentWorkflowId.value === workflowId) {
          currentWorkflowId.value = null;
          currentWorkflow.value = null;
        }
        await loadWorkflows();
      } else {
        message.error(result.error || '删除失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 选择工作流
   * @param workflowId - 工作流ID
   */
  async function selectWorkflow(workflowId: string | null): Promise<void> {
    currentWorkflowId.value = workflowId;
    if (workflowId) {
      await loadWorkflowDetail(workflowId);
    } else {
      currentWorkflow.value = null;
    }
  }

  /**
   * 加载工作流详情
   * @param workflowId - 工作流ID
   */
  async function loadWorkflowDetail(workflowId: string): Promise<void> {
    try {
      const result: IPCResult<Workflow> = await (window as any).ipc.invoke('workflow:get-status', {
        workflowId,
      });
      if (result.success && result.data) {
        currentWorkflow.value = result.data;
      }
    } catch (error) {
      console.error('加载工作流详情失败:', error);
    }
  }

  /**
   * 覆盖质量门禁
   * @param workflowId - 工作流ID
   * @param gateId - 门禁ID
   * @param reason - 原因
   */
  async function overrideQualityGate(
    workflowId: string,
    gateId: string,
    reason: string = '手动覆盖'
  ): Promise<IPCResult> {
    try {
      const result: IPCResult = await (window as any).ipc.invoke('workflow:override-gate', {
        workflowId,
        gateId,
        reason,
      });
      if (result.success) {
        message.success('门禁已跳过');
      } else {
        message.error(result.error || '操作失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 处理工作流进度更新
   * @param data - 进度数据
   */
  function handleWorkflowProgress(data: WorkflowProgressData): void {
    // 更新列表中的工作流
    const index = workflows.value.findIndex((w) => w.workflowId === data.workflowId);
    if (index >= 0) {
      workflows.value[index] = {
        ...workflows.value[index],
        ...data,
      };
    }

    // 更新当前工作流
    if (currentWorkflowId.value === data.workflowId) {
      currentWorkflow.value = data as Workflow;
    }

    // 添加到最近日志
    if (data.recentLogs) {
      recentLogs.value = data.recentLogs;
    }
  }

  /**
   * 初始化事件监听
   */
  function initEventListeners(): void {
    if ((window as any).ipc) {
      (window as any).ipc.on('workflow:progress', handleWorkflowProgress);
      (window as any).ipc.on('workflow:complete', (data: WorkflowProgressData) => {
        handleWorkflowProgress(data);
        loadWorkflows();
      });
      (window as any).ipc.on('workflow:error', (data: WorkflowProgressData) => {
        handleWorkflowProgress(data);
        loadWorkflows();
      });
    }
  }

  /**
   * 清理事件监听
   */
  function cleanupEventListeners(): void {
    if ((window as any).ipc) {
      (window as any).ipc.off('workflow:progress', handleWorkflowProgress);
      (window as any).ipc.off('workflow:complete');
      (window as any).ipc.off('workflow:error');
    }
  }

  // ==================== Return ====================

  return {
    // State
    workflows,
    currentWorkflowId,
    currentWorkflow,
    loading,
    recentLogs,

    // Getters
    runningWorkflows,
    completedWorkflows,
    failedWorkflows,
    isCurrentRunning,
    isCurrentPaused,
    currentProgress,

    // Actions
    loadWorkflows,
    createWorkflow,
    createAndStartWorkflow,
    startWorkflow,
    pauseWorkflow,
    resumeWorkflow,
    cancelWorkflow,
    retryWorkflow,
    deleteWorkflow,
    selectWorkflow,
    loadWorkflowDetail,
    overrideQualityGate,
    initEventListeners,
    cleanupEventListeners,
  };
});
