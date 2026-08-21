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
  pluginLifecycleCoordinatorDir,
  pluginLifecycleCoordinatorLock,
  pluginVersionDir,
  scopeRoot,
  encodeName,
  listInstalledVersions,
  activeVersion,
  inspectActivePointer,
  discoverPlugins,
  SCOPES,
  DISABLED_FILENAME,
} from "./scopes.js";
import {
  enforcePluginPolicy,
  enforcePluginSourcePolicy,
  resolvePluginManagedPolicy,
  verifyPluginManifest,
} from "../plugin-security.js";
import {
  assertPluginGitTransportSafe,
  canonicalizePluginSource,
  normalizePluginLocalSourcePath,
  parsePluginGitSource,
  redactPluginSourceForDisplay,
} from "../plugin-source-identity.js";
import { assertRegistryResolutionAuthority } from "./remote-source.js";
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
import {
  buildManagedPublisherAuthority,
  normalizePublisherAuthority,
  normalizePublisherDeclaration,
  verifyInstalledManagedPublisherAuthority,
} from "./publisher-trust.js";
import { normalizeMarketplaceNetworkAuthority } from "./marketplace-network.js";
import {
  publishMarketplaceSourceCache,
  readMarketplaceSourceCache,
} from "./marketplace-source-cache.js";
import executionBroker from "../process-execution-broker/index.js";
import {
  PLUGIN_TRANSACTION_LOCK_DIRNAME,
  acquirePluginTransactionLock,
  assertPluginTransactionLock,
  claimPluginTransactionRecovery,
  inspectPluginTransactionLock,
  releasePluginTransactionLock,
  updatePluginTransactionJournal,
} from "./transaction-journal.js";

export const MAX_LISTED_PLUGIN_VERSIONS = 64;
export const SOURCE_METADATA_FILENAME = ".plugin-source.json";
export const PLUGIN_PROVENANCE_MIGRATION_ATTESTATION_SCHEMA =
  "cc-plugin-provenance-migration-attestation/v1";
export const PLUGIN_PROVENANCE_MIGRATION_RECORD_SCHEMA =
  "cc-plugin-provenance-migration-record/v1";
const MAX_PROVENANCE_METADATA_BYTES = 96 * 1024;

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
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  fsyncSync: fs.fsyncSync,
  mkdtempSync: fs.mkdtempSync,
  randomToken: () => crypto.randomBytes(16).toString("hex"),
  spawnSync: (...args) => executionBroker.spawnSync(...args),
  gitExecutable: null,
  beforeTransactionPhaseHook: null,
  transactionPhaseHook: null,
};

const pendingPluginTransactions = new WeakMap();
const ownedPluginLifecycleLocks = new Map();
const SOURCE_POLICY_PREFLIGHT = Symbol("plugin-source-policy-preflight");
const UPDATE_MATERIALIZATION = Symbol("plugin-update-materialization");
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
let cachedTrustedGitExecutable = null;
let cachedTrustedSshExecutable = null;

/**
 * Install a plugin from a local directory into a scope's immutable version dir.
 * @param {string} srcDir  directory containing the plugin (with its manifest)
 * @param {object} opts     { scope="user", cwd, force=false, expectedIdentity? }
 * @returns {{ name, version, scope, dir, warnings }}
 */
