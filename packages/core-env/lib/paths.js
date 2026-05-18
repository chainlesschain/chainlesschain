/**
 * Cross-environment path resolution
 *
 * Replaces all `require("electron").app.getPath("userData")` calls.
 * In Electron: delegates to app.getPath()
 * In CLI/Node: uses CHAINLESSCHAIN_HOME or platform-standard directories
 */

import path from "path";
import os from "os";
import fs from "fs";
import { createRequire } from "module";
import { isElectron } from "./runtime.js";

const require = createRequire(import.meta.url);

// Lazy-loaded Electron app reference
let _electronApp = null;

/**
 * Get Electron's app object (lazy, cached, synchronous)
 * @returns {object|null}
 */
function getElectronApp() {
  if (_electronApp) return _electronApp;
  if (!isElectron()) return null;

  try {
    const electron = require("electron");
    if (
      electron &&
      electron.app &&
      typeof electron.app.getPath === "function"
    ) {
      _electronApp = electron.app;
    }
  } catch {
    // Not in Electron environment
  }
  return _electronApp;
}

/**
 * Get the platform-specific user data directory.
 *
 * Priority:
 *  1. CHAINLESSCHAIN_HOME env var
 *  2. Electron app.getPath("userData") (if in Electron)
 *  3. Platform-standard location:
 *     - Windows: %APPDATA%/chainlesschain
 *     - macOS: ~/Library/Application Support/chainlesschain
 *     - Linux: ~/.config/chainlesschain
 *
 * @returns {string}
 */
export function getUserDataPath() {
  // Project-mode packed exe: entry script sets CC_PROJECT_ROOT to the
  // materialized user-data dir so all path resolution points there.
  if (process.env.CC_PROJECT_ROOT) {
    return process.env.CC_PROJECT_ROOT;
  }
  if (process.env.CHAINLESSCHAIN_HOME) {
    return process.env.CHAINLESSCHAIN_HOME;
  }

  const app = getElectronApp();
  if (app) {
    return app.getPath("userData");
  }

  // CLI / headless fallback
  switch (process.platform) {
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        "chainlesschain",
      );
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "chainlesschain",
      );
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "chainlesschain",
      );
  }
}

/**
 * Get the .chainlesschain configuration directory
 * @returns {string}
 */
export function getConfigDir() {
  return path.join(getUserDataPath(), ".chainlesschain");
}

/**
 * Get the database data directory
 * @returns {string}
 */
export function getDataDir() {
  return path.join(getUserDataPath(), "data");
}

/**
 * Get the logs directory
 * @returns {string}
 */
export function getLogsDir() {
  return path.join(getUserDataPath(), "logs");
}

/**
 * Get the temp directory
 * @returns {string}
 */
export function getTempDir() {
  const app = getElectronApp();
  if (app) {
    return app.getPath("temp");
  }
  return path.join(os.tmpdir(), "chainlesschain");
}

/**
 * Get the downloads directory
 * @returns {string}
 */
export function getDownloadsDir() {
  const app = getElectronApp();
  if (app) {
    return app.getPath("downloads");
  }
  return path.join(os.homedir(), "Downloads");
}

/**
 * Get the documents directory
 * @returns {string}
 */
export function getDocumentsDir() {
  const app = getElectronApp();
  if (app) {
    return app.getPath("documents");
  }
  return path.join(os.homedir(), "Documents");
}

/**
 * Get app.getPath(name) with CLI fallback
 * @param {string} name - The Electron path name
 * @returns {string}
 */
export function getPath(name) {
  const app = getElectronApp();
  if (app) {
    return app.getPath(name);
  }

  // CLI fallbacks
  const mapping = {
    userData: getUserDataPath(),
    temp: getTempDir(),
    downloads: getDownloadsDir(),
    documents: getDocumentsDir(),
    home: os.homedir(),
  };

  if (mapping[name]) return mapping[name];

  // Unknown path name — default to userData subdirectory
  return path.join(getUserDataPath(), name);
}

/**
 * Ensure a directory exists, creating it recursively if needed
 * @param {string} dirPath
 */
export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Override the Electron app reference (for testing or custom injection)
 * @param {object|null} appObj
 */
export function _setElectronApp(appObj) {
  _electronApp = appObj;
}
