/**
 * Hooks System Initializer
 *
 * 负责初始化 Hooks 系统并注册到 Bootstrap 流程
 *
 * @module bootstrap/hooks-initializer
 */

const { logger } = require('../utils/logger.js');
const path = require('path');

/**
 * 注册 Hooks 系统初始化器
 * @param {InitializerFactory} factory - 初始化器工厂
 */
function registerHooksInitializer(factory) {
  // =====================================================
  // Hooks 系统初始化器 (Phase 0 - 最先初始化)
  // =====================================================
  factory.register({
    name: 'hookSystem',
    required: false,
    dependsOn: [], // 无依赖

    async init(_context) {
      const { initializeHookSystem } = require('../hooks');

      // 获取配置路径
      const projectHooksConfig = path.join(process.cwd(), '.chainlesschain', 'hooks.json');
      const userHooksConfig = path.join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.chainlesschain',
        'hooks.json'
      );

      // 初始化 Hook System
      const hookSystem = await initializeHookSystem({
        configPaths: [projectHooksConfig, userHooksConfig].filter(Boolean),
        autoLoadConfig: true,
        defaultTimeout: 30000,
        continueOnError: true,
      });

      // 设置事件监听器用于日志
      hookSystem.on('hook-registered', ({ hook }) => {
        logger.debug(`[HookSystem] Hook registered: ${hook.name} (${hook.event})`);
      });

      hookSystem.on('hook-error', ({ hookName, eventName, error }) => {
        logger.warn(`[HookSystem] Hook error in ${hookName} for ${eventName}: ${error}`);
      });

      hookSystem.on('execution-complete', ({ eventName, executedHooks, totalTime }) => {
        if (executedHooks > 0 && totalTime > 100) {
          logger.debug(`[HookSystem] ${eventName}: ${executedHooks} hooks in ${totalTime}ms`);
        }
      });

      const stats = hookSystem.getStats();
      logger.info(`[HookSystem] Initialized with ${stats.hookCount} hooks (${stats.enabledCount} enabled)`);

      return hookSystem;
    },
  });
}

/**
 * 将 Hooks 系统绑定到其他管理器
 * 在所有管理器初始化完成后调用
 *
 * @param {Object} instances - 所有初始化的实例
 */
async function bindHooksToManagers(instances) {
  const { hookSystem, sessionManager, agentOrchestrator, functionCaller } = instances;

  if (!hookSystem) {
    logger.warn('[HookSystem] Hook system not initialized, skipping bindings');
    return;
  }

  // 绑定到 SessionManager
  if (sessionManager) {
    try {
      hookSystem.sessionMiddleware.bindToSessionManager(sessionManager);
      logger.info('[HookSystem] Bound to SessionManager');
    } catch (error) {
      logger.warn('[HookSystem] Failed to bind to SessionManager:', error.message);
    }
  }

  // 绑定到 AgentOrchestrator
  if (agentOrchestrator) {
    try {
      hookSystem.agentMiddleware.bindToOrchestrator(agentOrchestrator);
      logger.info('[HookSystem] Bound to AgentOrchestrator');
    } catch (error) {
      logger.warn('[HookSystem] Failed to bind to AgentOrchestrator:', error.message);
    }
  }

  // 设置 FunctionCaller 的 hooks
  if (functionCaller && typeof functionCaller.setHookSystem === 'function') {
    try {
      functionCaller.setHookSystem(hookSystem);
      logger.info('[HookSystem] Bound to FunctionCaller');
    } catch (error) {
      logger.warn('[HookSystem] Failed to bind to FunctionCaller:', error.message);
    }
  }

  logger.info('[HookSystem] All bindings completed');
}

module.exports = {
  registerHooksInitializer,
  bindHooksToManagers,
};
