/**
 * Federated Learning IPC Handlers
 *
 * Registers 10 IPC handlers for federated learning operations,
 * exposing the FederatedLearningManager to the renderer process.
 *
 * @module federated/federated-ipc
 * @version 1.0.0
 */

"use strict";

const { logger } = require("../utils/logger.js");

/**
 * Register all federated learning IPC handlers.
 *
 * @param {Object} options
 * @param {Object} options.federatedManager - FederatedLearningManager instance
 */
function registerFederatedIPC({ federatedManager }) {
  const { ipcMain } = require("electron");

  logger.info("[FederatedIPC] Registering 10 federated learning IPC handlers");

  // 1. Create a new federated learning round
  ipcMain.handle("federated:create-round", async (_event, { config }) => {
    try {
      logger.info("[FederatedIPC] Creating round", config);
      const round = await federatedManager.createRound(config);
      return { success: true, data: round };
    } catch (error) {
      logger.error("[FederatedIPC] Failed to create round:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 2. Join an existing round
  ipcMain.handle(
    "federated:join-round",
    async (_event, { roundId, peerId }) => {
      try {
        logger.info(
          `[FederatedIPC] Peer ${peerId} joining round ${roundId}`
        );
        const enrollment = await federatedManager.joinRound(roundId, peerId);
        return { success: true, data: enrollment };
      } catch (error) {
        logger.error("[FederatedIPC] Failed to join round:", error.message);
        return { success: false, error: error.message };
      }
    }
  );

  // 3. Leave a round
  ipcMain.handle(
    "federated:leave-round",
    async (_event, { roundId, peerId }) => {
      try {
        logger.info(
          `[FederatedIPC] Peer ${peerId} leaving round ${roundId}`
        );
        const result = await federatedManager.leaveRound(roundId, peerId);
        return { success: true, data: result };
      } catch (error) {
        logger.error("[FederatedIPC] Failed to leave round:", error.message);
        return { success: false, error: error.message };
      }
    }
  );

  // 4. Submit gradients
  ipcMain.handle(
    "federated:submit-gradients",
    async (_event, { roundId, peerId, gradients }) => {
      try {
        logger.info(
          `[FederatedIPC] Peer ${peerId} submitting gradients for round ${roundId}`
        );
        const result = await federatedManager.submitGradients(
          roundId,
          peerId,
          gradients
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[FederatedIPC] Failed to submit gradients:",
          error.message
        );
        return { success: false, error: error.message };
      }
    }
  );

  // 5. Run aggregation
  ipcMain.handle("federated:aggregate", async (_event, { roundId }) => {
    try {
      logger.info(`[FederatedIPC] Running aggregation for round ${roundId}`);
      const result = await federatedManager.aggregate(roundId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[FederatedIPC] Aggregation failed:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 6. Get round status
  ipcMain.handle("federated:get-status", async (_event, { roundId }) => {
    try {
      const status = await federatedManager.getStatus(roundId);
      return { success: true, data: status };
    } catch (error) {
      logger.error(
        "[FederatedIPC] Failed to get status:",
        error.message
      );
      return { success: false, error: error.message };
    }
  });

  // 7. List rounds with filters
  ipcMain.handle("federated:list-rounds", async (_event, { options }) => {
    try {
      const rounds = await federatedManager.listRounds(options);
      return { success: true, data: rounds };
    } catch (error) {
      logger.error("[FederatedIPC] Failed to list rounds:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 8. Set differential privacy configuration
  ipcMain.handle("federated:set-dp-config", async (_event, { config }) => {
    try {
      logger.info("[FederatedIPC] Setting DP config", config);
      const result = await federatedManager.setDPConfig(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[FederatedIPC] Failed to set DP config:",
        error.message
      );
      return { success: false, error: error.message };
    }
  });

  // 9. Get peers for a round
  ipcMain.handle("federated:get-peers", async (_event, { roundId }) => {
    try {
      const peers = await federatedManager.getPeers(roundId);
      return { success: true, data: peers };
    } catch (error) {
      logger.error("[FederatedIPC] Failed to get peers:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 10. Get global model info
  ipcMain.handle(
    "federated:get-global-model",
    async (_event, { roundId }) => {
      try {
        const model = await federatedManager.getGlobalModel(roundId);
        return { success: true, data: model };
      } catch (error) {
        logger.error(
          "[FederatedIPC] Failed to get global model:",
          error.message
        );
        return { success: false, error: error.message };
      }
    }
  );

  logger.info(
    "[FederatedIPC] All 10 federated learning IPC handlers registered"
  );
}

module.exports = { registerFederatedIPC };
