/**
 * Autonomous Agent IPC Handlers
 *
 * Registers 18 IPC handlers for the autonomous agent system
 * with the `agent:` prefix. Forwards real-time events from
 * the runner to the renderer process via webContents.send().
 *
 * Handlers:
 *  1. agent:submit-goal
 *  2. agent:pause-goal
 *  3. agent:resume-goal
 *  4. agent:cancel-goal
 *  5. agent:provide-input
 *  6. agent:get-goal-status
 *  7. agent:get-active-goals
 *  8. agent:get-goal-history
 *  9. agent:get-goal-steps
 * 10. agent:get-queue-status
 * 11. agent:update-config
 * 12. agent:get-config
 * 13. agent:get-stats
 * 14. agent:clear-history
 * 15. agent:export-goal
 * 16. agent:retry-goal
 * 17. agent:get-goal-logs
 * 18. agent:batch-cancel
 *
 * @module ai-engine/autonomous/autonomous-ipc
 * @version 1.0.0
 */

"use strict";

const { ipcMain, BrowserWindow } = require("electron");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Channel Definitions
// ============================================================

const AUTONOMOUS_CHANNELS = [
  "agent:submit-goal",
  "agent:pause-goal",
  "agent:resume-goal",
  "agent:cancel-goal",
  "agent:provide-input",
  "agent:get-goal-status",
  "agent:get-active-goals",
  "agent:get-goal-history",
  "agent:get-goal-steps",
  "agent:get-queue-status",
  "agent:update-config",
  "agent:get-config",
  "agent:get-stats",
  "agent:clear-history",
  "agent:export-goal",
  "agent:retry-goal",
  "agent:get-goal-logs",
  "agent:batch-cancel",
];

// ============================================================
// Event Forwarding
// ============================================================

/**
 * Send an event to all renderer windows
 * @param {string} channel - IPC channel name
 * @param {Object} data - Event data
 */
function sendToRenderer(channel, data) {
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send(channel, data);
      }
    }
  } catch (e) {
    // Ignore send errors (window may be closing)
  }
}

// ============================================================
// Registration
// ============================================================

/**
 * Register all autonomous agent IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.runner - AutonomousAgentRunner instance
 * @param {Object} deps.taskQueue - AgentTaskQueue instance
 */
