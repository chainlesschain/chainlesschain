/**
 * EvoMap GEP Protocol — IPC Handlers
 *
 * Registers all IPC handlers for the EvoMap integration:
 * - Node management (5 handlers)
 * - Asset publishing (5 handlers)
 * - Asset discovery (5 handlers)
 * - Import (3 handlers)
 * - Task/Bounty (4 handlers)
 * - Config & Stats (3 handlers)
 *
 * Total: 25 handlers
 *
 * @module evomap/evomap-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

const EVOMAP_CHANNELS = [
  // Node management (5)
  "evomap:register",
  "evomap:get-status",
  "evomap:refresh-credits",
  "evomap:start-heartbeat",
  "evomap:stop-heartbeat",

  // Asset publishing (5)
  "evomap:publish-instinct",
  "evomap:publish-decision",
  "evomap:publish-bundle",
  "evomap:auto-publish",
  "evomap:approve-publish",

  // Asset discovery (5)
  "evomap:search-assets",
  "evomap:fetch-relevant",
  "evomap:get-asset-detail",
  "evomap:get-trending",
  "evomap:get-ranked",

  // Import (3)
  "evomap:import-as-skill",
  "evomap:import-as-instinct",
  "evomap:get-local-assets",

  // Task/Bounty (4)
  "evomap:list-tasks",
  "evomap:claim-task",
  "evomap:complete-task",
  "evomap:get-my-tasks",

  // Config & Stats (3)
  "evomap:get-config",
  "evomap:update-config",
  "evomap:get-sync-log",
];

/**
 * Register all EvoMap IPC handlers
 * @param {Object} deps - Module instances
 * @param {Object} deps.nodeManager - EvoMapNodeManager
 * @param {Object} deps.client - EvoMapClient
 * @param {Object} deps.synthesizer - EvoMapGeneSynthesizer
 * @param {Object} deps.bridge - EvoMapAssetBridge
 * @returns {{ handlerCount: number }}
 */
