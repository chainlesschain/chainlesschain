/**
 * Hooks System - 钩子系统主入口
 *
 * 提供可扩展的钩子机制，支持在关键操作前后执行自定义逻辑
 *
 * @module hooks
 *
 * @example
 * // 初始化钩子系统
 * const { initializeHookSystem } = require('./hooks');
 * const hookSystem = await initializeHookSystem();
 *
 * // 注册钩子
 * hookSystem.register({
 *   event: 'PreToolUse',
 *   name: 'my-validator',
 *   handler: async ({ data }) => {
 *     if (data.toolName === 'dangerous_tool') {
 *       return { prevent: true, reason: 'Tool is blocked' };
 *     }
 *     return { result: 'continue' };
 *   }
 * });
 *
 * // 触发钩子
 * const result = await hookSystem.trigger('PreToolUse', { toolName: 'file_reader' });
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;
const { HookRegistry, HookPriority, HookType, HookEvents } = require('./hook-registry');
const { HookExecutor, HookResult } = require('./hook-executor');
const {
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
  createFileHookMiddleware,
  createAgentHookMiddleware,
} = require('./hook-middleware');

/**
 * Hooks 系统主类
 */
class HookSystem extends EventEmitter {
  /**
   * @param {Object} options 配置选项
   * @param {string[]} [options.configPaths] 额外的配置文件路径
   * @param {boolean} [options.autoLoadConfig=true] 是否自动加载配置
   * @param {number} [options.defaultTimeout=30000] 默认超时时间
   * @param {boolean} [options.continueOnError=true] 钩子出错是否继续
   */
  constructor(options = {}) {
    super();

    this.options = {
      configPaths: options.configPaths || [],
      autoLoadConfig: options.autoLoadConfig !== false,
      defaultTimeout: options.defaultTimeout || 30000,
      continueOnError: options.continueOnError !== false,
      ...options,
    };

    // 核心组件
    this.registry = new HookRegistry(options);
    this.executor = new HookExecutor(this.registry, options);

    // 中间件
    this.ipcMiddleware = createIPCHookMiddleware(this);
    this.toolMiddleware = createToolHookMiddleware(this);
    this.sessionMiddleware = createSessionHookMiddleware(this);
    this.fileMiddleware = createFileHookMiddleware(this);
    this.agentMiddleware = createAgentHookMiddleware(this);

    // 初始化状态
    this.initialized = false;

    // 事件转发
    this._setupEventForwarding();
  }

  /**
   * 初始化钩子系统
   * @returns {Promise<HookSystem>}
   */
  async initialize() {
    if (this.initialized) {
      return this;
    }

    if (this.options.autoLoadConfig) {
      await this.loadDefaultConfigs();
    }

    // 注册内置钩子
    this._registerBuiltinHooks();

    this.initialized = true;
    this.emit('initialized');

    return this;
  }

  /**
   * 加载默认配置文件
   */
  async loadDefaultConfigs() {
    const configPaths = [
      // 项目级配置
      path.join(process.cwd(), '.chainlesschain', 'hooks.json'),
      // 用户级配置 (跨平台)
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.chainlesschain', 'hooks.json'),
      // 自定义配置路径
      ...this.options.configPaths,
    ];

    for (const configPath of configPaths) {
      if (!configPath) continue;
      try {
        await fs.access(configPath);
        await this.registry.loadFromConfig(configPath);
        console.log(`[HookSystem] Loaded hooks from: ${configPath}`);
      } catch {
        // 配置文件不存在，跳过
      }
    }

    // 加载脚本钩子目录
    const scriptDirs = [
      path.join(process.cwd(), '.chainlesschain', 'hooks'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.chainlesschain', 'hooks'),
    ];

    for (const scriptDir of scriptDirs) {
      if (!scriptDir) continue;
      await this._loadScriptHooks(scriptDir);
    }
  }

  /**
   * 加载脚本钩子
   * @private
   */
  async _loadScriptHooks(dirPath) {
    try {
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        if (!file.endsWith('.js')) continue;

        const scriptPath = path.join(dirPath, file);
        try {
          // 清除缓存以支持热重载
          delete require.cache[require.resolve(scriptPath)];
          const hookModule = require(scriptPath);

          if (hookModule.hooks && Array.isArray(hookModule.hooks)) {
            this.registry.registerMultiple(hookModule.hooks);
            console.log(`[HookSystem] Loaded ${hookModule.hooks.length} hooks from: ${scriptPath}`);
          }
        } catch (error) {
          console.error(`[HookSystem] Failed to load script: ${scriptPath}`, error.message);
        }
      }
    } catch {
      // 目录不存在，跳过
    }
  }

