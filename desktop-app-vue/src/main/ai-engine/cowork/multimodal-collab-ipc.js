/**
 * Multimodal Collaboration IPC Handlers — Multi-Modality Input/Output (v3.2)
 *
 * Registers IPC handlers for multimodal collaboration:
 * Phase A: 6 handlers (fuse-input, parse-document, build-context, get-session, get-supported-modalities, get-config)
 * Phase B: +3 handlers (capture-screen, transcribe-audio, get-artifacts)
 * Phase C: +3 handlers (generate-output, get-stats, configure)
 *
 * @module ai-engine/cowork/multimodal-collab-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const MM_CHANNELS = [
  // Phase A — Document & Image Fusion (6)
  "mm:fuse-input",
  "mm:parse-document",
  "mm:build-context",
  "mm:get-session",
  "mm:get-supported-modalities",
  "mm:get-config",

  // Phase B — Audio & Screen (3)
  "mm:capture-screen",
  "mm:transcribe-audio",
  "mm:get-artifacts",

  // Phase C — Rich Output (3)
  "mm:generate-output",
  "mm:get-stats",
  "mm:configure",
];

/**
 * Register all multimodal collaboration IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.modalityFusion - ModalityFusion instance
 * @param {Object} deps.documentParser - DocumentParser instance
 * @param {Object} deps.multimodalContext - MultimodalContext instance
 * @returns {Object} Registration metadata
 */
function registerMultimodalCollabIPC(deps) {
  const { modalityFusion, documentParser, multimodalContext } = deps;

  // ============================================================
  // Phase A — Document & Image Fusion (6 handlers)
  // ============================================================

  ipcMain.handle("mm:fuse-input", async (_event, options) => {
    try {
      if (!modalityFusion?.initialized) {
        return { success: false, error: "ModalityFusion not initialized" };
      }
      const result = await modalityFusion.fuseInput(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:fuse-input error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:parse-document", async (_event, options) => {
    try {
      if (!documentParser?.initialized) {
        return { success: false, error: "DocumentParser not initialized" };
      }
      const { filePath, ...parseOptions } = options || {};
      if (!filePath) {
        return { success: false, error: "filePath is required" };
      }
      const result = await documentParser.parse(filePath, parseOptions);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:parse-document error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:build-context", async (_event, options) => {
    try {
      if (!multimodalContext?.initialized) {
        return { success: false, error: "MultimodalContext not initialized" };
      }
      const result = await multimodalContext.buildContext(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:build-context error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:get-session", async (_event, options) => {
    try {
      if (!modalityFusion?.initialized) {
        return { success: false, error: "ModalityFusion not initialized" };
      }
      const { sessionId } = options || {};
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      const result = modalityFusion.getSession(sessionId);
      if (!result) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:get-session error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:get-supported-modalities", async () => {
    try {
      if (!modalityFusion?.initialized) {
        return { success: false, error: "ModalityFusion not initialized" };
      }
      const result = modalityFusion.getSupportedModalities();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:get-supported-modalities error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:get-config", async () => {
    try {
      const fusionConfig = modalityFusion?.initialized
        ? modalityFusion.getConfig()
        : null;
      const parserConfig = documentParser?.initialized
        ? documentParser.getConfig()
        : null;
      const contextConfig = multimodalContext?.initialized
        ? multimodalContext.getConfig()
        : null;

      return {
        success: true,
        data: {
          fusion: fusionConfig,
          parser: parserConfig,
          context: contextConfig,
        },
      };
    } catch (error) {
      logger.error("[MMIPC] mm:get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Phase B — Audio & Screen (3 handlers)
  // ============================================================

  ipcMain.handle("mm:capture-screen", async (_event, options) => {
    try {
      // Phase B placeholder — Electron desktopCapturer
      return {
        success: false,
        error: "mm:capture-screen — Phase B implementation pending",
      };
    } catch (error) {
      logger.error("[MMIPC] mm:capture-screen error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:transcribe-audio", async (_event, options) => {
    try {
      // Phase B placeholder — Whisper API
      return {
        success: false,
        error: "mm:transcribe-audio — Phase B implementation pending",
      };
    } catch (error) {
      logger.error("[MMIPC] mm:transcribe-audio error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:get-artifacts", async (_event, options) => {
    try {
      if (!modalityFusion?.initialized) {
        return { success: false, error: "ModalityFusion not initialized" };
      }
      const { sessionId } = options || {};
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      const result = modalityFusion.getArtifacts(sessionId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:get-artifacts error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Phase C — Rich Output (3 handlers)
  // ============================================================

  ipcMain.handle("mm:generate-output", async (_event, options) => {
    try {
      // Phase C placeholder — MultimodalOutput
      return {
        success: false,
        error: "mm:generate-output — Phase C implementation pending",
      };
    } catch (error) {
      logger.error("[MMIPC] mm:generate-output error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:get-stats", async () => {
    try {
      const fusionStats = modalityFusion?.initialized
        ? modalityFusion.getStats()
        : null;
      const parserStats = documentParser?.initialized
        ? documentParser.getStats()
        : null;
      const contextStats = multimodalContext?.initialized
        ? multimodalContext.getStats()
        : null;

      return {
        success: true,
        data: {
          fusion: fusionStats,
          parser: parserStats,
          context: contextStats,
        },
      };
    } catch (error) {
      logger.error("[MMIPC] mm:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("mm:configure", async (_event, options) => {
    try {
      const result = {};
      const { fusion, parser, context } = options || {};

      if (fusion && modalityFusion?.initialized) {
        result.fusion = modalityFusion.configure(fusion);
      }
      if (parser && documentParser?.initialized) {
        result.parser = documentParser.configure(parser);
      }
      if (context && multimodalContext?.initialized) {
        result.context = multimodalContext.configure(context);
      }

      return { success: true, data: result };
    } catch (error) {
      logger.error("[MMIPC] mm:configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[MMIPC] Registered ${MM_CHANNELS.length} handlers`);

  return { handlerCount: MM_CHANNELS.length };
}

/**
 * Unregister all multimodal collaboration IPC handlers
 */
function unregisterMultimodalCollabIPC() {
  for (const channel of MM_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
  }
  logger.info("[MMIPC] Unregistered all handlers");
}

module.exports = {
  registerMultimodalCollabIPC,
  unregisterMultimodalCollabIPC,
  MM_CHANNELS,
};
