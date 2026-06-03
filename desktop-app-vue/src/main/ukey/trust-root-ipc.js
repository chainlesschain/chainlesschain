/**
 * Trust Root IPC Handlers
 * 5 IPC handlers for Trinity Trust Root
 * @module ukey/trust-root-ipc
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "trust-root:get-status",
  "trust-root:verify-chain",
  "trust-root:sync-keys",
  "trust-root:bind-fingerprint",
  "trust-root:get-boot-status",
];

function registerTrustRootIPC({
  trustRootManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("trust-root-ipc")
  ) {
    logger.info("[TrustRoot IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[TrustRoot IPC] Registering handlers...");

  ipcMain.handle("trust-root:get-status", async () => {
    try {
      if (!trustRootManager) {
        throw new Error("TrustRootManager not initialized");
      }
      const status = await trustRootManager.getStatus();
      return { success: true, status };
    } catch (error) {
      logger.error("[TrustRoot IPC] Get status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("trust-root:verify-chain", async (_event, deviceId) => {
    try {
      if (!trustRootManager) {
        throw new Error("TrustRootManager not initialized");
      }
      const attestation = await trustRootManager.verifyChain(deviceId);
      return { success: true, attestation };
    } catch (error) {
      logger.error("[TrustRoot IPC] Verify chain failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("trust-root:sync-keys", async (_event, params) => {
    try {
      if (!trustRootManager) {
        throw new Error("TrustRootManager not initialized");
      }
      const syncRecord = await trustRootManager.syncKeys(params);
      return { success: true, syncRecord };
    } catch (error) {
      logger.error("[TrustRoot IPC] Sync keys failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "trust-root:bind-fingerprint",
    async (_event, { deviceId, fingerprint }) => {
      try {
        if (!trustRootManager) {
          throw new Error("TrustRootManager not initialized");
        }
        const result = await trustRootManager.bindFingerprint(
          deviceId,
          fingerprint,
        );
        return { success: true, result };
      } catch (error) {
        logger.error("[TrustRoot IPC] Bind fingerprint failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("trust-root:get-boot-status", async () => {
    try {
      if (!trustRootManager) {
        throw new Error("TrustRootManager not initialized");
      }
      const bootStatus = await trustRootManager.getBootStatus();
      return { success: true, bootStatus };
    } catch (error) {
      logger.error("[TrustRoot IPC] Get boot status failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("trust-root-ipc", CHANNELS);
  }
  logger.info(`[TrustRoot IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterTrustRootIPC({
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
    ipcGuard.unregisterModule("trust-root-ipc");
  }
  logger.info("[TrustRoot IPC] All handlers unregistered");
}

export { registerTrustRootIPC, unregisterTrustRootIPC, CHANNELS };