export function installFromDirectory(srcDir, opts = {}) {
  opts = preflightManagedSource(srcDir, opts, "install", {
    materializedKind: "directory",
  });
  const scope = opts.scope || "user";
  const src = path.resolve(opts.cwd || process.cwd(), srcDir);
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
  if (!opts._lifecycleLock) {
    return runWithPluginLifecycleLock(
      name,
      {
        scope,
        cwd: opts.cwd,
        operation: opts.transactional === true ? "install-review" : "install",
      },
      (lifecycleLock) =>
        installFromDirectory(srcDir, {
          ...opts,
          _lifecycleLock: lifecycleLock,
        }),
    );
  }
  assertSafePluginNameDirectory(name, { scope, cwd: opts.cwd });
  assertOwnedPluginLifecycleLock(opts._lifecycleLock, name, {
    scope,
    cwd: opts.cwd,
  });
  assertNoRetainedInstallRecovery(name, { scope, cwd: opts.cwd });
  assertInstalledNameDirectoryIdentity(name, { scope, cwd: opts.cwd });
  assertExpectedPluginIdentity(name, version, opts.expectedIdentity);
  let sourceMetadata = normalizeSourceMetadata(
    bindSourcePolicyAuthority(
      opts.sourceMetadata ?? { type: "local", source: src },
      opts,
    ),
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
        sourceKind:
          sourceMetadata?.type === "registry"
            ? "registry"
            : sourceMetadata?.type === "git"
              ? "git"
              : null,
        sourcePolicyPreflighted: true,
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
  if (sourceMetadata.type === "registry") {
    const publisherAuthority = buildManagedPublisherAuthority({
      name,
      registryUrl: sourceMetadata.registry || sourceMetadata.source,
      declaration: sourceMetadata.catalogAuthority?.publisherDeclaration,
      signingKeySha256: verification?.publicKeySha256,
      managed: opts.managedPolicy,
    });
    if (publisherAuthority) {
      sourceMetadata = {
        ...sourceMetadata,
        catalogAuthority: {
          ...sourceMetadata.catalogAuthority,
          publisherAuthority,
        },
      };
    }
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
  const transactionRoot = allocatePluginTransactionRoot(nameDir);
  const staged = path.join(transactionRoot, "staged");
  const backup = destExists ? path.join(transactionRoot, "previous") : null;
  let installedVersionState = null;
  const lifecycleTransaction = {
    kind: "install",
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
    ownedActivePointerState: null,
    installedVersionState: null,
    lifecycleLock: opts._lifecycleLock,
  };
  persistPluginLifecycleTransaction(lifecycleTransaction, "staging");
  let installedAtDest = false;
  let transactionRetained = false;
  let preserveTransactionRoot = false;
  let resultForCleanup = null;

  try {
    _deps.mkdirSync(transactionRoot, { mode: 0o700 });
    fsyncDirectoryBestEffort(nameDir);
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
    fsyncPluginTree(staged);
    lifecycleTransaction.installedVersionState = captureInstalledRootState(
      staged,
      name,
      version,
    );
    persistPluginLifecycleTransaction(lifecycleTransaction, "prepared");

    // Commit the fully validated directory with same-volume renames. A forced
    // same-version reinstall retains the old bytes until the caller finalizes
    // the upgrade transaction.
    if (backup) {
      _deps.renameSync(dest, backup);
      fsyncDirectoryBestEffort(nameDir);
      persistPluginLifecycleTransaction(
        lifecycleTransaction,
        "predecessor-quarantined",
      );
    }
    try {
      _deps.renameSync(staged, dest);
      fsyncDirectoryBestEffort(nameDir);
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

    try {
      installedVersionState = captureInstalledVersionState(name, version, {
        scope,
        cwd: opts.cwd,
      });
      lifecycleTransaction.installedVersionState = installedVersionState;
      persistPluginLifecycleTransaction(
        lifecycleTransaction,
        "candidate-published",
      );
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

    let activation;
    try {
      activation = setActiveVersion(name, version, {
        scope,
        cwd: opts.cwd,
        allowSourceSwitch: opts.allowSourceSwitch === true,
        ownedTransactionRoot: transactionRoot,
        _lifecycleLock: opts._lifecycleLock,
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
    lifecycleTransaction.ownedActivePointerState =
      activation.activePointerState;
    persistPluginLifecycleTransaction(lifecycleTransaction, "candidate-active");
    if (opts.transactional === true) {
      pendingPluginTransactions.set(result, lifecycleTransaction);
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
  const governedOpts = preflightManagedSource(source, opts, "install");
  return _withMaterializedSource(
    source,
    (dir, info) => {
      const sourceMetadata =
        normalizeSourceMetadata(
          bindSourcePolicyAuthority(governedOpts.sourceMetadata, governedOpts),
        ) ||
        normalizeSourceMetadata(
          bindSourcePolicyAuthority(
            info
              ? { type: "git", source: info.url, ref: info.ref || null }
              : {
                  type: "local",
                  source:
                    governedOpts[SOURCE_POLICY_PREFLIGHT]?.materialized?.path ||
                    path.resolve(
                      governedOpts.cwd || process.cwd(),
                      String(source || ""),
                    ),
                },
            governedOpts,
          ),
        );
      const res = installFromDirectory(dir, {
        ...governedOpts,
        sourceMetadata,
      });
      if (!info) return res;
      const result = {
        ...res,
        source: sourceMetadata?.source || null,
        ref: sourceMetadata?.ref || null,
      };
      transferPendingTransaction(res, result);
      return result;
    },
    governedOpts,
  );
}

function describeMaterializedSource(source, opts, materializedKind = null) {
  if (materializedKind !== "directory") {
    const git = parsePluginGitSource(source);
    if (git) return { kind: "git", git };
  }
  return {
    kind: "directory",
    path: path.resolve(
      opts.cwd || process.cwd(),
      normalizePluginLocalSourcePath(source),
    ),
  };
}

function preflightManagedSource(source, opts, action, options = {}) {
  if (opts[SOURCE_POLICY_PREFLIGHT]) return opts;
  const materialized = describeMaterializedSource(
    source,
    opts,
    options.materializedKind,
  );
  const registrySource =
    opts.sourceMetadata?.type === "registry"
      ? opts.sourceMetadata.registry || opts.sourceMetadata.source
      : null;
  // Policy follows the bytes that will actually be materialized. The only
  // intentional indirection is a registry-backed install, whose catalog URL
  // is authoritative in sourceMetadata; a caller-supplied display/legacy
  // policySource must never substitute a different allowlisted identity.
  const policySource = registrySource ?? source;
  const policyKind = registrySource ? "registry" : materialized.kind;
  const managedPolicy = resolvePluginManagedPolicy(opts);
  let registryAuthority = null;
  if (registrySource) {
    registryAuthority = assertRegistryResolutionAuthority(
      opts.registryResolutionAuthority,
      {
        registryUrl: registrySource,
        source,
        ref: materialized.git?.ref || null,
      },
    );
    if (
      opts.sourceMetadata.resolvedSource !== source ||
      (opts.sourceMetadata.ref || null) !== (materialized.git?.ref || null)
    ) {
      throw new Error(
        "registry source metadata does not match materialized source",
      );
    }
    if (
      !opts.sourceMetadata.catalogAuthority ||
      typeof opts.sourceMetadata.catalogAuthority !== "object" ||
      Array.isArray(opts.sourceMetadata.catalogAuthority)
    ) {
      throw new Error("registry source metadata requires catalog authority");
    }
    const declaredDocumentSha256 =
      opts.sourceMetadata.catalogAuthority?.registryDocumentSha256 || null;
    if (
      declaredDocumentSha256 &&
      declaredDocumentSha256 !== registryAuthority.documentSha256
    ) {
      throw new Error(
        "registry source authority does not match catalog document digest",
      );
    }
  }
  // Resolve managed identity before exists/clone/cache/process work. The
  // manifest name is checked again by installFromDirectory after materializing
  // bytes; source policy cannot wait for that later gate.
  const decision = enforcePluginSourcePolicy(policySource, managedPolicy, {
    action,
    cwd: opts.cwd,
    kindHint: policyKind,
  });
  const policyIdentity = canonicalizePluginSource(policySource, {
    cwd: opts.cwd,
    kindHint: policyKind,
  });
  const materializedIdentity = canonicalizePluginSource(source, {
    cwd: opts.cwd,
    kindHint: materialized.kind,
  });
  const identityDigest = (identity) =>
    crypto
      .createHash("sha256")
      .update(
        canonicalJson({
          identity: identity.identityDigest || identity.key,
          ref: identity.ref ?? null,
          path: identity.path ?? null,
        }),
      )
      .digest("hex");
  const sourceAuthority = {
    policyDigest: decision.policyDigest || null,
    sourceDigest: identityDigest(policyIdentity),
    resolvedSourceDigest: registrySource
      ? identityDigest(materializedIdentity)
      : null,
    registryDocumentSha256: registryAuthority?.documentSha256 || null,
  };
  const preflight = {
    decision,
    materialized,
    sourceAuthority,
  };
  const boundSourceMetadata = opts.sourceMetadata
    ? bindSourcePolicyAuthority(opts.sourceMetadata, {
        [SOURCE_POLICY_PREFLIGHT]: preflight,
      })
    : null;
  const normalizedSourceMetadata = boundSourceMetadata
    ? normalizeSourceMetadata(boundSourceMetadata)
    : null;
  if (opts.sourceMetadata && !normalizedSourceMetadata) {
    throw new Error("plugin source metadata is invalid");
  }
  return {
    ...opts,
    managedPolicy,
    ...(normalizedSourceMetadata
      ? { sourceMetadata: normalizedSourceMetadata }
      : {}),
    [SOURCE_POLICY_PREFLIGHT]: preflight,
  };
}

function bindSourcePolicyAuthority(sourceMetadata, opts) {
  const authority = opts[SOURCE_POLICY_PREFLIGHT]?.sourceAuthority;
  if (!authority || !sourceMetadata) return sourceMetadata;
  return {
    ...sourceMetadata,
    policyDigest: authority.policyDigest,
    sourceDigest: authority.sourceDigest,
    ...(authority.resolvedSourceDigest
      ? { resolvedSourceDigest: authority.resolvedSourceDigest }
      : {}),
    ...(authority.registryDocumentSha256 && sourceMetadata.catalogAuthority
      ? {
          catalogAuthority: {
            ...sourceMetadata.catalogAuthority,
            registryDocumentSha256: authority.registryDocumentSha256,
          },
        }
      : {}),
  };
}

/**
 * Materialize a source string into a local directory (cloning a git source into
 * a temp dir), invoke `fn(dir, gitInfo|null)`, then clean up any temp checkout.
 * Single fetch shared by installFromSource + updatePlugin.
 */
function _withMaterializedSource(source, fn, opts = {}) {
  const materialized =
    opts[SOURCE_POLICY_PREFLIGHT]?.materialized ||
    describeMaterializedSource(source, opts);
  if (materialized.kind === "directory") {
    if (
      _deps.existsSync(materialized.path) &&
      _deps.lstatSync(materialized.path).isDirectory()
    ) {
      return fn(materialized.path, null);
    }
    throw new Error(
      `source directory does not exist: ${redactPluginSourceForDisplay(materialized.path)}`,
    );
  }
  const git = materialized.git;
  if (git) {
    if (opts.offline === true) {
      const cached = readMarketplaceSourceCache(opts.sourceMetadata, {
        cacheDir: opts.sourceCacheDir,
        remoteSbomBytes: opts.remoteSbomBytes,
      });
      const result = fn(cached.dir, {
        ...git,
        sourceCacheKey: cached.cacheKey,
      });
      if (result && typeof result === "object") {
        result.sourceCache = {
          status: "hit",
          cacheKey: cached.cacheKey,
        };
      }
      return result;
    }
    const cloned = fetchGitRepo(git.url, git.ref, { cwd: opts.cwd });
    try {
      const result = fn(cloned, git);
      if (result && typeof result === "object") {
        try {
          const cached = publishMarketplaceSourceCache(
            cloned,
            result.sourceMetadata || opts.sourceMetadata,
            {
              cacheDir: opts.sourceCacheDir,
              remoteSbomBytes: opts.remoteSbomBytes,
            },
          );
          result.sourceCache = {
            status: cached.status,
            cacheKey: cached.cacheKey,
          };
        } catch {
          result.sourceCache = { status: "write-failed", cacheKey: null };
        }
      }
      return result;
    } finally {
      try {
        _deps.rmSync(path.dirname(cloned), { recursive: true, force: true });
      } catch {
        /* temp cleanup is best-effort */
      }
    }
  }
  throw new Error("source is neither a local directory nor a git URL");
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
  opts = preflightManagedSource(source, opts, "upgrade");
  const scope = opts.scope || "user";
  const updateMaterialized = (dir, info) => {
    const manifest = parsePluginManifest(dir);
    if (!manifest.ok) {
      throw new Error(
        `plugin manifest is invalid:\n  - ${manifest.errors.join("\n  - ")}`,
      );
    }
    const { name, version } = manifest.metadata;
    if (!opts._lifecycleLock) {
      return runWithPluginLifecycleLock(
        name,
        {
          scope,
          cwd: opts.cwd,
          operation: opts.transactional === true ? "upgrade-review" : "upgrade",
        },
        (lifecycleLock) =>
          updatePlugin(source, {
            ...opts,
            _lifecycleLock: lifecycleLock,
            [UPDATE_MATERIALIZATION]: { dir, info },
          }),
      );
    }
    assertSafePluginNameDirectory(name, { scope, cwd: opts.cwd });
    assertOwnedPluginLifecycleLock(opts._lifecycleLock, name, {
      scope,
      cwd: opts.cwd,
    });
    assertNoRetainedInstallRecovery(name, { scope, cwd: opts.cwd });
    assertExpectedPluginIdentity(name, version, opts.expectedIdentity);
    const sourceMetadata =
      normalizeSourceMetadata(
        bindSourcePolicyAuthority(opts.sourceMetadata, opts),
      ) ||
      normalizeSourceMetadata(
        bindSourcePolicyAuthority(
          info
            ? { type: "git", source: info.url, ref: info.ref || null }
            : {
                type: "local",
                source:
                  opts[SOURCE_POLICY_PREFLIGHT]?.materialized?.path ||
                  path.resolve(opts.cwd || process.cwd(), String(source || "")),
              },
          opts,
        ),
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
        lifecycleLock: opts._lifecycleLock,
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
      const pointerLifecycleTransaction = pointerTransactionRoot
        ? {
            kind: "install",
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
            previousDestinationState: null,
            ownedActivePointerState: null,
            installedVersionState,
            pointerOnly: true,
            lifecycleLock: opts._lifecycleLock,
          }
        : null;
      if (pointerLifecycleTransaction) {
        fsyncDirectoryBestEffort(pluginNameDir(scope, name, { cwd: opts.cwd }));
        persistPluginLifecycleTransaction(
          pointerLifecycleTransaction,
          "prepared",
        );
      }
      let activation = null;
      if (previousVersion !== version) {
        try {
          activation = setActiveVersion(name, version, {
            scope,
            cwd: opts.cwd,
            allowSourceSwitch: opts.allowSourceSwitch === true,
            ownedTransactionRoot: pointerTransactionRoot,
            _lifecycleLock: opts._lifecycleLock,
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
        pointerLifecycleTransaction.ownedActivePointerState =
          activation.activePointerState;
        persistPluginLifecycleTransaction(
          pointerLifecycleTransaction,
          "candidate-active",
        );
        pendingPluginTransactions.set(result, pointerLifecycleTransaction);
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
  };
  if (opts[UPDATE_MATERIALIZATION]) {
    return updateMaterialized(
      opts[UPDATE_MATERIALIZATION].dir,
      opts[UPDATE_MATERIALIZATION].info || null,
    );
  }
  return _withMaterializedSource(source, updateMaterialized, opts);
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
  assertOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
    transaction.name,
    transaction,
  );
  persistPluginLifecycleTransaction(transaction, "finalizing");
  assertSafePluginNameDirectory(transaction.name, transaction);
  assertTransactionOwnsActivePointer(transaction);
  const cleanup = retireCommittedTransactionRoot(transaction.transactionRoot);
  if (authoritativeTransactionCleanupPending(cleanup)) {
    persistPluginLifecycleTransaction(
      transaction,
      "finalize-recovery-required",
    );
    return { finalized: true, ...cleanup };
  }
  persistPluginLifecycleTransaction(transaction, "finalized");
  const lockCleanup = releaseOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
  );
  pendingPluginTransactions.delete(result);
  return {
    finalized: true,
    ...mergeLifecycleCleanup(cleanup, lockCleanup),
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

  assertOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
    transaction.name,
    transaction,
  );
  persistPluginLifecycleTransaction(transaction, "rolling-back");
  assertSafePluginNameDirectory(transaction.name, transaction);
  let pointerAlreadyRestored = false;
  if (transaction.rollbackPhase !== "bytes-restored") {
    if (transaction.rollbackPhase === "bytes-recovery") {
      adoptRollbackPointerQuarantine(transaction);
      assertTransactionOwnsRecoveryState(transaction);
    } else {
      assertTransactionOwnsActivePointer(transaction);
    }
    if (!transaction.pointerOnly) {
      if (transaction.rollbackPhase !== "bytes-recovery") {
        transaction.rollbackPhase = "bytes-recovery";
        persistPluginLifecycleTransaction(
          transaction,
          "rollback-bytes-recovery",
        );
      }
      try {
        restoreInstalledBytes(transaction);
      } catch (error) {
        // A same-volume rename can fail after candidate quarantine but before
        // predecessor publication. Preserve both roots and allow an exact,
        // ownership-checked retry instead of reactivating rejected bytes.
        try {
          quarantineTransactionActivePointer(transaction);
          persistPluginLifecycleTransaction(
            transaction,
            "rollback-bytes-recovery",
          );
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
    persistPluginLifecycleTransaction(transaction, "rollback-bytes-restored");
  } else {
    // A prior attempt restored/quarantined bytes but failed before the atomic
    // pointer replace. Retrying is safe only while the transaction still owns
    // the unchanged candidate pointer.
    try {
      assertTransactionOwnsRollbackPointer(transaction);
    } catch (pointerError) {
      if (!activePointerMatchesSnapshot(transaction)) throw pointerError;
      assertTransactionOwnsRecoveryBytes(transaction);
      pointerAlreadyRestored = true;
    }
  }

  if (!pointerAlreadyRestored) {
    restoreActivePointerSnapshot(
      transaction.name,
      transaction.previousActiveState,
      transaction,
    );
  }
  persistPluginLifecycleTransaction(transaction, "rolled-back");
  const cleanup = retireCommittedTransactionRoot(transaction.transactionRoot);
  if (authoritativeTransactionCleanupPending(cleanup)) {
    persistPluginLifecycleTransaction(
      transaction,
      "rollback-recovery-required",
    );
    return {
      rolledBack: true,
      version: transaction.previousActive || null,
      ...cleanup,
    };
  }
  const lockCleanup = releaseOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
  );
  pendingPluginTransactions.delete(result);
  return {
    rolledBack: true,
    version: transaction.previousActive || null,
    ...mergeLifecycleCleanup(cleanup, lockCleanup),
  };
}

/** Redacted cross-process lifecycle authority for management/doctor surfaces. */
export function inspectPluginTransaction(name, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  assertSafePluginNameDirectory(name, { scope, cwd });
  const inspected = inspectPluginTransactionLock({
    name,
    scope,
    nameDir: pluginLifecycleCoordinatorDir(name),
    contextDigest: pluginLifecycleContextDigest(name, { scope, cwd }),
  });
  if (!inspected) return null;
  return {
    schemaVersion: inspected.journal.schemaVersion,
    name,
    scope,
    operation: inspected.journal.operation,
    phase: inspected.journal.phase,
    revision: inspected.journal.revision,
    journalDigest: inspected.journal.journalDigest,
    previousJournalDigest: inspected.journal.previousJournalDigest,
    owner: {
      pid: inspected.owner.pid,
      hostname: inspected.owner.hostname,
      startedAt: inspected.owner.startedAt,
      alive: inspected.ownerAlive,
    },
    recoverable: Boolean(inspected.journal.transaction),
  };
}

/**
 * Explicitly recover a durable transaction after its recorded owner died.
 * Ordinary mutation never steals a stale lock. `forceOwner` is required when
 * the owner is still live or belongs to another host and therefore cannot be
 * disproved locally.
 */
export function recoverPluginTransaction(name, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const action = opts.action || "rollback";
  if (!new Set(["rollback", "finalize", "abort"]).has(action)) {
    throw new Error(`unknown plugin transaction recovery action: ${action}`);
  }
  assertSafePluginNameDirectory(name, { scope, cwd });
  const lifecycleLock = claimPluginTransactionRecovery({
    name,
    scope,
    nameDir: pluginLifecycleCoordinatorDir(name),
    contextDigest: pluginLifecycleContextDigest(name, { scope, cwd }),
    force: opts.forceOwner === true,
  });
  lifecycleLock.targetNameDir = pluginNameDir(scope, name, { cwd });
  const serialized = lifecycleLock.journal.transaction;
  if (!serialized) {
    if (hasRetainedLifecycleRecovery(lifecycleLock.targetNameDir)) {
      throw new Error(
        "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: journal has no transaction authority for retained recovery bytes",
      );
    }
    updatePluginTransactionJournal(lifecycleLock, { phase: "aborted" });
    const lockCleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
    return { recovered: true, action: "abort", ...lockCleanup };
  }
  const transactionKind = serialized.kind || "install";
  if (transactionKind === "enabled-state") {
    return recoverPluginEnabledStateTransaction(
      name,
      { scope, cwd, action },
      lifecycleLock,
      serialized,
    );
  }
  if (transactionKind === "provenance-migration") {
    return recoverPluginProvenanceMigrationTransaction(
      name,
      { scope, cwd, action },
      lifecycleLock,
      serialized,
    );
  }
  if (
    transactionKind === "uninstall-version" ||
    transactionKind === "uninstall-name"
  ) {
    return recoverPluginUninstallTransaction(
      name,
      { scope, cwd, action },
      lifecycleLock,
      serialized,
    );
  }
  if (action === "abort") {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: a prepared transaction must be rolled back or finalized",
    );
  }

  const transaction = deserializePluginLifecycleTransaction(
    name,
    { scope, cwd },
    lifecycleLock,
    serialized,
  );
  adoptCrashWindowPointerAuthority(transaction);

  if (action === "finalize") {
    if (!transaction.ownedActivePointerState) {
      throw new Error(
        "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: candidate activation was not durably observed",
      );
    }
    persistPluginLifecycleTransaction(transaction, "finalizing");
    assertTransactionOwnsActivePointer(transaction);
    const cleanup = retireCommittedTransactionRoot(transaction.transactionRoot);
    if (authoritativeTransactionCleanupPending(cleanup)) {
      persistPluginLifecycleTransaction(
        transaction,
        "finalize-recovery-required",
      );
      return {
        recovered: false,
        action,
        recoveryRequired: true,
        ...cleanup,
      };
    }
    persistPluginLifecycleTransaction(transaction, "finalized");
    const lockCleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
    return {
      recovered: true,
      action,
      version: transaction.version,
      ...mergeLifecycleCleanup(cleanup, lockCleanup),
    };
  }

  if (!transaction.ownedActivePointerState) {
    return rollbackPreparedPluginTransaction(transaction);
  }
  const recoveryResult = {};
  pendingPluginTransactions.set(recoveryResult, transaction);
  try {
    const rolledBack = rollbackPluginUpdate(recoveryResult);
    return { recovered: rolledBack.rolledBack, action, ...rolledBack };
  } finally {
    pendingPluginTransactions.delete(recoveryResult);
  }
}

function recoverPluginEnabledStateTransaction(
  name,
  { scope, cwd, action },
  lifecycleLock,
  serialized,
) {
  if (action === "abort") {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: a prepared lifecycle state change must be rolled back or finalized",
    );
  }
  const transaction = deserializePluginEnabledStateTransaction(
    name,
    { scope, cwd },
    lifecycleLock,
    serialized,
  );
  const current = captureDisabledMarkerState(name, { scope, cwd });

  if (action === "finalize") {
    persistPluginLifecycleTransaction(transaction, "marker-finalizing");
    if (
      !sameLifecycleFileState(current, transaction.previousMarkerState) &&
      !lifecycleFileContentMatches(current, transaction.desiredMarkerState)
    ) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: disabled marker changed outside the recorded transaction",
      );
    }
    if (!lifecycleFileContentMatches(current, transaction.desiredMarkerState)) {
      writeDisabledMarkerState(
        transaction.marker,
        transaction.nameDir,
        transaction.desiredMarkerState,
      );
    }
    transaction.ownedMarkerState = captureDisabledMarkerState(name, {
      scope,
      cwd,
    });
    assertLifecycleFileContent(
      transaction.ownedMarkerState,
      transaction.desiredMarkerState,
      "disabled marker did not finalize the recorded lifecycle state",
    );
    persistPluginLifecycleTransaction(transaction, "marker-finalized");
    const cleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
    return {
      recovered: true,
      action,
      name,
      scope,
      enabled: transaction.enabled,
      ...cleanup,
    };
  }

  persistPluginLifecycleTransaction(transaction, "marker-rolling-back");
  const ownsPublishedState = transaction.ownedMarkerState
    ? sameLifecycleFileState(current, transaction.ownedMarkerState)
    : lifecycleFileContentMatches(current, transaction.desiredMarkerState);
  if (
    !sameLifecycleFileState(current, transaction.previousMarkerState) &&
    !ownsPublishedState
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: disabled marker changed outside the recorded transaction",
    );
  }
  if (!sameLifecycleFileState(current, transaction.previousMarkerState)) {
    writeDisabledMarkerState(
      transaction.marker,
      transaction.nameDir,
      transaction.previousMarkerState,
    );
  }
  const restored = captureDisabledMarkerState(name, { scope, cwd });
  assertLifecycleFileContent(
    restored,
    transaction.previousMarkerState,
    "disabled marker rollback did not restore the recorded predecessor",
  );
  persistPluginLifecycleTransaction(transaction, "marker-rolled-back");
  const cleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
  return {
    recovered: true,
    action,
    rolledBack: true,
    name,
    scope,
    enabled: transaction.previousMarkerState.present !== true,
    ...cleanup,
  };
}

function recoverPluginProvenanceMigrationTransaction(
  name,
  { scope, cwd, action },
  lifecycleLock,
  serialized,
) {
  if (action === "abort") {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: a prepared provenance migration must be rolled back or finalized",
    );
  }
  const transaction = deserializePluginProvenanceMigrationTransaction(
    name,
    { scope, cwd },
    lifecycleLock,
    serialized,
  );
  const current = captureLifecycleFileState(
    transaction.marker,
    MAX_PROVENANCE_METADATA_BYTES,
    "PLUGIN_SOURCE_METADATA_UNSAFE",
  );
  if (action === "finalize") {
    persistPluginLifecycleTransaction(transaction, "provenance-finalizing");
    if (
      !sameLifecycleFileState(current, transaction.previousMetadataState) &&
      !lifecycleFileContentMatches(current, transaction.desiredMetadataState)
    ) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: plugin source metadata changed outside the migration",
      );
    }
    if (
      !lifecycleFileContentMatches(current, transaction.desiredMetadataState)
    ) {
      writeDurableFileAtomic(
        transaction.root,
        transaction.marker,
        transaction.desiredMetadataState.bytes,
      );
    }
    transaction.ownedMetadataState = captureLifecycleFileState(
      transaction.marker,
      MAX_PROVENANCE_METADATA_BYTES,
      "PLUGIN_SOURCE_METADATA_UNSAFE",
    );
    readSourceMetadataStrict(transaction.root, { required: true });
    persistPluginLifecycleTransaction(transaction, "provenance-finalized");
    const cleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
    return {
      recovered: true,
      action,
      migrated: true,
      name,
      version: transaction.version,
      scope,
      ...cleanup,
    };
  }
  persistPluginLifecycleTransaction(transaction, "provenance-rolling-back");
  const ownsPublished = transaction.ownedMetadataState
    ? sameLifecycleFileState(current, transaction.ownedMetadataState)
    : lifecycleFileContentMatches(current, transaction.desiredMetadataState);
  if (
    !sameLifecycleFileState(current, transaction.previousMetadataState) &&
    !ownsPublished
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: plugin source metadata changed outside the migration",
    );
  }
  if (!sameLifecycleFileState(current, transaction.previousMetadataState)) {
    writeLifecycleFileState(
      transaction.marker,
      transaction.root,
      transaction.previousMetadataState,
    );
  }
  persistPluginLifecycleTransaction(transaction, "provenance-rolled-back");
  const cleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
  return {
    recovered: true,
    action,
    rolledBack: true,
    name,
    version: transaction.version,
    scope,
    ...cleanup,
  };
}

function recoverPluginUninstallTransaction(
  name,
  { scope, cwd, action },
  lifecycleLock,
  serialized,
) {
  if (action === "abort") {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: a prepared uninstall must be rolled back or finalized",
    );
  }
  const transaction = deserializePluginUninstallTransaction(
    name,
    { scope, cwd },
    lifecycleLock,
    serialized,
  );
  return action === "finalize"
    ? finalizeRecoveredUninstallTransaction(transaction)
    : rollbackRecoveredUninstallTransaction(transaction);
}

function finalizeRecoveredUninstallTransaction(transaction) {
  const finalizing =
    transaction.lifecycleLock.journal.phase.startsWith("uninstall-final");
  if (transaction.kind === "uninstall-version") {
    if (!finalizing) prepareRecoveredVersionUninstallFinalize(transaction);
    else assertRecoveredVersionUninstallPublished(transaction);
  } else if (!finalizing) {
    prepareRecoveredWholeNameUninstallFinalize(transaction);
  } else if (_deps.existsSync(transaction.nameDir)) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: plugin name reappeared during uninstall finalization",
    );
  }

  if (!finalizing) {
    persistPluginLifecycleTransaction(transaction, "uninstall-finalizing");
  }
  const cleanupRoot = committedCleanupRoot(transaction.transactionRoot);
  const cleanup = _deps.existsSync(transaction.transactionRoot)
    ? retireCommittedTransactionRoot(transaction.transactionRoot)
    : retireCommittedTransactionRoot(cleanupRoot);
  if (authoritativeTransactionCleanupPending(cleanup)) {
    persistPluginLifecycleTransaction(
      transaction,
      "uninstall-finalize-recovery-required",
    );
    return {
      recovered: false,
      action: "finalize",
      recoveryRequired: true,
      ...cleanup,
    };
  }
  persistPluginLifecycleTransaction(transaction, "uninstall-finalized");
  const lockCleanup = releaseOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
  );
  return {
    recovered: true,
    action: "finalize",
    removed:
      transaction.kind === "uninstall-version"
        ? [transaction.version]
        : transaction.versions,
    ...mergeLifecycleCleanup(cleanup, lockCleanup),
  };
}

function prepareRecoveredVersionUninstallFinalize(transaction) {
  const destExists = _deps.existsSync(transaction.dest);
  const quarantinedExists = _deps.existsSync(transaction.quarantined);
  if (destExists && !quarantinedExists) {
    assertInstalledRootStateMatches(
      transaction.dest,
      transaction.name,
      transaction.version,
      transaction.removedVersionState,
      "uninstall target changed before recovered quarantine",
    );
    if (!_deps.existsSync(transaction.transactionRoot)) {
      _deps.mkdirSync(transaction.transactionRoot, { mode: 0o700 });
      fsyncDirectoryBestEffort(transaction.nameDir);
    }
    _deps.renameSync(transaction.dest, transaction.quarantined);
    fsyncDirectoryBestEffort(transaction.nameDir);
    fsyncDirectoryBestEffort(transaction.transactionRoot);
    persistPluginLifecycleTransaction(
      transaction,
      "uninstall-version-quarantined-recovered",
    );
  } else if (!destExists && quarantinedExists) {
    assertInstalledRootStateMatches(
      transaction.quarantined,
      transaction.name,
      transaction.version,
      transaction.removedVersionState,
      "quarantined uninstall bytes changed",
    );
  } else {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: uninstall version topology is ambiguous",
    );
  }
  publishVersionUninstallActiveState(transaction);
  persistPluginLifecycleTransaction(
    transaction,
    "uninstall-state-published-recovered",
  );
}

