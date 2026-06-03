/**
 * Runtime detection utilities
 * Detects whether code is running in Electron, CLI, or test environments.
 */

let _cachedRuntime = null;

/**
 * Check if running inside Electron
 * @returns {boolean}
 */
export function isElectron() {
  return !!(
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.electron
  );
}

/**
 * Check if running in Electron main process
 * @returns {boolean}
 */
export function isElectronMain() {
  return isElectron() && process.type === "browser";
}

/**
 * Check if running in Electron renderer process
 * @returns {boolean}
 */
export function isElectronRenderer() {
  return isElectron() && process.type === "renderer";
}

/**
 * Check if running as CLI (headless, no Electron)
 * @returns {boolean}
 */
export function isCLI() {
  return !isElectron();
}

/**
 * Check if running in a test environment
 * @returns {boolean}
 */
export function isTest() {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.JEST_WORKER_ID !== undefined
  );
}

/**
 * Check if running in production
 * @returns {boolean}
 */
export function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * Check if running in development
 * @returns {boolean}
 */
export function isDevelopment() {
  return !isProduction() && !isTest();
}

/**
 * Get the current runtime environment descriptor
 * @returns {{ runtime: string, env: string, platform: string }}
 */
export function getRuntimeInfo() {
  if (_cachedRuntime) return _cachedRuntime;

  _cachedRuntime = {
    runtime: isElectron() ? "electron" : "node",
    env: isProduction() ? "production" : isTest() ? "test" : "development",
    platform: process.platform,
  };
  return _cachedRuntime;
}

/**
 * Reset cached runtime info (for testing)
 */
export function _resetRuntimeCache() {
  _cachedRuntime = null;
}
