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
import { parsePluginManifest, isWithin } from "./manifest.js";
import {
  pluginNameDir,
  pluginVersionDir,
  listInstalledVersions,
  activeVersion,
  discoverPlugins,
  DISABLED_FILENAME,
} from "./scopes.js";
import {
  enforcePluginPolicy,
  verifyPluginManifest,
} from "../plugin-security.js";
import {
  writePluginLock,
  buildPluginSbom,
  LOCK_FILENAME,
  readPluginLock,
  verifyInstalledSignature,
} from "./signature.js";
import { loadManagedPluginPolicy, filterByManagedPolicy } from "./policy.js";
import { managedSettingsPath } from "../settings-loader.cjs";
import executionBroker from "../process-execution-broker/index.js";

export const MAX_LISTED_PLUGIN_VERSIONS = 64;
export const SOURCE_METADATA_FILENAME = ".plugin-source.json";

export const _deps = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  rmSync: fs.rmSync,
  renameSync: fs.renameSync,
  readdirSync: fs.readdirSync,
  readFileSync: fs.readFileSync,
  copyFileSync: fs.copyFileSync,
  lstatSync: fs.lstatSync,
  writeFileSync: fs.writeFileSync,
  mkdtempSync: fs.mkdtempSync,
  spawnSync: (...args) => executionBroker.spawnSync(...args),
};

const pendingPluginTransactions = new WeakMap();