function assertRecoveredVersionUninstallPublished(transaction) {
  if (_deps.existsSync(transaction.dest)) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: removed version reappeared during finalization",
    );
  }
  const current = captureActivePointerState(transaction.name, transaction);
  assertLifecycleFileContent(
    current,
    transaction.desiredActiveState,
    "uninstall fallback changed during finalization",
  );
  assertLifecycleFileContent(
    captureDisabledMarkerState(transaction.name, transaction),
    transaction.desiredMarkerState,
    "uninstall disabled marker changed during finalization",
  );
}

function prepareRecoveredWholeNameUninstallFinalize(transaction) {
  const targetExists = _deps.existsSync(transaction.nameDir);
  const quarantinedExists = _deps.existsSync(transaction.transactionRoot);
  if (targetExists && !quarantinedExists) {
    assertPluginNameStateMatches(
      transaction.nameDir,
      transaction.name,
      transaction.previousNameState,
      "plugin name changed before recovered quarantine",
    );
    _deps.renameSync(transaction.nameDir, transaction.transactionRoot);
    fsyncDirectoryBestEffort(path.dirname(transaction.nameDir));
    persistPluginLifecycleTransaction(
      transaction,
      "uninstall-name-quarantined-recovered",
    );
  } else if (!targetExists && quarantinedExists) {
    assertPluginNameStateMatches(
      transaction.transactionRoot,
      transaction.name,
      transaction.previousNameState,
      "quarantined plugin name changed",
    );
  } else {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: whole-name uninstall topology is ambiguous",
    );
  }
}

function rollbackRecoveredUninstallTransaction(transaction) {
  if (transaction.lifecycleLock.journal.phase.startsWith("uninstall-final")) {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: finalizing uninstall can only be finalized",
    );
  }
  persistPluginLifecycleTransaction(transaction, "uninstall-rolling-back");
  if (transaction.kind === "uninstall-version") {
    rollbackRecoveredVersionUninstall(transaction);
  } else {
    rollbackRecoveredWholeNameUninstall(transaction);
  }
  persistPluginLifecycleTransaction(transaction, "uninstall-rolled-back");
  const cleanup = retireCommittedTransactionRoot(transaction.transactionRoot);
  if (authoritativeTransactionCleanupPending(cleanup)) {
    persistPluginLifecycleTransaction(
      transaction,
      "uninstall-rollback-recovery-required",
    );
    return {
      recovered: false,
      action: "rollback",
      recoveryRequired: true,
      ...cleanup,
    };
  }
  const lockCleanup = releaseOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
  );
  return {
    recovered: true,
    action: "rollback",
    rolledBack: true,
    ...mergeLifecycleCleanup(cleanup, lockCleanup),
  };
}

function rollbackRecoveredVersionUninstall(transaction) {
  const current = captureActivePointerState(transaction.name, transaction);
  if (
    !samePointerState(current, transaction.previousActiveState) &&
    !lifecycleFileContentMatches(current, transaction.desiredActiveState)
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: active pointer changed during uninstall recovery",
    );
  }
  const destExists = _deps.existsSync(transaction.dest);
  const quarantinedExists = _deps.existsSync(transaction.quarantined);
  if (!destExists && quarantinedExists) {
    assertInstalledRootStateMatches(
      transaction.quarantined,
      transaction.name,
      transaction.version,
      transaction.removedVersionState,
      "quarantined uninstall bytes changed before rollback",
    );
    _deps.renameSync(transaction.quarantined, transaction.dest);
    fsyncDirectoryBestEffort(transaction.transactionRoot);
    fsyncDirectoryBestEffort(transaction.nameDir);
  } else if (destExists && !quarantinedExists) {
    assertInstalledRootStateMatches(
      transaction.dest,
      transaction.name,
      transaction.version,
      transaction.removedVersionState,
      "uninstall target changed before rollback",
    );
  } else {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: uninstall version topology is ambiguous",
    );
  }
  const afterBytes = captureActivePointerState(transaction.name, transaction);
  if (!samePointerState(afterBytes, transaction.previousActiveState)) {
    restoreActivePointerSnapshot(
      transaction.name,
      transaction.previousActiveState,
      transaction,
    );
  }
  const marker = captureDisabledMarkerState(transaction.name, transaction);
  if (
    !sameLifecycleFileState(marker, transaction.previousMarkerState) &&
    !lifecycleFileContentMatches(marker, transaction.desiredMarkerState)
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: disabled marker changed during uninstall recovery",
    );
  }
  if (!sameLifecycleFileState(marker, transaction.previousMarkerState)) {
    writeDisabledMarkerState(
      path.join(transaction.nameDir, DISABLED_FILENAME),
      transaction.nameDir,
      transaction.previousMarkerState,
    );
  }
}

function rollbackRecoveredWholeNameUninstall(transaction) {
  const targetExists = _deps.existsSync(transaction.nameDir);
  const quarantinedExists = _deps.existsSync(transaction.transactionRoot);
  if (!targetExists && quarantinedExists) {
    assertPluginNameStateMatches(
      transaction.transactionRoot,
      transaction.name,
      transaction.previousNameState,
      "quarantined plugin name changed before rollback",
    );
    _deps.renameSync(transaction.transactionRoot, transaction.nameDir);
    fsyncDirectoryBestEffort(path.dirname(transaction.nameDir));
  } else if (targetExists && !quarantinedExists) {
    assertPluginNameStateMatches(
      transaction.nameDir,
      transaction.name,
      transaction.previousNameState,
      "plugin name changed before rollback",
    );
  } else {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: whole-name uninstall topology is ambiguous",
    );
  }
}

/**
 * Classify a source string into a git URL (+ optional ref), or null when it is
 * not remote-looking. `owner/repo` expands to a GitHub HTTPS URL.
 */
export function parseGitSource(raw) {
  return parsePluginGitSource(raw);
}

