/**
 * Decentralized Network IPC Handlers — Agent DID & Federation (v4.0)
 *
 * Registers IPC handlers for the decentralized agent network:
 * Phase A: Agent DID (4) + Federated Registry (4) = 8 handlers
 * Phase B: Credentials (3) + Cross-org Tasks (4) = 7 handlers
 * Phase C: Reputation (4) + Config (1) = 5 handlers
 *
 * Total: 20 handlers
 *
 * @module ai-engine/cowork/decentralized-network-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const DECENTRALIZED_CHANNELS = [
  // Agent DID (4 — Phase A)
  "agent-did:create",
  "agent-did:resolve",
  "agent-did:get-all",
  "agent-did:revoke",

  // Federated Registry (4 — Phase A)
  "fed-registry:discover",
  "fed-registry:register",
  "fed-registry:query-skills",
  "fed-registry:get-network-stats",

  // Credentials (3 — Phase B)
  "agent-cred:issue",
  "agent-cred:verify",
  "agent-cred:revoke",

  // Cross-org Tasks (4 — Phase B)
  "cross-org:route-task",
  "cross-org:get-task-status",
  "cross-org:cancel-task",
  "cross-org:get-log",

  // Reputation (4 — Phase C)
  "reputation:get-score",
  "reputation:get-ranking",
  "reputation:update",
  "reputation:get-history",

  // Config (1 — Phase C)
  "decentralized:get-config",
];

/**
 * Register all decentralized network IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.agentDID - AgentDID instance
 * @param {Object} deps.federatedRegistry - FederatedAgentRegistry instance
 * @param {Object} [deps.credentialManager] - AgentCredentialManager instance
 * @param {Object} [deps.taskRouter] - CrossOrgTaskRouter instance
 * @param {Object} [deps.reputation] - AgentReputation instance
 * @param {Object} [deps.authenticator] - AgentAuthenticator instance
 * @returns {Object} Registration metadata
 */
