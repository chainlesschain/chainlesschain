/**
 * npm authentication utilities (ESM)
 * Mirrors Claude Code /login /logout behavior
 * @module auth/npm-auth
 */

import { logger } from "../lib/logger.js";
import { executionBroker } from "../lib/process-execution-broker/index.js";
import { resolveNpmInvocation } from "../lib/npm-invocation.js";

export const _deps = {
  platform: process.platform,
  execPath: process.execPath,
  execFileSync: (...args) => executionBroker.execFileSync(...args),
};

function runNpm(args, options = {}) {
  const invocation = resolveNpmInvocation({
    platform: _deps.platform,
    execPath: _deps.execPath,
  });
  return _deps.execFileSync(
    invocation.command,
    [...invocation.prefixArgs, ...args],
    {
      ...options,
      origin: "auth:npm",
      policy: "allow",
      scope: "auth",
      shell: false,
    },
  );
}

/**
 * Check if user is currently logged in to npm
 * @returns {boolean}
 */
export function isLoggedIn() {
  try {
    runNpm(["whoami"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current npm username
 * @returns {string|null}
 */
export function getCurrentUser() {
  try {
    return runNpm(["whoami"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Run npm login
 * @returns {Promise<boolean>} success
 */
export async function login() {
  try {
    logger.info("Running npm login...");
    runNpm(["login"], { stdio: "inherit" });
    return isLoggedIn();
  } catch (err) {
    logger.error(`Login failed: ${err.message}`);
    return false;
  }
}

/**
 * Run npm logout
 * @returns {Promise<boolean>} success
 */
export async function logout() {
  try {
    logger.info("Running npm logout...");
    runNpm(["logout"], { stdio: "inherit" });
    return !isLoggedIn();
  } catch (err) {
    logger.error(`Logout failed: ${err.message}`);
    return false;
  }
}

export default { isLoggedIn, getCurrentUser, login, logout };
