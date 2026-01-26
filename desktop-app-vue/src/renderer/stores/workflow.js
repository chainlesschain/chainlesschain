/**
 * 工作流状态管理 Store
 *
 * 管理工作流的创建、执行、监控等状态
 *
 * v0.27.0: 新建文件
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';

export const useWorkflowStore = defineStore('workflow', () => {
  // ==================== State ====================

  // 所有工作流列表
  const workflows = ref([]);

  // 当前选中的工作流ID
  const currentWorkflowId = ref(null);

  // 当前工作流详情
  const currentWorkflow = ref(null);

  // 加载状态
  const loading = ref(false);

  // 最近的执行日志
  const recentLogs = ref([]);

  // ==================== Getters ====================

  /**
   * 获取运行中的工作流
   */
  const runningWorkflows = computed(() => {
    return workflows.value.filter(w => w.overall?.status === 'running');
  });

  /**
   * 获取已完成的工作流
   */
  const completedWorkflows = computed(() => {
    return workflows.value.filter(w => w.overall?.status === 'completed');
  });

  /**
   * 获取失败的工作流
   */
  const failedWorkflows = computed(() => {
    return workflows.value.filter(w => w.overall?.status === 'failed');
  });

  /**
   * 当前工作流是否正在运行
   */
  const isCurrentRunning = computed(() => {
    return currentWorkflow.value?.overall?.status === 'running';
  });

  /**
   * 当前工作流是否已暂停
   */
  const isCurrentPaused = computed(() => {
    return currentWorkflow.value?.overall?.status === 'paused';
  });

  /**
   * 当前工作流进度
   */
  const currentProgress = computed(() => {
    return currentWorkflow.value?.overall?.percent || 0;
  });

  // ==================== Actions ====================

  /**
   * 加载所有工作流
   */
  async function loadWorkflows() {
    loading.value = true;
    try {
      const result = await window.ipc.invoke('workflow:get-all');
      if (result.success) {
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
   * @param {Object} options - 工作流选项
   * @returns {Object|null} 创建结果
   */
  async function createWorkflow(options) {
    loading.value = true;
    try {
      const result = await window.ipc.invoke('workflow:create', options);
      if (result.success) {
        await loadWorkflows();
        return result.data;
      } else {
        message.error(result.error || '创建失败');
        return null;
      }
    } catch (error) {
      message.error('创建失败: ' + error.message);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建并启动工作流
   * @param {Object} options - 工作流选项
   * @returns {Object|null} 创建结果
   */
  async function createAndStartWorkflow(options) {
    loading.value = true;
    try {
      const result = await window.ipc.invoke('workflow:create-and-start', options);
      if (result.success) {
        currentWorkflowId.value = result.data.workflowId;
        await loadWorkflows();
        return result.data;
      } else {
        message.error(result.error || '创建失败');
        return null;
      }
    } catch (error) {
      message.error('创建失败: ' + error.message);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 启动工作流
   * @param {string} workflowId - 工作流ID
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   */
  async function startWorkflow(workflowId, input, context = {}) {
    try {
      const result = await window.ipc.invoke('workflow:start', {
        workflowId,
        input,
        context,
      });
      if (!result.success) {
        message.error(result.error || '启动失败');
      }
      return result;
    } catch (error) {
      message.error('启动失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 暂停工作流
   * @param {string} workflowId - 工作流ID
   */
  async function pauseWorkflow(workflowId) {
    try {
      const result = await window.ipc.invoke('workflow:pause', { workflowId });
      if (result.success) {
        message.success('工作流已暂停');
      } else {
        message.error(result.error || '暂停失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 恢复工作流
   * @param {string} workflowId - 工作流ID
   */
  async function resumeWorkflow(workflowId) {
    try {
      const result = await window.ipc.invoke('workflow:resume', { workflowId });
      if (result.success) {
        message.success('工作流已恢复');
      } else {
        message.error(result.error || '恢复失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 取消工作流
   * @param {string} workflowId - 工作流ID
   * @param {string} reason - 取消原因
   */
  async function cancelWorkflow(workflowId, reason = '用户取消') {
    try {
      const result = await window.ipc.invoke('workflow:cancel', {
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
      message.error('操作失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 重试工作流
   * @param {string} workflowId - 工作流ID
   */
  async function retryWorkflow(workflowId) {
    try {
      const result = await window.ipc.invoke('workflow:retry', { workflowId });
      if (result.success) {
        message.success('工作流重试中');
      } else {
        message.error(result.error || '重试失败');
      }
      return result;
    } catch (error) {
      message.error('操作失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除工作流
   * @param {string} workflowId - 工作流ID
   */
  async function deleteWorkflow(workflowId) {
    try {
      const result = await window.ipc.invoke('workflow:delete', { workflowId });
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
      message.error('操作失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 选择工作流
   * @param {string} workflowId - 工作流ID
   */
  async function selectWorkflow(workflowId) {
    currentWorkflowId.value = workflowId;
    if (workflowId) {
      await loadWorkflowDetail(workflowId);
    } else {
      currentWorkflow.value = null;
    }
  }

  /**
   * 加载工作流详情
   * @param {string} workflowId - 工作流ID
   */
  async function loadWorkflowDetail(workflowId) {
    try {
      const result = await window.ipc.invoke('workflow:get-status', { workflowId });
      if (result.success) {
        currentWorkflow.value = result.data;
      }
    } catch (error) {
      console.error('加载工作流详情失败:', error);
    }
  }

  /**
   * 覆盖质量门禁
   * @param {string} workflowId - 工作流ID
   * @param {string} gateId - 门禁ID
   * @param {string} reason - 原因
   */
  async function overrideQualityGate(workflowId, gateId, reason = '手动覆盖') {
    try {
      const result = await window.ipc.invoke('workflow:override-gate', {
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
      message.error('操作失败: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 处理工作流进度更新
   * @param {Object} data - 进度数据
   */
  function handleWorkflowProgress(data) {
    // 更新列表中的工作流
    const index = workflows.value.findIndex(w => w.workflowId === data.workflowId);
    if (index >= 0) {
      workflows.value[index] = {
        ...workflows.value[index],
        ...data,
      };
    }

    // 更新当前工作流
    if (currentWorkflowId.value === data.workflowId) {
      currentWorkflow.value = data;
    }

    // 添加到最近日志
    if (data.recentLogs) {
      recentLogs.value = data.recentLogs;
    }
  }

  /**
   * 初始化事件监听
   */
  function initEventListeners() {
    if (window.ipc) {
      window.ipc.on('workflow:progress', handleWorkflowProgress);
      window.ipc.on('workflow:complete', (data) => {
        handleWorkflowProgress(data);
        loadWorkflows();
      });
      window.ipc.on('workflow:error', (data) => {
        handleWorkflowProgress(data);
        loadWorkflows();
      });
    }
  }

  /**
   * 清理事件监听
   */
  function cleanupEventListeners() {
    if (window.ipc) {
      window.ipc.off('workflow:progress', handleWorkflowProgress);
      window.ipc.off('workflow:complete');
      window.ipc.off('workflow:error');
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
