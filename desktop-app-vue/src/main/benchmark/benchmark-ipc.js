/**
 * Benchmark IPC Handlers
 *
 * Registers 9 IPC handlers for the benchmark system, exposing
 * benchmark operations to the renderer process.
 *
 * @module benchmark/benchmark-ipc
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { listSuites } = require("./benchmark-suites.js");

/**
 * Register all benchmark IPC handlers
 * @param {Object} dependencies
 * @param {import('./benchmark-manager').BenchmarkManager} dependencies.benchmarkManager
 */
function registerBenchmarkIPC({ benchmarkManager }) {
  const { ipcMain } = require("electron");

  /**
   * Run a benchmark suite against a model
   * @channel benchmark:run
   * @param {Object} args
   * @param {string} args.suiteId - Benchmark suite ID
   * @param {Object} args.modelConfig - Model configuration { provider, model, options }
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle("benchmark:run", async (event, { suiteId, modelConfig }) => {
    try {
      logger.info(`[BenchmarkIPC] Starting benchmark run: suite=${suiteId}, model=${modelConfig.model}`);
      const result = await benchmarkManager.runBenchmark(suiteId, modelConfig);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:run failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Run a comparison of the same suite against multiple models
   * @channel benchmark:run-comparison
   * @param {Object} args
   * @param {string} args.suiteId - Benchmark suite ID
   * @param {Array<Object>} args.modelConfigs - Array of model configurations
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle("benchmark:run-comparison", async (event, { suiteId, modelConfigs }) => {
    try {
      logger.info(`[BenchmarkIPC] Starting comparison run: suite=${suiteId}, models=${modelConfigs.length}`);
      const result = await benchmarkManager.runComparison(suiteId, modelConfigs);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:run-comparison failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get status of a benchmark run
   * @channel benchmark:get-status
   * @param {string} runId - Run ID
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle("benchmark:get-status", async (event, { runId }) => {
    try {
      const status = benchmarkManager.getRunStatus(runId);
      if (!status) {
        return { success: false, error: `Run not found: ${runId}` };
      }
      return { success: true, data: status };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:get-status failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cancel an active benchmark run
   * @channel benchmark:cancel
   * @param {string} runId - Run ID to cancel
   * @returns {{ success: boolean, data?: boolean, error?: string }}
   */
  ipcMain.handle("benchmark:cancel", async (event, { runId }) => {
    try {
      const cancelled = benchmarkManager.cancelRun(runId);
      return { success: true, data: cancelled };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:cancel failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all results for a benchmark run
   * @channel benchmark:get-results
   * @param {string} runId - Run ID
   * @returns {{ success: boolean, data?: Array, error?: string }}
   */
  ipcMain.handle("benchmark:get-results", async (event, { runId }) => {
    try {
      const results = benchmarkManager.getResults(runId);
      return { success: true, data: results };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:get-results failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate a detailed report for a benchmark run
   * @channel benchmark:get-report
   * @param {string} runId - Run ID
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle("benchmark:get-report", async (event, { runId }) => {
    try {
      const report = benchmarkManager.getReport(runId);
      if (!report) {
        return { success: false, error: `Run not found: ${runId}` };
      }
      return { success: true, data: report };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:get-report failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * List past benchmark runs with pagination
   * @channel benchmark:list-runs
   * @param {Object} options - { limit, offset, suiteId, status, modelName }
   * @returns {{ success: boolean, data?: Object, error?: string }}
   */
  ipcMain.handle("benchmark:list-runs", async (event, options = {}) => {
    try {
      const result = benchmarkManager.listRuns(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:list-runs failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * List all available benchmark suites
   * @channel benchmark:list-suites
   * @returns {{ success: boolean, data?: Array, error?: string }}
   */
  ipcMain.handle("benchmark:list-suites", async () => {
    try {
      const suites = listSuites();
      return { success: true, data: suites };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:list-suites failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete a benchmark run and its results
   * @channel benchmark:delete-run
   * @param {string} runId - Run ID to delete
   * @returns {{ success: boolean, data?: boolean, error?: string }}
   */
  ipcMain.handle("benchmark:delete-run", async (event, { runId }) => {
    try {
      const deleted = benchmarkManager.deleteRun(runId);
      return { success: true, data: deleted };
    } catch (error) {
      logger.error("[BenchmarkIPC] benchmark:delete-run failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[BenchmarkIPC] 9 IPC handlers registered");
}

module.exports = { registerBenchmarkIPC };
