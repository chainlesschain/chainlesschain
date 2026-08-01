/** Discoverable registry backed by the versioned CLI config schema. */
import { loadConfig } from "./config-manager.js";
import { getConfigDescriptors, isSecretConfigKey } from "./config-schema.js";
import { redactConfigValue } from "./config-redaction.js";

export { isSecretConfigKey } from "./config-schema.js";

export function getKnownConfigKeys() {
  return getConfigDescriptors()
    .map((entry) => ({
      ...entry,
      secret: entry.secret === true || isSecretConfigKey(entry.key),
      type: Array.isArray(entry.type) ? entry.type.join(" | ") : entry.type,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getNested(obj, key) {
  let current = obj;
  for (const part of String(key).split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

export function describeConfigKeys(deps = {}) {
  const load = deps.loadConfig || (() => loadConfig({ resolveSecrets: false }));
  let config = {};
  try {
    config = load() || {};
  } catch {
    config = {};
  }
  return getKnownConfigKeys().map((entry) => ({
    ...entry,
    current: redactConfigValue(entry.key, getNested(config, entry.key)),
  }));
}
