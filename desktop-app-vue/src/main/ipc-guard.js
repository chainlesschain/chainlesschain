/**
 * IPC Handler 注册保护机制
 * 防止重复注册和提供统一的注册管理
 *
 * @module ipc-guard
 * @description 提供全局的IPC handler注册状态管理，防止重复注册导致的问题
 */

const { ipcMain } = require('electron');

/**
 * 全局注册状态跟踪
 * key: channel名称
 * value: { module: string, timestamp: number }
 */
const registeredChannels = new Map();

/**
 * 模块注册状态跟踪
 * key: 模块名称
 * value: boolean (是否已注册)
 */
const registeredModules = new Set();

/**
 * 检查channel是否已注册
 * @param {string} channel - IPC channel名称
 * @returns {boolean} 是否已注册
 */
function isChannelRegistered(channel) {
  return registeredChannels.has(channel);
}

/**
 * 检查模块是否已注册
 * @param {string} moduleName - 模块名称
 * @returns {boolean} 是否已注册
 */
function isModuleRegistered(moduleName) {
  return registeredModules.has(moduleName);
}

/**
 * 标记channel为已注册
 * @param {string} channel - IPC channel名称
 * @param {string} moduleName - 模块名称
 */
function markChannelRegistered(channel, moduleName) {
  registeredChannels.set(channel, {
    module: moduleName,
    timestamp: Date.now()
  });
}

/**
 * 标记模块为已注册
 * @param {string} moduleName - 模块名称
 */
function markModuleRegistered(moduleName) {
  registeredModules.add(moduleName);
}

/**
 * 安全注册IPC handler（自动防重复）
 * @param {string} channel - IPC channel名称
 * @param {Function} handler - handler函数
 * @param {string} moduleName - 模块名称（用于日志）
 * @returns {boolean} 是否成功注册（false表示已存在，跳过注册）
 */
function safeRegisterHandler(channel, handler, moduleName = 'unknown') {
  if (isChannelRegistered(channel)) {
    const existing = registeredChannels.get(channel);
    console.log(`[IPC Guard] Channel "${channel}" already registered by ${existing.module}, skipping...`);
    return false;
  }

  try {
    ipcMain.handle(channel, handler);
    markChannelRegistered(channel, moduleName);
    return true;
  } catch (error) {
    console.error(`[IPC Guard] Failed to register channel "${channel}":`, error);
    return false;
  }
}

/**
 * 批量注册IPC handlers（自动防重复）
 * @param {Object} handlers - handler映射对象 { channel: handlerFunction }
 * @param {string} moduleName - 模块名称
 * @returns {Object} { registered: number, skipped: number }
 */
function safeRegisterHandlers(handlers, moduleName = 'unknown') {
  let registered = 0;
  let skipped = 0;

  for (const [channel, handler] of Object.entries(handlers)) {
    if (safeRegisterHandler(channel, handler, moduleName)) {
      registered++;
    } else {
      skipped++;
    }
  }

  return { registered, skipped };
}

/**
 * 注册模块的所有handlers（模块级防重复）
 * @param {string} moduleName - 模块名称
 * @param {Function} registerFunc - 注册函数
 * @returns {boolean} 是否成功注册（false表示模块已注册）
 */
function safeRegisterModule(moduleName, registerFunc) {
  if (isModuleRegistered(moduleName)) {
    console.log(`[IPC Guard] Module "${moduleName}" already registered, skipping...`);
    return false;
  }

  try {
    registerFunc();
    markModuleRegistered(moduleName);
    console.log(`[IPC Guard] Module "${moduleName}" registered successfully`);
    return true;
  } catch (error) {
    console.error(`[IPC Guard] Failed to register module "${moduleName}":`, error);
    return false;
  }
}

/**
 * 移除channel的注册
 * @param {string} channel - IPC channel名称
 */
function unregisterChannel(channel) {
  if (registeredChannels.has(channel)) {
    try {
      ipcMain.removeHandler(channel);
      registeredChannels.delete(channel);
      console.log(`[IPC Guard] Channel "${channel}" unregistered`);
    } catch (error) {
      console.error(`[IPC Guard] Failed to unregister channel "${channel}":`, error);
    }
  }
}

/**
 * 移除模块的所有注册
 * @param {string} moduleName - 模块名称
 */
function unregisterModule(moduleName) {
  // 找到该模块注册的所有channels并移除
  const channelsToRemove = [];
  for (const [channel, info] of registeredChannels.entries()) {
    if (info.module === moduleName) {
      channelsToRemove.push(channel);
    }
  }

  channelsToRemove.forEach(channel => unregisterChannel(channel));
  registeredModules.delete(moduleName);
  console.log(`[IPC Guard] Module "${moduleName}" unregistered (${channelsToRemove.length} channels)`);
}

/**
 * 重置所有注册状态（用于测试和热重载）
 */
function resetAll() {
  console.log('[IPC Guard] Resetting all registrations...');
  console.log('[IPC Guard] Current state before reset:', {
    channels: registeredChannels.size,
    modules: Array.from(registeredModules)
  });

  // 移除我们注册的handlers（不是所有监听器）
  try {
    for (const channel of registeredChannels.keys()) {
      try {
        ipcMain.removeHandler(channel);
      } catch (err) {
        // 忽略单个channel移除失败
      }
    }
  } catch (error) {
    console.error('[IPC Guard] Failed to remove handlers:', error);
  }

  // 清空注册状态
  registeredChannels.clear();
  registeredModules.clear();

  console.log('[IPC Guard] All registrations reset - channels and modules cleared');
}

/**
 * 获取注册统计信息
 * @returns {Object} 统计信息
 */
function getStats() {
  return {
    totalChannels: registeredChannels.size,
    totalModules: registeredModules.size,
    channels: Array.from(registeredChannels.entries()).map(([channel, info]) => ({
      channel,
      module: info.module,
      registeredAt: new Date(info.timestamp).toISOString()
    })),
    modules: Array.from(registeredModules)
  };
}

/**
 * 打印注册统计信息
 */
function printStats() {
  const stats = getStats();
  console.log('[IPC Guard] Registration Statistics:');
  console.log(`  Total Modules: ${stats.totalModules}`);
  console.log(`  Total Channels: ${stats.totalChannels}`);
  console.log(`  Registered Modules:`, stats.modules);
}

module.exports = {
  // 检查函数
  isChannelRegistered,
  isModuleRegistered,

  // 标记函数
  markChannelRegistered,
  markModuleRegistered,

  // 注册函数
  safeRegisterHandler,
  safeRegisterHandlers,
  safeRegisterModule,

  // 注销函数
  unregisterChannel,
  unregisterModule,
  resetAll,

  // 统计函数
  getStats,
  printStats
};
