/**
 * $team handler — step 3b of the canonical coding workflow.
 *
 * Splits an approved plan.md into subtasks for coordinated parallel
 * execution. Does not actually spawn sub-agents — returns a routing
 * spec for the cowork / coding-agent runtime to dispatch.
 */

const path = require("path");
const { logger } = require("../../../../../utils/logger.js");
const {
  SessionStateManager,
} = require("../../../../code-agent/session-state-manager.js");
const { runHook } = require("../../../../code-agent/workflow-hook-runner.js");

const _deps = { SessionStateManager, runHook };

const VALID_ROLES = new Set([
  "executor",
  "reviewer",
  "tester",
  "architect",
  "debugger",
  "writer",
]);
const DEFAULT_SIZE = 3;
const MAX_SIZE = 6;

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

function parseSpec(spec) {
  // "3:executor" → { size: 3, role: "executor" }
  if (!spec || typeof spec !== "string") {
    return {};
  }
  const m = spec.trim().match(/^(\d+)\s*:\s*(\w+)/);
  if (!m) {
    return {};
  }
  return { size: parseInt(m[1], 10), role: m[2].toLowerCase() };
}

function extractPlanSteps(planRaw) {
  // Best-effort: grab lines that look like "1. ...", "2. ..." under "## Steps"
  const stepsSectionMatch = planRaw.match(
    /##\s*Steps\s*\n([\s\S]*?)(?:\n##|$)/,
  );
  if (!stepsSectionMatch) {
    return [];
  }
  const body = stepsSectionMatch[1];
  const steps = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*\d+\.\s+(.+)$/);
    if (m) {
      steps.push(m[1].trim());
    }
  }
  return steps;
}

function distributeSteps(steps, size) {
  const buckets = Array.from({ length: size }, () => []);
  steps.forEach((step, idx) => {
    buckets[idx % size].push(step);
  });
  return buckets;
}

module.exports = {
  async init(skill) {
    logger.info(`[team] handler initialized for "${skill?.name || "team"}"`);
  },

  async execute(task, context) {
    const projectRoot = resolveProjectRoot(context);
    const sessionId = resolveSessionId(task, context);
    if (!sessionId) {
      return {
        success: false,
        error: "sessionId is required",
        message:
          "$team needs a sessionId from an approved workflow ($deep-interview → $ralplan)",
      };
    }

    const manager = new _deps.SessionStateManager({ projectRoot });
    const plan = manager.readPlan(sessionId);
    if (!plan) {
      return {
        success: false,
        error: "plan.md missing",
        message: "$team requires an approved plan. Run $ralplan first.",
      };
    }
    if (!plan.approved) {
      return {
        success: false,
        error: "plan not approved",
        message:
          "$team refuses: plan.md is not approved. Run $ralplan --approve first.",
      };
    }

    // Parse spec from params or task.action ("3:executor goal text")
    const fromSpec = parseSpec(task?.params?.spec || task?.action || "");
    const size = Math.min(
      Math.max(1, task?.params?.size || fromSpec.size || DEFAULT_SIZE),
      MAX_SIZE,
    );
    const role = (
      task?.params?.role ||
      fromSpec.role ||
      "executor"
    ).toLowerCase();
    if (!VALID_ROLES.has(role)) {
      return {
        success: false,
        error: `unknown role "${role}"`,
        message: `$team: role must be one of ${[...VALID_ROLES].join(", ")}`,
      };
    }

    const steps = extractPlanSteps(plan.raw);
    if (steps.length === 0) {
      return {
        success: false,
        error: "no steps in plan.md",
        message:
          "$team could not find numbered steps under ## Steps in plan.md — re-run $ralplan with a step list",
      };
    }

    const buckets = distributeSteps(steps, size);
    const assignments = buckets.map((bucketSteps, idx) => ({
      memberId: `${role}-${idx + 1}`,
      role,
      steps: bucketSteps,
    }));

    try {
      await _deps.runHook("pre-execute", {
        projectRoot,
        sessionId,
        payload: { mode: "team", size, role, assignments },
      });
    } catch (hookErr) {
      return {
        success: false,
        error: hookErr.message,
        message: `$team vetoed by pre-execute hook: ${hookErr.message}`,
      };
    }

    try {
      manager.appendProgress(
        sessionId,
        `[team] spawned ${size}×${role} with ${steps.length} steps`,
      );
      await _deps.runHook("post-execute", {
        projectRoot,
        sessionId,
        payload: { mode: "team", size, role, assignments },
      });
    } catch (err) {
      // appendProgress enforces approved plan — already checked above,
      // so this path should not trigger. Log and keep going.
      logger.warn(`[team] appendProgress failed: ${err.message}`);
    }

    return {
      success: true,
      result: {
        sessionId,
        stage: "execute",
        mode: "team",
        size,
        role,
        assignments,
      },
      message:
        `Team dispatch ready: ${size}×${role}, ${steps.length} steps distributed.\n\n` +
        assignments
          .map(
            (a) =>
              `  • ${a.memberId}: ${a.steps.length} step(s)\n    - ` +
              a.steps.join("\n    - "),
          )
          .join("\n") +
        `\n\nDispatch each member via the cowork / coding-agent runtime, ` +
        `then aggregate progress back to session "${sessionId}".`,
      guidance: [
        "You are at stage EXECUTE (team) of the canonical coding workflow.",
        "Spawn the assignments through the cowork runtime, monitor each",
        "member's progress, and aggregate results. Only mark the session",
        "done after every member has verified their steps.",
      ].join(" "),
    };
  },
};

module.exports._deps = _deps;
// Exported for tests
module.exports.parseSpec = parseSpec;
module.exports.extractPlanSteps = extractPlanSteps;
module.exports.distributeSteps = distributeSteps;
