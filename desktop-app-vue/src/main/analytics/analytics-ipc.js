/**
 * Analytics IPC Handlers
 *
 * Registers 16 IPC handlers for the Advanced Analytics Dashboard.
 * All channels use the 'analytics:' prefix.
 *
 * Channels:
 *  1. analytics:start
 *  2. analytics:stop
 *  3. analytics:get-dashboard-summary
 *  4. analytics:get-time-series
 *  5. analytics:get-top-n
 *  6. analytics:generate-report
 *  7. analytics:cleanup
 *  8. analytics:get-ai-metrics
 *  9. analytics:get-skill-metrics
 * 10. analytics:get-error-metrics
 * 11. analytics:get-system-metrics
 * 12. analytics:get-p2p-metrics
 * 13. analytics:export-csv
 * 14. analytics:export-json
 * 15. analytics:get-aggregation-history
 * 16. analytics:trigger-aggregation
 *
 * @module analytics/analytics-ipc
 * @version 1.0.0
 */

"use strict";

const { logger } = require("../utils/logger.js");

const ANALYTICS_CHANNELS = [
  "analytics:start",
  "analytics:stop",
  "analytics:get-dashboard-summary",
  "analytics:get-time-series",
  "analytics:get-top-n",
  "analytics:generate-report",
  "analytics:cleanup",
  "analytics:get-ai-metrics",
  "analytics:get-skill-metrics",
  "analytics:get-error-metrics",
  "analytics:get-system-metrics",
  "analytics:get-p2p-metrics",
  "analytics:export-csv",
  "analytics:export-json",
  "analytics:get-aggregation-history",
  "analytics:trigger-aggregation",
];

/**
 * Register all analytics IPC handlers
 * @param {Object} deps - Dependencies
 * @param {import('./analytics-aggregator').AnalyticsAggregator} deps.analyticsAggregator - Aggregator instance
 */
function registerAnalyticsIPC(deps) {
  const ipcMain = deps.ipcMain || require("electron").ipcMain;
  const { analyticsAggregator } = deps;

  if (!analyticsAggregator) {
    logger.warn(
      "[AnalyticsIPC] No analyticsAggregator provided, skipping registration",
    );
    return;
  }

  // 1. analytics:start
  ipcMain.handle("analytics:start", async () => {
    try {
      analyticsAggregator.start();
      return { success: true, data: { message: "Analytics started" } };
    } catch (error) {
      logger.error("[AnalyticsIPC] analytics:start error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 2. analytics:stop
  ipcMain.handle("analytics:stop", async () => {
    try {
      analyticsAggregator.stop();
      return { success: true, data: { message: "Analytics stopped" } };
    } catch (error) {
      logger.error("[AnalyticsIPC] analytics:stop error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 3. analytics:get-dashboard-summary
  ipcMain.handle("analytics:get-dashboard-summary", async (_event, period) => {
    try {
      const summary = await analyticsAggregator.getDashboardSummary(
        period || "24h",
      );
      return { success: true, data: summary };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-dashboard-summary error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 4. analytics:get-time-series
  ipcMain.handle("analytics:get-time-series", async (_event, args) => {
    try {
      const { metric, from, to, granularity } = args || {};
      if (!metric) {
        return { success: false, error: "metric parameter is required" };
      }
      const data = await analyticsAggregator.getTimeSeries(metric, {
        from,
        to,
        granularity,
      });
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-time-series error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 5. analytics:get-top-n
  ipcMain.handle("analytics:get-top-n", async (_event, args) => {
    try {
      const { metric, n, period } = args || {};
      if (!metric) {
        return { success: false, error: "metric parameter is required" };
      }
      const data = await analyticsAggregator.getTopN(
        metric,
        n || 10,
        period || "24h",
      );
      return { success: true, data };
    } catch (error) {
      logger.error("[AnalyticsIPC] analytics:get-top-n error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 6. analytics:generate-report
  ipcMain.handle("analytics:generate-report", async (_event, options) => {
    try {
      const data = await analyticsAggregator.generateReport(options || {});
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:generate-report error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 7. analytics:cleanup
  ipcMain.handle("analytics:cleanup", async (_event, retentionDays) => {
    try {
      const result = await analyticsAggregator.cleanupOldData(retentionDays);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[AnalyticsIPC] analytics:cleanup error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 8. analytics:get-ai-metrics
  ipcMain.handle("analytics:get-ai-metrics", async () => {
    try {
      const data = await analyticsAggregator.getAIMetrics();
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-ai-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 9. analytics:get-skill-metrics
  ipcMain.handle("analytics:get-skill-metrics", async () => {
    try {
      const data = await analyticsAggregator.getSkillMetrics();
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-skill-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 10. analytics:get-error-metrics
  ipcMain.handle("analytics:get-error-metrics", async () => {
    try {
      const data = await analyticsAggregator.getErrorMetrics();
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-error-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 11. analytics:get-system-metrics
  ipcMain.handle("analytics:get-system-metrics", async () => {
    try {
      const data = await analyticsAggregator.getSystemMetrics();
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-system-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 12. analytics:get-p2p-metrics
  ipcMain.handle("analytics:get-p2p-metrics", async () => {
    try {
      const data = await analyticsAggregator.getP2PMetrics();
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-p2p-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 13. analytics:export-csv
  ipcMain.handle("analytics:export-csv", async (_event, period) => {
    try {
      const data = await analyticsAggregator.generateReport({
        format: "csv",
        period: period || "7d",
      });
      return { success: true, data };
    } catch (error) {
      logger.error("[AnalyticsIPC] analytics:export-csv error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 14. analytics:export-json
  ipcMain.handle("analytics:export-json", async (_event, period) => {
    try {
      const data = await analyticsAggregator.generateReport({
        format: "json",
        period: period || "7d",
      });
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:export-json error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 15. analytics:get-aggregation-history
  ipcMain.handle("analytics:get-aggregation-history", async (_event, args) => {
    try {
      const { limit, offset } = args || {};
      const data = await analyticsAggregator.getAggregationHistory({
        limit: limit || 50,
        offset: offset || 0,
      });
      return { success: true, data };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:get-aggregation-history error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 16. analytics:trigger-aggregation
  ipcMain.handle("analytics:trigger-aggregation", async () => {
    try {
      await analyticsAggregator._aggregate();
      return {
        success: true,
        data: { message: "Aggregation triggered successfully" },
      };
    } catch (error) {
      logger.error(
        "[AnalyticsIPC] analytics:trigger-aggregation error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[AnalyticsIPC] Registered ${ANALYTICS_CHANNELS.length} IPC handlers`,
  );
}

module.exports = { registerAnalyticsIPC, ANALYTICS_CHANNELS };
