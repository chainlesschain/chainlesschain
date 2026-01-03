/**
 * Plugin IPC Handlers
 * 提供前端调用的插件管理接口
 */

const path = require('path');

function registerPluginIPC({ pluginManager, ipcMain: injectedIpcMain }) {
  const { ipcMain, shell, app } = injectedIpcMain
    ? { ipcMain: injectedIpcMain, shell: require('electron').shell, app: require('electron').app }
    : require('electron');

  console.log('[Plugin IPC] Registering plugin IPC handlers...');

  const ensureManager = () => {
    if (!pluginManager) {
      throw new Error('插件系统未初始化');
    }
  };

  const safeInvoke = async (handler) => {
    try {
      return await handler();
    } catch (error) {
      console.error('[Plugin IPC] 调用失败:', error);
      return { success: false, error: error.message };
    }
  };

  ipcMain.handle('plugin:get-plugins', (_event, filters = {}) =>
    safeInvoke(() => {
      ensureManager();
      const plugins = pluginManager.getPlugins(filters || {});
      return { success: true, plugins };
    })
  );

  ipcMain.handle('plugin:get-plugin', (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const plugin = pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }
      return { success: true, plugin };
    })
  );

  ipcMain.handle('plugin:install', (_event, source, options = {}) =>
    safeInvoke(async () => {
      ensureManager();
      const result = await pluginManager.installPlugin(source, options);
      return { success: true, ...result };
    })
  );

  ipcMain.handle('plugin:uninstall', (_event, pluginId) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.uninstallPlugin(pluginId);
      return { success: true };
    })
  );

  ipcMain.handle('plugin:enable', (_event, pluginId) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.enablePlugin(pluginId);
      return { success: true };
    })
  );

  ipcMain.handle('plugin:disable', (_event, pluginId) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.disablePlugin(pluginId);
      return { success: true };
    })
  );

  ipcMain.handle('plugin:get-permissions', (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const permissions = pluginManager.getPluginPermissions(pluginId);
      return { success: true, permissions };
    })
  );

  ipcMain.handle('plugin:update-permission', (_event, pluginId, permission, granted) =>
    safeInvoke(async () => {
      ensureManager();
      const permissions = await pluginManager.updatePluginPermission(pluginId, permission, granted);
      return { success: true, permissions };
    })
  );

  ipcMain.handle('plugin:trigger-extension-point', (_event, name, context = {}) =>
    safeInvoke(async () => {
      ensureManager();
      const results = await pluginManager.triggerExtensionPoint(name, context);
      return { success: true, results };
    })
  );

  ipcMain.handle('plugin:open-plugins-dir', () =>
    safeInvoke(async () => {
      ensureManager();
      const pluginsDir =
        pluginManager.getPluginsDirectory() || path.join(app.getPath('userData'), 'plugins');
      await shell.openPath(pluginsDir);
      return { success: true, path: pluginsDir };
    })
  );

  console.log('[Plugin IPC] ✓ Handlers registered');
}

module.exports = { registerPluginIPC };
