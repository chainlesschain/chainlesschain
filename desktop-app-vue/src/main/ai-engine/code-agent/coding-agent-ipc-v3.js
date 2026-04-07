const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const CODING_AGENT_IPC_CHANNELS = [
  "coding-agent:create-session",
  "coding-agent:resume-session",
  "coding-agent:list-sessions",
  "coding-agent:send-message",
  "coding-agent:enter-plan-mode",
  "coding-agent:show-plan",
  "coding-agent:approve-plan",
  "coding-agent:confirm-high-risk-execution",
  "coding-agent:reject-plan",
  "coding-agent:close-session",
  "coding-agent:cancel-session",
  "coding-agent:get-session-state",
  "coding-agent:get-session-events",
  "coding-agent:list-worktrees",
  "coding-agent:get-worktree-diff",
  "coding-agent:preview-worktree-merge",
  "coding-agent:merge-worktree",
  "coding-agent:apply-worktree-automation",
  "coding-agent:get-status",
];

function registerCodingAgentIPCV3(options = {}) {
  const { service, ipcMain: injectedIpcMain } = options;

  const ipc = injectedIpcMain || ipcMain;

  if (!service) {
    throw new Error("registerCodingAgentIPCV3 requires a service instance");
  }

  logger.info("[CodingAgentIPCV3] Registering coding agent IPC handlers...");

  if (typeof ipc.removeHandler === "function") {
    CODING_AGENT_IPC_CHANNELS.forEach((channel) => ipc.removeHandler(channel));
  }

  ipc.handle("coding-agent:create-session", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      return await service.createSession(payload);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] create-session failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:resume-session", async (_event, sessionId) => {
    try {
      await service.ensureReady();
      return await service.resumeSession(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] resume-session failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:list-sessions", async () => {
    try {
      await service.ensureReady();
      return await service.listSessions();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] list-sessions failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:send-message", async (_event, payload = {}) => {
    try {
      return await service.sendMessage(payload.sessionId, payload.content);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] send-message failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:enter-plan-mode", async (_event, sessionId) => {
    try {
      return await service.enterPlanMode(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] enter-plan-mode failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:show-plan", async (_event, sessionId) => {
    try {
      return await service.showPlan(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] show-plan failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:approve-plan", async (_event, sessionId) => {
    try {
      return await service.approvePlan(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] approve-plan failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:confirm-high-risk-execution",
    async (_event, sessionId) => {
      try {
        return await service.confirmHighRiskExecution(sessionId);
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] confirm-high-risk-execution failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:reject-plan", async (_event, sessionId) => {
    try {
      return await service.rejectPlan(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] reject-plan failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:close-session", async (_event, sessionId) => {
    try {
      return await service.closeSession(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] close-session failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:cancel-session", async (_event, sessionId) => {
    try {
      return await service.cancelSession(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] cancel-session failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-session-state", async (_event, sessionId) => {
    try {
      return service.getSessionState(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-session-state failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-session-events", async (_event, sessionId) => {
    try {
      return service.getSessionEvents(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-session-events failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:list-worktrees", async () => {
    try {
      await service.ensureReady();
      return await service.listWorktrees();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] list-worktrees failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-worktree-diff", async (_event, payload = {}) => {
    try {
      return await service.getWorktreeDiff(payload.sessionId, payload);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-worktree-diff failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:preview-worktree-merge",
    async (_event, payload = {}) => {
      try {
        return await service.previewWorktreeMerge(payload.sessionId, payload);
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] preview-worktree-merge failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:merge-worktree", async (_event, payload = {}) => {
    try {
      return await service.mergeWorktree(payload.sessionId, payload);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] merge-worktree failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:apply-worktree-automation",
    async (_event, payload = {}) => {
      try {
        return await service.applyWorktreeAutomationCandidate(
          payload.sessionId,
          payload,
        );
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] apply-worktree-automation failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:get-status", async () => {
    try {
      return await service.getStatus();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-status failed:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  CODING_AGENT_IPC_CHANNELS,
  registerCodingAgentIPCV3,
};
