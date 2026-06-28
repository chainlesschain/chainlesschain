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

// mtime-keyed parse cache. `config.json` is loaded on EVERY agent tool call
// (via _loadProjectPersona) and every buildSystemPrompt, so re-reading +
// re-parsing it each time is wasted syscalls + parse work on the agent hot
// path. We cache the parsed object keyed by absolute configPath and invalidate
// when the file's mtimeMs changes — so an external edit or a `persona set`
// write (which rewrites the file → new mtime) is always picked up on the next
// call. A cache HIT costs one statSync instead of readFileSync + JSON.parse.
//
// The cached object is SHARED across callers — treat the return value as
// READ-ONLY. Every current caller only reads it; `persona set` reads+writes the
// file directly (bypassing this loader), so it never aliases the cache.
const _configCache = new Map(); // configPath -> { mtimeMs, value }

/**
 * Load project configuration from .chainlesschain/config.json
 *
 * The returned object is cached and shared — do not mutate it. To change the
 * config, read+write the file directly (see `cc persona set`).
 *
 * @param {string} projectRoot - Project root directory
 * @returns {object|null} Parsed config (READ-ONLY) or null on error
 */
export function loadProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".chainlesschain", "config.json");
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    // Missing / unreadable → no config. Drop any stale entry so a file that
    // reappears later is re-read rather than served from a dead cache slot.
    _configCache.delete(configPath);
    return null;
  }
  const cached = _configCache.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // Malformed JSON / read race → null (same as before). Cache it against the
    // current mtime so a persistently-broken file isn't re-read every tool call;
    // a later fix bumps mtime and invalidates this entry.
    value = null;
  }
  _configCache.set(configPath, { mtimeMs, value });
  return value;
}

/**
 * Test seam: clear the loadProjectConfig mtime cache. Not used in production —
 * the cache is process-lifetime and self-invalidates on mtime change.
 */
export function _clearProjectConfigCache() {
  _configCache.clear();
}

/**
 * Quick boolean check: are we inside a .chainlesschain project?
 * @param {string} [startDir] - Directory to check from
 * @returns {boolean}
 */
export function isInsideProject(startDir) {
  return findProjectRoot(startDir) !== null;
}
