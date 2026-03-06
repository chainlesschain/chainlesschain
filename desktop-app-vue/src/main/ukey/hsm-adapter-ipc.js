/**
 * HSM Adapter IPC Handlers
 * 4 IPC handlers
 * @module ukey/hsm-adapter-ipc
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "hsm:list-adapters",
  "hsm:connect-device",
  "hsm:execute-operation",
  "hsm:get-compliance-status",
];

function registerHsmAdapterIPC({
  hsmAdapterManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("hsm-adapter-ipc")
  ) {
    logger.info("[HSMAdapter IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[HSMAdapter IPC] Registering handlers...");

  ipcMain.handle("hsm:list-adapters", async (_event, filter) => {
    try {
      if (!hsmAdapterManager) {
        throw new Error("HsmAdapterManager not initialized");
      }
      const adapters = await hsmAdapterManager.listAdapters(filter || {});
      return { success: true, adapters };
    } catch (error) {
      logger.error("[HSMAdapter IPC] List adapters failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:connect-device", async (_event, params) => {
    try {
      if (!hsmAdapterManager) {
        throw new Error("HsmAdapterManager not initialized");
      }
      const adapter = await hsmAdapterManager.connectDevice(params);
      return { success: true, adapter };
    } catch (error) {
      logger.error("[HSMAdapter IPC] Connect device failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:execute-operation", async (_event, params) => {
    try {
      if (!hsmAdapterManager) {
        throw new Error("HsmAdapterManager not initialized");
      }
      const result = await hsmAdapterManager.executeOperation(params);
      return { success: true, result };
    } catch (error) {
      logger.error("[HSMAdapter IPC] Execute operation failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hsm:get-compliance-status", async () => {
    try {
      if (!hsmAdapterManager) {
        throw new Error("HsmAdapterManager not initialized");
      }
      const status = await hsmAdapterManager.getComplianceStatus();
      return { success: true, status };
    } catch (error) {
      logger.error("[HSMAdapter IPC] Get compliance status failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("hsm-adapter-ipc", CHANNELS);
  }
  logger.info(`[HSMAdapter IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterHsmAdapterIPC({
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
    ipcGuard.unregisterModule("hsm-adapter-ipc");
  }
  logger.info("[HSMAdapter IPC] All handlers unregistered");
}

export { registerHsmAdapterIPC, unregisterHsmAdapterIPC, CHANNELS };
