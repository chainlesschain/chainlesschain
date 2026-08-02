/** One redaction boundary for every configuration output surface. */
import { isSecretConfigKey } from "./config-schema.js";
import { redactSecrets } from "./secret-scan.js";
import { isSecretRef } from "./secret-store.js";

export const CONFIG_REDACTED = "[REDACTED]";
export const CONFIG_CONFIGURED = "<configured>";

export function redactConfigValue(key, value) {
  const leaf = String(key || "")
    .split(".")
    .at(-1);
  if (/^headersHelper$/i.test(leaf || "")) {
    return value == null || value === "" ? value : CONFIG_CONFIGURED;
  }
  if (isSecretConfigKey(key) || isSecretRef(value)) {
    return value == null || value === "" ? value : CONFIG_REDACTED;
  }
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      redactConfigValue(`${key}.${index}`, entry),
    );
  }
  if (value && typeof value === "object") {
    return redactConfigObject(value, key);
  }
  return value;
}

export function redactConfigObject(config, prefix = "") {
  if (!config || typeof config !== "object") return config;
  if (Array.isArray(config)) {
    return config.map((entry, index) =>
      redactConfigValue(`${prefix}.${index}`, entry),
    );
  }
  const out = {};
  for (const [name, value] of Object.entries(config)) {
    const key = prefix ? `${prefix}.${name}` : name;
    // Defining an own data property avoids the legacy Object.prototype
    // __proto__ setter while retaining a normal serializable object.
    Object.defineProperty(out, name, {
      value: redactConfigValue(key, value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}

export function stringifyRedactedConfig(config, space = 2) {
  return JSON.stringify(redactConfigObject(config), null, space);
}

export { isSecretConfigKey } from "./config-schema.js";
