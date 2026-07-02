/**
 * Pull request creation utilities (ESM)
 * Mirrors Claude Code /pr behavior
 * @module lib/pr-create
 */

import { execSync } from "child_process";
import { logger } from "./logger.js";

/**
 * Get current git branch
 * @returns {string} branch name
 */
export function getCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "main";
  }
}

/**
 * Get remote URL
 * @returns {string|null}
 */
export function getRemoteUrl() {
  try {
    return execSync("git remote get-url origin", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Extract GitHub owner/repo from remote URL
 * @returns {{owner: string, repo: string}|null}
 */
export function parseGitHubRepo() {
  const url = getRemoteUrl();
  if (!url) return null;

  // Handle SSH and HTTPS URLs
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?/);
  if (!match) return null;

  return { owner: match[1], repo: match[2] };
}

/**
 * Prepare pull request
 * @param {Object} options PR options
 * @returns {Promise<Object>} PR creation result
 */
export async function preparePullRequest(options = {}) {
  const branch = getCurrentBranch();
  const repo = parseGitHubRepo();

  // Check for uncommitted changes
  const status = execSync("git status --porcelain", { encoding: "utf8" });
  const hasChanges = status.trim().length > 0;

  if (hasChanges && !options.skipStash) {
    logger.warn(
      "You have uncommitted changes. Commit or stash before creating PR.",
    );
  }

  // Get commit messages for PR body
  const defaultBase = options.base || "main";
  const logRange = `${defaultBase}...${branch}`;
  let commitLog = "";
  try {
    commitLog = execSync(`git log ${logRange} --oneline`, { encoding: "utf8" });
  } catch {
    commitLog = "";
  }

  const prUrl = repo
    ? `https://github.com/${repo.owner}/${repo.repo}/compare/${defaultBase}...${branch}?expand=1`
    : null;

  logger.info(`Branch: ${branch}`);
  logger.info(`Base: ${defaultBase}`);
  if (prUrl) {
    logger.info(`Open PR in browser: ${prUrl}`);
  }

  return {
    prepared: true,
    branch,
    base: defaultBase,
    repo,
    commitLog,
    prUrl,
    hasUncommittedChanges: hasChanges,
    message:
      "PR draft prepared. AI will help generate title and body from commits.",
  };
}

export default {
  getCurrentBranch,
  getRemoteUrl,
  parseGitHubRepo,
  preparePullRequest,
};