  /**
   * 注册内置钩子
   * @private
   */
  _registerBuiltinHooks() {
    // 性能监控钩子 - 记录慢速 IPC 调用
    this.registry.register({
      event: 'PostIPCCall',
      name: 'builtin:slow-ipc-logger',
      type: HookType.ASYNC,
      priority: HookPriority.MONITOR,
      description: 'Log slow IPC calls (>1000ms)',
      handler: async ({ data }) => {
        if (data.executionTime > 1000) {
          console.warn(`[HookSystem] Slow IPC: ${data.channel} took ${data.executionTime}ms`);
        }
        return { result: HookResult.CONTINUE };
      },
    });

    // 工具使用监控钩子
    this.registry.register({
      event: 'PostToolUse',
      name: 'builtin:tool-usage-logger',
      type: HookType.ASYNC,
      priority: HookPriority.MONITOR,
      description: 'Log tool usage statistics',
      handler: async ({ data }) => {
        if (data.executionTime > 5000) {
          console.warn(`[HookSystem] Slow tool: ${data.toolName} took ${data.executionTime}ms`);
        }
        return { result: HookResult.CONTINUE };
      },
    });
  }

  /**
   * 设置事件转发
   * @private
   */
  _setupEventForwarding() {
    // Registry 事件
    this.registry.on('hook-registered', (data) => this.emit('hook-registered', data));
    this.registry.on('hook-unregistered', (data) => this.emit('hook-unregistered', data));
    this.registry.on('hook-status-changed', (data) => this.emit('hook-status-changed', data));
    this.registry.on('config-loaded', (data) => this.emit('config-loaded', data));
    this.registry.on('config-error', (data) => this.emit('config-error', data));

    // Executor 事件
    this.executor.on('execution-start', (data) => this.emit('execution-start', data));
    this.executor.on('execution-complete', (data) => this.emit('execution-complete', data));
    this.executor.on('hook-error', (data) => this.emit('hook-error', data));
  }

  // ==================== 公共 API ====================

  /**
   * 注册钩子
   * @param {Object} hookConfig 钩子配置
   * @returns {string} 钩子ID
   */
  register(hookConfig) {
    return this.registry.register(hookConfig);
  }

  /**
   * 批量注册钩子
   * @param {Array<Object>} hookConfigs 钩子配置数组
   * @returns {Array<string>} 钩子ID数组
   */
  registerMultiple(hookConfigs) {
    return this.registry.registerMultiple(hookConfigs);
  }

  /**
   * 注销钩子
   * @param {string} hookId 钩子ID
   * @returns {boolean} 是否成功
   */
  unregister(hookId) {
    return this.registry.unregister(hookId);
  }

  /**
   * 触发钩子事件
   * @param {string} eventName 事件名称
   * @param {Object} data 事件数据
   * @param {Object} context 执行上下文
   * @returns {Promise<Object>} 执行结果
   */
  async trigger(eventName, data = {}, context = {}) {
    return this.executor.trigger(eventName, data, context);
  }

  /**
   * 获取钩子列表
   * @param {Object} options 选项
   * @returns {Array} 钩子信息数组
   */
  listHooks(options) {
    return this.registry.listHooks(options);
  }

