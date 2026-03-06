/**
 * Stress Test IPC Handlers
 *
 * 4 IPC handlers for federation stress testing
 *
 * @module ai-engine/cowork/stress-test-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "stress-test:start",
  "stress-test:stop",
  "stress-test:get-runs",
  "stress-test:get-results",
];

function registerStressTestIPC({
  stressTester,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("stress-test-ipc")
  ) {
    logger.info("[Stress Test IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Stress Test IPC] Registering handlers...");

  ipcMain.handle("stress-test:start", async (_event, params) => {
    try {
      if (!stressTester) {
        throw new Error("StressTester not initialized");
      }
      const result = await stressTester.startTest(params || {});
      return { success: true, ...result };
    } catch (error) {
      logger.error("[Stress Test IPC] Start test failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("stress-test:stop", async () => {
    try {
      if (!stressTester) {
        throw new Error("StressTester not initialized");
      }
      const run = await stressTester.stopTest();
      return { success: true, run };
    } catch (error) {
      logger.error("[Stress Test IPC] Stop test failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("stress-test:get-runs", async (_event, filter) => {
    try {
      if (!stressTester) {
        throw new Error("StressTester not initialized");
      }
      const runs = await stressTester.getRuns(filter || {});
      return { success: true, runs };
    } catch (error) {
      logger.error("[Stress Test IPC] Get runs failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("stress-test:get-results", async (_event, runId) => {
    try {
      if (!stressTester) {
        throw new Error("StressTester not initialized");
      }
      const results = await stressTester.getResults(runId);
      return { success: true, results };
    } catch (error) {
      logger.error("[Stress Test IPC] Get results failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("stress-test-ipc", CHANNELS);
  }

  logger.info(`[Stress Test IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterStressTestIPC({
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
    ipcGuard.unregisterModule("stress-test-ipc");
  }
  logger.info("[Stress Test IPC] All handlers unregistered");
}

export { registerStressTestIPC, unregisterStressTestIPC, CHANNELS };
