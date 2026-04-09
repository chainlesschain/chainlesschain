/**
 * $verify handler — step 4 of the canonical coding workflow.
 *
 * Runs structured verification checks and writes verify.json through
 * SessionStateManager. The aggregated status is the **only** signal
 * that authorizes the terminal `complete` stage (Gate V1/V3). A
 * non-passing result routes the session to fix-loop (Gate V4) or
 * failed, depending on the retry budget.
 *
 * All side-effect entry points (execSync, fs) are routed through
 * `_deps` so tests can inject fakes without fighting the Vitest
 * forks-pool CJS trap.
 */

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");
const {
  SessionStateManager,
} = require("../../../../code-agent/session-state-manager.js");
const { runHook } = require("../../../../code-agent/workflow-hook-runner.js");

const _deps = {
  SessionStateManager,
  runHook,
  execSync,
  fs,
};

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RETRIES = 3;

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

/**
 * Normalize a user-supplied check entry into `{id, command, timeout}`.
 * Accepts a raw command string or a partial object. Returns null when
 * the entry cannot be normalized (e.g., missing command).
 */
function normalizeCheck(entry, fallbackId) {
  if (entry == null) {
    return null;
  }
  if (typeof entry === "string") {
    const command = entry.trim();
    if (!command) {
      return null;
    }
    return { id: fallbackId, command, timeout: DEFAULT_TIMEOUT_MS };
  }
  if (typeof entry === "object") {
    const command =
      typeof entry.command === "string" ? entry.command.trim() : "";
    if (!command) {
      return null;
    }
    return {
      id: entry.id || fallbackId,
      command,
      timeout: Number.isFinite(entry.timeout)
        ? entry.timeout
        : DEFAULT_TIMEOUT_MS,
    };
  }
  return null;
}

/**
 * Collect checks from tasks.json. Every task's `verifyCommands` array
 * is flattened; each entry is given a stable id derived from the task id.
 */
function collectTaskChecks(tasksPayload) {
  const out = [];
  const tasks = Array.isArray(tasksPayload?.tasks) ? tasksPayload.tasks : [];
  for (const t of tasks) {
    if (!t || !Array.isArray(t.verifyCommands)) {
      continue;
    }
    t.verifyCommands.forEach((cmd, i) => {
      const norm = normalizeCheck(cmd, `${t.id || "task"}-vc${i}`);
      if (norm) {
        out.push(norm);
      }
    });
  }
  return out;
}

/**
 * Default heuristic checks based on the repo layout. Returns a small
 * list that is *intentionally* conservative — `$verify` is meant to
 * run checks the planner has already declared, not to guess.
 */
function defaultChecksForProject(projectRoot) {
  const checks = [];
  const pkgPath = path.join(projectRoot, "package.json");
  if (_deps.fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(_deps.fs.readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts || {};
      if (scripts.test) {
        checks.push({
          id: "npm-test",
          command: "npm test",
          timeout: DEFAULT_TIMEOUT_MS,
        });
      }
    } catch {
      /* ignore */
    }
  }
  if (checks.length === 0) {
    if (_deps.fs.existsSync(path.join(projectRoot, "pom.xml"))) {
      checks.push({
        id: "mvn-test",
        command: "mvn test -q",
        timeout: DEFAULT_TIMEOUT_MS,
      });
    } else if (
      _deps.fs.existsSync(path.join(projectRoot, "pyproject.toml")) ||
      _deps.fs.existsSync(path.join(projectRoot, "requirements.txt"))
    ) {
      checks.push({
        id: "pytest",
        command: "python -m pytest -q",
        timeout: DEFAULT_TIMEOUT_MS,
      });
    }
  }
  return checks;
}

/**
 * Run a single check through `_deps.execSync`. Returns a verify.json
 * check entry with status "passed" or "failed" and a short summary.
 */
