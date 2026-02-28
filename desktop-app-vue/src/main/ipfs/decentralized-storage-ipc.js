/**
 * Decentralized Storage IPC Handlers
 * 5 IPC handlers
 * @module ipfs/decentralized-storage-ipc
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "dstorage:store-to-filecoin",
  "dstorage:get-deal-status",
  "dstorage:distribute-content",
  "dstorage:get-version-history",
  "dstorage:get-storage-stats",
];

function registerDecentralizedStorageIPC({
  filecoinStorage,
  contentDistributor,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("dstorage-ipc")
  ) {
    logger.info("[DStorage IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[DStorage IPC] Registering handlers...");

  ipcMain.handle("dstorage:store-to-filecoin", async (_event, params) => {
    try {
      if (!filecoinStorage) {
        throw new Error("FilecoinStorage not initialized");
      }
      const deal = await filecoinStorage.storeToFilecoin(params);
      return { success: true, deal };
    } catch (error) {
      logger.error("[DStorage IPC] Store to Filecoin failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dstorage:get-deal-status", async (_event, dealId) => {
    try {
      if (!filecoinStorage) {
        throw new Error("FilecoinStorage not initialized");
      }
      const deal = await filecoinStorage.getDealStatus(dealId);
      return { success: true, deal };
    } catch (error) {
      logger.error("[DStorage IPC] Get deal status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dstorage:distribute-content", async (_event, params) => {
    try {
      if (!contentDistributor) {
        throw new Error("ContentDistributor not initialized");
      }
      const result = await contentDistributor.distributeContent(params);
      return { success: true, result };
    } catch (error) {
      logger.error("[DStorage IPC] Distribute content failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dstorage:get-version-history", async (_event, cid) => {
    try {
      if (!contentDistributor) {
        throw new Error("ContentDistributor not initialized");
      }
      const versions = await contentDistributor.getVersionHistory(cid);
      return { success: true, versions };
    } catch (error) {
      logger.error("[DStorage IPC] Get version history failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dstorage:get-storage-stats", async () => {
    try {
      if (!filecoinStorage) {
        throw new Error("FilecoinStorage not initialized");
      }
      const stats = await filecoinStorage.getStorageStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[DStorage IPC] Get storage stats failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("dstorage-ipc", CHANNELS);
  }
  logger.info(`[DStorage IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterDecentralizedStorageIPC({
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
    ipcGuard.unregisterModule("dstorage-ipc");
  }
  logger.info("[DStorage IPC] All handlers unregistered");
}

export {
  registerDecentralizedStorageIPC,
  unregisterDecentralizedStorageIPC,
  CHANNELS,
};
