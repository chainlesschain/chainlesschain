/**
 * Project-scoped Claude-compatible automatic memory.
 *
 * The project directory name is only a launcher-selected storage bucket.  A
 * durable binding to the canonical repository/directory identity prevents a
 * reused bucket from silently inheriting memory from an unrelated workspace.
 * Linked Git worktrees intentionally share the common repository identity.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  CLAUDE_CONFIG_DIR_ENV,
  resolveClaudeProjectStorageDir,
} from "./claude-project-storage-layout.js";
import { resolveConfigDataRoot } from "./paths.js";
import {
  assertSafeOwnerOnlyPath,
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "./secure-fs.js";
import { resolveCanonicalWorkspaceRepoIdentity } from "./workspace-trust.js";

export const CLAUDE_AUTO_MEMORY_BINDING_SCHEMA =
  "chainlesschain.claude-project-auto-memory-binding/v1";
export const CLAUDE_AUTO_MEMORY_BINDING_FILE =
  ".chainlesschain-auto-memory-binding-v1.json";
export const CLAUDE_AUTO_MEMORY_MAX_SETTINGS_BYTES = 256 * 1024;
export const CLAUDE_AUTO_MEMORY_MAX_BINDING_BYTES = 4096;

const LAUNCH_ENV_KEYS = Object.freeze([
  "CHAINLESSCHAIN_HOME",
  CLAUDE_CONFIG_DIR_ENV,
  "CLAUDE_CODE_PROJECT_DIR_NAME",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "CC_MANAGED_SETTINGS",
]);

function autoMemoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function pathContains(parent, candidate) {
  const relation = relative(parent, candidate);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(relation))
  );
}

function isDeviceNamespace(value) {
  const windows = String(value).replaceAll("/", "\\");
  return windows.startsWith("\\\\?\\") || windows.startsWith("\\\\.\\");
}

function boundedObjectFromFile(filePath, maximumBytes) {
  try {
    const entry = lstatSync(filePath);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      entry.size < 1 ||
      entry.size > maximumBytes
    ) {
      return null;
    }
    const text = readFileSync(filePath, "utf8");
    if (Buffer.byteLength(text, "utf8") > maximumBytes) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function configuredAutoMemoryDirectory(settings) {
  if (!settings || typeof settings !== "object") {
    return { defined: false, value: null };
  }
  const candidates = [
    settings.autoMemoryDirectory,
    settings.autoMemory?.directory,
    settings.memory?.autoMemoryDirectory,
  ];
  for (const value of candidates) {
    if (value === undefined) continue;
    return {
      defined: true,
      value: typeof value === "string" ? value.trim() : null,
    };
  }
  return { defined: false, value: null };
}

function defaultManagedSettingsPath(env) {
  if (env.CC_MANAGED_SETTINGS) return env.CC_MANAGED_SETTINGS;
  if (process.platform === "win32") {
    const base = env.ProgramData || env.PROGRAMDATA || "C:\\ProgramData";
    return join(base, "ChainlessChain", "managed-settings.json");
  }
  return "/etc/chainlesschain/managed-settings.json";
}

function isTrustedSettingsLocation(filePath, workspaceRoot) {
  if (typeof filePath !== "string" || !filePath || !isAbsolute(filePath)) {
    return false;
  }
  if (isDeviceNamespace(filePath)) return false;
  try {
    return !pathContains(resolve(workspaceRoot), resolve(filePath));
  } catch {
    return false;
  }
}

function resolveTrustedDirectorySetting({ configRoot, workspaceRoot, env }) {
  const userFile = join(configRoot, "settings.json");
  const managedFile = defaultManagedSettingsPath(env);
  const sources = [
    { source: "user", file: userFile },
    { source: "managed", file: managedFile },
  ];
  let selected = null;
  for (const candidate of sources) {
    if (!isTrustedSettingsLocation(candidate.file, workspaceRoot)) continue;
    const setting = configuredAutoMemoryDirectory(
      boundedObjectFromFile(
        candidate.file,
        CLAUDE_AUTO_MEMORY_MAX_SETTINGS_BYTES,
      ),
    );
    if (!setting.defined) continue;
    // Managed settings are deliberately last/highest precedence.
    selected = { ...setting, source: candidate.source };
  }
  return selected;
}

function resolveCustomMemoryDirectory(value, workspaceRoot, options = {}) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    isDeviceNamespace(value) ||
    !isAbsolute(value)
  ) {
    throw autoMemoryError(
      "CC_AUTO_MEMORY_DIRECTORY_INVALID",
      "autoMemoryDirectory is not a safe absolute owner-only directory",
    );
  }
  const candidate = resolve(value);
  if (pathContains(resolve(workspaceRoot), candidate)) {
    throw autoMemoryError(
      "CC_AUTO_MEMORY_DIRECTORY_INVALID",
      "autoMemoryDirectory must not be inside the workspace",
    );
  }
  try {
    assertSafeOwnerOnlyPath(candidate);
    const insideSecuredConfigRoot =
      options.configRoot &&
      pathContains(resolve(options.configRoot), candidate);
    ensurePrivateDirectory(candidate, {
      // A custom directory below the project config root inherits the root's
      // verified ACL. External custom roots still receive an explicit Windows
      // ACL repair before they are trusted.
      applyWindowsAcl: !insideSecuredConfigRoot,
      failIfUnavailable: true,
    });
    const canonical = realpathSync.native
      ? realpathSync.native(candidate)
      : realpathSync(candidate);
    if (pathContains(resolve(workspaceRoot), canonical)) {
      throw autoMemoryError(
        "CC_AUTO_MEMORY_DIRECTORY_INVALID",
        "autoMemoryDirectory must not resolve inside the workspace",
      );
    }
    return canonical;
  } catch (error) {
    if (error?.code === "CC_AUTO_MEMORY_DIRECTORY_INVALID") throw error;
    throw autoMemoryError(
      "CC_AUTO_MEMORY_DIRECTORY_INVALID",
      "autoMemoryDirectory could not be secured",
    );
  }
}

function ensureClaudeProjectParents(configRoot, projectRoot) {
  try {
    ensurePrivateDirectory(configRoot, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
    ensurePrivateDirectory(join(configRoot, "projects"), {
      applyWindowsAcl: false,
    });
    ensurePrivateDirectory(projectRoot, { applyWindowsAcl: false });
  } catch {
    throw autoMemoryError(
      "CC_AUTO_MEMORY_STORAGE_UNAVAILABLE",
      "project automatic memory storage could not be secured",
    );
  }
}

function readBinding(bindingPath) {
  try {
    ensurePrivateFile(bindingPath, {
      // The binding lives under a directory that was just secured by the
      // project/custom-memory setup. It inherits that ACL on Windows; avoid
      // a second PowerShell round trip on every first automatic-memory open.
      applyWindowsAcl: false,
      failIfUnavailable: true,
    });
  } catch {
    throw autoMemoryError(
      "CC_AUTO_MEMORY_BINDING_INVALID",
      "project automatic memory binding is unavailable",
    );
  }
  const binding = boundedObjectFromFile(
    bindingPath,
    CLAUDE_AUTO_MEMORY_MAX_BINDING_BYTES,
  );
  if (
    !binding ||
    Object.keys(binding).length !== 2 ||
    binding.schema !== CLAUDE_AUTO_MEMORY_BINDING_SCHEMA ||
    !/^[a-f0-9]{64}$/u.test(binding.repositoryId || "")
  ) {
    throw autoMemoryError(
      "CC_AUTO_MEMORY_BINDING_INVALID",
      "project automatic memory binding is invalid",
    );
  }
  return binding;
}

function bindMemoryDirectory(memoryDirectory, repositoryId) {
  const bindingPath = join(memoryDirectory, CLAUDE_AUTO_MEMORY_BINDING_FILE);
  if (existsSync(bindingPath)) {
    const binding = readBinding(bindingPath);
    if (binding.repositoryId !== repositoryId) {
      throw autoMemoryError(
        "CC_AUTO_MEMORY_IDENTITY_MISMATCH",
        "project automatic memory belongs to another workspace",
      );
    }
    return;
  }

  const serialized = `${JSON.stringify({
    schema: CLAUDE_AUTO_MEMORY_BINDING_SCHEMA,
    repositoryId,
  })}\n`;
  try {
    writeFileSync(bindingPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw autoMemoryError(
        "CC_AUTO_MEMORY_BINDING_INVALID",
        "project automatic memory binding could not be created",
      );
    }
  }
  const binding = readBinding(bindingPath);
  if (binding.repositoryId !== repositoryId) {
    throw autoMemoryError(
      "CC_AUTO_MEMORY_IDENTITY_MISMATCH",
      "project automatic memory belongs to another workspace",
    );
  }
}

function isAutoMemoryDisabled(env) {
  const value = String(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true";
}

/** Capture storage-affecting environment authority before settings merge. */
export function captureClaudeStorageLaunchEnvironment(env = process.env) {
  const snapshot = {};
  for (const key of LAUNCH_ENV_KEYS) {
    if (typeof env[key] === "string") snapshot[key] = env[key];
  }
  return Object.freeze(snapshot);
}

