/**
 * Plugin Auto-Discovery — zero-friction file-drop plugin loading.
 *
 * Scans ~/.chainlesschain/plugins/*.js for auto-loadable plugins.
 * Hermes-style: drop a .js file, restart agent, it's available.
 *
 * Plugin exports:
 *   { name, version?, description?, tools?, hooks?, commands? }
 *
 * - tools[]  → injected via extraTools in agent-core
 * - hooks{}  → auto-registered in HookManager
 * - commands{} → added to REPL slash commands
 *
 * DB-registered plugins (plugin-manager.js) override file-drop plugins
 * with the same name.
 *
 * @module plugin-autodiscovery
 */

import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { getHomeDir } from "./paths.js";

// ─── Constants ──────────────────────────────────────────────────────

const PLUGINS_DIR_NAME = "plugins";

// ─── Exported for test injection ────────────────────────────────────

export const _deps = {
  readdirSync,
  existsSync,
  mkdirSync,
};

// ─── Path ───────────────────────────────────────────────────────────

/**
 * Get the file-drop plugins directory path.
 * @returns {string}
 */
export function getPluginDir() {
  return join(getHomeDir(), PLUGINS_DIR_NAME);
}

// ─── Validation ─────────────────────────────────────────────────────

/**
 * Validate a plugin's exported shape.
 * @param {object} mod - Module exports
 * @param {string} filePath - Source file (for error messages)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePluginExports(mod, filePath) {
  const errors = [];
  const fname = basename(filePath);

  if (!mod || typeof mod !== "object") {
    return { valid: false, errors: [`${fname}: exports is not an object`] };
  }

  if (!mod.name || typeof mod.name !== "string") {
    errors.push(`${fname}: missing or invalid 'name' (string required)`);
  }

  if (mod.tools && !Array.isArray(mod.tools)) {
    errors.push(`${fname}: 'tools' must be an array`);
  }

  if (mod.hooks && typeof mod.hooks !== "object") {
    errors.push(`${fname}: 'hooks' must be an object`);
  }

  if (mod.commands && typeof mod.commands !== "object") {
    errors.push(`${fname}: 'commands' must be an object`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Scan ───────────────────────────────────────────────────────────

/**
 * Scan the plugins directory and return .js file paths.
 * @returns {string[]} Array of absolute paths to .js files
 */
export function scanPluginDir() {
  const dir = getPluginDir();
  if (!_deps.existsSync(dir)) {
    return [];
  }

  try {
    const entries = _deps.readdirSync(dir);
    return entries.filter((f) => extname(f) === ".js").map((f) => join(dir, f));
  } catch (_err) {
    return [];
  }
}

// ─── Load ───────────────────────────────────────────────────────────

/**
 * Load a single file-drop plugin.
 * @param {string} filePath - Absolute path to the .js file
 * @returns {Promise<{ plugin: object|null, errors: string[] }>}
 */
export async function loadFileDropPlugin(filePath) {
  try {
    const fileUrl = pathToFileURL(filePath).href;
    const mod = await import(fileUrl);
    // Handle both default export and named exports
    const exports = mod.default || mod;

    const { valid, errors } = validatePluginExports(exports, filePath);
    if (!valid) {
      return { plugin: null, errors };
    }

    return {
      plugin: {
        ...exports,
        source: "file-drop",
        filePath,
      },
      errors: [],
    };
  } catch (err) {
    return {
      plugin: null,
      errors: [`${basename(filePath)}: load failed — ${err.message}`],
    };
  }
}

// ─── Discover All ───────────────────────────────────────────────────

/**
 * Discover and load all file-drop plugins.
 * @param {object} [options]
 * @param {string[]} [options.dbPluginNames] - Names of DB-registered plugins (these take priority)
 * @param {function} [options.onWarn] - Warning callback (message) => void
 * @returns {Promise<{ plugins: object[], errors: string[] }>}
 */
export async function getAutoDiscoveredPlugins(options = {}) {
  const { dbPluginNames = [], onWarn } = options;
  const dbNameSet = new Set(dbPluginNames);
  const files = scanPluginDir();
  const plugins = [];
  const errors = [];

  for (const filePath of files) {
    const result = await loadFileDropPlugin(filePath);
    if (result.errors.length > 0) {
      errors.push(...result.errors);
      if (onWarn) result.errors.forEach((e) => onWarn(e));
      continue;
    }

    // DB-registered plugin with same name takes priority
    if (dbNameSet.has(result.plugin.name)) {
      if (onWarn) {
        onWarn(
          `Plugin "${result.plugin.name}" skipped (DB-registered version takes priority)`,
        );
      }
      continue;
    }

    plugins.push(result.plugin);
  }

  return { plugins, errors };
}

