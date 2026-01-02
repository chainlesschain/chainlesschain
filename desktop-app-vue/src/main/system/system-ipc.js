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

  /**
   * 获取系统信息
   * Channel: 'system:get-system-info'
   */
  ipcMain.handle('system:get-system-info', async () => {
    try {
      const { app } = require('electron');
      const os = require('os');
      return {
        success: true,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.versions.node,
        chromeVersion: process.versions.chrome,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
        appName: app.getName(),
        osType: os.type(),
        osRelease: os.release(),
        osPlatform: os.platform(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpus: os.cpus().length,
      };
    } catch (error) {
      console.error('[System IPC] 获取系统信息失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取应用信息
   * Channel: 'system:get-app-info'
   */
  ipcMain.handle('system:get-app-info', async () => {
    try {
      const { app } = require('electron');
      return {
        success: true,
        name: app.getName(),
        version: app.getVersion(),
        path: app.getAppPath(),
        isPackaged: app.isPackaged,
      };
    } catch (error) {
      console.error('[System IPC] 获取应用信息失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取平台信息
   * Channel: 'system:get-platform'
   */
  ipcMain.handle('system:get-platform', async () => {
    try {
      return {
        success: true,
        platform: process.platform,
      };
    } catch (error) {
      console.error('[System IPC] 获取平台信息失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取版本信息
   * Channel: 'system:get-version'
   */
  ipcMain.handle('system:get-version', async () => {
    try {
      const { app } = require('electron');
      return {
        success: true,
        version: app.getVersion(),
      };
    } catch (error) {
      console.error('[System IPC] 获取版本信息失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取路径
   * Channel: 'system:get-path'
   */
  ipcMain.handle('system:get-path', async (_event, name) => {
    try {
      const { app } = require('electron');
      return {
        success: true,
        path: app.getPath(name),
      };
    } catch (error) {
      console.error('[System IPC] 获取路径失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 打开外部链接
   * Channel: 'system:open-external'
   */
  ipcMain.handle('system:open-external', async (_event, url) => {
    try {
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('[System IPC] 打开外部链接失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 在文件夹中显示文件
   * Channel: 'system:show-item-in-folder'
   */
  ipcMain.handle('system:show-item-in-folder', async (_event, path) => {
    try {
      const { shell } = require('electron');
      shell.showItemInFolder(path);
      return { success: true };
    } catch (error) {
      console.error('[System IPC] 显示文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 选择目录
   * Channel: 'system:select-directory'
   */
  ipcMain.handle('system:select-directory', async () => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
      });
      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths,
      };
    } catch (error) {
      console.error('[System IPC] 选择目录失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 选择文件
   * Channel: 'system:select-file'
   */
  ipcMain.handle('system:select-file', async (_event, options = {}) => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        ...options,
      });
      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths,
      };
    } catch (error) {
      console.error('[System IPC] 选择文件失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 退出应用
   * Channel: 'system:quit'
   */
  ipcMain.handle('system:quit', async () => {
    try {
      const { app } = require('electron');
      app.quit();
      return { success: true };
    } catch (error) {
      console.error('[System IPC] 退出应用失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[System IPC] Registered 16 system: handlers');
  console.log('[System IPC] - system:maximize');
  console.log('[System IPC] - system:minimize');
  console.log('[System IPC] - system:close');
  console.log('[System IPC] - system:restart');
  console.log('[System IPC] - system:get-window-state');
  console.log('[System IPC] - system:set-always-on-top');
  console.log('[System IPC] - system:get-system-info');
  console.log('[System IPC] - system:get-app-info');
  console.log('[System IPC] - system:get-platform');
  console.log('[System IPC] - system:get-version');
  console.log('[System IPC] - system:get-path');
  console.log('[System IPC] - system:open-external');
  console.log('[System IPC] - system:show-item-in-folder');
  console.log('[System IPC] - system:select-directory');
  console.log('[System IPC] - system:select-file');
  console.log('[System IPC] - system:quit');
}

module.exports = { registerSystemIPC };
