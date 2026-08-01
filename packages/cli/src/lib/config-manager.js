import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  lstatSync,
  constants as fsConstants,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { getConfigPath } from "./paths.js";
import { DEFAULT_CONFIG } from "../constants.js";
import { withFileLock } from "./with-file-lock.js";
import {
  coerceConfigValue,
  isSecretConfigKey,
  validateConfigValue,
} from "./config-schema.js";
import { createSecretStore, isSecretRef, secretRef } from "./secret-store.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "./secure-fs.js";

// Warn at most once per config path per process. Injectable seam: the default
// stays silent under vitest so test output isn't polluted; tests override
// `_deps.warn` to assert it fired.
const _warnedConfigPaths = new Set();
const _loadedSecretRefs = new Map();
export const _deps = {
  createSecretStore: () => createSecretStore(),
  warn: (msg) => {
    if (!process.env.VITEST) process.stderr.write(msg);
  },
};

const FORBIDDEN_CONFIG_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

function assertSafeConfigObject(value, prefix = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSafeConfigObject(entry, `${prefix}.${index}`),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_CONFIG_SEGMENTS.has(key)) {
      const error = new Error(`Invalid configuration key: ${path}`);
      error.code = "CONFIG_KEY_INVALID";
      throw error;
    }
    assertSafeConfigObject(child, path);
  }
}

function assertNotSymbolicLink(target, label = "configuration path") {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    const error = new Error(`Refusing symbolic link for ${label}: ${target}`);
    error.code = "CONFIG_PATH_SYMLINK";
    throw error;
  }
  return stat;
}

function readConfigDocument({ failIfUnavailable = false } = {}) {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    assertNotSymbolicLink(configPath, "config.json");
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("configuration root must be an object");
    }
    assertSafeConfigObject(parsed);
    return parsed;
  } catch (err) {
    if (failIfUnavailable) {
      const error = new Error(
        `Could not read durable config at ${configPath}: ${err.message}`,
        { cause: err },
      );
      error.code = "CONFIG_STORE_UNAVAILABLE";
      throw error;
    }
    throw err;
  }
}

export function loadUserConfig(options = {}) {
  return readConfigDocument(options);
}

function secretRefCacheKey(configPath, key) {
  return `${configPath}\0${key}`;
}

function createSecretStorageRef(configPath, key) {
  const namespace = createHash("sha256")
    .update(String(configPath))
    .digest("hex")
    .slice(0, 24);
  const encodedKey = Buffer.from(String(key), "utf8").toString("base64url");
  return `config/${namespace}/${encodedKey}/${randomUUID()}`;
}

function deleteSecretRefBestEffort(store, ref, context) {
  if (!store || !ref || typeof store.delete !== "function") return;
  try {
    if (store.delete(ref) === false) {
      _deps.warn(
        `Warning: could not remove stale OS secret reference (${context}).\n`,
      );
    }
  } catch (error) {
    _deps.warn(
      `Warning: could not remove stale OS secret reference (${context}: ${error.message}).\n`,
    );
  }
}

function resolveSecretReferences(value, prefix = "", state = {}) {
  if (isSecretRef(value)) {
    if (!isSecretConfigKey(prefix)) {
      const error = new Error(
        `Secret reference is not allowed at non-secret key: ${prefix || "(root)"}`,
      );
      error.code = "CONFIG_SECRET_REF_INVALID";
      throw error;
    }
    const ref = value.__cc_secret_ref;
    try {
      state.store ||= _deps.createSecretStore();
      const resolved = state.store.get(ref);
      if (resolved == null && !state.warned) {
        state.warned = true;
        _deps.warn(
          `Warning: an OS-backed configuration secret is missing (${prefix}).\n`,
        );
      }
      _loadedSecretRefs.set(secretRefCacheKey(state.configPath, prefix), {
        ref,
        resolved,
      });
      return resolved;
    } catch (error) {
      _loadedSecretRefs.set(secretRefCacheKey(state.configPath, prefix), {
        ref,
        resolved: null,
      });
      if (!state.warned) {
        state.warned = true;
        _deps.warn(
          `Warning: an OS-backed configuration secret could not be read (${error.message}).\n`,
        );
      }
      return null;
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      resolveSecretReferences(entry, `${prefix}.${index}`, state),
    );
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const childKey = prefix ? `${prefix}.${key}` : key;
      out[key] = resolveSecretReferences(child, childKey, state);
    }
    return out;
  }
  return value;
}