/**
 * Install a plugin from a local directory into a scope's immutable version dir.
 * @param {string} srcDir  directory containing the plugin (with its manifest)
 * @param {object} opts     { scope="user", cwd, force=false, expectedIdentity? }
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
  assertExpectedPluginIdentity(name, version, opts.expectedIdentity);
  const sourceMetadata = normalizeSourceMetadata(opts.sourceMetadata);
  if (opts.managedPolicy) {
    enforcePluginPolicy(
      {
        name,
        source: opts.policySource || sourceMetadata?.source || null,
        action: "install",
      },
      opts.managedPolicy,
    );
  }

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
  const destExists = _deps.existsSync(dest);
  if (destExists && !opts.force) {
    throw new Error(
      `${name}@${version} is already installed at ${scope} scope (immutable). ` +
        `Use --force to reinstall, or bump the version.`,
    );
  }

  const nameDir = pluginNameDir(scope, name, { cwd: opts.cwd });
  _deps.mkdirSync(nameDir, { recursive: true });
  const transactionRoot = _deps.mkdtempSync(path.join(nameDir, ".install-"));
  const staged = path.join(transactionRoot, "staged");
  const backup = destExists ? path.join(transactionRoot, "previous") : null;
  const previousActive = getActiveVersion(name, { scope, cwd: opts.cwd });
  let installedAtDest = false;
  let transactionRetained = false;

  try {
    _deps.mkdirSync(staged, { recursive: true });
    copyDirGuarded(src, staged, staged);

    // A lock may ONLY exist if THIS installer wrote it. The source is untrusted
    // and may ship its own `.plugin-lock.json` or provenance metadata.
    _deps.rmSync(path.join(staged, LOCK_FILENAME), { force: true });
    _deps.rmSync(path.join(staged, SOURCE_METADATA_FILENAME), { force: true });

    if (sourceMetadata) {
      _deps.writeFileSync(
        path.join(staged, SOURCE_METADATA_FILENAME),
        JSON.stringify(sourceMetadata, null, 2),
        "utf8",
      );
    }

    // Record only a cryptographically verified signature into the staged
    // immutable version. A hash-only registry check is re-run below but must
    // not create a signature lock or imply that the publisher was verified.
    // Signed installs also bind the complete component SBOM before activation.
    if (verification?.signatureVerified === true) {
      const stagedManifest = path.join(
        staged,
        path.relative(src, manifest.manifestPath),
      );
      writePluginLock(staged, {
        manifestFile: stagedManifest,
        sha256: verification.sha256,
        publicKeySha256: verification.publicKeySha256,
        signatureVerified: verification.signatureVerified === true,
        signatureBase64: verification.signatureBase64,
        publicKeyPem: verification.publicKeyPem,
        sbom: buildPluginSbom(staged),
      });
    }
    validateStagedInstall(staged, { name, version, verification });

    // Commit the fully validated directory with same-volume renames. A forced
    // same-version reinstall retains the old bytes until the caller finalizes
    // the upgrade transaction.
    if (backup) _deps.renameSync(dest, backup);
    try {
      _deps.renameSync(staged, dest);
      installedAtDest = true;
    } catch (error) {
      if (backup && _deps.existsSync(backup) && !_deps.existsSync(dest)) {
        _deps.renameSync(backup, dest);
      }
      throw error;
    }

    try {
      setActiveVersion(name, version, { scope, cwd: opts.cwd });
    } catch (error) {
      restoreInstalledBytes({ dest, backup });
      restoreActivePointer(name, previousActive, { scope, cwd: opts.cwd });
      installedAtDest = false;
      throw error;
    }

    const result = {
      name,
      version,
      scope,
      dir: dest,
      warnings: manifest.warnings,
      signatureVerified: verification?.signatureVerified === true,
      sourceMetadata,
      enabled: isPluginEnabled(name, { scope, cwd: opts.cwd }),
      loadValidated: true,
    };
    if (opts.transactional === true) {
      pendingPluginTransactions.set(result, {
        name,
        version,
        scope,
        cwd: opts.cwd,
        dest,
        backup,
        transactionRoot,
        previousActive,
      });
      transactionRetained = true;
    }
    return result;
  } finally {
    if (!transactionRetained) {
      if (installedAtDest && backup && _deps.existsSync(backup)) {
        _deps.rmSync(backup, { recursive: true, force: true });
      }
      _deps.rmSync(transactionRoot, { recursive: true, force: true });
    }
  }
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
    const sourceMetadata =
      normalizeSourceMetadata(opts.sourceMetadata) ||
      normalizeSourceMetadata(
        info
          ? { type: "git", source: info.url, ref: info.ref || null }
          : { type: "local", source: path.resolve(String(source || "")) },
      );
    const res = installFromDirectory(dir, { ...opts, sourceMetadata });
    return info
      ? {
          ...res,
          source: sourceMetadata?.source || null,
          ref: sourceMetadata?.ref || null,
        }
      : res;
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
    assertExpectedPluginIdentity(name, version, opts.expectedIdentity);
    const sourceMetadata =
      normalizeSourceMetadata(opts.sourceMetadata) ||
      normalizeSourceMetadata(
        info
          ? { type: "git", source: info.url, ref: info.ref || null }
          : { type: "local", source: path.resolve(String(source || "")) },
      );
    const previousVersion = getActiveVersion(name, { scope, cwd: opts.cwd });
    const dest = pluginVersionDir(scope, name, version, { cwd: opts.cwd });
    const sameVersionExists = _deps.existsSync(dest);

    if (sameVersionExists && !opts.force) {
      // Already at this version — make sure it's the active one, but don't
      // reinstall an immutable dir.
      if (previousVersion !== version) {
        setActiveVersion(name, version, { scope, cwd: opts.cwd });
      }
      const result = {
        name,
        version,
        previousVersion,
        updated: previousVersion !== version,
        reinstalled: false,
        source: sourceMetadata?.source || null,
        ref: sourceMetadata?.ref || null,
      };
      if (opts.transactional === true && previousVersion !== version) {
        pendingPluginTransactions.set(result, {
          name,
          version,
          scope,
          cwd: opts.cwd,
          dest,
          backup: null,
          transactionRoot: null,
          previousActive: previousVersion,
          pointerOnly: true,
        });
      }
      return result;
    }

    const res = installFromDirectory(dir, {
      ...opts,
      scope,
      force: true,
      sourceMetadata,
      transactional: opts.transactional === true,
    });
    const result = {
      ...res,
      previousVersion,
      updated: previousVersion !== version,
      reinstalled: sameVersionExists,
      source: sourceMetadata?.source || null,
      ref: sourceMetadata?.ref || null,
    };
    transferPendingTransaction(res, result);
    return result;
  });
}

/**
 * Commit a transactional update after capability consent and command-layer
 * validation have succeeded. Backup cleanup is best-effort: an active,
 * validated install must not be reported as failed solely because antivirus or
 * another reader briefly holds the hidden rollback directory open.
 */
export function finalizePluginUpdate(result) {
  const transaction = pendingPluginTransactions.get(result);
  if (!transaction) return { finalized: false };
  pendingPluginTransactions.delete(result);
  let cleanupPending = false;
  if (transaction.transactionRoot) {
    try {
      _deps.rmSync(transaction.transactionRoot, {
        recursive: true,
        force: true,
      });
    } catch {
      cleanupPending = true;
    }
  }
  return { finalized: true, cleanupPending };
}

