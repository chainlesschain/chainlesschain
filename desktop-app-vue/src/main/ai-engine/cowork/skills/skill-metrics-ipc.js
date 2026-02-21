/**
 * Skill Metrics IPC Handlers
 *
 * 5 IPC handlers for metrics querying.
 *
 * @module skill-metrics-ipc
 * @version 1.1.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../../../utils/logger.js");

let metricsCollector = null;

/**
 * Register skill metrics IPC handlers
 * @param {Object} options
 * @param {Object} options.metricsCollector - SkillMetricsCollector instance
 */
function registerSkillMetricsIPC(options = {}) {
  metricsCollector = options.metricsCollector || null;

  logger.info("[SkillMetricsIPC] Registering 5 handlers...");

  // 1. Get skill metrics
  ipcMain.handle(
    "skills:get-metrics",
    async (_event, { skillId, timeRange }) => {
      try {
        if (!metricsCollector) {
          return { success: false, error: "MetricsCollector not initialized" };
        }
        const metrics = metricsCollector.getSkillMetrics(skillId, timeRange);
        return { success: true, data: metrics };
      } catch (error) {
        logger.error(
          "[SkillMetricsIPC] skills:get-metrics error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 2. Get pipeline metrics
  ipcMain.handle("skills:get-pipeline-metrics", async (_event, pipelineId) => {
    try {
      if (!metricsCollector) {
        return { success: false, error: "MetricsCollector not initialized" };
      }
      const metrics = metricsCollector.getPipelineMetrics(pipelineId || null);
      return { success: true, data: metrics };
    } catch (error) {
      logger.error(
        "[SkillMetricsIPC] skills:get-pipeline-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 3. Get top skills
  ipcMain.handle("skills:get-top-skills", async (_event, { limit, metric }) => {
    try {
      if (!metricsCollector) {
        return { success: false, error: "MetricsCollector not initialized" };
      }
      const top = metricsCollector.getTopSkills(
        limit || 10,
        metric || "executions",
      );
      return { success: true, data: top };
    } catch (error) {
      logger.error(
        "[SkillMetricsIPC] skills:get-top-skills error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 4. Get time series data
  ipcMain.handle(
    "skills:get-time-series",
    async (_event, { skillId, interval }) => {
      try {
        if (!metricsCollector) {
          return { success: false, error: "MetricsCollector not initialized" };
        }
        const data = metricsCollector.getTimeSeriesData(
          skillId,
          interval || "day",
        );
        return { success: true, data };
      } catch (error) {
        logger.error(
          "[SkillMetricsIPC] skills:get-time-series error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 5. Export all metrics
  ipcMain.handle("skills:export-metrics", async () => {
    try {
      if (!metricsCollector) {
        return { success: false, error: "MetricsCollector not initialized" };
      }
      const exported = metricsCollector.exportMetrics();
      return { success: true, data: exported };
    } catch (error) {
      logger.error(
        "[SkillMetricsIPC] skills:export-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info("[SkillMetricsIPC] ✓ 5 handlers registered");
}

module.exports = { registerSkillMetricsIPC };
