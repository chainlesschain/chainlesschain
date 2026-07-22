/**
 * npm authentication utilities (ESM)
 * Mirrors Claude Code /login /logout behavior
 * @module auth/npm-auth
 */

import { logger } from "../lib/logger.js";
import { executionBroker } from "../lib/process-execution-broker/index.js";

export const _deps = {
  execSync: (command, options) =>
    executionBroker.execSync(command, {
      ...options,
      origin: "auth:npm",
      policy: "allow",
      scope: "auth",
    }),
};

/**
 * Check if user is currently logged in to npm
 * @returns {boolean}
 */
export function isLoggedIn() {
  try {
    _deps.execSync("npm whoami", { stdio: "ignore" });
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
    return _deps.execSync("npm whoami", { encoding: "utf8" }).trim();
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
    _deps.execSync("npm login", { stdio: "inherit" });
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
    _deps.execSync("npm logout", { stdio: "inherit" });
    return !isLoggedIn();
  } catch (err) {
    logger.error(`Logout failed: ${err.message}`);
    return false;
  }
}

export default { isLoggedIn, getCurrentUser, login, logout };
