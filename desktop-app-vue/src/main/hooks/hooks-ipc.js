/**
 * Hooks IPC - 钩子系统 IPC 接口
 *
 * 提供渲染进程访问钩子系统的 IPC 通道
 *
 * @module hooks/hooks-ipc
 */

const { ipcMain } = require('electron');
const { getHookSystem, HookType } = require('./index');

/**
 * 注册钩子系统 IPC 处理器
 * @param {Object} dependencies 依赖注入
 * @param {HookSystem} [dependencies.hookSystem] 钩子系统实例
 */
function registerHooksIPC(dependencies = {}) {
  const hookSystem = dependencies.hookSystem || getHookSystem();

  /**
   * 获取钩子列表
   * @channel hooks:list
   * @param {Object} options 选项
   * @param {string} [options.event] 按事件过滤
   * @param {boolean} [options.enabledOnly] 仅返回启用的
   * @returns {Array} 钩子列表
   */
  ipcMain.handle('hooks:list', async (event, options = {}) => {
    return hookSystem.listHooks(options);
  });

  /**
   * 获取单个钩子信息
   * @channel hooks:get
   * @param {string} hookId 钩子ID
   * @returns {Object|null} 钩子信息
   */
  ipcMain.handle('hooks:get', async (event, hookId) => {
    return hookSystem.getHook(hookId);
  });

  /**
   * 获取统计信息
   * @channel hooks:stats
   * @returns {Object} 统计信息
   */
  ipcMain.handle('hooks:stats', async () => {
    return hookSystem.getStats();
  });

  /**
   * 获取所有支持的事件类型
   * @channel hooks:event-types
   * @returns {string[]} 事件类型列表
   */
  ipcMain.handle('hooks:event-types', async () => {
    return hookSystem.getEventTypes();
  });

  /**
   * 启用/禁用单个钩子
   * @channel hooks:set-enabled
   * @param {Object} params
   * @param {string} params.hookId 钩子ID
   * @param {boolean} params.enabled 是否启用
   * @returns {boolean} 是否成功
   */
  ipcMain.handle('hooks:set-enabled', async (event, { hookId, enabled }) => {
    return hookSystem.setHookEnabled(hookId, enabled);
  });

  /**
   * 启用/禁用全局钩子
   * @channel hooks:set-global-enabled
   * @param {boolean} enabled 是否启用
   */
  ipcMain.handle('hooks:set-global-enabled', async (event, enabled) => {
    hookSystem.setEnabled(enabled);
    return hookSystem.isEnabled();
  });

  /**
   * 检查全局是否启用
   * @channel hooks:is-enabled
   * @returns {boolean}
   */
  ipcMain.handle('hooks:is-enabled', async () => {
    return hookSystem.isEnabled();
  });

  /**
   * 注册新钩子 (仅允许命令和脚本类型)
   * @channel hooks:register
   * @param {Object} hookConfig 钩子配置
   * @returns {string} 钩子ID
   */
  ipcMain.handle('hooks:register', async (event, hookConfig) => {
    // 安全检查: 只允许注册命令和脚本类型钩子
    if (hookConfig.type !== HookType.COMMAND && hookConfig.type !== HookType.SCRIPT) {
      throw new Error('Only command and script hooks can be registered via IPC for security reasons');
    }

    // 验证必需字段
    if (!hookConfig.event) {
      throw new Error('Hook event is required');
    }

    if (hookConfig.type === HookType.COMMAND && !hookConfig.command) {
      throw new Error('Command is required for command hooks');
    }

    if (hookConfig.type === HookType.SCRIPT && !hookConfig.script) {
      throw new Error('Script path is required for script hooks');
    }

    return hookSystem.register(hookConfig);
  });

  /**
   * 注销钩子
   * @channel hooks:unregister
   * @param {string} hookId 钩子ID
   * @returns {boolean} 是否成功
   */
  ipcMain.handle('hooks:unregister', async (event, hookId) => {
    return hookSystem.unregister(hookId);
  });

  /**
   * 手动触发钩子事件 (调试用)
   * @channel hooks:trigger
   * @param {Object} params
   * @param {string} params.eventName 事件名称
   * @param {Object} params.data 事件数据
   * @param {Object} params.context 执行上下文
   * @returns {Object} 执行结果
   */
  ipcMain.handle('hooks:trigger', async (event, { eventName, data = {}, context = {} }) => {
    // 添加安全上下文标记
    const safeContext = {
      ...context,
      triggeredViaIPC: true,
      timestamp: Date.now(),
    };

    return hookSystem.trigger(eventName, data, safeContext);
  });

  /**
   * 重新加载钩子配置
   * @channel hooks:reload
   */
  ipcMain.handle('hooks:reload', async () => {
    await hookSystem.reload();
    return { success: true, hookCount: hookSystem.listHooks().length };
  });

  /**
   * 取消正在运行的钩子
   * @channel hooks:cancel
   * @param {string} hookId 钩子ID
   * @returns {boolean} 是否成功
   */
  ipcMain.handle('hooks:cancel', async (event, hookId) => {
    return hookSystem.cancelHook(hookId);
  });

  /**
   * 取消所有正在运行的钩子
   * @channel hooks:cancel-all
   */
  ipcMain.handle('hooks:cancel-all', async () => {
    hookSystem.cancelAll();
    return { success: true };
  });

  // 设置事件转发到渲染进程
  setupEventForwarding(hookSystem);

  console.log('[HooksIPC] Registered all hooks IPC handlers');
}

/**
 * 设置事件转发
 * @param {HookSystem} hookSystem
 */
function setupEventForwarding(hookSystem) {
  const { BrowserWindow } = require('electron');

  const forwardEvent = (eventName, data) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(`hooks:${eventName}`, data);
      }
    });
  };

  // 转发关键事件
  hookSystem.on('hook-registered', (data) => forwardEvent('registered', data));
  hookSystem.on('hook-unregistered', (data) => forwardEvent('unregistered', data));
  hookSystem.on('hook-status-changed', (data) => forwardEvent('status-changed', data));
  hookSystem.on('execution-start', (data) => forwardEvent('execution-start', data));
  hookSystem.on('execution-complete', (data) => forwardEvent('execution-complete', data));
  hookSystem.on('hook-error', (data) => forwardEvent('error', data));
}

module.exports = {
  registerHooksIPC,
};
