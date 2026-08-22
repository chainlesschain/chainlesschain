import { existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../constants.js";
import { getPlatform } from "./platform.js";
import {
  CLAUDE_CONFIG_DIR_ENV,
  resolveClaudeProjectStorageDir,
  usesClaudeConfigDirectory,
} from "./claude-project-storage-layout.js";
import {
  assertSafeOwnerOnlyPath,
  ensurePrivateDirectory,
  repairPrivatePaths,
} from "./secure-fs.js";

const securedClaudeProjectStorageEntries = new Map();

function pathContains(parent, candidate) {
  const relation = relative(parent, candidate);
  return (
    relation === "" ||
    (!relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  );
}

function nearestGitWorktreeRoot(cwd) {
  let current = resolve(cwd);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function configHomeError(message) {
  const error = new Error(message);
  error.code = "CONFIG_HOME_UNSAFE";
  return error;
}

function isBroadSharedConfigRoot(resolvedHome, env) {
  const platform = getPlatform();
  const candidates =
    platform === "win32"
      ? [
          "C:\\Users",
          "C:\\Users\\Public",
          "C:\\Windows",
          "C:\\ProgramData",
          "C:\\Program Files",
          "C:\\Program Files (x86)",
          env?.PUBLIC,
          env?.ProgramData,
          env?.PROGRAMDATA,
          env?.SystemRoot,
          env?.WINDIR,
        ]
      : [
          "/tmp",
          "/var/tmp",
          "/usr",
          "/etc",
          "/var",
          "/home",
          "/root",
          "/run",
          "/opt",
          "/srv",
          "/mnt",
          "/media",
        ];
  return candidates.some((candidate) => {
    if (typeof candidate !== "string" || !candidate) return false;
    try {
      const normalized = resolve(candidate);
      return platform === "win32"
        ? normalized.toLowerCase() === resolvedHome.toLowerCase()
        : normalized === resolvedHome;
    } catch {
      return false;
    }
  });
}

/**
 * Reject broad shared directories before any owner-only chmod/DACL repair.
 * Unlike the generic secure-fs guard, config/data roots are high-value and
 * must never target a shared system parent such as C:\\Users or /home.
 */
export function assertSafeConfigDataRoot(dirPath, options = {}) {
  const resolvedPath = resolve(dirPath);
  if (isBroadSharedConfigRoot(resolvedPath, options.env || process.env)) {
    throw configHomeError(
      "Config/data root must not be a broad shared system directory",
    );
  }
  assertSafeOwnerOnlyPath(resolvedPath);
  return resolvedPath;
}

function resolveConfiguredHome(configured, variableName, cwd, env) {
  const windowsLiteral = configured.replaceAll("/", "\\");
  if (
    windowsLiteral.startsWith("\\\\?\\") ||
    windowsLiteral.startsWith("\\\\.\\")
  ) {
    throw configHomeError(
      `${variableName} must not use a Windows device namespace`,
    );
  }
  if (!isAbsolute(configured)) {
    throw configHomeError(
      `${variableName} must be an absolute path for owner-only storage`,
    );
  }
  const resolvedHome = resolve(configured);
  try {
    assertSafeConfigDataRoot(resolvedHome, { env });
  } catch (error) {
    if (error?.code === "CONFIG_HOME_UNSAFE") throw error;
    throw configHomeError(
      `${variableName} must not be a broad shared system directory`,
    );
  }
  const resolvedCwd = resolve(cwd);
  const worktreeRoot = nearestGitWorktreeRoot(resolvedCwd);
  if (
    pathContains(resolvedHome, resolvedCwd) ||
    pathContains(resolvedCwd, resolvedHome) ||
    (worktreeRoot &&
      (pathContains(worktreeRoot, resolvedHome) ||
        pathContains(resolvedHome, worktreeRoot)))
  ) {
    throw configHomeError(
      `${variableName} must not be the current working directory, its worktree, or any nested/ancestor path`,
    );
  }
  // This is deliberately a no-IO validation. Directory creation/ACL repair
  // remains in ensureHomeDir(), but broad roots and device aliases are refused
  // before any caller can ask the secure-fs layer to mutate them.
  return resolvedHome;
}

/**
 * Resolve the CLI's authoritative config/data root. CHAINLESSCHAIN_HOME is a
 * native explicit override and takes precedence over CLAUDE_CONFIG_DIR; the
 * latter is only a compatible fallback for an otherwise unconfigured CLI.
 */
export function resolveConfigDataRoot(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const nativeHome = env.CHAINLESSCHAIN_HOME;
  if (nativeHome) {
    return Object.freeze({
      path: resolveConfiguredHome(nativeHome, "CHAINLESSCHAIN_HOME", cwd, env),
      source: "chainlesschain",
    });
  }
  if (usesClaudeConfigDirectory(env)) {
    const configured = env[CLAUDE_CONFIG_DIR_ENV].trim();
    return Object.freeze({
      path: resolveConfiguredHome(configured, CLAUDE_CONFIG_DIR_ENV, cwd, env),
      source: "claude",
    });
  }
  return Object.freeze({
    path: join(homedir(), CONFIG_DIR_NAME),
    source: "default",
  });
}

export function getHomeDir() {
  return resolveConfigDataRoot().path;
}

/**
 * Claude-compatible session storage is opt-in and only activates when the
 * launcher supplied both CLAUDE_CONFIG_DIR and a safe project directory name.
 * Legacy callers continue to use `<home>/sessions`.
 */
export function getClaudeProjectStorageDir(options = {}) {
  const env = options.env || process.env;
  const root = resolveConfigDataRoot({ ...options, env });
  if (root.source !== "claude") return null;
  return resolveClaudeProjectStorageDir(root.path, { env });
}

export function getSessionStoreDir(options = {}) {
  return (
    getClaudeProjectStorageDir(options) ||
    join(resolveConfigDataRoot(options).path, "sessions")
  );
}

/**
 * Secure a Claude-compatible project storage tree without trusting inherited
 * Windows ACLs on pre-existing descendants.  The config root is repaired
 * first, then every child is created below that verified boundary and repaired
 * together in one Windows ACL batch.  This keeps the security invariant while
 * avoiding a PowerShell process for every storage subdirectory.
 */
export function ensureClaudeProjectStorageTree(
  homeDir,
  projectDir,
  options = {},
) {
  const home = resolve(homeDir);
  const projectsDir = join(home, "projects");
  const project = resolve(projectDir);
  const extraDirectories = Array.isArray(options.extraDirectories)
    ? options.extraDirectories.map((entry) => resolve(entry))
    : [];
  if (!pathContains(projectsDir, project) || project === projectsDir) {
    throw configHomeError(
      "Claude project storage path must remain below projects",
    );
  }
  if (extraDirectories.some((entry) => !pathContains(project, entry))) {
    throw configHomeError(
      "Claude project storage descendants must remain below the project root",
    );
  }

  ensurePrivateDirectory(home, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  const descendants = [projectsDir, project, ...extraDirectories];
  if (getPlatform() === "win32") {
    const repairTargets = [];
    for (const directory of descendants) {
      ensurePrivateDirectory(directory, {
        applyWindowsAcl: false,
        failIfUnavailable: true,
      });
      let current = null;
      try {
        const entry = lstatSync(directory);
        current = `${entry.dev}:${entry.ino}`;
      } catch {
        // ensurePrivateDirectory above either created the directory or threw;
        // retain a fail-closed repair target if a filesystem race removed it.
      }
      // The secure-fs layer caches verified Windows ACLs per path. Keep a
      // matching tree cache so repeated session writes do not re-run a batch,
      // but force a repair whenever this helper first observes a descendant.
      if (securedClaudeProjectStorageEntries.get(directory) !== current) {
        repairTargets.push(directory);
      }
    }
    if (repairTargets.length > 0) {
      // A private parent is not proof that an older child has no broad explicit
      // ACE. Repair all newly observed descendants in one fail-closed batch.
      repairPrivatePaths(repairTargets, { platform: "win32" });
      for (const directory of repairTargets) {
        securedClaudeProjectStorageEntries.set(
          directory,
          (() => {
            const entry = lstatSync(directory);
            return `${entry.dev}:${entry.ino}`;
          })(),
        );
      }
    }
  } else {
    for (const directory of descendants) {
      ensurePrivateDirectory(directory, { failIfUnavailable: true });
    }
  }
  return project;
}

export function getBinDir() {
  return join(getHomeDir(), "bin");
}

export function getConfigPath() {
  return join(getHomeDir(), "config.json");
}

export function getStatePath() {
  return join(getHomeDir(), "state");
}

/** User-local security state that survives rollback of CHAINLESSCHAIN_HOME. */
export function getMachineSecurityAnchorDir() {
  const configured = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  let anchorPath;
  if (configured) {
    if (!isAbsolute(configured)) {
      const error = new Error(
        "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME must be an absolute path",
      );
      error.code = "CONFIG_HOME_UNSAFE";
      throw error;
    }
    anchorPath = resolve(configured);
  } else {
    const platform = getPlatform();
    if (platform === "win32") {
      anchorPath = join(
        process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
        "ChainlessChain",
        "SecurityAnchors",
      );
    } else if (platform === "darwin") {
      anchorPath = join(
        homedir(),
        "Library",
        "Application Support",
        "ChainlessChain",
        "SecurityAnchors",
      );
    } else {
      anchorPath = join(
        process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
        "chainlesschain",
        "security-anchors",
      );
    }
  }
  const resolvedAnchor = resolve(anchorPath);
  const resolvedHome = resolve(getHomeDir());
  const relativeToHome = relative(resolvedHome, resolvedAnchor);
  if (
    relativeToHome === "" ||
    (!relativeToHome.startsWith("..") && !isAbsolute(relativeToHome))
  ) {
    const error = new Error(
      "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME must be outside CHAINLESSCHAIN_HOME",
    );
    error.code = "CONFIG_HOME_UNSAFE";
    throw error;
  }
  return resolvedAnchor;
}

export function getPidFilePath() {
  return join(getStatePath(), "app.pid");
}

export function getServicesDir() {
  return join(getHomeDir(), "services");
}

export function getLogsDir() {
  return join(getHomeDir(), "logs");
}

export function getCacheDir() {
  return join(getHomeDir(), "cache");
}

export function getElectronUserDataDir() {
  const p = getPlatform();
  const appName = "chainlesschain-desktop-vue";
  switch (p) {
    case "win32":
      return join(
        process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
        appName,
      );
    case "darwin":
      return join(homedir(), "Library", "Application Support", appName);
    case "linux":
      return join(
        process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
        appName,
      );
    default:
      return join(homedir(), appName);
  }
}

/** Refuse broad roots before owner-only chmod/DACL repair can mutate them. */
export function assertSafePrivateDirectoryPath(dirPath) {
  return assertSafeOwnerOnlyPath(dirPath);
}

export function ensureDir(dirPath) {
  assertSafePrivateDirectoryPath(dirPath);
  return ensurePrivateDirectory(dirPath, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
}

export function ensureHomeDir() {
  const homePath = getHomeDir();
  assertSafePrivateDirectoryPath(homePath);
  const home = ensurePrivateDirectory(homePath, {
    applyWindowsAcl: true,
    failIfUnavailable: true,
  });
  const dirs = [
    getBinDir(),
    getStatePath(),
    getServicesDir(),
    getLogsDir(),
    getCacheDir(),
  ];
  for (const dir of dirs) {
    ensurePrivateDirectory(dir, { applyWindowsAcl: false });
  }
  if (getPlatform() === "win32") {
    // Existing directories may predate the protected home ACL and retain broad
    // explicit permissions. Repair all protected children in one PowerShell
    // batch rather than paying one process startup per directory.
    repairPrivatePaths(dirs, { platform: "win32" });
  }
  return home;
}
