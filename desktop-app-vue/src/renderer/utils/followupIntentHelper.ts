/**
 * 后续输入意图处理助手
 * 简化的工具函数，用于在 ChatPanel.vue 中集成后续输入意图分类
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 意图类型枚举
 */
export type IntentType = 'CONTINUE_EXECUTION' | 'MODIFY_REQUIREMENT' | 'CLARIFICATION' | 'CANCEL_TASK';

/**
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 消息类型枚举
 */
export type MessageType = 'TASK_PLAN' | 'SYSTEM' | 'USER' | 'ASSISTANT';

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

/**
 * 任务步骤
 */
export interface TaskStep {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
}

/**
 * 任务计划
 */
export interface TaskPlan {
  title?: string;
  description?: string;
  steps?: TaskStep[];
  clarifications?: Clarification[];
}

/**
 * 补充说明
 */
export interface Clarification {
  content: string;
  timestamp: number;
}

/**
 * 消息元数据
 */
export interface MessageMetadata {
  status?: TaskStatus;
  plan?: TaskPlan;
  intent?: IntentType;
  reason?: string;
  userInput?: string;
  extractedInfo?: string;
}

/**
 * 消息对象
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type?: MessageType;
  metadata?: MessageMetadata;
}

/**
 * 分类上下文 - 当前任务
 */
export interface CurrentTaskContext {
  name: string;
  description?: string;
  status?: TaskStatus;
  steps?: TaskStep[];
}

/**
 * 分类上下文 - 对话历史条目
 */
export interface ConversationHistoryEntry {
  role: MessageRole;
  content: string;
}

/**
 * 分类上下文
 */
export interface ClassificationContext {
  currentTask?: CurrentTaskContext;
  taskPlan?: TaskPlan;
  conversationHistory?: ConversationHistoryEntry[];
}

/**
 * 系统消息配置
 */
export interface SystemMessageConfig {
  content: string;
  icon: string;
}

/**
 * 系统消息
 */
export interface SystemMessage extends Message {
  type: 'SYSTEM';
}

/**
 * 意图系统消息选项
 */
export interface IntentSystemMessageOptions {
  reason?: string;
  extractedInfo?: string;
}

/**
 * 分类结果数据
 */
export interface ClassificationResultData {
  intent: IntentType;
  confidence: number;
  reason: string;
  method: 'rule' | 'llm' | 'error_fallback';
  latency?: number;
  error?: string;
}

/**
 * 分类结果
 */
export interface ClassificationResult {
  success: boolean;
  data: ClassificationResultData;
}

/**
 * 确认对话框配置
 */
export interface ConfirmationDialogConfig {
  title: string;
  content: string;
  okText: string;
  cancelText: string;
  type: 'confirm';
}

/**
 * 批量测试结果条目
 */
export interface BatchTestResultEntry {
  input: string;
  intent?: IntentType;
  confidence?: number;
  method?: string;
  error?: string;
}

/**
 * Electron API 类型扩展
 */
interface ElectronFollowupIntentAPI {
  classify: (params: { input: string; context: ClassificationContext }) => Promise<ClassificationResult>;
}

interface ElectronAPIWithFollowupIntent {
  followupIntent?: ElectronFollowupIntentAPI;
}

// ==================== 功能函数 ====================

/**
 * 检查是否有正在执行的任务
 * @param messages - 消息数组
 * @returns 正在执行的任务计划消息
 */
export function findExecutingTask(messages: Message[] | null | undefined): Message | null {
  if (!messages || !Array.isArray(messages)) {
    return null;
  }

  // 从后往前查找最近的正在执行的任务计划消息
  const executingTask = [...messages].reverse().find(msg =>
    msg.type === 'TASK_PLAN' &&
    msg.metadata?.status === 'executing'
  );

  return executingTask || null;
}

/**
 * 构建意图分类的上下文
 * @param taskMessage - 任务计划消息
 * @param messages - 完整消息列表
 * @returns 上下文对象
 */
export function buildClassificationContext(
  taskMessage: Message | null,
  messages: Message[] = []
): ClassificationContext {
  if (!taskMessage) {
    return {};
  }

  return {
    currentTask: {
      name: taskMessage.metadata?.plan?.title || '未命名任务',
      description: taskMessage.metadata?.plan?.description,
      status: taskMessage.metadata?.status,
      steps: taskMessage.metadata?.plan?.steps
    },
    taskPlan: taskMessage.metadata?.plan,
    conversationHistory: messages.slice(-5).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 200) : '' // 限制长度
    }))
  };
}

