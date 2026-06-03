'use strict';

/**
 * Quantization IPC - Model Quantization IPC Handlers
 *
 * Provides 8 IPC channels for the renderer process to interact
 * with the QuantizationManager for GGUF/GPTQ quantization,
 * job management, and Ollama integration.
 *
 * @module quantization/quantization-ipc
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * Register all quantization IPC handlers
 *
 * @param {Object} dependencies
 * @param {import('./quantization-manager').QuantizationManager} dependencies.quantizationManager
 */
function registerQuantizationIPC({ quantizationManager }) {
  const { ipcMain } = require('electron');

  logger.info('[QuantizationIPC] Registering quantization IPC handlers...');

  // ============================================================
  // quantization:start-gguf
  // ============================================================

  /**
   * Start a GGUF quantization job
   * @channel quantization:start-gguf
   * @param {Object} params
   * @param {string} params.inputPath - Source model file path
   * @param {string} params.outputPath - Output file path
   * @param {string} params.level - Quantization level (e.g., 'Q4_K_M')
   * @param {Object} [params.options] - Additional options
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle('quantization:start-gguf', async (event, { inputPath, outputPath, level, options }) => {
    try {
      const job = await quantizationManager.startGGUF(inputPath, outputPath, level, options);
      return { success: true, data: job };
    } catch (error) {
      logger.error('[QuantizationIPC] start-gguf failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:start-gptq
  // ============================================================

  /**
   * Start a GPTQ quantization job
   * @channel quantization:start-gptq
   * @param {Object} params
   * @param {string} params.inputPath - Source model directory path
   * @param {string} params.outputPath - Output directory path
   * @param {Object} [params.options] - GPTQ options (bits, groupSize, etc.)
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle('quantization:start-gptq', async (event, { inputPath, outputPath, options }) => {
    try {
      const job = await quantizationManager.startGPTQ(inputPath, outputPath, options);
      return { success: true, data: job };
    } catch (error) {
      logger.error('[QuantizationIPC] start-gptq failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:get-status
  // ============================================================

  /**
   * Get the status and progress of a quantization job
   * @channel quantization:get-status
   * @param {Object} params
   * @param {string} params.jobId - Job identifier
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle('quantization:get-status', async (event, { jobId }) => {
    try {
      const status = quantizationManager.getStatus(jobId);
      if (!status) {
        return { success: false, error: `Job not found: ${jobId}` };
      }
      return { success: true, data: status };
    } catch (error) {
      logger.error('[QuantizationIPC] get-status failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:cancel
  // ============================================================

  /**
   * Cancel a running quantization job
   * @channel quantization:cancel
   * @param {Object} params
   * @param {string} params.jobId - Job identifier
   * @returns {{ success: boolean, data?: { cancelled: boolean }, error?: string }}
   */
  ipcMain.handle('quantization:cancel', async (event, { jobId }) => {
    try {
      const cancelled = quantizationManager.cancelJob(jobId);
      return { success: true, data: { cancelled } };
    } catch (error) {
      logger.error('[QuantizationIPC] cancel failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:list-models
  // ============================================================

  /**
   * List all quantized models
   * @channel quantization:list-models
   * @param {Object} [params] - Optional filter params (status, quantType, limit, offset)
   * @returns {{ success: boolean, data?: Array<Object>, error?: string }}
   */
  ipcMain.handle('quantization:list-models', async (event, params) => {
    try {
      const models = quantizationManager.listModels(params || {});
      return { success: true, data: models };
    } catch (error) {
      logger.error('[QuantizationIPC] list-models failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:delete-model
  // ============================================================

  /**
   * Delete a quantized model and its output files
   * @channel quantization:delete-model
   * @param {Object} params
   * @param {string} params.jobId - Job identifier
   * @returns {{ success: boolean, data?: { deleted: boolean }, error?: string }}
   */
  ipcMain.handle('quantization:delete-model', async (event, { jobId }) => {
    try {
      const deleted = quantizationManager.deleteModel(jobId);
      return { success: true, data: { deleted } };
    } catch (error) {
      logger.error('[QuantizationIPC] delete-model failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:import-ollama
  // ============================================================

  /**
   * Import a quantized GGUF model into Ollama
   * @channel quantization:import-ollama
   * @param {Object} params
   * @param {string} params.modelPath - Path to the GGUF file
   * @param {string} params.modelName - Name for the Ollama model
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle('quantization:import-ollama', async (event, { modelPath, modelName }) => {
    try {
      const result = await quantizationManager.importToOllama(modelPath, modelName);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[QuantizationIPC] import-ollama failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // quantization:get-quant-levels
  // ============================================================

  /**
   * Get all supported GGUF quantization levels
   * @channel quantization:get-quant-levels
   * @returns {{ success: boolean, data?: Array<Object>, error?: string }}
   */
  ipcMain.handle('quantization:get-quant-levels', async () => {
    try {
      const levels = quantizationManager.getQuantLevels();
      return { success: true, data: levels };
    } catch (error) {
      logger.error('[QuantizationIPC] get-quant-levels failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  logger.info('[QuantizationIPC] All 8 handlers registered');
}

module.exports = { registerQuantizationIPC };
