import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { getConfigPath } from "./paths.js";
import { DEFAULT_CONFIG } from "../constants.js";
import { withFileLock } from "./with-file-lock.js";

export function loadConfig() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...structuredClone(DEFAULT_CONFIG) };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
  } catch {
    return { ...structuredClone(DEFAULT_CONFIG) };
  }
}

export function saveConfig(config) {
  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  // Atomic write: config.json holds API keys + LLM settings, so a crash (or two
  // concurrent `cc config set`) mid-write must never leave a truncated/corrupt
  // file — that would break every cc command and could lose credentials. Write a
  // temp sibling, then rename over the target (rename is atomic within a
  // filesystem), so a reader/crash sees either the old file or the complete new
  // one, never a half-written one.
  const tmp = `${configPath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    renameWithRetry(tmp, configPath);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
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

export function getConfigValue(key) {
  const config = loadConfig();
  return getNestedValue(config, key);
}

export function setConfigValue(key, value) {
  // Serialize the read-modify-write across processes: two concurrent
  // `cc config set` invocations would otherwise each load, mutate, and write
  // back, silently losing one update. Best-effort lock (see with-file-lock):
  // on contention timeout it proceeds anyway, so the CLI never hangs.
  return withFileLock(getConfigPath(), () => {
    const config = loadConfig();
    setNestedValue(config, key, parseValue(value));
    saveConfig(config);
    return config;
  });
}

export function resetConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  saveConfig(config);
  return config;
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

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
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
