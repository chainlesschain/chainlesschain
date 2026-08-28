const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { logger } = require("../../utils/logger.js");
const { ArtifactWorkbenchClient } = require("./artifact-workbench-client.js");
const {
  runWorkflowCommand,
  isWorkflowCommand,
} = require("./workflow-command-runner.js");

const APP_SERVER_PILOT_IPC_CHANNELS = [
  "coding-agent:app-server-pilot-status",
  "coding-agent:app-server-pilot-start",
  "coding-agent:app-server-pilot-close",
  "coding-agent:app-server-thread-start",
  "coding-agent:app-server-thread-resume",
  "coding-agent:app-server-thread-fork",
  "coding-agent:app-server-thread-read",
  "coding-agent:app-server-thread-list",
  "coding-agent:app-server-thread-archive",
  "coding-agent:app-server-turn-start",
  "coding-agent:app-server-turn-interrupt",
];

const CODING_AGENT_IPC_CHANNELS = [
  "coding-agent:create-session",
  "coding-agent:start-session",
  "coding-agent:resume-session",
  "coding-agent:list-sessions",
  "coding-agent:get-permission-rules",
  "coding-agent:set-permission-rule",
  "coding-agent:create-remote-session",
  "coding-agent:refresh-remote-session-pairing",
  "coding-agent:list-remote-session-devices",
  "coding-agent:revoke-remote-session-device",
  "coding-agent:remote-session-audit",
  "coding-agent:remote-session-policy",
  "coding-agent:close-remote-session",
  "coding-agent:send-message",
  "coding-agent:respond-elicitation",
  "coding-agent:enter-plan-mode",
  "coding-agent:show-plan",
  "coding-agent:approve-plan",
  "coding-agent:confirm-high-risk-execution",
  "coding-agent:respond-approval",
  "coding-agent:list-approval-grants",
  "coding-agent:revoke-approval-grant",
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
  "coding-agent:get-artifact-workbench",
  "coding-agent:open-artifact",
  "coding-agent:download-artifact",
  "coding-agent:remove-artifact",
  "coding-agent:adjudicate-artifact-recovery",
  ...APP_SERVER_PILOT_IPC_CHANNELS,
];

function stableDesktopArtifactOperationId(prefix, material) {
  const digest = createHash("sha256")
    .update("chainlesschain.desktop.artifact-operation.v1\0", "utf8")
    .update(JSON.stringify(material), "utf8")
    .digest("hex");
  return `${prefix}_${digest}`;
}

