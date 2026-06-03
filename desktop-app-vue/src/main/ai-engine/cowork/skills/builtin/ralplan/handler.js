/**
 * $ralplan handler — step 2 of the canonical coding workflow.
 *
 * Reads intent.md, writes plan.md (unapproved by default), and supports
 * flipping the approved flag via params.approve = true.
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
      `[ralplan] handler initialized for "${skill?.name || "ralplan"}"`,
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
          "$ralplan needs a sessionId — run $deep-interview first to create one",
      };
    }

    const manager = new _deps.SessionStateManager({ projectRoot });

    // Approve-only mode
    if (task?.params?.approve === true) {
      try {
        await _deps.runHook("pre-plan", {
          projectRoot,
          sessionId,
          payload: { mode: "approve" },
        });
        const file = manager.approvePlan(sessionId);
        await _deps.runHook("post-plan", {
          projectRoot,
          sessionId,
          payload: { mode: "approve", planFile: file, approved: true },
        });
        return {
          success: true,
          result: { sessionId, planFile: file, approved: true, stage: "plan" },
          message: `Plan approved → ${path.relative(projectRoot, file)}\n\nNext: $ralph for persistent single-owner execution, or $team for parallel execution.`,
        };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          message: `$ralplan --approve failed: ${err.message}`,
        };
      }
    }

    // Write plan mode
    if (!manager.readIntent(sessionId)) {
      return {
        success: false,
        error: "intent.md missing",
        message:
          '$ralplan requires $deep-interview first. Run: $deep-interview "<goal>"',
      };
    }

    const title = (
      task?.params?.title ||
      task?.action ||
      "Implementation Plan"
    ).toString();
    const steps = Array.isArray(task?.params?.steps) ? task.params.steps : [];
    const tradeoffs = Array.isArray(task?.params?.tradeoffs)
      ? task.params.tradeoffs
      : [];

    try {
      await _deps.runHook("pre-plan", {
        projectRoot,
        sessionId,
        payload: { mode: "write", title, steps, tradeoffs },
      });
      const file = manager.writePlan(sessionId, {
        title,
        steps,
        tradeoffs,
        approved: false,
      });
      await _deps.runHook("post-plan", {
        projectRoot,
        sessionId,
        payload: { mode: "write", planFile: file, approved: false },
      });
      const rel = path.relative(projectRoot, file);
      return {
        success: true,
        result: {
          sessionId,
          planFile: file,
          relativePath: rel,
          approved: false,
          stage: "plan",
        },
        message:
          `Plan drafted → ${rel}\n\n` +
          `Walk the user through the steps and tradeoffs, then run ` +
          `$ralplan --approve (or pass { approve: true }) to mark it approved. ` +
          `Execution skills ($ralph, $team) will refuse until then.`,
        guidance: [
          "You are at stage PLAN of the canonical coding workflow.",
          "Present plan.md to the user, discuss tradeoffs, then get explicit",
          "approval. Only after approval advance to $ralph or $team.",
        ].join(" "),
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `$ralplan failed: ${err.message}`,
      };
    }
  },
};

module.exports._deps = _deps;
