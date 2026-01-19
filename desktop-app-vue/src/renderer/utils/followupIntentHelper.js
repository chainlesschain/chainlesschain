import { logger, createLogger } from '@/utils/logger';

/**
 * 后续输入意图处理助手
 * 简化的工具函数，用于在 ChatPanel.vue 中集成后续输入意图分类
 */

/**
 * 检查是否有正在执行的任务
 * @param {Array} messages - 消息数组
 * @returns {Object|null} 正在执行的任务计划消息
 */
export function findExecutingTask(messages) {
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
 * @param {Object} taskMessage - 任务计划消息
 * @param {Array} messages - 完整消息列表
 * @returns {Object} 上下文对象
 */
export function buildClassificationContext(taskMessage, messages = []) {
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
 * 根据意图生成系统消息
 * @param {string} intent - 意图类型
 * @param {string} userInput - 用户输入
 * @param {Object} options - 额外选项
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
 * @param {string} originalRequirement - 原始需求
 * @param {string} newRequirement - 新需求
 * @returns {string} 合并后的需求
 */
export function mergeRequirements(originalRequirement, newRequirement) {
  return `${originalRequirement}

【追加需求】
${newRequirement}

【说明】
请在保持原有需求的基础上，整合上述追加需求，生成新的任务计划。`;
}

/**
 * 更新任务计划的补充信息
 * @param {Object} taskPlan - 任务计划对象
 * @param {string} clarification - 补充说明
 * @returns {Object} 更新后的任务计划
 */
export function addClarificationToTaskPlan(taskPlan, clarification) {
  if (!taskPlan) {
    return null;
  }

  const updatedPlan = { ...taskPlan };

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
 * 获取意图的中文描述
 * @param {string} intent - 意图类型
 * @returns {string} 中文描述
 */
export function getIntentDescription(intent) {
  const descriptions = {
    CONTINUE_EXECUTION: '继续执行',
    MODIFY_REQUIREMENT: '修改需求',
    CLARIFICATION: '补充说明',
    CANCEL_TASK: '取消任务'
  };

  return descriptions[intent] || '未知意图';
}

/**
 * 判断是否需要用户确认
 * @param {Object} classifyResult - 分类结果
 * @param {number} threshold - 置信度阈值（默认 0.6）
 * @returns {boolean} 是否需要确认
 */
export function needsUserConfirmation(classifyResult, threshold = 0.6) {
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
 * @param {Object} classifyResult - 分类结果
 * @param {string} userInput - 用户输入
 * @returns {Object} 对话框配置
 */
export function createConfirmationDialogConfig(classifyResult, userInput) {
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
 * @param {Error} error - 错误对象
 * @param {string} userInput - 用户输入
 * @returns {Object} 降级结果
 */
export function handleClassificationError(error, userInput) {
  logger.error('[FollowupIntent] 分类失败:', error);

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
 * @param {Object} classifyResult - 分类结果
 * @param {string} userInput - 用户输入
 * @returns {string} 格式化的日志字符串
 */
export function formatIntentLog(classifyResult, userInput) {
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
 * @param {Array} testInputs - 测试输入数组
 * @returns {Promise<Array>} 测试结果数组
 */
export async function batchTestIntents(testInputs) {
  if (!window.electronAPI?.followupIntent) {
    logger.error('[FollowupIntent] API 不可用');
    return [];
  }

  const results = [];

  for (const input of testInputs) {
    try {
      const result = await window.electronAPI.followupIntent.classify({
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
        error: error.message
      });
    }
  }

  return results;
}

/**
 * 调试模式：在控制台测试意图分类
 * 使用方法: 在浏览器控制台运行 window.testFollowupIntent('继续')
 */
if (typeof window !== 'undefined') {
  window.testFollowupIntent = async (input) => {
    try {
      const result = await window.electronAPI.followupIntent.classify({
        input,
        context: {}
      });

      logger.info('=== 意图分类结果 ===');
      logger.info('输入:', input);
      logger.info('意图:', getIntentDescription(result.data.intent), `(${result.data.intent})`);
      logger.info('置信度:', (result.data.confidence * 100).toFixed(1) + '%');
      logger.info('方法:', result.data.method);
      logger.info('理由:', result.data.reason);
      logger.info('耗时:', result.data.latency + 'ms');

      return result.data;
    } catch (error) {
      logger.error('测试失败:', error);
      return null;
    }
  };

  // 批量测试
  window.batchTestFollowupIntent = async () => {
    const testCases = [
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
