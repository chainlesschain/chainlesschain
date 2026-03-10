"use strict";

const { logger } = require("../../utils/logger.js");

/**
 * Register Workflow Automation IPC handlers.
 *
 * 10 IPC handlers:
 * - automation:create-flow, automation:execute, automation:list-connectors
 * - automation:add-trigger, automation:test-flow, automation:get-logs
 * - automation:import-template, automation:share, automation:schedule, automation:get-stats
 *
 * @module enterprise/automation/automation-ipc
 * @param {Object} deps
 * @param {Object} deps.automationEngine - AutomationEngine instance (must be initialized)
 * @param {Object} [deps.ipcMain] - Optional injected ipcMain (for testing)
 */
function registerAutomationIPC({
  automationEngine,
  ipcMain: injectedIpcMain,
} = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  let registeredCount = 0;

  const safeHandle = (channel, handler) => {
    try {
      try {
        ipcMain.removeHandler(channel);
      } catch (_e) {
        /* ignore */
      }
      ipcMain.handle(channel, handler);
      registeredCount++;
    } catch (err) {
      logger.warn(
        `[Automation IPC] Failed to register ${channel}: ${err.message}`,
      );
    }
  };

  safeHandle("automation:create-flow", async (_event, definition) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.createFlow(definition || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:execute", async (_event, { flowId, input }) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = await automationEngine.executeFlow(flowId, input || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:list-connectors", async (_event, filter) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.listConnectors(filter || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:add-trigger", async (_event, { flowId, trigger }) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.addTrigger(flowId, trigger);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:test-flow", async (_event, { flowId, testInput }) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.testFlow(flowId, testInput || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:get-logs", async (_event, { flowId, options }) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.getExecutionLogs(flowId, options || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:import-template", async (_event, template) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.importTemplate(template);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:share", async (_event, flowId) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.shareFlow(flowId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:schedule", async (_event, { flowId, cron }) => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.scheduleFlow(flowId, cron);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("automation:get-stats", async () => {
    try {
      if (!automationEngine) {
        return { success: false, error: "Not available" };
      }
      const data = automationEngine.getStats();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  logger.info(`[Automation IPC] Registered ${registeredCount} handlers`);
  return { handlerCount: registeredCount };
}

module.exports = { registerAutomationIPC };
