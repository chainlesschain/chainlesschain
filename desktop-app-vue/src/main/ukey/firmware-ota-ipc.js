/**
 * Firmware OTA IPC Handlers
 *
 * 4 IPC handlers for firmware over-the-air updates:
 * - Check for updates
 * - List firmware versions
 * - Start firmware update
 * - Get update history
 *
 * @module ukey/firmware-ota-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "firmware:check-updates",
  "firmware:list-versions",
  "firmware:start-update",
  "firmware:get-history",
];

/**
 * Register all Firmware OTA IPC handlers.
 * @param {Object} dependencies
 * @param {Object} dependencies.firmwareManager - FirmwareOTAManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main (injectable for tests)
 * @param {Object} [dependencies.ipcGuard] - IPC guard (injectable for tests)
 * @returns {Object} { handlerCount }
 */
function registerFirmwareOTAIPC({
  firmwareManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("firmware-ota-ipc")
  ) {
    logger.info("[Firmware OTA IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Firmware OTA IPC] Registering Firmware OTA IPC handlers...");

  ipcMain.handle("firmware:check-updates", async (_event, params) => {
    try {
      if (!firmwareManager) {
        throw new Error("Firmware OTA Manager not initialized");
      }
      const result = await firmwareManager.checkUpdates(params || {});
      return { success: true, ...result };
    } catch (error) {
      logger.error("[Firmware OTA IPC] Check updates failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("firmware:list-versions", async (_event, params) => {
    try {
      if (!firmwareManager) {
        throw new Error("Firmware OTA Manager not initialized");
      }
      const versions = await firmwareManager.listVersions(params || {});
      return { success: true, versions };
    } catch (error) {
      logger.error("[Firmware OTA IPC] List versions failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("firmware:start-update", async (_event, params) => {
    try {
      if (!firmwareManager) {
        throw new Error("Firmware OTA Manager not initialized");
      }
      const result = await firmwareManager.startUpdate(params);
      return { success: true, update: result };
    } catch (error) {
      logger.error("[Firmware OTA IPC] Start update failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("firmware:get-history", async (_event, params) => {
    try {
      if (!firmwareManager) {
        throw new Error("Firmware OTA Manager not initialized");
      }
      const history = await firmwareManager.getHistory(params || {});
      return { success: true, history };
    } catch (error) {
      logger.error("[Firmware OTA IPC] Get history failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("firmware-ota-ipc", CHANNELS);
  }

  logger.info(
    `[Firmware OTA IPC] Registered ${CHANNELS.length} Firmware OTA IPC handlers`,
  );
  return { handlerCount: CHANNELS.length };
}

function unregisterFirmwareOTAIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Intentionally empty - handler may not exist
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("firmware-ota-ipc");
  }
  logger.info("[Firmware OTA IPC] All handlers unregistered");
}

export { registerFirmwareOTAIPC, unregisterFirmwareOTAIPC, CHANNELS };
