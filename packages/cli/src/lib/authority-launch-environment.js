/** Launcher-owned storage locations and permission switches. */

export const STORAGE_AUTHORITY_ENV_KEYS = Object.freeze([
  "CHAINLESSCHAIN_HOME",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_PROJECT_DIR_NAME",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "CC_MANAGED_SETTINGS",
  "ProgramData",
  "PROGRAMDATA",
  "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
  "LOCALAPPDATA",
  "XDG_STATE_HOME",
  // os.homedir() uses these launcher values too. Protecting only the explicit
  // anchor override leaves its default location redirectable via settings env.
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
]);

const PERMISSION_AUTHORITY_ENV_KEYS = Object.freeze([
  "CC_PERMISSIONS_ALLOW",
  "CC_PERMISSIONS_ASK",
  "CC_PERMISSIONS_DENY",
  "CC_BYPASS_PERMISSIONS",
]);

function normalizeKey(key, platform) {
  return platform === "win32" ? key.toUpperCase() : key;
}

function storageKeys(platform) {
  return new Map(
    STORAGE_AUTHORITY_ENV_KEYS.map((key) => [normalizeKey(key, platform), key]),
  );
}

/** Native process.env truncates names at NUL; validate before any assignment. */
export function isValidEnvironmentKey(key) {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    !key.includes("\0") &&
    !key.includes("=")
  );
}

/** Plugins may supply tool defaults, but cannot select a new authority domain. */
export function isPluginAuthorityEnvironmentKey(
  key,
  { platform = process.platform } = {},
) {
  if (typeof key !== "string") return false;
  const normalized = normalizeKey(key, platform);
  return [...STORAGE_AUTHORITY_ENV_KEYS, ...PERMISSION_AUTHORITY_ENV_KEYS].some(
    (candidate) => normalizeKey(candidate, platform) === normalized,
  );
}

export function captureStorageAuthorityEnvironment(
  env = process.env,
  { platform = process.platform } = {},
) {
  const keys = storageKeys(platform);
  const snapshot = {};
  for (const [key, value] of Object.entries(env)) {
    const canonicalKey = keys.get(normalizeKey(key, platform));
    if (!canonicalKey || typeof value !== "string") continue;
    if (
      Object.hasOwn(snapshot, canonicalKey) &&
      snapshot[canonicalKey] !== value
    ) {
      const error = new Error(
        "Conflicting launcher storage environment aliases",
      );
      error.code = "CC_STORAGE_AUTHORITY_ENV_AMBIGUOUS";
      throw error;
    }
    snapshot[canonicalKey] = value;
  }
  return Object.freeze(snapshot);
}

/** Remove newly introduced aliases before restoring the trusted snapshot. */
export function restoreStorageAuthorityEnvironment(
  snapshot,
  env = process.env,
  { platform = process.platform } = {},
) {
  const captured = captureStorageAuthorityEnvironment(snapshot || {}, {
    platform,
  });
  const keys = storageKeys(platform);
  for (const key of Object.keys(env)) {
    if (keys.has(normalizeKey(key, platform))) delete env[key];
  }
  Object.assign(env, captured);
}
