/**
 * ML Task Scheduler - IPC Handlers
 *
 * Registers 8 IPC handlers for the ML-driven task scheduling system,
 * enabling renderer process access to complexity prediction, resource
 * estimation, model stats, and configuration.
 *
 * @module ai-engine/cowork/ml-task-scheduler-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

/**
 * All IPC channels for the ML scheduler system
 */
const ML_SCHEDULER_CHANNELS = [
  "ml-scheduler:predict-complexity",
  "ml-scheduler:predict-resources",
  "ml-scheduler:get-model-stats",
  "ml-scheduler:retrain",
  "ml-scheduler:get-history",
  "ml-scheduler:get-feature-importance",
  "ml-scheduler:configure",
  "ml-scheduler:get-config",
];

/**
 * Register all ML scheduler IPC handlers
 * @param {Object} mlTaskScheduler - MLTaskScheduler instance
 */
function registerMLSchedulerIPC(mlTaskScheduler) {
  if (!mlTaskScheduler) {
    logger.warn(
      "[MLSchedulerIPC] No ML task scheduler provided, registering fallbacks",
    );
    for (const channel of ML_SCHEDULER_CHANNELS) {
      ipcMain.handle(channel, async () => ({
        success: false,
        error: "MLTaskScheduler is not initialized",
        code: "ML_SCHEDULER_UNAVAILABLE",
      }));
    }
    return;
  }

  // ============================================================
  // Prediction Operations
  // ============================================================

  /**
   * Predict task complexity
   * @param {string} taskDescription - Task description text
   * @param {Object} [context] - { priority, type, subtasks }
   */
  ipcMain.handle(
    "ml-scheduler:predict-complexity",
    async (_event, taskDescription, context = {}) => {
      try {
        const result = mlTaskScheduler.predictComplexity(
          taskDescription,
          context,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[MLSchedulerIPC] predict-complexity error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Predict resource needs for a given complexity
   * @param {number} complexity - Complexity score (1-10)
   * @param {string} [taskType] - Task type
   */
  ipcMain.handle(
    "ml-scheduler:predict-resources",
    async (_event, complexity, taskType = "default") => {
      try {
        const result = mlTaskScheduler.predictResources(complexity, taskType);
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[MLSchedulerIPC] predict-resources error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Model Operations
  // ============================================================

  /**
   * Get model statistics (accuracy, sample count, etc.)
   */
  ipcMain.handle("ml-scheduler:get-model-stats", async () => {
    try {
      const stats = mlTaskScheduler.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[MLSchedulerIPC] get-model-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Force model weight recalculation from all historical data
   */
  ipcMain.handle("ml-scheduler:retrain", async () => {
    try {
      const result = await mlTaskScheduler.retrain();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MLSchedulerIPC] retrain error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get historical predictions vs actuals
   * @param {number} [limit=50] - Max records
   */
  ipcMain.handle("ml-scheduler:get-history", async (_event, limit = 50) => {
    try {
      const history = mlTaskScheduler.getHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[MLSchedulerIPC] get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get feature weight rankings
   */
  ipcMain.handle("ml-scheduler:get-feature-importance", async () => {
    try {
      const importance = mlTaskScheduler.getFeatureImportance();
      return { success: true, data: importance };
    } catch (error) {
      logger.error(
        "[MLSchedulerIPC] get-feature-importance error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Update scheduler configuration
   * @param {Object} config - Configuration updates
   */
  ipcMain.handle("ml-scheduler:configure", async (_event, config = {}) => {
    try {
      const updated = mlTaskScheduler.configure(config);
      return { success: true, data: updated };
    } catch (error) {
      logger.error("[MLSchedulerIPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get current configuration
   */
  ipcMain.handle("ml-scheduler:get-config", async () => {
    try {
      const config = mlTaskScheduler.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error("[MLSchedulerIPC] get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[MLSchedulerIPC] Registered ${ML_SCHEDULER_CHANNELS.length} handlers`,
  );
}

module.exports = { registerMLSchedulerIPC, ML_SCHEDULER_CHANNELS };
