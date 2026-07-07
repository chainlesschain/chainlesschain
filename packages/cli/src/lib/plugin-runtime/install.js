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
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { parsePluginManifest, isWithin } from "./manifest.js";
import {
  pluginNameDir,
  pluginVersionDir,
  listInstalledVersions,
  activeVersion,
  discoverPlugins,
} from "./scopes.js";
import { verifyPluginManifest } from "../plugin-security.js";
import { writePluginLock, LOCK_FILENAME } from "./signature.js";

export const _deps = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  rmSync: fs.rmSync,
  readdirSync: fs.readdirSync,
  copyFileSync: fs.copyFileSync,
  lstatSync: fs.lstatSync,
  writeFileSync: fs.writeFileSync,
  mkdtempSync: fs.mkdtempSync,
  spawnSync,
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

  // Optional signature/integrity verification of the manifest at install time
  // (Phase 3.3l). verifyPluginManifest THROWS on any mismatch/failure — a signed
  // install that fails verification must not land on disk (fail-closed). On
  // success we record a `.plugin-lock.json` so load-time requireSignedPlugins
  // can re-check it without the original signature/key files.
  let verification = null;
  const sig = opts.signature;
  if (sig && (sig.sha256 || sig.signatureFile || sig.requireSignature)) {
    verification = verifyPluginManifest({
      manifestFile: manifest.manifestPath,
      expectedSha256: sig.sha256,
      signatureFile: sig.signatureFile,
      publicKeyFile: sig.publicKeyFile,
      requireSignature: sig.requireSignature === true,
      trustedKeySha256: sig.trustedKeySha256 || null,
      requireTrustedKey: sig.requireTrustedKey === true,
    });
  }

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

  // A lock may ONLY exist if THIS installer wrote it. The source is untrusted
  // and may ship its own `.plugin-lock.json` (copied verbatim above) — on an
  // unsigned install that forged lock would otherwise survive into the
  // "immutable" version dir and defeat load-time requireSignedPlugins.
  _deps.rmSync(path.join(dest, LOCK_FILENAME), { force: true });

  // Record the verified signature into the installed (immutable) version dir so
  // load-time enforcement can re-check it. The manifest was copied verbatim, so
  // its bytes/sha in `dest` match what we verified in `src`.
  if (verification) {
    const destManifest = path.join(
      dest,
      path.relative(src, manifest.manifestPath),
    );
    writePluginLock(dest, {
      manifestFile: destManifest,
      sha256: verification.sha256,
      publicKeySha256: verification.publicKeySha256,
      signatureVerified: verification.signatureVerified === true,
      signatureBase64: verification.signatureBase64,
      publicKeyPem: verification.publicKeyPem,
    });
  }

  // Make the freshly-installed version active.
  setActiveVersion(name, version, { scope, cwd: opts.cwd });

  return {
    name,
    version,
    scope,
    dir: dest,
    warnings: manifest.warnings,
    signatureVerified: verification?.signatureVerified === true,
  };
}

/**
 * Install from a source string:
 *   - a local directory                         → copied in directly
 *   - a git URL (https://…, git@…, ….git, file://…) → shallow-cloned then installed
 *   - GitHub shorthand `owner/repo`             → https://github.com/owner/repo.git
 * An optional `#ref` (branch / tag / commit) pins the checkout.
 */
export function installFromSource(source, opts = {}) {
  return _withMaterializedSource(source, (dir, info) => {
    const res = installFromDirectory(dir, opts);
    return info ? { ...res, source: info.url, ref: info.ref || null } : res;
  });
}

/**
 * Materialize a source string into a local directory (cloning a git source into
 * a temp dir), invoke `fn(dir, gitInfo|null)`, then clean up any temp checkout.
 * Single fetch shared by installFromSource + updatePlugin.
 */
function _withMaterializedSource(source, fn) {
  const raw = String(source || "");
  const asDir = path.resolve(raw);
  if (_deps.existsSync(asDir) && _deps.lstatSync(asDir).isDirectory()) {
    return fn(asDir, null);
  }
  const git = parseGitSource(raw);
  if (git) {
    const cloned = fetchGitRepo(git.url, git.ref);
    try {
      return fn(cloned, git);
    } finally {
      try {
        _deps.rmSync(path.dirname(cloned), { recursive: true, force: true });
      } catch {
        /* temp cleanup is best-effort */
      }
    }
  }
  throw new Error(
    `source not found as a local directory or git URL: ${source}`,
  );
}

