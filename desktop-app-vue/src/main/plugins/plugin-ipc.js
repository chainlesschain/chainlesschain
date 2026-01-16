/**
 * Plugin IPC Handlers
 * 提供前端调用的插件管理接口
 */

const path = require("path");
const {
  getPermissionDialogManager,
  PERMISSION_CATEGORIES,
  RISK_LEVELS,
  PERMISSION_DETAILS,
} = require("./permission-dialog-manager");

function registerPluginIPC({
  pluginManager,
  ipcMain: injectedIpcMain,
  mainWindow,
}) {
  const { ipcMain, shell, app, BrowserWindow } = injectedIpcMain
    ? {
        ipcMain: injectedIpcMain,
        shell: require("electron").shell,
        app: require("electron").app,
        BrowserWindow: require("electron").BrowserWindow,
      }
    : require("electron");

  // 获取权限对话框管理器实例
  const permissionDialogManager = getPermissionDialogManager();

  // 设置主窗口引用（用于发送事件）
  if (mainWindow) {
    permissionDialogManager.setMainWindow(mainWindow);
  } else {
    // 尝试获取第一个窗口
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      permissionDialogManager.setMainWindow(windows[0]);
    }
  }

  console.log("[Plugin IPC] Registering plugin IPC handlers...");

  const ensureManager = () => {
    if (!pluginManager) {
      throw new Error("插件系统未初始化");
    }
  };

  const safeInvoke = async (handler) => {
    try {
      return await handler();
    } catch (error) {
      console.error("[Plugin IPC] 调用失败:", error);
      return { success: false, error: error.message };
    }
  };

  ipcMain.handle("plugin:get-plugins", (_event, filters = {}) =>
    safeInvoke(() => {
      ensureManager();
      const plugins = pluginManager.getPlugins(filters || {});
      return { success: true, plugins };
    }),
  );

  ipcMain.handle("plugin:get-plugin", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const plugin = pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }
      return { success: true, plugin };
    }),
  );

  ipcMain.handle("plugin:install", (_event, source, options = {}) =>
    safeInvoke(async () => {
      ensureManager();
      const result = await pluginManager.installPlugin(source, options);
      return { success: true, ...result };
    }),
  );

  ipcMain.handle("plugin:uninstall", (_event, pluginId) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.uninstallPlugin(pluginId);
      return { success: true };
    }),
  );

  ipcMain.handle("plugin:enable", (_event, pluginId) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.enablePlugin(pluginId);
      return { success: true };
    }),
  );

  ipcMain.handle("plugin:disable", (_event, pluginId) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.disablePlugin(pluginId);
      return { success: true };
    }),
  );

  ipcMain.handle("plugin:get-permissions", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const permissions = pluginManager.getPluginPermissions(pluginId);
      return { success: true, permissions };
    }),
  );

  ipcMain.handle(
    "plugin:update-permission",
    (_event, pluginId, permission, granted) =>
      safeInvoke(async () => {
        ensureManager();
        const permissions = await pluginManager.updatePluginPermission(
          pluginId,
          permission,
          granted,
        );
        return { success: true, permissions };
      }),
  );

  ipcMain.handle(
    "plugin:trigger-extension-point",
    (_event, name, context = {}) =>
      safeInvoke(async () => {
        ensureManager();
        const results = await pluginManager.triggerExtensionPoint(
          name,
          context,
        );
        return { success: true, results };
      }),
  );

  ipcMain.handle("plugin:open-plugins-dir", () =>
    safeInvoke(async () => {
      ensureManager();
      const pluginsDir =
        pluginManager.getPluginsDirectory() ||
        path.join(app.getPath("userData"), "plugins");
      await shell.openPath(pluginsDir);
      return { success: true, path: pluginsDir };
    }),
  );

  // ============================================
  // 权限对话框相关 IPC 处理器
  // ============================================

  // 响应权限请求
  ipcMain.handle(
    "plugin:respond-to-permission-request",
    (_event, requestId, response) =>
      safeInvoke(() => {
        const result = permissionDialogManager.handlePermissionResponse(
          requestId,
          response,
        );
        return result;
      }),
  );

  // 取消权限请求
  ipcMain.handle("plugin:cancel-permission-request", (_event, requestId) =>
    safeInvoke(() => {
      permissionDialogManager.cancelRequest(requestId);
      return { success: true };
    }),
  );

  // 获取所有权限分类信息
  ipcMain.handle("plugin:get-permission-categories", () =>
    safeInvoke(() => {
      return { success: true, categories: PERMISSION_CATEGORIES };
    }),
  );

  // 获取风险等级信息
  ipcMain.handle("plugin:get-risk-levels", () =>
    safeInvoke(() => {
      return { success: true, riskLevels: RISK_LEVELS };
    }),
  );

  // 获取权限详情
  ipcMain.handle("plugin:get-permission-details", (_event, permissions) =>
    safeInvoke(() => {
      const details = permissionDialogManager.getPermissionDetails(permissions);
      return { success: true, details };
    }),
  );

  // ============================================
  // UI 扩展点相关 IPC 处理器
  // ============================================

  // 获取所有 UI 扩展
  ipcMain.handle("plugin:get-ui-extensions", () =>
    safeInvoke(() => {
      ensureManager();

      // 获取页面扩展
      const pageExtensions =
        pluginManager.registry.getExtensionsByPoint("ui.page");
      // 获取菜单扩展
      const menuExtensions =
        pluginManager.registry.getExtensionsByPoint("ui.menu");
      // 获取组件扩展
      const componentExtensions =
        pluginManager.registry.getExtensionsByPoint("ui.component");

      return {
        success: true,
        extensions: {
          pages: pageExtensions,
          menus: menuExtensions,
          components: componentExtensions,
        },
      };
    }),
  );

  // 获取特定插槽的组件扩展
  ipcMain.handle("plugin:get-slot-extensions", (_event, slotName) =>
    safeInvoke(() => {
      ensureManager();

      const componentExtensions =
        pluginManager.registry.getExtensionsByPoint("ui.component");
      const slotExtensions = componentExtensions.filter(
        (ext) => ext.config?.slot === slotName,
      );

      return {
        success: true,
        extensions: slotExtensions.sort(
          (a, b) => (a.priority || 100) - (b.priority || 100),
        ),
      };
    }),
  );

  // ============================================
  // 插件设置相关 IPC 处理器
  // ============================================

  // 获取插件设置定义
  ipcMain.handle("plugin:get-settings-definitions", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const definitions =
        pluginManager.registry.getPluginSettingDefinitions?.(pluginId) || [];
      return { success: true, definitions };
    }),
  );

  // 获取插件设置值
  ipcMain.handle("plugin:get-settings", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const settings =
        pluginManager.registry.getPluginSettings?.(pluginId) || {};
      return { success: true, settings };
    }),
  );

  // 保存插件设置值
  ipcMain.handle("plugin:save-settings", (_event, pluginId, settings) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.registry.savePluginSettings?.(pluginId, settings);
      return { success: true };
    }),
  );

  // ============================================
  // 数据导入导出扩展点相关 IPC 处理器
  // ============================================

  // 获取数据导入器列表
  ipcMain.handle("plugin:get-data-importers", () =>
    safeInvoke(() => {
      ensureManager();
      const importers =
        pluginManager.registry.getExtensionsByPoint("data.importer");
      return { success: true, importers };
    }),
  );

  // 获取数据导出器列表
  ipcMain.handle("plugin:get-data-exporters", () =>
    safeInvoke(() => {
      ensureManager();
      const exporters =
        pluginManager.registry.getExtensionsByPoint("data.exporter");
      return { success: true, exporters };
    }),
  );

  // 执行数据导入
  ipcMain.handle("plugin:execute-import", (_event, importerId, options) =>
    safeInvoke(async () => {
      ensureManager();
      const result = await pluginManager.triggerExtensionPoint(
        "data.importer",
        {
          importerId,
          ...options,
        },
      );
      return { success: true, result };
    }),
  );

  // 执行数据导出
  ipcMain.handle("plugin:execute-export", (_event, exporterId, options) =>
    safeInvoke(async () => {
      ensureManager();
      const result = await pluginManager.triggerExtensionPoint(
        "data.exporter",
        {
          exporterId,
          ...options,
        },
      );
      return { success: true, result };
    }),
  );

  console.log(
    "[Plugin IPC] ✓ Handlers registered (including permission dialog, UI extensions, settings, data import/export)",
  );
}

module.exports = { registerPluginIPC };