function registerCodingAgentIPCV3(options = {}) {
  const { service, ipcMain: injectedIpcMain } = options;
  const appServerPilot = options.appServerPilot || null;

  if (!service) {
    throw new Error("registerCodingAgentIPCV3 requires a service instance");
  }

  // Keep Electron acquisition lazy: injected test/embedded hosts must not
  // accidentally gain desktop shell or dialog authority.
  const electronRuntime = injectedIpcMain ? null : require("electron");
  const ipc = injectedIpcMain || electronRuntime.ipcMain;
  const artifactClient =
    options.artifactClient ||
    new ArtifactWorkbenchClient({
      repoRoot: service.repoRoot,
      cliEntry: service.bridge?.cliEntry,
    });
  const electronShell = options.shell || electronRuntime?.shell || null;
  const electronDialog = options.dialog || electronRuntime?.dialog || null;
  const runtimeFs = options.fs || fs;

  logger.info("[CodingAgentIPCV3] Registering coding agent IPC handlers...");

  if (typeof ipc.removeHandler === "function") {
    CODING_AGENT_IPC_CHANNELS.forEach((channel) => ipc.removeHandler(channel));
  }

  const pilotDisabled = () => ({
    success: false,
    code: "ERR_APP_SERVER_PILOT_DISABLED",
    error:
      "CC App Server Desktop pilot is disabled; set " +
      "CHAINLESSCHAIN_CC_APP_SERVER_PILOT=1 before startup",
  });
  const runPilot = async (operation, payload) => {
    if (!appServerPilot) return pilotDisabled();
    try {
      const result = await appServerPilot[operation](payload);
      return { success: true, result };
    } catch (error) {
      logger.error(`[CodingAgentIPCV3] App Server ${operation} failed:`, error);
      return {
        success: false,
        code: error?.code || "ERR_APP_SERVER_PILOT",
        error: error?.message || String(error),
      };
    }
  };

  ipc.handle("coding-agent:app-server-pilot-status", async () => ({
    success: true,
    ...(appServerPilot?.status || {
      enabled: false,
      surface: "desktop",
      running: false,
      initialized: false,
      pendingRequestCount: 0,
      capabilities: null,
      lastError: null,
    }),
  }));
  ipc.handle("coding-agent:app-server-pilot-start", () => runPilot("start"));
  ipc.handle("coding-agent:app-server-pilot-close", () => runPilot("close"));
  for (const [channel, operation] of [
    ["coding-agent:app-server-thread-start", "threadStart"],
    ["coding-agent:app-server-thread-resume", "threadResume"],
    ["coding-agent:app-server-thread-fork", "threadFork"],
    ["coding-agent:app-server-thread-read", "threadRead"],
    ["coding-agent:app-server-thread-list", "threadList"],
    ["coding-agent:app-server-thread-archive", "threadArchive"],
    ["coding-agent:app-server-turn-start", "turnStart"],
    ["coding-agent:app-server-turn-interrupt", "turnInterrupt"],
  ]) {
    ipc.handle(channel, (_event, payload = {}) => runPilot(operation, payload));
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

  ipc.handle("coding-agent:get-artifact-workbench", async () => {
    try {
      const workbench = await artifactClient.workbench();
      return { success: true, workbench };
    } catch (error) {
      logger.error("[CodingAgentIPCV3] artifact workbench failed:", error);
      return { success: false, error: "Artifact workbench is unavailable" };
    }
  });

  ipc.handle("coding-agent:open-artifact", async (_event, payload = {}) => {
    try {
      const authorization = await artifactClient.access({
        artifactId: payload.artifactId,
        action: "preview",
        accessId: `access_desktop_${randomUUID().replaceAll("-", "")}`,
      });
      if (!authorization.storedPath || !electronShell?.openPath) {
        throw new Error("artifact open authority is unavailable");
      }
      const openError = await electronShell.openPath(authorization.storedPath);
      if (openError) {
        throw new Error("desktop shell rejected artifact open");
      }
      return {
        success: true,
        artifactId: authorization.access.artifactId,
        eventDigest: authorization.access.eventDigest,
      };
    } catch (error) {
      logger.error("[CodingAgentIPCV3] artifact open failed:", error);
      return { success: false, error: "Artifact open was not authorized" };
    }
  });

  ipc.handle("coding-agent:download-artifact", async (_event, payload = {}) => {
    try {
      const authorization = await artifactClient.access({
        artifactId: payload.artifactId,
        action: "download",
        accessId: `access_desktop_${randomUUID().replaceAll("-", "")}`,
      });
      if (!authorization.storedPath || !electronDialog?.showSaveDialog) {
        throw new Error("artifact download authority is unavailable");
      }
      const selected = await electronDialog.showSaveDialog({
        title: "Download reviewed artifact",
        defaultPath: path.basename(authorization.storedPath),
      });
      if (selected.canceled || !selected.filePath) {
        return { success: true, canceled: true };
      }
      await runtimeFs.promises.copyFile(
        authorization.storedPath,
        selected.filePath,
      );
      return {
        success: true,
        canceled: false,
        artifactId: authorization.access.artifactId,
        eventDigest: authorization.access.eventDigest,
      };
    } catch (error) {
      logger.error("[CodingAgentIPCV3] artifact download failed:", error);
      return { success: false, error: "Artifact download was not authorized" };
    }
  });

  ipc.handle("coding-agent:remove-artifact", async (_event, payload = {}) => {
    try {
      const result = await artifactClient.remove({
        artifactId: payload.artifactId,
        deletionId: stableDesktopArtifactOperationId("delete_desktop", {
          artifactId: payload.artifactId,
        }),
      });
      return {
        success: result.settled === true,
        receipt: {
          schema: result.schema,
          artifactId: result.artifactId,
          deletionId: result.deletionId,
          found: result.found === true,
          settled: result.settled === true,
          recorded: result.recorded === true,
          eventDigest: result.deletion?.eventDigest || null,
        },
      };
    } catch (error) {
      logger.error("[CodingAgentIPCV3] artifact removal failed:", error);
      return { success: false, error: "Artifact removal was not settled" };
    }
  });

  ipc.handle(
    "coding-agent:adjudicate-artifact-recovery",
    async (_event, payload = {}) => {
      try {
        const result = await artifactClient.adjudicate({
          itemId: payload.itemId,
          planDigest: payload.planDigest,
          decision: payload.decision,
          adjudicationId: stableDesktopArtifactOperationId(
            "artifact_adjudication_desktop",
            {
              itemId: payload.itemId,
              planDigest: payload.planDigest,
              decision: payload.decision,
            },
          ),
        });
        return {
          success: result.settled === true || payload.decision === "defer",
          receipt: {
            schema: result.schema,
            adjudicationId: result.adjudicationId,
            itemId: result.itemId,
            planDigest: result.planDigest,
            decision: result.decision,
            settled: result.settled === true,
            recorded: result.recorded === true,
            mutationPerformed: result.mutationPerformed === true,
            eventDigest:
              result.gc?.eventDigest ||
              result.result?.deletion?.eventDigest ||
              result.result?.cleanup?.eventDigest ||
              null,
          },
        };
      } catch (error) {
        logger.error("[CodingAgentIPCV3] artifact recovery failed:", error);
        return { success: false, error: "Artifact recovery was not settled" };
      }
    },
  );

  ipc.handle("coding-agent:get-permission-rules", async () => {
    try {
      return await service.getPermissionRules();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] get-permission-rules failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:set-permission-rule",
    async (_event, payload = {}) => {
      try {
        return await service.setPermissionRule(payload);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] set-permission-rule failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle(
    "coding-agent:create-remote-session",
    async (_event, payload = {}) => {
      try {
        await service.ensureReady();
        return await service.createRemoteSession(payload.sessionId, payload);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] create-remote-session failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle(
    "coding-agent:refresh-remote-session-pairing",
    async (_event, payload = {}) => {
      try {
        return await service.refreshRemoteSessionPairing(
          payload.remoteSessionId,
          payload.scopes,
        );
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] refresh-remote-session-pairing failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle(
    "coding-agent:list-remote-session-devices",
    async (_event, remoteSessionId) => {
      try {
        return await service.listRemoteSessionDevices(remoteSessionId);
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] list-remote-session-devices failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle(
    "coding-agent:revoke-remote-session-device",
    async (_event, payload = {}) => {
      try {
        return await service.revokeRemoteSessionDevice(
          payload.remoteSessionId,
          payload.clientId,
        );
      } catch (error) {
        logger.error(
          "[CodingAgentIPCV3] revoke-remote-session-device failed:",
          error,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle(
    "coding-agent:remote-session-audit",
    async (_event, payload = {}) => {
      try {
        return await service.getRemoteSessionAudit(
          payload.remoteSessionId,
          payload.limit,
        );
      } catch (error) {
        logger.error("[CodingAgentIPCV3] remote-session-audit failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:remote-session-policy", async () => {
    try {
      return await service.getRemoteSessionPolicy();
    } catch (error) {
      logger.error("[CodingAgentIPCV3] remote-session-policy failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:close-remote-session",
    async (_event, remoteSessionId) => {
      try {
        return await service.closeRemoteSession(remoteSessionId);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] close-remote-session failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipc.handle("coding-agent:send-message", async (_event, payload = {}) => {
    try {
      return await service.sendMessage(payload.sessionId, payload.content);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] send-message failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:respond-elicitation",
    async (_event, payload = {}) => {
      try {
        const respond =
          typeof service.respondQuestion === "function"
            ? service.respondQuestion.bind(service)
            : service.respondElicitation.bind(service);
        return await respond(payload.sessionId, payload);
      } catch (error) {
        logger.error("[CodingAgentIPCV3] respond-question failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

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

  ipc.handle("coding-agent:list-approval-grants", async (_event, sessionId) => {
    try {
      return await service.listApprovalGrants(sessionId);
    } catch (error) {
      logger.error("[CodingAgentIPCV3] list-approval-grants failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipc.handle(
    "coding-agent:revoke-approval-grant",
    async (_event, payload = {}) => {
      try {
        return await service.revokeApprovalGrant(
          payload.sessionId,
          payload.grantId,
        );
      } catch (error) {
        logger.error("[CodingAgentIPCV3] revoke-approval-grant failed:", error);
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
          // Main-process-only fixed capability. Renderer payload cannot
          // replace this object or gain the generic App Server request API.
          appServerPilot,
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

  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (typeof ipc.removeHandler === "function") {
      CODING_AGENT_IPC_CHANNELS.forEach((channel) =>
        ipc.removeHandler(channel),
      );
    }
  };
}

module.exports = {
  APP_SERVER_PILOT_IPC_CHANNELS,
  CODING_AGENT_IPC_CHANNELS,
  registerCodingAgentIPCV3,
};