// ─── Tool extraction ────────────────────────────────────────────────

/**
 * Extract tool definitions from loaded file-drop plugins.
 * Returns tools in OpenAI function-calling format.
 * @param {object[]} plugins - Loaded plugins from getAutoDiscoveredPlugins
 * @returns {object[]} Tool definitions ready for extraTools
 */
export function extractPluginTools(plugins) {
  const tools = [];
  for (const plugin of plugins) {
    if (!plugin.tools || !Array.isArray(plugin.tools)) continue;
    for (const tool of plugin.tools) {
      if (tool?.function?.name) {
        tools.push({ ...tool, _pluginSource: plugin.name });
      }
    }
  }
  return tools;
}

/**
 * Extract REPL commands from loaded file-drop plugins.
 * @param {object[]} plugins - Loaded plugins
 * @returns {Map<string, { handler: function, description: string, pluginName: string }>}
 */
export function extractPluginCommands(plugins) {
  const commands = new Map();
  for (const plugin of plugins) {
    if (!plugin.commands || typeof plugin.commands !== "object") continue;
    for (const [cmdName, cmdDef] of Object.entries(plugin.commands)) {
      if (typeof cmdDef === "function") {
        commands.set(cmdName, {
          handler: cmdDef,
          description: "",
          pluginName: plugin.name,
        });
      } else if (cmdDef && typeof cmdDef.handler === "function") {
        commands.set(cmdName, {
          handler: cmdDef.handler,
          description: cmdDef.description || "",
          pluginName: plugin.name,
        });
      }
    }
  }
  return commands;
}