function isPathWithin(child, root) {
  const relative = path.relative(root, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function validateTrustedExecutable(value, cwd) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  try {
    const executable = fs.realpathSync.native(value);
    const stat = fs.statSync(executable);
    if (!stat.isFile()) return null;
    if (process.platform !== "win32" && (Number(stat.mode) & 0o111) === 0) {
      return null;
    }
    if (isPathWithin(executable, path.resolve(cwd))) return null;
    return executable;
  } catch {
    return null;
  }
}

function resolveTrustedExecutable({
  cwd,
  executableName,
  configured,
  configuredLabel,
  injected = null,
  cached = null,
}) {
  if (injected != null) {
    const trusted = validateTrustedExecutable(injected, cwd);
    if (!trusted)
      throw new Error(`configured ${configuredLabel} is not trusted`);
    return trusted;
  }
  const trustedCached = validateTrustedExecutable(cached, cwd);
  if (trustedCached) return trustedCached;
  if (configured != null) {
    const trusted = validateTrustedExecutable(configured, cwd);
    if (!trusted) {
      throw new Error(`${configuredLabel} must be a trusted absolute file`);
    }
    return trusted;
  }
  for (const rawEntry of String(process.env.PATH || "").split(path.delimiter)) {
    const entry = rawEntry.replace(/^"|"$/gu, "");
    if (!entry || !path.isAbsolute(entry)) continue;
    const trusted = validateTrustedExecutable(
      path.join(entry, executableName),
      cwd,
    );
    if (trusted) return trusted;
  }
  throw new Error(
    `trusted ${configuredLabel} was not found on an absolute PATH entry`,
  );
}

function resolveTrustedGitExecutable(cwd) {
  const executable = resolveTrustedExecutable({
    cwd,
    executableName: process.platform === "win32" ? "git.exe" : "git",
    configured: process.env.CHAINLESSCHAIN_GIT_BIN,
    configuredLabel: "Git executable",
    injected: _deps.gitExecutable,
    cached: cachedTrustedGitExecutable,
  });
  cachedTrustedGitExecutable = executable;
  return executable;
}

function resolveTrustedSshExecutable(cwd) {
  const executable = resolveTrustedExecutable({
    cwd,
    executableName: process.platform === "win32" ? "ssh.exe" : "ssh",
    configured: process.env.CHAINLESSCHAIN_SSH_BIN,
    configuredLabel: "SSH executable",
    cached: cachedTrustedSshExecutable,
  });
  cachedTrustedSshExecutable = executable;
  return executable;
}

function hardenedPluginGitEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith("GIT_")) environment[key] = value;
  }
  return {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EXTERNAL_DIFF: "",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

function quoteSshCommandArgument(value) {
  if (process.platform === "win32") {
    return `"${String(value).replace(/"/gu, '\\"')}"`;
  }
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function hardenedPluginGitArgs(args, { url, cwd }) {
  const parsed = parsePluginGitSource(url);
  const sshTransport =
    /^ssh:\/\//iu.test(parsed?.url || "") ||
    (!(parsed?.url || "").includes("://") &&
      /^(?:[^@\s/:]+@)?(?:\[[^\]]+\]|[^\s/:]+):/u.test(parsed?.url || "") &&
      !/^[a-z]:[\\/]/iu.test(parsed?.url || ""));
  const sshArgs = sshTransport
    ? [
        "-c",
        `core.sshCommand=${quoteSshCommandArgument(resolveTrustedSshExecutable(cwd))} -F ${quoteSshCommandArgument(NULL_DEVICE)} -o BatchMode=yes -o ClearAllForwardings=yes -o PermitLocalCommand=no -o ProxyCommand=none -o CanonicalizeHostname=no`,
      ]
    : [];
  const fileTransport = /^file:\/\//iu.test(parsed?.url || "");
  return [
    "--no-pager",
    "-c",
    `core.hooksPath=${NULL_DEVICE}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "credential.helper=",
    "-c",
    "diff.external=",
    "-c",
    "http.followRedirects=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    `protocol.file.allow=${fileTransport ? "always" : "never"}`,
    ...sshArgs,
    ...args,
  ];
}

/**
 * Shallow-clone `url` (optionally at `ref`) into a fresh temp dir and return the
 * checkout path. Uses `git` via spawn WITHOUT a shell (url/ref are argv, not a
 * command line — no injection). Caller removes the temp dir's parent.
 */
export function fetchGitRepo(url, ref, options = {}) {
  // git argv-injection guard: a value starting with "-" is parsed by git as an
  // OPTION, not a URL/ref — e.g. a registry-supplied ref "-f" reaches
  // `git checkout <ref>` on the full-clone retry path, and an option-looking
  // url reaches `git clone`. Real git URLs/refs never start with "-"
  // (check-ref-format forbids it), so reject instead of trying to escape.
  if (String(url).startsWith("-")) {
    throw new Error("refusing git source that looks like an option");
  }
  if (ref != null && String(ref).startsWith("-")) {
    throw new Error("refusing git ref that looks like an option");
  }
  const git = parsePluginGitSource(ref ? `${url}#${ref}` : url);
  assertPluginGitTransportSafe(git, { allowFile: true });
  const cwd = path.resolve(options.cwd || process.cwd());
  const executable = resolveTrustedGitExecutable(cwd);
  const base = _deps.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-git-"));
  const dir = path.join(base, "repo");
  const run = (args) => {
    const hardenedArgs = hardenedPluginGitArgs(args, { url, cwd });
    const auditRedactArgIndexes = hardenedArgs.flatMap((argument, index) =>
      argument === url || (ref != null && argument === ref) ? [index] : [],
    );
    try {
      return _deps.spawnSync(executable, hardenedArgs, {
        cwd: base,
        encoding: "utf8",
        env: hardenedPluginGitEnvironment(),
        timeout: 120000,
        windowsHide: true,
        origin: "plugin:install-git",
        policy: "allow",
        scope: "plugin-install",
        shell: false,
        auditRedactArgIndexes,
      });
    } catch (error) {
      return { error, status: null, stdout: "", stderr: "" };
    }
  };

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
  if (res.error) {
    throw new Error(
      `git process failed for ${redactPluginSourceForDisplay(url)}`,
    );
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
    throw new Error(
      `git clone failed for ${redactPluginSourceForDisplay(url)} (git exited ${res.status})`,
    );
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
 * Return the physical per-scope inventory without collapsing shadowed names.
 * `listInstalled()` remains the runtime-effective view for compatibility;
 * management and preflight callers use this view to see disabled, blocked, and
 * lower-precedence payloads that could become effective after a mutation.
 */
export function listInstalledAllScopes(opts = {}) {
  const requested = new Set(opts.scopes || SCOPES);
  for (const scope of requested) {
    if (!SCOPES.includes(scope))
      throw new Error(`unknown plugin scope: ${scope}`);
  }
  const scopes = SCOPES.filter((scope) => requested.has(scope));
  const physical = scopes.flatMap((scope) =>
    listInstalled({ ...opts, scopes: [scope] }),
  );
  const effective = discoverPlugins({
    cwd: opts.cwd,
    scopes,
    skipPolicy: true,
    includeBlocked: true,
    allowRetainedInstall: opts.allowRetainedInstall === true,
  });
  const effectiveByName = new Map(
    effective.map((entry) => [encodeName(entry.name), entry]),
  );
  return physical.map((row) => {
    const authority = effectiveByName.get(encodeName(row.name)) || null;
    const effectiveAuthority = authority?.scope === row.scope;
    const rowPrecedence = SCOPES.indexOf(row.scope);
    const authorityPrecedence = authority
      ? SCOPES.indexOf(authority.scope)
      : -1;
    return {
      ...row,
      effectiveAuthority,
      shadowedByScope:
        authority && authorityPrecedence > rowPrecedence
          ? authority.scope
          : null,
      inactiveReason: effectiveAuthority
        ? row.runtimeBlocked
          ? "blocked"
          : null
        : row.enabled === false
          ? "disabled"
          : authority && authorityPrecedence > rowPrecedence
            ? "shadowed"
            : "not-effective",
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
  if (!opts._lifecycleLock) {
    return runWithPluginLifecycleLock(
      name,
      {
        scope,
        cwd,
        operation: "uninstall",
        allowRetainedRecovery: true,
      },
      (lifecycleLock) =>
        uninstall(name, { ...opts, _lifecycleLock: lifecycleLock }),
    );
  }
  assertSafePluginNameDirectory(name, { scope, cwd });
  assertOwnedPluginLifecycleLock(opts._lifecycleLock, name, { scope, cwd });

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
        lifecycleLock: opts._lifecycleLock,
      });
    } else if (removedWasActive && remaining.length === 0) {
      assertCrossScopeFallback({
        name,
        scope,
        cwd,
        allowSourceSwitch: opts.allowSourceSwitch === true,
        lifecycleLock: opts._lifecycleLock,
      });
    }
    return runDurableVersionUninstall({
      name,
      version: requestedVersion,
      scope,
      cwd,
      dir,
      remaining,
      removedWasActive,
      previousActiveState: captureActivePointerState(name, { scope, cwd }),
      lifecycleLock: opts._lifecycleLock,
    });
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
  assertCrossScopeFallback({
    name,
    scope,
    cwd,
    allowSourceSwitch: opts.allowSourceSwitch === true,
    lifecycleLock: opts._lifecycleLock,
  });
  return runDurableWholeNameUninstall({
    name,
    scope,
    cwd,
    versions: listInstalledVersions(scope, name, { cwd }),
    lifecycleLock: opts._lifecycleLock,
  });
}

function runDurableVersionUninstall({
  name,
  version,
  scope,
  cwd,
  dir,
  remaining,
  removedWasActive,
  previousActiveState,
  lifecycleLock,
}) {
  const nameDir = pluginNameDir(scope, name, { cwd });
  const transactionRoot = allocateLifecycleRecoveryRoot(nameDir, ".uninstall-");
  const quarantined = path.join(transactionRoot, version);
  const desiredActiveState = removedWasActive
    ? remaining.length > 0
      ? {
          present: true,
          bytes: Buffer.from(remaining[0], "utf8"),
          version: remaining[0],
          generation: null,
        }
      : { present: false, bytes: null, version: null, generation: null }
    : previousActiveState;
  const transaction = {
    kind: "uninstall-version",
    name,
    version,
    scope,
    cwd,
    nameDir,
    dest: dir,
    transactionRoot,
    quarantined,
    removedWasActive,
    removeNameAfterFinalize: remaining.length === 0,
    previousActiveState,
    desiredActiveState,
    ownedActivePointerState: null,
    removedVersionState: captureInstalledRootState(dir, name, version),
    previousMarkerState: captureDisabledMarkerState(name, { scope, cwd }),
    desiredMarkerState:
      remaining.length === 0
        ? { present: false, bytes: null, generation: null }
        : captureDisabledMarkerState(name, { scope, cwd }),
    ownedMarkerState: null,
    lifecycleLock,
  };

  persistPluginLifecycleTransaction(transaction, "uninstall-prepared");
  _deps.mkdirSync(transactionRoot, { mode: 0o700 });
  fsyncDirectoryBestEffort(nameDir);
  persistPluginLifecycleTransaction(transaction, "uninstall-root-created");
  assertInstalledRootStateMatches(
    dir,
    name,
    version,
    transaction.removedVersionState,
    "uninstall target changed before quarantine",
  );
  _deps.renameSync(dir, quarantined);
  fsyncDirectoryBestEffort(nameDir);
  fsyncDirectoryBestEffort(transactionRoot);
  persistPluginLifecycleTransaction(
    transaction,
    "uninstall-version-quarantined",
  );

  try {
    publishVersionUninstallActiveState(transaction);
  } catch (error) {
    try {
      persistPluginLifecycleTransaction(transaction, "uninstall-rolling-back");
      rollbackRecoveredVersionUninstall(transaction);
      persistPluginLifecycleTransaction(transaction, "uninstall-rolled-back");
      const cleanup = retireCommittedTransactionRoot(transactionRoot);
      if (authoritativeTransactionCleanupPending(cleanup)) {
        throw new Error(`retained recovery state at ${cleanup.cleanupPath}`);
      }
      updatePluginTransactionJournal(lifecycleLock, {
        phase: "uninstall-aborted",
        transaction: null,
      });
    } catch (recoveryError) {
      throw new Error(
        `plugin uninstall failed and recovery is incomplete; retained recovery state at ${transactionRoot}: ${recoveryError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
  persistPluginLifecycleTransaction(transaction, "uninstall-state-published");
  return finalizeDurableUninstallTransaction(transaction, [version]);
}

function runDurableWholeNameUninstall({
  name,
  scope,
  cwd,
  versions,
  lifecycleLock,
}) {
  const nameDir = pluginNameDir(scope, name, { cwd });
  const parent = path.dirname(nameDir);
  const quarantineRoot = allocateLifecycleRecoveryRoot(
    parent,
    `.uninstall-${encodeName(name)}-`,
  );
  const transaction = {
    kind: "uninstall-name",
    name,
    scope,
    cwd,
    nameDir,
    transactionRoot: quarantineRoot,
    versions,
    previousNameState: capturePluginNameState(name, { scope, cwd, versions }),
    lifecycleLock,
  };

  persistPluginLifecycleTransaction(transaction, "uninstall-prepared");
  assertPluginNameStateMatches(
    nameDir,
    name,
    transaction.previousNameState,
    "plugin name changed before whole-name quarantine",
  );
  _deps.renameSync(nameDir, quarantineRoot);
  fsyncDirectoryBestEffort(parent);
  persistPluginLifecycleTransaction(transaction, "uninstall-name-quarantined");
  return finalizeDurableUninstallTransaction(transaction, versions);
}

function publishVersionUninstallActiveState(transaction) {
  const current = captureActivePointerState(transaction.name, transaction);
  if (
    !samePointerState(current, transaction.previousActiveState) &&
    !lifecycleFileContentMatches(current, transaction.desiredActiveState)
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: active pointer changed during uninstall",
    );
  }
  if (
    transaction.removedWasActive &&
    !lifecycleFileContentMatches(current, transaction.desiredActiveState)
  ) {
    restoreActivePointerSnapshot(
      transaction.name,
      transaction.desiredActiveState,
      transaction,
    );
  }
  transaction.ownedActivePointerState = captureActivePointerState(
    transaction.name,
    transaction,
  );
  assertLifecycleFileContent(
    transaction.ownedActivePointerState,
    transaction.desiredActiveState,
    "uninstall active pointer did not publish the recorded fallback",
  );
  const marker = captureDisabledMarkerState(transaction.name, transaction);
  if (
    !sameLifecycleFileState(marker, transaction.previousMarkerState) &&
    !lifecycleFileContentMatches(marker, transaction.desiredMarkerState)
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: disabled marker changed during uninstall",
    );
  }
  if (!lifecycleFileContentMatches(marker, transaction.desiredMarkerState)) {
    writeDisabledMarkerState(
      path.join(transaction.nameDir, DISABLED_FILENAME),
      transaction.nameDir,
      transaction.desiredMarkerState,
    );
  }
  transaction.ownedMarkerState = captureDisabledMarkerState(
    transaction.name,
    transaction,
  );
  assertLifecycleFileContent(
    transaction.ownedMarkerState,
    transaction.desiredMarkerState,
    "uninstall disabled marker did not publish the recorded state",
  );
}

function finalizeDurableUninstallTransaction(transaction, removed) {
  persistPluginLifecycleTransaction(transaction, "uninstall-finalizing");
  const cleanup = retireCommittedTransactionRoot(transaction.transactionRoot);
  if (authoritativeTransactionCleanupPending(cleanup)) {
    persistPluginLifecycleTransaction(
      transaction,
      "uninstall-finalize-recovery-required",
    );
    const result = { removed, recoveryRequired: true, ...cleanup };
    pendingPluginTransactions.set(result, transaction);
    return result;
  }
  persistPluginLifecycleTransaction(transaction, "uninstall-finalized");
  return { removed, ...cleanup };
}

/** Pin a plugin's active version (rollback / switch). */
export function setActiveVersion(name, version, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  if (!opts._lifecycleLock) {
    return runWithPluginLifecycleLock(
      name,
      { scope, cwd, operation: "activate" },
      (lifecycleLock) =>
        setActiveVersion(name, version, {
          ...opts,
          _lifecycleLock: lifecycleLock,
        }),
    );
  }
  assertSafePluginNameDirectory(name, { scope, cwd });
  assertOwnedPluginLifecycleLock(opts._lifecycleLock, name, { scope, cwd });
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
    lifecycleLock: opts._lifecycleLock,
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
    fsyncRegularFile(tempFile);
    generation = fileGeneration(_deps.lstatSync(tempFile));
    _deps.renameSync(tempFile, activeFile);
    fsyncDirectoryBestEffort(nameDir);
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
  if (!opts._lifecycleLock) {
    return runWithPluginLifecycleLock(
      name,
      { scope, cwd, operation: enabled ? "enable" : "disable" },
      (lifecycleLock) =>
        setPluginEnabled(name, enabled, {
          ...opts,
          _lifecycleLock: lifecycleLock,
        }),
    );
  }
  assertSafePluginNameDirectory(name, { scope, cwd });
  assertOwnedPluginLifecycleLock(opts._lifecycleLock, name, { scope, cwd });
  assertNoRetainedInstallRecovery(name, { scope, cwd });
  const nameDir = pluginNameDir(scope, name, { cwd });
  if (
    !_deps.existsSync(nameDir) ||
    listInstalledVersions(scope, name, { cwd }).length === 0
  ) {
    throw new Error(`${name} is not installed at ${scope} scope`);
  }
  assertInstalledNameDirectoryIdentity(name, { scope, cwd });
  const pointer = inspectActivePointer(scope, name, { cwd, strictIo: true });
  if (pointer.status !== "valid") {
    throw new Error(
      `ACTIVE_POINTER_${pointer.status.toUpperCase()}; repair it with plugin use before changing lifecycle state`,
    );
  }
  if (enabled) {
    assertSemanticPayloadActivation({
      name,
      scope,
      cwd,
      targetVersion: pointer.version,
      allowSourceSwitch: opts.allowSourceSwitch === true,
      lifecycleLock: opts._lifecycleLock,
    });
  } else {
    assertCrossScopeFallback({
      name,
      scope,
      cwd,
      allowSourceSwitch: opts.allowSourceSwitch === true,
      lifecycleLock: opts._lifecycleLock,
    });
  }
  const marker = path.join(nameDir, DISABLED_FILENAME);
  const previousMarkerState = captureDisabledMarkerState(name, { scope, cwd });
  const desiredMarkerState = enabled
    ? { present: false, bytes: null, generation: null }
    : {
        present: true,
        bytes: Buffer.from(
          JSON.stringify(
            {
              disabled: true,
              reason: String(opts.reason || "disabled by user").slice(0, 256),
            },
            null,
            2,
          ),
          "utf8",
        ),
        generation: null,
      };
  const transaction = {
    kind: "enabled-state",
    name,
    scope,
    cwd,
    enabled: Boolean(enabled),
    previousMarkerState,
    desiredMarkerState,
    ownedMarkerState: null,
    lifecycleLock: opts._lifecycleLock,
  };
  persistPluginLifecycleTransaction(transaction, "marker-prepared");
  persistPluginLifecycleTransaction(transaction, "marker-committing");
  assertDisabledMarkerStateUnchanged(transaction, previousMarkerState);
  writeDisabledMarkerState(marker, nameDir, desiredMarkerState);
  transaction.ownedMarkerState = captureDisabledMarkerState(name, {
    scope,
    cwd,
  });
  assertLifecycleFileContent(
    transaction.ownedMarkerState,
    desiredMarkerState,
    "disabled marker did not publish the recorded lifecycle state",
  );
  persistPluginLifecycleTransaction(transaction, "marker-published");
  persistPluginLifecycleTransaction(transaction, "marker-finalized");
  return { name, scope, enabled: Boolean(enabled) };
}

/** Current lifecycle state for one scoped plugin. */
export function isPluginEnabled(name, opts = {}) {
  const scope = opts.scope || "user";
  return !_deps.existsSync(
    path.join(pluginNameDir(scope, name, { cwd: opts.cwd }), DISABLED_FILENAME),
  );
}

/** Build the exact canonical authority bytes an operator must sign. */
export function planPluginProvenanceMigration(name, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  const version = String(opts.version || "");
  if (!semver.valid(version)) {
    throw new Error("a valid installed plugin version is required");
  }
  assertSafePluginNameDirectory(name, { scope, cwd });
  const root = pluginVersionDir(scope, name, version, { cwd });
  if (!listInstalledVersions(scope, name, { cwd }).includes(version)) {
    throw new Error(`${name}@${version} is not installed at ${scope} scope`);
  }
  assertInstalledNameDirectoryIdentity(name, {
    scope,
    cwd,
    versions: [version],
  });
  const existing = captureLifecycleFileState(
    path.join(root, SOURCE_METADATA_FILENAME),
    MAX_PROVENANCE_METADATA_BYTES,
    "PLUGIN_SOURCE_METADATA_UNSAFE",
  );
  if (existing.present) {
    throw new Error(
      "plugin source metadata already exists; migration never overwrites provenance",
    );
  }
  if (!["local", "git", "registry"].includes(opts.sourceMetadata?.type)) {
    throw new Error("migration source metadata type is invalid");
  }
  const sourceMetadata = normalizeSourceMetadata(opts.sourceMetadata);
  if (!sourceMetadata) {
    throw new Error("migration source metadata is invalid or incomplete");
  }
  const issuedAt = normalizeMigrationIssuedAt(opts.issuedAt);
  const payload = buildMarketplacePayloadSbom(root, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  const authority = {
    schemaVersion: PLUGIN_PROVENANCE_MIGRATION_ATTESTATION_SCHEMA,
    subject: {
      name,
      version,
      scope,
      targetPathDigest: pluginMigrationTargetPathDigest(root),
      payload: {
        format: payload.schemaVersion,
        digest: payload.digest,
        fileCount: payload.fileCount,
        totalBytes: payload.totalBytes,
      },
    },
    sourceMetadata,
    issuedAt,
  };
  const signingBytes = Buffer.from(canonicalJson(authority), "utf8");
  return {
    authority,
    signingPayloadBase64: signingBytes.toString("base64"),
    signingPayloadSha256: crypto
      .createHash("sha256")
      .update(signingBytes)
      .digest("hex"),
  };
}

/** Install a signed, payload-bound provenance record without replacing bytes. */
export function migratePluginProvenance(name, opts = {}) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  if (!opts._lifecycleLock) {
    return runWithPluginLifecycleLock(
      name,
      { scope, cwd, operation: "provenance-migrate" },
      (lifecycleLock) =>
        migratePluginProvenance(name, {
          ...opts,
          _lifecycleLock: lifecycleLock,
        }),
    );
  }
  assertOwnedPluginLifecycleLock(opts._lifecycleLock, name, { scope, cwd });
  assertNoRetainedInstallRecovery(name, { scope, cwd });
  const verified = verifyPluginProvenanceMigrationAttestation(
    name,
    { scope, cwd, version: opts.version },
    opts.attestation,
    { expectedSignerSha256: opts.expectedSignerSha256 },
  );
  const root = pluginVersionDir(
    scope,
    name,
    verified.authority.subject.version,
    {
      cwd,
    },
  );
  const lock = readPluginLock(root);
  if (lock?.sbom) {
    throw new Error(
      "legacy provenance migration cannot rewrite an existing component-SBOM lock; reinstall the plugin from its reviewed source",
    );
  }
  const marker = path.join(root, SOURCE_METADATA_FILENAME);
  const previousMetadataState = captureLifecycleFileState(
    marker,
    MAX_PROVENANCE_METADATA_BYTES,
    "PLUGIN_SOURCE_METADATA_UNSAFE",
  );
  if (previousMetadataState.present) {
    throw new Error(
      "plugin source metadata already exists; migration never overwrites provenance",
    );
  }
  const record = {
    ...verified.authority.sourceMetadata,
    migrationAttestation: {
      schemaVersion: PLUGIN_PROVENANCE_MIGRATION_RECORD_SCHEMA,
      authority: verified.authority,
      signerPublicKeySha256: verified.signerPublicKeySha256,
      publicKeyPem: verified.publicKeyPem,
      signatureBase64: verified.signatureBase64,
    },
  };
  const bytes = Buffer.from(JSON.stringify(record, null, 2), "utf8");
  if (bytes.length > MAX_PROVENANCE_METADATA_BYTES) {
    throw new Error("plugin provenance migration record is too large");
  }
  const transaction = {
    kind: "provenance-migration",
    name,
    version: verified.authority.subject.version,
    scope,
    cwd,
    root,
    marker,
    previousMetadataState,
    desiredMetadataState: { present: true, bytes, generation: null },
    ownedMetadataState: null,
    lifecycleLock: opts._lifecycleLock,
  };
  persistPluginLifecycleTransaction(transaction, "provenance-prepared");
  persistPluginLifecycleTransaction(transaction, "provenance-committing");
  assertLifecycleFileStateAtPath(
    marker,
    previousMetadataState,
    MAX_PROVENANCE_METADATA_BYTES,
    "plugin source metadata changed before migration publication",
  );
  writeDurableFileAtomic(root, marker, bytes);
  transaction.ownedMetadataState = captureLifecycleFileState(
    marker,
    MAX_PROVENANCE_METADATA_BYTES,
    "PLUGIN_SOURCE_METADATA_UNSAFE",
  );
  assertLifecycleFileContent(
    transaction.ownedMetadataState,
    transaction.desiredMetadataState,
    "plugin provenance did not publish the signed migration record",
  );
  readSourceMetadataStrict(root, { required: true });
  persistPluginLifecycleTransaction(transaction, "provenance-published");
  persistPluginLifecycleTransaction(transaction, "provenance-finalized");
  return {
    migrated: true,
    name,
    version: transaction.version,
    scope,
    authorityDigest: verified.authorityDigest,
    signerPublicKeySha256: verified.signerPublicKeySha256,
  };
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
  const state = captureLifecycleFileState(
    file,
    MAX_PROVENANCE_METADATA_BYTES,
    "PLUGIN_SOURCE_METADATA_UNSAFE",
  );
  if (!state.present) {
    if (required) {
      throw new Error(
        "plugin source metadata is missing; remove and reinstall the plugin to restore provenance",
      );
    }
    return null;
  }
  try {
    const raw = JSON.parse(state.bytes.toString("utf8"));
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
    if (raw.migrationAttestation != null) {
      normalized.migrationAttestation = verifyStoredPluginProvenanceMigration(
        versionDir,
        normalized,
        raw.migrationAttestation,
      );
    }
    if (normalized.catalogAuthority?.publisherAuthority) {
      const publisher = verifyInstalledManagedPublisherAuthority(
        {
          root: versionDir,
          name: parsePluginManifest(versionDir).metadata?.name,
        },
        loadManagedPluginPolicy(),
      );
      if (!publisher.verified) {
        throw new Error(
          `installed publisher authority is invalid: ${publisher.reason}`,
        );
      }
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
  scope,
  cwd,
  candidateSourceMetadata,
}) {
  const to = candidateSemanticPayloadFormat(candidateSourceMetadata);
  for (const installedScope of SCOPES) {
    for (const installedVersion of listInstalledVersions(installedScope, name, {
      cwd,
    })) {
      const installedSource = strictInstalledSourceMetadata(
        name,
        installedVersion,
        { scope: installedScope, cwd },
      );
      const installedRoot = pluginVersionDir(
        installedScope,
        name,
        installedVersion,
        { cwd },
      );
      const from = installedSemanticPayloadFormat(
        installedSource,
        installedRoot,
      );
      if (semanticPayloadStrength(from) > semanticPayloadStrength(to)) {
        throw new Error(
          `SEMANTIC_SBOM_BINDING_DOWNGRADE (${from} -> ${to || "unbound"}; ${installedScope} -> ${scope})`,
        );
      }
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
  authorityBaseline = null,
  baselineScopes = SCOPES,
  lifecycleLock = null,
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
  for (const installedScope of baselineScopes) {
    for (const installedVersion of listInstalledVersions(installedScope, name, {
      cwd,
    })) {
      // Dormant provenance is still authority: skipping a missing record would
      // let deleting `.active` or a higher-scope pointer turn lower bytes into
      // an unreviewed downgrade trampoline.
      const installedSource =
        installedScope === scope && installedVersion === targetVersion
          ? targetSource
          : strictInstalledSourceMetadata(name, installedVersion, {
              scope: installedScope,
              cwd,
            });
      if (!sameSourceAuthority(installedSource, targetSource)) {
        savedSourceSwitch = true;
      }
      const installedRoot = pluginVersionDir(
        installedScope,
        name,
        installedVersion,
        { cwd },
      );
      const format = installedSemanticPayloadFormat(
        installedSource,
        installedRoot,
      );
      if (
        semanticPayloadStrength(format) >
        semanticPayloadStrength(strongestFormat)
      ) {
        strongestFormat = format;
      }
    }
  }
  if (semanticPayloadStrength(strongestFormat) > semanticPayloadStrength(to)) {
    throw new Error(
      `SEMANTIC_SBOM_BINDING_DOWNGRADE (${strongestFormat} -> ${to || "unbound"})`,
    );
  }
  const baseline =
    authorityBaseline || effectivePluginRecord(name, { cwd, lifecycleLock });
  let sourceSwitch = false;
  if (baseline?.runtimeBlocked) {
    sourceSwitch = savedSourceSwitch;
  } else if (baseline?.version) {
    const baselineSource = strictInstalledSourceMetadata(
      name,
      baseline.version,
      { scope: baseline.scope, cwd },
    );
    sourceSwitch = !sameSourceAuthority(baselineSource, targetSource);
  } else if (!baseline) {
    sourceSwitch = savedSourceSwitch;
  }
  if (sourceSwitch && !allowSourceSwitch) {
    throw new Error(
      active
        ? "SOURCE_SWITCH_APPROVAL_REQUIRED; pass --allow-source-switch to approve this activation"
        : "SOURCE_SWITCH_APPROVAL_REQUIRED; use plugin use --allow-source-switch to repair the active pointer",
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
      fsyncDirectoryBestEffort(path.dirname(transactionRoot));
    } catch {
      try {
        _deps.rmSync(transactionRoot, { recursive: true, force: true });
        fsyncDirectoryBestEffort(path.dirname(transactionRoot));
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
    fsyncDirectoryBestEffort(path.dirname(cleanupRoot));
    return { cleanupPending: false };
  } catch {
    // `.cleanup-*` is deliberately outside the activation/recovery namespace.
    // It can be retried on the next mutation without changing plugin state.
    return { cleanupPending: true, cleanupPath: cleanupRoot };
  }
}

function committedCleanupRoot(transactionRoot) {
  const basename = path.basename(transactionRoot || "");
  const prefix = basename.startsWith(".install-")
    ? ".install-"
    : basename.startsWith(".uninstall-")
      ? ".uninstall-"
      : null;
  return prefix
    ? path.join(
        path.dirname(transactionRoot),
        `.cleanup-${basename.slice(prefix.length)}`,
      )
    : transactionRoot;
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
      current.sourceDigest &&
      candidate.sourceDigest &&
      current.sourceDigest === candidate.sourceDigest &&
      current.resolvedSourceDigest &&
      candidate.resolvedSourceDigest &&
      current.resolvedSourceDigest === candidate.resolvedSourceDigest,
    );
  }
  return Boolean(
    current.sourceDigest &&
    candidate.sourceDigest &&
    current.sourceDigest === candidate.sourceDigest,
  );
}

function effectivePluginRecord(
  name,
  { cwd, excludeScope = null, lifecycleLock = null } = {},
) {
  for (const scope of [...SCOPES].reverse()) {
    if (scope === excludeScope) continue;
    const nameDir = pluginNameDir(scope, name, { cwd });
    if (!_deps.existsSync(nameDir)) continue;
    assertSafePluginNameDirectory(name, { scope, cwd });
    const enabled = !_deps.existsSync(path.join(nameDir, DISABLED_FILENAME));
    if (!enabled) continue;
    const versions = listInstalledVersions(scope, name, { cwd });
    const ownsLifecycle =
      lifecycleLock?.name === name && lifecycleLock?.released !== true;
    const ownsScopedLifecycle = ownsLifecycle && lifecycleLock.scope === scope;
    const ownedRecoveryRoot =
      lifecycleLock?.journal?.transaction?.transactionRootName || null;
    const recoveryRequired =
      (_deps.existsSync(pluginLifecycleCoordinatorLock(name)) &&
        !ownsLifecycle) ||
      _deps.readdirSync(nameDir, { withFileTypes: true }).some((entry) => {
        if (entry.name === PLUGIN_TRANSACTION_LOCK_DIRNAME) {
          return !ownsScopedLifecycle;
        }
        if (entry.name.startsWith(".install-")) {
          return !(ownsScopedLifecycle && entry.name === ownedRecoveryRoot);
        }
        return entry.name.startsWith(".uninstall-");
      });
    const pointer = inspectActivePointer(scope, name, { cwd, strictIo: true });
    if (recoveryRequired || pointer.status !== "valid") {
      if (versions.length === 0 && !recoveryRequired) continue;
      return {
        scope,
        name,
        version: null,
        root: null,
        runtimeBlocked: true,
        pointerStatus: recoveryRequired ? "recovery-required" : pointer.status,
      };
    }
    const root = pluginVersionDir(scope, name, pointer.version, { cwd });
    assertSafeInstalledPluginStructure(root);
    const parsed = parsePluginManifest(root);
    if (
      !parsed.ok ||
      parsed.metadata.name !== name ||
      parsed.metadata.version !== pointer.version
    ) {
      return {
        scope,
        name,
        version: null,
        root,
        runtimeBlocked: true,
        pointerStatus: parsed.ok ? "identity-mismatch" : "manifest-invalid",
      };
    }
    return {
      scope,
      name,
      version: pointer.version,
      root,
      runtimeBlocked: false,
      pointerStatus: "valid",
    };
  }
  return null;
}

/** Preflight the lower-scope authority exposed by disable/uninstall. */
function assertCrossScopeFallback({
  name,
  scope,
  cwd,
  allowSourceSwitch = false,
  lifecycleLock = null,
}) {
  const current = effectivePluginRecord(name, { cwd, lifecycleLock });
  if (!current || current.scope !== scope) return null;
  const fallback = effectivePluginRecord(name, {
    cwd,
    excludeScope: scope,
    lifecycleLock,
  });
  if (!fallback) return null;
  if (fallback.runtimeBlocked || !fallback.version) {
    throw new Error(
      `CROSS_SCOPE_FALLBACK_BLOCKED (${scope} -> ${fallback.scope}; ${fallback.pointerStatus || "invalid"})`,
    );
  }
  if (current.runtimeBlocked && !allowSourceSwitch) {
    throw new Error(
      `SOURCE_SWITCH_APPROVAL_REQUIRED; the blocked ${scope} authority cannot authenticate the ${fallback.scope} fallback`,
    );
  }
  assertSemanticPayloadActivation({
    name,
    scope: fallback.scope,
    cwd,
    targetVersion: fallback.version,
    allowSourceSwitch,
    authorityBaseline: current,
    baselineScopes: current.runtimeBlocked
      ? SCOPES.filter((candidate) => candidate !== scope)
      : SCOPES,
    lifecycleLock,
  });
  return fallback;
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
  const installedByScope = SCOPES.flatMap((installedScope) =>
    listInstalledVersions(installedScope, name, { cwd }).map(
      (installedVersion) => ({ installedScope, installedVersion }),
    ),
  );
  const installedVersions = installedByScope.map(
    ({ installedVersion }) => installedVersion,
  );
  const baseline = active || installedVersions.sort(semver.rcompare)[0] || null;
  if (!baseline) return;
  if (
    installedByScope.some(({ installedScope, installedVersion }) => {
      const installedSource = strictInstalledSourceMetadata(
        name,
        installedVersion,
        { scope: installedScope, cwd },
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
    sourceDigest:
      normalizeSourceAuthorityDigest(value.sourceDigest) ||
      pluginSourceAuthorityDigest(value.source, type, value.ref),
  };
  const registry = sanitizeSource(value.registry);
  const resolvedSource = sanitizeSource(value.resolvedSource);
  const packageName = cleanBounded(value.package, 256);
  if (registry) metadata.registry = registry;
  if (resolvedSource) metadata.resolvedSource = resolvedSource;
  const resolvedSourceDigest =
    normalizeSourceAuthorityDigest(value.resolvedSourceDigest) ||
    (value.resolvedSource
      ? pluginSourceAuthorityDigest(value.resolvedSource, "git", value.ref)
      : null);
  const policyDigest = normalizeSourceAuthorityDigest(value.policyDigest);
  if (resolvedSourceDigest) {
    metadata.resolvedSourceDigest = resolvedSourceDigest;
  }
  if (policyDigest) metadata.policyDigest = policyDigest;
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

function normalizeSourceAuthorityDigest(value) {
  const normalized = cleanBounded(value, 64)?.toLowerCase() || null;
  return normalized && /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function pluginSourceAuthorityDigest(source, type, ref = null) {
  const identity = canonicalizePluginSource(source, {
    kindHint:
      type === "registry" ? "registry" : type === "local" ? "directory" : "git",
    ref: ref || undefined,
  });
  return crypto
    .createHash("sha256")
    .update(
      canonicalJson({
        identity: identity.identityDigest || identity.key,
        ref: identity.ref ?? null,
        path: identity.path ?? null,
      }),
    )
    .digest("hex");
}

function normalizeMigrationIssuedAt(value) {
  const date = value == null ? new Date() : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("plugin provenance migration issuedAt is invalid");
  }
  const normalized = date.toISOString();
  if (value != null && String(value) !== normalized) {
    throw new Error(
      "plugin provenance migration issuedAt must be canonical ISO-8601 UTC",
    );
  }
  return normalized;
}

function pluginMigrationTargetPathDigest(root) {
  let target = path.resolve(root);
  if (process.platform === "win32") target = target.toLowerCase();
  return crypto.createHash("sha256").update(target).digest("hex");
}

function verifyPluginProvenanceMigrationAttestation(
  name,
  { scope, cwd, version },
  attestation,
  { expectedSignerSha256 },
) {
  if (!/^[a-f0-9]{64}$/u.test(String(expectedSignerSha256 || ""))) {
    throw new Error(
      "an exact --expected-signer-sha256 fingerprint is required",
    );
  }
  const authority = attestation?.authority;
  if (
    !authority ||
    typeof authority !== "object" ||
    Array.isArray(authority) ||
    authority.schemaVersion !== PLUGIN_PROVENANCE_MIGRATION_ATTESTATION_SCHEMA
  ) {
    throw new Error("plugin provenance migration attestation is invalid");
  }
  const expected = planPluginProvenanceMigration(name, {
    scope,
    cwd,
    version,
    sourceMetadata: authority.sourceMetadata,
    issuedAt: authority.issuedAt,
  });
  if (canonicalJson(expected.authority) !== canonicalJson(authority)) {
    throw new Error(
      "plugin provenance migration authority does not match installed bytes, scope, path, or source",
    );
  }
  return verifyPluginMigrationSignature(attestation, {
    expectedAuthority: expected.authority,
    expectedSignerSha256: String(expectedSignerSha256),
    requireManagedTrust: true,
  });
}

function verifyStoredPluginProvenanceMigration(root, sourceMetadata, record) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.schemaVersion !== PLUGIN_PROVENANCE_MIGRATION_RECORD_SCHEMA ||
    !record.authority ||
    record.authority.schemaVersion !==
      PLUGIN_PROVENANCE_MIGRATION_ATTESTATION_SCHEMA
  ) {
    throw new Error("stored provenance migration record is invalid");
  }
  const parsed = parsePluginManifest(root);
  if (!parsed.ok) {
    throw new Error("stored provenance migration subject manifest is invalid");
  }
  const payload = buildMarketplacePayloadSbom(root, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  const subject = record.authority.subject;
  if (
    !subject ||
    subject.name !== parsed.metadata.name ||
    subject.version !== parsed.metadata.version ||
    !SCOPES.includes(subject.scope) ||
    subject.targetPathDigest !== pluginMigrationTargetPathDigest(root) ||
    subject.payload?.format !== payload.schemaVersion ||
    subject.payload?.digest !== payload.digest ||
    subject.payload?.fileCount !== payload.fileCount ||
    subject.payload?.totalBytes !== payload.totalBytes ||
    normalizeMigrationIssuedAt(record.authority.issuedAt) !==
      record.authority.issuedAt ||
    canonicalJson(normalizeSourceMetadata(record.authority.sourceMetadata)) !==
      canonicalJson(sourceMetadata)
  ) {
    throw new Error(
      "stored provenance migration authority no longer matches installed bytes, path, or source",
    );
  }
  const verified = verifyPluginMigrationSignature(record, {
    expectedAuthority: record.authority,
    expectedSignerSha256: record.signerPublicKeySha256,
    requireManagedTrust: true,
  });
  return {
    schemaVersion: PLUGIN_PROVENANCE_MIGRATION_RECORD_SCHEMA,
    authority: verified.authority,
    authorityDigest: verified.authorityDigest,
    signerPublicKeySha256: verified.signerPublicKeySha256,
    publicKeyPem: verified.publicKeyPem,
    signatureBase64: verified.signatureBase64,
  };
}

function verifyPluginMigrationSignature(
  value,
  { expectedAuthority, expectedSignerSha256, requireManagedTrust },
) {
  const publicKeyPem = String(value?.publicKeyPem || "");
  const signatureBase64 = String(value?.signatureBase64 || "");
  if (
    publicKeyPem.length === 0 ||
    publicKeyPem.length > 16 * 1024 ||
    !/^[a-zA-Z0-9+/]+={0,2}$/u.test(signatureBase64) ||
    signatureBase64.length > 4096
  ) {
    throw new Error(
      "plugin provenance migration signature material is invalid",
    );
  }
  const signature = Buffer.from(signatureBase64, "base64");
  if (signature.toString("base64") !== signatureBase64) {
    throw new Error("plugin provenance migration signature is non-canonical");
  }
  let key;
  let signerPublicKeySha256;
  try {
    key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("not Ed25519");
    }
    signerPublicKeySha256 = crypto
      .createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex");
  } catch {
    throw new Error("plugin provenance migration public key is invalid");
  }
  if (signerPublicKeySha256 !== expectedSignerSha256) {
    throw new Error(
      `plugin provenance migration signer does not match the pinned fingerprint (${signerPublicKeySha256})`,
    );
  }
  if (requireManagedTrust) {
    const managed = loadManagedPluginPolicy();
    const trusted = new Set(
      (Array.isArray(managed?.trustedPluginKeySha256)
        ? managed.trustedPluginKeySha256
        : []
      ).map((fingerprint) => String(fingerprint).toLowerCase()),
    );
    if (trusted.size > 0 && !trusted.has(signerPublicKeySha256)) {
      throw new Error(
        `plugin provenance migration signer is not trusted by managed policy (${signerPublicKeySha256})`,
      );
    }
  }
  const signingBytes = Buffer.from(canonicalJson(expectedAuthority), "utf8");
  if (!crypto.verify(null, signingBytes, key, signature)) {
    throw new Error(
      "plugin provenance migration signature verification failed",
    );
  }
  return {
    authority: cloneLifecycleState(expectedAuthority),
    authorityDigest: crypto
      .createHash("sha256")
      .update(signingBytes)
      .digest("hex"),
    signerPublicKeySha256,
    publicKeyPem,
    signatureBase64,
  };
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
  const registryDocumentSha256 = cleanBounded(value.registryDocumentSha256, 64);
  const registryNetworkAuthority = normalizeMarketplaceNetworkAuthority(
    value.registryNetworkAuthority,
  );
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
  const publisherDeclaration = normalizePublisherDeclaration(
    value.publisherDeclaration,
  );
  const publisherAuthority = normalizePublisherAuthority(
    value.publisherAuthority,
  );
  if (value.publisherDeclaration != null && !publisherDeclaration) {
    throw new Error("catalogAuthority.publisherDeclaration is invalid");
  }
  if (value.publisherAuthority != null && !publisherAuthority) {
    throw new Error("catalogAuthority.publisherAuthority is invalid");
  }
  if (
    publisherAuthority &&
    (!publisherDeclaration ||
      canonicalJson(publisherAuthority.publisher) !==
        canonicalJson(publisherDeclaration))
  ) {
    throw new Error(
      "catalogAuthority publisher declaration does not match verified authority",
    );
  }
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
  if (
    registryDocumentSha256 &&
    !/^[a-f0-9]{64}$/.test(registryDocumentSha256)
  ) {
    throw new Error(
      "catalogAuthority.registryDocumentSha256 must be a SHA-256 hex digest",
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
    ...(registryDocumentSha256 ? { registryDocumentSha256 } : {}),
    ...(registryNetworkAuthority ? { registryNetworkAuthority } : {}),
    ...(artifactExpectations ? { artifactExpectations } : {}),
    ...(remoteArtifactEvidence ? { remoteArtifactEvidence } : {}),
    ...(remoteSbomPayloadComparison ? { remoteSbomPayloadComparison } : {}),
    ...(publisherDeclaration ? { publisherDeclaration } : {}),
    ...(publisherAuthority ? { publisherAuthority } : {}),
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
  return redactPluginSourceForDisplay(raw);
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

function allocatePluginTransactionRoot(nameDir) {
  return allocateLifecycleRecoveryRoot(nameDir, ".install-");
}

function allocateLifecycleRecoveryRoot(parent, prefix) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = _deps.randomToken();
    if (!/^[a-f0-9]{32}$/u.test(token)) {
      throw new Error(
        "PLUGIN_TRANSACTION_TOKEN_INVALID: transaction root token is invalid",
      );
    }
    const transactionRoot = path.join(parent, `${prefix}${token}`);
    if (!_deps.existsSync(transactionRoot)) return transactionRoot;
  }
  throw new Error(
    "PLUGIN_TRANSACTION_PATH_CONFLICT: could not reserve a transaction root",
  );
}

function assertLifecycleRecoveryRoot(recoveryRoot, parent, basenamePattern) {
  if (
    path.dirname(recoveryRoot) !== parent ||
    !basenamePattern.test(path.basename(recoveryRoot))
  ) {
    throw new Error("PLUGIN_TRANSACTION_PATH_INVALID: invalid recovery root");
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function fsyncRegularFile(file) {
  let descriptor = null;
  try {
    // Windows rejects FlushFileBuffers for a read-only handle with EPERM. On
    // POSIX, retain a read-only open so immutable source modes remain valid.
    descriptor = _deps.openSync(
      file,
      process.platform === "win32" ? "r+" : "r",
    );
    _deps.fsyncSync(descriptor);
  } finally {
    if (descriptor != null) _deps.closeSync(descriptor);
  }
}

function fsyncDirectoryBestEffort(directory) {
  let descriptor = null;
  try {
    descriptor = _deps.openSync(directory, "r");
    _deps.fsyncSync(descriptor);
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    ) {
      return false;
    }
    throw error;
  } finally {
    if (descriptor != null) _deps.closeSync(descriptor);
  }
}

function fsyncPluginTree(root) {
  for (const entry of _deps.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `staged plugin contains an unsafe symlink: ${entry.name}`,
      );
    }
    if (entry.isDirectory()) {
      fsyncPluginTree(target);
    } else if (entry.isFile()) {
      fsyncRegularFile(target);
    } else {
      throw new Error(
        `staged plugin contains an unsupported file type: ${entry.name}`,
      );
    }
  }
  fsyncDirectoryBestEffort(root);
}

function writeDurableFileAtomic(directory, target, value) {
  const temporaryRoot = _deps.mkdtempSync(path.join(directory, ".durable-"));
  const temporary = path.join(temporaryRoot, "next");
  try {
    _deps.writeFileSync(temporary, value, "utf8");
    fsyncRegularFile(temporary);
    _deps.renameSync(temporary, target);
    fsyncDirectoryBestEffort(directory);
  } finally {
    _deps.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

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

function runWithPluginLifecycleLock(name, opts, body) {
  const scope = opts.scope || "user";
  const cwd = opts.cwd;
  assertSafePluginNameDirectory(name, { scope, cwd });
  const targetNameDir = pluginNameDir(scope, name, { cwd });
  const nameDir = pluginLifecycleCoordinatorDir(name);
  const retainedOwnedLock = ownedPluginLifecycleLocks.get(
    path.resolve(nameDir),
  );
  if (
    opts.allowRetainedRecovery !== true &&
    (retainedOwnedLock ||
      !_deps.existsSync(path.join(nameDir, PLUGIN_TRANSACTION_LOCK_DIRNAME)))
  ) {
    assertNoRetainedInstallRecovery(name, { scope, cwd });
  }
  if (retainedOwnedLock && opts.allowRetainedRecovery === true) {
    assertOwnedPluginLifecycleLock(retainedOwnedLock, name, { scope, cwd });
    const result = body(retainedOwnedLock);
    updatePluginTransactionJournal(retainedOwnedLock, {
      phase: "remediated",
      transaction: null,
    });
    const cleanup = releaseOwnedPluginLifecycleLock(retainedOwnedLock);
    retireEmptyPluginNameDirectory(nameDir);
    retireEmptyPluginNameDirectory(targetNameDir);
    if (
      result &&
      typeof result === "object" &&
      cleanup.cleanupPending === true
    ) {
      Object.assign(result, cleanup);
    }
    return result;
  }
  const lifecycleLock = acquirePluginTransactionLock({
    name,
    scope,
    nameDir,
    operation: opts.operation,
    contextDigest: pluginLifecycleContextDigest(name, { scope, cwd }),
  });
  lifecycleLock.targetNameDir = targetNameDir;
  ownedPluginLifecycleLocks.set(path.resolve(nameDir), lifecycleLock);
  let result;
  try {
    result = body(lifecycleLock);
  } catch (error) {
    const retainedKind = lifecycleLock.journal.transaction?.kind;
    const retainedRecovery =
      retainedKind === "enabled-state" ||
      retainedKind === "provenance-migration" ||
      retainedKind === "uninstall-version" ||
      retainedKind === "uninstall-name" ||
      hasRetainedLifecycleRecovery(targetNameDir);
    try {
      updatePluginTransactionJournal(lifecycleLock, {
        phase: retainedRecovery ? "recovery-required" : "aborted",
      });
      if (!retainedRecovery) releaseOwnedPluginLifecycleLock(lifecycleLock);
    } catch (lockError) {
      throw new Error(
        `${error.message}; plugin transaction lock cleanup failed: ${lockError.message}`,
        { cause: error },
      );
    }
    throw error;
  }

  const transaction =
    result && typeof result === "object"
      ? pendingPluginTransactions.get(result)
      : null;
  if (transaction) {
    if (transaction.lifecycleLock !== lifecycleLock) {
      throw new Error(
        "PLUGIN_TRANSACTION_LOCK_SCOPE_MISMATCH: pending transaction did not retain its lifecycle owner",
      );
    }
    return result;
  }

  updatePluginTransactionJournal(lifecycleLock, { phase: "completed" });
  const cleanup = releaseOwnedPluginLifecycleLock(lifecycleLock);
  retireEmptyPluginNameDirectory(nameDir);
  retireEmptyPluginNameDirectory(targetNameDir);
  if (result && typeof result === "object" && cleanup.cleanupPending === true) {
    Object.assign(result, cleanup);
  }
  return result;
}

function assertOwnedPluginLifecycleLock(lock, name, opts = {}) {
  return assertPluginTransactionLock(lock, {
    name,
    scope: opts.scope || "user",
    nameDir: pluginLifecycleCoordinatorDir(name),
    contextDigest: pluginLifecycleContextDigest(name, opts),
  });
}

function pluginLifecycleContextDigest(name, opts = {}) {
  const scope = opts.scope || "user";
  let target = path.resolve(pluginNameDir(scope, name, { cwd: opts.cwd }));
  if (process.platform === "win32") target = target.toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${scope}\0${target}`)
    .digest("hex");
}

function releaseOwnedPluginLifecycleLock(lock) {
  const cleanup = releasePluginTransactionLock(lock);
  const key = path.resolve(lock.nameDir);
  const retained = ownedPluginLifecycleLocks.get(key);
  if (
    retained === lock ||
    (retained?.owner?.token && retained.owner.token === lock.owner?.token)
  ) {
    ownedPluginLifecycleLocks.delete(key);
  }
  return cleanup;
}

function retireEmptyPluginNameDirectory(nameDir) {
  try {
    if (_deps.readdirSync(nameDir).length === 0) {
      _deps.rmSync(nameDir, { recursive: true, force: true });
    }
  } catch {
    // Empty parent cleanup does not carry plugin authority.
  }
}

function persistPluginLifecycleTransaction(transaction, phase) {
  if (!transaction?.lifecycleLock) {
    throw new Error(
      "PLUGIN_TRANSACTION_LOCK_REQUIRED: durable plugin transaction owner is missing",
    );
  }
  _deps.beforeTransactionPhaseHook?.(transaction, phase);
  const journal = updatePluginTransactionJournal(transaction.lifecycleLock, {
    phase,
    transaction: serializePluginLifecycleTransaction(transaction),
  });
  _deps.transactionPhaseHook?.(transaction, phase, journal);
  return journal;
}

function serializePluginLifecycleTransaction(transaction) {
  if (transaction.kind === "enabled-state") {
    return {
      kind: "enabled-state",
      enabled: transaction.enabled === true,
      previousMarkerState: serializeLifecycleFileState(
        transaction.previousMarkerState,
      ),
      desiredMarkerState: serializeLifecycleFileState(
        transaction.desiredMarkerState,
      ),
      ownedMarkerState: serializeLifecycleFileState(
        transaction.ownedMarkerState,
      ),
    };
  }
  if (transaction.kind === "provenance-migration") {
    return {
      kind: "provenance-migration",
      version: transaction.version,
      previousMetadataState: serializeLifecycleFileState(
        transaction.previousMetadataState,
      ),
      desiredMetadataState: serializeLifecycleFileState(
        transaction.desiredMetadataState,
      ),
      ownedMetadataGeneration: cloneLifecycleState(
        transaction.ownedMetadataState?.generation,
      ),
    };
  }
  if (transaction.kind === "uninstall-version") {
    assertLifecycleRecoveryRoot(
      transaction.transactionRoot,
      pluginNameDir(transaction.scope, transaction.name, {
        cwd: transaction.cwd,
      }),
      /^\.uninstall-[a-f0-9]{32}$/u,
    );
    return {
      kind: "uninstall-version",
      version: transaction.version,
      transactionRootName: path.basename(transaction.transactionRoot),
      removedWasActive: transaction.removedWasActive === true,
      removeNameAfterFinalize: transaction.removeNameAfterFinalize === true,
      previousActiveState: serializePointerState(
        transaction.previousActiveState,
      ),
      desiredActiveState: serializePointerState(transaction.desiredActiveState),
      ownedActivePointerState: serializePointerState(
        transaction.ownedActivePointerState,
      ),
      removedVersionState: cloneLifecycleState(transaction.removedVersionState),
      previousMarkerState: serializeLifecycleFileState(
        transaction.previousMarkerState,
      ),
      desiredMarkerState: serializeLifecycleFileState(
        transaction.desiredMarkerState,
      ),
      ownedMarkerState: serializeLifecycleFileState(
        transaction.ownedMarkerState,
      ),
    };
  }
  if (transaction.kind === "uninstall-name") {
    const expectedPrefix = `.uninstall-${encodeName(transaction.name)}-`;
    assertLifecycleRecoveryRoot(
      transaction.transactionRoot,
      path.dirname(
        pluginNameDir(transaction.scope, transaction.name, {
          cwd: transaction.cwd,
        }),
      ),
      new RegExp(`^${escapeRegExp(expectedPrefix)}[a-f0-9]{32}$`, "u"),
    );
    return {
      kind: "uninstall-name",
      transactionRootName: path.basename(transaction.transactionRoot),
      versions: [...transaction.versions],
      previousNameState: serializePluginNameState(
        transaction.previousNameState,
      ),
    };
  }
  const transactionRootName = path.basename(transaction.transactionRoot || "");
  if (
    !transactionRootName.startsWith(".install-") ||
    path.dirname(transaction.transactionRoot) !==
      pluginNameDir(transaction.scope, transaction.name, {
        cwd: transaction.cwd,
      })
  ) {
    throw new Error("PLUGIN_TRANSACTION_PATH_INVALID: invalid recovery root");
  }
  return {
    kind: "install",
    version: transaction.version,
    transactionRootName,
    hasBackup: Boolean(transaction.backup),
    pointerOnly: transaction.pointerOnly === true,
    previousActive: transaction.previousActive || null,
    previousActiveState: serializePointerState(transaction.previousActiveState),
    ownedActivePointerState: serializePointerState(
      transaction.ownedActivePointerState,
    ),
    previousInstalledVersionState: cloneLifecycleState(
      transaction.previousInstalledVersionState,
    ),
    previousDestinationState: cloneLifecycleState(
      transaction.previousDestinationState,
    ),
    installedVersionState: cloneLifecycleState(
      transaction.installedVersionState,
    ),
    rollbackPhase: transaction.rollbackPhase || null,
    quarantinedActivePointer: transaction.quarantinedActivePointer != null,
  };
}

function serializePointerState(state) {
  return serializeLifecycleFileState(state);
}

function serializeLifecycleFileState(state) {
  if (!state) return null;
  return {
    present: state.present === true,
    bytesBase64: Buffer.isBuffer(state.bytes)
      ? state.bytes.toString("base64")
      : null,
    version: state.version || null,
    generation: cloneLifecycleState(state.generation),
  };
}

function deserializePluginLifecycleTransaction(
  name,
  { scope, cwd },
  lifecycleLock,
  value,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: transaction is invalid",
    );
  }
  if (value.kind != null && value.kind !== "install") {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: install transaction kind is invalid",
    );
  }
  const version = String(value.version || "");
  if (!semver.valid(version)) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: transaction version is invalid",
    );
  }
  const transactionRootName = String(value.transactionRootName || "");
  if (
    !/^\.install-[a-zA-Z0-9._-]+$/u.test(transactionRootName) ||
    transactionRootName === ".install-." ||
    transactionRootName === ".install-.."
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: recovery root identity is invalid",
    );
  }
  const nameDir = pluginNameDir(scope, name, { cwd });
  const transactionRoot = path.join(nameDir, transactionRootName);
  const previousActiveState = deserializePointerState(
    value.previousActiveState,
  );
  if (!previousActiveState) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: previous pointer snapshot is missing",
    );
  }
  const transaction = {
    name,
    version,
    scope,
    cwd,
    dest: pluginVersionDir(scope, name, version, { cwd }),
    backup: value.hasBackup ? path.join(transactionRoot, "previous") : null,
    transactionRoot,
    previousActive: value.previousActive || null,
    previousActiveState,
    previousInstalledVersionState: cloneLifecycleState(
      value.previousInstalledVersionState,
    ),
    previousDestinationState: cloneLifecycleState(
      value.previousDestinationState,
    ),
    ownedActivePointerState: deserializePointerState(
      value.ownedActivePointerState,
    ),
    installedVersionState: cloneLifecycleState(value.installedVersionState),
    pointerOnly: value.pointerOnly === true,
    rollbackPhase: value.rollbackPhase || null,
    lifecycleLock,
  };
  if (value.quarantinedActivePointer === true) {
    transaction.quarantinedActivePointer = path.join(
      transactionRoot,
      "candidate-active",
    );
  }
  return transaction;
}

