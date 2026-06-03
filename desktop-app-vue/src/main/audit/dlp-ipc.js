/**
 * DLP IPC Handlers
 *
 * 8 IPC handlers for Data Loss Prevention scanning and policy management.
 *
 * @module audit/dlp-ipc
 * @version 1.1.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain: electronIpcMain } = require("electron");

const CHANNELS = [
  "dlp:scan-content",
  "dlp:get-incidents",
  "dlp:resolve-incident",
  "dlp:get-stats",
  "dlp:create-policy",
  "dlp:update-policy",
  "dlp:delete-policy",
  "dlp:list-policies",
];

function registerDLPIPC({ dlpEngine, dlpPolicyManager, ipcMain: injectedIpcMain, ipcGuard } = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;

  logger.info("[DLP IPC] Registering DLP IPC handlers...");

  // ---- Scan & Incidents ----

  ipcMain.handle("dlp:scan-content", async (_event, params) => {
    try {
      if (!dlpEngine) { throw new Error("DLP Engine not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:scan-content")) { throw new Error("Permission denied"); }
      const result = await dlpEngine.scanContent(params);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[DLP IPC] scan-content failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dlp:get-incidents", async (_event, params) => {
    try {
      if (!dlpEngine) { throw new Error("DLP Engine not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:get-incidents")) { throw new Error("Permission denied"); }
      const result = await dlpEngine.getIncidents(params);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[DLP IPC] get-incidents failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dlp:resolve-incident", async (_event, { id, resolution }) => {
    try {
      if (!dlpEngine) { throw new Error("DLP Engine not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:resolve-incident")) { throw new Error("Permission denied"); }
      const result = await dlpEngine.resolveIncident(id, resolution);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[DLP IPC] resolve-incident failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dlp:get-stats", async () => {
    try {
      if (!dlpEngine) { throw new Error("DLP Engine not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:get-stats")) { throw new Error("Permission denied"); }
      const stats = await dlpEngine.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[DLP IPC] get-stats failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ---- Policy Management ----

  ipcMain.handle("dlp:create-policy", async (_event, params) => {
    try {
      if (!dlpPolicyManager) { throw new Error("DLP Policy Manager not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:create-policy")) { throw new Error("Permission denied"); }
      const policy = await dlpPolicyManager.createPolicy(params);
      return { success: true, policy };
    } catch (error) {
      logger.error("[DLP IPC] create-policy failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dlp:update-policy", async (_event, { id, updates }) => {
    try {
      if (!dlpPolicyManager) { throw new Error("DLP Policy Manager not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:update-policy")) { throw new Error("Permission denied"); }
      const policy = await dlpPolicyManager.updatePolicy(id, updates);
      return { success: true, policy };
    } catch (error) {
      logger.error("[DLP IPC] update-policy failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dlp:delete-policy", async (_event, { id }) => {
    try {
      if (!dlpPolicyManager) { throw new Error("DLP Policy Manager not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:delete-policy")) { throw new Error("Permission denied"); }
      const result = await dlpPolicyManager.deletePolicy(id);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[DLP IPC] delete-policy failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dlp:list-policies", async (_event, params) => {
    try {
      if (!dlpPolicyManager) { throw new Error("DLP Policy Manager not initialized"); }
      if (ipcGuard && !ipcGuard.check("dlp:list-policies")) { throw new Error("Permission denied"); }
      const policies = await dlpPolicyManager.listPolicies(params);
      return { success: true, policies };
    } catch (error) {
      logger.error("[DLP IPC] list-policies failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[DLP IPC] Registered ${CHANNELS.length} DLP IPC handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterDLPIPC() {
  for (const channel of CHANNELS) {
    electronIpcMain.removeHandler(channel);
  }
  logger.info("[DLP IPC] All handlers unregistered");
}

module.exports = { registerDLPIPC, unregisterDLPIPC, CHANNELS };