function registerDecentralizedNetworkIPC(deps) {
  const {
    agentDID,
    federatedRegistry,
    credentialManager,
    taskRouter,
    reputation,
    authenticator,
  } = deps;

  // ============================================================
  // Agent DID (4 handlers — Phase A)
  // ============================================================

  ipcMain.handle("agent-did:create", async (_event, options) => {
    try {
      if (!agentDID?.initialized) {
        return { success: false, error: "AgentDID not initialized" };
      }
      const result = await agentDID.createDID(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DecentralizedIPC] agent-did:create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("agent-did:resolve", async (_event, options) => {
    try {
      if (!agentDID?.initialized) {
        return { success: false, error: "AgentDID not initialized" };
      }
      const { did } = options || {};
      if (!did) {
        return { success: false, error: "did is required" };
      }
      const result = agentDID.resolveDID(did);
      if (!result) {
        return { success: false, error: `DID not found: ${did}` };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] agent-did:resolve error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("agent-did:get-all", async (_event, filter) => {
    try {
      if (!agentDID?.initialized) {
        return { success: false, error: "AgentDID not initialized" };
      }
      const result = agentDID.getAllDIDs(filter || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] agent-did:get-all error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("agent-did:revoke", async (_event, options) => {
    try {
      if (!agentDID?.initialized) {
        return { success: false, error: "AgentDID not initialized" };
      }
      const { did, reason } = options || {};
      if (!did) {
        return { success: false, error: "did is required" };
      }
      const result = agentDID.revokeDID(did, reason);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DecentralizedIPC] agent-did:revoke error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Federated Registry (4 handlers — Phase A)
  // ============================================================

  ipcMain.handle("fed-registry:register", async (_event, options) => {
    try {
      if (!federatedRegistry?.initialized) {
        return {
          success: false,
          error: "FederatedAgentRegistry not initialized",
        };
      }
      const { agentDID: did, capabilities, organization } = options || {};
      const result = federatedRegistry.register(
        did,
        capabilities,
        organization,
        options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] fed-registry:register error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fed-registry:discover", async (_event, options) => {
    try {
      if (!federatedRegistry?.initialized) {
        return {
          success: false,
          error: "FederatedAgentRegistry not initialized",
        };
      }
      const result = await federatedRegistry.discover(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] fed-registry:discover error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fed-registry:query-skills", async (_event, options) => {
    try {
      if (!federatedRegistry?.initialized) {
        return {
          success: false,
          error: "FederatedAgentRegistry not initialized",
        };
      }
      const { skillName } = options || {};
      if (!skillName) {
        return { success: false, error: "skillName is required" };
      }
      const result = federatedRegistry.querySkills(skillName);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] fed-registry:query-skills error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("fed-registry:get-network-stats", async () => {
    try {
      if (!federatedRegistry?.initialized) {
        return {
          success: false,
          error: "FederatedAgentRegistry not initialized",
        };
      }
      const result = federatedRegistry.getNetworkStats();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] fed-registry:get-network-stats error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Credentials (3 handlers — Phase B)
  // ============================================================

  ipcMain.handle("agent-cred:issue", async (_event, options) => {
    try {
      if (!credentialManager?.initialized) {
        return {
          success: false,
          error: "AgentCredentialManager not initialized",
        };
      }
      const result = credentialManager.issueCredential(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DecentralizedIPC] agent-cred:issue error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("agent-cred:verify", async (_event, options) => {
    try {
      if (!credentialManager?.initialized) {
        return {
          success: false,
          error: "AgentCredentialManager not initialized",
        };
      }
      const { credentialId } = options || {};
      if (!credentialId) {
        return { success: false, error: "credentialId is required" };
      }
      const result = credentialManager.verifyCredential(credentialId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] agent-cred:verify error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("agent-cred:revoke", async (_event, options) => {
    try {
      if (!credentialManager?.initialized) {
        return {
          success: false,
          error: "AgentCredentialManager not initialized",
        };
      }
      const { credentialId, reason } = options || {};
      if (!credentialId) {
        return { success: false, error: "credentialId is required" };
      }
      const result = credentialManager.revokeCredential(credentialId, reason);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] agent-cred:revoke error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Cross-org Tasks (4 handlers — Phase B)
  // ============================================================

  ipcMain.handle("cross-org:route-task", async (_event, options) => {
    try {
      if (!taskRouter?.initialized) {
        return { success: false, error: "CrossOrgTaskRouter not initialized" };
      }
      const result = await taskRouter.routeTask(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] cross-org:route-task error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cross-org:get-task-status", async (_event, options) => {
    try {
      if (!taskRouter?.initialized) {
        return { success: false, error: "CrossOrgTaskRouter not initialized" };
      }
      const { taskId } = options || {};
      if (!taskId) {
        return { success: false, error: "taskId is required" };
      }
      const result = taskRouter.getTaskStatus(taskId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] cross-org:get-task-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cross-org:cancel-task", async (_event, options) => {
    try {
      if (!taskRouter?.initialized) {
        return { success: false, error: "CrossOrgTaskRouter not initialized" };
      }
      const { taskId } = options || {};
      if (!taskId) {
        return { success: false, error: "taskId is required" };
      }
      const result = taskRouter.cancelTask(taskId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] cross-org:cancel-task error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cross-org:get-log", async (_event, options) => {
    try {
      if (!taskRouter?.initialized) {
        return { success: false, error: "CrossOrgTaskRouter not initialized" };
      }
      const result = taskRouter.getTaskLog(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] cross-org:get-log error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Reputation (4 handlers — Phase C)
  // ============================================================

  ipcMain.handle("reputation:get-score", async (_event, options) => {
    try {
      if (!reputation?.initialized) {
        return { success: false, error: "AgentReputation not initialized" };
      }
      const { agentDID: did } = options || {};
      if (!did) {
        return { success: false, error: "agentDID is required" };
      }
      const result = reputation.getScore(did);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] reputation:get-score error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("reputation:get-ranking", async (_event, options) => {
    try {
      if (!reputation?.initialized) {
        return { success: false, error: "AgentReputation not initialized" };
      }
      const result = reputation.getRanking(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] reputation:get-ranking error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("reputation:update", async (_event, options) => {
    try {
      if (!reputation?.initialized) {
        return { success: false, error: "AgentReputation not initialized" };
      }
      const { agentDID: did, taskResult } = options || {};
      if (!did) {
        return { success: false, error: "agentDID is required" };
      }
      const result = reputation.updateScore(did, taskResult || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] reputation:update error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("reputation:get-history", async (_event, options) => {
    try {
      if (!reputation?.initialized) {
        return { success: false, error: "AgentReputation not initialized" };
      }
      const { agentDID: did, limit } = options || {};
      if (!did) {
        return { success: false, error: "agentDID is required" };
      }
      const result = reputation.getHistory(did, limit);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] reputation:get-history error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Config (1 handler — Phase C)
  // ============================================================

  ipcMain.handle("decentralized:get-config", async () => {
    try {
      const config = {};

      if (agentDID?.initialized) {
        config.agentDID = agentDID.getConfig();
      }
      if (federatedRegistry?.initialized) {
        config.federatedRegistry = federatedRegistry.getConfig();
        config.networkStats = federatedRegistry.getNetworkStats();
      }
      if (credentialManager?.initialized) {
        config.credentialManager = credentialManager.getConfig();
      }
      if (taskRouter?.initialized) {
        config.taskRouter = taskRouter.getConfig();
      }
      if (reputation?.initialized) {
        config.reputation = reputation.getConfig();
      }
      if (authenticator?.initialized) {
        config.authenticator = authenticator.getConfig();
      }

      return { success: true, data: config };
    } catch (error) {
      logger.error(
        "[DecentralizedIPC] decentralized:get-config error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[DecentralizedIPC] Registered ${DECENTRALIZED_CHANNELS.length} handlers`,
  );

  return { handlerCount: DECENTRALIZED_CHANNELS.length };
}

/**
 * Unregister all decentralized network IPC handlers
 */
function unregisterDecentralizedNetworkIPC() {
  for (const channel of DECENTRALIZED_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
  }
  logger.info("[DecentralizedIPC] Unregistered all handlers");
}

module.exports = {
  registerDecentralizedNetworkIPC,
  unregisterDecentralizedNetworkIPC,
  DECENTRALIZED_CHANNELS,
};
