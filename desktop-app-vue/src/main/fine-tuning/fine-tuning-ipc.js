'use strict';

/**
 * Fine-Tuning IPC - Electron IPC handlers for the fine-tuning system
 *
 * Exposes 8 IPC channels that bridge the renderer process to the
 * FineTuningManager:
 *
 *   fine-tuning:prepare-data
 *   fine-tuning:start
 *   fine-tuning:get-status
 *   fine-tuning:cancel
 *   fine-tuning:list-adapters
 *   fine-tuning:delete-adapter
 *   fine-tuning:load-adapter
 *   fine-tuning:export-data
 *
 * @module fine-tuning/fine-tuning-ipc
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * Register all fine-tuning IPC handlers.
 *
 * @param {Object} dependencies
 * @param {import('./fine-tuning-manager').FineTuningManager} dependencies.fineTuningManager
 */
function registerFineTuningIPC({ fineTuningManager }) {
  const { ipcMain } = require('electron');

  logger.info('[IPC] Registering fine-tuning IPC handlers');

  // ────────────────────────────────────────────────────────────────────
  // 1. Prepare training data
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:prepare-data', async (event, { options }) => {
    try {
      logger.info('[FineTuning IPC] prepare-data', options);
      const result = await fineTuningManager.prepareData(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[FineTuning IPC] prepare-data failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Start a fine-tuning job
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:start', async (event, { config }) => {
    try {
      logger.info('[FineTuning IPC] start', config);
      const result = await fineTuningManager.startTraining(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[FineTuning IPC] start failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Get job status
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:get-status', async (event, { jobId }) => {
    try {
      const result = fineTuningManager.getStatus(jobId);
      if (!result) {
        return { success: false, error: 'Job not found' };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error('[FineTuning IPC] get-status failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Cancel a running job
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:cancel', async (event, { jobId }) => {
    try {
      logger.info('[FineTuning IPC] cancel', jobId);
      const result = fineTuningManager.cancelJob(jobId);
      return { success: result.success, data: result, error: result.success ? undefined : result.message };
    } catch (error) {
      logger.error('[FineTuning IPC] cancel failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. List all LoRA adapters
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:list-adapters', async (event) => {
    try {
      const adapters = fineTuningManager.listAdapters();
      return { success: true, data: adapters };
    } catch (error) {
      logger.error('[FineTuning IPC] list-adapters failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Delete an adapter
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:delete-adapter', async (event, { adapterId }) => {
    try {
      logger.info('[FineTuning IPC] delete-adapter', adapterId);
      const result = fineTuningManager.deleteAdapter(adapterId);
      return { success: result.success, data: result, error: result.success ? undefined : result.message };
    } catch (error) {
      logger.error('[FineTuning IPC] delete-adapter failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Load an adapter onto a model
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:load-adapter', async (event, { adapterId, targetModel }) => {
    try {
      logger.info('[FineTuning IPC] load-adapter', { adapterId, targetModel });
      const result = await fineTuningManager.loadAdapter(adapterId, targetModel);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[FineTuning IPC] load-adapter failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Export training data for a job
  // ────────────────────────────────────────────────────────────────────

  ipcMain.handle('fine-tuning:export-data', async (event, { jobId, format }) => {
    try {
      logger.info('[FineTuning IPC] export-data', { jobId, format });
      const result = fineTuningManager.exportData(jobId, format);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[FineTuning IPC] export-data failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info('[IPC] Fine-tuning IPC handlers registered (8 channels)');
}

module.exports = { registerFineTuningIPC };
