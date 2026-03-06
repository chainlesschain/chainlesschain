/**
 * EvoMap Governance IPC Handlers
 * 5 IPC handlers for IP & Governance DAO
 * @module evomap/evomap-governance-ipc
 * @version 3.4.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "evomap-gov:register-ownership",
  "evomap-gov:trace-contributions",
  "evomap-gov:create-proposal",
  "evomap-gov:cast-vote",
  "evomap-gov:get-governance-dashboard",
];

function registerEvoMapGovernanceIPC({
  geneIPManager,
  evoMapDAO,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("evomap-governance-ipc")
  ) {
    logger.info(
      "[EvoMapGovernance IPC] Module already registered, skipping...",
    );
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[EvoMapGovernance IPC] Registering handlers...");

  ipcMain.handle("evomap-gov:register-ownership", async (_event, params) => {
    try {
      if (!geneIPManager) {
        throw new Error("GeneIPManager not initialized");
      }
      const ownership = await geneIPManager.registerOwnership(params);
      return { success: true, ownership };
    } catch (error) {
      logger.error("[EvoMapGovernance IPC] Register ownership failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap-gov:trace-contributions", async (_event, geneId) => {
    try {
      if (!geneIPManager) {
        throw new Error("GeneIPManager not initialized");
      }
      const result = await geneIPManager.traceContributions(geneId);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[EvoMapGovernance IPC] Trace contributions failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap-gov:create-proposal", async (_event, params) => {
    try {
      if (!evoMapDAO) {
        throw new Error("EvoMapDAO not initialized");
      }
      const proposal = await evoMapDAO.createProposal(params);
      return { success: true, proposal };
    } catch (error) {
      logger.error("[EvoMapGovernance IPC] Create proposal failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap-gov:cast-vote", async (_event, params) => {
    try {
      if (!evoMapDAO) {
        throw new Error("EvoMapDAO not initialized");
      }
      const result = await evoMapDAO.castVote(params);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[EvoMapGovernance IPC] Cast vote failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap-gov:get-governance-dashboard", async () => {
    try {
      const ipStats = geneIPManager
        ? { ownerships: geneIPManager._ownerships.size }
        : {};
      const govStats = evoMapDAO
        ? await evoMapDAO.getGovernanceDashboard()
        : {};
      return { success: true, ...ipStats, ...govStats };
    } catch (error) {
      logger.error("[EvoMapGovernance IPC] Get dashboard failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("evomap-governance-ipc", CHANNELS);
  }
  logger.info(`[EvoMapGovernance IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterEvoMapGovernanceIPC({
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
    ipcGuard.unregisterModule("evomap-governance-ipc");
  }
  logger.info("[EvoMapGovernance IPC] All handlers unregistered");
}

export { registerEvoMapGovernanceIPC, unregisterEvoMapGovernanceIPC, CHANNELS };