function restoreSecretReferences(config) {
  const out = structuredClone(config);
  const prefix = `${getConfigPath()}\0`;
  for (const [cacheKey, saved] of _loadedSecretRefs) {
    if (!cacheKey.startsWith(prefix)) continue;
    const key = cacheKey.slice(prefix.length);
    const current = getNestedValue(out, key);
    if (current === saved.resolved || isSecretRef(current)) {
      setNestedValue(out, key, secretRef(saved.ref));
    }
  }
  return out;
}

export function loadConfig({
  failIfUnavailable = false,
  resolveSecrets = true,
} = {}) {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...structuredClone(DEFAULT_CONFIG) };
  }
  try {
    const parsed = readConfigDocument({ failIfUnavailable });
    const effective = deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
    return resolveSecrets
      ? resolveSecretReferences(effective, "", { configPath })
      : effective;
  } catch (err) {
    if (failIfUnavailable) {
      const error = new Error(
        `Could not read durable config at ${configPath}: ${err.message}`,
        { cause: err },
      );
      error.code = "CONFIG_STORE_UNAVAILABLE";
      throw error;
    }
    // The file EXISTS but couldn't be read/parsed (a typo, trailing comma, or
    // truncated write). Silently returning defaults drops the user's entire
    // config — provider, model, baseUrl, API key — and falls back to the
    // default provider, producing a baffling "configured X but it runs Y / says
    // no API key". Warn once so the failure is visible; still fall back so cc
    // keeps working.
    if (!_warnedConfigPaths.has(configPath)) {
      _warnedConfigPaths.add(configPath);
      // Back up the broken file before anything can clobber it: a later
      // `cc config set` load-modify-saves DEFAULTS over this path, silently
      // destroying whatever the user still had in the broken JSON (API keys,
      // custom baseUrl). The copy gives them something to repair from.
      // Fixed sibling name (no timestamp) so repeated runs don't accumulate.
      let backupNote = "";
      try {
        assertNotSymbolicLink(configPath, "corrupted config source");
        const backupPath = `${configPath}.corrupted`;
        if (existsSync(backupPath)) {
          assertNotSymbolicLink(backupPath, "corrupted config backup");
        } else {
          copyFileSync(configPath, backupPath, fsConstants.COPYFILE_EXCL);
        }
        ensurePrivateFile(backupPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
        backupNote = ` A copy is available at ${backupPath}.`;
      } catch {
        /* backup is best-effort — the warning still fires without it */
      }
      _deps.warn(
        `⚠️  Could not read config at ${configPath} (${err.message}). ` +
          `Using defaults — your saved settings (provider / model / API key) are being IGNORED. ` +
          `Fix the JSON to restore them.${backupNote}\n`,
      );
    }
    return { ...structuredClone(DEFAULT_CONFIG) };
  }
}

