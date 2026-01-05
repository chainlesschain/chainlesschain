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
  INTENT_CONFIRMATION: 'intent-confirmation', // 意图确认（需要用户确认理解是否正确）
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
 * 创建后续输入意图系统消息
 * @param {string} intent - 意图类型 (CONTINUE_EXECUTION, MODIFY_REQUIREMENT, CLARIFICATION, CANCEL_TASK)
 * @param {string} userInput - 用户输入
 * @param {Object} options - 额外选项
 * @param {string} options.reason - 判断理由
 * @param {string} options.extractedInfo - 提取的关键信息
 * @returns {Object} 系统消息对象
 */
export function createIntentSystemMessage(intent, userInput, options = {}) {
  const { reason, extractedInfo } = options;

  const messages = {
    CONTINUE_EXECUTION: {
      content: '✅ 收到，继续执行任务...',
      icon: '✅'
    },
    MODIFY_REQUIREMENT: {
      content: `⚠️ 检测到需求变更: ${extractedInfo || userInput}\n正在重新规划任务...`,
      icon: '⚠️'
    },
    CLARIFICATION: {
      content: `📝 已记录补充信息: ${extractedInfo || userInput}\n继续执行任务...`,
      icon: '📝'
    },
    CANCEL_TASK: {
      content: `❌ 任务已取消`,
      icon: '❌'
    }
  };

  const messageConfig = messages[intent] || {
    content: '⚠️ 未知意图，请重新表述',
    icon: '⚠️'
  };

  return {
    id: `msg_${Date.now()}_system`,
    role: MessageRole.SYSTEM,
    type: MessageType.SYSTEM,
    content: messageConfig.content,
    timestamp: Date.now(),
    metadata: {
      intent,
      reason,
      userInput,
      extractedInfo
    }
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

/**
 * 创建意图确认消息
 * @param {string} originalInput - 用户原始输入
 * @param {Object} understanding - AI理解结果
 * @param {string} understanding.correctedInput - 纠错后的输入
 * @param {string} understanding.intent - 理解的意图
 * @param {Array} understanding.keyPoints - 关键要点
 */
export function createIntentConfirmationMessage(originalInput, understanding) {
  return {
    id: `msg_${Date.now()}_intent_confirmation`,
    role: MessageRole.ASSISTANT,
    type: MessageType.INTENT_CONFIRMATION,
    content: '我理解您的需求如下，请确认：',
    timestamp: Date.now(),
    metadata: {
      originalInput,       // 用户原始输入
      understanding,       // AI理解结果
      status: 'pending',   // pending, confirmed, corrected
      correction: null,    // 用户的纠正内容（如果有）
    },
  };
}
