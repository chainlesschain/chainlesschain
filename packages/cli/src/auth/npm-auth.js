/**
 * npm authentication utilities (ESM)
 * Mirrors Claude Code /login /logout behavior
 * @module auth/npm-auth
 */

import { execSync } from "child_process";
import { logger } from "../lib/logger.js";

/**
 * Check if user is currently logged in to npm
 * @returns {boolean}
 */
export function isLoggedIn() {
  try {
    execSync("npm whoami", { stdio: "ignore" });
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
    return execSync("npm whoami", { encoding: "utf8" }).trim();
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
    execSync("npm login", { stdio: "inherit" });
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
    execSync("npm logout", { stdio: "inherit" });
    return !isLoggedIn();
  } catch (err) {
    logger.error(`Logout failed: ${err.message}`);
    return false;
  }
}

export default { isLoggedIn, getCurrentUser, login, logout };
