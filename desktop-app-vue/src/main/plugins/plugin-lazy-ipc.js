/**
 * 插件系统懒加载 IPC 包装器
 * 在首次访问时才初始化插件系统，节省启动时间 2-3 秒
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * 确保插件系统已初始化
 * @param {Object} app - 应用实例
 * @returns {Promise<void>}
 */
async function ensurePluginInitialized(app) {
  if (!app.pluginInitialized) {
    logger.info("[Plugin Lazy IPC] 首次访问插件功能，正在初始化插件系统...");
    const startTime = Date.now();
    await app.initializePluginSystem();
    const elapsed = Date.now() - startTime;
    logger.info(`[Plugin Lazy IPC] ✓ 插件系统初始化完成 (耗时: ${elapsed}ms)`);
  }
}

/**
 * 注册懒加载的插件 IPC 处理器
 * @param {Object} options
 * @param {Object} options.app - 应用实例
 * @param {Object} options.mainWindow - 主窗口实例
 */
function registerLazyPluginIPC({ app, mainWindow }) {
  logger.info("[Plugin Lazy IPC] 注册懒加载插件 IPC 处理器...");

  // ============================================================
  // 插件管理核心功能
  // ============================================================

  ipcMain.handle("plugin:get-plugins", async (_event, filters = {}) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.getPlugins(filters);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插件列表失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:get-plugin", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.getPlugin(pluginId);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插件详情失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:install", async (_event, source, options = {}) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.installPlugin(source, options);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 安装插件失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:uninstall", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.uninstallPlugin(pluginId);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 卸载插件失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:enable", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.enablePlugin(pluginId);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 启用插件失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:disable", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.disablePlugin(pluginId);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 禁用插件失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 权限管理
  // ============================================================

  ipcMain.handle("plugin:get-permissions", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      return await app.pluginManager.getPluginPermissions(pluginId);
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插件权限失败:", error);
      throw error;
    }
  });

  // ============================================================
  // UI 扩展
  // ============================================================

  ipcMain.handle("plugin:get-ui-extensions", async () => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        // 返回空结果而不是抛出错误（插件系统可能未启用）
        return {
          success: true,
          extensions: {
            pages: [],
            menus: [],
            components: [],
          },
        };
      }
      // 获取页面扩展
      const pageExtensions =
        app.pluginManager.registry.getExtensionsByPoint("ui.page");
      // 获取菜单扩展
      const menuExtensions =
        app.pluginManager.registry.getExtensionsByPoint("ui.menu");
      // 获取组件扩展
      const componentExtensions =
        app.pluginManager.registry.getExtensionsByPoint("ui.component");

      return {
        success: true,
        extensions: {
          pages: pageExtensions,
          menus: menuExtensions,
          components: componentExtensions,
        },
      };
    } catch (error) {
      // 返回失败状态而不是抛出错误，避免 renderer 错误日志
      logger.warn("[Plugin Lazy IPC] 获取 UI 扩展失败:", error.message);
      return {
        success: false,
        error: error.message,
        extensions: {
          pages: [],
          menus: [],
          components: [],
        },
      };
    }
  });

  ipcMain.handle("plugin:get-slot-extensions", async (_event, slotName) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      const componentExtensions =
        app.pluginManager.registry.getExtensionsByPoint("ui.component");
      const slotExtensions = componentExtensions.filter(
        (ext) => ext.config?.slot === slotName,
      );

      return {
        success: true,
        extensions: slotExtensions.sort(
          (a, b) => (a.priority || 100) - (b.priority || 100),
        ),
      };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插槽扩展失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 设置管理
  // ============================================================

  ipcMain.handle(
    "plugin:get-settings-definitions",
    async (_event, pluginId) => {
      try {
        await ensurePluginInitialized(app);
        if (!app.pluginManager) {
          throw new Error("插件管理器未初始化");
        }
        const definitions =
          app.pluginManager.registry.getPluginSettingDefinitions?.(pluginId) ||
          [];
        return { success: true, definitions };
      } catch (error) {
        logger.error("[Plugin Lazy IPC] 获取设置定义失败:", error);
        throw error;
      }
    },
  );

  ipcMain.handle("plugin:get-settings", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      const settings =
        app.pluginManager.registry.getPluginSettings?.(pluginId) || {};
      return { success: true, settings };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插件设置失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:save-settings", async (_event, pluginId, settings) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      await app.pluginManager.registry.savePluginSettings?.(pluginId, settings);
      return { success: true };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 保存插件设置失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 数据导入/导出
  // ============================================================

  ipcMain.handle("plugin:get-data-importers", async () => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      const importers =
        app.pluginManager.registry.getExtensionsByPoint("data.importer");
      return { success: true, importers };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取数据导入器失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:get-data-exporters", async () => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      const exporters =
        app.pluginManager.registry.getExtensionsByPoint("data.exporter");
      return { success: true, exporters };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取数据导出器失败:", error);
      throw error;
    }
  });

  ipcMain.handle(
    "plugin:execute-import",
    async (_event, importerId, options) => {
      try {
        await ensurePluginInitialized(app);
        if (!app.pluginManager) {
          throw new Error("插件管理器未初始化");
        }
        const result = await app.pluginManager.triggerExtensionPoint(
          "data.importer",
          {
            importerId,
            ...options,
          },
        );
        return { success: true, result };
      } catch (error) {
        logger.error("[Plugin Lazy IPC] 执行数据导入失败:", error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "plugin:execute-export",
    async (_event, exporterId, options) => {
      try {
        await ensurePluginInitialized(app);
        if (!app.pluginManager) {
          throw new Error("插件管理器未初始化");
        }
        const result = await app.pluginManager.triggerExtensionPoint(
          "data.exporter",
          {
            exporterId,
            ...options,
          },
        );
        return { success: true, result };
      } catch (error) {
        logger.error("[Plugin Lazy IPC] 执行数据导出失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 工具和技能
  // ============================================================

  ipcMain.handle("plugin:get-tools", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      const plugin = app.pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }
      // 从 manifest 中获取工具列表
      const tools = plugin.manifest?.tools || [];
      return { success: true, tools };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插件工具失败:", error);
      throw error;
    }
  });

  ipcMain.handle("plugin:get-skills", async (_event, pluginId) => {
    try {
      await ensurePluginInitialized(app);
      if (!app.pluginManager) {
        throw new Error("插件管理器未初始化");
      }
      const plugin = app.pluginManager.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`插件不存在: ${pluginId}`);
      }
      // 从 manifest 中获取技能列表
      const skills = plugin.manifest?.skills || [];
      return { success: true, skills };
    } catch (error) {
      logger.error("[Plugin Lazy IPC] 获取插件技能失败:", error);
      throw error;
    }
  });

  ipcMain.handle(
    "plugin:execute-tool",
    async (_event, pluginId, toolId, params) => {
      try {
        await ensurePluginInitialized(app);
        if (!app.pluginManager) {
          throw new Error("插件管理器未初始化");
        }
        const plugin = app.pluginManager.getPlugin(pluginId);
        if (!plugin || plugin.state !== "enabled") {
          throw new Error(`插件不存在或未启用: ${pluginId}`);
        }
        // 获取沙箱并执行工具
        const sandbox = app.pluginManager.plugins?.get(pluginId)?.sandbox;
        if (!sandbox) {
          throw new Error(`插件沙箱不存在: ${pluginId}`);
        }
        // 调用工具执行方法
        const result = await sandbox.callMethod("executeTool", toolId, params);
        return { success: true, result };
      } catch (error) {
        logger.error("[Plugin Lazy IPC] 执行插件工具失败:", error);
        throw error;
      }
    },
  );

  logger.info("[Plugin Lazy IPC] ✓ 懒加载插件 IPC 处理器注册完成");
  logger.info(
    "[Plugin Lazy IPC] ✓ 已注册核心处理器，完整功能将在首次访问时加载",
  );
}

module.exports = {
  registerLazyPluginIPC,
};
