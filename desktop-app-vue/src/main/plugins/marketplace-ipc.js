/**
 * 插件市场IPC处理程序
 *
 * 处理前端与插件市场相关的IPC通信
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const { getPluginMarketplaceAPI } = require("./marketplace-api");
const PluginUpdateManager = require("./update-manager");

/**
 * 注册插件市场IPC处理程序
 */
function registerPluginMarketplaceIPC(dependencies) {
  const { pluginManager } = dependencies;

  // 初始化市场API和更新管理器
  const marketplaceAPI = getPluginMarketplaceAPI();
  const updateManager = new PluginUpdateManager(pluginManager);

  // ============================================================
  // 插件市场 - 浏览和搜索
  // ============================================================

  /**
   * 获取插件列表
   */
  ipcMain.handle("plugin-marketplace:list", async (event, options) => {
    try {
      const result = await marketplaceAPI.listPlugins(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:list error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取插件详情
   */
  ipcMain.handle("plugin-marketplace:get", async (event, pluginId) => {
    try {
      const result = await marketplaceAPI.getPlugin(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:get error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 搜索插件
   */
  ipcMain.handle("plugin-marketplace:search", async (event, query, options) => {
    try {
      const result = await marketplaceAPI.searchPlugins(query, options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:search error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取推荐插件
   */
  ipcMain.handle("plugin-marketplace:featured", async (event, limit) => {
    try {
      const result = await marketplaceAPI.getFeaturedPlugins(limit);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:featured error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取分类列表
   */
  ipcMain.handle("plugin-marketplace:categories", async (event) => {
    try {
      const result = await marketplaceAPI.getCategories();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:categories error:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // 插件市场 - 安装和下载
  // ============================================================

  /**
   * 从市场安装插件
   */
  ipcMain.handle(
    "plugin-marketplace:install",
    async (event, pluginId, version) => {
      try {
        // 下载插件
        const pluginData = await marketplaceAPI.downloadPlugin(
          pluginId,
          version,
        );

        // 保存到临时文件
        const fs = require("fs");
        const path = require("path");
        const tempDir = path.join(process.cwd(), ".temp-downloads");
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempFile = path.join(tempDir, `${pluginId}-${Date.now()}.zip`);
        fs.writeFileSync(tempFile, pluginData);

        // 安装插件
        await pluginManager.installPlugin(tempFile);

        // 清理临时文件
        fs.unlinkSync(tempFile);

        return { success: true };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:install error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 下载插件（不安装）
   */
  ipcMain.handle(
    "plugin-marketplace:download",
    async (event, pluginId, version, savePath) => {
      try {
        const pluginData = await marketplaceAPI.downloadPlugin(
          pluginId,
          version,
        );

        const fs = require("fs");
        fs.writeFileSync(savePath, pluginData);

        return { success: true, path: savePath };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:download error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // 插件市场 - 评分和评论
  // ============================================================

  /**
   * 提交插件评分
   */
  ipcMain.handle(
    "plugin-marketplace:rate",
    async (event, pluginId, rating, comment) => {
      try {
        const result = await marketplaceAPI.ratePlugin(
          pluginId,
          rating,
          comment,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:rate error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取插件评论
   */
  ipcMain.handle(
    "plugin-marketplace:reviews",
    async (event, pluginId, page, pageSize) => {
      try {
        const result = await marketplaceAPI.getPluginReviews(
          pluginId,
          page,
          pageSize,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:reviews error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 报告插件问题
   */
  ipcMain.handle(
    "plugin-marketplace:report",
    async (event, pluginId, reason, description) => {
      try {
        const result = await marketplaceAPI.reportPlugin(
          pluginId,
          reason,
          description,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:report error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // 插件更新
  // ============================================================

  /**
   * 检查插件更新
   */
  ipcMain.handle("plugin-marketplace:check-updates", async (event, force) => {
    try {
      const updates = await updateManager.checkForUpdates(force);
      return { success: true, data: Array.from(updates.values()) };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:check-updates error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新单个插件
   */
  ipcMain.handle(
    "plugin-marketplace:update-plugin",
    async (event, pluginId, version) => {
      try {
        await updateManager.updatePlugin(pluginId, version);
        return { success: true };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:update-plugin error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 更新所有插件
   */
  ipcMain.handle("plugin-marketplace:update-all", async (event) => {
    try {
      const result = await updateManager.updateAllPlugins();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:update-all error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取可用更新列表
   */
  ipcMain.handle("plugin-marketplace:available-updates", async (event) => {
    try {
      const updates = updateManager.getAvailableUpdates();
      return { success: true, data: updates };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:available-updates error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 设置自动更新
   */
  ipcMain.handle(
    "plugin-marketplace:set-auto-update",
    async (event, enabled) => {
      try {
        updateManager.setAutoUpdate(enabled);
        return { success: true };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:set-auto-update error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // 插件发布（开发者功能）
  // ============================================================

  /**
   * 发布插件
   */
  ipcMain.handle(
    "plugin-marketplace:publish",
    async (event, pluginData, pluginFilePath) => {
      try {
        const fs = require("fs");
        const pluginFile = fs.readFileSync(pluginFilePath);

        const result = await marketplaceAPI.publishPlugin(
          pluginData,
          pluginFile,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:publish error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 更新已发布的插件
   */
  ipcMain.handle(
    "plugin-marketplace:update-published",
    async (event, pluginId, version, pluginFilePath, changelog) => {
      try {
        const fs = require("fs");
        const pluginFile = fs.readFileSync(pluginFilePath);

        const result = await marketplaceAPI.updatePlugin(
          pluginId,
          version,
          pluginFile,
          changelog,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[IPC] plugin-marketplace:update-published error:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取插件统计信息
   */
  ipcMain.handle("plugin-marketplace:stats", async (event, pluginId) => {
    try {
      const result = await marketplaceAPI.getPluginStats(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:stats error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 清除市场缓存
   */
  ipcMain.handle("plugin-marketplace:clear-cache", async (event) => {
    try {
      marketplaceAPI.clearCache();
      return { success: true };
    } catch (error) {
      logger.error("[IPC] plugin-marketplace:clear-cache error:", error);
      return { success: false, error: error.message };
    }
  });

  // 监听更新事件
  updateManager.on("check-complete", (updates) => {
    // 通知前端有可用更新
    if (updates.length > 0) {
      event.sender.send("plugin-marketplace:updates-available", updates);
    }
  });

  updateManager.on("update-complete", (pluginId) => {
    event.sender.send("plugin-marketplace:update-complete", pluginId);
  });

  updateManager.on("update-error", (pluginId, error) => {
    event.sender.send("plugin-marketplace:update-error", {
      pluginId,
      error: error.message,
    });
  });

  logger.info(
    "[IPC Registry] ✓ Plugin Marketplace IPC registered (20 handlers)",
  );

  // 返回清理函数
  return () => {
    updateManager.destroy();
  };
}

module.exports = {
  registerPluginMarketplaceIPC,
};