function deserializePluginEnabledStateTransaction(
  name,
  { scope, cwd },
  lifecycleLock,
  value,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "enabled-state" ||
    typeof value.enabled !== "boolean"
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: enabled-state transaction is invalid",
    );
  }
  const previousMarkerState = deserializeLifecycleFileState(
    value.previousMarkerState,
    4096,
    "disabled marker",
  );
  const desiredMarkerState = deserializeLifecycleFileState(
    value.desiredMarkerState,
    4096,
    "disabled marker",
  );
  if (
    !previousMarkerState ||
    !desiredMarkerState ||
    desiredMarkerState.present === value.enabled
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: disabled marker intent is invalid",
    );
  }
  const nameDir = pluginNameDir(scope, name, { cwd });
  return {
    kind: "enabled-state",
    name,
    scope,
    cwd,
    enabled: value.enabled,
    nameDir,
    marker: path.join(nameDir, DISABLED_FILENAME),
    previousMarkerState,
    desiredMarkerState,
    ownedMarkerState: deserializeLifecycleFileState(
      value.ownedMarkerState,
      4096,
      "disabled marker",
    ),
    lifecycleLock,
  };
}

function deserializePluginProvenanceMigrationTransaction(
  name,
  { scope, cwd },
  lifecycleLock,
  value,
) {
  const version = String(value?.version || "");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "provenance-migration" ||
    !semver.valid(version)
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: provenance migration transaction is invalid",
    );
  }
  const previousMetadataState = deserializeLifecycleFileState(
    value.previousMetadataState,
    MAX_PROVENANCE_METADATA_BYTES,
    "plugin source metadata",
  );
  const desiredMetadataState = deserializeLifecycleFileState(
    value.desiredMetadataState,
    MAX_PROVENANCE_METADATA_BYTES,
    "plugin source metadata",
  );
  if (
    !previousMetadataState ||
    previousMetadataState.present ||
    !desiredMetadataState?.present
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: provenance migration file intent is invalid",
    );
  }
  const root = pluginVersionDir(scope, name, version, { cwd });
  return {
    kind: "provenance-migration",
    name,
    version,
    scope,
    cwd,
    root,
    marker: path.join(root, SOURCE_METADATA_FILENAME),
    previousMetadataState,
    desiredMetadataState,
    ownedMetadataState: value.ownedMetadataGeneration
      ? {
          present: true,
          bytes: desiredMetadataState.bytes,
          generation: cloneLifecycleState(value.ownedMetadataGeneration),
        }
      : null,
    lifecycleLock,
  };
}

