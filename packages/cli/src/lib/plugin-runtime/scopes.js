/**
 * Plugin install scopes + on-disk discovery (Phase 3).
 *
 * A plugin can be installed at three scopes, mirroring the skill-loader layering:
 *
 *   user     — <userData>/plugins/            global to the machine/user
 *   project  — <root>/.chainlesschain/plugins/       committed, shared via the repo
 *   local    — <root>/.chainlesschain/plugins.local/ gitignored, per-developer
 *
 * Precedence on a name collision: local > project > user (the most specific
 * wins, same spirit as the skill layers).
 *
 * Each plugin lives in an IMMUTABLE version directory:
 *
 *   <scopeRoot>/<encodedName>/<version>/   (+ the plugin body)
 *
 * so an in-flight session keeps running its version even while another is
 * installed. The active version per (scope,name) is the one named by a
 * `.active` file, or the highest semver present if none is set.
 */

import fs from "fs";
import path from "path";
import semver from "semver";
import { getElectronUserDataDir } from "../paths.js";
import { parsePluginManifest } from "./manifest.js";
import {
  loadManagedPluginPolicy,
  filterByManagedPolicy,
  warnDroppedOnce,
} from "./policy.js";

export const _deps = {
  existsSync: fs.existsSync,
  readdirSync: fs.readdirSync,
  readFileSync: fs.readFileSync,
  statSync: fs.statSync,
};

// Lowest → highest precedence.
export const SCOPES = ["user", "project", "local"];

/** Filesystem-safe encoding of a (possibly scoped, e.g. @org/name) plugin name. */
export function encodeName(name) {
  return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "__");
}

/**
 * Resolve the root directory for a scope.
 * @param {"user"|"project"|"local"} scope
 * @param {object} [opts] { cwd }
 */
export function scopeRoot(scope, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  switch (scope) {
    case "user":
      return path.join(getElectronUserDataDir(), "plugins");
    case "project":
      return path.join(cwd, ".chainlesschain", "plugins");
    case "local":
      return path.join(cwd, ".chainlesschain", "plugins.local");
    default:
      throw new Error(`unknown plugin scope: ${scope}`);
  }
}

/** Directory that holds all versions of one plugin at a scope. */
export function pluginNameDir(scope, name, opts = {}) {
  return path.join(scopeRoot(scope, opts), encodeName(name));
}

/** Immutable install dir for a specific plugin version. */
export function pluginVersionDir(scope, name, version, opts = {}) {
  return path.join(pluginNameDir(scope, name, opts), String(version));
}

/** Versions present on disk for a plugin, newest semver first. */
export function listInstalledVersions(scope, name, opts = {}) {
  const dir = pluginNameDir(scope, name, opts);
  if (!dirExists(dir)) return [];
  return _deps
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((v) => semver.valid(v))
    .sort(semver.rcompare);
}

/** The active version for a plugin: `.active` file if valid, else highest semver. */
export function activeVersion(scope, name, opts = {}) {
  const versions = listInstalledVersions(scope, name, opts);
  if (versions.length === 0) return null;
  const activeFile = path.join(pluginNameDir(scope, name, opts), ".active");
  if (_deps.existsSync(activeFile)) {
    try {
      const pinned = _deps.readFileSync(activeFile, "utf8").trim();
      if (versions.includes(pinned)) return pinned;
    } catch {
      /* fall through to highest */
    }
  }
  return versions[0];
}

/**
 * Discover every installed plugin's ACTIVE version across all scopes, applying
 * scope precedence (local > project > user) so a name installed at multiple
 * scopes resolves to one parsed manifest.
 *
 * Managed org policy (allowedPlugins / deniedPlugins) is enforced fail-closed
 * here — the single chokepoint every component collector funnels through — so a
 * denied plugin loads NONE of its six component types. Pass `skipPolicy:true`
 * for tooling that must see even blocked plugins (e.g. `cc plugin installed`
 * showing why something is blocked). No managed settings file → no filtering.
 *
 * @param {object} [opts] { cwd, scopes?, skipPolicy?, env?, managedSettingsFile? }
 * @returns {Array<{scope, name, version, root, manifest}>}
 */
export function discoverPlugins(opts = {}) {
  const scopes = opts.scopes || SCOPES;
  const byName = new Map(); // name → record (later scope overrides earlier)
  for (const scope of scopes) {
    const root = scopeRoot(scope, opts);
    if (!dirExists(root)) continue;
    for (const encoded of listDirs(root)) {
      const nameDir = path.join(root, encoded);
      const version = activeVersionForDir(nameDir);
      if (!version) continue;
      const versionDir = path.join(nameDir, version);
      const manifest = parsePluginManifest(versionDir);
      manifest.scope = scope;
      const name = manifest.metadata?.name || encoded;
      byName.set(name, {
        scope,
        name,
        version: manifest.metadata?.version || version,
        root: versionDir,
        manifest,
      });
    }
  }
  const all = [...byName.values()];
  if (opts.skipPolicy) return all;
  // Enforce managed org allow/deny at load time (fail-closed). A malformed
  // managed settings file throws out of loadManagedPluginPolicy — that
  // propagates so a broken org policy never silently degrades to "no policy".
  const managed = loadManagedPluginPolicy({
    env: opts.env,
    managedSettingsFile: opts.managedSettingsFile,
  });
  if (!managed) return all;
  const { kept, dropped } = filterByManagedPolicy(all, managed);
  if (dropped.length > 0) warnDroppedOnce(dropped);
  return kept;
}

// ── internals ────────────────────────────────────────────────────────────

function activeVersionForDir(nameDir) {
  if (!dirExists(nameDir)) return null;
  const versions = _deps
    .readdirSync(nameDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((v) => semver.valid(v))
    .sort(semver.rcompare);
  if (versions.length === 0) return null;
  const activeFile = path.join(nameDir, ".active");
  if (_deps.existsSync(activeFile)) {
    try {
      const pinned = _deps.readFileSync(activeFile, "utf8").trim();
      if (versions.includes(pinned)) return pinned;
    } catch {
      /* fall through */
    }
  }
  return versions[0];
}

function dirExists(dir) {
  try {
    return _deps.existsSync(dir) && _deps.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listDirs(dir) {
  try {
    return _deps
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
