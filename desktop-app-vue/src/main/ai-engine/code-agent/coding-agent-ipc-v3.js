const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");
const {
  runWorkflowCommand,
  isWorkflowCommand,
} = require("./workflow-command-runner.js");

const CODING_AGENT_IPC_CHANNELS = [
  "coding-agent:create-session",
  "coding-agent:start-session",
  "coding-agent:resume-session",
  "coding-agent:list-sessions",
  "coding-agent:send-message",
  "coding-agent:enter-plan-mode",
  "coding-agent:show-plan",
  "coding-agent:approve-plan",
  "coding-agent:confirm-high-risk-execution",
  "coding-agent:respond-approval",
  "coding-agent:reject-plan",
  "coding-agent:close-session",
  "coding-agent:cancel-session",
  "coding-agent:interrupt",
  "coding-agent:get-session-state",
  "coding-agent:get-session-events",
  "coding-agent:get-harness-status",
  "coding-agent:list-background-tasks",
  "coding-agent:get-background-task",
  "coding-agent:get-background-task-history",
  "coding-agent:stop-background-task",
  "coding-agent:list-worktrees",
  "coding-agent:get-worktree-diff",
  "coding-agent:preview-worktree-merge",
  "coding-agent:merge-worktree",
  "coding-agent:apply-worktree-automation",
  "coding-agent:list-sub-agents",
  "coding-agent:get-sub-agent",
  "coding-agent:enter-review",
  "coding-agent:submit-review-comment",
  "coding-agent:resolve-review",
  "coding-agent:get-review-state",
  "coding-agent:propose-patch",
  "coding-agent:apply-patch",
  "coding-agent:reject-patch",
  "coding-agent:get-patch-summary",
  "coding-agent:create-task-graph",
  "coding-agent:add-task-node",
  "coding-agent:update-task-node",
  "coding-agent:advance-task-graph",
  "coding-agent:get-task-graph",
  "coding-agent:get-status",
  "coding-agent:run-workflow-command",
  "coding-agent:check-workflow-command",
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

  const handleCreateSession = async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      return await service.createSession(payload);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] create-session failed:", error);
      return { success: false, error: error.message };
    }
  };
  ipc.handle("coding-agent:create-session", handleCreateSession);
  ipc.handle("coding-agent:start-session", handleCreateSession);

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

  ipc.handle("coding-agent:respond-approval", async (_event, payload = {}) => {
    try {
      return await service.respondApproval(payload.sessionId, payload);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] respond-approval failed:", error);
      return { success: false, error: error.message };
    }
  });

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

  const handleCancelSession = async (_event, sessionId) => {
    try {
      return await service.cancelSession(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] cancel-session failed:", error);
      return { success: false, error: error.message };
    }
  };
  ipc.handle("coding-agent:cancel-session", handleCancelSession);
  ipc.handle("coding-agent:interrupt", async (_event, sessionId) => {
    try {
      return await service.interruptSession(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] interrupt failed:", error);
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

  ipc.handle("coding-agent:get-harness-status", async () => {
    try {
      return await service.getHarnessStatus();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-harness-status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:list-background-tasks",
    async (_event, payload = {}) => {
      try {
        return await service.listBackgroundTasks(payload);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] list-background-tasks failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:get-background-task", async (_event, taskId) => {
    try {
      return await service.getBackgroundTask(taskId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-background-task failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:get-background-task-history",
    async (_event, payload = {}) => {
      try {
        return await service.getBackgroundTaskHistory(payload.taskId, payload);
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] get-background-task-history failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:stop-background-task", async (_event, taskId) => {
    try {
      return await service.stopBackgroundTask(taskId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] stop-background-task failed:", error);
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

  ipc.handle("coding-agent:list-sub-agents", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId =
        typeof payload === "string" ? payload : payload?.sessionId || null;
      return await service.listSubAgents(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] list-sub-agents failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-sub-agent", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const subAgentId =
        typeof payload === "string" ? payload : payload?.subAgentId;
      const sessionId =
        typeof payload === "string" ? null : payload?.sessionId || null;
      if (!subAgentId) {
        return {
          success: false,
          error: "subAgentId is required",
        };
      }
      return await service.getSubAgent(subAgentId, sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-sub-agent failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:enter-review", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId =
        typeof payload === "string" ? payload : payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      const options = typeof payload === "string" ? {} : payload;
      return await service.enterReview(sessionId, {
        reason: options.reason,
        requestedBy: options.requestedBy,
        checklist: options.checklist,
        blocking: options.blocking,
      });
    } catch (error) {
      logger.error("[CodingAgentIPCV3] enter-review failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:submit-review-comment",
    async (_event, payload = {}) => {
      try {
        await service.ensureReady();
        const sessionId = payload?.sessionId;
        if (!sessionId) {
          return { success: false, error: "sessionId is required" };
        }
        return await service.submitReviewComment(sessionId, {
          comment: payload.comment,
          checklistItemId: payload.checklistItemId,
          checklistItemDone: payload.checklistItemDone,
          checklistItemNote: payload.checklistItemNote,
        });
      } catch (error) {
        logger.error("[CodingAgentIPCV3] submit-review-comment failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:resolve-review", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      return await service.resolveReview(sessionId, {
        decision: payload.decision,
        resolvedBy: payload.resolvedBy,
        summary: payload.summary,
      });
    } catch (error) {
      logger.error("[CodingAgentIPCV3] resolve-review failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-review-state", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId =
        typeof payload === "string" ? payload : payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      return await service.getReviewState(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-review-state failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:propose-patch", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      return await service.proposePatch(sessionId, {
        files: payload.files,
        origin: payload.origin,
        reason: payload.reason,
        requestId: payload.requestId,
      });
    } catch (error) {
      logger.error("[CodingAgentIPCV3] propose-patch failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:apply-patch", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      if (!payload.patchId) {
        return { success: false, error: "patchId is required" };
      }
      return await service.applyPatch(sessionId, payload.patchId, {
        resolvedBy: payload.resolvedBy,
        note: payload.note,
      });
    } catch (error) {
      logger.error("[CodingAgentIPCV3] apply-patch failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:reject-patch", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      if (!payload.patchId) {
        return { success: false, error: "patchId is required" };
      }
      return await service.rejectPatch(sessionId, payload.patchId, {
        resolvedBy: payload.resolvedBy,
        reason: payload.reason,
      });
    } catch (error) {
      logger.error("[CodingAgentIPCV3] reject-patch failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-patch-summary", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId =
        typeof payload === "string" ? payload : payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      return await service.getPatchSummary(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-patch-summary failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:create-task-graph", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      return await service.createTaskGraph(sessionId, {
        graphId: payload.graphId,
        title: payload.title,
        description: payload.description,
        nodes: payload.nodes,
      });
    } catch (error) {
      logger.error("[CodingAgentIPCV3] create-task-graph failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:add-task-node", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      if (!payload.node || !payload.node.id) {
        return { success: false, error: "node.id is required" };
      }
      return await service.addTaskNode(sessionId, payload.node);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] add-task-node failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:update-task-node", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId = payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      if (!payload.nodeId) {
        return { success: false, error: "nodeId is required" };
      }
      return await service.updateTaskNode(
        sessionId,
        payload.nodeId,
        payload.updates || {},
      );
    } catch (error) {
      logger.error("[CodingAgentIPCV3] update-task-node failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:advance-task-graph",
    async (_event, payload = {}) => {
      try {
        await service.ensureReady();
        const sessionId =
          typeof payload === "string" ? payload : payload?.sessionId;
        if (!sessionId) {
          return { success: false, error: "sessionId is required" };
        }
        return await service.advanceTaskGraph(sessionId);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] advance-task-graph failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:get-task-graph", async (_event, payload = {}) => {
    try {
      await service.ensureReady();
      const sessionId =
        typeof payload === "string" ? payload : payload?.sessionId;
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      return await service.getTaskGraph(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-task-graph failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle("coding-agent:get-status", async () => {
    try {
      return await service.getStatus();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-status failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ── Canonical workflow commands ($deep-interview / $ralplan / $ralph / $team)
  // These do NOT go through the CLI WS bridge. Workflow state is project-local
  // under <projectRoot>/.chainlesschain/sessions/ and the handlers execute in
  // the Electron main process directly.
  ipc.handle("coding-agent:check-workflow-command", async (_event, text) => {
    try {
      return { matched: isWorkflowCommand(text) };
    } catch (error) {
      logger.error("[CodingAgentIPCV3] check-workflow-command failed:", error);
      return { matched: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:run-workflow-command",
    async (_event, payload = {}) => {
      try {
        const { text, sessionId, projectRoot } = payload;
        if (!text || typeof text !== "string") {
          return {
            success: false,
            matched: false,
            error: "text is required",
          };
        }
        const ctx = {
          sessionId: sessionId || undefined,
          projectRoot: projectRoot || service.projectRoot || process.cwd(),
        };
        return await runWorkflowCommand(text, ctx);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] run-workflow-command failed:", error);
        return {
          success: false,
          matched: false,
          error: error.message,
        };
      }
    },
  );
}

module.exports = {
  CODING_AGENT_IPC_CHANNELS,
  registerCodingAgentIPCV3,
};
