/**
 * Whisper STT IPC Handlers
 *
 * Provides IPC interface for Whisper speech-to-text:
 * - File transcription (local + API)
 * - Real-time streaming transcription
 * - Model management (list, download)
 * - Voice chat pipeline (STT -> LLM -> TTS)
 *
 * @module whisper-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * Register Whisper IPC handlers
 * @param {Object} options - Options
 * @param {WhisperClient} options.whisperClient - Whisper client instance
 * @param {Object} [options.llmManager] - LLM manager instance for voice chat
 * @param {Object} [options.ttsManager] - TTS manager instance for voice chat
 * @returns {Object} Handler update functions
 */
function registerWhisperIPC(options = {}) {
  const { whisperClient, llmManager, ttsManager } = options;

  let currentClient = whisperClient;
  let currentLlmManager = llmManager || null;
  let currentTtsManager = ttsManager || null;

  logger.info("[WhisperIPC] Registering Whisper IPC handlers...");

  // ============================================================
  // Transcription (1 handler)
  // ============================================================

  /**
   * Transcribe an audio file using Whisper
   */
  ipcMain.handle(
    "speech:whisper-transcribe",
    async (event, { audioPath, options }) => {
      try {
        if (!currentClient) {
          return { success: false, error: "Whisper client not initialized" };
        }

        const result = await currentClient.transcribe(audioPath, options || {});
        return { success: true, data: result };
      } catch (error) {
        logger.error("[WhisperIPC] Transcription failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Streaming (2 handlers)
  // ============================================================

  /**
   * Start real-time streaming transcription
   */
  ipcMain.handle(
    "speech:whisper-stream-start",
    async (event, { options }) => {
      try {
        if (!currentClient) {
          return { success: false, error: "Whisper client not initialized" };
        }

        // Forward transcript events to the renderer
        const transcriptHandler = (data) => {
          try {
            event.sender.send("speech:whisper-transcript", data);
          } catch (sendErr) {
            // Window may have been closed
            logger.debug(
              "[WhisperIPC] Failed to send transcript event:",
              sendErr.message,
            );
          }
        };

        currentClient.on("transcript", transcriptHandler);

        const streamId = await currentClient.startStream(options || {});

        // Clean up listener when stream ends
        const cleanupHandler = (endData) => {
          if (endData.streamId === streamId) {
            currentClient.removeListener("transcript", transcriptHandler);
            currentClient.removeListener("stream:end", cleanupHandler);
          }
        };
        currentClient.on("stream:end", cleanupHandler);

        return { success: true, data: { streamId } };
      } catch (error) {
        logger.error("[WhisperIPC] Stream start failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Stop a streaming transcription session
   */
  ipcMain.handle(
    "speech:whisper-stream-stop",
    async (event, { streamId }) => {
      try {
        if (!currentClient) {
          return { success: false, error: "Whisper client not initialized" };
        }

        await currentClient.stopStream(streamId);
        return { success: true };
      } catch (error) {
        logger.error("[WhisperIPC] Stream stop failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Model Management (2 handlers)
  // ============================================================

  /**
   * List available whisper models
   */
  ipcMain.handle("speech:whisper-models", async (event) => {
    try {
      if (!currentClient) {
        return { success: false, error: "Whisper client not initialized" };
      }

      const models = await currentClient.listModels();
      return { success: true, data: models };
    } catch (error) {
      logger.error("[WhisperIPC] List models failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Download a whisper model
   */
  ipcMain.handle(
    "speech:whisper-download-model",
    async (event, { modelSize }) => {
      try {
        if (!currentClient) {
          return { success: false, error: "Whisper client not initialized" };
        }

        // Forward download progress events to renderer
        const progressHandler = (data) => {
          try {
            event.sender.send("speech:whisper-download-progress", data);
          } catch (sendErr) {
            logger.debug(
              "[WhisperIPC] Failed to send download progress:",
              sendErr.message,
            );
          }
        };

        currentClient.on("download:progress", progressHandler);

        try {
          const result = await currentClient.downloadModel(modelSize);
          return { success: true, data: result };
        } finally {
          currentClient.removeListener("download:progress", progressHandler);
        }
      } catch (error) {
        logger.error("[WhisperIPC] Model download failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Voice Chat Pipeline (1 handler)
  // ============================================================

  /**
   * Full voice chat pipeline: STT -> LLM -> TTS
   */
  ipcMain.handle(
    "speech:voice-chat",
    async (event, { audioPath, options }) => {
      try {
        if (!currentClient) {
          return { success: false, error: "Whisper client not initialized" };
        }

        if (!currentLlmManager) {
          return {
            success: false,
            error: "LLM manager not available for voice chat",
          };
        }

        // Forward pipeline step events to renderer
        const stepHandler = (data) => {
          try {
            event.sender.send("speech:voice-chat-step", data);
          } catch (sendErr) {
            logger.debug(
              "[WhisperIPC] Failed to send voice chat step:",
              sendErr.message,
            );
          }
        };

        currentClient.on("voicechat:step", stepHandler);

        try {
          const result = await currentClient.voiceChat(
            audioPath,
            currentLlmManager,
            currentTtsManager,
            options || {},
          );
          return { success: true, data: result };
        } finally {
          currentClient.removeListener("voicechat:step", stepHandler);
        }
      } catch (error) {
        logger.error("[WhisperIPC] Voice chat failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[WhisperIPC] 6 Whisper IPC handlers registered");
  logger.info("[WhisperIPC] - 1 transcription handler");
  logger.info("[WhisperIPC] - 2 streaming handlers");
  logger.info("[WhisperIPC] - 2 model management handlers");
  logger.info("[WhisperIPC] - 1 voice chat handler");

  // Return update functions for hot-reload
  return {
    updateWhisperClient: (newClient) => {
      currentClient = newClient;
      logger.info("[WhisperIPC] WhisperClient instance updated");
    },
    updateLlmManager: (newLlmManager) => {
      currentLlmManager = newLlmManager;
      logger.info("[WhisperIPC] LLM Manager instance updated");
    },
    updateTtsManager: (newTtsManager) => {
      currentTtsManager = newTtsManager;
      logger.info("[WhisperIPC] TTS Manager instance updated");
    },
  };
}

module.exports = { registerWhisperIPC };