export function saveConfig(config, options = {}) {
  const configPath = getConfigPath();
  ensurePrivateDirectory(dirname(configPath), {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  // Atomic write: config.json holds API keys + LLM settings, so a crash (or two
  // concurrent `cc config set`) mid-write must never leave a truncated/corrupt
  // file — that would break every cc command and could lose credentials. Write a
  // temp sibling, then rename over the target (rename is atomic within a
  // filesystem), so a reader/crash sees either the old file or the complete new
  // one, never a half-written one.
  const tmp = `${configPath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    const persisted =
      options.preserveSecretRefs === false
        ? structuredClone(config)
        : restoreSecretReferences(config);
    assertSafeConfigObject(persisted);
    writeFileSync(tmp, JSON.stringify(persisted, null, 2) + "\n", {
      encoding: "utf-8",
      mode: PRIVATE_FILE_MODE,
    });
    renameWithRetry(tmp, configPath);
    // POSIX needs an explicit 0600 chmod. On Windows the temp file was created
    // after the parent DACL was repaired above, so it inherits that owner-only
    // ACL through the atomic rename without a second PowerShell round-trip.
    ensurePrivateFile(configPath);
    if (options.preserveSecretRefs === false) {
      const prefix = `${configPath}\0`;
      for (const cacheKey of _loadedSecretRefs.keys()) {
        if (cacheKey.startsWith(prefix)) _loadedSecretRefs.delete(cacheKey);
      }
    }
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}

/**
 * Create a stable, owner-only snapshot before an in-place schema migration.
 * The first snapshot wins so a repeated `validate --fix` cannot overwrite the
 * last known pre-migration document with an already-migrated copy.
 */
export function backupConfigForMigration(
  suffix = `.before-schema-migration`,
  options = {},
) {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;
  assertNotSymbolicLink(configPath, "config.json migration source");
  const backupPath = `${configPath}${suffix}`;
  if (existsSync(backupPath)) {
    assertNotSymbolicLink(backupPath, "config migration backup");
  } else {
    copyFileSync(configPath, backupPath, fsConstants.COPYFILE_EXCL);
  }
  ensurePrivateFile(backupPath, {
    applyWindowsAcl: options.applyWindowsAcl !== false,
    failIfUnavailable: options.failIfUnavailable !== false,
    ...(options.secureOptions || {}),
  });
  return backupPath;
}

// On Windows, `rename` over a target that another process currently has open
// (e.g. a concurrent `loadConfig` reader) fails with EPERM/EACCES/EBUSY instead
// of POSIX's silent atomic replace. Under bursts of concurrent `cc config`/`cc
// config features` invocations this surfaced as a flaky exit-1. Retry the rename
// a few times with a short synchronous backoff so the transient lock clears;
// the temp file is already fully written, so this stays crash-safe.
export function renameWithRetry(tmp, target, opts = {}) {
  const {
    attempts = 8,
    baseDelayMs = 15,
    _rename = renameSync,
    _sleep = sleepSync,
  } = opts;
  for (let i = 0; ; i++) {
    try {
      _rename(tmp, target);
      return;
    } catch (err) {
      const transient =
        err &&
        (err.code === "EPERM" ||
          err.code === "EACCES" ||
          err.code === "EBUSY" ||
          err.code === "EEXIST");
      if (!transient || i >= attempts - 1) throw err;
      _sleep(baseDelayMs * (i + 1));
    }
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms; // SharedArrayBuffer unavailable — bounded spin
    while (Date.now() < end) {
      /* spin */
    }
  }
}

export function getConfigValue(key, options = {}) {
  const config = loadConfig(options);
  return getNestedValue(config, key);
}

export function setConfigValue(key, value, options = {}) {
  if (isSecretConfigKey(key) && options.allowSecret !== true) {
    const error = new Error(
      `Refusing a secret on the command line for ${key}; use "cc config set-secret ${key}"`,
    );
    error.code = "CONFIG_SECRET_REQUIRES_SECURE_INPUT";
    throw error;
  }
  const parsedValue = coerceConfigValue(key, value, {
    allowUnknown: options.allowUnknown === true,
  });
  // Serialize the read-modify-write across processes: two concurrent
  // `cc config set` invocations would otherwise each load, mutate, and write
  // back, silently losing one update. Configuration can carry credentials and
  // permission policy, so bounded lock failure must never write unlocked.
  const configPath = getConfigPath();
  ensurePrivateDirectory(dirname(configPath), {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  return withFileLock(
    configPath,
    () => {
      const config = loadConfig({ failIfUnavailable: true });
      setNestedValue(config, key, parsedValue);
      saveConfig(config);
      return config;
    },
    { failIfUnavailable: true },
  );
}

/** Run a synchronous operation while holding the cross-process config lock. */
export function withConfigLock(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Config lock callback must be a function");
  }
  const configPath = getConfigPath();
  ensurePrivateDirectory(dirname(configPath), {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  return withFileLock(configPath, callback, { failIfUnavailable: true });
}

/** Serialize an arbitrary in-process config mutation under the config lock. */
export function updateConfigAtomically(mutator) {
  if (typeof mutator !== "function") {
    throw new TypeError("Config mutator must be a function");
  }
  return withConfigLock(() => {
    const config = loadConfig({ failIfUnavailable: true });
    mutator(config);
    saveConfig(config);
    return config;
  });
}

/**
 * Persist a secret without ever accepting it as a positional CLI argument.
 * `auto` prefers the OS store and falls back to the owner-only config file.
 */
export function setSecretConfigValue(key, value, options = {}) {
  if (!isSecretConfigKey(key)) {
    const error = new Error(
      `${key} is not declared as a secret configuration key`,
    );
    error.code = "CONFIG_KEY_NOT_SECRET";
    throw error;
  }
  const issues = validateConfigValue(key, value);
  if (issues.length)
    throw Object.assign(new Error(issues[0].message), issues[0]);
  const storage = options.storage || "auto";
  if (!new Set(["auto", "keychain", "file"]).has(storage)) {
    throw new Error("Secret storage must be auto, keychain, or file");
  }
  const configPath = getConfigPath();
  ensurePrivateDirectory(dirname(configPath), {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  return withFileLock(
    configPath,
    () => {
      const config = loadConfig({
        failIfUnavailable: true,
        resolveSecrets: false,
      });
      const previousValue = getNestedValue(config, key);
      const previousRef = isSecretRef(previousValue)
        ? previousValue.__cc_secret_ref
        : null;
      if (typeof options.configMutator === "function") {
        options.configMutator(config);
      }
      if (storage !== "file") {
        // A new immutable reference makes the keychain write + config rename a
        // small transaction: if persistence fails, the still-active old config
        // can only resolve its old value, never the just-written one.
        const ref = createSecretStorageRef(configPath, key);
        let store;
        try {
          store = options.secretStore || _deps.createSecretStore();
          store.set(ref, String(value));
        } catch (error) {
          if (storage === "keychain") {
            const wrapped = new Error(
              `OS secret store is unavailable for ${key}: ${error.message}`,
              { cause: error },
            );
            wrapped.code = "CONFIG_SECRET_STORE_UNAVAILABLE";
            throw wrapped;
          }
          store = null;
        }
        if (store) {
          // Persistence failures are not evidence that the OS store is
          // unavailable. Keep them outside the fallback catch so a disk or
          // atomic-rename failure can never silently downgrade the just-stored
          // secret to plaintext configuration.
          setNestedValue(config, key, secretRef(ref));
          try {
            // This load kept every secret as its persisted reference, so bypass
            // the resolved-value restoration cache and persist this exact raw
            // document.
            saveConfig(config, { preserveSecretRefs: false });
          } catch (error) {
            deleteSecretRefBestEffort(
              store,
              ref,
              "rollback after config write",
            );
            throw error;
          }
          _loadedSecretRefs.set(secretRefCacheKey(configPath, key), {
            ref,
            resolved: String(value),
          });
          if (previousRef && previousRef !== ref) {
            deleteSecretRefBestEffort(
              store,
              previousRef,
              "replaced config secret",
            );
          }
          return { key, storage: "keychain", backend: store.name };
        }
      }
      setNestedValue(config, key, String(value));
      saveConfig(config, { preserveSecretRefs: false });
      if (previousRef) {
        let previousStore = options.secretStore || null;
        if (!previousStore) {
          try {
            previousStore = _deps.createSecretStore();
          } catch {
            previousStore = null;
          }
        }
        deleteSecretRefBestEffort(
          previousStore,
          previousRef,
          "moved config secret to file storage",
        );
      }
      return { key, storage: "file", backend: null };
    },
    { failIfUnavailable: true },
  );
}

export function resetConfig() {
  const configPath = getConfigPath();
  ensurePrivateDirectory(dirname(configPath), {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  return withFileLock(
    configPath,
    () => {
      const current = loadConfig({
        failIfUnavailable: true,
        resolveSecrets: false,
      });
      const refs = [];
      const collectRefs = (value) => {
        if (isSecretRef(value)) {
          refs.push(value.__cc_secret_ref);
          return;
        }
        if (!value || typeof value !== "object") return;
        for (const child of Object.values(value)) collectRefs(child);
      };
      collectRefs(current);

      const config = structuredClone(DEFAULT_CONFIG);
      saveConfig(config, { preserveSecretRefs: false });
      if (refs.length > 0) {
        let store = null;
        try {
          store = _deps.createSecretStore();
        } catch (error) {
          _deps.warn(
            `Warning: config reset could not open the OS secret store (${error.message}).\n`,
          );
        }
        for (const ref of new Set(refs)) {
          deleteSecretRefBestEffort(store, ref, "config reset");
        }
      }
      return config;
    },
    { failIfUnavailable: true },
  );
}

export function listConfig() {
  return loadConfig();
}

function getNestedValue(obj, key) {
  const parts = key.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function setNestedValue(obj, key, value) {
  const parts = key.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
