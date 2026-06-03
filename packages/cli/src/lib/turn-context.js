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
    const dirty = status && status.length > 0;
    const fileCount = dirty ? status.split("\n").filter(Boolean).length : 0;
    lines.push(
      `- git: ${branch}@${head || "?"}${dirty ? ` (${fileCount} uncommitted)` : " (clean)"}`,
    );
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
