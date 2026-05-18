/**
 * @module marketplace/ecosystem-v2-ipc
 * Phase 99: Plugin Ecosystem v2 IPC handlers (8 handlers)
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerEcosystemV2IPC(deps) {
  const { pluginEcosystemV2 } = deps;

  ipcMain.handle("ecosystem:recommend", async (event, userProfile) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      return {
        success: true,
        data: pluginEcosystemV2.recommend(userProfile || {}),
      };
    } catch (error) {
      logger.error("[EcosystemV2IPC] recommend error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:install", async (event, pluginId) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      const result = await pluginEcosystemV2.install(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EcosystemV2IPC] install error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:resolve-deps", async (event, pluginId) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      return {
        success: true,
        data: pluginEcosystemV2.resolveDependencies(pluginId),
      };
    } catch (error) {
      logger.error("[EcosystemV2IPC] resolve-deps error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:sandbox-test", async (event, pluginId) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      const result = await pluginEcosystemV2.sandboxTest(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EcosystemV2IPC] sandbox-test error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:ai-review", async (event, pluginId) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      const result = await pluginEcosystemV2.aiReview(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EcosystemV2IPC] ai-review error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:publish", async (event, pluginDef) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      const result = pluginEcosystemV2.publish(pluginDef);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EcosystemV2IPC] publish error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:get-revenue", async (event, authorId) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      return { success: true, data: pluginEcosystemV2.getRevenue(authorId) };
    } catch (error) {
      logger.error("[EcosystemV2IPC] get-revenue error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ecosystem:configure", async (event, config) => {
    try {
      if (!pluginEcosystemV2) {
        return { success: false, error: "PluginEcosystemV2 not available" };
      }
      const result = pluginEcosystemV2.configure(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EcosystemV2IPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[EcosystemV2IPC] Registered 8 ecosystem v2 handlers");
}

module.exports = { registerEcosystemV2IPC };
