"use strict";

const {
  ipcMain: electronIpcMain,
  BrowserWindow: ElectronBrowserWindow,
} = require("electron");
const { logger } = require("../../utils/logger.js");

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

const AUTONOMOUS_FORWARD_EVENTS = [
  "goal-progress",
  "goal-completed",
  "goal-failed",
  "goal-paused",
  "goal-resumed",
  "goal-cancelled",
  "input-requested",
  "input-provided",
  "goal-submitted",
];

function removeExistingHandlers(ipc) {
  if (typeof ipc.removeHandler !== "function") {
    return;
  }

  AUTONOMOUS_CHANNELS.forEach((channel) => {
    try {
      ipc.removeHandler(channel);
    } catch (_error) {
      // Ignore missing handlers.
    }
  });
}

function createRendererSender(browserWindowProvider) {
  const getWindows =
    browserWindowProvider || (() => ElectronBrowserWindow.getAllWindows());

  return (channel, data) => {
    try {
      const windows = getWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send(channel, data);
        }
      }
    } catch (_error) {
      // Ignore send errors while windows are closing.
    }
  };
}

function getUninitializedRunnerResult() {
  return {
    success: false,
    error: "AutonomousAgentRunner not initialized",
  };
}

function registerAutonomousIPC(deps = {}) {
  const ipc = deps.ipcMain || electronIpcMain;
  const runner = deps.runner || deps.autonomousRunner;
  const taskQueue = deps.taskQueue || deps.agentTaskQueue;

  if (!runner) {
    logger.warn("[AutonomousIPC] Runner not provided, skipping registration");
    return { handlerCount: 0, forwarderCount: 0 };
  }

  const sendToRenderer =
    deps.sendToRenderer || createRendererSender(deps.browserWindowProvider);

  const withRunner = (operation) => {
    return async (...args) => {
      if (!runner.initialized) {
        return getUninitializedRunnerResult();
      }
      return operation(...args);
    };
  };

  const safeHandle = (channel, label, handler) => {
    ipc.handle(channel, async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        logger.error(`[AutonomousIPC] ${label} error:`, error.message);
        return { success: false, error: error.message };
      }
    });
  };

  removeExistingHandlers(ipc);

  safeHandle(
    "agent:submit-goal",
    "agent:submit-goal",
    withRunner(async (_event, goalSpec) => runner.submitGoal(goalSpec)),
  );

  safeHandle(
    "agent:pause-goal",
    "agent:pause-goal",
    withRunner(async (_event, goalId) => runner.pauseGoal(goalId)),
  );

  safeHandle(
    "agent:resume-goal",
    "agent:resume-goal",
    withRunner(async (_event, goalId) => runner.resumeGoal(goalId)),
  );

  safeHandle(
    "agent:cancel-goal",
    "agent:cancel-goal",
    withRunner(async (_event, goalId) => runner.cancelGoal(goalId)),
  );

  safeHandle(
    "agent:provide-input",
    "agent:provide-input",
    withRunner(async (_event, { goalId, input } = {}) => {
      return runner.provideUserInput(goalId, input);
    }),
  );

  safeHandle(
    "agent:get-goal-status",
    "agent:get-goal-status",
    withRunner(async (_event, goalId) => runner.getGoalStatus(goalId)),
  );

  safeHandle(
    "agent:get-active-goals",
    "agent:get-active-goals",
    withRunner(async () => runner.getActiveGoals()),
  );

  safeHandle(
    "agent:get-goal-history",
    "agent:get-goal-history",
    withRunner(async (_event, payload = {}) => {
      return runner.getGoalHistory(payload.limit || 50, payload.offset || 0);
    }),
  );

  safeHandle(
    "agent:get-goal-steps",
    "agent:get-goal-steps",
    withRunner(async (_event, goalId) => runner.getGoalSteps(goalId)),
  );

  safeHandle("agent:get-queue-status", "agent:get-queue-status", async () => {
    if (taskQueue && taskQueue.initialized) {
      return taskQueue.getQueueStatus();
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
  });

  safeHandle(
    "agent:update-config",
    "agent:update-config",
    withRunner(async (_event, config) => runner.updateConfig(config)),
  );

  safeHandle(
    "agent:get-config",
    "agent:get-config",
    withRunner(async () => runner.getConfig()),
  );

  safeHandle(
    "agent:get-stats",
    "agent:get-stats",
    withRunner(async () => runner.getStats()),
  );

  safeHandle(
    "agent:clear-history",
    "agent:clear-history",
    withRunner(async (_event, { before } = {}) => runner.clearHistory(before)),
  );

  safeHandle(
    "agent:export-goal",
    "agent:export-goal",
    withRunner(async (_event, goalId) => runner.exportGoal(goalId)),
  );

  safeHandle(
    "agent:retry-goal",
    "agent:retry-goal",
    withRunner(async (_event, goalId) => runner.retryGoal(goalId)),
  );

  safeHandle(
    "agent:get-goal-logs",
    "agent:get-goal-logs",
    withRunner(async (_event, { goalId, limit } = {}) => {
      return runner.getGoalLogs(goalId, limit || 100);
    }),
  );

  safeHandle(
    "agent:batch-cancel",
    "agent:batch-cancel",
    withRunner(async (_event, goalIds) => {
      if (!Array.isArray(goalIds) || goalIds.length === 0) {
        return { success: false, error: "goalIds must be a non-empty array" };
      }

      const results = [];
      for (const goalId of goalIds) {
        try {
          const result = await runner.cancelGoal(goalId);
          results.push({ goalId, ...result });
        } catch (error) {
          results.push({ goalId, success: false, error: error.message });
        }
      }

      const successCount = results.filter((result) => result.success).length;
      logger.info(
        `[AutonomousIPC] Batch cancel: ${successCount}/${goalIds.length} goals cancelled`,
      );

      return {
        success: true,
        data: {
          results,
          totalRequested: goalIds.length,
          totalCancelled: successCount,
        },
      };
    }),
  );

  if (typeof runner.on === "function") {
    AUTONOMOUS_FORWARD_EVENTS.forEach((eventName) => {
      runner.on(eventName, (data) => {
        sendToRenderer(`agent:${eventName}`, data);
      });
    });
  }

  logger.info(
    `[AutonomousIPC] Registered ${AUTONOMOUS_CHANNELS.length} IPC handlers + ${AUTONOMOUS_FORWARD_EVENTS.length} event forwarders`,
  );

  return {
    handlerCount: AUTONOMOUS_CHANNELS.length,
    forwarderCount: AUTONOMOUS_FORWARD_EVENTS.length,
  };
}

function unregisterAutonomousIPC({ ipcMain: injectedIpcMain } = {}) {
  const ipc = injectedIpcMain || electronIpcMain;
  if (typeof ipc.removeHandler === "function") {
    AUTONOMOUS_CHANNELS.forEach((channel) => {
      ipc.removeHandler(channel);
    });
  }

  logger.info("[AutonomousIPC] Unregistered all handlers");
}

module.exports = {
  AUTONOMOUS_CHANNELS,
  AUTONOMOUS_FORWARD_EVENTS,
  createRendererSender,
  registerAutonomousIPC,
  unregisterAutonomousIPC,
};
