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
import crypto from "node:crypto";
import semver from "semver";
import { parsePluginManifest, isWithin } from "./manifest.js";
import {
  pluginNameDir,
  pluginVersionDir,
  scopeRoot,
  encodeName,
  listInstalledVersions,
  activeVersion,
  inspectActivePointer,
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
import {
  PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA,
  PLUGIN_MARKETPLACE_STAGED_SOURCE_EXCLUSIONS,
  assertSafeInstalledPluginStructure,
  assertRemoteSbomPayloadComparison,
  buildMarketplacePayloadSbom,
  buildRemoteSbomPayloadComparison,
  isMarketplacePayloadSbomFormat,
  validateRemoteSbomPayloadComparison,
} from "./marketplace-artifact-readback.js";
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
  assertSafePluginNameDirectory(name, { scope, cwd: opts.cwd });
  assertNoRetainedInstallRecovery(name, { scope, cwd: opts.cwd });
  assertInstalledNameDirectoryIdentity(name, { scope, cwd: opts.cwd });
  assertExpectedPluginIdentity(name, version, opts.expectedIdentity);
  let sourceMetadata = normalizeSourceMetadata(
    opts.sourceMetadata ?? { type: "local", source: src },
  );
  if (!sourceMetadata) {
    throw new Error("plugin source metadata has no valid source identity");
  }
  assertSemanticPayloadReplacement({
    name,
    version,
    scope,
    cwd: opts.cwd,
    candidateSourceMetadata: sourceMetadata,
  });
  assertReplacementApprovals({
    name,
    version,
    scope,
    cwd: opts.cwd,
    candidateSourceMetadata: sourceMetadata,
    enforce: opts.enforceUpdateApprovals !== false,
    allowSourceSwitch: opts.allowSourceSwitch === true,
    allowDowngrade: opts.allowDowngrade === true,
  });
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
      expectedSignatureSha256: sig.expectedSignatureSha256 || null,
      expectedPublicKeyDocumentSha256:
        sig.expectedPublicKeyDocumentSha256 || null,
      expectedPublicKeySha256: sig.expectedPublicKeySha256 || null,
      requireSignature: sig.requireSignature === true,
      trustedKeySha256: sig.trustedKeySha256 || null,
      requireTrustedKey: sig.requireTrustedKey === true,
    });
  }
  assertRemoteSignatureInstallBinding(sourceMetadata, verification);

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
  const previousActiveState = captureActivePointerState(name, {
    scope,
    cwd: opts.cwd,
  });
  const previousActive = previousActiveState.version;
  const previousInstalledVersionState = previousActive
    ? captureInstalledVersionState(name, previousActive, {
        scope,
        cwd: opts.cwd,
      })
    : null;
  const previousDestinationState = destExists
    ? captureInstalledVersionState(name, version, {
        scope,
        cwd: opts.cwd,
      })
    : null;
  const transactionRoot = _deps.mkdtempSync(path.join(nameDir, ".install-"));
  const staged = path.join(transactionRoot, "staged");
  const backup = destExists ? path.join(transactionRoot, "previous") : null;
  let installedAtDest = false;
  let transactionRetained = false;
  let preserveTransactionRoot = false;
  let resultForCleanup = null;

  try {
    _deps.mkdirSync(staged, { recursive: true });
    copyDirGuarded(src, staged, staged);

    // A lock may ONLY exist if THIS installer wrote it. The source is untrusted
    // and may ship its own `.plugin-lock.json` or provenance metadata.
    _deps.rmSync(path.join(staged, LOCK_FILENAME), { force: true });
    _deps.rmSync(path.join(staged, SOURCE_METADATA_FILENAME), { force: true });

    const remoteSbomPayloadComparison = buildRemoteSbomPayloadComparison({
      remoteArtifactEvidence:
        sourceMetadata?.catalogAuthority?.remoteArtifactEvidence,
      remoteSbomBytes: opts.remoteSbomBytes,
      installedRoot: staged,
      expectedSbom:
        sourceMetadata?.catalogAuthority?.artifactExpectations?.sbom,
      expectedPayloadSha256:
        sourceMetadata?.catalogAuthority?.artifactExpectations?.sbom
          ?.payloadSha256,
    });
    if (remoteSbomPayloadComparison) {
      sourceMetadata = normalizeSourceMetadata({
        ...sourceMetadata,
        catalogAuthority: {
          ...sourceMetadata.catalogAuthority,
          remoteSbomPayloadComparison,
        },
      });
    }

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
      if (backup && _deps.existsSync(backup)) {
        try {
          if (_deps.existsSync(dest)) {
            restoreInstalledBytes({ dest, backup, transactionRoot });
          } else {
            _deps.renameSync(backup, dest);
          }
        } catch (recoveryError) {
          preserveTransactionRoot = true;
          throw incompleteInstallRecoveryError({
            message: "plugin install failed",
            error,
            recoveryError,
            name,
            version,
            scope,
            cwd: opts.cwd,
            transactionRoot,
            previousActiveState,
          });
        }
      }
      throw error;
    }

    let installedVersionState = null;
    if (opts.transactional === true) {
      try {
        installedVersionState = captureInstalledVersionState(name, version, {
          scope,
          cwd: opts.cwd,
        });
      } catch (error) {
        try {
          restoreInstalledBytes({ dest, backup, transactionRoot });
          installedAtDest = false;
        } catch (recoveryError) {
          preserveTransactionRoot = true;
          throw incompleteInstallRecoveryError({
            message: "plugin transaction preparation failed",
            error,
            recoveryError,
            name,
            version,
            scope,
            cwd: opts.cwd,
            transactionRoot,
            previousActiveState,
          });
        }
        throw error;
      }
    }

    let activation;
    try {
      activation = setActiveVersion(name, version, {
        scope,
        cwd: opts.cwd,
        allowSourceSwitch: opts.allowSourceSwitch === true,
        ownedTransactionRoot: transactionRoot,
      });
    } catch (error) {
      try {
        restoreInstalledBytes({ dest, backup, transactionRoot });
        installedAtDest = false;
      } catch (recoveryError) {
        preserveTransactionRoot = true;
        throw incompleteInstallRecoveryError({
          message: "plugin activation failed",
          error,
          recoveryError,
          name,
          version,
          scope,
          cwd: opts.cwd,
          transactionRoot,
          previousActiveState,
        });
      }
      // setActiveVersion validates before its atomic pointer rename, so a
      // rejected activation has not changed the predecessor pointer. Rewriting
      // it here would mutate corrupt/dangling repair state on a failed install.
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
        previousActiveState,
        previousInstalledVersionState,
        previousDestinationState,
        ownedActivePointerState: activation.activePointerState,
        installedVersionState,
      });
      transactionRetained = true;
    }
    resultForCleanup = result;
    return result;
  } finally {
    if (!transactionRetained && !preserveTransactionRoot) {
      if (resultForCleanup && installedAtDest) {
        Object.assign(
          resultForCleanup,
          retireCommittedTransactionRoot(transactionRoot),
        );
      } else {
        try {
          _deps.rmSync(transactionRoot, { recursive: true, force: true });
        } catch {
          // Failed operations retain their `.install-*` recovery root. The
          // admin inventory/doctor path exposes it and later mutations fail
          // closed until the operator removes the blocked install.
        }
      }
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
    if (!info) return res;
    const result = {
      ...res,
      source: sourceMetadata?.source || null,
      ref: sourceMetadata?.ref || null,
    };
    transferPendingTransaction(res, result);
    return result;
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
    assertSafePluginNameDirectory(name, { scope, cwd: opts.cwd });
    assertNoRetainedInstallRecovery(name, { scope, cwd: opts.cwd });
    assertExpectedPluginIdentity(name, version, opts.expectedIdentity);
    const sourceMetadata =
      normalizeSourceMetadata(opts.sourceMetadata) ||
      normalizeSourceMetadata(
        info
          ? { type: "git", source: info.url, ref: info.ref || null }
          : { type: "local", source: path.resolve(String(source || "")) },
      );
    const previousVersion = getActiveVersion(name, { scope, cwd: opts.cwd });
    assertReplacementApprovals({
      name,
      version,
      scope,
      cwd: opts.cwd,
      candidateSourceMetadata: sourceMetadata,
      enforce: opts.enforceUpdateApprovals !== false,
      allowSourceSwitch: opts.allowSourceSwitch === true,
      allowDowngrade: opts.allowDowngrade === true,
    });
    const dest = pluginVersionDir(scope, name, version, { cwd: opts.cwd });
    const sameVersionExists = _deps.existsSync(dest);

    if (sameVersionExists && !opts.force) {
      const previousActiveState = captureActivePointerState(name, {
        scope,
        cwd: opts.cwd,
      });
      const previousInstalledVersionState = previousVersion
        ? captureInstalledVersionState(name, previousVersion, {
            scope,
            cwd: opts.cwd,
          })
        : null;
      assertExistingTargetMatchesCandidate(dir, dest);
      assertPointerActivationApprovals({
        name,
        version,
        scope,
        cwd: opts.cwd,
        candidateSourceMetadata: sourceMetadata,
        enforce: opts.enforceUpdateApprovals !== false,
        allowSourceSwitch: opts.allowSourceSwitch === true,
        allowDowngrade: opts.allowDowngrade === true,
      });
      assertSemanticPayloadActivation({
        name,
        scope,
        cwd: opts.cwd,
        targetVersion: version,
        allowSourceSwitch: opts.allowSourceSwitch === true,
      });
      const installedVersionState =
        opts.transactional === true && previousVersion !== version
          ? captureInstalledVersionState(name, version, {
              scope,
              cwd: opts.cwd,
            })
          : null;
      // Already at this version — make sure it's the active one, but don't
      // reinstall an immutable dir.
      const pointerTransactionRoot =
        opts.transactional === true && previousVersion !== version
          ? _deps.mkdtempSync(
              path.join(
                pluginNameDir(scope, name, { cwd: opts.cwd }),
                ".install-",
              ),
            )
          : null;
      let activation = null;
      if (previousVersion !== version) {
        try {
          activation = setActiveVersion(name, version, {
            scope,
            cwd: opts.cwd,
            allowSourceSwitch: opts.allowSourceSwitch === true,
            ownedTransactionRoot: pointerTransactionRoot,
          });
        } catch (error) {
          if (pointerTransactionRoot) {
            try {
              _deps.rmSync(pointerTransactionRoot, {
                recursive: true,
                force: true,
              });
            } catch {
              // Empty pointer-transaction cleanup debt is surfaced by the
              // retained recovery guard instead of masking activation failure.
            }
          }
          throw error;
        }
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
          transactionRoot: pointerTransactionRoot,
          previousActive: previousVersion,
          previousActiveState,
          previousInstalledVersionState,
          ownedActivePointerState: activation.activePointerState,
          installedVersionState,
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
  assertSafePluginNameDirectory(transaction.name, transaction);
  assertTransactionOwnsActivePointer(transaction);
  pendingPluginTransactions.delete(result);
  return {
    finalized: true,
    ...retireCommittedTransactionRoot(transaction.transactionRoot),
  };
}

/**
 * Restore the active version and, for a forced same-version reinstall, the
 * exact prior bytes. New rejected versions are removed so `.active` fallback
 * cannot silently select them later.
 */
export function rollbackPluginUpdate(result) {
  const transaction = pendingPluginTransactions.get(result);
  if (!transaction) return { rolledBack: false, version: null };

  assertSafePluginNameDirectory(transaction.name, transaction);
  if (transaction.rollbackPhase !== "bytes-restored") {
    if (transaction.rollbackPhase === "bytes-recovery") {
      assertTransactionOwnsRecoveryState(transaction);
    } else {
      assertTransactionOwnsActivePointer(transaction);
    }
    if (!transaction.pointerOnly) {
      try {
        restoreInstalledBytes(transaction);
      } catch (error) {
        // A same-volume rename can fail after candidate quarantine but before
        // predecessor publication. Preserve both roots and allow an exact,
        // ownership-checked retry instead of reactivating rejected bytes.
        transaction.rollbackPhase = "bytes-recovery";
        try {
          quarantineTransactionActivePointer(transaction);
        } catch (pointerError) {
          throw new Error(
            `${error.message}; active pointer fail-close also failed: ${pointerError.message}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
    transaction.rollbackPhase = "bytes-restored";
  } else {
    // A prior attempt restored/quarantined bytes but failed before the atomic
    // pointer replace. Retrying is safe only while the transaction still owns
    // the unchanged candidate pointer.
    assertTransactionOwnsRollbackPointer(transaction);
  }

  restoreActivePointerSnapshot(
    transaction.name,
    transaction.previousActiveState,
    transaction,
  );
  pendingPluginTransactions.delete(result);
  return {
    rolledBack: true,
    version: transaction.previousActive || null,
    ...retireCommittedTransactionRoot(transaction.transactionRoot),
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

  // Reduce host-specific checkout differences before the v2 inventory hashes
  // the materialized staged bytes. Repository .gitattributes may still define
  // transformations; an SBOM produced from different bytes then fails the
  // exact pre-activation comparison instead of being treated as equivalent.
  // Symlink blobs are materialized as inert regular files so installed plugins
  // never gain link traversal semantics from a Git source.
  const canonicalCheckoutArgs = [
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.eol=lf",
    "-c",
    "core.symlinks=false",
  ];
  const cloneArgs = [...canonicalCheckoutArgs, "clone", "--depth", "1"];
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
      const full = run([...canonicalCheckoutArgs, "clone", url, dir]);
      if (!full.error && full.status === 0) {
        const co = run([...canonicalCheckoutArgs, "-C", dir, "checkout", ref]);
        if (co.status === 0) return dir;
      }
    }
    const reason = (res.stderr || "").trim() || `git exited ${res.status}`;
    throw new Error(`git clone failed for ${url}: ${reason}`);
  }
  return dir;
}

/**
 * List effective installed plugins (active or blocked inspection row per
 * resolved name). `skipPolicy` keeps org-policy and active-pointer failures
 * visible to the ADMIN view instead of silently presenting them as absent.
 * This remains a precedence-resolved view, not a physical all-scope inventory.
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
    includeBlocked: true,
    allowRetainedInstall: opts.allowRetainedInstall === true,
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
      runtimeBlocked: p.runtimeBlocked === true,
      activePointer: {
        status: p.pointerStatus || "valid",
        activeVersion: p.version || null,
        inspectionVersion: p.inspectionVersion || p.version || null,
        ...(p.recoveryRoot ? { recoveryPath: p.recoveryRoot } : {}),
      },
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
  let cleanup = { cleanupPending: false };
  assertSafePluginNameDirectory(name, { scope, cwd });

  if (opts.version != null) {
    // A retained install transaction owns both the active pointer and any
    // predecessor bytes needed for rollback. Version-scoped removal must not
    // invalidate that recovery state; whole-name removal remains the explicit
    // remediation path for an abandoned transaction.
    assertNoRetainedInstallRecovery(name, { scope, cwd });
    const requestedVersion = String(opts.version);
    const installedVersions = listInstalledVersions(scope, name, { cwd });
    if (!installedVersions.includes(requestedVersion)) {
      throw new Error(
        `${name}@${requestedVersion} is not installed at ${scope} scope`,
      );
    }
    const dir = pluginVersionDir(scope, name, requestedVersion, { cwd });
    assertInstalledNameDirectoryIdentity(name, {
      scope,
      cwd,
      versions: [requestedVersion],
      allowBlockedIdentity: opts.allowBlockedIdentity === true,
    });
    // Capture the active version BEFORE removing, so we only repoint `.active`
    // when the version we removed WAS the active one. Removing a NON-active
    // version (e.g. cleaning up a newer version after rolling back to an older
    // pinned one) must not silently change which version is active — the old
    // code always rewrote `.active` to the newest remaining, so uninstalling an
    // unrelated version could bump the user's pinned choice.
    const pointer = inspectActivePointer(scope, name, { cwd });
    if (pointer.status !== "valid") {
      throw new Error(
        `ACTIVE_POINTER_${pointer.status.toUpperCase()}; repair it with plugin use before removing one version`,
      );
    }
    const active = pointer.version;
    const removedWasActive = active === requestedVersion;
    const remaining = installedVersions.filter(
      (candidate) => candidate !== requestedVersion,
    );
    // Validate the automatic fallback while the current active bytes and
    // provenance still exist. Deleting first would make a semantic downgrade
    // impossible to distinguish from an ordinary cleanup failure.
    if (removedWasActive && remaining.length > 0) {
      assertSemanticPayloadActivation({
        name,
        scope,
        cwd,
        targetVersion: remaining[0],
        allowSourceSwitch: opts.allowSourceSwitch === true,
      });
    }
    // Repoint .active before retiring an active version. Quarantining the old
    // directory makes a pointer-write failure recoverable without losing the
    // active bytes or leaving a dangling pointer.
    if (remaining.length === 0) {
      _deps.rmSync(pluginNameDir(scope, name, { cwd }), {
        recursive: true,
        force: true,
      });
    } else if (removedWasActive) {
      const nameDir = pluginNameDir(scope, name, { cwd });
      const transactionRoot = _deps.mkdtempSync(
        path.join(nameDir, ".uninstall-"),
      );
      const quarantined = path.join(transactionRoot, requestedVersion);
      _deps.renameSync(dir, quarantined);
      try {
        writeActiveVersionPointer(name, remaining[0], { scope, cwd });
      } catch (error) {
        try {
          _deps.renameSync(quarantined, dir);
        } catch (recoveryError) {
          throw new Error(
            `plugin uninstall failed and recovery is incomplete; retained recovery state at ${transactionRoot}: ${recoveryError.message}`,
            { cause: error },
          );
        }
        retireCommittedTransactionRoot(transactionRoot);
        throw error;
      }
      cleanup = retireCommittedTransactionRoot(transactionRoot);
    } else {
      _deps.rmSync(dir, { recursive: true, force: true });
    }
    removed.push(requestedVersion);
    return {
      removed,
      ...(cleanup.cleanupPending === true
        ? {
            cleanupPending: true,
            cleanupPath: cleanup.cleanupPath,
          }
        : {}),
    };
  }

  const nameDir = pluginNameDir(scope, name, { cwd });
  if (!_deps.existsSync(nameDir)) {
    throw new Error(`${name} is not installed at ${scope} scope`);
  }
  assertInstalledNameDirectoryIdentity(name, {
    scope,
    cwd,
    allowBlockedIdentity: opts.allowBlockedIdentity === true,
  });
  removed.push(...listInstalledVersions(scope, name, { cwd }));
  _deps.rmSync(nameDir, { recursive: true, force: true });
  return { removed };
}

/** Pin a plugin's active version (rollback / switch). */
export function setActiveVersion(name, version, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  assertSafePluginNameDirectory(name, { scope, cwd });
  assertNoRetainedInstallRecovery(name, {
    scope,
    cwd,
    ownedTransactionRoot: opts.ownedTransactionRoot,
  });
  const requestedVersion = String(version || "");
  if (!listInstalledVersions(scope, name, { cwd }).includes(requestedVersion)) {
    throw new Error(
      `${name}@${requestedVersion} is not installed at ${scope} scope`,
    );
  }
  assertSemanticPayloadActivation({
    name,
    scope,
    cwd,
    targetVersion: requestedVersion,
    allowSourceSwitch: opts.allowSourceSwitch === true,
  });
  return writeActiveVersionPointer(name, requestedVersion, { scope, cwd });
}

/** Commit a preflighted active pointer or restore transaction-owned state. */
function writeActiveVersionPointer(name, version, opts = {}) {
  return writeActivePointerBytes(name, Buffer.from(String(version), "utf8"), {
    ...opts,
    version,
  });
}

function writeActivePointerBytes(name, bytes, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const nameDir = pluginNameDir(scope, name, { cwd });
  const activeFile = path.join(nameDir, ".active");
  const tempDir = _deps.mkdtempSync(path.join(nameDir, ".active-"));
  const tempFile = path.join(tempDir, "next");
  let generation = null;
  try {
    _deps.writeFileSync(tempFile, bytes);
    generation = fileGeneration(_deps.lstatSync(tempFile));
    _deps.renameSync(tempFile, activeFile);
  } finally {
    try {
      _deps.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // A committed atomic pointer write remains successful even if antivirus
      // or another reader briefly holds the now-empty temp directory open.
    }
  }
  return {
    name,
    version: opts.version || null,
    scope,
    active: opts.version || null,
    activePointerState: {
      present: true,
      bytes: Buffer.from(bytes),
      version: opts.version || null,
      generation,
    },
  };
}

/** Enable or disable one scoped plugin without deleting immutable versions. */
export function setPluginEnabled(name, enabled, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  assertSafePluginNameDirectory(name, { scope, cwd });
  assertNoRetainedInstallRecovery(name, { scope, cwd });
  const nameDir = pluginNameDir(scope, name, { cwd });
  if (
    !_deps.existsSync(nameDir) ||
    listInstalledVersions(scope, name, { cwd }).length === 0
  ) {
    throw new Error(`${name} is not installed at ${scope} scope`);
  }
  assertInstalledNameDirectoryIdentity(name, { scope, cwd });
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
  try {
    return readSourceMetadataStrict(versionDir);
  } catch {
    return null;
  }
}

export function readSourceMetadataStrict(
  versionDir,
  { required = false, requireRegistryAuthority = false } = {},
) {
  const file = path.join(versionDir, SOURCE_METADATA_FILENAME);
  if (!_deps.existsSync(file)) {
    if (required) {
      throw new Error(
        "plugin source metadata is missing; remove and reinstall the plugin to restore provenance",
      );
    }
    return null;
  }
  try {
    const raw = JSON.parse(_deps.readFileSync(file, "utf8"));
    if (!raw || !["local", "git", "registry"].includes(raw.type)) {
      throw new Error("source metadata type is invalid");
    }
    if (
      requireRegistryAuthority &&
      raw.type !== "registry" &&
      (raw.registry != null ||
        raw.package != null ||
        raw.catalogAuthority != null)
    ) {
      throw new Error("registry-shaped source metadata has an invalid type");
    }
    const normalized = normalizeSourceMetadata(raw);
    if (!normalized) {
      throw new Error("source metadata has no valid source identity");
    }
    if (requireRegistryAuthority && normalized.type === "registry") {
      if (!normalized.registry) {
        throw new Error("registry source metadata is missing registry URL");
      }
      if (
        !normalized.catalogAuthority ||
        !normalized.catalogAuthority.artifactExpectations
      ) {
        throw new Error(
          "registry source metadata is missing catalog artifact authority",
        );
      }
    }
    return normalized;
  } catch (error) {
    throw new Error(`plugin source metadata is invalid: ${error.message}`, {
      cause: error,
    });
  }
}

function semanticPayloadStrength(format) {
  if (format === PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA) return 2;
  if (format === PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA) return 1;
  return 0;
}

function installedSemanticPayloadFormat(sourceMetadata, root) {
  const authority = sourceMetadata?.catalogAuthority;
  const expected = authority?.artifactExpectations?.sbom;
  const expectedFormat = expected?.format;
  if (!isMarketplacePayloadSbomFormat(expectedFormat)) return null;
  if (
    expectedFormat === PLUGIN_MARKETPLACE_PAYLOAD_SBOM_SCHEMA &&
    (!expected.url || !expected.documentSha256)
  ) {
    return null;
  }
  assertSafeInstalledPluginStructure(root);
  const comparison = authority?.remoteSbomPayloadComparison;
  const validation = validateRemoteSbomPayloadComparison(comparison, {
    remoteArtifactEvidence: authority?.remoteArtifactEvidence,
    expectedPayloadSha256: authority?.artifactExpectations?.sbom?.payloadSha256,
    currentPayloadSbom: buildMarketplacePayloadSbom(root, {
      schemaVersion: expectedFormat,
    }),
  });
  if (!validation.valid || !validation.currentPayloadMatches) {
    throw new Error("INSTALLED_SEMANTIC_SBOM_EVIDENCE_INVALID");
  }
  return expectedFormat;
}

function candidateSemanticPayloadFormat(sourceMetadata) {
  const authority = sourceMetadata?.catalogAuthority;
  const expected = authority?.artifactExpectations?.sbom;
  const evidence = authority?.remoteArtifactEvidence?.sbom;
  if (
    !isMarketplacePayloadSbomFormat(expected?.format) ||
    expected.status !== "declared" ||
    !expected.url ||
    !expected.documentSha256 ||
    evidence?.format !== expected.format ||
    evidence.url !== expected.url ||
    evidence.expectedDocumentSha256 !== expected.documentSha256 ||
    evidence.documentSha256 !== expected.documentSha256
  ) {
    return null;
  }
  return expected.format;
}

function strictInstalledSourceMetadata(name, version, { scope, cwd }) {
  return readSourceMetadataStrict(
    pluginVersionDir(scope, name, version, { cwd }),
    { required: true, requireRegistryAuthority: true },
  );
}

/**
 * Payload-bound bytes may only be replaced by an equally strong (or stronger)
 * payload binding. Keeping this below the command layer prevents add/upgrade
 * aliases and direct library callers from silently erasing that authority.
 */
function assertSemanticPayloadReplacement({
  name,
  version,
  scope,
  cwd,
  candidateSourceMetadata,
}) {
  const active = getActiveVersion(name, { scope, cwd });
  const to = candidateSemanticPayloadFormat(candidateSourceMetadata);
  const protectedVersions = new Set();
  if (active) protectedVersions.add(active);
  const targetDir = pluginVersionDir(scope, name, version, { cwd });
  if (_deps.existsSync(targetDir)) protectedVersions.add(version);
  for (const installedVersion of protectedVersions) {
    const installedSource = strictInstalledSourceMetadata(
      name,
      installedVersion,
      { scope, cwd },
    );
    const installedRoot = pluginVersionDir(scope, name, installedVersion, {
      cwd,
    });
    const from = installedSemanticPayloadFormat(installedSource, installedRoot);
    if (semanticPayloadStrength(from) > semanticPayloadStrength(to)) {
      throw new Error(
        `SEMANTIC_SBOM_BINDING_DOWNGRADE (${from} -> ${to || "unbound"})`,
      );
    }
  }
}

function requiredInstalledSourceMetadata(name, version, { scope, cwd }) {
  return readSourceMetadataStrict(
    pluginVersionDir(scope, name, version, { cwd }),
    { required: true },
  );
}

/**
 * Guard every active-pointer transition against activating weaker or stale
 * saved bytes. The strongest semantic binding already retained at this scope
 * is the baseline, even when `.active` is missing or invalid; otherwise an
 * operator could erase the pointer and use a dormant unbound version as a
 * downgrade trampoline.
 */
function assertSemanticPayloadActivation({
  name,
  scope,
  cwd,
  targetVersion,
  allowSourceSwitch = false,
}) {
  const active = getActiveVersion(name, { scope, cwd });
  const targetRoot = assertActivatableInstalledTarget(name, targetVersion, {
    scope,
    cwd,
  });
  // A public activation is an authority transition, even when the target was
  // installed by an older CLI. Require provenance for the selected bytes;
  // legacy installs must be removed/reinstalled instead of becoming an
  // unreviewed rollback escape hatch.
  const targetSource = requiredInstalledSourceMetadata(name, targetVersion, {
    scope,
    cwd,
  });
  const to = installedSemanticPayloadFormat(targetSource, targetRoot);
  let strongestFormat = null;
  let savedSourceSwitch = false;
  for (const installedVersion of listInstalledVersions(scope, name, { cwd })) {
    // Dormant provenance is still authority: skipping a missing record would
    // let deleting `.active` plus one metadata file erase a stronger binding.
    const installedSource =
      installedVersion === targetVersion
        ? targetSource
        : strictInstalledSourceMetadata(name, installedVersion, { scope, cwd });
    if (!sameSourceAuthority(installedSource, targetSource)) {
      savedSourceSwitch = true;
    }
    const installedRoot = pluginVersionDir(scope, name, installedVersion, {
      cwd,
    });
    const format = installedSemanticPayloadFormat(
      installedSource,
      installedRoot,
    );
    if (
      semanticPayloadStrength(format) > semanticPayloadStrength(strongestFormat)
    ) {
      strongestFormat = format;
    }
  }
  if (semanticPayloadStrength(strongestFormat) > semanticPayloadStrength(to)) {
    throw new Error(
      `SEMANTIC_SBOM_BINDING_DOWNGRADE (${strongestFormat} -> ${to || "unbound"})`,
    );
  }
  if (active && active !== targetVersion) {
    const activeSource = strictInstalledSourceMetadata(name, active, {
      scope,
      cwd,
    });
    if (
      !sameSourceAuthority(activeSource, targetSource) &&
      !allowSourceSwitch
    ) {
      throw new Error(
        "SOURCE_SWITCH_APPROVAL_REQUIRED; pass --allow-source-switch to approve this activation",
      );
    }
  } else if (!active && savedSourceSwitch && !allowSourceSwitch) {
    throw new Error(
      "SOURCE_SWITCH_APPROVAL_REQUIRED; use plugin use --allow-source-switch to repair the active pointer",
    );
  }
}

function assertSafePluginNameDirectory(name, { scope, cwd }) {
  const root = scopeRoot(scope, { cwd });
  const target = pluginNameDir(scope, name, { cwd });
  const trustedBase =
    scope === "user" ? path.dirname(root) : path.resolve(cwd || process.cwd());
  const relative = path.relative(trustedBase, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("PLUGIN_NAME_DIRECTORY_OUTSIDE_SCOPE");
  }

  let current = trustedBase;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = _deps.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw new Error(`PLUGIN_NAME_DIRECTORY_UNREADABLE: ${error.message}`, {
        cause: error,
      });
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `PLUGIN_NAME_DIRECTORY_UNSAFE: ${path.relative(trustedBase, current)}`,
      );
    }
  }
  return target;
}

function assertNoRetainedInstallRecovery(
  name,
  { scope, cwd, ownedTransactionRoot = null },
) {
  const nameDir = pluginNameDir(scope, name, { cwd });
  let entries;
  try {
    entries = _deps.readdirSync(nameDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(".cleanup-")) {
      try {
        _deps.rmSync(path.join(nameDir, entry.name), {
          recursive: true,
          force: true,
        });
      } catch {
        // A committed cleanup root is inert and does not own activation
        // authority. Later mutations retry collection without being blocked.
      }
      continue;
    }
    if (
      !entry.isDirectory() ||
      (!entry.name.startsWith(".install-") &&
        !entry.name.startsWith(".uninstall-"))
    ) {
      continue;
    }
    const recoveryRoot = path.join(nameDir, entry.name);
    let stat;
    try {
      stat = _deps.lstatSync(recoveryRoot);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    if (
      ownedTransactionRoot &&
      path.resolve(recoveryRoot) === path.resolve(ownedTransactionRoot)
    ) {
      continue;
    }
    throw new Error(
      `PLUGIN_INSTALL_RECOVERY_REQUIRED: retained recovery state for the plugin lifecycle at ${recoveryRoot}; inspect it or remove the blocked install before another mutation`,
    );
  }
}

function retireCommittedTransactionRoot(transactionRoot) {
  if (!transactionRoot || !_deps.existsSync(transactionRoot)) {
    return { cleanupPending: false };
  }
  const basename = path.basename(transactionRoot);
  const cleanupPrefix = basename.startsWith(".install-")
    ? ".install-"
    : basename.startsWith(".uninstall-")
      ? ".uninstall-"
      : null;
  const cleanupRoot = cleanupPrefix
    ? path.join(
        path.dirname(transactionRoot),
        `.cleanup-${basename.slice(cleanupPrefix.length)}`,
      )
    : transactionRoot;

  if (cleanupRoot !== transactionRoot) {
    try {
      _deps.renameSync(transactionRoot, cleanupRoot);
    } catch {
      try {
        _deps.rmSync(transactionRoot, { recursive: true, force: true });
        return { cleanupPending: false };
      } catch {
        // The operation is already committed, but the still-authoritative
        // `.install-*` namespace could not be retired. Surface the exact path;
        // inventory/doctor will keep it visible and mutations remain blocked.
        return { cleanupPending: true, cleanupPath: transactionRoot };
      }
    }
  }

  try {
    _deps.rmSync(cleanupRoot, { recursive: true, force: true });
    return { cleanupPending: false };
  } catch {
    // `.cleanup-*` is deliberately outside the activation/recovery namespace.
    // It can be retried on the next mutation without changing plugin state.
    return { cleanupPending: true, cleanupPath: cleanupRoot };
  }
}

function assertInstalledNameDirectoryIdentity(
  name,
  { scope, cwd, versions = null, allowBlockedIdentity = false },
) {
  const installedVersions =
    versions || listInstalledVersions(scope, name, { cwd });
  for (const version of installedVersions) {
    const parsed = parsePluginManifest(
      pluginVersionDir(scope, name, version, { cwd }),
    );
    if (
      !parsed.ok ||
      parsed.metadata.name !== name ||
      parsed.metadata.version !== version
    ) {
      if (allowBlockedIdentity && name === encodeName(name)) continue;
      throw new Error(
        `PLUGIN_NAME_DIRECTORY_IDENTITY_MISMATCH (${name}@${version})`,
      );
    }
  }
}

function assertActivatableInstalledTarget(name, version, { scope, cwd }) {
  const root = pluginVersionDir(scope, name, version, { cwd });
  assertSafeInstalledPluginStructure(root);
  const parsed = parsePluginManifest(root);
  if (
    !parsed.ok ||
    parsed.metadata.name !== name ||
    parsed.metadata.version !== version
  ) {
    const details = parsed.errors?.length
      ? `: ${parsed.errors.join("; ")}`
      : "";
    throw new Error(`ACTIVATION_TARGET_INVALID${details}`);
  }
  return root;
}

function sameSourceAuthority(current, candidate) {
  if (current?.type !== candidate?.type) return false;
  if (current.type === "registry") {
    return Boolean(
      current.registry &&
      candidate.registry &&
      current.registry === candidate.registry,
    );
  }
  if (current.type === "git") return current.source === candidate.source;
  return current.type === "local" && current.source === candidate.source;
}

function assertReplacementApprovals({
  name,
  version,
  scope,
  cwd,
  candidateSourceMetadata,
  enforce,
  allowSourceSwitch,
  allowDowngrade,
}) {
  if (!enforce) return;
  const active = getActiveVersion(name, { scope, cwd });
  const installedVersions = listInstalledVersions(scope, name, { cwd });
  const baseline = active || installedVersions[0] || null;
  if (!baseline) return;
  const sourceBaselines = active ? [active] : installedVersions;
  if (
    sourceBaselines.some((installedVersion) => {
      const installedSource = strictInstalledSourceMetadata(
        name,
        installedVersion,
        { scope, cwd },
      );
      return !sameSourceAuthority(installedSource, candidateSourceMetadata);
    }) &&
    !allowSourceSwitch
  ) {
    throw new Error(
      "SOURCE_SWITCH_APPROVAL_REQUIRED; use plugin upgrade --allow-source-switch",
    );
  }
  const from = semver.valid(baseline);
  const to = semver.valid(version);
  if (from && to && semver.gt(from, to) && !allowDowngrade) {
    throw new Error(
      "VERSION_DOWNGRADE_APPROVAL_REQUIRED; use plugin upgrade --allow-downgrade",
    );
  }
}

function assertPointerActivationApprovals({
  name,
  version,
  scope,
  cwd,
  candidateSourceMetadata,
  enforce,
  allowSourceSwitch,
  allowDowngrade,
}) {
  if (!enforce) return;
  const targetSource = strictInstalledSourceMetadata(name, version, {
    scope,
    cwd,
  });
  if (!sameSourceAuthority(targetSource, candidateSourceMetadata)) {
    throw new Error(
      "EXISTING_VERSION_SOURCE_MISMATCH; use --force to reinstall the provided source",
    );
  }
  assertReplacementApprovals({
    name,
    version,
    scope,
    cwd,
    candidateSourceMetadata: targetSource,
    enforce,
    allowSourceSwitch,
    allowDowngrade,
  });
}

function assertExistingTargetMatchesCandidate(candidateRoot, targetRoot) {
  const schemaVersion = PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA;
  assertSafeInstalledPluginStructure(targetRoot);
  const candidate = buildSanitizedCandidatePayloadSbom(candidateRoot);
  const target = buildMarketplacePayloadSbom(targetRoot, { schemaVersion });
  if (
    candidate.digest !== target.digest ||
    candidate.fileCount !== target.fileCount ||
    candidate.totalBytes !== target.totalBytes
  ) {
    throw new Error(
      "EXISTING_VERSION_PAYLOAD_MISMATCH; use --force to reinstall the reviewed candidate bytes",
    );
  }
}

function buildSanitizedCandidatePayloadSbom(candidateRoot) {
  const temporaryRoot = _deps.mkdtempSync(
    path.join(os.tmpdir(), "cc-plugin-pointer-"),
  );
  const staged = path.join(temporaryRoot, "staged");
  try {
    _deps.mkdirSync(staged, { recursive: true });
    copyDirGuarded(candidateRoot, staged, staged);
    return buildMarketplacePayloadSbom(staged, {
      schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
    });
  } finally {
    _deps.rmSync(temporaryRoot, { recursive: true, force: true });
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
  assertCatalogRemoteArtifactBindings(metadata);
  return metadata;
}

function assertCatalogRemoteArtifactBindings(metadata) {
  const authority = metadata.catalogAuthority;
  const evidence = authority?.remoteArtifactEvidence;
  if (!evidence) return;
  if (metadata.type !== "registry" || !metadata.registry) {
    throw new Error(
      "remote marketplace artifact evidence requires registry source metadata",
    );
  }
  let registryOrigin;
  try {
    registryOrigin = new URL(metadata.registry).origin;
  } catch {
    throw new Error("remote marketplace artifact registry URL is invalid");
  }
  if (registryOrigin !== evidence.registryOrigin) {
    throw new Error(
      "remote marketplace artifact evidence registry origin does not match the selected registry",
    );
  }

  const expectations = authority.artifactExpectations || {};
  const expectedSignature = expectations.signature || {};
  const expectsRemoteSignature = Boolean(
    expectedSignature.url &&
    expectedSignature.publicKeyUrl &&
    expectedSignature.publicKeySha256,
  );
  if (expectsRemoteSignature !== Boolean(evidence.signature)) {
    throw new Error(
      "remote signature evidence does not match the catalog artifact declaration",
    );
  }
  if (evidence.signature) {
    const actual = evidence.signature;
    if (
      actual.url !== expectedSignature.url ||
      actual.publicKey.url !== expectedSignature.publicKeyUrl ||
      actual.publicKey.spkiSha256 !== expectedSignature.publicKeySha256 ||
      (expectedSignature.documentSha256 &&
        actual.signatureSha256 !== expectedSignature.documentSha256) ||
      (expectedSignature.publicKeyDocumentSha256 &&
        actual.publicKey.documentSha256 !==
          expectedSignature.publicKeyDocumentSha256)
    ) {
      throw new Error(
        "remote signature evidence does not match catalog URL or digest expectations",
      );
    }
  }

  const expectedSbom = expectations.sbom || {};
  const expectsRemoteSbom = Boolean(
    expectedSbom.url && expectedSbom.documentSha256,
  );
  if (expectsRemoteSbom !== Boolean(evidence.sbom)) {
    throw new Error(
      "remote SBOM evidence does not match the catalog artifact declaration",
    );
  }
  if (evidence.sbom) {
    const actual = evidence.sbom;
    if (
      actual.url !== expectedSbom.url ||
      actual.expectedDocumentSha256 !== expectedSbom.documentSha256 ||
      actual.documentSha256 !== expectedSbom.documentSha256 ||
      actual.format !== expectedSbom.format
    ) {
      throw new Error(
        "remote SBOM evidence does not match catalog URL, format, or digest expectations",
      );
    }
  }
}

function assertRemoteSignatureInstallBinding(sourceMetadata, verification) {
  const signature =
    sourceMetadata?.catalogAuthority?.remoteArtifactEvidence?.signature;
  if (!signature) return;
  if (verification?.signatureVerified !== true) {
    throw new Error(
      "remote marketplace signature was not verified against the fetched plugin manifest",
    );
  }
  if (
    verification.signatureSha256 !== signature.signatureSha256 ||
    verification.publicKeyDocumentSha256 !==
      signature.publicKey.documentSha256 ||
    verification.publicKeySha256 !== signature.publicKey.spkiSha256
  ) {
    throw new Error(
      "remote marketplace signature bytes changed before installer verification",
    );
  }
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
  const artifactExpectations = normalizeArtifactExpectations(
    value.artifactExpectations,
  );
  const remoteArtifactEvidence = normalizeRemoteArtifactEvidence(
    value.remoteArtifactEvidence,
  );
  const remoteSbomPayloadComparison = assertRemoteSbomPayloadComparison(
    value.remoteSbomPayloadComparison,
    {
      remoteArtifactEvidence,
      expectedPayloadSha256: artifactExpectations?.sbom?.payloadSha256,
    },
  );
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
    ...(artifactExpectations ? { artifactExpectations } : {}),
    ...(remoteArtifactEvidence ? { remoteArtifactEvidence } : {}),
    ...(remoteSbomPayloadComparison ? { remoteSbomPayloadComparison } : {}),
    preflightStatus: "allowed",
    governanceStatus,
    registryStatus,
    versionAuthority,
  };
}

function normalizeArtifactExpectations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const digest = (candidate, label) => {
    const normalized = cleanBounded(candidate, 64);
    if (normalized && !/^[a-f0-9]{64}$/i.test(normalized)) {
      throw new Error(`${label} must be a SHA-256 hex digest`);
    }
    return normalized?.toLowerCase() || null;
  };
  const status = (candidate) =>
    ["declared", "missing"].includes(candidate) ? candidate : "missing";
  const manifestSha256 = digest(
    value.manifest?.sha256,
    "catalogAuthority.artifactExpectations.manifest.sha256",
  );
  const signatureKeySha256 = digest(
    value.signature?.publicKeySha256,
    "catalogAuthority.artifactExpectations.signature.publicKeySha256",
  );
  const sbomSha256 = digest(
    value.sbom?.payloadSha256 ?? value.sbom?.sha256,
    "catalogAuthority.artifactExpectations.sbom.sha256",
  );
  const signatureDocumentSha256 = digest(
    value.signature?.documentSha256,
    "catalogAuthority.artifactExpectations.signature.documentSha256",
  );
  const signaturePublicKeyDocumentSha256 = digest(
    value.signature?.publicKeyDocumentSha256,
    "catalogAuthority.artifactExpectations.signature.publicKeyDocumentSha256",
  );
  const sbomDocumentSha256 = digest(
    value.sbom?.documentSha256,
    "catalogAuthority.artifactExpectations.sbom.documentSha256",
  );
  return {
    manifest: {
      status: status(value.manifest?.status),
      sha256: manifestSha256,
    },
    signature: {
      status: status(value.signature?.status),
      algorithm: cleanBounded(value.signature?.algorithm, 64),
      publicKeySha256: signatureKeySha256,
      documentSha256: signatureDocumentSha256,
      publicKeyDocumentSha256: signaturePublicKeyDocumentSha256,
      url: sanitizeSource(value.signature?.url),
      publicKeyUrl: sanitizeSource(value.signature?.publicKeyUrl),
    },
    sbom: {
      status: status(value.sbom?.status),
      format: cleanBounded(value.sbom?.format, 128),
      sha256: sbomSha256,
      payloadSha256: sbomSha256,
      documentSha256: sbomDocumentSha256,
      url: sanitizeSource(value.sbom?.url),
    },
    license: {
      status: status(value.license?.status),
      expression: cleanBounded(value.license?.expression, 256),
    },
  };
}

function normalizeRemoteArtifactEvidence(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "catalogAuthority.remoteArtifactEvidence must be an object",
    );
  }
  if (
    value.schemaVersion !== "cc-plugin-marketplace-remote-artifact-evidence/v1"
  ) {
    throw new Error(
      "catalogAuthority.remoteArtifactEvidence schemaVersion is invalid",
    );
  }
  const digest = (candidate, label) => {
    const normalized = cleanBounded(candidate, 64)?.toLowerCase() || null;
    if (!normalized || !/^[a-f0-9]{64}$/.test(normalized)) {
      throw new Error(`${label} must be a SHA-256 hex digest`);
    }
    return normalized;
  };
  const boundedBytes = (candidate, maximum, label) => {
    if (
      !Number.isSafeInteger(candidate) ||
      candidate < 0 ||
      candidate > maximum
    ) {
      throw new Error(`${label} is outside the allowed byte limit`);
    }
    return candidate;
  };
  const normalizeArtifactUrl = (candidate, label) => {
    const sanitized = sanitizeSource(candidate);
    if (!sanitized || !/^https?:\/\//i.test(sanitized)) {
      throw new Error(`${label} must be an http(s) URL`);
    }
    return sanitized;
  };
  const normalizeRegistryOrigin = (candidate) => {
    const sanitized = normalizeArtifactUrl(
      candidate,
      "catalogAuthority.remoteArtifactEvidence.registryOrigin",
    );
    return new URL(sanitized).origin;
  };
  const signature = value.signature
    ? {
        status:
          value.signature.status === "fetched"
            ? "fetched"
            : (() => {
                throw new Error(
                  "catalogAuthority.remoteArtifactEvidence.signature.status is invalid",
                );
              })(),
        url: normalizeArtifactUrl(
          value.signature.url,
          "catalogAuthority.remoteArtifactEvidence.signature.url",
        ),
        signatureSha256: digest(
          value.signature.signatureSha256,
          "catalogAuthority.remoteArtifactEvidence.signature.signatureSha256",
        ),
        bytes: boundedBytes(
          value.signature.bytes,
          16 * 1024,
          "catalogAuthority.remoteArtifactEvidence.signature.bytes",
        ),
        fromCache: value.signature.fromCache === true,
        publicKey: {
          url: normalizeArtifactUrl(
            value.signature.publicKey?.url,
            "catalogAuthority.remoteArtifactEvidence.signature.publicKey.url",
          ),
          documentSha256: digest(
            value.signature.publicKey?.documentSha256,
            "catalogAuthority.remoteArtifactEvidence.signature.publicKey.documentSha256",
          ),
          spkiSha256: digest(
            value.signature.publicKey?.spkiSha256,
            "catalogAuthority.remoteArtifactEvidence.signature.publicKey.spkiSha256",
          ),
          bytes: boundedBytes(
            value.signature.publicKey?.bytes,
            64 * 1024,
            "catalogAuthority.remoteArtifactEvidence.signature.publicKey.bytes",
          ),
          fromCache: value.signature.publicKey?.fromCache === true,
        },
      }
    : null;
  const sbom = value.sbom
    ? {
        status:
          value.sbom.status === "digest-verified"
            ? "digest-verified"
            : (() => {
                throw new Error(
                  "catalogAuthority.remoteArtifactEvidence.sbom.status is invalid",
                );
              })(),
        url: normalizeArtifactUrl(
          value.sbom.url,
          "catalogAuthority.remoteArtifactEvidence.sbom.url",
        ),
        format: cleanBounded(value.sbom.format, 128),
        expectedDocumentSha256: digest(
          value.sbom.expectedDocumentSha256,
          "catalogAuthority.remoteArtifactEvidence.sbom.expectedDocumentSha256",
        ),
        documentSha256: digest(
          value.sbom.documentSha256,
          "catalogAuthority.remoteArtifactEvidence.sbom.documentSha256",
        ),
        bytes: boundedBytes(
          value.sbom.bytes,
          16 * 1024 * 1024,
          "catalogAuthority.remoteArtifactEvidence.sbom.bytes",
        ),
        fromCache: value.sbom.fromCache === true,
      }
    : null;
  if (!signature && !sbom) {
    throw new Error(
      "catalogAuthority.remoteArtifactEvidence must bind at least one artifact",
    );
  }
  if (sbom && sbom.expectedDocumentSha256 !== sbom.documentSha256) {
    throw new Error(
      "catalogAuthority.remoteArtifactEvidence SBOM digest is not verified",
    );
  }
  const claims = {
    publisherIdentityVerified: value.claims?.publisherIdentityVerified === true,
    signatureBytesFetched: value.claims?.signatureBytesFetched === true,
    publicKeyFingerprintVerified:
      value.claims?.publicKeyFingerprintVerified === true,
    manifestSignatureVerified: value.claims?.manifestSignatureVerified === true,
    sbomDocumentDigestVerified:
      value.claims?.sbomDocumentDigestVerified === true,
    sbomPayloadCompared: value.claims?.sbomPayloadCompared === true,
  };
  if (claims.publisherIdentityVerified || claims.manifestSignatureVerified) {
    throw new Error(
      "remote artifact fetch evidence cannot assert publisher identity or manifest verification",
    );
  }
  if (
    (!signature &&
      (claims.signatureBytesFetched || claims.publicKeyFingerprintVerified)) ||
    (!sbom && claims.sbomDocumentDigestVerified) ||
    claims.sbomPayloadCompared
  ) {
    throw new Error(
      "remote artifact fetch evidence claims do not match the recorded artifacts",
    );
  }
  if (
    signature &&
    (!claims.signatureBytesFetched || !claims.publicKeyFingerprintVerified)
  ) {
    throw new Error(
      "remote signature artifact evidence is missing verification claims",
    );
  }
  if (sbom && !claims.sbomDocumentDigestVerified) {
    throw new Error(
      "remote SBOM artifact evidence is missing digest verification",
    );
  }
  if (value.status !== "verified") {
    throw new Error(
      "catalogAuthority.remoteArtifactEvidence.status must be verified",
    );
  }
  const authority = {
    schemaVersion: "cc-plugin-marketplace-remote-artifact-evidence/v1",
    status: "verified",
    registryOrigin: normalizeRegistryOrigin(value.registryOrigin),
    signature,
    sbom,
    claims,
  };
  const evidenceDigest = digest(
    value.evidenceDigest,
    "catalogAuthority.remoteArtifactEvidence.evidenceDigest",
  );
  const actualDigest = crypto
    .createHash("sha256")
    .update(canonicalJson(authority))
    .digest("hex");
  if (evidenceDigest !== actualDigest) {
    throw new Error(
      "catalogAuthority.remoteArtifactEvidence.evidenceDigest does not match its authority",
    );
  }
  return { ...authority, evidenceDigest };
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

function canonicalJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
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
function copyDirGuarded(src, dst, root, sourceRoot = src) {
  for (const entry of _deps.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    const relative = path.relative(sourceRoot, from).replace(/\\/g, "/");
    if (!isWithin(root, to)) continue; // never escape the version dir
    if (entry.isSymbolicLink()) continue; // do not copy symlinks
    if (PLUGIN_MARKETPLACE_STAGED_SOURCE_EXCLUSIONS.includes(relative)) {
      continue;
    }
    if (entry.isDirectory()) {
      _deps.mkdirSync(to, { recursive: true });
      copyDirGuarded(from, to, root, sourceRoot);
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

function captureActivePointerState(name, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const activeFile = path.join(pluginNameDir(scope, name, { cwd }), ".active");
  let stat;
  try {
    stat = _deps.lstatSync(activeFile);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { present: false, bytes: null, version: null };
    }
    throw new Error(`ACTIVE_POINTER_UNREADABLE: ${error.message}`, {
      cause: error,
    });
  }
  if (!stat.isFile() || stat.size > 256) {
    throw new Error(
      "ACTIVE_POINTER_UNSAFE; repair it with plugin use before installing or updating",
    );
  }
  const bytes = Buffer.from(_deps.readFileSync(activeFile));
  const pointer = inspectActivePointer(scope, name, { cwd });
  return {
    present: true,
    bytes,
    version: pointer.status === "valid" ? pointer.version : null,
    generation: fileGeneration(stat),
  };
}

function captureInstalledVersionState(name, version, { scope, cwd }) {
  assertSafePluginNameDirectory(name, { scope, cwd });
  const root = pluginVersionDir(scope, name, version, { cwd });
  return captureInstalledRootState(root, name, version);
}

function captureInstalledRootState(root, name, version) {
  assertSafeInstalledPluginStructure(root);
  const parsed = parsePluginManifest(root);
  if (
    !parsed.ok ||
    parsed.metadata.name !== name ||
    parsed.metadata.version !== version
  ) {
    throw new Error(`ACTIVATION_TARGET_INVALID (${name}@${version})`);
  }
  const source = readSourceMetadataStrict(root, { required: true });
  installedSemanticPayloadFormat(source, root);
  const stat = _deps.lstatSync(root);
  const payload = buildMarketplacePayloadSbom(root, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  return {
    generation: fileGeneration(stat),
    payloadDigest: payload.digest,
    sourceDigest: crypto
      .createHash("sha256")
      .update(canonicalJson(source))
      .digest("hex"),
  };
}

function fileGeneration(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: Number(stat.birthtimeMs),
    mtimeMs: Number(stat.mtimeMs),
    size: Number(stat.size),
  };
}

function sameFileGeneration(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size,
  );
}

function sameInstalledVersionState(left, right) {
  return Boolean(
    left &&
    right &&
    sameFileGeneration(left.generation, right.generation) &&
    left.payloadDigest === right.payloadDigest &&
    left.sourceDigest === right.sourceDigest,
  );
}

function assertTransactionOwnsPointer(transaction) {
  let current;
  try {
    current = captureActivePointerState(transaction.name, transaction);
  } catch (error) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${error.message}`, {
      cause: error,
    });
  }
  assertOwnedPointerState(current, transaction);
}

function assertOwnedPointerState(current, transaction) {
  const expected = Buffer.from(String(transaction.version), "utf8");
  if (
    current.present !== true ||
    !Buffer.isBuffer(current.bytes) ||
    !current.bytes.equals(expected) ||
    !sameFileGeneration(
      current.generation,
      transaction.ownedActivePointerState?.generation,
    )
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: active pointer is no longer owned by this transaction",
    );
  }
}

function assertTransactionOwnsRollbackPointer(transaction) {
  if (!transaction.quarantinedActivePointer) {
    assertTransactionOwnsPointer(transaction);
    return;
  }
  const activeFile = path.join(
    pluginNameDir(transaction.scope, transaction.name, {
      cwd: transaction.cwd,
    }),
    ".active",
  );
  if (_deps.existsSync(activeFile)) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: active pointer was recreated during rollback recovery",
    );
  }
  const retained = capturePointerFileState(
    transaction.quarantinedActivePointer,
  );
  assertOwnedPointerState(retained, transaction);
}

function quarantineTransactionActivePointer(transaction) {
  assertTransactionOwnsPointer(transaction);
  const activeFile = path.join(
    pluginNameDir(transaction.scope, transaction.name, {
      cwd: transaction.cwd,
    }),
    ".active",
  );
  const retained = path.join(transaction.transactionRoot, "candidate-active");
  _deps.renameSync(activeFile, retained);
  transaction.quarantinedActivePointer = retained;
}

function capturePointerFileState(file) {
  let stat;
  try {
    stat = _deps.lstatSync(file);
  } catch (error) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${error.message}`, {
      cause: error,
    });
  }
  if (!stat.isFile() || stat.size > 256) {
    throw new Error("PLUGIN_TRANSACTION_STALE: retained pointer is unsafe");
  }
  return {
    present: true,
    bytes: Buffer.from(_deps.readFileSync(file)),
    generation: fileGeneration(stat),
  };
}

function assertTransactionOwnsActivePointer(transaction) {
  assertTransactionOwnsPointer(transaction);
  let installedVersionState;
  try {
    installedVersionState = captureInstalledVersionState(
      transaction.name,
      transaction.version,
      transaction,
    );
  } catch (error) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${error.message}`, {
      cause: error,
    });
  }
  if (
    !sameInstalledVersionState(
      installedVersionState,
      transaction.installedVersionState,
    )
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: installed candidate is no longer owned by this transaction",
    );
  }
  const predecessor = transaction.previousActiveState?.version;
  if (predecessor) {
    const installedVersions = listInstalledVersions(
      transaction.scope,
      transaction.name,
      { cwd: transaction.cwd },
    );
    if (!installedVersions.includes(predecessor)) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: predecessor version is no longer installed",
      );
    }
    let predecessorState;
    try {
      const predecessorRoot =
        transaction.backup && predecessor === transaction.version
          ? transaction.backup
          : pluginVersionDir(transaction.scope, transaction.name, predecessor, {
              cwd: transaction.cwd,
            });
      predecessorState = captureInstalledRootState(
        predecessorRoot,
        transaction.name,
        predecessor,
      );
    } catch (error) {
      throw new Error(`PLUGIN_TRANSACTION_STALE: ${error.message}`, {
        cause: error,
      });
    }
    if (
      !sameInstalledVersionState(
        predecessorState,
        transaction.previousInstalledVersionState,
      )
    ) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: predecessor bytes changed after the transaction began",
      );
    }
  }
}

