/**
 * Satellite Communication IPC Handlers
 * 5 IPC handlers
 * @module security/satellite-ipc
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "satellite:send-message",
  "satellite:get-messages",
  "satellite:sync-signatures",
  "satellite:emergency-revoke",
  "satellite:get-recovery-status",
];

function registerSatelliteIPC({
  satelliteComm,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("satellite-ipc")
  ) {
    logger.info("[Satellite IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[Satellite IPC] Registering handlers...");

  ipcMain.handle("satellite:send-message", async (_event, params) => {
    try {
      if (!satelliteComm) {
        throw new Error("SatelliteComm not initialized");
      }
      const msg = await satelliteComm.sendMessage(params);
      return { success: true, message: msg };
    } catch (error) {
      logger.error("[Satellite IPC] Send message failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("satellite:get-messages", async (_event, filter) => {
    try {
      if (!satelliteComm) {
        throw new Error("SatelliteComm not initialized");
      }
      const messages = await satelliteComm.getMessages(filter || {});
      return { success: true, messages };
    } catch (error) {
      logger.error("[Satellite IPC] Get messages failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("satellite:sync-signatures", async () => {
    try {
      if (!satelliteComm) {
        throw new Error("SatelliteComm not initialized");
      }
      const result = await satelliteComm.syncSignatures();
      return { success: true, ...result };
    } catch (error) {
      logger.error("[Satellite IPC] Sync signatures failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("satellite:emergency-revoke", async (_event, keyId) => {
    try {
      if (!satelliteComm) {
        throw new Error("SatelliteComm not initialized");
      }
      const result = await satelliteComm.emergencyRevoke(keyId);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[Satellite IPC] Emergency revoke failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("satellite:get-recovery-status", async () => {
    try {
      if (!satelliteComm) {
        throw new Error("SatelliteComm not initialized");
      }
      const status = await satelliteComm.getRecoveryStatus();
      return { success: true, status };
    } catch (error) {
      logger.error("[Satellite IPC] Get recovery status failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("satellite-ipc", CHANNELS);
  }
  logger.info(`[Satellite IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterSatelliteIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* Intentionally empty */
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("satellite-ipc");
  }
  logger.info("[Satellite IPC] All handlers unregistered");
}

export { registerSatelliteIPC, unregisterSatelliteIPC, CHANNELS };