function registerAutonomousIPC(deps) {
  const { runner, taskQueue } = deps;

  if (!runner) {
    logger.warn("[AutonomousIPC] Runner not provided, skipping registration");
    return { handlerCount: 0 };
  }

  // ----------------------------------------------------------
  // 1. agent:submit-goal
  // ----------------------------------------------------------
  ipcMain.handle("agent:submit-goal", async (_event, goalSpec) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.submitGoal(goalSpec);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:submit-goal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 2. agent:pause-goal
  // ----------------------------------------------------------
  ipcMain.handle("agent:pause-goal", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.pauseGoal(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:pause-goal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 3. agent:resume-goal
  // ----------------------------------------------------------
  ipcMain.handle("agent:resume-goal", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.resumeGoal(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:resume-goal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 4. agent:cancel-goal
  // ----------------------------------------------------------
  ipcMain.handle("agent:cancel-goal", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.cancelGoal(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:cancel-goal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 5. agent:provide-input
  // ----------------------------------------------------------
  ipcMain.handle("agent:provide-input", async (_event, { goalId, input }) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.provideUserInput(goalId, input);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:provide-input error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 6. agent:get-goal-status
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-goal-status", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.getGoalStatus(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-goal-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 7. agent:get-active-goals
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-active-goals", async () => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.getActiveGoals();
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-active-goals error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 8. agent:get-goal-history
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-goal-history", async (_event, { limit, offset } = {}) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.getGoalHistory(limit || 50, offset || 0);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-goal-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 9. agent:get-goal-steps
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-goal-steps", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.getGoalSteps(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-goal-steps error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 10. agent:get-queue-status
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-queue-status", async () => {
    try {
      if (taskQueue && taskQueue.initialized) {
        const result = await taskQueue.getQueueStatus();
        return result;
      }
      return {
        success: true,
        data: {
          pending: 0,
          active: 0,
          total: 0,
          maxConcurrent: 3,
          canAcceptMore: true,
          byPriority: {},
          items: [],
          historical: { totalProcessed: 0, totalCompleted: 0, totalFailed: 0 },
        },
      };
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-queue-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 11. agent:update-config
  // ----------------------------------------------------------
  ipcMain.handle("agent:update-config", async (_event, config) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = runner.updateConfig(config);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:update-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 12. agent:get-config
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-config", async () => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = runner.getConfig();
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 13. agent:get-stats
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-stats", async () => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.getStats();
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 14. agent:clear-history
  // ----------------------------------------------------------
  ipcMain.handle("agent:clear-history", async (_event, { before } = {}) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.clearHistory(before);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:clear-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 15. agent:export-goal
  // ----------------------------------------------------------
  ipcMain.handle("agent:export-goal", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.exportGoal(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:export-goal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 16. agent:retry-goal
  // ----------------------------------------------------------
  ipcMain.handle("agent:retry-goal", async (_event, goalId) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.retryGoal(goalId);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:retry-goal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 17. agent:get-goal-logs
  // ----------------------------------------------------------
  ipcMain.handle("agent:get-goal-logs", async (_event, { goalId, limit } = {}) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }
      const result = await runner.getGoalLogs(goalId, limit || 100);
      return result;
    } catch (error) {
      logger.error("[AutonomousIPC] agent:get-goal-logs error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ----------------------------------------------------------
  // 18. agent:batch-cancel
  // ----------------------------------------------------------
  ipcMain.handle("agent:batch-cancel", async (_event, goalIds) => {
    try {
      if (!runner.initialized) {
        return { success: false, error: "AutonomousAgentRunner not initialized" };
      }

      if (!Array.isArray(goalIds) || goalIds.length === 0) {
        return { success: false, error: "goalIds must be a non-empty array" };
      }

      const results = [];
      for (const goalId of goalIds) {
        try {
          const result = await runner.cancelGoal(goalId);
          results.push({ goalId, ...result });
        } catch (e) {
          results.push({ goalId, success: false, error: e.message });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      logger.info(
        `[AutonomousIPC] Batch cancel: ${successCount}/${goalIds.length} goals cancelled`
      );

      return {
        success: true,
        data: {
          results,
          totalRequested: goalIds.length,
          totalCancelled: successCount,
        },
      };
    } catch (error) {
      logger.error("[AutonomousIPC] agent:batch-cancel error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Event Forwarding: Runner -> Renderer
  // ============================================================

  runner.on("goal-progress", (data) => {
    sendToRenderer("agent:goal-progress", data);
  });

  runner.on("goal-completed", (data) => {
    sendToRenderer("agent:goal-completed", data);
  });

  runner.on("goal-failed", (data) => {
    sendToRenderer("agent:goal-failed", data);
  });

  runner.on("goal-paused", (data) => {
    sendToRenderer("agent:goal-paused", data);
  });

  runner.on("goal-resumed", (data) => {
    sendToRenderer("agent:goal-resumed", data);
  });

  runner.on("goal-cancelled", (data) => {
    sendToRenderer("agent:goal-cancelled", data);
  });

  runner.on("input-requested", (data) => {
    sendToRenderer("agent:input-requested", data);
  });

  runner.on("input-provided", (data) => {
    sendToRenderer("agent:input-provided", data);
  });

  runner.on("goal-submitted", (data) => {
    sendToRenderer("agent:goal-submitted", data);
  });

  logger.info(
    `[AutonomousIPC] Registered ${AUTONOMOUS_CHANNELS.length} IPC handlers + 9 event forwarders`
  );

  return { handlerCount: AUTONOMOUS_CHANNELS.length };
}

/**
 * Unregister all autonomous agent IPC handlers
 */
function unregisterAutonomousIPC() {
  for (const channel of AUTONOMOUS_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info("[AutonomousIPC] Unregistered all handlers");
}

module.exports = {
  registerAutonomousIPC,
  unregisterAutonomousIPC,
  AUTONOMOUS_CHANNELS,
};
