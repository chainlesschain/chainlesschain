/**
 * @chainlesschain/core-env
 * Platform abstraction layer for ChainlessChain
 */

export {
  getUserDataPath,
  getConfigDir,
  getDataDir,
  getLogsDir,
  getTempDir,
  getDownloadsDir,
  getDocumentsDir,
  getPath,
  ensureDir,
  _setElectronApp,
} from "./paths.js";

export {
  isElectron,
  isElectronMain,
  isElectronRenderer,
  isCLI,
  isTest,
  isProduction,
  isDevelopment,
  getRuntimeInfo,
  _resetRuntimeCache,
} from "./runtime.js";
