/**
 * ChatPanel 消息类型定义
 * 用于在对话列表中展示不同类型的交互
 */

// ==================== 类型定义 ====================

/**
 * 消息类型
 */
export type MessageTypeValue =
  | 'user'
  | 'assistant'
  | 'system'
  | 'intent-recognition'
  | 'intent-confirmation'
  | 'task-analysis'
  | 'interview'
  | 'task-plan'
  | 'progress'
  | 'error';

/**
 * 消息角色
 */
export type MessageRoleValue = 'user' | 'assistant' | 'system';

/**
 * 意图类型
 */
export type IntentType =
  | 'CONTINUE_EXECUTION'
  | 'MODIFY_REQUIREMENT'
  | 'CLARIFICATION'
  | 'CANCEL_TASK';

/**
 * 基础消息
 */
export interface BaseMessage {
  id: string;
  role: MessageRoleValue;
  type: MessageTypeValue;
  content: string;
  timestamp: number;
  conversation_id?: string | null;
  metadata?: Record<string, any>;
}

/**
 * 用户消息
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
  type: 'user';
}

/**
 * 助手消息
 */
export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  type: 'assistant';
}

/**
 * 系统消息
 */
export interface SystemMessage extends BaseMessage {
  role: 'system';
  type: 'system';
}

/**
 * 意图识别消息
 */
export interface IntentRecognitionMessage extends BaseMessage {
  type: 'intent-recognition';
  metadata: {
    intentResult: any;
  };
}

/**
 * 意图确认消息
 */
export interface IntentConfirmationMessage extends BaseMessage {
  type: 'intent-confirmation';
  metadata: {
    originalInput: string;
    understanding: {
      correctedInput?: string;
      intent?: string;
      keyPoints?: string[];
    };
    status: 'pending' | 'confirmed' | 'corrected';
    correction: string | null;
  };
}

/**
 * 任务分析消息
 */
export interface TaskAnalysisMessage extends BaseMessage {
  type: 'task-analysis';
  metadata: {
    status: 'analyzing' | 'completed';
  };
}

/**
 * 采访消息
 */
export interface InterviewMessage extends BaseMessage {
  type: 'interview';
  metadata: {
    questions: string[];
    currentIndex: number;
    answers: Record<string, string>;
  };
}

/**
 * 任务计划消息
 */
export interface TaskPlanMessage extends BaseMessage {
  type: 'task-plan';
  metadata: {
    plan: any;
    status: 'pending' | 'confirmed' | 'executing' | 'completed';
  };
}

/**
 * 进度消息
 */
export interface ProgressMessage extends BaseMessage {
  type: 'progress';
  metadata: {
    progress: number;
  };
}

/**
 * 错误消息
 */
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  metadata: {
    error: Error | string;
  };
}

/**
 * 意图系统消息选项
 */
export interface IntentMessageOptions {
  reason?: string;
  extractedInfo?: string;
}

/**
 * 理解结果
 */
export interface Understanding {
  correctedInput?: string;
  intent?: string;
  keyPoints?: string[];
}

// ==================== 常量 ====================

// 消息类型枚举
export const MessageType: Record<string, MessageTypeValue> = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  INTENT_RECOGNITION: 'intent-recognition',
  INTENT_CONFIRMATION: 'intent-confirmation',
  TASK_ANALYSIS: 'task-analysis',
  INTERVIEW: 'interview',
  TASK_PLAN: 'task-plan',
  PROGRESS: 'progress',
  ERROR: 'error',
};

// 消息角色
export const MessageRole: Record<string, MessageRoleValue> = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
};

// ==================== 工厂函数 ====================

/**
 * 创建用户消息
 */
export function createUserMessage(
  content: string,
  conversationId: string | null = null
): UserMessage {
  return {
    id: `msg_${Date.now()}_user`,
    conversation_id: conversationId,
    role: 'user',
    type: 'user',
    content,
    timestamp: Date.now(),
  };
}

/**
 * 创建助手消息
 */
