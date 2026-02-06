/**
 * Planning Store - 交互式任务规划
 * 实现类似Claude Plan模式的对话式任务规划
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';

// ==================== 类型定义 ====================

/**
 * 会话状态类型
 */
export type SessionStatus =
  | null
  | 'planning'
  | 'awaiting_confirmation'
  | 'executing'
  | 'completed'
  | 'failed';

/**
 * 用户响应动作类型
 */
export type ResponseAction = 'confirm' | 'adjust' | 'use_template' | 'regenerate' | 'cancel';

/**
 * 项目上下文
 */
export interface ProjectContext {
  projectId?: string;
  projectName?: string;
  [key: string]: any;
}

/**
 * 规划会话信息
 */
export interface PlanningSession {
  sessionId: string;
  userRequest: string;
  projectContext: ProjectContext;
}

/**
 * 任务步骤
 */
export interface TaskStep {
  id: string;
  name: string;
  description?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  [key: string]: any;
}

/**
 * 任务计划
 */
export interface TaskPlan {
  id: string;
  title: string;
  description?: string;
  steps: TaskStep[];
  estimatedTime?: number;
  [key: string]: any;
}

/**
 * 推荐模板
 */
export interface RecommendedTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  [key: string]: any;
}

/**
 * 推荐技能
 */
export interface RecommendedSkill {
  id: string;
  name: string;
  description?: string;
  relevance?: number;
  [key: string]: any;
}

/**
 * 推荐工具
 */
export interface RecommendedTool {
  id: string;
  name: string;
  description?: string;
  relevance?: number;
  [key: string]: any;
}

/**
 * 执行日志条目
 */
export interface ExecutionLogEntry {
  timestamp: number;
  message: string;
}

/**
 * 执行进度
 */
export interface ExecutionProgress {
  currentStep: number;
  totalSteps: number;
  status: string;
  logs: ExecutionLogEntry[];
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  [key: string]: any;
}

/**
 * 质量评分
 */
export interface QualityScore {
  overall: number;
  accuracy?: number;
  completeness?: number;
  efficiency?: number;
  [key: string]: any;
}

/**
 * 用户反馈
 */
export interface UserFeedback {
  rating?: number;
  comment?: string;
  suggestions?: string[];
  [key: string]: any;
}

/**
 * 用户响应数据
 */
export interface ResponseData {
  adjustments?: Partial<TaskPlan>;
  templateId?: string;
  [key: string]: any;
}

/**
 * 开始会话结果
 */
export interface StartSessionResult {
  success: boolean;
  sessionId?: string;
  status?: SessionStatus;
  plan?: TaskPlan;
  recommendedTemplates?: RecommendedTemplate[];
  recommendedSkills?: RecommendedSkill[];
  recommendedTools?: RecommendedTool[];
  error?: string;
}

/**
 * 响应结果
 */
export interface RespondResult {
  success: boolean;
  status?: SessionStatus;
  plan?: TaskPlan;
  recommendedTemplates?: RecommendedTemplate[];
  recommendedSkills?: RecommendedSkill[];
  recommendedTools?: RecommendedTool[];
  totalSteps?: number;
  error?: string;
}

/**
 * Plan生成事件数据
 */
export interface PlanGeneratedEvent {
  sessionId: string;
  plan: TaskPlan;
  recommendedTemplates?: RecommendedTemplate[];
  recommendedSkills?: RecommendedSkill[];
  recommendedTools?: RecommendedTool[];
}

/**
 * 执行开始事件数据
 */
export interface ExecutionStartedEvent {
  sessionId: string;
  totalSteps?: number;
}

/**
 * 执行进度事件数据
 */
export interface ExecutionProgressEvent {
  sessionId: string;
  currentStep: number;
  status: string;
  log?: string;
}

/**
 * 执行完成事件数据
 */
export interface ExecutionCompletedEvent {
  sessionId: string;
  result: ExecutionResult;
  qualityScore?: QualityScore;
}

/**
 * 执行失败事件数据
 */
export interface ExecutionFailedEvent {
  sessionId: string;
  error: string;
}

// ==================== Store ====================

