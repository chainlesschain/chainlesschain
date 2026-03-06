/**
 * Tech Learning IPC Handlers
 *
 * 5 IPC handlers for tech learning engine
 *
 * @module ai-engine/autonomous/tech-learning-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "tech-learning:detect-stack",
  "tech-learning:get-profiles",
  "tech-learning:extract-practices",
  "tech-learning:get-practices",
  "tech-learning:synthesize-skill",
];

function registerTechLearningIPC({
  techLearningEngine,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("tech-learning-ipc")
  ) {
    logger.info("[Tech Learning IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Tech Learning IPC] Registering handlers...");

  ipcMain.handle("tech-learning:detect-stack", async (_event, params) => {
    try {
      if (!techLearningEngine) {
        throw new Error("TechLearningEngine not initialized");
      }
      const profile = await techLearningEngine.detectStack(params);
      return { success: true, profile };
    } catch (error) {
      logger.error("[Tech Learning IPC] Detect stack failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("tech-learning:get-profiles", async (_event, filter) => {
    try {
      if (!techLearningEngine) {
        throw new Error("TechLearningEngine not initialized");
      }
      const profiles = await techLearningEngine.getProfiles(filter || {});
      return { success: true, profiles };
    } catch (error) {
      logger.error("[Tech Learning IPC] Get profiles failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("tech-learning:extract-practices", async (_event, params) => {
    try {
      if (!techLearningEngine) {
        throw new Error("TechLearningEngine not initialized");
      }
      const practices = await techLearningEngine.extractPractices(params);
      return { success: true, practices };
    } catch (error) {
      logger.error("[Tech Learning IPC] Extract practices failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("tech-learning:get-practices", async (_event, filter) => {
    try {
      if (!techLearningEngine) {
        throw new Error("TechLearningEngine not initialized");
      }
      const practices = await techLearningEngine.getPractices(filter || {});
      return { success: true, practices };
    } catch (error) {
      logger.error("[Tech Learning IPC] Get practices failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("tech-learning:synthesize-skill", async (_event, params) => {
    try {
      if (!techLearningEngine) {
        throw new Error("TechLearningEngine not initialized");
      }
      const skill = await techLearningEngine.synthesizeSkill(params);
      return { success: true, skill };
    } catch (error) {
      logger.error("[Tech Learning IPC] Synthesize skill failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("tech-learning-ipc", CHANNELS);
  }

  logger.info(`[Tech Learning IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterTechLearningIPC({
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
    ipcGuard.unregisterModule("tech-learning-ipc");
  }
  logger.info("[Tech Learning IPC] All handlers unregistered");
}

export { registerTechLearningIPC, unregisterTechLearningIPC, CHANNELS };