/**
 * Restore the active version and, for a forced same-version reinstall, the
 * exact prior bytes. New rejected versions are removed so `.active` fallback
 * cannot silently select them later.
 */
export function rollbackPluginUpdate(result) {
  const transaction = pendingPluginTransactions.get(result);
  if (!transaction) return { rolledBack: false, version: null };

  restoreActivePointer(
    transaction.name,
    transaction.previousActive,
    transaction,
  );
  if (!transaction.pointerOnly) {
    restoreInstalledBytes(transaction);
  }
  pendingPluginTransactions.delete(result);
  if (transaction.transactionRoot) {
    _deps.rmSync(transaction.transactionRoot, {
      recursive: true,
      force: true,
    });
  }
  return {
    rolledBack: true,
    version: transaction.previousActive || null,
  };
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
  // git argv-injection guard: a value starting with "-" is parsed by git as an
  // OPTION, not a URL/ref — e.g. a registry-supplied ref "-f" reaches
  // `git checkout <ref>` on the full-clone retry path, and an option-looking
  // url reaches `git clone`. Real git URLs/refs never start with "-"
  // (check-ref-format forbids it), so reject instead of trying to escape.
  if (String(url).startsWith("-")) {
    throw new Error(`refusing git source that looks like an option: ${url}`);
  }
  if (ref != null && String(ref).startsWith("-")) {
    throw new Error(`refusing git ref that looks like an option: ${ref}`);
  }
  const base = _deps.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-git-"));
  const dir = path.join(base, "repo");
  const run = (args) =>
    _deps.spawnSync("git", args, {
      encoding: "utf8",
      timeout: 120000,
      windowsHide: true,
      origin: "plugin:install-git",
      policy: "allow",
      scope: "plugin-install",
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
  let managed = null;
  let managedError = null;
  try {
    managed = loadManagedPluginPolicy({
      env: opts.env,
      managedSettingsFile: opts.managedSettingsFile,
    });
  } catch (error) {
    managedError = error;
  }
  const policySource = managedSettingsPath({
    env: opts.env,
    managedSettingsFile: opts.managedSettingsFile,
  });

  return discoverPlugins({
    cwd: opts.cwd,
    scopes: opts.scopes,
    skipPolicy: true,
    includeDisabled: true,
  }).map((p) => {
    const allVersions = listInstalledVersions(p.scope, p.name, {
      cwd: opts.cwd,
    });
    const versions = allVersions.slice(0, MAX_LISTED_PLUGIN_VERSIONS);
    if (
      p.version &&
      !versions.includes(p.version) &&
      allVersions.includes(p.version)
    ) {
      versions[versions.length - 1] = p.version;
    }
    const lock = readPluginLock(p.root);
    const signature = verifyInstalledSignature(p);
    const policyResult =
      managed && !managedError
        ? filterByManagedPolicy([p], managed)
        : { kept: [p], dropped: [] };
    const policyDrop = policyResult.dropped[0] || null;
    const sbomFiles = Array.isArray(lock?.sbom?.files)
      ? lock.sbom.files.slice(0, 100000)
      : [];
    return {
      name: p.name,
      version: p.version,
      versions,
      scope: p.scope,
      dir: p.root,
      ok: p.manifest?.ok === true,
      enabled: p.enabled !== false,
      source: readSourceMetadata(p.root),
      integrity: {
        signature: {
          present: Boolean(lock?.signatureBase64 && lock?.publicKeyPem),
          verified: signature.signed === true,
          reason: signature.signed ? null : signature.reason || "unsigned",
          manifestSha256: lock?.sha256 || null,
          publicKeySha256:
            signature.publicKeySha256 || lock?.publicKeySha256 || null,
        },
        sbom: {
          present: Boolean(lock?.sbom),
          digest: lock?.sbom?.digest || null,
          fileCount: sbomFiles.length,
          totalBytes: Math.min(
            Number.MAX_SAFE_INTEGER,
            sbomFiles.reduce(
              (sum, file) =>
                sum +
                (Number.isFinite(Number(file?.bytes)) && Number(file.bytes) > 0
                  ? Number(file.bytes)
                  : 0),
              0,
            ),
          ),
        },
      },
      policy: {
        managed: Boolean(managed) || Boolean(managedError),
        source: policySource,
        allowed: !managedError && !policyDrop,
        reason: managedError
          ? managedError.message
          : policyDrop?.reason || (managed ? "allowed by managed policy" : ""),
        requireSigned:
          managed?.requireSignedPlugins === true ||
          managed?.requireSignedPlugins === "require",
      },
    };
  });
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
  const nameDir = pluginNameDir(scope, name, { cwd });
  const activeFile = path.join(nameDir, ".active");
  const tempDir = _deps.mkdtempSync(path.join(nameDir, ".active-"));
  const tempFile = path.join(tempDir, "next");
  try {
    _deps.writeFileSync(tempFile, String(version), "utf8");
    _deps.renameSync(tempFile, activeFile);
  } finally {
    _deps.rmSync(tempDir, { recursive: true, force: true });
  }
  return { name, version, scope, active: version };
}

/** Enable or disable one scoped plugin without deleting immutable versions. */
export function setPluginEnabled(name, enabled, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const nameDir = pluginNameDir(scope, name, { cwd });
  if (
    !_deps.existsSync(nameDir) ||
    listInstalledVersions(scope, name, { cwd }).length === 0
  ) {
    throw new Error(`${name} is not installed at ${scope} scope`);
  }
  const marker = path.join(nameDir, DISABLED_FILENAME);
  if (enabled) {
    _deps.rmSync(marker, { force: true });
  } else {
    _deps.writeFileSync(
      marker,
      JSON.stringify(
        {
          disabled: true,
          reason: String(opts.reason || "disabled by user").slice(0, 256),
        },
        null,
        2,
      ),
      "utf8",
    );
  }
  return { name, scope, enabled: Boolean(enabled) };
}

/** Current lifecycle state for one scoped plugin. */
export function isPluginEnabled(name, opts = {}) {
  const scope = opts.scope || "user";
  return !_deps.existsSync(
    path.join(pluginNameDir(scope, name, { cwd: opts.cwd }), DISABLED_FILENAME),
  );
}

/** Which version is active for a plugin at a scope (or null). */
export function getActiveVersion(name, opts = {}) {
  return activeVersion(opts.scope || "user", name, { cwd: opts.cwd });
}

function readSourceMetadata(versionDir) {
  const file = path.join(versionDir, SOURCE_METADATA_FILENAME);
  if (!_deps.existsSync(file)) return null;
  try {
    return normalizeSourceMetadata(
      JSON.parse(_deps.readFileSync(file, "utf8")),
    );
  } catch {
    return null;
  }
}

function normalizeSourceMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const type = ["local", "git", "registry"].includes(value.type)
    ? value.type
    : "git";
  const source = sanitizeSource(value.source, type === "local");
  if (!source) return null;
  const metadata = {
    version: 1,
    type,
    source,
    ref: cleanBounded(value.ref, 256),
  };
  const registry = sanitizeSource(value.registry);
  const resolvedSource = sanitizeSource(value.resolvedSource);
  const packageName = cleanBounded(value.package, 256);
  if (registry) metadata.registry = registry;
  if (resolvedSource) metadata.resolvedSource = resolvedSource;
  if (packageName) metadata.package = packageName;
  if (value.offline === true) metadata.offline = true;
  if (value.catalogAuthority != null) {
    metadata.catalogAuthority = normalizeCatalogAuthority(
      value.catalogAuthority,
    );
  }
  return metadata;
}

function normalizeCatalogAuthority(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("catalogAuthority must be an object");
  }
  const catalogDigest = cleanBounded(value.catalogDigest, 64);
  const candidateId = cleanBounded(value.candidateId, 64);
  const candidateDigest = cleanBounded(value.candidateDigest, 64);
  const selectionDigest = cleanBounded(value.selectionDigest, 64);
  const updateImpactDigest = cleanBounded(value.updateImpactDigest, 64);
  if (!/^[a-f0-9]{64}$/.test(catalogDigest || "")) {
    throw new Error(
      "catalogAuthority.catalogDigest must be a SHA-256 hex digest",
    );
  }
  if (!/^candidate-[a-f0-9]{20}$/.test(candidateId || "")) {
    throw new Error("catalogAuthority.candidateId is invalid");
  }
  if (candidateDigest && !/^[a-f0-9]{64}$/.test(candidateDigest)) {
    throw new Error(
      "catalogAuthority.candidateDigest must be a SHA-256 hex digest",
    );
  }
  if (selectionDigest && !/^[a-f0-9]{64}$/.test(selectionDigest)) {
    throw new Error(
      "catalogAuthority.selectionDigest must be a SHA-256 hex digest",
    );
  }
  if (updateImpactDigest && !/^[a-f0-9]{64}$/.test(updateImpactDigest)) {
    throw new Error(
      "catalogAuthority.updateImpactDigest must be a SHA-256 hex digest",
    );
  }
  const governanceStatus = ["complete", "incomplete"].includes(
    value.governanceStatus,
  )
    ? value.governanceStatus
    : "incomplete";
  const registryStatus = ["online", "cached"].includes(value.registryStatus)
    ? value.registryStatus
    : "online";
  const versionAuthority = [
    "registry-declared-unverified",
    "deferred-to-plugin-manifest",
  ].includes(value.versionAuthority)
    ? value.versionAuthority
    : "deferred-to-plugin-manifest";
  const selectionSourceCount = Number.isInteger(value.selectionSourceCount)
    ? value.selectionSourceCount
    : null;
  if (
    selectionDigest &&
    (!selectionSourceCount ||
      selectionSourceCount < 1 ||
      selectionSourceCount > 16)
  ) {
    throw new Error(
      "catalogAuthority.selectionSourceCount must be between 1 and 16",
    );
  }
  return {
    schemaVersion: "cc-plugin-marketplace-catalog/v1",
    installPreflightSchemaVersion: "cc-plugin-marketplace-install-preflight/v1",
    catalogDigest,
    candidateId,
    ...(candidateDigest ? { candidateDigest } : {}),
    ...(selectionDigest
      ? {
          selectionSchemaVersion:
            "cc-plugin-marketplace-candidate-selection/v1",
          selectionDigest,
          selectionSourceCount,
        }
      : {}),
    ...(updateImpactDigest ? { updateImpactDigest } : {}),
    preflightStatus: "allowed",
    governanceStatus,
    registryStatus,
    versionAuthority,
  };
}

