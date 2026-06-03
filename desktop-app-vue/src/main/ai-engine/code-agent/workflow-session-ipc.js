/**
 * workflow-session-ipc — Phase D of the canonical coding workflow.
 *
 * Read-only IPC bridge between the renderer (WorkflowMonitor page / Pinia
 * store) and SessionStateManager. The renderer needs per-session state
 * (stage / tasks / verify / progress) so the UI can converge on a single
 * "session view" instead of the legacy workflow-run view.
 *
 * Design notes:
 *   - Strictly READ-ONLY. Writes go through skill handlers
 *     ($deep-interview / $ralplan / $ralph / $team / $verify / $complete),
 *     which apply Gate V1/V3/V4 enforcement. The UI never self-writes.
 *   - SessionStateManager is instantiated per call via `_deps.createManager`
 *     so tests can stub it and the projectRoot can change at runtime
 *     (e.g. when the user opens a different workspace).
 *   - All handlers catch and return { success: false, error } so a corrupt
 *     session directory never crashes the main process.
 */

const { logger } = require("../../utils/logger.js");
const { SessionStateManager } = require("./session-state-manager.js");
const { classifyIntake } = require("./intake-classifier.js");

const CHANNELS = Object.freeze([
  "workflow-session:list",
  "workflow-session:get",
  "workflow-session:list-members",
  "workflow-session:classify-intake",
]);

const _deps = {
  createManager(projectRoot) {
    return new SessionStateManager({ projectRoot });
  },
};

function resolveProjectRoot(options) {
  if (typeof options.projectRoot === "function") {
    return options.projectRoot();
  }
  return options.projectRoot || process.cwd();
}

/**
 * Shape: { sessionId, stage, updatedAt, retries, maxRetries, failureReason }
 *
 * We intentionally keep the list payload small — the UI pulls full state
 * via `workflow-session:get` on selection.
 */
function summarizeSession(manager, sessionId) {
  const mode = manager.getStage(sessionId) || {};
  return {
    sessionId,
    stage: mode.stage || null,
    updatedAt: mode.updatedAt || null,
    retries: mode.retries || 0,
    maxRetries: mode.maxRetries || null,
    failureReason: mode.failureReason || null,
  };
}

/**
 * Full state bundle for a single session. Any missing file is reported
 * as null — the renderer decides how to render partial state.
 */
function loadFullState(manager, sessionId) {
  const mode = manager.getStage(sessionId);
  const plan = manager.readPlan(sessionId);
  return {
    sessionId,
    mode: mode || null,
    stage: mode?.stage || null,
    intent: manager.readIntent(sessionId),
    plan: plan
      ? { approved: plan.approved, updated: plan.updated, raw: plan.raw }
      : null,
    tasks: manager.readTasks(sessionId),
    verify: manager.readVerify(sessionId),
    progress: manager.readProgress(sessionId) || null,
    summary: manager.readSummary(sessionId),
    artifacts: manager.listArtifacts(sessionId),
  };
}

function registerWorkflowSessionIPC(options = {}) {
  const { ipcMain } = options;
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error(
      "registerWorkflowSessionIPC: ipcMain with .handle() is required",
    );
  }

  logger.info("[workflow-session-ipc] registering channels...");

  if (typeof ipcMain.removeHandler === "function") {
    CHANNELS.forEach((ch) => ipcMain.removeHandler(ch));
  }

  ipcMain.handle("workflow-session:list", async () => {
    try {
      const manager = _deps.createManager(resolveProjectRoot(options));
      const ids = manager.listSessions();
      const sessions = ids
        .map((id) => {
          try {
            return summarizeSession(manager, id);
          } catch (err) {
            logger.warn(`[workflow-session-ipc] skip "${id}": ${err.message}`);
            return null;
          }
        })
        .filter(Boolean);
      return { success: true, sessions };
    } catch (error) {
      logger.error("[workflow-session-ipc] list failed:", error);
      return { success: false, error: error.message, sessions: [] };
    }
  });

  ipcMain.handle("workflow-session:get", async (_event, sessionId) => {
    try {
      if (!sessionId) {
        return { success: false, error: "sessionId is required" };
      }
      const manager = _deps.createManager(resolveProjectRoot(options));
      // listSessions() is cheap and avoids throwing on "not found"
      if (!manager.listSessions().includes(sessionId)) {
        return {
          success: false,
          error: `session "${sessionId}" not found`,
        };
      }
      const state = loadFullState(manager, sessionId);
      return { success: true, state };
    } catch (error) {
      logger.error("[workflow-session-ipc] get failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "workflow-session:classify-intake",
    async (_event, input = {}) => {
      try {
        // Pure function — no manager needed. If `input.sessionId` is
        // provided, enrich with tasks.json scopes so text + task state
        // both vote on the decision.
        const enriched = { ...input };
        if (input.sessionId) {
          try {
            const manager = _deps.createManager(resolveProjectRoot(options));
            const tasks = manager.readTasks(input.sessionId);
            if (tasks) {
              enriched.tasks = tasks;
            }
          } catch (readErr) {
            logger.warn(
              `[workflow-session-ipc] classify-intake: tasks read failed: ${readErr.message}`,
            );
          }
        }
        const result = classifyIntake(enriched);
        return { success: true, classification: result };
      } catch (error) {
        logger.error("[workflow-session-ipc] classify-intake failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("workflow-session:list-members", async (_event, parentId) => {
    try {
      if (!parentId) {
        return { success: false, error: "parentId is required" };
      }
      const manager = _deps.createManager(resolveProjectRoot(options));
      const memberIds = manager.listMemberSessions(parentId);
      const members = memberIds.map((id) => summarizeSession(manager, id));
      return { success: true, members };
    } catch (error) {
      logger.error("[workflow-session-ipc] list-members failed:", error);
      return { success: false, error: error.message, members: [] };
    }
  });

  return { channels: CHANNELS.slice() };
}

module.exports = {
  registerWorkflowSessionIPC,
  CHANNELS,
  summarizeSession,
  loadFullState,
  _deps,
};
