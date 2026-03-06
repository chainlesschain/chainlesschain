/**
 * SLA Manager IPC Handlers
 *
 * 5 IPC handlers for cross-org SLA management
 *
 * @module ai-engine/cowork/sla-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "sla:list-contracts",
  "sla:create-contract",
  "sla:get-violations",
  "sla:check-compliance",
  "sla:get-dashboard",
];

function registerSLAIPC({
  slaManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (ipcGuard.isModuleRegistered && ipcGuard.isModuleRegistered("sla-ipc")) {
    logger.info("[SLA IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[SLA IPC] Registering handlers...");

  ipcMain.handle("sla:list-contracts", async (_event, filter) => {
    try {
      if (!slaManager) {
        throw new Error("SLAManager not initialized");
      }
      const contracts = await slaManager.listContracts(filter || {});
      return { success: true, contracts };
    } catch (error) {
      logger.error("[SLA IPC] List contracts failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("sla:create-contract", async (_event, params) => {
    try {
      if (!slaManager) {
        throw new Error("SLAManager not initialized");
      }
      const contract = await slaManager.createContract(params);
      return { success: true, contract };
    } catch (error) {
      logger.error("[SLA IPC] Create contract failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("sla:get-violations", async (_event, filter) => {
    try {
      if (!slaManager) {
        throw new Error("SLAManager not initialized");
      }
      const violations = await slaManager.getViolations(filter || {});
      return { success: true, violations };
    } catch (error) {
      logger.error("[SLA IPC] Get violations failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("sla:check-compliance", async (_event, contractId) => {
    try {
      if (!slaManager) {
        throw new Error("SLAManager not initialized");
      }
      const result = await slaManager.checkCompliance(contractId);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[SLA IPC] Check compliance failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("sla:get-dashboard", async () => {
    try {
      if (!slaManager) {
        throw new Error("SLAManager not initialized");
      }
      const dashboard = await slaManager.getDashboard();
      return { success: true, dashboard };
    } catch (error) {
      logger.error("[SLA IPC] Get dashboard failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("sla-ipc", CHANNELS);
  }

  logger.info(`[SLA IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterSLAIPC({
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
    ipcGuard.unregisterModule("sla-ipc");
  }
  logger.info("[SLA IPC] All handlers unregistered");
}

export { registerSLAIPC, unregisterSLAIPC, CHANNELS };