function deserializePluginUninstallTransaction(
  name,
  { scope, cwd },
  lifecycleLock,
  value,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: uninstall transaction is invalid",
    );
  }
  const nameDir = pluginNameDir(scope, name, { cwd });
  const transactionRootName = String(value.transactionRootName || "");
  if (value.kind === "uninstall-version") {
    const version = String(value.version || "");
    if (
      !semver.valid(version) ||
      !/^\.uninstall-[a-f0-9]{32}$/u.test(transactionRootName)
    ) {
      throw new Error(
        "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: version uninstall identity is invalid",
      );
    }
    const previousActiveState = deserializePointerState(
      value.previousActiveState,
    );
    const desiredActiveState = deserializePointerState(
      value.desiredActiveState,
    );
    const previousMarkerState = deserializeLifecycleFileState(
      value.previousMarkerState,
      4096,
      "disabled marker",
    );
    const desiredMarkerState = deserializeLifecycleFileState(
      value.desiredMarkerState,
      4096,
      "disabled marker",
    );
    if (
      !previousActiveState ||
      !desiredActiveState ||
      !previousMarkerState ||
      !desiredMarkerState ||
      !value.removedVersionState ||
      typeof value.removedVersionState !== "object"
    ) {
      throw new Error(
        "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: version uninstall state is incomplete",
      );
    }
    const transactionRoot = path.join(nameDir, transactionRootName);
    return {
      kind: "uninstall-version",
      name,
      version,
      scope,
      cwd,
      nameDir,
      dest: pluginVersionDir(scope, name, version, { cwd }),
      transactionRoot,
      quarantined: path.join(transactionRoot, version),
      removedWasActive: value.removedWasActive === true,
      removeNameAfterFinalize: value.removeNameAfterFinalize === true,
      previousActiveState,
      desiredActiveState,
      ownedActivePointerState: deserializePointerState(
        value.ownedActivePointerState,
      ),
      removedVersionState: cloneLifecycleState(value.removedVersionState),
      previousMarkerState,
      desiredMarkerState,
      ownedMarkerState: deserializeLifecycleFileState(
        value.ownedMarkerState,
        4096,
        "disabled marker",
      ),
      lifecycleLock,
    };
  }
  if (value.kind === "uninstall-name") {
    const prefix = `.uninstall-${encodeName(name)}-`;
    if (
      !new RegExp(`^${escapeRegExp(prefix)}[a-f0-9]{32}$`, "u").test(
        transactionRootName,
      ) ||
      !Array.isArray(value.versions) ||
      value.versions.length > MAX_LISTED_PLUGIN_VERSIONS ||
      value.versions.some((version) => !semver.valid(String(version))) ||
      new Set(value.versions).size !== value.versions.length ||
      !value.previousNameState ||
      typeof value.previousNameState !== "object"
    ) {
      throw new Error(
        "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: whole-name uninstall state is invalid",
      );
    }
    return {
      kind: "uninstall-name",
      name,
      scope,
      cwd,
      nameDir,
      transactionRoot: path.join(path.dirname(nameDir), transactionRootName),
      versions: value.versions.map(String),
      previousNameState: cloneLifecycleState(value.previousNameState),
      lifecycleLock,
    };
  }
  throw new Error(
    "PLUGIN_TRANSACTION_JOURNAL_CORRUPT: uninstall transaction kind is invalid",
  );
}

