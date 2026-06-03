/**
 * @module blockchain/dao-v2-ipc
 * Phase 92: DAO Governance v2 IPC handlers
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerDAOv2IPC(deps) {
  const { daoGovernanceV2 } = deps;

  ipcMain.handle("dao:create-proposal", async (event, args) => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const { title, description, proposer, options } = args;
      const result = daoGovernanceV2.createProposal(
        title,
        description,
        proposer,
        options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] create-proposal error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:vote", async (event, args) => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const { proposalId, voter, direction, weight } = args;
      const result = daoGovernanceV2.vote(proposalId, voter, direction, weight);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] vote error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:delegate", async (event, args) => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const { delegator, delegate, weight } = args;
      const result = daoGovernanceV2.delegate(delegator, delegate, weight);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] delegate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:execute", async (event, args) => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const { proposalId } = args;
      const result = daoGovernanceV2.execute(proposalId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] execute error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:get-treasury", async () => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const result = daoGovernanceV2.getTreasury();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] get-treasury error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:allocate-funds", async (event, args) => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const { proposalId, amount, description } = args;
      const result = daoGovernanceV2.allocateFunds(
        proposalId,
        amount,
        description,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] allocate-funds error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:get-governance-stats", async () => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const result = daoGovernanceV2.getGovernanceStats();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] get-governance-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dao:configure", async (event, args) => {
    try {
      if (!daoGovernanceV2) {
        return { success: false, error: "DAO Governance not available" };
      }
      const { config } = args;
      const result = daoGovernanceV2.configure(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DAOv2IPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[DAOv2IPC] Registered 8 handlers");
}

module.exports = { registerDAOv2IPC };
