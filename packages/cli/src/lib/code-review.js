/**
 * Code review utilities (ESM)
 * Mirrors Claude Code /review behavior
 * @module lib/code-review
 */

import { logger } from "./logger.js";
import { executionBroker } from "./process-execution-broker/index.js";

export const _deps = {
  execFileSync: (...args) => executionBroker.execFileSync(...args),
};

export function buildGitDiffArgs(
  target = "--staged",
  { nameOnly = false } = {},
) {
  const args = ["diff"];
  if (nameOnly) args.push("--name-only");
  if (target === "--staged" || target === "--cached") {
    args.push(target);
  } else {
    args.push("--end-of-options", String(target), "--");
  }
  return args;
}

function gitDiff(target, options = {}) {
  return _deps.execFileSync("git", buildGitDiffArgs(target, options), {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    origin: "review:git-diff",
    policy: "allow",
    scope: "review",
    shell: false,
  });
}

/**
 * Get git diff for review
 * @param {string} target - Diff target (default: staged changes)
 * @returns {string} diff output
 */
export function getGitDiff(target = "--staged") {
  try {
    return gitDiff(target);
  } catch (err) {
    logger.error(`Failed to get git diff: ${err.message}`);
    return "";
  }
}

/**
 * Get list of changed files
 * @param {string} target - Diff target
 * @returns {string[]} changed files
 */
export function getChangedFiles(target = "--staged") {
  try {
    const output = gitDiff(target, { nameOnly: true });
    return output.trim().split("\n").filter(Boolean);
  } catch (err) {
    logger.error(`Failed to get changed files: ${err.message}`);
    return [];
  }
}

/**
 * Run code review on current changes
 * @param {Object} options Review options
 * @returns {Promise<Object>} review result
 */
export async function runCodeReview(options = {}) {
  const target = options.target || "--staged";
  const diff = getGitDiff(target);
  const files = getChangedFiles(target);

  if (files.length === 0) {
    logger.info("No changed files to review");
    return { reviewed: false, files: [], issues: [] };
  }

  logger.info(`Reviewing ${files.length} changed files...`);
  files.forEach((f) => logger.info(`  - ${f}`));

  return {
    reviewed: true,
    files,
    diffSize: diff.length,
    // Actual AI review will be handled by agent core
    message:
      "Code review request prepared. AI will analyze changes for bugs, security issues, and style problems.",
  };
}

export default { getGitDiff, getChangedFiles, runCodeReview };
