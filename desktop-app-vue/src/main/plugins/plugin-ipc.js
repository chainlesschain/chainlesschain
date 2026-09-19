/**
 * Plugin IPC Handlers
 * 提供前端调用的插件管理接口
 */

const { logger: pluginLogSink } = require("../utils/logger.js");
const { createPluginLogRedactor } = require("./plugin-log-redaction");
const { createPluginIpcFailureResult } = require("./plugin-ipc-error-boundary");
const {
  projectPluginDataExecutionReceipt,
  projectPluginDataExtensions,
  projectPluginEnterpriseEntries,
  projectPluginInvocationReceipt,
  projectPluginPageContent,
  projectPluginPublicRecord,
  projectPluginRuntimeUiEntries,
  projectPluginSettingDefinitions,
  projectPluginSettings,
  projectPluginSkillDefinitions,
  projectPluginToolDefinitions,
  projectPluginToolExecutionReceipt,
  projectPluginUiExtensions,
  projectPluginV6UiEntries,
} = require("./plugin-public-projection");
const path = require("path");
const {
  getPermissionDialogManager,
  PERMISSION_CATEGORIES,
  RISK_LEVELS,
} = require("./permission-dialog-manager");

const logger = createPluginLogRedactor(pluginLogSink, "PluginIPC");

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

  logger.info("[Plugin IPC] Registering plugin IPC handlers...");

  const ensureManager = () => {
    if (!pluginManager) {
      throw new Error("插件系统未初始化");
    }
  };

  const safeInvoke = async (handler) => {
    try {
      return await handler();
    } catch (error) {
      logger.error("[Plugin IPC] 调用失败:", error);
      return createPluginIpcFailureResult("plugin");
    }
  };

  ipcMain.handle("plugin:get-plugins", (_event, filters = {}) =>
    safeInvoke(() => {
      ensureManager();
      const plugins = pluginManager.getPlugins(filters || {});
      return {
        success: true,
        plugins: plugins.map(projectPluginPublicRecord).filter(Boolean),
      };
    }),
  );

  ipcMain.handle("plugin:get-plugin", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const plugin = pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }
      return { success: true, plugin: projectPluginPublicRecord(plugin) };
    }),
  );

  ipcMain.handle("plugin:install", (_event, source, options = {}) =>
    safeInvoke(async () => {
      ensureManager();
      const result = await pluginManager.installPlugin(source, options);
      return { success: true, pluginId: result.pluginId };
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
        await pluginManager.triggerExtensionPoint(name, context);
        return projectPluginInvocationReceipt("extension");
      }),
  );

  ipcMain.handle("plugin:open-plugins-dir", () =>
    safeInvoke(async () => {
      ensureManager();
      const pluginsDir =
        pluginManager.getPluginsDirectory() ||
        path.join(app.getPath("userData"), "plugins");
      await shell.openPath(pluginsDir);
      return { success: true };
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
          pages: projectPluginUiExtensions(pageExtensions, "page"),
          menus: projectPluginUiExtensions(menuExtensions, "menu"),
          components: projectPluginUiExtensions(
            componentExtensions,
            "component",
          ),
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
        extensions: projectPluginUiExtensions(
          slotExtensions.sort(
            (a, b) => (a.priority || 100) - (b.priority || 100),
          ),
          "component",
        ),
      };
    }),
  );

  // ============================================
  // UI 注册表查询 IPC 处理器 (运行时注册的UI元素)
  // ============================================

  // 获取注册的页面列表
  ipcMain.handle("plugin:get-registered-pages", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      const pages = pluginManager.getRegisteredPages(pluginId);
      return {
        success: true,
        pages: projectPluginRuntimeUiEntries(pages, "page"),
      };
    }),
  );

  // 获取注册的菜单列表
  ipcMain.handle("plugin:get-registered-menus", (_event, options = {}) =>
    safeInvoke(() => {
      ensureManager();
      const { position = null, pluginId = null } = options;
      const menus = pluginManager.getRegisteredMenus(position, pluginId);
      return {
        success: true,
        menus: projectPluginRuntimeUiEntries(menus, "menu"),
      };
    }),
  );

  // 获取注册的组件列表
  ipcMain.handle("plugin:get-registered-components", (_event, options = {}) =>
    safeInvoke(() => {
      ensureManager();
      const { slot = null, pluginId = null } = options;
      const components = pluginManager.getRegisteredComponents(slot, pluginId);
      return {
        success: true,
        components: projectPluginRuntimeUiEntries(components, "component"),
      };
    }),
  );

  // 获取所有已注册的UI元素
  ipcMain.handle("plugin:get-all-registered-ui", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        ui: {
          pages: projectPluginRuntimeUiEntries(
            pluginManager.getRegisteredPages(pluginId),
            "page",
          ),
          menus: projectPluginRuntimeUiEntries(
            pluginManager.getRegisteredMenus(null, pluginId),
            "menu",
          ),
          components: projectPluginRuntimeUiEntries(
            pluginManager.getRegisteredComponents(null, pluginId),
            "component",
          ),
        },
      };
    }),
  );

  // ============================================
  // v6 Shell 扩展点 IPC
  // ============================================

  ipcMain.handle("plugin:get-registered-spaces", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        spaces: projectPluginV6UiEntries(
          pluginManager.getRegisteredSpaces(pluginId),
          "space",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-registered-artifacts", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        artifacts: projectPluginV6UiEntries(
          pluginManager.getRegisteredArtifacts(pluginId),
          "artifact",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-artifact-renderer", (_event, type) =>
    safeInvoke(() => {
      ensureManager();
      const renderer = pluginManager.getArtifactRenderer(type);
      return {
        success: true,
        renderer:
          projectPluginV6UiEntries(renderer ? [renderer] : [], "artifact")[0] ||
          null,
      };
    }),
  );

  ipcMain.handle("plugin:get-slash-commands", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        commands: projectPluginV6UiEntries(
          pluginManager.getRegisteredSlashCommands(pluginId),
          "slash",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-mention-sources", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        sources: projectPluginV6UiEntries(
          pluginManager.getRegisteredMentionSources(pluginId),
          "mention",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-status-bar-widgets", (_event, options = {}) =>
    safeInvoke(() => {
      ensureManager();
      const { position = null, pluginId = null } = options;
      return {
        success: true,
        widgets: projectPluginV6UiEntries(
          pluginManager.getRegisteredStatusBarWidgets(position, pluginId),
          "status-bar",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-home-widgets", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        widgets: projectPluginV6UiEntries(
          pluginManager.getRegisteredHomeWidgets(pluginId),
          "home-widget",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-composer-slots", (_event, options = {}) =>
    safeInvoke(() => {
      ensureManager();
      const { position = null, pluginId = null } = options;
      return {
        success: true,
        slots: projectPluginV6UiEntries(
          pluginManager.getRegisteredComposerSlots(position, pluginId),
          "composer-slot",
        ),
      };
    }),
  );

  // ============================================
  // P3 企业品牌扩展
  // ============================================

  ipcMain.handle("plugin:get-active-brand-theme", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        theme:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveBrandTheme()].filter(Boolean),
            "brand-theme",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-brand-themes", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        themes: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredBrandThemes(pluginId),
          "brand-theme",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-active-brand-identity", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        identity:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveBrandIdentity()].filter(Boolean),
            "brand-identity",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-brand-identities", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        identities: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredBrandIdentities(pluginId),
          "brand-identity",
        ),
      };
    }),
  );

  // ============================================
  // P4 企业能力扩展（LLM / Auth / Storage / Crypto / Compliance）
  // ============================================

  ipcMain.handle("plugin:get-active-llm-provider", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        provider:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveLLMProvider()].filter(Boolean),
            "llm",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-llm-providers", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        providers: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredLLMProviders(pluginId),
          "llm",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-active-auth-provider", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        provider:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveAuthProvider()].filter(Boolean),
            "auth",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-auth-providers", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        providers: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredAuthProviders(pluginId),
          "auth",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-active-data-storage", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        storage:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveDataStorage()].filter(Boolean),
            "storage",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-data-storages", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        storages: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredDataStorages(pluginId),
          "storage",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-active-data-crypto", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        crypto:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveDataCrypto()].filter(Boolean),
            "crypto",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-data-cryptos", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        cryptos: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredDataCryptos(pluginId),
          "crypto",
        ),
      };
    }),
  );

  ipcMain.handle("plugin:get-active-compliance-audit", () =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        audit:
          projectPluginEnterpriseEntries(
            [pluginManager.getActiveComplianceAudit()].filter(Boolean),
            "audit",
          )[0] || null,
      };
    }),
  );

  ipcMain.handle("plugin:get-compliance-audits", (_event, pluginId = null) =>
    safeInvoke(() => {
      ensureManager();
      return {
        success: true,
        audits: projectPluginEnterpriseEntries(
          pluginManager.getRegisteredComplianceAudits(pluginId),
          "audit",
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
      return {
        success: true,
        definitions: projectPluginSettingDefinitions(definitions),
      };
    }),
  );

  // 获取插件设置值
  ipcMain.handle("plugin:get-settings", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();
      const settings =
        pluginManager.registry.getPluginSettings?.(pluginId) || {};
      const definitions =
        pluginManager.registry.getPluginSettingDefinitions?.(pluginId) || [];
      return {
        success: true,
        settings: projectPluginSettings(settings, definitions),
      };
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
      return {
        success: true,
        importers: projectPluginDataExtensions(importers),
      };
    }),
  );

  // 获取数据导出器列表
  ipcMain.handle("plugin:get-data-exporters", () =>
    safeInvoke(() => {
      ensureManager();
      const exporters =
        pluginManager.registry.getExtensionsByPoint("data.exporter");
      return {
        success: true,
        exporters: projectPluginDataExtensions(exporters),
      };
    }),
  );

  // 执行数据导入
  ipcMain.handle("plugin:execute-import", (_event, importerId, options) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.triggerExtensionPoint("data.importer", {
        importerId,
        ...options,
      });
      return projectPluginDataExecutionReceipt("import");
    }),
  );

  // 执行数据导出
  ipcMain.handle("plugin:execute-export", (_event, exporterId, options) =>
    safeInvoke(async () => {
      ensureManager();
      await pluginManager.triggerExtensionPoint("data.exporter", {
        exporterId,
        ...options,
      });
      return projectPluginDataExecutionReceipt("export");
    }),
  );

  // ============================================
  // 插件方法调用 IPC 处理器
  // ============================================

  // 调用插件方法
  ipcMain.handle(
    "plugin:call-method",
    (_event, pluginId, methodName, args = []) =>
      safeInvoke(async () => {
        ensureManager();

        // 获取插件实例
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
          throw new Error(`插件不存在: ${pluginId}`);
        }

        // 检查插件是否启用
        if (plugin.state !== "enabled") {
          throw new Error(`插件未启用: ${pluginId}`);
        }

        // 获取沙箱实例并调用方法
        const sandbox = pluginManager.sandboxes?.get(pluginId);
        if (!sandbox) {
          throw new Error(`插件沙箱不存在: ${pluginId}`);
        }

        // 调用沙箱中的方法
        await sandbox.callMethod(methodName, ...args);
        return projectPluginInvocationReceipt("method");
      }),
  );

  // 获取插件页面内容
  ipcMain.handle(
    "plugin:get-page-content",
    (_event, pluginId, pageId = "main") =>
      safeInvoke(async () => {
        ensureManager();

        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
          throw new Error(`插件不存在: ${pluginId}`);
        }

        if (plugin.state !== "enabled") {
          throw new Error(`插件未启用: ${pluginId}`);
        }

        return projectPluginPageContent(pluginId, pageId);
      }),
  );

  // 获取插件提供的工具列表
  ipcMain.handle("plugin:get-tools", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();

      const plugin = pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }

      // 从 manifest 中获取工具列表
      const tools = projectPluginToolDefinitions(plugin.manifest?.tools);
      return { success: true, tools };
    }),
  );

  // 获取插件提供的技能列表
  ipcMain.handle("plugin:get-skills", (_event, pluginId) =>
    safeInvoke(() => {
      ensureManager();

      const plugin = pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }

      // 从 manifest 中获取技能列表
      const skills = projectPluginSkillDefinitions(plugin.manifest?.skills);
      return { success: true, skills };
    }),
  );

  // 执行插件工具
  ipcMain.handle("plugin:execute-tool", (_event, pluginId, toolId, params) =>
    safeInvoke(async () => {
      ensureManager();

      const plugin = pluginManager.getPlugin(pluginId);
      if (!plugin || plugin.state !== "enabled") {
        throw new Error(`插件不存在或未启用: ${pluginId}`);
      }

      // 获取沙箱并执行工具
      const sandbox = pluginManager.sandboxes?.get(pluginId);
      if (!sandbox) {
        throw new Error(`插件沙箱不存在: ${pluginId}`);
      }

      // 调用工具执行方法
      await sandbox.callMethod("executeTool", toolId, params);
      return projectPluginToolExecutionReceipt();
    }),
  );

  logger.info(
    "[Plugin IPC] ✓ Handlers registered (including permission dialog, UI extensions, settings, data import/export, method calls)",
  );
}

module.exports = { registerPluginIPC };
