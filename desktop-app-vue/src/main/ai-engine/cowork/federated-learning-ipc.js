/**
 * Federated Learning IPC Handlers — v4.0
 *
 * Registers 14 IPC channels for the Federated Learning subsystem:
 *   - Manager (8): task CRUD, join/leave, training lifecycle
 *   - Aggregator (6): aggregation, metrics, privacy configuration
 *
 * @module ai-engine/cowork/federated-learning-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");
const { FederatedLearningManager } = require("./federated-learning-manager");
const {
  FederatedLearningAggregator,
} = require("./federated-learning-aggregator");

let manager = null;
let aggregator = null;

function registerFederatedLearningIPC(dependencies = {}) {
  logger.info("[FL IPC] Registering handlers...");
  const { database, mainWindow } = dependencies;

  if (!manager) {
    manager = new FederatedLearningManager();
  }
  if (!aggregator) {
    aggregator = new FederatedLearningAggregator();
  }

  // ============================================================
  // Manager (8 channels)
  // ============================================================

  ipcMain.handle("fl:create-task", async (_event, { options }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const result = manager.createTask(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] create-task failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "fl:join-task",
    async (_event, { taskId, agentDid, options }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database);
        }
        const result = manager.joinTask(taskId, agentDid, options);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[FL IPC] join-task failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("fl:leave-task", async (_event, { taskId, agentDid }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const result = manager.leaveTask(taskId, agentDid);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] leave-task failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fl:start-training", async (_event, { taskId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const result = await manager.startTraining(taskId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] start-training failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "fl:submit-gradients",
    async (_event, { taskId, agentDid, gradients, options }) => {
      try {
        if (!manager.initialized) {
          await manager.initialize(database);
        }
        const result = await manager.submitGradients(
          taskId,
          agentDid,
          gradients,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[FL IPC] submit-gradients failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("fl:get-global-model", async (_event, { taskId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const result = manager.getGlobalModel(taskId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] get-global-model failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fl:get-task-status", async (_event, { taskId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const result = manager.getTaskStatus(taskId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] get-task-status failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fl:list-tasks", async (_event, { filter }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const result = manager.listTasks(filter);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] list-tasks failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Aggregator (6 channels)
  // ============================================================

  ipcMain.handle(
    "fl:aggregate-round",
    async (_event, { taskId, roundNumber, gradients, options }) => {
      try {
        if (!aggregator.initialized) {
          await aggregator.initialize(database);
        }
        // Convert plain object gradients to Map
        const gradientMap =
          gradients instanceof Map
            ? gradients
            : new Map(Object.entries(gradients));
        const result = await aggregator.aggregateRound(
          taskId,
          roundNumber,
          gradientMap,
          options,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[FL IPC] aggregate-round failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "fl:get-round-status",
    async (_event, { taskId, roundNumber }) => {
      try {
        if (!aggregator.initialized) {
          await aggregator.initialize(database);
        }
        const result = aggregator.getRoundStatus(taskId, roundNumber);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[FL IPC] get-round-status failed:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("fl:get-metrics", async (_event, { taskId }) => {
    try {
      if (!aggregator.initialized) {
        await aggregator.initialize(database);
      }
      const result = aggregator.getMetrics(taskId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FL IPC] get-metrics failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fl:get-participants", async (_event, { taskId }) => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      const status = manager.getTaskStatus(taskId);
      return {
        success: true,
        data: status ? { participantsCount: status.participantsCount } : null,
      };
    } catch (error) {
      logger.error("[FL IPC] get-participants failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fl:configure-privacy", async (_event, { config }) => {
    try {
      if (!aggregator.initialized) {
        await aggregator.initialize(database);
      }
      aggregator.configure(config);
      return { success: true, data: aggregator.getConfig() };
    } catch (error) {
      logger.error("[FL IPC] configure-privacy failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fl:get-stats", async () => {
    try {
      if (!manager.initialized) {
        await manager.initialize(database);
      }
      if (!aggregator.initialized) {
        await aggregator.initialize(database);
      }
      const managerStats = manager.getStats();
      const aggregatorStats = aggregator.getStats();
      return {
        success: true,
        data: { ...managerStats, ...aggregatorStats },
      };
    } catch (error) {
      logger.error("[FL IPC] get-stats failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Event forwarding
  // ============================================================

  if (manager) {
    manager.on("task:created", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("fl:task-created", data);
      }
    });
    manager.on("training:started", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("fl:training-started", data);
      }
    });
    manager.on("round:gradients-complete", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("fl:gradients-complete", data);
      }
    });
  }

  if (aggregator) {
    aggregator.on("round:aggregated", (data) => {
      if (mainWindow) {
        mainWindow.webContents.send("fl:round-aggregated", data);
      }
    });
  }

  logger.info("[FL IPC] Registered 14 handlers");
}

module.exports = {
  registerFederatedLearningIPC,
  getManager: () => manager,
  getAggregator: () => aggregator,
};
