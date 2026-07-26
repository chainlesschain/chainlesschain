"use strict";

/**
 * Environment boundary shared by every CLI hook surface.
 *
 * Hooks receive only the small set needed to locate executables and temporary
 * files. Extra inherited variables require both an administrator-managed
 * allowlist and an explicit request from the hook definition.
 */
const SAFE_HOOK_ENV_KEYS = Object.freeze([
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "HOME",
  "USERPROFILE",
]);

function normalizeNames(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
}

function buildManagedHookEnvironment({
  source = process.env,
  managedAllowlist = [],
  requestedAllowlist = [],
  values = {},
} = {}) {
  const env = {};
  for (const key of SAFE_HOOK_ENV_KEYS) {
    if (source[key] != null) env[key] = source[key];
  }

  const managed = normalizeNames(managedAllowlist);
  for (const key of normalizeNames(requestedAllowlist)) {
    if (managed.has(key) && source[key] != null) env[key] = source[key];
  }

  for (const [key, value] of Object.entries(values || {})) {
    if (value != null) env[key] = String(value);
  }
  return env;
}

module.exports = {
  SAFE_HOOK_ENV_KEYS,
  buildManagedHookEnvironment,
};
