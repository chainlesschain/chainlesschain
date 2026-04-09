/**
 * $complete handler — terminal step of the canonical coding workflow.
 *
 * Thin wrapper over SessionStateManager.markComplete (writeSummary).
 * All real policy enforcement lives in the state manager:
 *   - Gate V1: verify.json must exist
 *   - Gate V3: verify.status must be "passed"
 *
 * We do not reimplement those checks here; the write throws if either
 * gate is violated, and we surface the error directly.
 */

const { logger } = require("../../../../../utils/logger.js");
const {
  SessionStateManager,
} = require("../../../../code-agent/session-state-manager.js");
const { runHook } = require("../../../../code-agent/workflow-hook-runner.js");

const _deps = { SessionStateManager, runHook };

function resolveSessionId(task, context) {
  return (
    task?.params?.sessionId ||
    context?.sessionId ||
    context?.workflowSessionId ||
    null
  );
}

function resolveProjectRoot(context) {
  return (
    context?.projectRoot ||
    context?.workspaceRoot ||
    context?.cwd ||
    process.cwd()
  );
}

module.exports = {
  async init(skill) {
    logger.info(
      `[complete] handler initialized for "${skill?.name || "complete"}"`,
    );
  },

  async execute(task, context) {
    const projectRoot = resolveProjectRoot(context);
    const sessionId = resolveSessionId(task, context);
    if (!sessionId) {
      return {
        success: false,
        error: "sessionId is required",
        message:
          "$complete needs a sessionId from an approved workflow ($deep-interview → $ralplan)",
      };
    }

    const manager = new _deps.SessionStateManager({ projectRoot });
    const summary = task?.params?.summary || task?.action || null;

    try {
      await _deps.runHook("pre-complete", {
        projectRoot,
        sessionId,
        payload: { summary },
      });
    } catch (hookErr) {
      return {
        success: false,
        error: hookErr.message,
        message: `$complete vetoed by pre-complete hook: ${hookErr.message}`,
      };
    }

    let summaryFile;
    try {
      summaryFile = manager.markComplete(sessionId, summary);
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `$complete refused: ${err.message}`,
      };
    }

    try {
      await _deps.runHook("post-complete", {
        projectRoot,
        sessionId,
        payload: { summaryFile },
      });
    } catch (err) {
      logger.warn(`[complete] post-complete hook failed: ${err.message}`);
    }

    return {
      success: true,
      result: {
        sessionId,
        stage: "complete",
        mode: "complete",
        summaryFile,
      },
      message: `Session ${sessionId} marked complete. Summary → ${summaryFile}`,
      guidance: [
        "You are at stage COMPLETE of the canonical coding workflow.",
        "The session is terminal; no further skills should mutate its state.",
      ].join(" "),
    };
  },
};

module.exports._deps = _deps;