/**
 * Update an installed plugin from a source (local dir or git). Fetches the
 * source ONCE, reads its name+version, and:
 *   - a NEW version    → installs the new immutable version dir + repoints
 *     `.active` (the old version stays on disk for rollback via `cc plugin use`);
 *   - the SAME version → no-op unless `--force` reinstalls it.
 * Returns { name, version, previousVersion, updated, reinstalled }.
 */
export function updatePlugin(source, opts = {}) {
  const scope = opts.scope || "user";
  return _withMaterializedSource(source, (dir, info) => {
    const manifest = parsePluginManifest(dir);
    if (!manifest.ok) {
      throw new Error(
        `plugin manifest is invalid:\n  - ${manifest.errors.join("\n  - ")}`,
      );
    }
    const { name, version } = manifest.metadata;
    const previousVersion = getActiveVersion(name, { scope, cwd: opts.cwd });
    const dest = pluginVersionDir(scope, name, version, { cwd: opts.cwd });
    const sameVersionExists = _deps.existsSync(dest);

    if (sameVersionExists && !opts.force) {
      // Already at this version — make sure it's the active one, but don't
      // reinstall an immutable dir.
      if (previousVersion !== version) {
        setActiveVersion(name, version, { scope, cwd: opts.cwd });
      }
      return {
        name,
        version,
        previousVersion,
        updated: previousVersion !== version,
        reinstalled: false,
        source: info ? info.url : null,
      };
    }

    const res = installFromDirectory(dir, { ...opts, scope, force: true });
    return {
      ...res,
      previousVersion,
      updated: previousVersion !== version,
      reinstalled: sameVersionExists,
      source: info ? info.url : null,
      ref: info ? info.ref || null : null,
    };
  });
}

/**
 * Classify a source string into a git URL (+ optional ref), or null when it is
 * not remote-looking. `owner/repo` expands to a GitHub HTTPS URL.
 */
export function parseGitSource(raw) {
  const [loc, ref] = String(raw || "").split("#");
  if (!loc) return null;
  if (
    /^(https?|git|ssh|file):\/\//.test(loc) ||
    loc.endsWith(".git") ||
    /^git@/.test(loc)
  ) {
    return { url: loc, ref: ref || null };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(loc)) {
    return { url: `https://github.com/${loc}.git`, ref: ref || null };
  }
  return null;
}

/**
 * Shallow-clone `url` (optionally at `ref`) into a fresh temp dir and return the
 * checkout path. Uses `git` via spawn WITHOUT a shell (url/ref are argv, not a
 * command line — no injection). Caller removes the temp dir's parent.
 */
export function fetchGitRepo(url, ref) {
  const base = _deps.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-git-"));
  const dir = path.join(base, "repo");
  const run = (args) =>
    _deps.spawnSync("git", args, {
      encoding: "utf8",
      timeout: 120000,
      windowsHide: true,
      shell: false,
    });

  const cloneArgs = ["clone", "--depth", "1"];
  if (ref) cloneArgs.push("--branch", ref);
  cloneArgs.push(url, dir);
  let res = run(cloneArgs);
  if (res.error && res.error.code === "ENOENT") {
    throw new Error("git is not installed (needed to fetch a remote plugin)");
  }
  if (res.status !== 0) {
    // A commit SHA can't be used with --branch/--depth; retry with a full clone
    // then checkout the ref explicitly.
    if (ref) {
      try {
        _deps.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const full = run(["clone", url, dir]);
      if (!full.error && full.status === 0) {
        const co = run(["-C", dir, "checkout", ref]);
        if (co.status === 0) return dir;
      }
    }
    const reason = (res.stderr || "").trim() || `git exited ${res.status}`;
    throw new Error(`git clone failed for ${url}: ${reason}`);
  }
  return dir;
}

/**
 * List installed plugins (active version per name) across scopes. Uses
 * `skipPolicy` so the ADMIN view shows every plugin on disk — including one an
 * org managed policy blocks from LOADING — otherwise a denied plugin would be
 * invisible and impossible to inspect / uninstall / un-deny.
 */
export function listInstalled(opts = {}) {
  return discoverPlugins({
    cwd: opts.cwd,
    scopes: opts.scopes,
    skipPolicy: true,
  }).map((p) => ({
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
    // Capture the active version BEFORE removing, so we only repoint `.active`
    // when the version we removed WAS the active one. Removing a NON-active
    // version (e.g. cleaning up a newer version after rolling back to an older
    // pinned one) must not silently change which version is active — the old
    // code always rewrote `.active` to the newest remaining, so uninstalling an
    // unrelated version could bump the user's pinned choice.
    const removedWasActive =
      getActiveVersion(name, { scope, cwd }) === opts.version;
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
    } else if (removedWasActive && _deps.existsSync(activeFile)) {
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
