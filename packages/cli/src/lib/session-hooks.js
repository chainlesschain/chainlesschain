/**
 * Session hooks - 会话级钩子触发工具
 *
 * 用于 agent-repl 的三件套会话级钩子：
 * - SessionStart
 * - UserPromptSubmit
 * - AssistantResponse
 * - SessionEnd
 * - Notification
 */

import { HookEvents, executeHooks } from "./hook-manager.js";

// 会话钩子白名单
export const SESSION_HOOK_EVENTS = Object.freeze([
  HookEvents.SessionStart,
  HookEvents.UserPromptSubmit,
  HookEvents.AssistantResponse,
  HookEvents.SessionEnd,
  HookEvents.Notification,
]);

// 依赖注入点（用于测试）
export const _deps = {
  executeHooks,
  logFailure: (_db, event, error) => {
    console.error(`[session-hooks] Failed to fire ${event}:`, error);
  },
};

/**
 * 通用会话钩子触发函数
 * @param {object} db - 数据库实例
 * @param {string} event - 钩子事件名
 * @param {object} [context={}] - 钩子上下文
 * @returns {Promise<Array>} 钩子执行结果数组
 */
export async function fireSessionHook(db, event, context = {}) {
  // 白名单验证
  if (!SESSION_HOOK_EVENTS.includes(event)) {
    throw new Error(`"${event}" is not a session hook event`);
  }

  // 如果没有数据库，空操作
  if (!db) {
    return [];
  }

  try {
    // 注入时间戳
    const ctxWithTimestamp = {
      timestamp: new Date().toISOString(),
      ...context,
    };

    // 执行钩子
    const results = await _deps.executeHooks(db, event, ctxWithTimestamp);
    return Array.isArray(results) ? results : [];
  } catch (error) {
    _deps.logFailure(db, event, error);
    return [];
  }
}

/**
 * 触发用户提交提示词钩子
 * @param {object} db - 数据库实例
 * @param {string} prompt - 用户提示词
 * @param {object} [context={}] - 上下文
 * @returns {Promise<{prompt: string, abort: boolean, reason?: string, results: Array}>}
 */
export async function fireUserPromptSubmit(db, prompt, context = {}) {
  const results = await fireSessionHook(db, HookEvents.UserPromptSubmit, {
    prompt,
    ...context,
  });

  let rewrittenPrompt = prompt;
  let abort = false;
  let abortReason;

  // 处理钩子返回的指令
  for (const result of results) {
    if (!result.success) continue;
    try {
      const output = result.stdout ? JSON.parse(result.stdout) : {};
      if (output.rewrittenPrompt) {
        rewrittenPrompt = output.rewrittenPrompt;
      }
      if (output.abort) {
        abort = true;
        abortReason = output.reason || "aborted by hook";
      }
    } catch {
      // 忽略解析错误
    }
  }

  return {
    prompt: rewrittenPrompt,
    abort,
    reason: abortReason,
    results,
  };
}

/**
 * 触发助手响应钩子（已存在，重写增强）
 * @param {object} db - 数据库实例
 * @param {string} response - 助手响应
 * @param {object} [context={}] - 上下文
 * @returns {Promise<{response: string, suppress: boolean, reason?: string, results: Array}>}
 */
export async function fireAssistantResponse(db, response, context = {}) {
  const results = await fireSessionHook(db, HookEvents.AssistantResponse, {
    response,
    ...context,
  });

  let rewrittenResponse = response;
  let suppress = false;
  let suppressReason;

  for (const result of results) {
    if (!result.success) continue;
    try {
      const output = result.stdout ? JSON.parse(result.stdout) : {};
      if (output.rewrittenResponse) {
        rewrittenResponse = output.rewrittenResponse;
      }
      if (output.suppress) {
        suppress = true;
        suppressReason = output.reason || "suppressed by hook";
      }
    } catch {
      // 忽略解析错误
    }
  }

  return {
    response: rewrittenResponse,
    suppress,
    reason: suppressReason,
    results,
  };
}

/**
 * 触发会话开始钩子
 * @param {object} db - 数据库实例
 * @param {object} [context={}] - 上下文
 * @returns {Promise<Array>}
 */
export async function fireSessionStart(db, context = {}) {
  return fireSessionHook(db, HookEvents.SessionStart, context);
}

/**
 * 触发会话结束钩子
 * @param {object} db - 数据库实例
 * @param {object} [context={}] - 上下文
 * @returns {Promise<Array>}
 */
export async function fireSessionEnd(db, context = {}) {
  return fireSessionHook(db, HookEvents.SessionEnd, context);
}

/**
 * 获取钩子数据库实例
 * @returns {null} 暂未实现
 */
export function getHookDb() {
  return null;
}

/**
 * 触发设置钩子
 * @param {object} db - 数据库实例
 * @param {object} context - 上下文
 * @returns {Promise<{abort: boolean}>}
 */
export async function fireSetup(db, context) {
  return { abort: false };
}
