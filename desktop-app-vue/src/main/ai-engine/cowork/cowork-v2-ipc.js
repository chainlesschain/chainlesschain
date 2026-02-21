/**
 * Cowork v2.0.0 IPC Handlers
 *
 * Registers IPC handlers for cross-device collaboration modules:
 * - P2P Agent Network (12 handlers)
 * - Device Discovery (6 handlers)
 * - Hybrid Executor (5 handlers)
 * - Computer Use Bridge (6 handlers)
 * - Cowork API Server (5 handlers)
 * - Webhook Manager (7 handlers)
 *
 * Total: 41 IPC handlers
 *
 * @module ai-engine/cowork/cowork-v2-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

/**
 * Register all v2.0.0 IPC handlers
 * @param {Object} deps - Dependency instances
 */
function registerCoworkV2IPC(deps = {}) {
  const {
    p2pNetwork,
    deviceDiscovery,
    hybridExecutor,
    computerUseBridge,
    coworkAPIServer,
    webhookManager,
  } = deps;

  let handlerCount = 0;

  // ============================================================
  // P2P Agent Network (12 handlers)
  // ============================================================

  ipcMain.handle(
    "p2p-agent:get-remote-agents",
    async (_event, filters = {}) => {
      try {
        if (!p2pNetwork) {
          return { success: false, error: "P2PAgentNetwork unavailable" };
        }
        const agents = p2pNetwork.getRemoteAgents(filters);
        return { success: true, data: agents };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] get-remote-agents: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle("p2p-agent:find-for-skill", async (_event, skillId) => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      const agents = p2pNetwork.findAgentsForSkill(skillId);
      return { success: true, data: agents };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] find-for-skill: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("p2p-agent:delegate-task", async (_event, peerId, task) => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      const result = await p2pNetwork.delegateTask(peerId, task);
      return { success: true, data: result };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] delegate-task: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("p2p-agent:cancel-task", async (_event, taskId) => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      await p2pNetwork.cancelDelegatedTask(taskId);
      return { success: true };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] cancel-task: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("p2p-agent:query-skill", async (_event, skillId, timeout) => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      const responses = await p2pNetwork.queryRemoteSkill(skillId, timeout);
      return { success: true, data: responses };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] query-skill: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle(
    "p2p-agent:invite-to-team",
    async (_event, peerId, teamId, role) => {
      try {
        if (!p2pNetwork) {
          return { success: false, error: "P2PAgentNetwork unavailable" };
        }
        const accepted = await p2pNetwork.inviteToTeam(peerId, teamId, role);
        return { success: true, data: { accepted } };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] invite-to-team: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle("p2p-agent:sync-team", async (_event, teamId, teamState) => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      await p2pNetwork.syncTeamState(teamId, teamState);
      return { success: true };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] sync-team: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("p2p-agent:announce", async () => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      await p2pNetwork.announcePresence();
      return { success: true };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] announce: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("p2p-agent:get-stats", async () => {
    try {
      if (!p2pNetwork) {
        return { success: false, error: "P2PAgentNetwork unavailable" };
      }
      return { success: true, data: p2pNetwork.getStats() };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] p2p-stats: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  // ============================================================
  // Device Discovery (6 handlers)
  // ============================================================

  ipcMain.handle("device:get-all", async (_event, filters = {}) => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "DeviceDiscovery unavailable" };
      }
      const devices = deviceDiscovery.getDevices(filters);
      return { success: true, data: devices };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] get-devices: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("device:get-by-id", async (_event, deviceId) => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "DeviceDiscovery unavailable" };
      }
      const device = deviceDiscovery.getDevice(deviceId);
      return { success: true, data: device };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] get-device: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle(
    "device:find-for-skill",
    async (_event, skillId, requirements) => {
      try {
        if (!deviceDiscovery) {
          return { success: false, error: "DeviceDiscovery unavailable" };
        }
        const best = deviceDiscovery.getBestDeviceForSkill(
          skillId,
          requirements,
        );
        return { success: true, data: best };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] find-device: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle("device:get-network-skills", async () => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "DeviceDiscovery unavailable" };
      }
      const catalog = deviceDiscovery.getNetworkSkillCatalog();
      return { success: true, data: catalog };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] network-skills: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("device:get-stats", async () => {
    try {
      if (!deviceDiscovery) {
        return { success: false, error: "DeviceDiscovery unavailable" };
      }
      return { success: true, data: deviceDiscovery.getStats() };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] device-stats: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  // ============================================================
  // Hybrid Executor (5 handlers)
  // ============================================================

  ipcMain.handle("hybrid:execute", async (_event, task) => {
    try {
      if (!hybridExecutor) {
        return { success: false, error: "HybridExecutor unavailable" };
      }
      const result = await hybridExecutor.execute(task);
      return { success: true, data: result };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] hybrid-execute: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("hybrid:execute-batch", async (_event, tasks, options) => {
    try {
      if (!hybridExecutor) {
        return { success: false, error: "HybridExecutor unavailable" };
      }
      const results = await hybridExecutor.executeBatch(tasks, options);
      return { success: true, data: results };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] hybrid-batch: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("hybrid:get-stats", async () => {
    try {
      if (!hybridExecutor) {
        return { success: false, error: "HybridExecutor unavailable" };
      }
      return { success: true, data: hybridExecutor.getStats() };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] hybrid-stats: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  // ============================================================
  // Computer Use Bridge (6 handlers)
  // ============================================================

  ipcMain.handle(
    "cu-bridge:execute",
    async (_event, toolName, params, context) => {
      try {
        if (!computerUseBridge) {
          return { success: false, error: "ComputerUseBridge unavailable" };
        }
        const result = await computerUseBridge.executeAction(
          toolName,
          params,
          context,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] cu-execute: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle(
    "cu-bridge:share-recording",
    async (_event, recordingId, recording, sharedBy) => {
      try {
        if (!computerUseBridge) {
          return { success: false, error: "ComputerUseBridge unavailable" };
        }
        const shareId = computerUseBridge.shareRecording(
          recordingId,
          recording,
          sharedBy,
        );
        return { success: true, data: { shareId } };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] share-recording: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle("cu-bridge:list-recordings", async () => {
    try {
      if (!computerUseBridge) {
        return { success: false, error: "ComputerUseBridge unavailable" };
      }
      const recordings = computerUseBridge.listSharedRecordings();
      return { success: true, data: recordings };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] list-recordings: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle(
    "cu-bridge:replay-recording",
    async (_event, shareId, context) => {
      try {
        if (!computerUseBridge) {
          return { success: false, error: "ComputerUseBridge unavailable" };
        }
        const result = await computerUseBridge.replaySharedRecording(
          shareId,
          context,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] replay-recording: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle(
    "cu-bridge:get-permissions",
    async (_event, agentId, teamId) => {
      try {
        if (!computerUseBridge) {
          return { success: false, error: "ComputerUseBridge unavailable" };
        }
        const permissions = computerUseBridge.getAgentPermissions(
          agentId,
          teamId,
        );
        return { success: true, data: permissions };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] cu-permissions: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle("cu-bridge:get-stats", async () => {
    try {
      if (!computerUseBridge) {
        return { success: false, error: "ComputerUseBridge unavailable" };
      }
      return { success: true, data: computerUseBridge.getStats() };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] cu-stats: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  // ============================================================
  // Cowork API Server (5 handlers)
  // ============================================================

  ipcMain.handle("cowork-api:start", async (_event, options = {}) => {
    try {
      if (!coworkAPIServer) {
        return { success: false, error: "CoworkAPIServer unavailable" };
      }
      await coworkAPIServer.start();
      return { success: true, data: { port: coworkAPIServer.config.port } };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] api-start: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("cowork-api:stop", async () => {
    try {
      if (!coworkAPIServer) {
        return { success: false, error: "CoworkAPIServer unavailable" };
      }
      await coworkAPIServer.stop();
      return { success: true };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] api-stop: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("cowork-api:get-status", async () => {
    try {
      if (!coworkAPIServer) {
        return { success: false, error: "CoworkAPIServer unavailable" };
      }
      return {
        success: true,
        data: {
          running: coworkAPIServer.running,
          port: coworkAPIServer.config.port,
          sseClients: coworkAPIServer.sseClients.size,
        },
      };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] api-status: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle(
    "cowork-api:broadcast-sse",
    async (_event, eventType, data) => {
      try {
        if (!coworkAPIServer) {
          return { success: false, error: "CoworkAPIServer unavailable" };
        }
        coworkAPIServer.broadcastSSE(eventType, data);
        return { success: true };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] broadcast-sse: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  // ============================================================
  // Webhook Manager (7 handlers)
  // ============================================================

  ipcMain.handle("webhook:register", async (_event, config) => {
    try {
      if (!webhookManager) {
        return { success: false, error: "WebhookManager unavailable" };
      }
      const webhook = webhookManager.registerWebhook(config);
      return { success: true, data: webhook };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] webhook-register: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("webhook:unregister", async (_event, webhookId) => {
    try {
      if (!webhookManager) {
        return { success: false, error: "WebhookManager unavailable" };
      }
      webhookManager.unregisterWebhook(webhookId);
      return { success: true };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] webhook-unregister: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("webhook:update", async (_event, webhookId, updates) => {
    try {
      if (!webhookManager) {
        return { success: false, error: "WebhookManager unavailable" };
      }
      const webhook = webhookManager.updateWebhook(webhookId, updates);
      return { success: true, data: webhook };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] webhook-update: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("webhook:list", async () => {
    try {
      if (!webhookManager) {
        return { success: false, error: "WebhookManager unavailable" };
      }
      const webhooks = webhookManager.listWebhooks();
      return { success: true, data: webhooks };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] webhook-list: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle("webhook:dispatch", async (_event, eventType, data) => {
    try {
      if (!webhookManager) {
        return { success: false, error: "WebhookManager unavailable" };
      }
      await webhookManager.dispatch(eventType, data);
      return { success: true };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] webhook-dispatch: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  ipcMain.handle(
    "webhook:get-delivery-log",
    async (_event, webhookId, limit) => {
      try {
        if (!webhookManager) {
          return { success: false, error: "WebhookManager unavailable" };
        }
        const log = webhookManager.getDeliveryLog(webhookId, limit);
        return { success: true, data: log };
      } catch (error) {
        logger.error(`[CoworkV2 IPC] webhook-delivery-log: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );
  handlerCount++;

  ipcMain.handle("webhook:get-stats", async () => {
    try {
      if (!webhookManager) {
        return { success: false, error: "WebhookManager unavailable" };
      }
      return { success: true, data: webhookManager.getStats() };
    } catch (error) {
      logger.error(`[CoworkV2 IPC] webhook-stats: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  handlerCount++;

  logger.info(
    `[CoworkV2 IPC] Registered ${handlerCount} handlers (P2P:9, Device:5, Hybrid:3, CU-Bridge:6, API:4, Webhook:7)`,
  );

  return { handlerCount };
}

module.exports = { registerCoworkV2IPC };
