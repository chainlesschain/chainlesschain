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
 * `.active` file. Missing, unreadable, or dangling pointers fail closed instead
 * of silently selecting another payload; legacy directories must be repaired
 * by a reviewed install/use flow.
 */

import fs from "fs";
import path from "path";
import semver from "semver";
import { getElectronUserDataDir } from "../paths.js";
import { parsePluginManifest } from "./manifest.js";
import {
  loadManagedPluginPolicy,
  filterByManagedPolicy,
  filterByCapabilityConsent,
  capabilityConsentRequired,
  capabilityDeclarationsRequired,
  warnDroppedOnce,
} from "./policy.js";

export const _deps = {
  existsSync: fs.existsSync,
  readdirSync: fs.readdirSync,
  readFileSync: fs.readFileSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
};

const MAX_ACTIVE_POINTER_BYTES = 256;

// Lowest → highest precedence.
export const SCOPES = ["user", "project", "local"];
export const DISABLED_FILENAME = ".disabled";
export const PLUGIN_LIFECYCLE_COORDINATOR_DIRNAME =
  "plugin-lifecycle-transactions";
const PLUGIN_TRANSACTION_LOCK_DIRNAME = ".plugin-transaction-lock";

/** Filesystem-safe encoding of a (possibly scoped, e.g. @org/name) plugin name. */
export function encodeName(name) {
  const encoded = String(name || "").replace(/[^a-zA-Z0-9._-]/g, "__");
  if (!encoded || encoded === "." || encoded === "..") {
    throw new Error(`invalid plugin name: ${String(name || "")}`);
  }
  return encoded;
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

/** Global same-user coordinator shared by every scope for one plugin name. */
export function pluginLifecycleCoordinatorDir(name, opts = {}) {
  return path.join(pluginLifecycleCoordinatorRoot(opts), encodeName(name));
}

/** Fixed global lock path used by runtime discovery to fence review state. */
export function pluginLifecycleCoordinatorLock(name, opts = {}) {
  return path.join(
    pluginLifecycleCoordinatorDir(name, opts),
    PLUGIN_TRANSACTION_LOCK_DIRNAME,
  );
}

function pluginLifecycleCoordinatorRoot(opts = {}) {
  const configured = String(
    (opts.env || process.env).CC_PLUGIN_TRANSACTION_HOME || "",
  ).trim();
  if (!configured) {
    return path.join(
      getElectronUserDataDir(),
      PLUGIN_LIFECYCLE_COORDINATOR_DIRNAME,
    );
  }
  if (!path.isAbsolute(configured)) {
    throw new Error("CC_PLUGIN_TRANSACTION_HOME must be an absolute path");
  }
  const resolved = path.resolve(configured);
  if (resolved === path.parse(resolved).root) {
    throw new Error("CC_PLUGIN_TRANSACTION_HOME must not be a filesystem root");
  }
  return resolved;
}

/** Immutable install dir for a specific plugin version. */
export function pluginVersionDir(scope, name, version, opts = {}) {
  const value = String(version || "");
  if (!semver.valid(value)) {
    throw new Error(`invalid plugin version: ${value}`);
  }
  return path.join(pluginNameDir(scope, name, opts), value);
}

/** Versions present on disk for a plugin, newest semver first. */
export function listInstalledVersions(scope, name, opts = {}) {
  const dir = pluginNameDir(scope, name, opts);
  if (!dirExists(dir)) return [];
  return listVersionsForDir(dir);
}

function listVersionsForDir(dir) {
  return _deps
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((v) => semver.valid(v))
    .sort(semver.rcompare);
}

/** Inspect pointer authority without silently selecting another payload. */
export function inspectActivePointer(scope, name, opts = {}) {
  return inspectActivePointerForDir(pluginNameDir(scope, name, opts), {
    strictIo: opts.strictIo === true,
  });
}

function inspectActivePointerForDir(nameDir, { strictIo = false } = {}) {
  if (!dirExists(nameDir, strictIo)) {
    return { status: "absent", version: null, versions: [] };
  }
  const versions = listVersionsForDir(nameDir);
  if (versions.length === 0) {
    return { status: "absent", version: null, versions };
  }
  const activeFile = path.join(nameDir, ".active");
  if (!_deps.existsSync(activeFile)) {
    return { status: "missing", version: null, versions };
  }
  let pinned;
  try {
    const stat = _deps.lstatSync(activeFile);
    if (!stat.isFile() || stat.size > MAX_ACTIVE_POINTER_BYTES) {
      return { status: "unsafe", version: null, versions };
    }
    pinned = _deps.readFileSync(activeFile, "utf8").trim();
  } catch (error) {
    if (strictIo) throw error;
    return {
      status: "unreadable",
      version: null,
      versions,
      errorCode: error?.code || null,
    };
  }
  if (!semver.valid(pinned)) {
    return { status: "corrupt", version: null, versions };
  }
  if (!versions.includes(pinned)) {
    return { status: "dangling", version: null, versions, pinned };
  }
  return { status: "valid", version: pinned, versions };
}

/** The active version for a plugin; invalid/missing authority fails closed. */
export function activeVersion(scope, name, opts = {}) {
  return inspectActivePointer(scope, name, opts).version;
}

/** Whether one scoped plugin install is eligible for runtime discovery. */
export function isPluginEnabled(scope, name, opts = {}) {
  return !_deps.existsSync(
    path.join(pluginNameDir(scope, name, opts), DISABLED_FILENAME),
  );
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
 * @param {object} [opts] { cwd, scopes?, skipPolicy?, includeDisabled?, env?, managedSettingsFile? }
 * @returns {Array<{scope, name, version, root, manifest, enabled}>}
 */
export function discoverPlugins(opts = {}) {
  // `cc agent --bare` (CC_PLUGINS=0): the plugin runtime is fully off. Every
  // component collector (hooks/monitors/MCP/LSP/bin/settings-env/skills/
  // agents) funnels through this discovery, so one gate disables them all.
  // Other processes (`cc plugin installed` …) don't inherit the agent's env,
  // so plugin management tooling is unaffected.
  const rawPlugins = (opts.env || process.env).CC_PLUGINS;
  if (
    rawPlugins != null &&
    /^(0|false|no|off)$/i.test(String(rawPlugins).trim())
  ) {
    return [];
  }
  const requestedScopes = new Set(opts.scopes || SCOPES);
  for (const requested of requestedScopes) {
    if (!SCOPES.includes(requested)) {
      throw new Error(`unknown plugin scope: ${requested}`);
    }
  }
  // A caller may select a subset, but cannot reverse canonical precedence.
  const scopes = SCOPES.filter((scope) => requestedScopes.has(scope));
  const byName = new Map(); // name → record (later scope overrides earlier)
  const nameByEncoded = new Map();
  for (const scope of scopes) {
    const root = scopeRoot(scope, opts);
    if (!dirExists(root, opts.strictIo === true)) continue;
    for (const encoded of listDirs(root, opts.strictIo === true)) {
      const nameDir = path.join(root, encoded);
      const lifecycleRecovery = findLifecycleCoordinatorRecovery(encoded, opts);
      const enabled = !_deps.existsSync(path.join(nameDir, DISABLED_FILENAME));
      if (!enabled && opts.includeDisabled !== true) continue;
      const pointer = inspectActivePointerForDir(nameDir, {
        strictIo: opts.strictIo === true,
      });
      const version = pointer.version;
      if (!version) {
        const recovery =
          findRecoveryInspection(nameDir, encoded) || lifecycleRecovery;
        const pointerStatus = recovery ? "recovery-required" : pointer.status;
        const reservesIdentity =
          pointer.versions.length > 0 || Boolean(recovery);
        if (!reservesIdentity) continue;
        // A broken higher-precedence install reserves its encoded identity.
        // Falling through would silently activate lower-scope bytes. Remove
        // only that name; unrelated plugins remain discoverable.
        const shadowedName = nameByEncoded.get(encoded);
        if (shadowedName) byName.delete(shadowedName);
        nameByEncoded.delete(encoded);
        opts.onBlocked?.({
          scope,
          encodedName: encoded,
          pointerStatus,
          versions: [...pointer.versions],
        });
        if (opts.includeBlocked === true && reservesIdentity) {
          const inspectionVersion = recovery?.version || pointer.versions[0];
          const inspectionRoot =
            recovery?.root ||
            (inspectionVersion
              ? path.join(nameDir, inspectionVersion)
              : recovery?.transactionRoot);
          const inspectionManifest =
            recovery?.manifest || parsePluginManifest(inspectionRoot);
          inspectionManifest.scope = scope;
          const inspectedName =
            inspectionManifest.ok === true &&
            encodeName(inspectionManifest.metadata?.name) === encoded
              ? inspectionManifest.metadata.name
              : shadowedName || encoded;
          nameByEncoded.set(encoded, inspectedName);
          byName.set(inspectedName, {
            scope,
            name: inspectedName,
            version: null,
            inspectionVersion,
            root: inspectionRoot,
            manifest: inspectionManifest,
            enabled,
            runtimeBlocked: true,
            pointerStatus,
            recoveryRoot: recovery?.root || recovery?.transactionRoot || null,
          });
        }
        continue;
      }
      const versionDir = path.join(nameDir, version);
      const manifest = parsePluginManifest(versionDir);
      if (opts.strictIo === true && manifest.ok !== true) {
        throw new Error(
          `plugin manifest is not safely loadable at ${versionDir}: ${
            manifest.errors?.join("; ") || "unknown manifest error"
          }`,
        );
      }
      const manifestName = manifest.metadata?.name || null;
      if (manifest.ok !== true || encodeName(manifestName) !== encoded) {
        const shadowedName = nameByEncoded.get(encoded);
        if (shadowedName) byName.delete(shadowedName);
        nameByEncoded.delete(encoded);
        const pointerStatus =
          manifest.ok === true ? "identity-mismatch" : "manifest-invalid";
        opts.onBlocked?.({
          scope,
          encodedName: encoded,
          pointerStatus,
          versions: [...pointer.versions],
        });
        if (opts.includeBlocked === true) {
          const inspectedName = shadowedName || encoded;
          nameByEncoded.set(encoded, inspectedName);
          byName.set(inspectedName, {
            scope,
            name: inspectedName,
            version: null,
            inspectionVersion: version,
            root: versionDir,
            manifest,
            enabled,
            runtimeBlocked: true,
            pointerStatus,
          });
        }
        continue;
      }
      manifest.scope = scope;
      const name = manifestName;
      const retainedRecovery =
        findRecoveryInspection(nameDir, encoded) || lifecycleRecovery;
      const priorForEncoded = nameByEncoded.get(encoded);
      if (priorForEncoded && priorForEncoded !== name) {
        byName.delete(priorForEncoded);
      }
      nameByEncoded.set(encoded, name);
      if (retainedRecovery && opts.allowRetainedInstall !== true) {
        if (priorForEncoded) byName.delete(priorForEncoded);
        opts.onBlocked?.({
          scope,
          encodedName: encoded,
          pointerStatus: "recovery-required",
          versions: [...pointer.versions],
        });
        if (opts.includeBlocked === true) {
          byName.set(name, {
            scope,
            name,
            version: null,
            inspectionVersion: version,
            root: versionDir,
            manifest,
            enabled,
            runtimeBlocked: true,
            pointerStatus: "recovery-required",
            recoveryRoot:
              retainedRecovery.root || retainedRecovery.transactionRoot,
          });
        }
        continue;
      }
      byName.set(name, {
        scope,
        name,
        version: manifest.metadata?.version || version,
        root: versionDir,
        manifest,
        enabled,
        runtimeBlocked: false,
        pointerStatus: "valid",
        recoveryRoot:
          retainedRecovery?.root || retainedRecovery?.transactionRoot || null,
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
  const consentGate = capabilityConsentRequired(managed, opts.env);
  const declarationsGate = capabilityDeclarationsRequired(managed, opts.env);
  // Default (no managed policy AND consent enforcement off): byte-identical —
  // return every discovered plugin, exactly as before.
  if (!managed && !consentGate && !declarationsGate) return all;
  let list = all;
  if (managed) {
    const { kept, dropped } = filterByManagedPolicy(list, managed);
    if (dropped.length > 0) warnDroppedOnce(dropped);
    list = kept;
  }
  // Capability-consent enforcement funnels through the SAME chokepoint, so an
  // un-consented plugin loads NONE of its six component types (opt-in).
  if (consentGate || declarationsGate) {
    const { kept, dropped } = filterByCapabilityConsent(list, {
      requireDeclarations: declarationsGate,
    });
    if (dropped.length > 0) warnDroppedOnce(dropped);
    list = kept;
  }
  return list;
}

// ── internals ────────────────────────────────────────────────────────────

function dirExists(dir, strictIo = false) {
  try {
    return _deps.existsSync(dir) && _deps.statSync(dir).isDirectory();
  } catch (error) {
    if (strictIo) throw error;
    return false;
  }
}

function findRecoveryInspection(nameDir, encodedName) {
  let entries;
  try {
    entries = _deps
      .readdirSync(nameDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith(".install-") ||
            entry.name.startsWith(".uninstall-") ||
            entry.name === ".plugin-transaction-lock"),
      )
      .sort((left, right) => {
        if (left.name === ".plugin-transaction-lock") return 1;
        if (right.name === ".plugin-transaction-lock") return -1;
        return right.name.localeCompare(left.name);
      });
  } catch {
    return null;
  }

  let fallback = null;
  for (const entry of entries.slice(0, 64)) {
    const transactionRoot = path.join(nameDir, entry.name);
    try {
      const transactionStat = _deps.lstatSync(transactionRoot);
      if (transactionStat.isSymbolicLink() || !transactionStat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    if (!fallback) {
      fallback = {
        root: null,
        version: null,
        manifest: null,
        transactionRoot,
      };
    }
    let recoveryChildren = ["previous", "rejected", "staged"];
    if (entry.name.startsWith(".uninstall-")) {
      try {
        recoveryChildren = _deps
          .readdirSync(transactionRoot, { withFileTypes: true })
          .filter((child) => child.isDirectory() && semver.valid(child.name))
          .map((child) => child.name)
          .sort(semver.rcompare);
      } catch {
        recoveryChildren = [];
      }
    }
    for (const child of recoveryChildren) {
      const root = path.join(transactionRoot, child);
      let stat;
      try {
        stat = _deps.lstatSync(root);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      const manifest = parsePluginManifest(root);
      const version = semver.valid(manifest.metadata?.version)
        ? manifest.metadata.version
        : null;
      const candidate = { root, version, manifest, transactionRoot };
      if (!fallback?.root) fallback = candidate;
      if (
        manifest.ok === true &&
        encodeName(manifest.metadata?.name) === encodedName
      ) {
        return candidate;
      }
    }
  }
  return fallback;
}

function findLifecycleCoordinatorRecovery(encodedName, opts) {
  const lockDir = pluginLifecycleCoordinatorLock(encodedName, opts);
  return _deps.existsSync(lockDir)
    ? { transactionRoot: lockDir, global: true }
    : null;
}

function listDirs(dir, strictIo = false) {
  try {
    return _deps
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (error) {
    if (strictIo) throw error;
    return [];
  }
}
