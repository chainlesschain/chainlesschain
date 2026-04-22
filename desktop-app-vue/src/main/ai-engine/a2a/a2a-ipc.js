/**
 * @module ai-engine/a2a/a2a-ipc
 * Phase 81: A2A Protocol IPC handlers (8 handlers)
 */
const { ipcMain: electronIpcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const CHANNELS = [
  "a2a:discover-agents",
  "a2a:send-task",
  "a2a:get-task-status",
  "a2a:subscribe-updates",
  "a2a:register-card",
  "a2a:update-card",
  "a2a:list-peers",
  "a2a:negotiate-capability",
];

function registerA2AIPC(deps = {}) {
  const { a2aEngine, ipcMain: injectedIpcMain } = deps;
  const ipcMain = injectedIpcMain || electronIpcMain;

  ipcMain.handle("a2a:discover-agents", async (event, filter) => {
    try {
      if (!a2aEngine) {
        return { success: false, error: "A2A engine not available" };
      }
      return { success: true, data: a2aEngine.discoverAgents(filter || {}) };
    } catch (error) {
      logger.error("[A2A-IPC] discover-agents error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "a2a:send-task",
    async (event, { agentId, input, options }) => {
      try {
        if (!a2aEngine) {
          return { success: false, error: "A2A engine not available" };
        }
        const result = await a2aEngine.sendTask(agentId, input, options);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[A2A-IPC] send-task error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("a2a:get-task-status", async (event, taskId) => {
    try {
      if (!a2aEngine) {
        return { success: false, error: "A2A engine not available" };
      }
      const task = a2aEngine.getTaskStatus(taskId);
      if (!task) {
        return { success: false, error: "Task not found" };
      }
      return { success: true, data: task };
    } catch (error) {
      logger.error("[A2A-IPC] get-task-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("a2a:subscribe-updates", async (event, taskId) => {
    try {
      if (!a2aEngine) {
        return { success: false, error: "A2A engine not available" };
      }
      const subId = a2aEngine.subscribeToTask(taskId, () => {});
      return { success: true, data: { subscriptionId: subId } };
    } catch (error) {
      logger.error("[A2A-IPC] subscribe-updates error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("a2a:register-card", async (event, card) => {
    try {
      if (!a2aEngine) {
        return { success: false, error: "A2A engine not available" };
      }
      const result = a2aEngine.registerCard(card);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[A2A-IPC] register-card error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("a2a:update-card", async (event, { id, updates }) => {
    try {
      if (!a2aEngine) {
        return { success: false, error: "A2A engine not available" };
      }
      const result = a2aEngine.updateCard(id, updates);
      if (!result) {
        return { success: false, error: "Card not found" };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[A2A-IPC] update-card error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("a2a:list-peers", async () => {
    try {
      if (!a2aEngine) {
        return { success: false, error: "A2A engine not available" };
      }
      return { success: true, data: a2aEngine.listPeers() };
    } catch (error) {
      logger.error("[A2A-IPC] list-peers error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "a2a:negotiate-capability",
    async (event, { agentId, capabilities }) => {
      try {
        if (!a2aEngine) {
          return { success: false, error: "A2A engine not available" };
        }
        const result = a2aEngine.negotiateCapability(agentId, capabilities);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[A2A-IPC] negotiate-capability error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[A2A-IPC] Registered 8 A2A protocol handlers");
  return { handlerCount: CHANNELS.length };
}

function unregisterA2AIPC(deps = {}) {
  const ipcMain = deps.ipcMain || electronIpcMain;
  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* Intentionally empty */
    }
  }
  logger.info("[A2A-IPC] All handlers unregistered");
}

module.exports = { registerA2AIPC, unregisterA2AIPC, CHANNELS };
