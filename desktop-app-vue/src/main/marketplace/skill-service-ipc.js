/**
 * Skill Service IPC Handlers
 *
 * 5 IPC handlers for skill-as-a-service
 *
 * @module marketplace/skill-service-ipc
 * @version 3.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "skill-service:list-skills",
  "skill-service:publish-skill",
  "skill-service:invoke-remote",
  "skill-service:get-versions",
  "skill-service:compose-pipeline",
];

function registerSkillServiceIPC({
  skillServiceProtocol,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("skill-service-ipc")
  ) {
    logger.info("[SkillService IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[SkillService IPC] Registering handlers...");

  ipcMain.handle("skill-service:list-skills", async (_event, filter) => {
    try {
      if (!skillServiceProtocol) {
        throw new Error("SkillServiceProtocol not initialized");
      }
      const skills = await skillServiceProtocol.listSkills(filter || {});
      return { success: true, skills };
    } catch (error) {
      logger.error("[SkillService IPC] List skills failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-service:publish-skill", async (_event, params) => {
    try {
      if (!skillServiceProtocol) {
        throw new Error("SkillServiceProtocol not initialized");
      }
      const skill = await skillServiceProtocol.publishSkill(params);
      return { success: true, skill };
    } catch (error) {
      logger.error("[SkillService IPC] Publish skill failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-service:invoke-remote", async (_event, params) => {
    try {
      if (!skillServiceProtocol) {
        throw new Error("SkillServiceProtocol not initialized");
      }
      const result = await skillServiceProtocol.invokeRemote(params);
      return { success: true, result };
    } catch (error) {
      logger.error("[SkillService IPC] Invoke remote failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-service:get-versions", async (_event, skillName) => {
    try {
      if (!skillServiceProtocol) {
        throw new Error("SkillServiceProtocol not initialized");
      }
      const versions = await skillServiceProtocol.getVersions(skillName);
      return { success: true, versions };
    } catch (error) {
      logger.error("[SkillService IPC] Get versions failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-service:compose-pipeline", async (_event, params) => {
    try {
      if (!skillServiceProtocol) {
        throw new Error("SkillServiceProtocol not initialized");
      }
      const pipeline = await skillServiceProtocol.composePipeline(params);
      return { success: true, pipeline };
    } catch (error) {
      logger.error("[SkillService IPC] Compose pipeline failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("skill-service-ipc", CHANNELS);
  }

  logger.info(`[SkillService IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterSkillServiceIPC({
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
    ipcGuard.unregisterModule("skill-service-ipc");
  }
  logger.info("[SkillService IPC] All handlers unregistered");
}

export { registerSkillServiceIPC, unregisterSkillServiceIPC, CHANNELS };