function sanitizeSource(value, preservePath = false) {
  const raw = cleanBounded(value, 4096);
  if (!raw) return null;
  if (preservePath) return raw;
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw;
  }
}

function cleanBounded(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\p{Cc}/gu, "").trim();
  return clean ? clean.slice(0, max) : null;
}

function assertExpectedPluginIdentity(name, version, expectedIdentity) {
  const expectedName = cleanBounded(expectedIdentity?.name, 256);
  const expectedVersion = cleanBounded(expectedIdentity?.version, 128);
  if (expectedName && name !== expectedName) {
    throw new Error(
      `plugin identity mismatch: registry selected ${expectedName}, fetched manifest declares ${name}`,
    );
  }
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(
      `plugin version mismatch: registry selected ${expectedVersion}, fetched manifest declares ${version}`,
    );
  }
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

function validateStagedInstall(root, { name, version, verification }) {
  const parsed = parsePluginManifest(root);
  if (
    !parsed.ok ||
    parsed.metadata.name !== name ||
    parsed.metadata.version !== version
  ) {
    const details = parsed.errors?.length
      ? `: ${parsed.errors.join("; ")}`
      : "";
    throw new Error(`staged plugin failed load validation${details}`);
  }
  if (verification?.signatureVerified === true) {
    const signature = verifyInstalledSignature({ root });
    if (!signature.signed) {
      throw new Error(
        `staged plugin failed signature/SBOM validation: ${signature.reason || "unknown error"}`,
      );
    }
  } else if (verification?.sha256) {
    try {
      verifyPluginManifest({
        manifestFile: parsed.manifestPath,
        expectedSha256: verification.sha256,
      });
    } catch (error) {
      throw new Error(
        `staged plugin failed manifest digest validation: ${error.message}`,
      );
    }
  }
}

function transferPendingTransaction(from, to) {
  const transaction = pendingPluginTransactions.get(from);
  if (!transaction) return;
  pendingPluginTransactions.delete(from);
  pendingPluginTransactions.set(to, transaction);
}

function restoreActivePointer(name, version, opts = {}) {
  if (version) {
    setActiveVersion(name, version, opts);
    return;
  }
  _deps.rmSync(
    path.join(
      pluginNameDir(opts.scope || "user", name, { cwd: opts.cwd }),
      ".active",
    ),
    { force: true },
  );
}

function restoreInstalledBytes({ dest, backup, transactionRoot }) {
  if (!backup) {
    _deps.rmSync(dest, { recursive: true, force: true });
    return;
  }
  const rejected = path.join(transactionRoot, "rejected");
  _deps.renameSync(dest, rejected);
  try {
    _deps.renameSync(backup, dest);
  } catch (error) {
    if (_deps.existsSync(rejected) && !_deps.existsSync(dest)) {
      _deps.renameSync(rejected, dest);
    }
    throw error;
  }
}
