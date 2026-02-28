/**
 * Reputation Optimizer IPC Handlers
 *
 * 4 IPC handlers for reputation optimization
 *
 * @module ai-engine/cowork/reputation-optimizer-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "reputation-optimizer:run-optimization",
  "reputation-optimizer:get-analytics",
  "reputation-optimizer:detect-anomalies",
  "reputation-optimizer:get-history",
];

function registerReputationOptimizerIPC({
  reputationOptimizer,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("reputation-optimizer-ipc")
  ) {
    logger.info(
      "[Reputation Optimizer IPC] Module already registered, skipping...",
    );
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Reputation Optimizer IPC] Registering handlers...");

  ipcMain.handle(
    "reputation-optimizer:run-optimization",
    async (_event, params) => {
      try {
        if (!reputationOptimizer) {
          throw new Error("ReputationOptimizer not initialized");
        }
        const result = await reputationOptimizer.runOptimization(params || {});
        return { success: true, result };
      } catch (error) {
        logger.error(
          "[Reputation Optimizer IPC] Run optimization failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "reputation-optimizer:get-analytics",
    async (_event, filter) => {
      try {
        if (!reputationOptimizer) {
          throw new Error("ReputationOptimizer not initialized");
        }
        const analytics = await reputationOptimizer.getAnalytics(filter || {});
        return { success: true, analytics };
      } catch (error) {
        logger.error("[Reputation Optimizer IPC] Get analytics failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "reputation-optimizer:detect-anomalies",
    async (_event, params) => {
      try {
        if (!reputationOptimizer) {
          throw new Error("ReputationOptimizer not initialized");
        }
        const result = await reputationOptimizer.detectAnomalies(params || {});
        return { success: true, ...result };
      } catch (error) {
        logger.error(
          "[Reputation Optimizer IPC] Detect anomalies failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("reputation-optimizer:get-history", async (_event, filter) => {
    try {
      if (!reputationOptimizer) {
        throw new Error("ReputationOptimizer not initialized");
      }
      const history = await reputationOptimizer.getHistory(filter || {});
      return { success: true, history };
    } catch (error) {
      logger.error("[Reputation Optimizer IPC] Get history failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("reputation-optimizer-ipc", CHANNELS);
  }

  logger.info(
    `[Reputation Optimizer IPC] Registered ${CHANNELS.length} handlers`,
  );
  return { handlerCount: CHANNELS.length };
}

function unregisterReputationOptimizerIPC({
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
    ipcGuard.unregisterModule("reputation-optimizer-ipc");
  }
  logger.info("[Reputation Optimizer IPC] All handlers unregistered");
}

export {
  registerReputationOptimizerIPC,
  unregisterReputationOptimizerIPC,
  CHANNELS,
};
