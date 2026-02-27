/**
 * SIEM IPC Handlers
 *
 * 4 IPC handlers for SIEM integration:
 * - List configured SIEM targets
 * - Add new SIEM target
 * - Export audit logs to a target
 * - Get export statistics
 *
 * @module audit/siem-ipc
 * @version 1.1.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain: electronIpcMain } = require("electron");
const ipcGuardModule = require("../ipc/ipc-guard.js");

const CHANNELS = [
  "siem:list-targets",
  "siem:add-target",
  "siem:export-logs",
  "siem:get-stats",
];

/**
 * Register all SIEM IPC handlers.
 * @param {Object} dependencies
 * @param {Object} dependencies.siemExporter - SIEMExporter instance
 * @param {Object} [dependencies.ipcMain] - IPC main (injectable for tests)
 * @param {Object} [dependencies.ipcGuard] - IPC guard (injectable for tests)
 * @returns {Object} { handlerCount }
 */
function registerSIEMIPC({ siemExporter, ipcMain: injectedIpcMain, ipcGuard: injectedIpcGuard } = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered && ipcGuard.isModuleRegistered("siem-ipc")) {
    logger.info("[SIEM IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[SIEM IPC] Registering SIEM IPC handlers...");

  // ============================================================
  // SIEM Target Management
  // ============================================================

  ipcMain.handle("siem:list-targets", async () => {
    try {
      if (!siemExporter) {throw new Error("SIEM Exporter not initialized");}
      const targets = await siemExporter.listTargets();
      return { success: true, targets };
    } catch (error) {
      logger.error("[SIEM IPC] List targets failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("siem:add-target", async (_event, params) => {
    try {
      if (!siemExporter) {throw new Error("SIEM Exporter not initialized");}
      const target = await siemExporter.addTarget(params);
      return { success: true, target };
    } catch (error) {
      logger.error("[SIEM IPC] Add target failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Log Export
  // ============================================================

  ipcMain.handle("siem:export-logs", async (_event, params) => {
    try {
      if (!siemExporter) {throw new Error("SIEM Exporter not initialized");}
      const result = await siemExporter.exportLogs(params);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[SIEM IPC] Export logs failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Statistics
  // ============================================================

  ipcMain.handle("siem:get-stats", async () => {
    try {
      if (!siemExporter) {throw new Error("SIEM Exporter not initialized");}
      const stats = await siemExporter.getExportStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[SIEM IPC] Get stats failed:", error);
      return { success: false, error: error.message };
    }
  });

  // Register module with guard
  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("siem-ipc");
  }

  logger.info(`[SIEM IPC] Registered ${CHANNELS.length} SIEM IPC handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterSIEMIPC() {
  for (const channel of CHANNELS) {
    try {
      electronIpcMain.removeHandler(channel);
    } catch (_err) {
      // Intentionally empty - handler may not exist
    }
  }
  if (ipcGuardModule.unregisterModule) {
    ipcGuardModule.unregisterModule("siem-ipc");
  }
  logger.info("[SIEM IPC] All handlers unregistered");
}

module.exports = { registerSIEMIPC, unregisterSIEMIPC, CHANNELS };
