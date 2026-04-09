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

/**
 * Phase B: build structured assignments from tasks.json. Each task becomes
 * one assignment so the SubRuntimePool scheduler can order them by
 * dependsOn and serialize scope-conflicting tasks within a wave.
 *
 * `ownerRole` is split into a base role (for the sub-runtime child, which
 * needs a role string matching VALID_ROLES) and a full ownerRole label
 * (preserved in the assignment for display and diagnostics).
 */
function buildStructuredAssignments(tasksPayload) {
  const tasks = Array.isArray(tasksPayload?.tasks) ? tasksPayload.tasks : [];
  const assignments = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || !t.id) {
      continue;
    }
    const fullRole = (t.ownerRole || "executor").toLowerCase();
    const baseRole = fullRole.split("/")[0].replace(/[^a-z0-9]/g, "");
    const steps = [];
    if (t.title) {
      steps.push(t.title);
    }
    if (Array.isArray(t.doneWhen)) {
      for (const d of t.doneWhen) {
        if (d) {
          steps.push(`verify: ${d}`);
        }
      }
    }
    if (steps.length === 0) {
      steps.push(t.id);
    }
    assignments.push({
      memberIdx: i,
      taskId: t.id,
      role: baseRole || "executor",
      ownerRole: fullRole,
      scopePaths: Array.isArray(t.scopePaths) ? t.scopePaths : [],
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      steps,
    });
  }
  return assignments;
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

    // Phase B: structured-task path. If tasks.json exists, each task
    // becomes one assignment and the pool scheduler orders by dependsOn
    // + serializes scope-conflicting tasks. tasks.json takes precedence
    // over the legacy plan.md step-bucket distribution.
    const tasksPayload = manager.readTasks(sessionId);
    const useStructured =
      !!tasksPayload &&
      Array.isArray(tasksPayload.tasks) &&
      tasksPayload.tasks.length > 0;

    let size;
    let role;
    let steps; // only populated in legacy path
    let assignments;
    let mode;

    if (useStructured) {
      mode = "team-structured";
      assignments = buildStructuredAssignments(tasksPayload);
      if (assignments.length === 0) {
        return {
          success: false,
          error: "tasks.json has no usable tasks",
          message:
            "$team: tasks.json is present but contains no tasks with a valid id. Re-run $ralplan to regenerate it.",
        };
      }
      // Validate every derived base role against VALID_ROLES so a typo in
      // tasks.json surfaces clearly instead of failing inside the child.
      const bad = assignments.find((a) => !VALID_ROLES.has(a.role));
      if (bad) {
        return {
          success: false,
          error: `unknown role "${bad.role}" (from ownerRole "${bad.ownerRole}")`,
          message: `$team: ownerRole base must be one of ${[...VALID_ROLES].join(", ")}`,
        };
      }
      // size reflects peak wave width (informational); role reports "mixed"
      // when more than one base role is present.
      const distinctRoles = new Set(assignments.map((a) => a.role));
      size = Math.min(assignments.length, MAX_SIZE);
      role = distinctRoles.size === 1 ? [...distinctRoles][0] : "mixed";
    } else {
      mode = "team";
      // Legacy path: parse spec from params or task.action ("3:executor ...")
      const fromSpec = parseSpec(task?.params?.spec || task?.action || "");
      size = Math.min(
        Math.max(1, task?.params?.size || fromSpec.size || DEFAULT_SIZE),
        MAX_SIZE,
      );
      role = (task?.params?.role || fromSpec.role || "executor").toLowerCase();
      if (!VALID_ROLES.has(role)) {
        return {
          success: false,
          error: `unknown role "${role}"`,
          message: `$team: role must be one of ${[...VALID_ROLES].join(", ")}`,
        };
      }

      steps = extractPlanSteps(plan.raw);
      if (steps.length === 0) {
        return {
          success: false,
          error: "no steps in plan.md",
          message:
            "$team could not find numbered steps under ## Steps in plan.md — re-run $ralplan with a step list",
        };
      }

      const buckets = distributeSteps(steps, size);
      assignments = buckets.map((bucketSteps, idx) => ({
        memberIdx: idx,
        memberId: `${role}-${idx + 1}`,
        role,
        steps: bucketSteps,
      }));
    }

    // Total step count is only meaningful in the legacy path where plan.md
    // steps were distributed across buckets. In the structured path, each
    // task carries its own step list and the interesting dimension is the
    // task count.
    const legacyStepCount = useStructured ? null : steps.length;
    const taskCount = useStructured ? assignments.length : null;

    try {
      await _deps.runHook("pre-execute", {
        projectRoot,
        sessionId,
        payload: { mode, size, role, assignments, structured: useStructured },
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
      // In structured mode the pool auto-detects the scheduler, so we
      // forward assignments unchanged (taskId / scopePaths / dependsOn
      // must reach the pool). Legacy mode only ships the child-facing
      // subset to match the pre-Phase-B contract.
      const dispatchAssignments = useStructured
        ? assignments
        : assignments.map((a) => ({
            memberIdx: a.memberIdx,
            role: a.role,
            steps: a.steps,
          }));
      const pool = new _deps.SubRuntimePoolCtor({ maxSize: size });
      try {
        dispatchResults = await pool.dispatch({
          projectRoot,
          sessionId,
          assignments: dispatchAssignments,
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
      const headlineSuffix = useStructured
        ? `${taskCount} task(s)`
        : `${size}×${role} with ${legacyStepCount} steps`;
      if (dryRun) {
        manager.appendProgress(
          sessionId,
          `[team] planned ${headlineSuffix} (dry-run${useStructured ? ", structured" : ""})`,
        );
      } else {
        manager.appendProgress(
          sessionId,
          `[team] dispatched ${headlineSuffix}${useStructured ? " (structured)" : ""}`,
        );
        for (const res of dispatchResults || []) {
          const tag = res.success ? "ok" : res.blocked ? "blocked" : "fail";
          const memberLabel = res.taskId || res.memberId || `m${res.memberIdx}`;
          manager.appendProgress(
            sessionId,
            `[team] ${memberLabel} ${tag}${res.error ? `: ${res.error}` : ""}`,
          );
        }
      }
      // Phase B: reflect per-task status back into tasks.json so downstream
      // stages (verify, UI) can read structured state. Best-effort — never
      // block the dispatch result on this.
      if (useStructured && !dryRun && Array.isArray(dispatchResults)) {
        for (const res of dispatchResults) {
          if (!res?.taskId) {
            continue;
          }
          const status = res.success
            ? "completed"
            : res.blocked
              ? "blocked"
              : "failed";
          try {
            manager.updateTaskStatus(sessionId, res.taskId, status, {
              error: res.error || null,
            });
          } catch (_err) {
            /* tasks.json may be absent if the caller mutated it; ignore */
          }
        }
      }
      await _deps.runHook("post-execute", {
        projectRoot,
        sessionId,
        payload: {
          mode,
          size,
          role,
          assignments,
          dispatchResults,
          structured: useStructured,
        },
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
        mode,
        size,
        role,
        assignments,
        dispatchResults,
        dryRun,
        structured: useStructured,
        taskCount,
      },
      message:
        (useStructured
          ? dryRun
            ? `Team dispatch planned (dry-run, structured): ${taskCount} task(s) across ${size} sub-runtime(s).\n\n`
            : `Team dispatch complete (structured): ${taskCount} task(s) across ${dispatchResults?.length || 0} sub-runtime(s).\n\n`
          : dryRun
            ? `Team dispatch planned (dry-run): ${size}×${role}, ${legacyStepCount} steps distributed.\n\n`
            : `Team dispatch complete: ${size}×${role}, ${legacyStepCount} steps distributed across ${dispatchResults?.length || 0} sub-runtime(s).\n\n`) +
        assignments
          .map((a) => {
            const label = useStructured
              ? `${a.taskId} [${a.ownerRole}]`
              : a.memberId;
            return (
              `  • ${label}: ${a.steps.length} step(s)\n    - ` +
              a.steps.join("\n    - ")
            );
          })
          .join("\n") +
        (dispatchResults
          ? `\n\nSub-runtime results:\n` +
            dispatchResults
              .map((r) => {
                const label = r.taskId || r.memberId || `m${r.memberIdx}`;
                const status = r.success
                  ? "ok"
                  : r.blocked
                    ? "BLOCKED — " + r.error
                    : "FAIL — " + r.error;
                return `  • ${label}: ${status}`;
              })
              .join("\n")
          : ""),
      guidance: [
        "You are at stage EXECUTE (team) of the canonical coding workflow.",
        useStructured
          ? "Tasks were scheduled by dependsOn waves with scope-conflict serialization (Phase B)."
          : "Each member ran in its own Electron-main sub-runtime against an isolated member session directory.",
        "Inspect member progress logs under .chainlesschain/sessions/<parent>.m<N>-<role>/progress.log",
        "before entering the verify stage.",
      ].join(" "),
    };
  },
};

module.exports._deps = _deps;
// Exported for tests
module.exports.parseSpec = parseSpec;
module.exports.extractPlanSteps = extractPlanSteps;
module.exports.distributeSteps = distributeSteps;
module.exports.buildStructuredAssignments = buildStructuredAssignments;
