/**
 * Federation Hardening IPC Handlers
 *
 * 4 IPC handlers for federation hardening management
 *
 * @module ai-engine/cowork/federation-hardening-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "federation-hardening:get-status",
  "federation-hardening:get-circuit-breakers",
  "federation-hardening:reset-circuit",
  "federation-hardening:run-health-check",
];

function registerFederationHardeningIPC({
  federationHardening,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("federation-hardening-ipc")
  ) {
    logger.info(
      "[Federation Hardening IPC] Module already registered, skipping...",
    );
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Federation Hardening IPC] Registering handlers...");

  ipcMain.handle("federation-hardening:get-status", async () => {
    try {
      if (!federationHardening) {
        throw new Error("FederationHardening not initialized");
      }
      const status = await federationHardening.getStatus();
      return { success: true, status };
    } catch (error) {
      logger.error("[Federation Hardening IPC] Get status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("federation-hardening:get-circuit-breakers", async () => {
    try {
      if (!federationHardening) {
        throw new Error("FederationHardening not initialized");
      }
      const breakers = await federationHardening.getCircuitBreakers();
      return { success: true, breakers };
    } catch (error) {
      logger.error(
        "[Federation Hardening IPC] Get circuit breakers failed:",
        error,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "federation-hardening:reset-circuit",
    async (_event, nodeId) => {
      try {
        if (!federationHardening) {
          throw new Error("FederationHardening not initialized");
        }
        const result = await federationHardening.resetCircuit(nodeId);
        return { success: true, result };
      } catch (error) {
        logger.error("[Federation Hardening IPC] Reset circuit failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "federation-hardening:run-health-check",
    async (_event, nodeId) => {
      try {
        if (!federationHardening) {
          throw new Error("FederationHardening not initialized");
        }
        const check = await federationHardening.runHealthCheck(nodeId);
        return { success: true, check };
      } catch (error) {
        logger.error(
          "[Federation Hardening IPC] Run health check failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("federation-hardening-ipc", CHANNELS);
  }

  logger.info(
    `[Federation Hardening IPC] Registered ${CHANNELS.length} handlers`,
  );
  return { handlerCount: CHANNELS.length };
}

function unregisterFederationHardeningIPC({
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
    ipcGuard.unregisterModule("federation-hardening-ipc");
  }
  logger.info("[Federation Hardening IPC] All handlers unregistered");
}

export {
  registerFederationHardeningIPC,
  unregisterFederationHardeningIPC,
  CHANNELS,
};
