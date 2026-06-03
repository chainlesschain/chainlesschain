"use strict";

const { logger } = require("../../utils/logger.js");

/**
 * Register Low-Code Platform IPC handlers.
 *
 * 10 IPC handlers for low-code app builder:
 * - lowcode:create-app, lowcode:save-design, lowcode:preview, lowcode:publish
 * - lowcode:list-components, lowcode:add-datasource, lowcode:test-connection
 * - lowcode:get-versions, lowcode:rollback, lowcode:export
 *
 * @module enterprise/low-code/low-code-ipc
 * @param {Object} deps
 * @param {Object} deps.appBuilder - AppBuilder instance (must be initialized)
 * @param {Object} [deps.ipcMain] - Optional injected ipcMain (for testing)
 */
function registerLowCodeIPC({ appBuilder, ipcMain: injectedIpcMain } = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  let registeredCount = 0;

  const safeHandle = (channel, handler) => {
    try {
      try {
        ipcMain.removeHandler(channel);
      } catch (_e) {
        /* ignore */
      }
      ipcMain.handle(channel, handler);
      registeredCount++;
    } catch (err) {
      logger.warn(
        `[LowCode IPC] Failed to register ${channel}: ${err.message}`,
      );
    }
  };

  safeHandle("lowcode:create-app", async (_event, definition) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.createApp(definition || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:save-design", async (_event, { appId, design }) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.saveDesign(appId, design);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:preview", async (_event, appId) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.preview(appId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:publish", async (_event, appId) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.publish(appId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:list-components", async () => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.listComponents();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(
    "lowcode:add-datasource",
    async (_event, { appId, name, type, config }) => {
      try {
        if (!appBuilder) {
          return { success: false, error: "Not available" };
        }
        const data = appBuilder.addDataSource(appId, name, type, config);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  safeHandle("lowcode:test-connection", async (_event, dataSourceId) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.testConnection(dataSourceId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:get-versions", async (_event, appId) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.getVersions(appId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:rollback", async (_event, { appId, version }) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.rollback(appId, version);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("lowcode:export", async (_event, appId) => {
    try {
      if (!appBuilder) {
        return { success: false, error: "Not available" };
      }
      const data = appBuilder.exportApp(appId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  logger.info(`[LowCode IPC] Registered ${registeredCount} handlers`);
  return { handlerCount: registeredCount };
}

module.exports = { registerLowCodeIPC };
