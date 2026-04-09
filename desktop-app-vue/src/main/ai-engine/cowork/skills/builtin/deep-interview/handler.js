/**
 * $deep-interview handler — step 1 of the canonical coding workflow.
 *
 * Writes intent.md to the session state dir and returns LLM guidance
 * that asks the agent to pull out any missing clarifications before
 * advancing to $ralplan.
 */

const path = require("path");
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
    `session-${Date.now()}`
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
      `[deep-interview] handler initialized for "${skill?.name || "deep-interview"}"`,
    );
  },

  async execute(task, context) {
    const goal = (task?.params?.goal || task?.action || "").trim();
    if (!goal) {
      return {
        success: false,
        error: "goal is required",
        message:
          '$deep-interview needs a goal. Try: $deep-interview "add OAuth to the API"',
      };
    }

    const clarifications = Array.isArray(task?.params?.clarifications)
      ? task.params.clarifications
      : [];
    const nonGoals = Array.isArray(task?.params?.nonGoals)
      ? task.params.nonGoals
      : [];

    const projectRoot = resolveProjectRoot(context);
    const sessionId = resolveSessionId(task, context);

    try {
      // pre-intent hook: can veto by throwing
      await _deps.runHook("pre-intent", {
        projectRoot,
        sessionId,
        payload: { goal, clarifications, nonGoals },
      });

      const manager = new _deps.SessionStateManager({ projectRoot });
      const intentFile = manager.writeIntent(sessionId, {
        goal,
        clarifications,
        nonGoals,
      });

      // post-intent hook: errors are logged but non-blocking
      await _deps.runHook("post-intent", {
        projectRoot,
        sessionId,
        payload: { intentFile, goal },
      });

      const relPath = path.relative(projectRoot, intentFile);
      return {
        success: true,
        result: {
          sessionId,
          intentFile,
          relativePath: relPath,
          stage: "intent",
        },
        message:
          `Intent captured → ${relPath}\n\n` +
          `Next: ask the user any remaining clarification questions, ` +
          `then run $ralplan to turn this intent into an approved plan.`,
        guidance: [
          "You are at stage INTENT of the canonical coding workflow.",
          "Review intent.md and ask the user any follow-up questions needed to",
          "resolve ambiguity in goal, scope, boundaries, or non-goals.",
          "When the user confirms the intent is complete, advance to $ralplan.",
        ].join(" "),
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `$deep-interview failed: ${err.message}`,
      };
    }
  },
};

module.exports._deps = _deps;