  /**
   * 获取单个钩子信息
   * @param {string} hookId 钩子ID
   * @returns {Object|null} 钩子信息
   */
  getHook(hookId) {
    return this.registry.getHook(hookId);
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return this.registry.getStats();
  }

  /**
   * 启用/禁用全局钩子
   * @param {boolean} enabled 是否启用
   */
  setEnabled(enabled) {
    this.registry.enabled = enabled;
    this.emit('global-status-changed', { enabled });
  }

  /**
   * 检查是否启用
   * @returns {boolean}
   */
  isEnabled() {
    return this.registry.enabled;
  }

  /**
   * 启用/禁用单个钩子
   * @param {string} hookId 钩子ID
   * @param {boolean} enabled 是否启用
   * @returns {boolean} 是否成功
   */
  setHookEnabled(hookId, enabled) {
    return this.registry.setEnabled(hookId, enabled);
  }

  /**
   * 取消正在运行的钩子
   * @param {string} hookId 钩子ID
   * @returns {boolean} 是否成功
   */
  cancelHook(hookId) {
    return this.executor.cancelHook(hookId);
  }

  /**
   * 取消所有正在运行的钩子
   */
  cancelAll() {
    this.executor.cancelAll();
  }

  /**
   * 清除所有钩子
   */
  clear() {
    this.registry.clear();
  }

  /**
   * 重新加载配置
   */
  async reload() {
    this.registry.clear();
    await this.loadDefaultConfigs();
    this._registerBuiltinHooks();
    this.emit('reloaded');
  }

  /**
   * 获取所有支持的事件类型
   * @returns {string[]}
   */
  getEventTypes() {
    return [...HookEvents];
  }
}

// ==================== 单例管理 ====================

/** @type {HookSystem|null} */
let hookSystemInstance = null;

/**
 * 获取钩子系统实例 (懒加载)
 * @param {Object} options 配置选项
 * @returns {HookSystem}
 */
function getHookSystem(options) {
  if (!hookSystemInstance) {
    hookSystemInstance = new HookSystem(options);
  }
  return hookSystemInstance;
}

/**
 * 初始化钩子系统
 * @param {Object} options 配置选项
 * @returns {Promise<HookSystem>}
 */
async function initializeHookSystem(options) {
  hookSystemInstance = new HookSystem(options);
  return hookSystemInstance.initialize();
}

/**
 * 销毁钩子系统实例
 */
function destroyHookSystem() {
  if (hookSystemInstance) {
    hookSystemInstance.cancelAll();
    hookSystemInstance.clear();
    hookSystemInstance.removeAllListeners();
    hookSystemInstance = null;
  }
}

// ==================== 导出 ====================

module.exports = {
  // 主类
  HookSystem,
  HookRegistry,
  HookExecutor,

  // 常量
  HookPriority,
  HookType,
  HookResult,
  HookEvents,

  // 单例函数
  getHookSystem,
  initializeHookSystem,
  destroyHookSystem,

  // 中间件工厂
  createIPCHookMiddleware,
  createToolHookMiddleware,
  createSessionHookMiddleware,
  createFileHookMiddleware,
  createAgentHookMiddleware,

  // 集成工具 (懒加载以避免循环依赖)
  get integrateWithIPC() {
    return require('./hooks-integration').integrateWithIPC;
  },
  get createHookedToolRegister() {
    return require('./hooks-integration').createHookedToolRegister;
  },
  get triggerHook() {
    return require('./hooks-integration').triggerHook;
  },
  get registerHook() {
    return require('./hooks-integration').registerHook;
  },
  get registerHooks() {
    return require('./hooks-integration').registerHooks;
  },
  get isHooksAvailable() {
    return require('./hooks-integration').isHooksAvailable;
  },
  get getHooksStats() {
    return require('./hooks-integration').getHooksStats;
  },
  get createConditionalHook() {
    return require('./hooks-integration').createConditionalHook;
  },
  get createLoggingHook() {
    return require('./hooks-integration').createLoggingHook;
  },
  get createValidationHook() {
    return require('./hooks-integration').createValidationHook;
  },
};
