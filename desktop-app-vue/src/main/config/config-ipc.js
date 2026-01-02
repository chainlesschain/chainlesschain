/**
 * 配置 IPC 处理器
 * 负责处理应用配置相关的前后端通信
 *
 * @module config-ipc
 * @description 提供应用配置的读取和设置 IPC 接口
 */

const { ipcMain } = require('electron');

/**
 * 注册所有配置 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.appConfig - 应用配置管理器实例
 */
function registerConfigIPC({ appConfig }) {
  console.log('[Config IPC] Registering Config IPC handlers...');

  /**
   * 获取配置项
   * Channel: 'config:get'
   *
   * @param {string} key - 配置键（支持点分隔符，如 'app.theme'）
   * @param {any} defaultValue - 默认值（可选）
   * @returns {Promise<any>} 配置值
   */
  ipcMain.handle('config:get', async (_event, key, defaultValue = null) => {
    try {
      if (!appConfig) {
        console.warn('[Config IPC] AppConfig not initialized, returning default value');
        return defaultValue;
      }

      const value = appConfig.get(key, defaultValue);
      return value;
    } catch (error) {
      console.error('[Config IPC] 获取配置失败:', error);
      return defaultValue;
    }
  });

  /**
   * 设置配置项
   * Channel: 'config:set'
   *
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('config:set', async (_event, key, value) => {
    try {
      if (!appConfig) {
        throw new Error('AppConfig未初始化');
      }

      appConfig.set(key, value);
      return { success: true };
    } catch (error) {
      console.error('[Config IPC] 设置配置失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取全部配置
   * Channel: 'config:get-all'
   *
   * @returns {Promise<Object>} 全部配置对象
   */
  ipcMain.handle('config:get-all', async () => {
    try {
      if (!appConfig) {
        console.warn('[Config IPC] AppConfig not initialized, returning empty config');
        return {};
      }

      return appConfig.getAll();
    } catch (error) {
      console.error('[Config IPC] 获取全部配置失败:', error);
      return {};
    }
  });

  /**
   * 重置配置为默认值
   * Channel: 'config:reset'
   *
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('config:reset', async () => {
    try {
      if (!appConfig) {
        throw new Error('AppConfig未初始化');
      }

      appConfig.reset();
      return { success: true };
    } catch (error) {
      console.error('[Config IPC] 重置配置失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Config IPC] Registered 4 config: handlers');
  console.log('[Config IPC] - config:get');
  console.log('[Config IPC] - config:set');
  console.log('[Config IPC] - config:get-all');
  console.log('[Config IPC] - config:reset');
}

module.exports = { registerConfigIPC };
