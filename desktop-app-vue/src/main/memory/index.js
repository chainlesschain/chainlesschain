/**
 * Memory Bank System - Unified Exports
 *
 * Provides a centralized entry point for all memory-related modules:
 * - PreferenceManager: User preferences, usage history, search history
 * - LearnedPatternManager: Prompt patterns, error fixes, code snippets, workflows
 *
 * Part of the Memory Bank system (.chainlesschain/memory/)
 *
 * @module memory
 * @version 1.0.0
 * @since 2026-01-17
 */

const { PreferenceManager } = require("./preference-manager");
const { registerPreferenceManagerIPC } = require("./preference-manager-ipc");
const { LearnedPatternManager } = require("./learned-pattern-manager");
const {
  registerLearnedPatternManagerIPC,
} = require("./learned-pattern-manager-ipc");

/**
 * Initialize all memory managers
 * @param {Object} options - Initialization options
 * @param {Object} options.database - SQLite database instance
 * @param {Object} options.configManager - UnifiedConfigManager instance
 * @param {Object} [options.llmManager] - LLM Manager instance
 * @param {Object} [options.errorMonitor] - ErrorMonitor instance
 * @returns {Promise<Object>} Initialized managers
 */
async function initializeMemorySystem(options) {
  const { database, configManager, llmManager, errorMonitor } = options;

  if (!database) {
    throw new Error("[MemorySystem] database is required");
  }

  if (!configManager) {
    throw new Error("[MemorySystem] configManager is required");
  }

  const paths = configManager.getPaths();

  console.log("[MemorySystem] Initializing memory system...");

  // Initialize PreferenceManager
  const preferenceManager = new PreferenceManager({
    database,
    preferencesDir: paths.preferences,
  });
  await preferenceManager.initialize();

  // Initialize LearnedPatternManager
  const learnedPatternManager = new LearnedPatternManager({
    database,
    patternsDir: paths.learnedPatterns,
    llmManager,
    errorMonitor,
  });
  await learnedPatternManager.initialize();

  console.log("[MemorySystem] Memory system initialized successfully");

  return {
    preferenceManager,
    learnedPatternManager,
  };
}

/**
 * Register all memory system IPC handlers
 * @param {Object} options - Options
 * @param {Object} options.preferenceManager - PreferenceManager instance
 * @param {Object} options.learnedPatternManager - LearnedPatternManager instance
 * @param {Object} [options.ipcMain] - IPC main object (for testing)
 * @returns {Object} IPC handler update functions
 */
function registerMemorySystemIPC(options) {
  const { preferenceManager, learnedPatternManager, ipcMain } = options;

  console.log("[MemorySystem] Registering IPC handlers...");

  const preferenceIPC = registerPreferenceManagerIPC({
    preferenceManager,
    ipcMain,
  });

  const patternIPC = registerLearnedPatternManagerIPC({
    learnedPatternManager,
    ipcMain,
  });

  console.log("[MemorySystem] IPC handlers registered");

  return {
    updatePreferenceManager: preferenceIPC?.updatePreferenceManager,
    updateLearnedPatternManager: patternIPC?.updateLearnedPatternManager,
  };
}

module.exports = {
  // Classes
  PreferenceManager,
  LearnedPatternManager,

  // IPC Registration
  registerPreferenceManagerIPC,
  registerLearnedPatternManagerIPC,
  registerMemorySystemIPC,

  // Initialization
  initializeMemorySystem,
};
