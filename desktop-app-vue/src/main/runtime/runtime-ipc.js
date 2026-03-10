/**
 * @module runtime/runtime-ipc
 * Phase 98: Universal Runtime IPC handlers (8 handlers)
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerRuntimeIPC(deps) {
  const { universalRuntime } = deps;

  ipcMain.handle("runtime:load-plugin", async (event, pluginDef) => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      const result = await universalRuntime.loadPlugin(pluginDef);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[RuntimeIPC] load-plugin error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "runtime:hot-update",
    async (event, { pluginId, newVersion, payload }) => {
      try {
        if (!universalRuntime) {
          return { success: false, error: "UniversalRuntime not available" };
        }
        const result = await universalRuntime.hotUpdate(
          pluginId,
          newVersion,
          payload,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[RuntimeIPC] hot-update error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("runtime:profile", async (event, { type, duration }) => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      const result = await universalRuntime.profile(type, duration);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[RuntimeIPC] profile error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("runtime:sync-state", async (event, { key, value }) => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      universalRuntime.syncState(key, value);
      return { success: true };
    } catch (error) {
      logger.error("[RuntimeIPC] sync-state error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("runtime:get-platform-info", async () => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      return { success: true, data: universalRuntime.getPlatformInfo() };
    } catch (error) {
      logger.error("[RuntimeIPC] get-platform-info error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("runtime:configure", async (event, config) => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      const result = universalRuntime.configure(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[RuntimeIPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("runtime:health-check", async () => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      return { success: true, data: universalRuntime.healthCheck() };
    } catch (error) {
      logger.error("[RuntimeIPC] health-check error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("runtime:get-metrics", async () => {
    try {
      if (!universalRuntime) {
        return { success: false, error: "UniversalRuntime not available" };
      }
      return { success: true, data: universalRuntime.getMetrics() };
    } catch (error) {
      logger.error("[RuntimeIPC] get-metrics error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[RuntimeIPC] Registered 8 runtime handlers");
}

module.exports = { registerRuntimeIPC };