export const usePlanningStore = defineStore('planning', () => {
  // ==================== State ====================

  // 当前会话
  const currentSession = ref<PlanningSession | null>(null);

  // 会话状态
  const sessionStatus = ref<SessionStatus>(null);

  // 生成的任务计划
  const taskPlan = ref<TaskPlan | null>(null);

  // 推荐的模板
  const recommendedTemplates = ref<RecommendedTemplate[]>([]);

  // 推荐的技能
  const recommendedSkills = ref<RecommendedSkill[]>([]);

  // 推荐的工具
  const recommendedTools = ref<RecommendedTool[]>([]);

  // 执行进度
  const executionProgress = ref<ExecutionProgress>({
    currentStep: 0,
    totalSteps: 0,
    status: '',
    logs: [],
  });

  // 执行结果
  const executionResult = ref<ExecutionResult | null>(null);

  // 质量评分
  const qualityScore = ref<QualityScore | null>(null);

  // 加载状态
  const loading = ref<boolean>(false);

  // 对话框可见性
  const dialogVisible = ref<boolean>(false);

  // ==================== Getters ====================

  /**
   * 是否正在规划中
   */
  const isPlanning = computed<boolean>(() => {
    return sessionStatus.value === 'planning';
  });

  /**
   * 是否等待确认
   */
  const isAwaitingConfirmation = computed<boolean>(() => {
    return sessionStatus.value === 'awaiting_confirmation';
  });

  /**
   * 是否正在执行
   */
  const isExecuting = computed<boolean>(() => {
    return sessionStatus.value === 'executing';
  });

  /**
   * 是否已完成
   */
  const isCompleted = computed<boolean>(() => {
    return sessionStatus.value === 'completed';
  });

  /**
   * 是否失败
   */
  const isFailed = computed<boolean>(() => {
    return sessionStatus.value === 'failed';
  });

  /**
   * 执行进度百分比
   */
  const progressPercentage = computed<number>(() => {
    if (executionProgress.value.totalSteps === 0) {
      return 0;
    }
    return Math.round(
      (executionProgress.value.currentStep / executionProgress.value.totalSteps) * 100
    );
  });

  // ==================== Actions ====================

  /**
   * 开始Plan会话
   * @param userRequest - 用户请求描述
   * @param projectContext - 项目上下文（可选）
   */
  async function startPlanSession(
    userRequest: string,
    projectContext: ProjectContext = {}
  ): Promise<StartSessionResult | null> {
    loading.value = true;
    sessionStatus.value = 'planning';

    try {
      const result: StartSessionResult = await (window as any).ipc.invoke(
        'interactive-planning:start-session',
        {
          userRequest,
          projectContext,
        }
      );

      if (result.success) {
        currentSession.value = {
          sessionId: result.sessionId!,
          userRequest,
          projectContext,
        };

        sessionStatus.value = result.status || null;
        taskPlan.value = result.plan || null;
        recommendedTemplates.value = result.recommendedTemplates || [];
        recommendedSkills.value = result.recommendedSkills || [];
        recommendedTools.value = result.recommendedTools || [];

        logger.info('[PlanningStore] Plan会话已启动:', result);
        return result;
      } else {
        message.error(`启动Plan会话失败: ${result.error}`);
        sessionStatus.value = 'failed';
        return null;
      }
    } catch (error) {
      message.error('启动Plan会话异常');
      logger.error('[PlanningStore] 启动Plan会话异常:', error as any);
      sessionStatus.value = 'failed';
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 用户响应Plan（确认、调整、应用模板、重新生成、取消）
   * @param action - 动作类型
   * @param data - 动作相关数据
   */
  async function respondToPlan(
    action: ResponseAction,
    data: ResponseData = {}
  ): Promise<RespondResult | null> {
    if (!currentSession.value) {
      message.error('当前没有活动的Plan会话');
      return null;
    }

    loading.value = true;

    try {
      const result: RespondResult = await (window as any).ipc.invoke(
        'interactive-planning:respond',
        {
          sessionId: currentSession.value.sessionId,
          userResponse: {
            action,
            ...data,
          },
        }
      );

      if (result.success) {
        // 更新状态
        sessionStatus.value = result.status || null;

        if (action === 'confirm') {
          // 确认执行
          executionProgress.value = {
            currentStep: 0,
            totalSteps: result.totalSteps || 0,
            status: '准备执行...',
            logs: [],
          };
        } else if (action === 'adjust' || action === 'use_template' || action === 'regenerate') {
          // 调整后的新计划
          taskPlan.value = result.plan || null;
          recommendedTemplates.value = result.recommendedTemplates || [];
          recommendedSkills.value = result.recommendedSkills || [];
          recommendedTools.value = result.recommendedTools || [];
        } else if (action === 'cancel') {
          // 取消会话
          reset();
        }

        logger.info('[PlanningStore] 用户响应已处理:', result);
        return result;
      } else {
        message.error(`处理用户响应失败: ${result.error}`);
        return null;
      }
    } catch (error) {
      message.error('处理用户响应异常');
      logger.error('[PlanningStore] 处理用户响应异常:', error as any);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 提交用户反馈
   * @param feedback - 反馈数据
   */
  async function submitFeedback(feedback: UserFeedback): Promise<boolean> {
    if (!currentSession.value) {
      message.error('当前没有活动的Plan会话');
      return false;
    }

    try {
      const result = await (window as any).ipc.invoke(
        'interactive-planning:submit-feedback',
        {
          sessionId: currentSession.value.sessionId,
          feedback,
        }
      );

      if (result.success) {
        message.success('反馈已提交，感谢您的宝贵意见！');
        return true;
      } else {
        message.error(`提交反馈失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('提交反馈异常');
      logger.error('[PlanningStore] 提交反馈异常:', error as any);
      return false;
    }
  }

  /**
   * 获取会话信息
   * @param sessionId - 会话ID
   */
  async function getSession(sessionId: string): Promise<PlanningSession | null> {
    try {
      const result = await (window as any).ipc.invoke('interactive-planning:get-session', {
        sessionId,
      });

      if (result.success) {
        return result.session;
      } else {
        logger.error('[PlanningStore] 获取会话失败:', result.error);
        return null;
      }
    } catch (error) {
      logger.error('[PlanningStore] 获取会话异常:', error as any);
      return null;
    }
  }

  /**
   * 打开Plan对话框
   * @param userRequest - 用户请求
   * @param projectContext - 项目上下文
   */
  async function openPlanDialog(
    userRequest: string,
    projectContext: ProjectContext = {}
  ): Promise<void> {
    dialogVisible.value = true;
    await startPlanSession(userRequest, projectContext);
  }

  /**
   * 关闭Plan对话框
   */
  function closePlanDialog(): void {
    dialogVisible.value = false;
  }

  /**
   * 重置Store
   */
  function reset(): void {
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
      logs: [],
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
  if ((window as any).ipc) {
    (window as any).ipc.on(
      'interactive-planning:plan-generated',
      (data: PlanGeneratedEvent) => {
        logger.info('[PlanningStore] Plan已生成:', data);
        if (currentSession.value?.sessionId === data.sessionId) {
          taskPlan.value = data.plan;
          recommendedTemplates.value = data.recommendedTemplates || [];
          recommendedSkills.value = data.recommendedSkills || [];
          recommendedTools.value = data.recommendedTools || [];
          sessionStatus.value = 'awaiting_confirmation';
        }
      }
    );

    /**
     * 监听执行开始事件
     */
    (window as any).ipc.on(
      'interactive-planning:execution-started',
      (data: ExecutionStartedEvent) => {
        logger.info('[PlanningStore] 执行已开始:', data);
        if (currentSession.value?.sessionId === data.sessionId) {
          sessionStatus.value = 'executing';
          executionProgress.value = {
            currentStep: 0,
            totalSteps: data.totalSteps || 0,
            status: '执行中...',
            logs: [],
          };
        }
      }
    );

    /**
     * 监听执行进度事件
     */
    (window as any).ipc.on(
      'interactive-planning:execution-progress',
      (data: ExecutionProgressEvent) => {
        logger.info('[PlanningStore] 执行进度更新:', data);
        if (currentSession.value?.sessionId === data.sessionId) {
          executionProgress.value.currentStep = data.currentStep;
          executionProgress.value.status = data.status;
          if (data.log) {
            executionProgress.value.logs.push({
              timestamp: Date.now(),
              message: data.log,
            });
          }
        }
      }
    );

    /**
     * 监听执行完成事件
     */
    (window as any).ipc.on(
      'interactive-planning:execution-completed',
      (data: ExecutionCompletedEvent) => {
        logger.info('[PlanningStore] 执行已完成:', data);
        if (currentSession.value?.sessionId === data.sessionId) {
          sessionStatus.value = 'completed';
          executionResult.value = data.result;
          qualityScore.value = data.qualityScore || null;
          executionProgress.value.status = '执行完成！';

          message.success('任务执行完成！');
        }
      }
    );

    /**
     * 监听执行失败事件
     */
    (window as any).ipc.on(
      'interactive-planning:execution-failed',
      (data: ExecutionFailedEvent) => {
        logger.error('[PlanningStore] 执行失败:', data);
        if (currentSession.value?.sessionId === data.sessionId) {
          sessionStatus.value = 'failed';
          executionProgress.value.status = `执行失败: ${data.error}`;

          message.error(`执行失败: ${data.error}`);
        }
      }
    );

    /**
     * 监听反馈提交事件
     */
    (window as any).ipc.on(
      'interactive-planning:feedback-submitted',
      (data: { sessionId: string }) => {
        logger.info('[PlanningStore] 反馈已提交:', data);
      }
    );
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
    reset,
  };
});
