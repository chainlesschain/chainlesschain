/**
 * Inference Network IPC Handlers
 *
 * 6 IPC handlers for decentralized inference
 *
 * @module ai-engine/inference/inference-ipc
 * @version 3.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "inference:register-node",
  "inference:list-nodes",
  "inference:submit-task",
  "inference:get-task-status",
  "inference:start-federated-round",
  "inference:get-network-stats",
];

function registerInferenceIPC({
  inferenceNodeRegistry,
  inferenceScheduler,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("inference-ipc")
  ) {
    logger.info("[Inference IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Inference IPC] Registering handlers...");

  ipcMain.handle("inference:register-node", async (_event, params) => {
    try {
      if (!inferenceNodeRegistry) {
        throw new Error("InferenceNodeRegistry not initialized");
      }
      const node = await inferenceNodeRegistry.registerNode(params);
      return { success: true, node };
    } catch (error) {
      logger.error("[Inference IPC] Register node failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("inference:list-nodes", async (_event, filter) => {
    try {
      if (!inferenceNodeRegistry) {
        throw new Error("InferenceNodeRegistry not initialized");
      }
      const nodes = await inferenceNodeRegistry.listNodes(filter || {});
      return { success: true, nodes };
    } catch (error) {
      logger.error("[Inference IPC] List nodes failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("inference:submit-task", async (_event, params) => {
    try {
      if (!inferenceScheduler) {
        throw new Error("InferenceScheduler not initialized");
      }
      const task = await inferenceScheduler.submitTask(params);
      return { success: true, task };
    } catch (error) {
      logger.error("[Inference IPC] Submit task failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("inference:get-task-status", async (_event, taskId) => {
    try {
      if (!inferenceScheduler) {
        throw new Error("InferenceScheduler not initialized");
      }
      const task = await inferenceScheduler.getTaskStatus(taskId);
      return { success: true, task };
    } catch (error) {
      logger.error("[Inference IPC] Get task status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("inference:start-federated-round", async (_event, params) => {
    try {
      if (!inferenceScheduler) {
        throw new Error("InferenceScheduler not initialized");
      }
      const round = await inferenceScheduler.startFederatedRound(params);
      return { success: true, round };
    } catch (error) {
      logger.error("[Inference IPC] Start federated round failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("inference:get-network-stats", async () => {
    try {
      const nodeStats = inferenceNodeRegistry
        ? await inferenceNodeRegistry.getNetworkStats()
        : {};
      const taskStats = inferenceScheduler
        ? await inferenceScheduler.getNetworkStats()
        : {};
      return { success: true, ...nodeStats, ...taskStats };
    } catch (error) {
      logger.error("[Inference IPC] Get network stats failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("inference-ipc", CHANNELS);
  }

  logger.info(`[Inference IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterInferenceIPC({
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
    ipcGuard.unregisterModule("inference-ipc");
  }
  logger.info("[Inference IPC] All handlers unregistered");
}

export { registerInferenceIPC, unregisterInferenceIPC, CHANNELS };