function assertTransactionOwnsRecoveryState(transaction) {
  assertTransactionOwnsRollbackPointer(transaction);
  const rejected = path.join(transaction.transactionRoot, "rejected");
  const destExists = _deps.existsSync(transaction.dest);
  const rejectedExists = _deps.existsSync(rejected);
  const backupExists = transaction.backup
    ? _deps.existsSync(transaction.backup)
    : false;

  let candidateRoot;
  let predecessorRoot = null;
  if (transaction.backup) {
    if (backupExists) {
      if (destExists === rejectedExists) {
        throw new Error(
          "PLUGIN_TRANSACTION_STALE: recovery candidate topology is ambiguous",
        );
      }
      candidateRoot = destExists ? transaction.dest : rejected;
      predecessorRoot = transaction.backup;
    } else {
      if (!destExists || !rejectedExists) {
        throw new Error(
          "PLUGIN_TRANSACTION_STALE: recovery predecessor topology is incomplete",
        );
      }
      candidateRoot = rejected;
      predecessorRoot = transaction.dest;
    }
  } else {
    if (destExists === rejectedExists) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: recovery candidate topology is ambiguous",
      );
    }
    candidateRoot = destExists ? transaction.dest : rejected;
  }

  assertInstalledRootStateMatches(
    candidateRoot,
    transaction.name,
    transaction.version,
    transaction.installedVersionState,
    "installed candidate changed during rollback recovery",
  );
  if (predecessorRoot) {
    assertInstalledRootStateMatches(
      predecessorRoot,
      transaction.name,
      transaction.version,
      transaction.previousDestinationState,
      "replaced destination changed during rollback recovery",
    );
  }

  const predecessor = transaction.previousActiveState?.version;
  if (predecessor && predecessor !== transaction.version) {
    assertInstalledRootStateMatches(
      pluginVersionDir(transaction.scope, transaction.name, predecessor, {
        cwd: transaction.cwd,
      }),
      transaction.name,
      predecessor,
      transaction.previousInstalledVersionState,
      "predecessor bytes changed during rollback recovery",
    );
  }
}

