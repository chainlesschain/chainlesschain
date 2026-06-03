/**
 * Project root detection utility
 * Finds and loads .chainlesschain/ project configuration
 */

import fs from "fs";
import path from "path";

/**
 * Walk up from startDir looking for .chainlesschain/config.json
 * @param {string} [startDir=process.cwd()] - Directory to start searching from
 * @returns {string|null} Project root directory or null
 */
export function findProjectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root;

  while (dir !== root) {
    const configPath = path.join(dir, ".chainlesschain", "config.json");
    if (fs.existsSync(configPath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Load project configuration from .chainlesschain/config.json
 * @param {string} projectRoot - Project root directory
 * @returns {object|null} Parsed config or null on error
 */
export function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".chainlesschain", "config.json");
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Quick boolean check: are we inside a .chainlesschain project?
 * @param {string} [startDir] - Directory to check from
 * @returns {boolean}
 */
export function isInsideProject(startDir) {
  return findProjectRoot(startDir) !== null;
}