function registerEvoMapIPC(deps) {
  const { nodeManager, client, bridge } = deps;

  // ============================================================
  // Node Management (5 handlers)
  // ============================================================

  ipcMain.handle("evomap:register", async () => {
    try {
      if (!nodeManager?.initialized) {
        return { success: false, error: "EvoMapNodeManager not initialized" };
      }
      const result = await nodeManager.registerNode(client);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:register error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-status", async () => {
    try {
      if (!nodeManager?.initialized) {
        return { success: false, error: "EvoMapNodeManager not initialized" };
      }
      const status = nodeManager.getNodeStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:refresh-credits", async () => {
    try {
      if (!nodeManager?.initialized) {
        return { success: false, error: "EvoMapNodeManager not initialized" };
      }
      const credits = await nodeManager.refreshCredits(client);
      return { success: true, data: { credits } };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:refresh-credits error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:start-heartbeat", async () => {
    try {
      if (!nodeManager?.initialized) {
        return { success: false, error: "EvoMapNodeManager not initialized" };
      }
      nodeManager.startHeartbeat(client);
      return { success: true };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:start-heartbeat error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:stop-heartbeat", async () => {
    try {
      if (!nodeManager?.initialized) {
        return { success: false, error: "EvoMapNodeManager not initialized" };
      }
      nodeManager.stopHeartbeat();
      return { success: true };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:stop-heartbeat error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Asset Publishing (5 handlers)
  // ============================================================

  ipcMain.handle("evomap:publish-instinct", async (_event, instinctId) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.publishInstinct(instinctId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:publish-instinct error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:publish-decision", async (_event, decisionId) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.publishDecision(decisionId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:publish-decision error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "evomap:publish-bundle",
    async (_event, gene, capsule, evolutionEvent) => {
      try {
        if (!bridge?.initialized) {
          return { success: false, error: "EvoMapAssetBridge not initialized" };
        }
        const result = await bridge.publishBundle(
          gene,
          capsule,
          evolutionEvent,
        );
        return result;
      } catch (error) {
        logger.error("[EvoMapIPC] evomap:publish-bundle error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("evomap:auto-publish", async () => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.autoPublishEligible();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:auto-publish error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:approve-publish", async (_event, reviewId) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.approvePublish(reviewId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:approve-publish error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Asset Discovery (5 handlers)
  // ============================================================

  ipcMain.handle(
    "evomap:search-assets",
    async (_event, signals, type, sort) => {
      try {
        const result = await client.searchAssets(signals, type, sort);
        return result;
      } catch (error) {
        logger.error("[EvoMapIPC] evomap:search-assets error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("evomap:fetch-relevant", async (_event, signals, type) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.fetchRelevantAssets(signals, type);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:fetch-relevant error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-asset-detail", async (_event, assetId) => {
    try {
      const result = await client.getAssetDetail(assetId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-asset-detail error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-trending", async () => {
    try {
      const result = await client.getTrending();
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-trending error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-ranked", async (_event, type, limit) => {
    try {
      const result = await client.getRankedAssets(type, limit);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-ranked error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Import (3 handlers)
  // ============================================================

  ipcMain.handle("evomap:import-as-skill", async (_event, assetId) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.importAsSkill(assetId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:import-as-skill error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:import-as-instinct", async (_event, assetId) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const result = await bridge.importAsInstinct(assetId);
      return result;
    } catch (error) {
      logger.error(
        "[EvoMapIPC] evomap:import-as-instinct error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-local-assets", async (_event, filters) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const assets = bridge.getLocalAssets(filters || {});
      return { success: true, data: assets };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-local-assets error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Task/Bounty (4 handlers)
  // ============================================================

  ipcMain.handle("evomap:list-tasks", async (_event, reputation, limit) => {
    try {
      const result = await client.listTasks(reputation, limit);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:list-tasks error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:claim-task", async (_event, taskId) => {
    try {
      const result = await client.claimTask(taskId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:claim-task error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:complete-task", async (_event, taskId, assetId) => {
    try {
      const result = await client.completeTask(taskId, assetId);
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:complete-task error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-my-tasks", async () => {
    try {
      if (!nodeManager?.initialized) {
        return { success: false, error: "EvoMapNodeManager not initialized" };
      }
      const nodeId = nodeManager.getOrCreateNodeId();
      const result = await client.getNodeInfo(nodeId);
      if (result.success && result.data) {
        return { success: true, data: { tasks: result.data.tasks || [] } };
      }
      return result;
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-my-tasks error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Config & Stats (3 handlers)
  // ============================================================

  ipcMain.handle("evomap:get-config", async () => {
    try {
      const config = bridge ? bridge.getConfig() : {};
      const clientConfig = client ? client.getConfig() : {};
      return {
        success: true,
        data: {
          evomap: config,
          client: clientConfig,
        },
      };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:update-config", async (_event, newConfig) => {
    try {
      if (bridge) {
        bridge.setConfig(newConfig);
      }
      if (newConfig.hubUrl && client) {
        client.setHubUrl(newConfig.hubUrl);
      }

      // Persist to unified config
      try {
        const {
          getUnifiedConfigManager,
        } = require("../config/unified-config-manager.js");
        const configManager = getUnifiedConfigManager();
        configManager.set("evomap", newConfig);
      } catch (_e) {
        // config persistence is non-critical
      }

      return { success: true };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:update-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap:get-sync-log", async (_event, limit) => {
    try {
      if (!bridge?.initialized) {
        return { success: false, error: "EvoMapAssetBridge not initialized" };
      }
      const log = bridge.getSyncLog(limit || 50);
      return { success: true, data: log };
    } catch (error) {
      logger.error("[EvoMapIPC] evomap:get-sync-log error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[EvoMapIPC] Registered ${EVOMAP_CHANNELS.length} IPC handlers`);

  return { handlerCount: EVOMAP_CHANNELS.length };
}

/**
 * Unregister all EvoMap IPC handlers
 */
function unregisterEvoMapIPC() {
  for (const channel of EVOMAP_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info("[EvoMapIPC] Unregistered all handlers");
}

module.exports = {
  registerEvoMapIPC,
  unregisterEvoMapIPC,
  EVOMAP_CHANNELS,
};