function assertInstalledRootStateMatches(
  root,
  name,
  version,
  expected,
  reason,
) {
  let actual;
  try {
    actual = captureInstalledRootState(root, name, version);
  } catch (error) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${error.message}`, {
      cause: error,
    });
  }
  if (!sameInstalledVersionState(actual, expected)) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${reason}`);
  }
}

function restoreActivePointerSnapshot(name, snapshot, opts = {}) {
  if (snapshot?.present === true) {
    // Rollback restores the transaction's captured predecessor. Re-running the
    // public monotonic activation guard here would compare against the rejected
    // candidate that this rollback is removing and could strand partial state.
    writeActivePointerBytes(name, snapshot.bytes, opts);
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

function incompleteInstallRecoveryError({
  message,
  error,
  recoveryError,
  name,
  version,
  scope,
  cwd,
  transactionRoot,
  previousActiveState,
}) {
  let pointerFailure = null;
  if (previousActiveState?.version === version) {
    try {
      retainInstallRecoveryPointer(name, transactionRoot, {
        scope,
        cwd,
        expected: previousActiveState,
      });
    } catch (pointerError) {
      pointerFailure = pointerError;
    }
  }
  return new Error(
    `${message} and predecessor recovery is incomplete; retained recovery state at ${transactionRoot}: ${recoveryError.message}${
      pointerFailure
        ? `; active pointer fail-close also failed: ${pointerFailure.message}`
        : ""
    }`,
    { cause: error },
  );
}

function retainInstallRecoveryPointer(name, transactionRoot, opts) {
  const current = captureActivePointerState(name, opts);
  const expected = opts.expected;
  if (
    current.present !== true ||
    !Buffer.isBuffer(current.bytes) ||
    !current.bytes.equals(expected.bytes) ||
    !sameFileGeneration(current.generation, expected.generation)
  ) {
    throw new Error("active pointer changed during install recovery");
  }
  const activeFile = path.join(
    pluginNameDir(opts.scope || "user", name, { cwd: opts.cwd }),
    ".active",
  );
  _deps.renameSync(activeFile, path.join(transactionRoot, "previous-active"));
}

function restoreInstalledBytes({ dest, backup, transactionRoot }) {
  const rejected = path.join(transactionRoot, "rejected");
  if (!backup) {
    const destExists = _deps.existsSync(dest);
    const rejectedExists = _deps.existsSync(rejected);
    if (destExists === rejectedExists) {
      throw new Error("plugin rollback candidate topology is ambiguous");
    }
    if (destExists) _deps.renameSync(dest, rejected);
    return;
  }

  const backupExists = _deps.existsSync(backup);
  const destExists = _deps.existsSync(dest);
  const rejectedExists = _deps.existsSync(rejected);
  if (!backupExists) {
    if (destExists && rejectedExists) return;
    throw new Error("plugin rollback predecessor topology is incomplete");
  }
  if (destExists === rejectedExists) {
    throw new Error("plugin rollback candidate topology is ambiguous");
  }
  if (destExists) _deps.renameSync(dest, rejected);
  _deps.renameSync(backup, dest);
}
