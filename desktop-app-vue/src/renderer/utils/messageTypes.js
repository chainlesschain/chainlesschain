/**
 * ChatPanel 消息类型定义
 * 用于在对话列表中展示不同类型的交互
 */

// 消息类型枚举
export const MessageType = {
  USER: 'user',                          // 用户消息
  ASSISTANT: 'assistant',                // AI助手回复
  SYSTEM: 'system',                      // 系统消息（提示、通知）
  INTENT_RECOGNITION: 'intent-recognition', // 意图识别结果
  TASK_ANALYSIS: 'task-analysis',        // 任务分析中
  INTERVIEW: 'interview',                // 采访问题
  TASK_PLAN: 'task-plan',                // 任务计划
  PROGRESS: 'progress',                  // 执行进度
  ERROR: 'error',                        // 错误消息
};

// 消息角色
export const MessageRole = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
};

/**
 * 创建用户消息
 */
export function createUserMessage(content, conversationId = null) {
  return {
    id: `msg_${Date.now()}_user`,
    conversation_id: conversationId,
    role: MessageRole.USER,
    type: MessageType.USER,
    content,
    timestamp: Date.now(),
  };
}

/**
 * 创建助手消息
 */
export function createAssistantMessage(content, conversationId = null, metadata = {}) {
  return {
    id: `msg_${Date.now()}_assistant`,
    conversation_id: conversationId,
    role: MessageRole.ASSISTANT,
    type: MessageType.ASSISTANT,
    content,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * 创建系统消息
 */
export function createSystemMessage(content, metadata = {}) {
  return {
    id: `msg_${Date.now()}_system`,
    role: MessageRole.SYSTEM,
    type: MessageType.SYSTEM,
    content,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * 创建意图识别消息
 */
export function createIntentRecognitionMessage(intentResult) {
  return {
    id: `msg_${Date.now()}_intent`,
    role: MessageRole.SYSTEM,
    type: MessageType.INTENT_RECOGNITION,
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
export function createTaskAnalysisMessage(status = 'analyzing') {
  return {
    id: `msg_${Date.now()}_analysis`,
    role: MessageRole.SYSTEM,
    type: MessageType.TASK_ANALYSIS,
    content: '正在分析任务复杂度...',
    timestamp: Date.now(),
    metadata: {
      status, // analyzing, completed
    },
  };
}

/**
 * 创建采访问题消息
 */
export function createInterviewMessage(questions, currentIndex = 0) {
  return {
    id: `msg_${Date.now()}_interview`,
    role: MessageRole.ASSISTANT,
    type: MessageType.INTERVIEW,
    content: '为了更好地完成任务，我需要了解一些信息：',
    timestamp: Date.now(),
    metadata: {
      questions,        // 问题列表
      currentIndex,     // 当前问题索引
      answers: {},      // 用户答案
    },
  };
}

/**
 * 创建任务计划消息
 */
export function createTaskPlanMessage(plan) {
  return {
    id: `msg_${Date.now()}_plan`,
    role: MessageRole.ASSISTANT,
    type: MessageType.TASK_PLAN,
    content: '我已经为您制定了执行计划：',
    timestamp: Date.now(),
    metadata: {
      plan,            // 任务计划对象
      status: 'pending', // pending, confirmed, executing, completed
    },
  };
}

/**
 * 创建进度消息
 */
export function createProgressMessage(taskName, progress = 0) {
  return {
    id: `msg_${Date.now()}_progress`,
    role: MessageRole.SYSTEM,
    type: MessageType.PROGRESS,
    content: taskName,
    timestamp: Date.now(),
    metadata: {
      progress, // 0-100
    },
  };
}

/**
 * 创建错误消息
 */
export function createErrorMessage(error) {
  return {
    id: `msg_${Date.now()}_error`,
    role: MessageRole.SYSTEM,
    type: MessageType.ERROR,
    content: typeof error === 'string' ? error : error.message,
    timestamp: Date.now(),
    metadata: {
      error,
    },
  };
}
