/**
 * Collaboration Governance IPC Handlers
 *
 * 5 IPC handlers for human-AI collaboration governance
 *
 * @module ai-engine/autonomous/collaboration-governance-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "collab-governance:get-pending",
  "collab-governance:approve-decision",
  "collab-governance:reject-decision",
  "collab-governance:get-autonomy-level",
  "collab-governance:set-autonomy-policy",
];

function registerCollaborationGovernanceIPC({
  collaborationGovernance,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("collab-governance-ipc")
  ) {
    logger.info(
      "[Collab Governance IPC] Module already registered, skipping...",
    );
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Collab Governance IPC] Registering handlers...");

  ipcMain.handle("collab-governance:get-pending", async (_event, filter) => {
    try {
      if (!collaborationGovernance) {
        throw new Error("CollaborationGovernance not initialized");
      }
      const decisions = await collaborationGovernance.getPendingDecisions(
        filter || {},
      );
      return { success: true, decisions };
    } catch (error) {
      logger.error("[Collab Governance IPC] Get pending failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "collab-governance:approve-decision",
    async (_event, params) => {
      try {
        if (!collaborationGovernance) {
          throw new Error("CollaborationGovernance not initialized");
        }
        const decision = await collaborationGovernance.approveDecision(params);
        return { success: true, decision };
      } catch (error) {
        logger.error("[Collab Governance IPC] Approve decision failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "collab-governance:reject-decision",
    async (_event, params) => {
      try {
        if (!collaborationGovernance) {
          throw new Error("CollaborationGovernance not initialized");
        }
        const decision = await collaborationGovernance.rejectDecision(params);
        return { success: true, decision };
      } catch (error) {
        logger.error("[Collab Governance IPC] Reject decision failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "collab-governance:get-autonomy-level",
    async (_event, scope) => {
      try {
        if (!collaborationGovernance) {
          throw new Error("CollaborationGovernance not initialized");
        }
        const level = await collaborationGovernance.getAutonomyLevel(scope);
        return { success: true, level };
      } catch (error) {
        logger.error(
          "[Collab Governance IPC] Get autonomy level failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "collab-governance:set-autonomy-policy",
    async (_event, params) => {
      try {
        if (!collaborationGovernance) {
          throw new Error("CollaborationGovernance not initialized");
        }
        const policy = await collaborationGovernance.setAutonomyPolicy(params);
        return { success: true, policy };
      } catch (error) {
        logger.error(
          "[Collab Governance IPC] Set autonomy policy failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("collab-governance-ipc", CHANNELS);
  }

  logger.info(`[Collab Governance IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterCollaborationGovernanceIPC({
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
    ipcGuard.unregisterModule("collab-governance-ipc");
  }
  logger.info("[Collab Governance IPC] All handlers unregistered");
}

export {
  registerCollaborationGovernanceIPC,
  unregisterCollaborationGovernanceIPC,
  CHANNELS,
};
