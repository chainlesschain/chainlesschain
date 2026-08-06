import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../constants.js";
import { getPlatform } from "./platform.js";
import {
  assertSafeOwnerOnlyPath,
  ensurePrivateDirectory,
  repairPrivatePaths,
} from "./secure-fs.js";

export function getHomeDir() {
  const configured = process.env.CHAINLESSCHAIN_HOME;
  if (configured) {
    const windowsLiteral = configured.replaceAll("/", "\\");
    if (
      windowsLiteral.startsWith("\\\\?\\") ||
      windowsLiteral.startsWith("\\\\.\\")
    ) {
      const error = new Error(
        "CHAINLESSCHAIN_HOME must not use a Windows device namespace",
      );
      error.code = "CONFIG_HOME_UNSAFE";
      throw error;
    }
    if (!isAbsolute(configured)) {
      const error = new Error(
        "CHAINLESSCHAIN_HOME must be an absolute path for owner-only storage",
      );
      error.code = "CONFIG_HOME_UNSAFE";
      throw error;
    }
    const resolvedHome = resolve(configured);
    const relativeCwd = relative(resolvedHome, resolve(process.cwd()));
    if (
      relativeCwd === "" ||
      (!relativeCwd.startsWith("..") && !isAbsolute(relativeCwd))
    ) {
      const error = new Error(
        "CHAINLESSCHAIN_HOME must not be the current working directory or one of its ancestors",
      );
      error.code = "CONFIG_HOME_UNSAFE";
      throw error;
    }
    return configured;
  }
  return join(homedir(), CONFIG_DIR_NAME);
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
  if (configured) {
    if (!isAbsolute(configured)) {
      const error = new Error(
        "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME must be an absolute path",
      );
      error.code = "CONFIG_HOME_UNSAFE";
      throw error;
    }
    return resolve(configured);
  }
  const platform = getPlatform();
  if (platform === "win32") {
    return join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      "ChainlessChain",
      "SecurityAnchors",
    );
  }
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "ChainlessChain",
      "SecurityAnchors",
    );
  }
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "chainlesschain",
    "security-anchors",
  );
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
