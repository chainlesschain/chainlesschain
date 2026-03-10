"use strict";

const { logger } = require("../../utils/logger.js");

/**
 * Register Enterprise Knowledge Graph IPC handlers.
 *
 * 8 IPC handlers:
 * - kg:add-entity, kg:query, kg:visualize, kg:reason
 * - kg:graphrag-search, kg:import, kg:export, kg:get-stats
 *
 * @module ai-engine/knowledge/kg-ipc
 * @param {Object} deps
 * @param {Object} deps.enterpriseKG - EnterpriseKG instance (must be initialized)
 * @param {Object} [deps.ipcMain] - Optional injected ipcMain (for testing)
 */
function registerKGIPC({ enterpriseKG, ipcMain: injectedIpcMain } = {}) {
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
      logger.warn(`[KG IPC] Failed to register ${channel}: ${err.message}`);
    }
  };

  safeHandle("kg:add-entity", async (_event, { name, type, properties }) => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.addEntity(name, type, properties);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:query", async (_event, queryDef) => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.query(queryDef || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:visualize", async (_event, options) => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.visualize(options || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:reason", async (_event, { entityId, depth }) => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.reason(entityId, depth);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:graphrag-search", async (_event, { query, options }) => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.graphRAGSearch(query, options || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:import", async (_event, data) => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const result = enterpriseKG.importData(data);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:export", async () => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.exportData();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("kg:get-stats", async () => {
    try {
      if (!enterpriseKG) {
        return { success: false, error: "Not available" };
      }
      const data = enterpriseKG.getStats();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  logger.info(`[KG IPC] Registered ${registeredCount} handlers`);
  return { handlerCount: registeredCount };
}

module.exports = { registerKGIPC };
