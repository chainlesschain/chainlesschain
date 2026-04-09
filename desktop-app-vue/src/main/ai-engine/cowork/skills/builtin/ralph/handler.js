/**
 * $ralph handler — step 3a of the canonical coding workflow.
 *
 * Persistent single-owner completion loop. Appends progress entries and
 * returns LLM guidance telling the agent to read plan.md, pick the next
 * unfinished step, execute with normal tools, and append progress.
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
    logger.info(`[ralph] handler initialized for "${skill?.name || "ralph"}"`);
  },

  async execute(task, context) {
    const projectRoot = resolveProjectRoot(context);
    const sessionId = resolveSessionId(task, context);
    if (!sessionId) {
      return {
        success: false,
        error: "sessionId is required",
        message:
          "$ralph needs a sessionId from an approved workflow ($deep-interview → $ralplan)",
      };
    }

    const manager = new _deps.SessionStateManager({ projectRoot });
    const plan = manager.readPlan(sessionId);
    if (!plan) {
      return {
        success: false,
        error: "plan.md missing",
        message: "$ralph requires an approved plan. Run $ralplan first.",
      };
    }
    if (!plan.approved) {
      return {
        success: false,
        error: "plan not approved",
        message:
          "$ralph refuses: plan.md is not approved. Run $ralplan --approve first.",
      };
    }

    const note = (
      task?.params?.note ||
      task?.action ||
      "ralph loop started"
    ).toString();

    try {
      await _deps.runHook("pre-execute", {
        projectRoot,
        sessionId,
        payload: { mode: "ralph", note },
      });
      const file = manager.appendProgress(sessionId, `[ralph] ${note}`);
      await _deps.runHook("post-execute", {
        projectRoot,
        sessionId,
        payload: { mode: "ralph", progressFile: file },
      });
      const rel = path.relative(projectRoot, file);
      return {
        success: true,
        result: {
          sessionId,
          progressFile: file,
          relativePath: rel,
          stage: "execute",
          mode: "ralph",
        },
        message:
          `Ralph loop engaged. Progress → ${rel}\n\n` +
          `Read plan.md, pick the next unfinished step, execute with your ` +
          `normal tools, verify (tests/lint/run), then append another ` +
          `progress entry. Repeat until the plan is done.`,
        guidance: [
          "You are at stage EXECUTE (ralph) of the canonical coding workflow.",
          "Loop: read plan.md → next unfinished step → execute → verify →",
          "append progress → repeat. Stop when every step is complete and",
          "verified. Do not skip verification.",
        ].join(" "),
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `$ralph failed: ${err.message}`,
      };
    }
  },
};

module.exports._deps = _deps;
