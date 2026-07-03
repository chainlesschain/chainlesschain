/**
 * Plugin install lifecycle (Phase 3.3d) — put a plugin ONTO disk in an immutable
 * scope version directory, so the component wirings (skills / lsp / hooks) built
 * in 3.2–3.3c actually reach the agent for a real user instead of only for
 * hand-placed fixtures.
 *
 *   installFromDirectory(src, {scope}) → validate manifest → copy into
 *     <scopeRoot>/<encodedName>/<version>/  → mark that version active
 *   listInstalled({cwd})                 → discover across scopes
 *   uninstall(name, {scope, version})    → remove a version (or the whole plugin)
 *   setActiveVersion(name, version)      → repoint `.active` (rollback)
 *
 * Version directories are immutable: re-installing the same version refuses
 * unless `force`, so an in-flight session keeps running its bytes. The copy
 * skips symlinks (a symlink could later resolve outside the sandbox) and only
 * writes inside the destination version dir.
 */

import fs from "fs";
import path from "path";
import { parsePluginManifest, isWithin } from "./manifest.js";
import {
  pluginNameDir,
  pluginVersionDir,
  listInstalledVersions,
  activeVersion,
  discoverPlugins,
} from "./scopes.js";

export const _deps = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  rmSync: fs.rmSync,
  readdirSync: fs.readdirSync,
  copyFileSync: fs.copyFileSync,
  lstatSync: fs.lstatSync,
  writeFileSync: fs.writeFileSync,
};

/**
 * Install a plugin from a local directory into a scope's immutable version dir.
 * @param {string} srcDir  directory containing the plugin (with its manifest)
 * @param {object} opts     { scope="user", cwd, force=false }
 * @returns {{ name, version, scope, dir, warnings }}
 */
export function installFromDirectory(srcDir, opts = {}) {
  const scope = opts.scope || "user";
  const src = path.resolve(srcDir);
  if (!_deps.existsSync(src)) {
    throw new Error(`source directory does not exist: ${src}`);
  }

  const manifest = parsePluginManifest(src);
  if (!manifest.ok) {
    throw new Error(
      `plugin manifest is invalid:\n  - ${manifest.errors.join("\n  - ")}`,
    );
  }
  const { name, version } = manifest.metadata;

  const dest = pluginVersionDir(scope, name, version, { cwd: opts.cwd });
  if (_deps.existsSync(dest)) {
    if (!opts.force) {
      throw new Error(
        `${name}@${version} is already installed at ${scope} scope (immutable). ` +
          `Use --force to reinstall, or bump the version.`,
      );
    }
    _deps.rmSync(dest, { recursive: true, force: true });
  }

  _deps.mkdirSync(dest, { recursive: true });
  copyDirGuarded(src, dest, dest);

  // Make the freshly-installed version active.
  setActiveVersion(name, version, { scope, cwd: opts.cwd });

  return { name, version, scope, dir: dest, warnings: manifest.warnings };
}

/**
 * Install from a source string. Local existing directories are supported now;
 * git/GitHub sources are recognized but require a follow-up increment.
 */
export function installFromSource(source, opts = {}) {
  const asDir = path.resolve(String(source || ""));
  if (_deps.existsSync(asDir) && _deps.lstatSync(asDir).isDirectory()) {
    return installFromDirectory(asDir, opts);
  }
  if (/^https?:\/\/|\.git$|^git@|^[\w.-]+\/[\w.-]+$/.test(String(source))) {
    throw new Error(
      `remote source "${source}" is not supported yet — clone it locally and ` +
        `install from the directory (git/GitHub fetch is a follow-up increment).`,
    );
  }
  throw new Error(`source not found as a local directory: ${source}`);
}

/** List installed plugins (active version per name) across scopes. */
export function listInstalled(opts = {}) {
  return discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes }).map((p) => ({
    name: p.name,
    version: p.version,
    scope: p.scope,
    dir: p.root,
    ok: p.manifest?.ok === true,
  }));
}

/**
 * Uninstall a plugin. Without `version`, removes the whole plugin (all versions);
 * with `version`, removes just that one and repoints `.active` if needed.
 * @returns {{ removed: string[] }}
 */
export function uninstall(name, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const removed = [];

  if (opts.version) {
    const dir = pluginVersionDir(scope, name, opts.version, { cwd });
    if (!_deps.existsSync(dir)) {
      throw new Error(
        `${name}@${opts.version} is not installed at ${scope} scope`,
      );
    }
    _deps.rmSync(dir, { recursive: true, force: true });
    removed.push(opts.version);
    // Repoint .active to the newest remaining version, or clear it.
    const remaining = listInstalledVersions(scope, name, { cwd });
    const activeFile = path.join(
      pluginNameDir(scope, name, { cwd }),
      ".active",
    );
    if (remaining.length === 0) {
      _deps.rmSync(pluginNameDir(scope, name, { cwd }), {
        recursive: true,
        force: true,
      });
    } else if (_deps.existsSync(activeFile)) {
      _deps.writeFileSync(activeFile, remaining[0], "utf8");
    }
    return { removed };
  }

  const nameDir = pluginNameDir(scope, name, { cwd });
  if (!_deps.existsSync(nameDir)) {
    throw new Error(`${name} is not installed at ${scope} scope`);
  }
  removed.push(...listInstalledVersions(scope, name, { cwd }));
  _deps.rmSync(nameDir, { recursive: true, force: true });
  return { removed };
}

/** Pin a plugin's active version (rollback / switch). */
export function setActiveVersion(name, version, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const versionDir = pluginVersionDir(scope, name, version, { cwd });
  if (!_deps.existsSync(versionDir)) {
    throw new Error(`${name}@${version} is not installed at ${scope} scope`);
  }
  const activeFile = path.join(pluginNameDir(scope, name, { cwd }), ".active");
  _deps.writeFileSync(activeFile, String(version), "utf8");
  return { name, version, scope, active: version };
}

/** Which version is active for a plugin at a scope (or null). */
export function getActiveVersion(name, opts = {}) {
  return activeVersion(opts.scope || "user", name, { cwd: opts.cwd });
}

// ── guarded recursive copy ────────────────────────────────────────────────

/**
 * Copy `src` → `dst`, refusing to write outside `root` and skipping symlinks
 * (which could later resolve outside the plugin sandbox). Directories recurse.
 */
function copyDirGuarded(src, dst, root) {
  for (const entry of _deps.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (!isWithin(root, to)) continue; // never escape the version dir
    if (entry.isSymbolicLink()) continue; // do not copy symlinks
    if (entry.isDirectory()) {
      _deps.mkdirSync(to, { recursive: true });
      copyDirGuarded(from, to, root);
    } else if (entry.isFile()) {
      _deps.copyFileSync(from, to);
    }
  }
}