export function createAssistantMessage(
  content: string,
  conversationId: string | null = null,
  metadata: Record<string, any> = {}
): AssistantMessage {
  return {
    id: `msg_${Date.now()}_assistant`,
    conversation_id: conversationId,
    role: 'assistant',
    type: 'assistant',
    content,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * 创建系统消息
 */
export function createSystemMessage(
  content: string,
  metadata: Record<string, any> = {}
): SystemMessage {
  return {
    id: `msg_${Date.now()}_system`,
    role: 'system',
    type: 'system',
    content,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * 创建后续输入意图系统消息
 */
export function createIntentSystemMessage(
  intent: IntentType,
  userInput: string,
  options: IntentMessageOptions = {}
): SystemMessage {
  const { reason, extractedInfo } = options;

  const messages: Record<IntentType, { content: string; icon: string }> = {
    CONTINUE_EXECUTION: {
      content: '✅ 收到，继续执行任务...',
      icon: '✅',
    },
    MODIFY_REQUIREMENT: {
      content: `⚠️ 检测到需求变更: ${extractedInfo || userInput}\n正在重新规划任务...`,
      icon: '⚠️',
    },
    CLARIFICATION: {
      content: `📝 已记录补充信息: ${extractedInfo || userInput}\n继续执行任务...`,
      icon: '📝',
    },
    CANCEL_TASK: {
      content: `❌ 任务已取消`,
      icon: '❌',
    },
  };

  const messageConfig = messages[intent] || {
    content: '⚠️ 未知意图，请重新表述',
    icon: '⚠️',
  };

  return {
    id: `msg_${Date.now()}_system`,
    role: 'system',
    type: 'system',
    content: messageConfig.content,
    timestamp: Date.now(),
    metadata: {
      intent,
      reason,
      userInput,
      extractedInfo,
    },
  };
}

/**
 * 创建意图识别消息
 */
export function createIntentRecognitionMessage(intentResult: any): IntentRecognitionMessage {
  return {
    id: `msg_${Date.now()}_intent`,
    role: 'system',
    type: 'intent-recognition',
    content: '正在分析您的需求...',
    timestamp: Date.now(),
    metadata: {
      intentResult,
    },
  };
}

/**
 * 创建任务分析消息
 */
export function createTaskAnalysisMessage(
  status: 'analyzing' | 'completed' = 'analyzing'
): TaskAnalysisMessage {
  return {
    id: `msg_${Date.now()}_analysis`,
    role: 'system',
    type: 'task-analysis',
    content: '正在分析任务复杂度...',
    timestamp: Date.now(),
    metadata: {
      status,
    },
  };
}

/**
 * 创建采访问题消息
 */
export function createInterviewMessage(
  questions: string[],
  currentIndex: number = 0
): InterviewMessage {
  return {
    id: `msg_${Date.now()}_interview`,
    role: 'assistant',
    type: 'interview',
    content: '为了更好地完成任务，我需要了解一些信息：',
    timestamp: Date.now(),
    metadata: {
      questions,
      currentIndex,
      answers: {},
    },
  };
}

/**
 * 创建任务计划消息
 */
export function createTaskPlanMessage(plan: any): TaskPlanMessage {
  return {
    id: `msg_${Date.now()}_plan`,
    role: 'assistant',
    type: 'task-plan',
    content: '我已经为您制定了执行计划：',
    timestamp: Date.now(),
    metadata: {
      plan,
      status: 'pending',
    },
  };
}

/**
 * 创建进度消息
 */
export function createProgressMessage(taskName: string, progress: number = 0): ProgressMessage {
  return {
    id: `msg_${Date.now()}_progress`,
    role: 'system',
    type: 'progress',
    content: taskName,
    timestamp: Date.now(),
    metadata: {
      progress,
    },
  };
}

/**
 * 创建错误消息
 */
export function createErrorMessage(error: Error | string): ErrorMessage {
  return {
    id: `msg_${Date.now()}_error`,
    role: 'system',
    type: 'error',
    content: typeof error === 'string' ? error : error.message,
    timestamp: Date.now(),
    metadata: {
      error,
    },
  };
}

/**
 * 创建意图确认消息
 */
export function createIntentConfirmationMessage(
  originalInput: string,
  understanding: Understanding
): IntentConfirmationMessage {
  return {
    id: `msg_${Date.now()}_intent_confirmation`,
    role: 'assistant',
    type: 'intent-confirmation',
    content: '我理解您的需求如下，请确认：',
    timestamp: Date.now(),
    metadata: {
      originalInput,
      understanding,
      status: 'pending',
      correction: null,
    },
  };
}
