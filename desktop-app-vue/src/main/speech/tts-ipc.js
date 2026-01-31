/**
 * Text-to-Speech IPC Handlers
 *
 * Provides IPC interface for TTS:
 * - Speech synthesis
 * - Voice management
 * - Provider configuration
 *
 * @module tts-ipc
 * @version 1.0.0
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register TTS IPC handlers
 * @param {Object} options - Options
 * @param {TTSManager} options.ttsManager - TTS manager instance
 * @param {Object} [options.ipcMain] - Custom IPC main (for testing)
 * @returns {Object} Handler update functions
 */
function registerTTSIPC(options = {}) {
  const { ttsManager, ipcMain: customIpcMain } = options;
  const ipc = customIpcMain || ipcMain;

  let currentManager = ttsManager;

  logger.info('[TTSIPC] Registering IPC handlers...');

  // ====== Status & Configuration ======

  /**
   * Check TTS status
   */
  ipc.handle('tts:check-status', async () => {
    if (!currentManager) {
      return {
        available: false,
        error: 'TTS manager not initialized',
      };
    }

    try {
      const status = await currentManager.checkProviders();
      return {
        available: status.edge || status.local,
        ...status,
      };
    } catch (error) {
      logger.error('[TTSIPC] Status check failed:', error);
      return {
        available: false,
        error: error.message,
      };
    }
  });

  /**
   * Get statistics
   */
  ipc.handle('tts:get-stats', async () => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    return {
      success: true,
      stats: currentManager.getStats(),
    };
  });

  // ====== Speech Synthesis ======

  /**
   * Synthesize text to speech
   */
  ipc.handle('tts:synthesize', async (event, { text, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Please provide text to synthesize' };
    }

    try {
      const result = await currentManager.synthesize(text, options);
      return result;
    } catch (error) {
      logger.error('[TTSIPC] Synthesis failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Synthesize with Edge TTS specifically
   */
  ipc.handle('tts:synthesize-edge', async (event, { text, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      const result = await currentManager.synthesize(text, {
        ...options,
        provider: 'edge',
      });
      return result;
    } catch (error) {
      logger.error('[TTSIPC] Edge synthesis failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Synthesize with Local TTS (Piper) specifically
   */
  ipc.handle('tts:synthesize-local', async (event, { text, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      const result = await currentManager.synthesize(text, {
        ...options,
        provider: 'local',
      });
      return result;
    } catch (error) {
      logger.error('[TTSIPC] Local synthesis failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Synthesize to file
   */
  ipc.handle('tts:synthesize-to-file', async (event, { text, outputPath, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!text || !outputPath) {
      return { success: false, error: 'Please provide text and output path' };
    }

    try {
      const result = await currentManager.synthesizeToFile(text, outputPath, options);
      return result;
    } catch (error) {
      logger.error('[TTSIPC] Synthesis to file failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Voice Management ======

  /**
   * Get available voices
   */
  ipc.handle('tts:get-voices', async (event, { provider, language } = {}) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized', voices: {} };
    }

    try {
      const voices = currentManager.getVoices(provider, language);
      return { success: true, voices };
    } catch (error) {
      return { success: false, error: error.message, voices: {} };
    }
  });

  /**
   * Get Edge TTS voices
   */
  ipc.handle('tts:get-edge-voices', async (event, { language } = {}) => {
    if (!currentManager) {
      return { success: false, voices: {} };
    }

    const voices = currentManager.getVoices('edge', language);
    return { success: true, voices: voices.edge || {} };
  });

  /**
   * Get Local TTS (Piper) models
   */
  ipc.handle('tts:get-local-models', async () => {
    if (!currentManager) {
      return { success: false, models: {} };
    }

    const voices = currentManager.getVoices('local');
    return { success: true, models: voices.local || {} };
  });

  // ====== Cache Management ======

  /**
   * Clear TTS cache
   */
  ipc.handle('tts:clear-cache', async () => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      currentManager.clearCache();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  logger.info('[TTSIPC] IPC handlers registered (10 channels)');

  // Return update function for hot-reload
  return {
    updateTTSManager: (newManager) => {
      currentManager = newManager;
      logger.info('[TTSIPC] TTSManager instance updated');
    },
  };
}

module.exports = {
  registerTTSIPC,
};
