/**
 * 系统窗口控制 IPC 处理器
 * 负责处理窗口最大化、最小化、关闭等系统级操作
 *
 * @module system-ipc
 * @description 提供系统窗口控制的 IPC 接口
 */

const { ipcMain, BrowserWindow } = require('electron');

/**
 * 注册所有系统 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.mainWindow - 主窗口实例
 */
function registerSystemIPC({ mainWindow }) {
  console.log('[System IPC] Registering System IPC handlers...');

  /**
   * 最大化窗口
   * Channel: 'system:maximize'
   */
  ipcMain.handle('system:maximize', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
        return { success: true, isMaximized: mainWindow.isMaximized() };
      }
      return { success: false, error: '主窗口未初始化' };
    } catch (error) {
      console.error('[System IPC] 最大化窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 最小化窗口
   * Channel: 'system:minimize'
   */
  ipcMain.handle('system:minimize', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
        return { success: true };
      }
      return { success: false, error: '主窗口未初始化' };
    } catch (error) {
      console.error('[System IPC] 最小化窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 关闭窗口
   * Channel: 'system:close'
   */
  ipcMain.handle('system:close', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
        return { success: true };
      }
      return { success: false, error: '主窗口未初始化' };
    } catch (error) {
      console.error('[System IPC] 关闭窗口失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 重启应用
   * Channel: 'system:restart'
   */
  ipcMain.handle('system:restart', async () => {
    try {
      const { app } = require('electron');
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (error) {
      console.error('[System IPC] 重启应用失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取窗口状态
   * Channel: 'system:get-window-state'
   */
  ipcMain.handle('system:get-window-state', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        return {
          success: true,
          state: {
            isMaximized: mainWindow.isMaximized(),
            isMinimized: mainWindow.isMinimized(),
            isFullScreen: mainWindow.isFullScreen(),
            isFocused: mainWindow.isFocused(),
          }
        };
      }
      return { success: false, error: '主窗口未初始化' };
    } catch (error) {
      console.error('[System IPC] 获取窗口状态失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 设置窗口总在最前
   * Channel: 'system:set-always-on-top'
   */
  ipcMain.handle('system:set-always-on-top', async (_event, flag) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(flag);
        return { success: true };
      }
      return { success: false, error: '主窗口未初始化' };
    } catch (error) {
      console.error('[System IPC] 设置窗口置顶失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[System IPC] Registered 6 system: handlers');
  console.log('[System IPC] - system:maximize');
  console.log('[System IPC] - system:minimize');
  console.log('[System IPC] - system:close');
  console.log('[System IPC] - system:restart');
  console.log('[System IPC] - system:get-window-state');
  console.log('[System IPC] - system:set-always-on-top');
}

module.exports = { registerSystemIPC };