/**
 * 系统消息映射
 */
const SYSTEM_MESSAGES: Record<IntentType, SystemMessageConfig> = {
  CONTINUE_EXECUTION: {
    content: '✅ 收到，继续执行任务...',
    icon: '✅'
  },
  MODIFY_REQUIREMENT: {
    content: '⚠️ 检测到需求变更，正在重新规划任务...',
    icon: '⚠️'
  },
  CLARIFICATION: {
    content: '📝 已记录补充信息，继续执行任务...',
    icon: '📝'
  },
  CANCEL_TASK: {
    content: '❌ 任务已取消',
    icon: '❌'
  }
};

/**
 * 根据意图生成系统消息
 * @param intent - 意图类型
 * @param userInput - 用户输入
 * @param options - 额外选项
 * @returns 系统消息对象
 */
export function createIntentSystemMessage(
  intent: IntentType,
  userInput: string,
  options: IntentSystemMessageOptions = {}
): SystemMessage {
  const { reason, extractedInfo } = options;

  let messageConfig = SYSTEM_MESSAGES[intent];

  // 根据意图类型自定义消息内容
  if (intent === 'MODIFY_REQUIREMENT') {
    messageConfig = {
      ...messageConfig,
      content: `⚠️ 检测到需求变更: ${extractedInfo || userInput}\n正在重新规划任务...`
    };
  } else if (intent === 'CLARIFICATION') {
    messageConfig = {
      ...messageConfig,
      content: `📝 已记录补充信息: ${extractedInfo || userInput}\n继续执行任务...`
    };
  }

  if (!messageConfig) {
    messageConfig = {
      content: '⚠️ 未知意图，请重新表述',
      icon: '⚠️'
    };
  }

  return {
    id: `msg_${Date.now()}_system`,
    role: 'system',
    content: messageConfig.content,
    timestamp: Date.now(),
    type: 'SYSTEM',
    metadata: {
      intent,
      reason,
      userInput,
      extractedInfo
    }
  };
}

/**
 * 合并原需求和新需求
 * @param originalRequirement - 原始需求
 * @param newRequirement - 新需求
 * @returns 合并后的需求
 */
export function mergeRequirements(originalRequirement: string, newRequirement: string): string {
  return `${originalRequirement}

【追加需求】
${newRequirement}

【说明】
请在保持原有需求的基础上，整合上述追加需求，生成新的任务计划。`;
}

/**
 * 更新任务计划的补充信息
 * @param taskPlan - 任务计划对象
 * @param clarification - 补充说明
 * @returns 更新后的任务计划
 */
export function addClarificationToTaskPlan(
  taskPlan: TaskPlan | null | undefined,
  clarification: string
): TaskPlan | null {
  if (!taskPlan) {
    return null;
  }

  const updatedPlan: TaskPlan = { ...taskPlan };

  if (!updatedPlan.clarifications) {
    updatedPlan.clarifications = [];
  }

  updatedPlan.clarifications.push({
    content: clarification,
    timestamp: Date.now()
  });

  return updatedPlan;
}

/**
 * 意图描述映射
 */
const INTENT_DESCRIPTIONS: Record<IntentType, string> = {
  CONTINUE_EXECUTION: '继续执行',
  MODIFY_REQUIREMENT: '修改需求',
  CLARIFICATION: '补充说明',
  CANCEL_TASK: '取消任务'
};

/**
 * 获取意图的中文描述
 * @param intent - 意图类型
 * @returns 中文描述
 */
export function getIntentDescription(intent: IntentType): string {
  return INTENT_DESCRIPTIONS[intent] || '未知意图';
}

/**
 * 判断是否需要用户确认
 * @param classifyResult - 分类结果
 * @param threshold - 置信度阈值（默认 0.6）
 * @returns 是否需要确认
 */
export function needsUserConfirmation(
  classifyResult: ClassificationResult | null | undefined,
  threshold: number = 0.6
): boolean {
  if (!classifyResult || !classifyResult.data) {
    return true;
  }

  const { confidence, method } = classifyResult.data;

  // 规则匹配且置信度高，不需要确认
  if (method === 'rule' && confidence > 0.8) {
    return false;
  }

  // LLM 分析但置信度低，需要确认
  if (confidence < threshold) {
    return true;
  }

  return false;
}

/**
 * 生成意图确认对话框配置
 * @param classifyResult - 分类结果
 * @param userInput - 用户输入
 * @returns 对话框配置
 */
