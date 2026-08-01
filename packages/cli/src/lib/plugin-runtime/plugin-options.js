/**
 * Plugin OPTIONS resolution (Phase 3 gap: typed optionsSchema + sensitive
 * project-scope gate).
 *
 * A plugin declares `optionsSchema` (typed config with `scope` and `sensitive`
 * in [[capabilities.js]]). Users supply option VALUES at two scopes:
 *   - USER scope   → user data dir `plugin-options.json` (may hold secrets)
 *   - PROJECT scope → repo-local `.chainlesschain/plugin-options.json`
 *     (checked-in-able → MUST NOT hold secrets)
 *
 * The security-critical rule (already enforced by `validateOptions`): a
 * SENSITIVE option can never come from project config. `resolvePluginOptions`
 * layers defaults < project (non-sensitive only) < user, DROPS + WARNS on any
 * sensitive/user-only option that appears in project config, and returns the
 * merged values with a redacted view for logging.
 *
 * Store IO is injected (`_deps`) so unit tests never touch the real dirs; the
 * resolver itself is pure.
 */

import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { getElectronUserDataDir } from "../paths.js";
import {
  optionDefaults,
  validateOptions,
  redactSensitiveOptions,
} from "./capabilities.js";
import { createSecretStore, isSecretRef, secretRef } from "../secret-store.js";
import { withFileLock } from "../with-file-lock.js";

export const _deps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  renameSync: fs.renameSync,
  unlinkSync: fs.unlinkSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  withFileLock,
  secretStore: () => createSecretStore(),
  userStorePath: () =>
    path.join(getElectronUserDataDir(), "plugin-options.json"),
  projectStorePath: (cwd) =>
    path.join(cwd || process.cwd(), ".chainlesschain", "plugin-options.json"),
};

