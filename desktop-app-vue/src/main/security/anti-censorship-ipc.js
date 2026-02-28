/**
 * Anti-Censorship IPC Handlers
 * 5 IPC handlers
 * @module security/anti-censorship-ipc
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "anti-censorship:start-tor",
  "anti-censorship:get-tor-status",
  "anti-censorship:enable-domain-fronting",
  "anti-censorship:start-mesh",
  "anti-censorship:get-connectivity-report",
];

function registerAntiCensorshipIPC({
  antiCensorshipManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("anti-censorship-ipc")
  ) {
    logger.info("[AntiCensorship IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[AntiCensorship IPC] Registering handlers...");

  ipcMain.handle("anti-censorship:start-tor", async () => {
    try {
      if (!antiCensorshipManager) {
        throw new Error("AntiCensorshipManager not initialized");
      }
      const status = await antiCensorshipManager.startTor();
      return { success: true, status };
    } catch (error) {
      logger.error("[AntiCensorship IPC] Start Tor failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("anti-censorship:get-tor-status", async () => {
    try {
      if (!antiCensorshipManager) {
        throw new Error("AntiCensorshipManager not initialized");
      }
      const status = await antiCensorshipManager.getTorStatus();
      return { success: true, status };
    } catch (error) {
      logger.error("[AntiCensorship IPC] Get Tor status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "anti-censorship:enable-domain-fronting",
    async (_event, params) => {
      try {
        if (!antiCensorshipManager) {
          throw new Error("AntiCensorshipManager not initialized");
        }
        const result = await antiCensorshipManager.enableDomainFronting(
          params || {},
        );
        return { success: true, result };
      } catch (error) {
        logger.error(
          "[AntiCensorship IPC] Enable domain fronting failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("anti-censorship:start-mesh", async () => {
    try {
      if (!antiCensorshipManager) {
        throw new Error("AntiCensorshipManager not initialized");
      }
      const result = await antiCensorshipManager.startMesh();
      return { success: true, result };
    } catch (error) {
      logger.error("[AntiCensorship IPC] Start mesh failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("anti-censorship:get-connectivity-report", async () => {
    try {
      if (!antiCensorshipManager) {
        throw new Error("AntiCensorshipManager not initialized");
      }
      const report = await antiCensorshipManager.getConnectivityReport();
      return { success: true, report };
    } catch (error) {
      logger.error(
        "[AntiCensorship IPC] Get connectivity report failed:",
        error,
      );
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("anti-censorship-ipc", CHANNELS);
  }
  logger.info(`[AntiCensorship IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterAntiCensorshipIPC({
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
    ipcGuard.unregisterModule("anti-censorship-ipc");
  }
  logger.info("[AntiCensorship IPC] All handlers unregistered");
}

export { registerAntiCensorshipIPC, unregisterAntiCensorshipIPC, CHANNELS };
