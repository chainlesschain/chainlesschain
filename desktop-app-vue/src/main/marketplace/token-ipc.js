/**
 * Token Incentive IPC Handlers
 *
 * 5 IPC handlers for token incentive system
 *
 * @module marketplace/token-ipc
 * @version 3.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "token:get-balance",
  "token:get-transactions",
  "token:submit-contribution",
  "token:get-pricing",
  "token:get-rewards-summary",
];

function registerTokenIPC({
  tokenLedger,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (ipcGuard.isModuleRegistered && ipcGuard.isModuleRegistered("token-ipc")) {
    logger.info("[Token IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Token IPC] Registering handlers...");

  ipcMain.handle("token:get-balance", async () => {
    try {
      if (!tokenLedger) {
        throw new Error("TokenLedger not initialized");
      }
      const balance = await tokenLedger.getBalance();
      return { success: true, ...balance };
    } catch (error) {
      logger.error("[Token IPC] Get balance failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("token:get-transactions", async (_event, filter) => {
    try {
      if (!tokenLedger) {
        throw new Error("TokenLedger not initialized");
      }
      const transactions = await tokenLedger.getTransactions(filter || {});
      return { success: true, transactions };
    } catch (error) {
      logger.error("[Token IPC] Get transactions failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("token:submit-contribution", async (_event, params) => {
    try {
      if (!tokenLedger) {
        throw new Error("TokenLedger not initialized");
      }
      const contribution = await tokenLedger.submitContribution(params);
      return { success: true, contribution };
    } catch (error) {
      logger.error("[Token IPC] Submit contribution failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("token:get-pricing", async (_event, params) => {
    try {
      if (!tokenLedger) {
        throw new Error("TokenLedger not initialized");
      }
      const pricing = await tokenLedger.getPricing(params || {});
      return { success: true, pricing };
    } catch (error) {
      logger.error("[Token IPC] Get pricing failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("token:get-rewards-summary", async () => {
    try {
      if (!tokenLedger) {
        throw new Error("TokenLedger not initialized");
      }
      const summary = await tokenLedger.getRewardsSummary();
      return { success: true, summary };
    } catch (error) {
      logger.error("[Token IPC] Get rewards summary failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("token-ipc", CHANNELS);
  }

  logger.info(`[Token IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterTokenIPC({
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
    ipcGuard.unregisterModule("token-ipc");
  }
  logger.info("[Token IPC] All handlers unregistered");
}

export { registerTokenIPC, unregisterTokenIPC, CHANNELS };