export function createConfirmationDialogConfig(
  classifyResult: ClassificationResult,
  userInput: string
): ConfirmationDialogConfig {
  const { intent, confidence, reason } = classifyResult.data;

  return {
    title: '请确认您的意图',
    content: `系统判断您想要「${getIntentDescription(intent)}」\n\n原因: ${reason}\n置信度: ${(confidence * 100).toFixed(1)}%\n\n这是否正确？`,
    okText: '是的',
    cancelText: '不是',
    type: 'confirm'
  };
}

/**
 * 处理意图分类错误
 * @param error - 错误对象
 * @param userInput - 用户输入
 * @returns 降级结果
 */
export function handleClassificationError(
  error: Error,
  userInput: string
): ClassificationResult {
  logger.error('[FollowupIntent] 分类失败:', error as any);

  // 返回默认降级结果
  return {
    success: true,
    data: {
      intent: 'CLARIFICATION',
      confidence: 0.5,
      reason: '分类失败，默认为补充说明',
      method: 'error_fallback',
      error: error.message
    }
  };
}

/**
 * 格式化意图日志
 * @param classifyResult - 分类结果
 * @param userInput - 用户输入
 * @returns 格式化的日志字符串
 */
export function formatIntentLog(
  classifyResult: ClassificationResult | null | undefined,
  userInput: string
): string {
  if (!classifyResult || !classifyResult.data) {
    return `[Intent] 输入: "${userInput}" - 分类失败`;
  }

  const { intent, confidence, method, latency } = classifyResult.data;

  return [
    `[Intent] 输入: "${userInput}"`,
    `意图: ${getIntentDescription(intent)} (${intent})`,
    `置信度: ${(confidence * 100).toFixed(1)}%`,
    `方法: ${method}`,
    `耗时: ${latency}ms`
  ].join(' | ');
}

/**
 * 批量测试意图分类（调试用）
 * @param testInputs - 测试输入数组
 * @returns 测试结果数组
 */
export async function batchTestIntents(testInputs: string[]): Promise<BatchTestResultEntry[]> {
  const electronAPI = (window as any).electronAPI as ElectronAPIWithFollowupIntent | undefined;

  if (!electronAPI?.followupIntent) {
    logger.error('[FollowupIntent] API 不可用');
    return [];
  }

  const results: BatchTestResultEntry[] = [];

  for (const input of testInputs) {
    try {
      const result = await electronAPI.followupIntent.classify({
        input,
        context: {}
      });

      results.push({
        input,
        intent: result.data.intent,
        confidence: result.data.confidence,
        method: result.data.method
      });

      logger.info(formatIntentLog(result, input));
    } catch (error) {
      results.push({
        input,
        error: (error as Error).message
      });
    }
  }

  return results;
}

// ==================== 调试工具 ====================

/**
 * 扩展 Window 接口以支持调试函数
 */
declare global {
  interface Window {
    testFollowupIntent?: (input: string) => Promise<ClassificationResultData | null>;
    batchTestFollowupIntent?: () => Promise<BatchTestResultEntry[]>;
  }
}

/**
 * 调试模式：在控制台测试意图分类
 * 使用方法: 在浏览器控制台运行 window.testFollowupIntent('继续')
 */
if (typeof window !== 'undefined') {
  window.testFollowupIntent = async (input: string): Promise<ClassificationResultData | null> => {
    try {
      const electronAPI = (window as any).electronAPI as ElectronAPIWithFollowupIntent | undefined;

      if (!electronAPI?.followupIntent) {
        logger.error('[FollowupIntent] API 不可用');
        return null;
      }

      const result = await electronAPI.followupIntent.classify({
        input,
        context: {}
      });

      logger.info('=== 意图分类结果 ===');
      logger.info('输入:', { input });
      logger.info('意图:', { description: getIntentDescription(result.data.intent), intent: result.data.intent });
      logger.info('置信度:', { confidence: (result.data.confidence * 100).toFixed(1) + '%' });
      logger.info('方法:', { method: result.data.method });
      logger.info('理由:', { reason: result.data.reason });
      logger.info('耗时:', { latency: result.data.latency + 'ms' });

      return result.data;
    } catch (error) {
      logger.error('测试失败:', error as any);
      return null;
    }
  };

  // 批量测试
  window.batchTestFollowupIntent = async (): Promise<BatchTestResultEntry[]> => {
    const testCases: string[] = [
      '继续',
      '好的',
      '改成红色',
      '还要加一个登录页',
      '标题用宋体',
      '算了',
      '快点',
      '等等，我还要修改一下'
    ];

    return await batchTestIntents(testCases);
  };
}
