"use strict";

const { logger } = require("../../utils/logger.js");

/**
 * Register Business Intelligence IPC handlers.
 *
 * 8 IPC handlers:
 * - bi:nl-query, bi:generate-report, bi:create-dashboard, bi:detect-anomaly
 * - bi:predict-trend, bi:list-templates, bi:export-report, bi:schedule-report
 *
 * @module enterprise/bi/bi-ipc
 * @param {Object} deps
 * @param {Object} deps.biEngine - BIEngine instance (must be initialized)
 * @param {Object} [deps.ipcMain] - Optional injected ipcMain (for testing)
 */
function registerBIIPC({ biEngine, ipcMain: injectedIpcMain } = {}) {
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
      logger.warn(`[BI IPC] Failed to register ${channel}: ${err.message}`);
    }
  };

  safeHandle("bi:nl-query", async (_event, query) => {
    try {
      if (!biEngine) {
        return { success: false, error: "Not available" };
      }
      const data = await biEngine.nlQuery(query);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("bi:generate-report", async (_event, { name, options }) => {
    try {
      if (!biEngine) {
        return { success: false, error: "Not available" };
      }
      const data = await biEngine.generateReport(name, options || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(
    "bi:create-dashboard",
    async (_event, { name, widgets, layout }) => {
      try {
        if (!biEngine) {
          return { success: false, error: "Not available" };
        }
        const data = biEngine.createDashboard(name, widgets, layout);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  safeHandle("bi:detect-anomaly", async (_event, { data, options }) => {
    try {
      if (!biEngine) {
        return { success: false, error: "Not available" };
      }
      const result = biEngine.detectAnomaly(data, options || {});
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("bi:predict-trend", async (_event, { data, periods }) => {
    try {
      if (!biEngine) {
        return { success: false, error: "Not available" };
      }
      const result = biEngine.predictTrend(data, periods);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("bi:list-templates", async () => {
    try {
      if (!biEngine) {
        return { success: false, error: "Not available" };
      }
      const data = biEngine.listTemplates();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("bi:export-report", async (_event, { reportId, format }) => {
    try {
      if (!biEngine) {
        return { success: false, error: "Not available" };
      }
      const data = biEngine.exportReport(reportId, format);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(
    "bi:schedule-report",
    async (_event, { reportId, cron, recipients }) => {
      try {
        if (!biEngine) {
          return { success: false, error: "Not available" };
        }
        const data = biEngine.scheduleReport(reportId, cron, recipients);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  logger.info(`[BI IPC] Registered ${registeredCount} handlers`);
  return { handlerCount: registeredCount };
}

module.exports = { registerBIIPC };
