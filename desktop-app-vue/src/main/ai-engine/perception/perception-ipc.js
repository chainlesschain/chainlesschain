/**
 * @module ai-engine/perception/perception-ipc
 * Phase 84: Perception Engine IPC handlers (8 handlers)
 */
const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

function registerPerceptionIPC(deps) {
  const { perceptionEngine } = deps;

  ipcMain.handle(
    "perception:analyze-screen",
    async (event, { screenshotPath, options }) => {
      try {
        if (!perceptionEngine) {
          return { success: false, error: "PerceptionEngine not available" };
        }
        const result = await perceptionEngine.analyzeScreen(
          screenshotPath,
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[PerceptionIPC] analyze-screen error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "perception:start-voice",
    async (event, { sessionId, options }) => {
      try {
        if (!perceptionEngine) {
          return { success: false, error: "PerceptionEngine not available" };
        }
        const result = await perceptionEngine.startVoice(
          sessionId,
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[PerceptionIPC] start-voice error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("perception:stop-voice", async (event, sessionId) => {
    try {
      if (!perceptionEngine) {
        return { success: false, error: "PerceptionEngine not available" };
      }
      const result = await perceptionEngine.stopVoice(sessionId);
      if (!result) {
        return { success: false, error: "Voice session not found" };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PerceptionIPC] stop-voice error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "perception:parse-document",
    async (event, { filePath, options }) => {
      try {
        if (!perceptionEngine) {
          return { success: false, error: "PerceptionEngine not available" };
        }
        const result = await perceptionEngine.parseDocument(
          filePath,
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[PerceptionIPC] parse-document error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "perception:analyze-video",
    async (event, { videoPath, options }) => {
      try {
        if (!perceptionEngine) {
          return { success: false, error: "PerceptionEngine not available" };
        }
        const result = await perceptionEngine.analyzeVideo(
          videoPath,
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[PerceptionIPC] analyze-video error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "perception:cross-modal-query",
    async (event, { query, modalities }) => {
      try {
        if (!perceptionEngine) {
          return { success: false, error: "PerceptionEngine not available" };
        }
        const results = await perceptionEngine.crossModalQuery(
          query,
          modalities || [],
        );
        return { success: true, data: results };
      } catch (error) {
        logger.error("[PerceptionIPC] cross-modal-query error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("perception:get-context", async (event, modality) => {
    try {
      if (!perceptionEngine) {
        return { success: false, error: "PerceptionEngine not available" };
      }
      return { success: true, data: perceptionEngine.getContext(modality) };
    } catch (error) {
      logger.error("[PerceptionIPC] get-context error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("perception:configure", async (event, config) => {
    try {
      if (!perceptionEngine) {
        return { success: false, error: "PerceptionEngine not available" };
      }
      const result = perceptionEngine.configure(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PerceptionIPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[PerceptionIPC] Registered 8 perception handlers");
}

module.exports = { registerPerceptionIPC };