// =====================================================================
// plugin-autodiscovery V2 governance overlay (iter26)
// =====================================================================
export const PADGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const PADGOV_SCAN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SCANNING: "scanning",
  SCANNED: "scanned",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _padgovPTrans = new Map([
  [
    PADGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PADGOV_PROFILE_MATURITY_V2.ACTIVE,
      PADGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PADGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PADGOV_PROFILE_MATURITY_V2.STALE,
      PADGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PADGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      PADGOV_PROFILE_MATURITY_V2.ACTIVE,
      PADGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PADGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _padgovPTerminal = new Set([PADGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _padgovJTrans = new Map([
  [
    PADGOV_SCAN_LIFECYCLE_V2.QUEUED,
    new Set([
      PADGOV_SCAN_LIFECYCLE_V2.SCANNING,
      PADGOV_SCAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PADGOV_SCAN_LIFECYCLE_V2.SCANNING,
    new Set([
      PADGOV_SCAN_LIFECYCLE_V2.SCANNED,
      PADGOV_SCAN_LIFECYCLE_V2.FAILED,
      PADGOV_SCAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PADGOV_SCAN_LIFECYCLE_V2.SCANNED, new Set()],
  [PADGOV_SCAN_LIFECYCLE_V2.FAILED, new Set()],
  [PADGOV_SCAN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _padgovPsV2 = new Map();
const _padgovJsV2 = new Map();
let _padgovMaxActive = 6,
  _padgovMaxPending = 15,
  _padgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _padgovStuckMs = 60 * 1000;
function _padgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _padgovCheckP(from, to) {
  const a = _padgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid padgov profile transition ${from} → ${to}`);
}
function _padgovCheckJ(from, to) {
  const a = _padgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid padgov scan transition ${from} → ${to}`);
}
function _padgovCountActive(owner) {
  let c = 0;
  for (const p of _padgovPsV2.values())
    if (p.owner === owner && p.status === PADGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _padgovCountPending(profileId) {
  let c = 0;
  for (const j of _padgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === PADGOV_SCAN_LIFECYCLE_V2.QUEUED ||
        j.status === PADGOV_SCAN_LIFECYCLE_V2.SCANNING)
    )
      c++;
  return c;
}
export function setMaxActivePadgovProfilesPerOwnerV2(n) {
  _padgovMaxActive = _padgovPos(n, "maxActivePadgovProfilesPerOwner");
}
export function getMaxActivePadgovProfilesPerOwnerV2() {
  return _padgovMaxActive;
}
export function setMaxPendingPadgovScansPerProfileV2(n) {
  _padgovMaxPending = _padgovPos(n, "maxPendingPadgovScansPerProfile");
}
export function getMaxPendingPadgovScansPerProfileV2() {
  return _padgovMaxPending;
}
export function setPadgovProfileIdleMsV2(n) {
  _padgovIdleMs = _padgovPos(n, "padgovProfileIdleMs");
}
export function getPadgovProfileIdleMsV2() {
  return _padgovIdleMs;
}
export function setPadgovScanStuckMsV2(n) {
  _padgovStuckMs = _padgovPos(n, "padgovScanStuckMs");
}
export function getPadgovScanStuckMsV2() {
  return _padgovStuckMs;
}
export function _resetStatePluginAutodiscoveryGovV2() {
  _padgovPsV2.clear();
  _padgovJsV2.clear();
  _padgovMaxActive = 6;
  _padgovMaxPending = 15;
  _padgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _padgovStuckMs = 60 * 1000;
}
export function registerPadgovProfileV2({ id, owner, root, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_padgovPsV2.has(id))
    throw new Error(`padgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    root: root || ".chainlesschain",
    status: PADGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _padgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePadgovProfileV2(id) {
  const p = _padgovPsV2.get(id);
  if (!p) throw new Error(`padgov profile ${id} not found`);
  const isInitial = p.status === PADGOV_PROFILE_MATURITY_V2.PENDING;
  _padgovCheckP(p.status, PADGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _padgovCountActive(p.owner) >= _padgovMaxActive)
    throw new Error(`max active padgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PADGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stalePadgovProfileV2(id) {
  const p = _padgovPsV2.get(id);
  if (!p) throw new Error(`padgov profile ${id} not found`);
  _padgovCheckP(p.status, PADGOV_PROFILE_MATURITY_V2.STALE);
  p.status = PADGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePadgovProfileV2(id) {
  const p = _padgovPsV2.get(id);
  if (!p) throw new Error(`padgov profile ${id} not found`);
  _padgovCheckP(p.status, PADGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PADGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPadgovProfileV2(id) {
  const p = _padgovPsV2.get(id);
  if (!p) throw new Error(`padgov profile ${id} not found`);
  if (_padgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal padgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPadgovProfileV2(id) {
  const p = _padgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPadgovProfilesV2() {
  return [..._padgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPadgovScanV2({ id, profileId, path, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_padgovJsV2.has(id)) throw new Error(`padgov scan ${id} already exists`);
  if (!_padgovPsV2.has(profileId))
    throw new Error(`padgov profile ${profileId} not found`);
  if (_padgovCountPending(profileId) >= _padgovMaxPending)
    throw new Error(
      `max pending padgov scans for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    path: path || "",
    status: PADGOV_SCAN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _padgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function scanningPadgovScanV2(id) {
  const j = _padgovJsV2.get(id);
  if (!j) throw new Error(`padgov scan ${id} not found`);
  _padgovCheckJ(j.status, PADGOV_SCAN_LIFECYCLE_V2.SCANNING);
  const now = Date.now();
  j.status = PADGOV_SCAN_LIFECYCLE_V2.SCANNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeScanPadgovV2(id) {
  const j = _padgovJsV2.get(id);
  if (!j) throw new Error(`padgov scan ${id} not found`);
  _padgovCheckJ(j.status, PADGOV_SCAN_LIFECYCLE_V2.SCANNED);
  const now = Date.now();
  j.status = PADGOV_SCAN_LIFECYCLE_V2.SCANNED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPadgovScanV2(id, reason) {
  const j = _padgovJsV2.get(id);
  if (!j) throw new Error(`padgov scan ${id} not found`);
  _padgovCheckJ(j.status, PADGOV_SCAN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = PADGOV_SCAN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPadgovScanV2(id, reason) {
  const j = _padgovJsV2.get(id);
  if (!j) throw new Error(`padgov scan ${id} not found`);
  _padgovCheckJ(j.status, PADGOV_SCAN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = PADGOV_SCAN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPadgovScanV2(id) {
  const j = _padgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPadgovScansV2() {
  return [..._padgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdlePadgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _padgovPsV2.values())
    if (
      p.status === PADGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _padgovIdleMs
    ) {
      p.status = PADGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPadgovScansV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _padgovJsV2.values())
    if (
      j.status === PADGOV_SCAN_LIFECYCLE_V2.SCANNING &&
      j.startedAt != null &&
      t - j.startedAt >= _padgovStuckMs
    ) {
      j.status = PADGOV_SCAN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getPluginAutodiscoveryGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PADGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _padgovPsV2.values()) profilesByStatus[p.status]++;
  const scansByStatus = {};
  for (const v of Object.values(PADGOV_SCAN_LIFECYCLE_V2)) scansByStatus[v] = 0;
  for (const j of _padgovJsV2.values()) scansByStatus[j.status]++;
  return {
    totalPadgovProfilesV2: _padgovPsV2.size,
    totalPadgovScansV2: _padgovJsV2.size,
    maxActivePadgovProfilesPerOwner: _padgovMaxActive,
    maxPendingPadgovScansPerProfile: _padgovMaxPending,
    padgovProfileIdleMs: _padgovIdleMs,
    padgovScanStuckMs: _padgovStuckMs,
    profilesByStatus,
    scansByStatus,
  };
}