function runCheck(check, cwd) {
  const startedAt = Date.now();
  try {
    const stdout = _deps.execSync(check.command, {
      cwd,
      encoding: "utf-8",
      timeout: check.timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      id: check.id,
      command: check.command,
      status: "passed",
      durationMs: Date.now() - startedAt,
      summary: summarizeOutput(stdout),
    };
  } catch (err) {
    // execSync throws an Error with .status / .stdout / .stderr for
    // non-zero exits, and a plain Error for spawn failures.
    const stdout = err.stdout != null ? err.stdout.toString() : "";
    const stderr = err.stderr != null ? err.stderr.toString() : "";
    const output = stdout + stderr;
    return {
      id: check.id,
      command: check.command,
      status: "failed",
      exitCode: err.status != null ? err.status : -1,
      durationMs: Date.now() - startedAt,
      summary: summarizeOutput(output) || err.message,
    };
  }
}

function summarizeOutput(out) {
  if (!out) {
    return "";
  }
  const text = typeof out === "string" ? out : out.toString();
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const lines = trimmed.split(/\r?\n/);
  // Keep last 3 lines — build/test tools put the headline at the bottom.
  return lines.slice(-3).join(" | ").slice(0, 400);
}

function aggregateStatus(results) {
  if (results.length === 0) {
    return "passed";
  } // no evidence requested
  const failed = results.filter((r) => r.status === "failed").length;
  const passed = results.filter((r) => r.status === "passed").length;
  if (failed === 0) {
    return "passed";
  }
  if (passed === 0) {
    return "failed";
  }
  return "partial";
}

module.exports = {
  async init(skill) {
    logger.info(
      `[verify] handler initialized for "${skill?.name || "verify"}"`,
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
          "$verify needs a sessionId from an approved workflow ($deep-interview → $ralplan)",
      };
    }

    const manager = new _deps.SessionStateManager({ projectRoot });
    const plan = manager.readPlan(sessionId);
    if (!plan) {
      return {
        success: false,
        error: "plan.md missing",
        message: "$verify requires an approved plan. Run $ralplan first.",
      };
    }
    if (!plan.approved) {
      return {
        success: false,
        error: "plan not approved",
        message:
          "$verify refuses: plan.md is not approved. Run $ralplan --approve first.",
      };
    }

    // ── 1. Resolve the check set ────────────────────────────────────
    let checks = [];
    let source = "none";
    const paramsChecks = task?.params?.checks;
    if (Array.isArray(paramsChecks) && paramsChecks.length > 0) {
      checks = paramsChecks
        .map((c, i) => normalizeCheck(c, `param-${i}`))
        .filter(Boolean);
      source = "params";
    }
    if (checks.length === 0) {
      const tasksPayload = manager.readTasks(sessionId);
      const taskChecks = collectTaskChecks(tasksPayload);
      if (taskChecks.length > 0) {
        checks = taskChecks;
        source = "tasks.json";
      }
    }
    if (checks.length === 0) {
      checks = defaultChecksForProject(projectRoot);
      if (checks.length > 0) {
        source = "heuristic";
      }
    }

    // Honor pre-verify hook. A veto aborts before any command runs.
    try {
      await _deps.runHook("pre-verify", {
        projectRoot,
        sessionId,
        payload: { checks, source },
      });
    } catch (hookErr) {
      return {
        success: false,
        error: hookErr.message,
        message: `$verify vetoed by pre-verify hook: ${hookErr.message}`,
      };
    }

    // ── 2. Run each check ───────────────────────────────────────────
    const cwd = task?.params?.cwd || projectRoot;
    const results = [];
    for (const check of checks) {
      const res = runCheck(check, cwd);
      results.push(res);
      // Append progress so the parent log reflects verify activity.
      try {
        manager.appendProgress(
          sessionId,
          `[verify] ${res.id} ${res.status}${res.status === "failed" ? `: ${res.summary || ""}` : ""}`,
        );
      } catch (_err) {
        /* appendProgress enforces approved plan — already checked */
      }
    }

    // ── 3. Aggregate + persist verify.json ──────────────────────────
    const status = aggregateStatus(results);
    const autoFixLoop =
      task?.params?.autoFixLoop == null ? true : !!task.params.autoFixLoop;
    const maxRetries = Number.isFinite(task?.params?.maxRetries)
      ? task.params.maxRetries
      : DEFAULT_MAX_RETRIES;
    const nextAction =
      status === "passed" ? "complete" : autoFixLoop ? "fix-loop" : null;

    let verifyFile;
    try {
      verifyFile = manager.writeVerify(sessionId, {
        status,
        checks: results,
        nextAction,
      });
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `$verify failed to persist verify.json: ${err.message}`,
      };
    }

    // ── 4. Route based on status ────────────────────────────────────
    let fixLoopState = null;
    let finalStage = "verify";
    if (status === "passed") {
      finalStage = "verify";
    } else if (autoFixLoop) {
      fixLoopState = manager.enterFixLoop(sessionId, { maxRetries });
      finalStage = fixLoopState.stage; // fix-loop or failed (over cap)
    }

    try {
      await _deps.runHook("post-verify", {
        projectRoot,
        sessionId,
        payload: {
          status,
          checks: results,
          source,
          nextAction,
          fixLoopState,
        },
      });
    } catch (err) {
      logger.warn(`[verify] post-verify hook failed: ${err.message}`);
    }

    // ── 5. Build response ───────────────────────────────────────────
    const passedCount = results.filter((r) => r.status === "passed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const headline =
      results.length === 0
        ? "No verification checks configured"
        : `${passedCount}/${results.length} passed, ${failedCount} failed`;

    const nextActionLine =
      status === "passed"
        ? "Verification passed. Run $complete to finalize the session."
        : autoFixLoop
          ? fixLoopState?.stage === "failed"
            ? `Fix-loop budget exhausted (retries=${fixLoopState.retries}/${fixLoopState.maxRetries}). Session marked failed.`
            : `Entered fix-loop (retry ${fixLoopState?.retries}/${fixLoopState?.maxRetries}). Address failures and re-run $verify.`
          : "Verification did not pass. Address failures and re-run $verify.";

    return {
      success: status === "passed",
      result: {
        sessionId,
        stage: finalStage,
        mode: "verify",
        status,
        checkSource: source,
        checks: results,
        verifyFile,
        nextAction,
        fixLoopState,
      },
      message:
        `Verify complete: ${headline} (source: ${source}).\n` +
        nextActionLine +
        (results.length > 0
          ? `\n\nChecks:\n` +
            results
              .map(
                (r) =>
                  `  • ${r.id} [${r.status}] — ${r.command}` +
                  (r.summary ? `\n    ${r.summary}` : ""),
              )
              .join("\n")
          : ""),
      guidance: [
        "You are at stage VERIFY of the canonical coding workflow.",
        "verify.json is the only authorization for the terminal COMPLETE stage.",
        "If verification failed, iterate inside fix-loop until passed or the retry budget is exhausted.",
      ].join(" "),
    };
  },
};

module.exports._deps = _deps;
// Exported for tests
module.exports.normalizeCheck = normalizeCheck;
module.exports.collectTaskChecks = collectTaskChecks;
module.exports.defaultChecksForProject = defaultChecksForProject;
module.exports.runCheck = runCheck;
module.exports.aggregateStatus = aggregateStatus;
module.exports.summarizeOutput = summarizeOutput;
