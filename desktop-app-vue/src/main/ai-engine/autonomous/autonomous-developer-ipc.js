/**
 * Autonomous Developer IPC Handlers
 *
 * 5 IPC handlers for autonomous development
 *
 * @module ai-engine/autonomous/autonomous-developer-ipc
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../../ipc/ipc-guard.js";

const CHANNELS = [
  "autonomous-dev:start-session",
  "autonomous-dev:refine",
  "autonomous-dev:generate",
  "autonomous-dev:review",
  "autonomous-dev:list-sessions",
];

function registerAutonomousDevIPC({
  autonomousDeveloper,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("autonomous-dev-ipc")
  ) {
    logger.info("[Autonomous Dev IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Autonomous Dev IPC] Registering handlers...");

  ipcMain.handle("autonomous-dev:start-session", async (_event, params) => {
    try {
      if (!autonomousDeveloper) {
        throw new Error("AutonomousDeveloper not initialized");
      }
      const session = await autonomousDeveloper.startSession(params);
      return { success: true, session };
    } catch (error) {
      logger.error("[Autonomous Dev IPC] Start session failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("autonomous-dev:refine", async (_event, params) => {
    try {
      if (!autonomousDeveloper) {
        throw new Error("AutonomousDeveloper not initialized");
      }
      const session = await autonomousDeveloper.refineSession(params);
      return { success: true, session };
    } catch (error) {
      logger.error("[Autonomous Dev IPC] Refine session failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("autonomous-dev:generate", async (_event, params) => {
    try {
      if (!autonomousDeveloper) {
        throw new Error("AutonomousDeveloper not initialized");
      }
      const session = await autonomousDeveloper.generateCode(params);
      return { success: true, session };
    } catch (error) {
      logger.error("[Autonomous Dev IPC] Generate code failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("autonomous-dev:review", async (_event, params) => {
    try {
      if (!autonomousDeveloper) {
        throw new Error("AutonomousDeveloper not initialized");
      }
      const review = await autonomousDeveloper.reviewCode(params);
      return { success: true, review };
    } catch (error) {
      logger.error("[Autonomous Dev IPC] Review code failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("autonomous-dev:list-sessions", async (_event, filter) => {
    try {
      if (!autonomousDeveloper) {
        throw new Error("AutonomousDeveloper not initialized");
      }
      const sessions = await autonomousDeveloper.listSessions(filter || {});
      return { success: true, sessions };
    } catch (error) {
      logger.error("[Autonomous Dev IPC] List sessions failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("autonomous-dev-ipc", CHANNELS);
  }

  logger.info(`[Autonomous Dev IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterAutonomousDevIPC({
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
    ipcGuard.unregisterModule("autonomous-dev-ipc");
  }
  logger.info("[Autonomous Dev IPC] All handlers unregistered");
}

export { registerAutonomousDevIPC, unregisterAutonomousDevIPC, CHANNELS };
