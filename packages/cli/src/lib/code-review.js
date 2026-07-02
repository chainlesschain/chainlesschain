/**
 * Code review utilities (ESM)
 * Mirrors Claude Code /review behavior
 * @module lib/code-review
 */

import { execSync } from "child_process";
import { logger } from "./logger.js";

/**
 * Get git diff for review
 * @param {string} target - Diff target (default: staged changes)
 * @returns {string} diff output
 */
export function getGitDiff(target = "--staged") {
  try {
    return execSync(`git diff ${target}`, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
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
    const output = execSync(`git diff ${target} --name-only`, {
      encoding: "utf8",
    });
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
