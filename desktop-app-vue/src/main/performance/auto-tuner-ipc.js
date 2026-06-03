/**
 * Auto-Tuner IPC Handlers
 *
 * Registers 12 IPC handlers for controlling the AutoTuner and
 * UnifiedPerformanceCollector from the renderer process.
 *
 * Channels:
 *   auto-tuner:start                  — Start the auto-tuner evaluation loop
 *   auto-tuner:stop                   — Stop the auto-tuner evaluation loop
 *   auto-tuner:get-rules              — List all tuning rules with status
 *   auto-tuner:enable-rule            — Enable a specific rule
 *   auto-tuner:disable-rule           — Disable a specific rule
 *   auto-tuner:add-rule               — Add a custom tuning rule
 *   auto-tuner:remove-rule            — Remove a tuning rule
 *   auto-tuner:manual-tune            — Force-trigger a specific rule
 *   auto-tuner:get-history            — Get tuning action history
 *   auto-tuner:get-stats              — Get evaluation statistics
 *   auto-tuner:evaluate               — Run a one-off evaluation
 *   auto-tuner:report-renderer-metrics — Accept renderer metrics (FPS, DOM, heap)
 *
 * @module performance/auto-tuner-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * Register all auto-tuner IPC handlers
 * @param {Object} dependencies
 * @param {import('./auto-tuner').AutoTuner} dependencies.autoTuner
 * @param {import('./unified-performance-collector').UnifiedPerformanceCollector} dependencies.unifiedPerformanceCollector
 */
function registerAutoTunerIPC(dependencies) {
  const { autoTuner, unifiedPerformanceCollector } = dependencies;

  // 1. Start the auto-tuner evaluation loop
  ipcMain.handle("auto-tuner:start", async () => {
    try {
      autoTuner.start();
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Start failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 2. Stop the auto-tuner evaluation loop
  ipcMain.handle("auto-tuner:stop", async () => {
    try {
      autoTuner.stop();
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Stop failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 3. Get all tuning rules with status
  ipcMain.handle("auto-tuner:get-rules", async () => {
    try {
      const rules = autoTuner.getRules();
      return { success: true, data: rules };
    } catch (error) {
      logger.error("[AutoTunerIPC] Get rules failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 4. Enable a specific rule
  ipcMain.handle("auto-tuner:enable-rule", async (event, ruleId) => {
    try {
      const found = autoTuner.enableRule(ruleId);
      if (!found) {
        return { success: false, error: `Rule '${ruleId}' not found` };
      }
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Enable rule failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 5. Disable a specific rule
  ipcMain.handle("auto-tuner:disable-rule", async (event, ruleId) => {
    try {
      const found = autoTuner.disableRule(ruleId);
      if (!found) {
        return { success: false, error: `Rule '${ruleId}' not found` };
      }
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Disable rule failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 6. Add a custom tuning rule
  ipcMain.handle("auto-tuner:add-rule", async (event, rule) => {
    try {
      // Reconstruct functions from serialized rule if needed
      // Note: condition and action functions cannot be serialized over IPC,
      // so custom rules with functions must be added from the main process.
      // From renderer, only data-based rules can be defined.
      if (typeof rule.condition === "string") {
        // eslint-disable-next-line no-new-func
        rule.condition = new Function("metrics", rule.condition);
      }
      if (typeof rule.action === "string") {
        // eslint-disable-next-line no-new-func
        rule.action = new Function("metrics", rule.action);
      }

      autoTuner.addRule(rule);
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Add rule failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 7. Remove a tuning rule
  ipcMain.handle("auto-tuner:remove-rule", async (event, ruleId) => {
    try {
      const removed = autoTuner.removeRule(ruleId);
      if (!removed) {
        return { success: false, error: `Rule '${ruleId}' not found` };
      }
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Remove rule failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 8. Force-trigger a specific rule
  ipcMain.handle("auto-tuner:manual-tune", async (event, ruleId) => {
    try {
      const entry = autoTuner.manualTune(ruleId);
      if (!entry) {
        return { success: false, error: `Rule '${ruleId}' not found or action failed` };
      }
      return { success: true, data: entry };
    } catch (error) {
      logger.error("[AutoTunerIPC] Manual tune failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 9. Get tuning action history
  ipcMain.handle("auto-tuner:get-history", async (event, limit) => {
    try {
      const history = autoTuner.getTuningHistory(limit || 50);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[AutoTunerIPC] Get history failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 10. Get evaluation statistics
  ipcMain.handle("auto-tuner:get-stats", async () => {
    try {
      const stats = autoTuner.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[AutoTunerIPC] Get stats failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 11. Run a one-off evaluation
  ipcMain.handle("auto-tuner:evaluate", async () => {
    try {
      const triggered = autoTuner.evaluate();
      return { success: true, data: triggered };
    } catch (error) {
      logger.error("[AutoTunerIPC] Evaluate failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 12. Accept renderer metrics (FPS, DOM node count, JS heap)
  ipcMain.handle("auto-tuner:report-renderer-metrics", async (event, data) => {
    try {
      unifiedPerformanceCollector.receiveRendererMetrics(data);
      return { success: true };
    } catch (error) {
      logger.error("[AutoTunerIPC] Report renderer metrics failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[AutoTunerIPC] Registered 12 IPC handlers");
}

module.exports = {
  registerAutoTunerIPC,
};
