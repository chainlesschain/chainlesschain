/**
 * Turn-scoped context builder — inspired by open-agents' prepareCall.
 *
 * Produces a short system-prompt supplement that is re-computed before each
 * LLM call in the agent loop. Gives the model fresh runtime signals (cwd,
 * git HEAD/branch/dirty, active skills, turn counter) without polluting the
 * persistent message history.
 *
 * Callers: agent-core.agentLoop's pre-call hook, via options.prepareCall.
 *
 * @module turn-context
 */

import { execSync } from "child_process";
import path from "path";

const _deps = { execSync };

/**
 * Run a git command with stdio pipe and return stdout or null.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string|null}
 */
function _git(cmd, cwd) {
  try {
    return _deps
      .execSync(`git ${cmd}`, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
        // `status --porcelain` on a dirty repo with many files can exceed the
        // 1 MB execSync default → ENOBUFS → null → "(clean)" misreport below.
        maxBuffer: 16 * 1024 * 1024,
      })
      .trim();
  } catch (_e) {
    return null;
  }
}

/**
 * Build a compact turn-scoped context block.
 *
 * @param {object} input
 * @param {number} [input.iteration] - 1-based iteration counter for this turn.
 * @param {string} [input.cwd] - Working directory (defaults to process.cwd()).
 * @param {string|null} [input.sessionId] - Agent session id.
 * @param {string[]} [input.activeSkills] - Names of skills currently active.
 * @returns {string} Markdown-formatted supplement, or empty string if nothing useful.
 */
export function buildTurnContext({
  iteration = 1,
  cwd = process.cwd(),
  sessionId = null,
  activeSkills = [],
} = {}) {
  const lines = [];
  lines.push(`## Turn context (iteration ${iteration})`);
  lines.push(`- cwd: ${path.resolve(cwd)}`);

  const branch = _git("rev-parse --abbrev-ref HEAD", cwd);
  if (branch) {
    const head = _git("rev-parse --short HEAD", cwd);
    const status = _git("status --porcelain", cwd);
    // Distinguish "command failed" (null — timeout / huge output) from "" (truly
    // clean): the old `status && …` reported a repo as "(clean)" whenever status
    // couldn't be determined, which is a wrong signal to the model.
    let stateLabel;
    if (status === null) {
      stateLabel = " (status unknown)";
    } else if (status.length > 0) {
      stateLabel = ` (${status.split("\n").filter(Boolean).length} uncommitted)`;
    } else {
      stateLabel = " (clean)";
    }
    lines.push(`- git: ${branch}@${head || "?"}${stateLabel}`);
  }

  if (sessionId) {
    lines.push(`- session: ${sessionId}`);
  }

  if (Array.isArray(activeSkills) && activeSkills.length > 0) {
    lines.push(`- active skills: ${activeSkills.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Default prepareCall implementation — builds a turn-context supplement and
 * returns it as a structured payload. agent-core wraps this into a transient
 * system message for the next llmCall without mutating persistent history.
 *
 * @param {object} ctx - Supplied by agent-core at call site.
 * @returns {{ systemSuffix: string } | null}
 */
export function defaultPrepareCall(ctx) {
  const supplement = buildTurnContext(ctx);
  return supplement ? { systemSuffix: supplement } : null;
}

export { _deps };