function deserializePointerState(value) {
  return deserializeLifecycleFileState(value, 256, "pointer");
}

function deserializeLifecycleFileState(value, maxBytes, label) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `PLUGIN_TRANSACTION_JOURNAL_CORRUPT: ${label} snapshot is invalid`,
    );
  }
  const present = value.present === true;
  let bytes = null;
  if (present) {
    if (
      typeof value.bytesBase64 !== "string" ||
      !/^[a-zA-Z0-9+/]*={0,2}$/u.test(value.bytesBase64)
    ) {
      throw new Error(
        `PLUGIN_TRANSACTION_JOURNAL_CORRUPT: ${label} bytes are invalid`,
      );
    }
    bytes = Buffer.from(value.bytesBase64, "base64");
    if (
      bytes.length > maxBytes ||
      bytes.toString("base64") !== value.bytesBase64
    ) {
      throw new Error(
        `PLUGIN_TRANSACTION_JOURNAL_CORRUPT: ${label} bytes are non-canonical`,
      );
    }
  }
  return {
    present,
    bytes,
    version: value.version || null,
    generation: cloneLifecycleState(value.generation),
  };
}

function adoptCrashWindowPointerAuthority(transaction) {
  if (transaction.ownedActivePointerState) return;
  const current = captureActivePointerState(transaction.name, transaction);
  if (samePointerState(current, transaction.previousActiveState)) return;
  if (!transaction.installedVersionState) {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: candidate state was not durably recorded",
    );
  }
  assertInstalledRootStateMatches(
    transaction.dest,
    transaction.name,
    transaction.version,
    transaction.installedVersionState,
    "candidate bytes changed during activation crash window",
  );
  const expected = Buffer.from(transaction.version, "utf8");
  if (
    current.present !== true ||
    !Buffer.isBuffer(current.bytes) ||
    !current.bytes.equals(expected)
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: active pointer changed outside the recorded transaction",
    );
  }
  transaction.ownedActivePointerState = current;
  persistPluginLifecycleTransaction(transaction, "candidate-active-recovered");
}

