/**
 * Hooks Integration Helper
 *
 * 提供便捷的方法将 Hooks 系统集成到现有模块
 *
 * @module hooks/hooks-integration
 */

const { getHookSystem } = require('./index');
const { logger } = require('../utils/logger.js');

/**
 * 集成 Hooks 到 IPC 处理器
 *
 * @param {Object} ipcMain - Electron ipcMain
 * @returns {Object} 包装后的 ipcMain handle 方法
 *
 * @example
 * const { integrateWithIPC } = require('./hooks/hooks-integration');
 * const wrappedHandle = integrateWithIPC(ipcMain);
 *
 * // 使用包装后的 handle
 * wrappedHandle('my-channel', async (event, data) => {
 *   // PreIPCCall 和 PostIPCCall 钩子会自动触发
 *   return { success: true };
 * });
 */
function integrateWithIPC(ipcMain) {
  const hookSystem = getHookSystem();

  if (!hookSystem || !hookSystem.initialized) {
    logger.warn('[HooksIntegration] HookSystem not initialized, returning original ipcMain');
    return ipcMain.handle.bind(ipcMain);
  }

  return hookSystem.ipcMiddleware.createWrappedHandle(ipcMain);
}

/**
 * 创建带钩子的工具注册函数
 *
 * @param {FunctionCaller} functionCaller - FunctionCaller 实例
 * @returns {Function} 包装后的 registerTool 方法
 *
 * @example
 * const { createHookedToolRegister } = require('./hooks/hooks-integration');
 * const registerTool = createHookedToolRegister(functionCaller);
 *
 * registerTool('my_tool', async (params) => {
 *   // PreToolUse 和 PostToolUse 钩子会自动触发
 *   return { success: true };
 * }, schema);
 */
function createHookedToolRegister(functionCaller) {
  const hookSystem = getHookSystem();

  if (!hookSystem || !hookSystem.initialized) {
    logger.warn('[HooksIntegration] HookSystem not initialized, returning original registerTool');
    return functionCaller.registerTool.bind(functionCaller);
  }

  const middleware = hookSystem.toolMiddleware;

  return function hookedRegisterTool(name, handler, schema) {
    const wrappedHandler = middleware.wrap(name, handler);
    return functionCaller.registerTool(name, wrappedHandler, schema);
  };
}

/**
 * 触发自定义钩子事件
 *
 * @param {string} eventName - 事件名称
 * @param {Object} data - 事件数据
 * @param {Object} context - 执行上下文
 * @returns {Promise<Object>} 执行结果
 *
 * @example
 * const { triggerHook } = require('./hooks/hooks-integration');
 *
 * // 触发工具使用前钩子
 * const result = await triggerHook('PreToolUse', {
 *   toolName: 'my_tool',
 *   params: { file: 'test.txt' }
 * });
 *
 * if (result.prevented) {
 *   console.log('Tool use was prevented:', result.preventReason);
 * }
 */
async function triggerHook(eventName, data = {}, context = {}) {
  const hookSystem = getHookSystem();

  if (!hookSystem || !hookSystem.initialized) {
    return { result: 'continue', data };
  }

  return hookSystem.trigger(eventName, data, context);
}

/**
 * 注册自定义钩子
 *
 * @param {Object} hookConfig - 钩子配置
 * @returns {string} 钩子 ID
 *
 * @example
 * const { registerHook } = require('./hooks/hooks-integration');
 *
 * const hookId = registerHook({
 *   event: 'PreToolUse',
 *   name: 'my-custom-validator',
 *   priority: 100,
 *   handler: async ({ data }) => {
 *     if (data.toolName === 'dangerous_tool') {
 *       return { prevent: true, reason: 'Tool is blocked' };
 *     }
 *     return { result: 'continue' };
 *   }
 * });
 */
function registerHook(hookConfig) {
  const hookSystem = getHookSystem();

  if (!hookSystem) {
    throw new Error('HookSystem not initialized');
  }

  return hookSystem.register(hookConfig);
}

/**
 * 批量注册钩子
 *
 * @param {Array<Object>} hookConfigs - 钩子配置数组
 * @returns {Array<string>} 钩子 ID 数组
 */
function registerHooks(hookConfigs) {
  const hookSystem = getHookSystem();

  if (!hookSystem) {
    throw new Error('HookSystem not initialized');
  }

  return hookSystem.registerMultiple(hookConfigs);
}

/**
 * 检查 HookSystem 是否可用
 *
 * @returns {boolean}
 */
function isHooksAvailable() {
  const hookSystem = getHookSystem();
  return hookSystem && hookSystem.initialized && hookSystem.isEnabled();
}

/**
 * 获取钩子统计信息
 *
 * @returns {Object|null}
 */
function getHooksStats() {
  const hookSystem = getHookSystem();

  if (!hookSystem) {
    return null;
  }

  return hookSystem.getStats();
}

/**
 * 创建条件钩子
 * 只在满足条件时执行的钩子
 *
 * @param {Object} config - 钩子配置
 * @param {Function} condition - 条件函数 (data, context) => boolean
 * @returns {string} 钩子 ID
 *
 * @example
 * createConditionalHook({
 *   event: 'PreToolUse',
 *   name: 'conditional-validator',
 *   handler: async ({ data }) => {
 *     // 只在条件满足时执行
 *     return { result: 'continue' };
 *   }
 * }, ({ data }) => data.toolName.startsWith('file_'));
 */
function createConditionalHook(config, condition) {
  const originalHandler = config.handler;

  const wrappedHandler = async (params) => {
    if (!condition(params.data, params.context)) {
      return { result: 'continue' };
    }
    return originalHandler(params);
  };

  return registerHook({
    ...config,
    handler: wrappedHandler,
  });
}

/**
 * 创建日志钩子
 * 简单的日志记录钩子
 *
 * @param {string} eventName - 事件名称
 * @param {string} logPrefix - 日志前缀
 * @returns {string} 钩子 ID
 */
function createLoggingHook(eventName, logPrefix = '[Hook]') {
  return registerHook({
    event: eventName,
    name: `logging-${eventName.toLowerCase()}`,
    type: 'async',
    priority: 900, // 低优先级，在其他钩子后执行
    handler: async ({ event, data }) => {
      console.log(`${logPrefix} ${event.name}:`, JSON.stringify(data, null, 2).substring(0, 200));
      return { result: 'continue' };
    },
  });
}

/**
 * 创建验证钩子
 * 用于参数验证的钩子
 *
 * @param {string} eventName - 事件名称
 * @param {Function} validator - 验证函数 (data) => { valid: boolean, reason?: string }
 * @returns {string} 钩子 ID
 */
function createValidationHook(eventName, validator, name = 'validation-hook') {
  return registerHook({
    event: eventName,
    name,
    type: 'async',
    priority: 100, // 高优先级，在其他钩子前执行
    handler: async ({ data }) => {
      const result = await validator(data);

      if (!result.valid) {
        return {
          result: 'prevent',
          reason: result.reason || 'Validation failed',
        };
      }

      return { result: 'continue' };
    },
  });
}

module.exports = {
  // 集成方法
  integrateWithIPC,
  createHookedToolRegister,

  // 钩子操作
  triggerHook,
  registerHook,
  registerHooks,

  // 工具方法
  isHooksAvailable,
  getHooksStats,

  // 钩子工厂
  createConditionalHook,
  createLoggingHook,
  createValidationHook,
};