/**
 * Settings files may contribute a generic child-process `env` map, but they
 * must never be able to redirect the parent process's canonical storage.
 */
export function restoreClaudeStorageLaunchEnvironment(
  snapshot,
  env = process.env,
) {
  for (const key of LAUNCH_ENV_KEYS) {
    if (owns(snapshot || {}, key)) env[key] = snapshot[key];
    else delete env[key];
  }
}

/** Validate configuration/root and project-name authority before side effects. */
export function validateClaudeStorageLaunchEnvironment(snapshot, options = {}) {
  const env = snapshot || process.env;
  const root = resolveConfigDataRoot({
    env,
    cwd: options.cwd || process.cwd(),
  });
  if (root.source === "claude") {
    resolveClaudeProjectStorageDir(root.path, { env });
  }
  return root;
}

/**
 * Build the memory plan consumed by the real REPL lifecycle.  It deliberately
 * returns no filesystem location for disabled/error states, so callers cannot
 * accidentally fall back to a workspace-local directory.
 */
export function resolveClaudeProjectAutoMemory(options = {}) {
  const env = options.launchEnv || process.env;
  const cwd = options.cwd || process.cwd();
  let root;
  let projectStorage;
  try {
    root = resolveConfigDataRoot({ env, cwd });
    projectStorage =
      root.source === "claude"
        ? resolveClaudeProjectStorageDir(root.path, { env })
        : null;
  } catch (error) {
    return Object.freeze({
      mode: "project",
      enabled: false,
      memoryDir: null,
      source: null,
      reason: error?.code || "CC_AUTO_MEMORY_STORAGE_UNAVAILABLE",
    });
  }

  if (!projectStorage) {
    return Object.freeze({
      mode: "legacy",
      enabled: !isAutoMemoryDisabled(env),
      memoryDir: null,
      source: null,
      reason: isAutoMemoryDisabled(env) ? "disabled" : null,
    });
  }
  if (isAutoMemoryDisabled(env)) {
    return Object.freeze({
      mode: "project",
      enabled: false,
      memoryDir: null,
      source: null,
      reason: "disabled",
    });
  }

  try {
    const identity = resolveCanonicalWorkspaceRepoIdentity(cwd);
    const workspaceRoot = identity.canonicalWorkspaceRoot;
    ensureClaudeProjectParents(root.path, projectStorage);
    const configured = resolveTrustedDirectorySetting({
      configRoot: root.path,
      workspaceRoot,
      env,
    });
    const memoryDir = configured?.defined
      ? resolveCustomMemoryDirectory(configured.value, workspaceRoot, {
          configRoot: root.path,
        })
      : join(projectStorage, "memory");
    if (!configured?.defined) {
      ensurePrivateDirectory(memoryDir, {
        applyWindowsAcl: false,
        failIfUnavailable: true,
      });
    }
    bindMemoryDirectory(memoryDir, identity.repositoryId);
    return Object.freeze({
      mode: "project",
      enabled: true,
      memoryDir,
      source: configured?.source || "default",
      // Hash-only identity supports diagnostics/tests without exposing a path.
      repositoryId: identity.repositoryId,
      reason: null,
    });
  } catch (error) {
    return Object.freeze({
      mode: "project",
      enabled: false,
      memoryDir: null,
      source: null,
      reason: error?.code || "CC_AUTO_MEMORY_STORAGE_UNAVAILABLE",
    });
  }
}