function rollbackPreparedPluginTransaction(transaction) {
  const current = captureActivePointerState(transaction.name, transaction);
  if (!samePointerState(current, transaction.previousActiveState)) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: previous active pointer changed during prepared recovery",
    );
  }
  if (!_deps.existsSync(transaction.transactionRoot)) {
    if (transaction.lifecycleLock.journal.phase !== "staging") {
      throw new Error(
        "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: recovery root is missing",
      );
    }
    assertStagingDestinationUnchanged(transaction);
  } else if (!transaction.pointerOnly) {
    rollbackPreparedInstalledBytes(transaction);
  }
  persistPluginLifecycleTransaction(transaction, "rolled-back");
  const cleanup = retireCommittedTransactionRoot(transaction.transactionRoot);
  if (authoritativeTransactionCleanupPending(cleanup)) {
    persistPluginLifecycleTransaction(
      transaction,
      "rollback-recovery-required",
    );
    return {
      recovered: false,
      action: "rollback",
      recoveryRequired: true,
      ...cleanup,
    };
  }
  const lockCleanup = releaseOwnedPluginLifecycleLock(
    transaction.lifecycleLock,
  );
  return {
    recovered: true,
    action: "rollback",
    rolledBack: true,
    version: transaction.previousActive || null,
    ...mergeLifecycleCleanup(cleanup, lockCleanup),
  };
}

function assertStagingDestinationUnchanged(transaction) {
  const destExists = _deps.existsSync(transaction.dest);
  if (!transaction.previousDestinationState) {
    if (destExists) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: destination appeared during staging recovery",
      );
    }
    return;
  }
  if (!destExists) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: predecessor disappeared during staging recovery",
    );
  }
  assertInstalledRootStateMatches(
    transaction.dest,
    transaction.name,
    transaction.version,
    transaction.previousDestinationState,
    "predecessor bytes changed during staging recovery",
  );
}

function rollbackPreparedInstalledBytes(transaction) {
  const destExists = _deps.existsSync(transaction.dest);
  const rejected = path.join(transaction.transactionRoot, "rejected");
  const rejectedExists = _deps.existsSync(rejected);
  const backupExists = transaction.backup
    ? _deps.existsSync(transaction.backup)
    : false;

  if (!transaction.backup) {
    if (destExists && rejectedExists) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: prepared candidate topology is ambiguous",
      );
    }
    if (destExists) {
      assertInstalledRootStateMatches(
        transaction.dest,
        transaction.name,
        transaction.version,
        transaction.installedVersionState,
        "prepared candidate bytes changed",
      );
      _deps.renameSync(transaction.dest, rejected);
      fsyncDirectoryBestEffort(path.dirname(transaction.dest));
      fsyncDirectoryBestEffort(transaction.transactionRoot);
    } else if (rejectedExists) {
      assertInstalledRootStateMatches(
        rejected,
        transaction.name,
        transaction.version,
        transaction.installedVersionState,
        "rejected candidate bytes changed",
      );
    }
    return;
  }

  if (backupExists) {
    assertInstalledRootStateMatches(
      transaction.backup,
      transaction.name,
      transaction.version,
      transaction.previousDestinationState,
      "prepared predecessor bytes changed",
    );
    if (destExists && rejectedExists) {
      throw new Error(
        "PLUGIN_TRANSACTION_STALE: prepared replacement topology is ambiguous",
      );
    }
    if (destExists) {
      assertInstalledRootStateMatches(
        transaction.dest,
        transaction.name,
        transaction.version,
        transaction.installedVersionState,
        "prepared replacement candidate changed",
      );
      restoreInstalledBytes(transaction);
    } else if (rejectedExists) {
      assertInstalledRootStateMatches(
        rejected,
        transaction.name,
        transaction.version,
        transaction.installedVersionState,
        "prepared rejected candidate changed",
      );
      _deps.renameSync(transaction.backup, transaction.dest);
      fsyncDirectoryBestEffort(transaction.transactionRoot);
      fsyncDirectoryBestEffort(path.dirname(transaction.dest));
    } else {
      _deps.renameSync(transaction.backup, transaction.dest);
      fsyncDirectoryBestEffort(transaction.transactionRoot);
      fsyncDirectoryBestEffort(path.dirname(transaction.dest));
    }
    return;
  }

  if (!destExists) {
    throw new Error(
      "PLUGIN_TRANSACTION_RECOVERY_INCOMPLETE: predecessor bytes are missing",
    );
  }
  assertInstalledRootStateMatches(
    transaction.dest,
    transaction.name,
    transaction.version,
    transaction.previousDestinationState,
    "restored predecessor bytes changed",
  );
  if (rejectedExists) {
    assertInstalledRootStateMatches(
      rejected,
      transaction.name,
      transaction.version,
      transaction.installedVersionState,
      "restored rejected candidate changed",
    );
  }
}

function samePointerState(left, right) {
  if (!left || !right || left.present !== right.present) return false;
  if (!left.present) return true;
  return Boolean(
    Buffer.isBuffer(left.bytes) &&
    Buffer.isBuffer(right.bytes) &&
    left.bytes.equals(right.bytes) &&
    sameFileGeneration(left.generation, right.generation),
  );
}

function captureDisabledMarkerState(name, opts = {}) {
  const nameDir = pluginNameDir(opts.scope || "user", name, { cwd: opts.cwd });
  return captureLifecycleFileState(
    path.join(nameDir, DISABLED_FILENAME),
    4096,
    "DISABLED_MARKER_UNSAFE",
  );
}

function captureLifecycleFileState(file, maxBytes, unsafeCode) {
  let stat;
  try {
    stat = _deps.lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { present: false, bytes: null, generation: null };
    }
    throw error;
  }
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) {
    throw new Error(unsafeCode);
  }
  return {
    present: true,
    bytes: Buffer.from(_deps.readFileSync(file)),
    generation: fileGeneration(stat),
  };
}

function sameLifecycleFileState(left, right) {
  if (!left || !right || left.present !== right.present) return false;
  if (!left.present) return true;
  return Boolean(
    Buffer.isBuffer(left.bytes) &&
    Buffer.isBuffer(right.bytes) &&
    left.bytes.equals(right.bytes) &&
    sameFileGeneration(left.generation, right.generation),
  );
}

function capturePluginNameState(name, { scope, cwd, versions }) {
  const root = pluginNameDir(scope, name, { cwd });
  const currentVersions = listInstalledVersions(scope, name, { cwd });
  if (
    currentVersions.length !== versions.length ||
    currentVersions.some((version, index) => version !== versions[index])
  ) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: installed versions changed before whole-name snapshot",
    );
  }
  return capturePluginNameRootState(root);
}

function capturePluginNameRootState(root) {
  const stat = _deps.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("PLUGIN_NAME_DIRECTORY_UNSAFE");
  }
  for (const forbidden of PLUGIN_MARKETPLACE_STAGED_SOURCE_EXCLUSIONS) {
    if (_deps.existsSync(path.join(root, forbidden))) {
      throw new Error(
        `PLUGIN_NAME_DIRECTORY_UNSAFE: unexpected root authority ${forbidden}`,
      );
    }
  }
  const payload = buildMarketplacePayloadSbom(root, {
    schemaVersion: PLUGIN_MARKETPLACE_CANONICAL_PAYLOAD_SBOM_SCHEMA,
  });
  return {
    generation: fileGeneration(stat),
    payloadDigest: payload.digest,
    fileCount: payload.fileCount,
    totalBytes: payload.totalBytes,
  };
}

function serializePluginNameState(state) {
  return cloneLifecycleState(state);
}

function samePluginNameState(left, right) {
  return Boolean(
    left &&
    right &&
    sameFileGeneration(left.generation, right.generation) &&
    left.payloadDigest === right.payloadDigest &&
    left.fileCount === right.fileCount &&
    left.totalBytes === right.totalBytes,
  );
}

function assertPluginNameStateMatches(root, _name, expected, reason) {
  let actual;
  try {
    actual = capturePluginNameRootState(root);
  } catch (error) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${error.message}`, {
      cause: error,
    });
  }
  if (!samePluginNameState(actual, expected)) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${reason}`);
  }
}

function lifecycleFileContentMatches(left, right) {
  if (!left || !right || left.present !== right.present) return false;
  if (!left.present) return true;
  return Boolean(
    Buffer.isBuffer(left.bytes) &&
    Buffer.isBuffer(right.bytes) &&
    left.bytes.equals(right.bytes),
  );
}

function assertLifecycleFileContent(actual, expected, reason) {
  if (!lifecycleFileContentMatches(actual, expected)) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${reason}`);
  }
}

function assertDisabledMarkerStateUnchanged(transaction, expected) {
  const current = captureDisabledMarkerState(transaction.name, transaction);
  if (!sameLifecycleFileState(current, expected)) {
    throw new Error(
      "PLUGIN_TRANSACTION_STALE: disabled marker changed before lifecycle publication",
    );
  }
}

function assertLifecycleFileStateAtPath(file, expected, maxBytes, reason) {
  const current = captureLifecycleFileState(
    file,
    maxBytes,
    "PLUGIN_LIFECYCLE_FILE_UNSAFE",
  );
  if (!sameLifecycleFileState(current, expected)) {
    throw new Error(`PLUGIN_TRANSACTION_STALE: ${reason}`);
  }
}

function writeDisabledMarkerState(marker, nameDir, state) {
  writeLifecycleFileState(marker, nameDir, state);
}

function writeLifecycleFileState(marker, nameDir, state) {
  if (state.present === true) {
    writeDurableFileAtomic(nameDir, marker, state.bytes);
    return;
  }
  _deps.rmSync(marker, { force: true });
  fsyncDirectoryBestEffort(nameDir);
}

function cloneLifecycleState(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function hasRetainedLifecycleRecovery(nameDir) {
  try {
    return _deps
      .readdirSync(nameDir, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith(".install-") ||
            entry.name.startsWith(".uninstall-")),
      );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return true;
  }
}

function authoritativeTransactionCleanupPending(cleanup) {
  return Boolean(
    cleanup?.cleanupPending === true &&
    /^\.(?:install|uninstall)-/u.test(path.basename(cleanup.cleanupPath || "")),
  );
}

function mergeLifecycleCleanup(primary, secondary) {
  if (primary?.cleanupPending === true) return primary;
  if (secondary?.cleanupPending === true) {
    return {
      cleanupPending: true,
      cleanupPath: secondary.cleanupPath,
    };
  }
  return { cleanupPending: false };
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

function adoptRollbackPointerQuarantine(transaction) {
  if (transaction.quarantinedActivePointer) return;
  const activeFile = path.join(
    pluginNameDir(transaction.scope, transaction.name, {
      cwd: transaction.cwd,
    }),
    ".active",
  );
  if (_deps.existsSync(activeFile)) return;
  const retained = path.join(transaction.transactionRoot, "candidate-active");
  if (!_deps.existsSync(retained)) return;
  const retainedState = capturePointerFileState(retained);
  assertOwnedPointerState(retainedState, transaction);
  transaction.quarantinedActivePointer = retained;
  persistPluginLifecycleTransaction(
    transaction,
    "rollback-pointer-quarantined-recovered",
  );
}

function activePointerMatchesSnapshot(transaction) {
  const current = captureActivePointerState(transaction.name, transaction);
  const snapshot = transaction.previousActiveState;
  if (!snapshot || current.present !== snapshot.present) return false;
  if (!snapshot.present) return true;
  return Boolean(
    Buffer.isBuffer(current.bytes) &&
    Buffer.isBuffer(snapshot.bytes) &&
    current.bytes.equals(snapshot.bytes),
  );
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
  fsyncDirectoryBestEffort(path.dirname(activeFile));
  fsyncDirectoryBestEffort(transaction.transactionRoot);
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
  assertTransactionOwnsRecoveryBytes(transaction);
}

function assertTransactionOwnsRecoveryBytes(transaction) {
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
  fsyncDirectoryBestEffort(
    pluginNameDir(opts.scope || "user", name, { cwd: opts.cwd }),
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
  fsyncDirectoryBestEffort(path.dirname(activeFile));
  fsyncDirectoryBestEffort(transactionRoot);
}

function restoreInstalledBytes({ dest, backup, transactionRoot }) {
  const rejected = path.join(transactionRoot, "rejected");
  const nameDir = path.dirname(dest);
  if (!backup) {
    const destExists = _deps.existsSync(dest);
    const rejectedExists = _deps.existsSync(rejected);
    if (destExists === rejectedExists) {
      throw new Error("plugin rollback candidate topology is ambiguous");
    }
    if (destExists) {
      _deps.renameSync(dest, rejected);
      fsyncDirectoryBestEffort(nameDir);
      fsyncDirectoryBestEffort(transactionRoot);
    }
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
  if (destExists) {
    _deps.renameSync(dest, rejected);
    fsyncDirectoryBestEffort(nameDir);
    fsyncDirectoryBestEffort(transactionRoot);
  }
  _deps.renameSync(backup, dest);
  fsyncDirectoryBestEffort(transactionRoot);
  fsyncDirectoryBestEffort(nameDir);
}
