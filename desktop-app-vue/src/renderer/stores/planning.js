import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';

/**
 * 交互式任务规划Store
 * 实现类似Claude Plan模式的对话式任务规划
 */
export const usePlanningStore = defineStore('planning', () => {
  // ==================== State ====================

  // 当前会话
  const currentSession = ref(null);

  // 会话状态: null | 'planning' | 'awaiting_confirmation' | 'executing' | 'completed' | 'failed'
  const sessionStatus = ref(null);

  // 生成的任务计划
  const taskPlan = ref(null);

  // 推荐的模板
  const recommendedTemplates = ref([]);

  // 推荐的技能
  const recommendedSkills = ref([]);

  // 推荐的工具
  const recommendedTools = ref([]);

  // 执行进度
  const executionProgress = ref({
    currentStep: 0,
    totalSteps: 0,
    status: '',
    logs: []
  });

  // 执行结果
  const executionResult = ref(null);

  // 质量评分
  const qualityScore = ref(null);

  // 加载状态
  const loading = ref(false);

  // 对话框可见性
  const dialogVisible = ref(false);

  // ==================== Getters ====================

  /**
   * 是否正在规划中
   */
  const isPlanning = computed(() => {
    return sessionStatus.value === 'planning';
  });

  /**
   * 是否等待确认
   */
  const isAwaitingConfirmation = computed(() => {
    return sessionStatus.value === 'awaiting_confirmation';
  });

  /**
   * 是否正在执行
   */
  const isExecuting = computed(() => {
    return sessionStatus.value === 'executing';
  });

  /**
   * 是否已完成
   */
  const isCompleted = computed(() => {
    return sessionStatus.value === 'completed';
  });

  /**
   * 是否失败
   */
  const isFailed = computed(() => {
    return sessionStatus.value === 'failed';
  });

  /**
   * 执行进度百分比
   */
  const progressPercentage = computed(() => {
    if (executionProgress.value.totalSteps === 0) {return 0;}
    return Math.round(
      (executionProgress.value.currentStep / executionProgress.value.totalSteps) * 100
    );
  });

  // ==================== Actions ====================

  /**
   * 开始Plan会话
   * @param {string} userRequest - 用户请求描述
   * @param {object} projectContext - 项目上下文（可选）
   */
  async function startPlanSession(userRequest, projectContext = {}) {
    loading.value = true;
    sessionStatus.value = 'planning';

    try {
      const result = await window.ipc.invoke('interactive-planning:start-session', {
        userRequest,
        projectContext
      });

      if (result.success) {
        currentSession.value = {
          sessionId: result.sessionId,
          userRequest,
          projectContext
        };

        sessionStatus.value = result.status;
        taskPlan.value = result.plan;
        recommendedTemplates.value = result.recommendedTemplates || [];
        recommendedSkills.value = result.recommendedSkills || [];
        recommendedTools.value = result.recommendedTools || [];

        console.log('[PlanningStore] Plan会话已启动:', result);
        return result;
      } else {
        message.error(`启动Plan会话失败: ${result.error}`);
        sessionStatus.value = 'failed';
        return null;
      }
    } catch (error) {
      message.error('启动Plan会话异常');
      console.error('[PlanningStore] 启动Plan会话异常:', error);
      sessionStatus.value = 'failed';
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 用户响应Plan（确认、调整、应用模板、重新生成、取消）
   * @param {string} action - 动作类型
   * @param {object} data - 动作相关数据
   */
  async function respondToPlan(action, data = {}) {
    if (!currentSession.value) {
      message.error('当前没有活动的Plan会话');
      return null;
    }

    loading.value = true;

    try {
      const result = await window.ipc.invoke('interactive-planning:respond', {
        sessionId: currentSession.value.sessionId,
        userResponse: {
          action,
          ...data
        }
      });

      if (result.success) {
        // 更新状态
        sessionStatus.value = result.status;

        if (action === 'confirm') {
          // 确认执行
          executionProgress.value = {
            currentStep: 0,
            totalSteps: result.totalSteps || 0,
            status: '准备执行...',
            logs: []
          };
        } else if (action === 'adjust' || action === 'use_template' || action === 'regenerate') {
          // 调整后的新计划
          taskPlan.value = result.plan;
          recommendedTemplates.value = result.recommendedTemplates || [];
          recommendedSkills.value = result.recommendedSkills || [];
          recommendedTools.value = result.recommendedTools || [];
        } else if (action === 'cancel') {
          // 取消会话
          reset();
        }

        console.log('[PlanningStore] 用户响应已处理:', result);
        return result;
      } else {
        message.error(`处理用户响应失败: ${result.error}`);
        return null;
      }
    } catch (error) {
      message.error('处理用户响应异常');
      console.error('[PlanningStore] 处理用户响应异常:', error);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 提交用户反馈
   * @param {object} feedback - 反馈数据
   */
  async function submitFeedback(feedback) {
    if (!currentSession.value) {
      message.error('当前没有活动的Plan会话');
      return false;
    }

    try {
      const result = await window.ipc.invoke('interactive-planning:submit-feedback', {
        sessionId: currentSession.value.sessionId,
        feedback
      });

      if (result.success) {
        message.success('反馈已提交，感谢您的宝贵意见！');
        return true;
      } else {
        message.error(`提交反馈失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('提交反馈异常');
      console.error('[PlanningStore] 提交反馈异常:', error);
      return false;
    }
  }

  /**
   * 获取会话信息
   * @param {string} sessionId - 会话ID
   */
  async function getSession(sessionId) {
    try {
      const result = await window.ipc.invoke('interactive-planning:get-session', {
        sessionId
      });

      if (result.success) {
        return result.session;
      } else {
        console.error('[PlanningStore] 获取会话失败:', result.error);
        return null;
      }
    } catch (error) {
      console.error('[PlanningStore] 获取会话异常:', error);
      return null;
    }
  }

  /**
   * 打开Plan对话框
   * @param {string} userRequest - 用户请求
   * @param {object} projectContext - 项目上下文
   */
  async function openPlanDialog(userRequest, projectContext = {}) {
    dialogVisible.value = true;
    await startPlanSession(userRequest, projectContext);
  }

  /**
   * 关闭Plan对话框
   */
  function closePlanDialog() {
    dialogVisible.value = false;
  }

  /**
   * 重置Store
   */
  function reset() {
    currentSession.value = null;
    sessionStatus.value = null;
    taskPlan.value = null;
    recommendedTemplates.value = [];
    recommendedSkills.value = [];
    recommendedTools.value = [];
    executionProgress.value = {
      currentStep: 0,
      totalSteps: 0,
      status: '',
      logs: []
    };
    executionResult.value = null;
    qualityScore.value = null;
    loading.value = false;
    dialogVisible.value = false;
  }

  // ==================== 事件监听 ====================

  /**
   * 监听Plan生成事件
   */
  if (window.ipc) {
    window.ipc.on('interactive-planning:plan-generated', (data) => {
      console.log('[PlanningStore] Plan已生成:', data);
      if (currentSession.value?.sessionId === data.sessionId) {
        taskPlan.value = data.plan;
        recommendedTemplates.value = data.recommendedTemplates || [];
        recommendedSkills.value = data.recommendedSkills || [];
        recommendedTools.value = data.recommendedTools || [];
        sessionStatus.value = 'awaiting_confirmation';
      }
    });

    /**
     * 监听执行开始事件
     */
    window.ipc.on('interactive-planning:execution-started', (data) => {
      console.log('[PlanningStore] 执行已开始:', data);
      if (currentSession.value?.sessionId === data.sessionId) {
        sessionStatus.value = 'executing';
        executionProgress.value = {
          currentStep: 0,
          totalSteps: data.totalSteps || 0,
          status: '执行中...',
          logs: []
        };
      }
    });

    /**
     * 监听执行进度事件
     */
    window.ipc.on('interactive-planning:execution-progress', (data) => {
      console.log('[PlanningStore] 执行进度更新:', data);
      if (currentSession.value?.sessionId === data.sessionId) {
        executionProgress.value.currentStep = data.currentStep;
        executionProgress.value.status = data.status;
        if (data.log) {
          executionProgress.value.logs.push({
            timestamp: Date.now(),
            message: data.log
          });
        }
      }
    });

    /**
     * 监听执行完成事件
     */
    window.ipc.on('interactive-planning:execution-completed', (data) => {
      console.log('[PlanningStore] 执行已完成:', data);
      if (currentSession.value?.sessionId === data.sessionId) {
        sessionStatus.value = 'completed';
        executionResult.value = data.result;
        qualityScore.value = data.qualityScore;
        executionProgress.value.status = '执行完成！';

        message.success('任务执行完成！');
      }
    });

    /**
     * 监听执行失败事件
     */
    window.ipc.on('interactive-planning:execution-failed', (data) => {
      console.error('[PlanningStore] 执行失败:', data);
      if (currentSession.value?.sessionId === data.sessionId) {
        sessionStatus.value = 'failed';
        executionProgress.value.status = `执行失败: ${data.error}`;

        message.error(`执行失败: ${data.error}`);
      }
    });

    /**
     * 监听反馈提交事件
     */
    window.ipc.on('interactive-planning:feedback-submitted', (data) => {
      console.log('[PlanningStore] 反馈已提交:', data);
    });
  }

  // ==================== 返回 ====================

  return {
    // State
    currentSession,
    sessionStatus,
    taskPlan,
    recommendedTemplates,
    recommendedSkills,
    recommendedTools,
    executionProgress,
    executionResult,
    qualityScore,
    loading,
    dialogVisible,

    // Getters
    isPlanning,
    isAwaitingConfirmation,
    isExecuting,
    isCompleted,
    isFailed,
    progressPercentage,

    // Actions
    startPlanSession,
    respondToPlan,
    submitFeedback,
    getSession,
    openPlanDialog,
    closePlanDialog,
    reset
  };
});
