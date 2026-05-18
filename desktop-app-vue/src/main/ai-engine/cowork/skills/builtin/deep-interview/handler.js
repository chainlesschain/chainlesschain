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
const {
  classifyIntake,
} = require("../../../../code-agent/intake-classifier.js");

const _deps = { SessionStateManager, runHook, classifyIntake };

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
    const scopePaths = Array.isArray(task?.params?.scopePaths)
      ? task.params.scopePaths
      : [];
    const fileHints = Array.isArray(task?.params?.fileHints)
      ? task.params.fileHints
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

      // Classifier is pure & side-effect-free — cheap hint for the next step.
      // It does NOT gate anything; the user/LLM still chooses $ralph vs $team.
      let routingHint = null;
      try {
        routingHint = _deps.classifyIntake({
          request: goal,
          scopePaths,
          fileHints,
          sessionId,
        });
        // Persist onto mode.json so $ralplan / UI can read it later without
        // re-running the classifier. Non-fatal if the write fails.
        if (routingHint) {
          try {
            manager.setRoutingHint(sessionId, routingHint);
          } catch (persistErr) {
            logger.warn(
              `[deep-interview] setRoutingHint failed (non-fatal): ${persistErr.message}`,
            );
          }
        }
      } catch (classifyErr) {
        logger.warn(
          `[deep-interview] classifyIntake failed (non-fatal): ${classifyErr.message}`,
        );
      }

      const relPath = path.relative(projectRoot, intentFile);
      const hintSuffix = routingHint
        ? `\n\nRouting hint: $${routingHint.decision} ` +
          `(confidence=${routingHint.confidence}, ` +
          `complexity=${routingHint.complexity}, ` +
          `reason=${routingHint.reason})`
        : "";
      return {
        success: true,
        result: {
          sessionId,
          intentFile,
          relativePath: relPath,
          stage: "intent",
          routingHint,
        },
        message:
          `Intent captured → ${relPath}\n\n` +
          `Next: ask the user any remaining clarification questions, ` +
          `then run $ralplan to turn this intent into an approved plan.` +
          hintSuffix,
        guidance: [
          "You are at stage INTENT of the canonical coding workflow.",
          "Review intent.md and ask the user any follow-up questions needed to",
          "resolve ambiguity in goal, scope, boundaries, or non-goals.",
          "When the user confirms the intent is complete, advance to $ralplan.",
          routingHint
            ? `Routing hint (non-binding): classifier suggests $${routingHint.decision}` +
              ` — ${routingHint.reason}. Prefer $team for multi-scope parallel work,` +
              ` $ralph for focused single-scope changes.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
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
