/**
 * Governance AI IPC Handlers
 *
 * 4 IPC handlers for AI community governance:
 * - List governance proposals
 * - Create governance proposal
 * - Analyze proposal impact
 * - Predict voting outcome
 *
 * @module social/governance-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "governance:list-proposals",
  "governance:create-proposal",
  "governance:analyze-impact",
  "governance:predict-vote",
];

/**
 * Register all Governance AI IPC handlers.
 * @param {Object} dependencies
 * @param {Object} dependencies.governanceAI - GovernanceAI instance
 * @param {Object} [dependencies.ipcMain] - IPC main (injectable for tests)
 * @param {Object} [dependencies.ipcGuard] - IPC guard (injectable for tests)
 * @returns {Object} { handlerCount }
 */
function registerGovernanceIPC({
  governanceAI,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("governance-ipc")
  ) {
    logger.info("[Governance IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Governance IPC] Registering Governance AI IPC handlers...");

  ipcMain.handle("governance:list-proposals", async (_event, filter) => {
    try {
      if (!governanceAI) {
        throw new Error("Governance AI not initialized");
      }
      const proposals = await governanceAI.listProposals(filter || {});
      return { success: true, proposals };
    } catch (error) {
      logger.error("[Governance IPC] List proposals failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("governance:create-proposal", async (_event, params) => {
    try {
      if (!governanceAI) {
        throw new Error("Governance AI not initialized");
      }
      const proposal = await governanceAI.createProposal(params);
      return { success: true, proposal };
    } catch (error) {
      logger.error("[Governance IPC] Create proposal failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("governance:analyze-impact", async (_event, params) => {
    try {
      if (!governanceAI) {
        throw new Error("Governance AI not initialized");
      }
      const analysis = await governanceAI.analyzeImpact(params);
      return { success: true, analysis };
    } catch (error) {
      logger.error("[Governance IPC] Analyze impact failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("governance:predict-vote", async (_event, params) => {
    try {
      if (!governanceAI) {
        throw new Error("Governance AI not initialized");
      }
      const prediction = await governanceAI.predictVote(params);
      return { success: true, prediction };
    } catch (error) {
      logger.error("[Governance IPC] Predict vote failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("governance-ipc", CHANNELS);
  }

  logger.info(
    `[Governance IPC] Registered ${CHANNELS.length} Governance AI IPC handlers`,
  );
  return { handlerCount: CHANNELS.length };
}

function unregisterGovernanceIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Intentionally empty - handler may not exist
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("governance-ipc");
  }
  logger.info("[Governance IPC] All handlers unregistered");
}

export { registerGovernanceIPC, unregisterGovernanceIPC, CHANNELS };
