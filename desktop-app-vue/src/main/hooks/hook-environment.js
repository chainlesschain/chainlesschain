"use strict";

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

function names(values) {
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
  const managed = names(managedAllowlist);
  for (const key of names(requestedAllowlist)) {
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
