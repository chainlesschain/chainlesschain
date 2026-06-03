/**
 * AI Social Enhancement IPC Handlers
 * 5 IPC handlers
 * @module social/ai-social-ipc
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "ai-social:translate-message",
  "ai-social:detect-language",
  "ai-social:assess-quality",
  "ai-social:get-quality-report",
  "ai-social:get-translation-stats",
];

function registerAISocialIPC({
  realtimeTranslator,
  contentQualityAssessor,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("ai-social-enhancement-ipc")
  ) {
    logger.info("[AISocial IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[AISocial IPC] Registering handlers...");

  ipcMain.handle("ai-social:translate-message", async (_event, params) => {
    try {
      if (!realtimeTranslator) {
        throw new Error("RealtimeTranslator not initialized");
      }
      const result = await realtimeTranslator.translateMessage(params);
      return { success: true, result };
    } catch (error) {
      logger.error("[AISocial IPC] Translate failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ai-social:detect-language", async (_event, text) => {
    try {
      if (!realtimeTranslator) {
        throw new Error("RealtimeTranslator not initialized");
      }
      const result = await realtimeTranslator.detectLanguage(text);
      return { success: true, ...result };
    } catch (error) {
      logger.error("[AISocial IPC] Detect language failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ai-social:assess-quality", async (_event, params) => {
    try {
      if (!contentQualityAssessor) {
        throw new Error("ContentQualityAssessor not initialized");
      }
      const assessment = await contentQualityAssessor.assessQuality(params);
      return { success: true, assessment };
    } catch (error) {
      logger.error("[AISocial IPC] Assess quality failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ai-social:get-quality-report", async (_event, filter) => {
    try {
      if (!contentQualityAssessor) {
        throw new Error("ContentQualityAssessor not initialized");
      }
      const report = await contentQualityAssessor.getQualityReport(
        filter || {},
      );
      return { success: true, report };
    } catch (error) {
      logger.error("[AISocial IPC] Get quality report failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ai-social:get-translation-stats", async () => {
    try {
      if (!realtimeTranslator) {
        throw new Error("RealtimeTranslator not initialized");
      }
      const stats = await realtimeTranslator.getTranslationStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("[AISocial IPC] Get translation stats failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("ai-social-enhancement-ipc", CHANNELS);
  }
  logger.info(`[AISocial IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterAISocialIPC({
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
    ipcGuard.unregisterModule("ai-social-enhancement-ipc");
  }
  logger.info("[AISocial IPC] All handlers unregistered");
}

export { registerAISocialIPC, unregisterAISocialIPC, CHANNELS };
