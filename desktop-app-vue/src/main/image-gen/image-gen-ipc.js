/**
 * Image Generation IPC Handlers
 *
 * Provides IPC interface for image generation:
 * - Text-to-image generation
 * - Image-to-image transformation
 * - Upscaling
 * - Provider management
 *
 * @module image-gen-ipc
 * @version 1.0.0
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register Image Generation IPC handlers
 * @param {Object} options - Options
 * @param {ImageGenManager} options.imageGenManager - Image generation manager instance
 * @param {Object} [options.ipcMain] - Custom IPC main (for testing)
 * @returns {Object} Handler update functions
 */
function registerImageGenIPC(options = {}) {
  const { imageGenManager, ipcMain: customIpcMain } = options;
  const ipc = customIpcMain || ipcMain;

  let currentManager = imageGenManager;

  logger.info('[ImageGenIPC] Registering IPC handlers...');

  // ====== Status & Configuration ======

  /**
   * Check image generation status
   */
  ipc.handle('image-gen:check-status', async () => {
    if (!currentManager) {
      return {
        available: false,
        error: 'Image generation manager not initialized',
      };
    }

    try {
      const status = await currentManager.checkProviders();
      return {
        available: status.sd_local || status.dalle,
        ...status,
      };
    } catch (error) {
      logger.error('[ImageGenIPC] Status check failed:', error);
      return {
        available: false,
        error: error.message,
      };
    }
  });

  /**
   * Get statistics
   */
  ipc.handle('image-gen:get-stats', async () => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    return {
      success: true,
      stats: currentManager.getStats(),
    };
  });

  /**
   * Set DALL-E API key
   */
  ipc.handle('image-gen:set-dalle-key', async (event, { apiKey }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      currentManager.setDALLEApiKey(apiKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ====== Text-to-Image ======

  /**
   * Generate image from text prompt
   */
  ipc.handle('image-gen:generate', async (event, { prompt, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!prompt || typeof prompt !== 'string') {
      return { success: false, error: 'Please provide a valid prompt' };
    }

    try {
      const result = await currentManager.generate(prompt, options);
      return result;
    } catch (error) {
      logger.error('[ImageGenIPC] Generation failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate with Stable Diffusion specifically
   */
  ipc.handle('image-gen:generate-sd', async (event, { prompt, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      const result = await currentManager.generate(prompt, {
        ...options,
        provider: 'sd_local',
      });
      return result;
    } catch (error) {
      logger.error('[ImageGenIPC] SD generation failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate with DALL-E specifically
   */
  ipc.handle('image-gen:generate-dalle', async (event, { prompt, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      const result = await currentManager.generate(prompt, {
        ...options,
        provider: 'dalle',
      });
      return result;
    } catch (error) {
      logger.error('[ImageGenIPC] DALL-E generation failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Image-to-Image ======

  /**
   * Generate image from image + prompt (img2img)
   */
  ipc.handle('image-gen:img2img', async (event, { prompt, initImage, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!prompt || !initImage) {
      return { success: false, error: 'Please provide prompt and initial image' };
    }

    try {
      const result = await currentManager.img2img(prompt, initImage, options);
      return result;
    } catch (error) {
      logger.error('[ImageGenIPC] img2img failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create variations (DALL-E 2)
   */
  ipc.handle('image-gen:create-variations', async (event, { image, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!image) {
      return { success: false, error: 'Please provide an image' };
    }

    try {
      const result = await currentManager.createVariations(image, options);
      return result;
    } catch (error) {
      logger.error('[ImageGenIPC] Variations failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Upscaling ======

  /**
   * Upscale an image
   */
  ipc.handle('image-gen:upscale', async (event, { image, options = {} }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!image) {
      return { success: false, error: 'Please provide an image' };
    }

    try {
      const result = await currentManager.upscale(image, options);
      return result;
    } catch (error) {
      logger.error('[ImageGenIPC] Upscale failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Progress & Control ======

  /**
   * Get generation progress
   */
  ipc.handle('image-gen:get-progress', async () => {
    if (!currentManager) {
      return { progress: 0, available: false };
    }

    try {
      const progress = await currentManager.getProgress();
      return progress;
    } catch (error) {
      return { progress: 0, error: error.message };
    }
  });

  /**
   * Interrupt current generation
   */
  ipc.handle('image-gen:interrupt', async () => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    try {
      const success = await currentManager.interrupt();
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ====== Model Management ======

  /**
   * Get available models
   */
  ipc.handle('image-gen:get-models', async () => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized', models: [] };
    }

    try {
      const models = await currentManager.getModels();
      return { success: true, models };
    } catch (error) {
      return { success: false, error: error.message, models: [] };
    }
  });

  /**
   * Switch SD model
   */
  ipc.handle('image-gen:switch-model', async (event, { modelName }) => {
    if (!currentManager) {
      return { success: false, error: 'Manager not initialized' };
    }

    if (!modelName) {
      return { success: false, error: 'Please provide a model name' };
    }

    try {
      const success = await currentManager.switchModel(modelName);
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ====== Cache ======

  /**
   * Clear generation cache
   */
  ipc.handle('image-gen:clear-cache', async () => {
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

  logger.info('[ImageGenIPC] IPC handlers registered (15 channels)');

  // Return update function for hot-reload
  return {
    updateImageGenManager: (newManager) => {
      currentManager = newManager;
      logger.info('[ImageGenIPC] ImageGenManager instance updated');
    },
  };
}

module.exports = {
  registerImageGenIPC,
};
