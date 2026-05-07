/**
 * web-panel Chat message types — port of desktop V5 messageTypes.ts (subset).
 * Only the enums + factories the web-shell currently consumes; extend when
 * additional V5 message kinds (TASK_PLAN / INTERVIEW / PROGRESS) get ported.
 */

let _seq = 0
function nextId(suffix) {
  _seq += 1
  return `msg_${Date.now()}_${_seq}_${suffix}`
}

export const MessageType = Object.freeze({
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
})

export const MessageRole = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
})

export const FollowupIntent = Object.freeze({
  CONTINUE_EXECUTION: 'CONTINUE_EXECUTION',
  MODIFY_REQUIREMENT: 'MODIFY_REQUIREMENT',
  CLARIFICATION: 'CLARIFICATION',
  CANCEL_TASK: 'CANCEL_TASK',
})

export function createSystemMessage(content, metadata = {}) {
  return {
    id: nextId('system'),
    role: MessageRole.SYSTEM,
    type: MessageType.SYSTEM,
    content,
    timestamp: Date.now(),
    metadata,
  }
}

export function createIntentConfirmationMessage(originalInput, understanding) {
  return {
    id: nextId('intent_confirmation'),
    role: MessageRole.ASSISTANT,
    type: MessageType.INTENT_CONFIRMATION,
    content: '我理解您的需求如下，请确认：',
    timestamp: Date.now(),
    metadata: {
      originalInput,
      understanding: understanding || {},
      status: 'pending',
      correction: null,
    },
  }
}

/**
 * Build a follow-up intent feedback system message (mirrors V5's
 * createIntentSystemMessage). `extractedInfo` is shown when the classifier
 * pulls a substantive payload out of the user input.
 */
export function createIntentSystemMessage(intent, userInput, options = {}) {
  const { reason, extractedInfo } = options
  const presets = {
    CONTINUE_EXECUTION: '✅ 收到，继续执行任务...',
    MODIFY_REQUIREMENT: `⚠️ 检测到需求变更：${extractedInfo || userInput}`,
    CLARIFICATION: `📝 已记录补充信息：${extractedInfo || userInput}`,
    CANCEL_TASK: '❌ 任务已取消',
  }
  return {
    id: nextId('intent_system'),
    role: MessageRole.SYSTEM,
    type: MessageType.SYSTEM,
    content: presets[intent] || '⚠️ 未识别意图',
    timestamp: Date.now(),
    metadata: { intent, reason, userInput, extractedInfo },
  }
}
