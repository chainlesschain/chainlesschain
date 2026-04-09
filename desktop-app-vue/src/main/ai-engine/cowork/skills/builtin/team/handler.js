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
const {
  SubRuntimePool,
} = require("../../../../code-agent/sub-runtime-pool.js");

// All side-effect entry points go through `_deps` so tests can inject fakes.
// `SubRuntimePoolCtor` defaults to the real pool; unit tests override it with
// a dry-run stub that does not spawn any processes.
const _deps = {
  SessionStateManager,
  runHook,
  SubRuntimePoolCtor: SubRuntimePool,
};

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

    // Decide whether to actually spawn sub-runtimes or just plan the fan-out.
    // Default: real spawn. Tests and `--dry-run` skip spawning but still
    // validate the routing and write the parent progress marker.
    const dryRun =
      task?.params?.dryRun === true || task?.params?.dryRun === "true";

    let dispatchResults = null;
    if (!dryRun) {
      const pool = new _deps.SubRuntimePoolCtor({ maxSize: size });
      try {
        dispatchResults = await pool.dispatch({
          projectRoot,
          sessionId,
          assignments: assignments.map((a, idx) => ({
            memberIdx: idx,
            role: a.role,
            steps: a.steps,
          })),
        });
      } catch (err) {
        await pool.shutdown();
        return {
          success: false,
          error: `sub-runtime dispatch failed: ${err.message}`,
          message: `$team dispatch failed: ${err.message}`,
        };
      } finally {
        await pool.shutdown();
      }
    }

    // Aggregate progress into the *parent* log as a single writer so there
    // is no contention with the member sessions' own progress.log files.
    try {
      if (dryRun) {
        manager.appendProgress(
          sessionId,
          `[team] planned ${size}×${role} with ${steps.length} steps (dry-run)`,
        );
      } else {
        manager.appendProgress(
          sessionId,
          `[team] dispatched ${size}×${role} with ${steps.length} steps`,
        );
        for (const res of dispatchResults || []) {
          const tag = res.success ? "ok" : "fail";
          const memberLabel = res.memberId || `m${res.memberIdx}`;
          manager.appendProgress(
            sessionId,
            `[team] ${memberLabel} ${tag}${res.error ? `: ${res.error}` : ""}`,
          );
        }
      }
      await _deps.runHook("post-execute", {
        projectRoot,
        sessionId,
        payload: { mode: "team", size, role, assignments, dispatchResults },
      });
    } catch (err) {
      // appendProgress enforces approved plan — already checked above,
      // so this path should not trigger. Log and keep going.
      logger.warn(`[team] appendProgress failed: ${err.message}`);
    }

    const allOk = !dispatchResults || dispatchResults.every((r) => r.success);
    return {
      success: allOk,
      result: {
        sessionId,
        stage: "execute",
        mode: "team",
        size,
        role,
        assignments,
        dispatchResults,
        dryRun,
      },
      message:
        (dryRun
          ? `Team dispatch planned (dry-run): ${size}×${role}, ${steps.length} steps distributed.\n\n`
          : `Team dispatch complete: ${size}×${role}, ${steps.length} steps distributed across ${dispatchResults?.length || 0} sub-runtime(s).\n\n`) +
        assignments
          .map(
            (a) =>
              `  • ${a.memberId}: ${a.steps.length} step(s)\n    - ` +
              a.steps.join("\n    - "),
          )
          .join("\n") +
        (dispatchResults
          ? `\n\nSub-runtime results:\n` +
            dispatchResults
              .map(
                (r) =>
                  `  • ${r.memberId || `m${r.memberIdx}`}: ${r.success ? "ok" : "FAIL — " + r.error}`,
              )
              .join("\n")
          : ""),
      guidance: [
        "You are at stage EXECUTE (team) of the canonical coding workflow.",
        "Each member ran in its own Electron-main sub-runtime against an",
        "isolated member session directory. Inspect member progress logs",
        "under .chainlesschain/sessions/<parent>.m<N>-<role>/progress.log",
        "before marking the parent session done.",
      ].join(" "),
    };
  },
};

module.exports._deps = _deps;
// Exported for tests
module.exports.parseSpec = parseSpec;
module.exports.extractPlanSteps = extractPlanSteps;
module.exports.distributeSteps = distributeSteps;
