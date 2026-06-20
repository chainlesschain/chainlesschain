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
    renameSync(tmp, configPath);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}

export function getConfigValue(key) {
  const config = loadConfig();
  return getNestedValue(config, key);
}

export function setConfigValue(key, value) {
  const config = loadConfig();
  setNestedValue(config, key, parseValue(value));
  saveConfig(config);
  return config;
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
