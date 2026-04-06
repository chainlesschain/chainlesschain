/**
 * Feature Flag System — runtime feature gating for gradual rollout.
 *
 * Flags are stored in .chainlesschain/config.json under "features" key.
 * Each flag can be:
 *   - boolean (true/false)
 *   - number 0-100 (percentage rollout, hashed by machine-id)
 *   - object { enabled, variant, description }
 */

import { loadConfig, getConfigValue, saveConfig } from "../lib/config-manager.js";
import { createHash } from "node:crypto";
import { hostname } from "node:os";

const FLAG_REGISTRY = {
  BACKGROUND_TASKS: {
    description: "Enable background task queue with daemon execution",
    default: false,
  },
  WORKTREE_ISOLATION: {
    description: "Enable git worktree isolation for agent tasks",
    default: false,
  },
  CONTEXT_SNIP: {
    description: "Enable snipCompact strategy in context compression",
    default: false,
  },
  CONTEXT_COLLAPSE: {
    description: "Enable contextCollapse strategy in context compression",
    default: false,
  },
  JSONL_SESSION: {
    description: "Use JSONL append-only format for session persistence",
    default: true,
  },
  PROMPT_COMPRESSOR: {
    description: "Enable CLI prompt compressor (auto/snip/collapse)",
    default: true,
  },
  COMPRESSION_AB: {
    description:
      "A/B test compression thresholds (variants: aggressive, balanced, relaxed)",
    default: { enabled: false, variant: "balanced" },
  },
};

export function feature(name) {
  const value = _resolve(name);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return _percentageCheck(name, value);
  if (value && typeof value === "object") return Boolean(value.enabled);
  const defaultValue = _getDefault(name);
  if (typeof defaultValue === "boolean") return defaultValue;
  if (typeof defaultValue === "number") return _percentageCheck(name, defaultValue);
  if (defaultValue && typeof defaultValue === "object") {
    return Boolean(defaultValue.enabled);
  }
  return false;
}

export function featureVariant(name) {
  const value = _resolve(name);
  if (value && typeof value === "object" && value.variant) {
    return value.variant;
  }
  return null;
}

export function listFeatures() {
  const config = loadConfig();
  const features = config.features || {};
  const result = [];

  for (const [name, meta] of Object.entries(FLAG_REGISTRY)) {
    const raw = features[name];
    const enabled = feature(name);
    const source =
      raw !== undefined
        ? "config"
        : process.env[`CC_FLAG_${name}`] !== undefined
          ? "env"
          : "default";

    result.push({
      name,
      enabled,
      description: meta.description,
      source,
      raw: raw !== undefined ? raw : meta.default,
    });
  }

  for (const [name, raw] of Object.entries(features)) {
    if (!FLAG_REGISTRY[name]) {
      result.push({
        name,
        enabled: Boolean(raw),
        description: "(user-defined)",
        source: "config",
        raw,
      });
    }
  }

  return result;
}

export function setFeature(name, value) {
  const config = loadConfig();
  if (!config.features) config.features = {};
  config.features[name] = value;
  saveConfig(config);
}

export function getFlagInfo(name) {
  return FLAG_REGISTRY[name] || null;
}

function _resolve(name) {
  const envKey = `CC_FLAG_${name}`;
  if (process.env[envKey] !== undefined) {
    const envVal = process.env[envKey];
    if (envVal === "true" || envVal === "1") return true;
    if (envVal === "false" || envVal === "0") return false;
    const num = Number(envVal);
    if (!isNaN(num)) return num;
    return envVal;
  }

  const configVal = getConfigValue(`features.${name}`);
  if (configVal !== undefined) return configVal;

  return undefined;
}

function _getDefault(name) {
  const meta = FLAG_REGISTRY[name];
  return meta ? meta.default : false;
}

function _percentageCheck(name, percentage) {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;
  const hash = createHash("md5")
    .update(`${name}:${_machineId()}`)
    .digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;
  return bucket < percentage;
}

let _cachedMachineId = null;
function _machineId() {
  if (!_cachedMachineId) {
    _cachedMachineId = hostname() || "unknown";
  }
  return _cachedMachineId;
}