function readJsonObject(p, { failIfUnavailable = false } = {}) {
  try {
    if (!_deps.existsSync(p)) return {};
    const data = JSON.parse(_deps.readFileSync(p, "utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
    throw new TypeError("top-level value must be an object");
  } catch (cause) {
    if (failIfUnavailable) {
      const error = new Error(`Plugin option store is unavailable: ${p}`, {
        cause,
      });
      error.code = "PLUGIN_OPTION_STORE_UNAVAILABLE";
      throw error;
    }
    return {};
  }
}

function writeJsonObject(p, obj) {
  _deps.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    _deps.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    _deps.renameSync(tmp, p);
  } catch (error) {
    try {
      _deps.unlinkSync(tmp);
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

function withOptionStoreLock(p, body) {
  _deps.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  return _deps.withFileLock(p, body, { failIfUnavailable: true });
}

function hashSecretNamespace(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, length);
}

function normalizedStoreIdentity(storePath) {
  const resolved = path.resolve(String(storePath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pluginSecretRefPrefix(storePath, name, key) {
  const storeNamespace = hashSecretNamespace(
    normalizedStoreIdentity(storePath),
    24,
  );
  const optionNamespace = hashSecretNamespace(
    JSON.stringify([String(name), String(key)]),
  );
  return `plugin-options/${storeNamespace}/${optionNamespace}/`;
}

function createPluginSecretRef(storePath, name, key) {
  return `${pluginSecretRefPrefix(storePath, name, key)}${crypto.randomUUID()}`;
}

function isOwnedPluginSecretRef(ref, storePath, name, key) {
  if (typeof ref !== "string") return false;
  return (
    ref === `${name}/${key}` ||
    ref.startsWith(pluginSecretRefPrefix(storePath, name, key))
  );
}

function collectSecretRefs(value, refs = new Set()) {
  if (isSecretRef(value)) {
    refs.add(value.__cc_secret_ref);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSecretRefs(entry, refs);
    return refs;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectSecretRefs(child, refs);
  }
  return refs;
}

function deleteSecretRefsBestEffort(store, refs) {
  if (!store || typeof store.delete !== "function") return;
  for (const ref of refs) {
    try {
      store.delete(ref);
    } catch {
      // Metadata is authoritative. A stale keychain entry is preferable to
      // rolling back a successfully committed plugin option document.
    }
  }
}

/** Load a plugin's option VALUES at the given scope (`user` | `project`). */
export function loadPluginOptionValues(
  name,
  scope,
  { cwd, schema, secretStore } = {},
) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  const store = readJsonObject(p);
  const v = store[name];
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = { ...v };
  const normalized = schema || {};
  for (const [key, desc] of Object.entries(normalized)) {
    if (!desc?.sensitive || !isSecretRef(out[key])) continue;
    try {
      const value = (secretStore || _deps.secretStore)().get(
        out[key].__cc_secret_ref,
      );
      if (value != null) out[key] = value;
      else delete out[key];
    } catch {
      // Missing/unavailable secret backends fail closed: do not expose a
      // plaintext fallback and let validation keep the option at its default.
      delete out[key];
    }
  }
  return out;
}

function persistPluginOptionValuesLocked(
  p,
  name,
  values,
  scope,
  { store, schema, secretStore, touchedKeys = null },
) {
  const previous =
    store[name] &&
    typeof store[name] === "object" &&
    !Array.isArray(store[name])
      ? store[name]
      : {};
  const input = values && typeof values === "object" ? values : {};
  const persisted = { ...input };
  const normalized = schema || {};
  let secrets = null;
  const getSecrets = () => {
    if (!secrets) secrets = (secretStore || _deps.secretStore)();
    return secrets;
  };
  const rejectedSensitive = [];
  const stagedSecretRefs = [];
  const replacedSecretRefs = new Set();
  try {
    for (const [key, desc] of Object.entries(normalized)) {
      if (!desc?.sensitive) continue;
      const hasInput = Object.prototype.hasOwnProperty.call(input, key);
      const previousRef = isSecretRef(previous[key])
        ? previous[key].__cc_secret_ref
        : null;

      // Project files are shareable and must never retain a sensitive value.
      // This gate also sanitizes an existing invalid value during an unrelated
      // patch, so patching cannot accidentally preserve project-scope secrets.
      if (scope === "project") {
        if (hasInput) {
          delete persisted[key];
          rejectedSensitive.push(key);
        }
        continue;
      }

      // A patch leaves untouched secret references byte-for-byte. Only keys in
      // the patch participate in the secret-store transaction.
      if (touchedKeys && !touchedKeys.has(key)) continue;

      if (!hasInput || input[key] == null || input[key] === "") {
        delete persisted[key];
      } else {
        // Every write gets a new immutable reference. Namespaces are hashes of
        // the option-store path and the unambiguous [plugin, key] tuple, so
        // names containing '/' cannot collide with another plugin/key pair.
        const ref = createPluginSecretRef(p, name, key);
        stagedSecretRefs.push(ref);
        getSecrets().set(ref, input[key]);
        persisted[key] = secretRef(ref);
      }

      if (previousRef && isOwnedPluginSecretRef(previousRef, p, name, key)) {
        replacedSecretRefs.add(previousRef);
      }
    }
    if (rejectedSensitive.length > 0) {
      persisted.__cc_rejected_sensitive = [
        ...new Set(rejectedSensitive),
      ].sort();
    } else if (
      Object.prototype.hasOwnProperty.call(persisted, "__cc_rejected_sensitive")
    ) {
      delete persisted.__cc_rejected_sensitive;
    }
    store[name] = persisted;
    writeJsonObject(p, store);
  } catch (error) {
    // The old metadata is still authoritative. Remove every newly staged
    // value so a failed JSON save cannot leak an orphaned credential.
    deleteSecretRefsBestEffort(secrets, stagedSecretRefs);
    throw error;
  }

  const activeSecretRefs = collectSecretRefs(store);
  const staleSecretRefs = [...replacedSecretRefs].filter(
    (ref) => !activeSecretRefs.has(ref),
  );
  if (staleSecretRefs.length > 0) {
    try {
      deleteSecretRefsBestEffort(getSecrets(), staleSecretRefs);
    } catch {
      // The JSON commit succeeded; unavailable cleanup must not undo it.
    }
  }
  return { name, scope, path: p };
}

/** Persist a plugin's option VALUES at a scope (replaces the plugin's entry). */
export function setPluginOptionValues(
  name,
  values,
  scope,
  { cwd, schema, secretStore } = {},
) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  return withOptionStoreLock(p, () => {
    const store = readJsonObject(p, { failIfUnavailable: true });
    return persistPluginOptionValuesLocked(p, name, values, scope, {
      store,
      schema,
      secretStore,
    });
  });
}

/**
 * Merge option updates under the same lock used for the durable JSON commit.
 * This is the command-safe API: callers never perform a lock-free read/modify/
 * write cycle that could overwrite a concurrent writer's unrelated keys.
 */
export function patchPluginOptionValues(
  name,
  updates,
  scope,
  { cwd, schema, secretStore } = {},
) {
  const p =
    scope === "project" ? _deps.projectStorePath(cwd) : _deps.userStorePath();
  return withOptionStoreLock(p, () => {
    const store = readJsonObject(p, { failIfUnavailable: true });
    const previous =
      store[name] &&
      typeof store[name] === "object" &&
      !Array.isArray(store[name])
        ? store[name]
        : {};
    const patch =
      updates && typeof updates === "object" && !Array.isArray(updates)
        ? updates
        : {};
    const values = { ...previous, ...patch };
    return persistPluginOptionValuesLocked(p, name, values, scope, {
      store,
      schema,
      secretStore,
      touchedKeys: new Set(Object.keys(patch)),
    });
  });
}

/** Provided keys of `values` (that exist in schema) accepted at `scope`. */
function acceptedKeys(schema, values, scope) {
  const res = validateOptions(schema, values, { scope });
  const keys = new Set();
  for (const key of Object.keys(values || {})) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) continue; // unknown → ignored
    // A provided key was accepted iff no error names it. validateOptions always
    // quotes the offending key as `"<key>"`, so this is an exact match.
    if (!res.errors.some((e) => e.includes(`"${key}"`))) keys.add(key);
  }
  return { res, keys };
}

/**
 * PURE: resolve effective option values from defaults + project + user config.
 *
 * Precedence: defaults < project (non-sensitive, non-user-only) < user.
 * A sensitive or user-only option present in project config is DROPPED and a
 * warning is recorded — a checked-in project file can never inject a secret.
 *
 * @returns {{ options:object, redacted:object, warnings:string[],
 *             sources:Record<string,'default'|'project'|'user'>,
 *             droppedFromProject:string[] }}
 */
export function resolvePluginOptions(
  schema,
  { userValues, projectValues } = {},
) {
  const s = schema || {};
  const options = optionDefaults(s);
  const sources = {};
  for (const key of Object.keys(options)) sources[key] = "default";

  const warnings = [];
  const droppedFromProject = [];
  const projectInput = { ...(projectValues || {}) };
  const rejectedSensitive = Array.isArray(projectInput.__cc_rejected_sensitive)
    ? projectInput.__cc_rejected_sensitive
    : [];
  delete projectInput.__cc_rejected_sensitive;
  for (const key of rejectedSensitive) {
    droppedFromProject.push(key);
    warnings.push(
      `project: option "${key}" is sensitive and cannot be set from project config — use user scope / OS keychain`,
    );
  }

  // Project layer first (lower precedence). validateOptions errors on sensitive/
  // user-only keys at project scope — those are the drops we surface + refuse.
  const proj = acceptedKeys(s, projectInput, "project");
  for (const err of proj.res.errors) {
    if (/sensitive|user-scoped/.test(err)) {
      const m = err.match(/"([^"]+)"/);
      if (m) droppedFromProject.push(m[1]);
    }
    warnings.push(`project: ${err}`);
  }
  for (const w of proj.res.warnings) warnings.push(`project: ${w}`);
  for (const key of proj.keys) {
    options[key] = proj.res.normalized[key];
    sources[key] = "project";
  }

  // User layer on top (highest precedence; may carry secrets).
  const user = acceptedKeys(s, userValues, "user");
  for (const err of user.res.errors) warnings.push(`user: ${err}`);
  for (const w of user.res.warnings) warnings.push(`user: ${w}`);
  for (const key of user.keys) {
    options[key] = user.res.normalized[key];
    sources[key] = "user";
  }

  return {
    options,
    redacted: redactSensitiveOptions(s, options),
    warnings,
    sources,
    droppedFromProject: [...new Set(droppedFromProject)],
  };
}

/** Load both scopes' values from disk and resolve against a schema. */
export function getResolvedPluginOptions(name, schema, { cwd } = {}) {
  return resolvePluginOptions(schema, {
    userValues: loadPluginOptionValues(name, "user", { cwd, schema }),
    projectValues: loadPluginOptionValues(name, "project", { cwd, schema }),
  });
}
