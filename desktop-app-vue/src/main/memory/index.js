/**
 * Memory Bank System - Unified Exports
 *
 * Provides a centralized entry point for all memory-related modules:
 * - PreferenceManager: User preferences, usage history, search history
 * - LearnedPatternManager: Prompt patterns, error fixes, code snippets, workflows
 * - AutoBackupManager: Automatic full and incremental backups
 * - UsageReportGenerator: Weekly/monthly reports and cost analysis
 * - BehaviorTracker: User behavior learning and recommendations
 * - ContextAssociator: Cross-session knowledge extraction and association
 *
 * Part of the Memory Bank system (.chainlesschain/memory/)
 *
 * @module memory
 * @version 2.0.0
 * @since 2026-01-17
 * @updated 2026-01-18
 */

const path = require("path");

// Existing managers
const { PreferenceManager } = require("./preference-manager");
const { registerPreferenceManagerIPC } = require("./preference-manager-ipc");
const { LearnedPatternManager } = require("./learned-pattern-manager");
const {
  registerLearnedPatternManagerIPC,
} = require("./learned-pattern-manager-ipc");

// New managers (v2.0.0)
const { AutoBackupManager } = require("./auto-backup-manager");
const { registerAutoBackupManagerIPC } = require("./auto-backup-manager-ipc");
const { UsageReportGenerator } = require("./usage-report-generator");
const {
  registerUsageReportGeneratorIPC,
} = require("./usage-report-generator-ipc");
const { BehaviorTracker } = require("./behavior-tracker");
const { registerBehaviorTrackerIPC } = require("./behavior-tracker-ipc");
const { ContextAssociator } = require("./context-associator");
const { registerContextAssociatorIPC } = require("./context-associator-ipc");

/**
 * Initialize all memory managers
 * @param {Object} options - Initialization options
 * @param {Object} options.database - SQLite database instance
 * @param {Object} options.configManager - UnifiedConfigManager instance
 * @param {Object} [options.llmManager] - LLM Manager instance
 * @param {Object} [options.errorMonitor] - ErrorMonitor instance
 * @param {Object} [options.tokenTracker] - TokenTracker instance for usage reports
 * @param {Object} [options.sessionManager] - SessionManager instance for context association
 * @returns {Promise<Object>} Initialized managers
 */
async function initializeMemorySystem(options) {
  const {
    database,
    configManager,
    llmManager,
    errorMonitor,
    tokenTracker,
    sessionManager,
  } = options;

  if (!database) {
    throw new Error("[MemorySystem] database is required");
  }

  if (!configManager) {
    throw new Error("[MemorySystem] configManager is required");
  }

  const paths = configManager.getPaths();

  console.log("[MemorySystem] Initializing memory system...");
  console.log("[MemorySystem] Memory base directory:", paths.memory);

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

  // Initialize AutoBackupManager - 使用 configManager.paths 而不是 process.cwd()
  const autoBackupManager = new AutoBackupManager({
    database,
    backupsDir: paths.backups || path.join(paths.memory, "backups"),
    configManager,
  });
  await autoBackupManager.initialize();

  // Initialize UsageReportGenerator - 使用 configManager.paths
  const usageReportGenerator = new UsageReportGenerator({
    database,
    reportsDir: paths.reports || path.join(paths.memory, "reports"),
    tokenTracker,
    configManager,
  });
  await usageReportGenerator.initialize();

  // Initialize BehaviorTracker
  const behaviorTracker = new BehaviorTracker({
    database,
    patternsDir: paths.learnedPatterns,
    llmManager,
  });
  await behaviorTracker.initialize();

  // Initialize ContextAssociator
  const contextAssociator = new ContextAssociator({
    database,
    llmManager,
    sessionManager,
  });
  await contextAssociator.initialize();

  // Set up automatic backup trigger from LearnedPatternManager events
  if (learnedPatternManager && autoBackupManager) {
    learnedPatternManager.on("prompt-pattern-recorded", async () => {
      // Trigger incremental backup after significant changes
      try {
        const stats = await learnedPatternManager.getStats();
        if (stats.promptPatterns?.count % 10 === 0) {
          console.log(
            "[MemorySystem] Triggering auto-backup after pattern changes",
          );
          await autoBackupManager.createIncrementalBackup("patterns");
        }
      } catch (error) {
        console.error("[MemorySystem] Auto-backup trigger failed:", error);
      }
    });
  }

  console.log("[MemorySystem] Memory system initialized successfully");

  return {
    preferenceManager,
    learnedPatternManager,
    autoBackupManager,
    usageReportGenerator,
    behaviorTracker,
    contextAssociator,
  };
}

/**
 * Register all memory system IPC handlers
 * @param {Object} options - Options
 * @param {Object} options.preferenceManager - PreferenceManager instance
 * @param {Object} options.learnedPatternManager - LearnedPatternManager instance
 * @param {Object} options.autoBackupManager - AutoBackupManager instance
 * @param {Object} options.usageReportGenerator - UsageReportGenerator instance
 * @param {Object} options.behaviorTracker - BehaviorTracker instance
 * @param {Object} options.contextAssociator - ContextAssociator instance
 * @param {Object} [options.ipcMain] - IPC main object (for testing)
 * @returns {Object} IPC handler update functions
 */
function registerMemorySystemIPC(options) {
  const {
    preferenceManager,
    learnedPatternManager,
    autoBackupManager,
    usageReportGenerator,
    behaviorTracker,
    contextAssociator,
    ipcMain,
  } = options;

  console.log("[MemorySystem] Registering IPC handlers...");

  const preferenceIPC = registerPreferenceManagerIPC({
    preferenceManager,
    ipcMain,
  });

  const patternIPC = registerLearnedPatternManagerIPC({
    learnedPatternManager,
    ipcMain,
  });

  // Register new IPC handlers
  let backupIPC, reportIPC, behaviorIPC, contextIPC;

  if (autoBackupManager) {
    backupIPC = registerAutoBackupManagerIPC({
      autoBackupManager,
      ipcMain,
    });
  }

  if (usageReportGenerator) {
    reportIPC = registerUsageReportGeneratorIPC({
      usageReportGenerator,
      ipcMain,
    });
  }

  if (behaviorTracker) {
    behaviorIPC = registerBehaviorTrackerIPC({
      behaviorTracker,
      ipcMain,
    });
  }

  if (contextAssociator) {
    contextIPC = registerContextAssociatorIPC({
      contextAssociator,
      ipcMain,
    });
  }

  console.log("[MemorySystem] IPC handlers registered");

  return {
    updatePreferenceManager: preferenceIPC?.updatePreferenceManager,
    updateLearnedPatternManager: patternIPC?.updateLearnedPatternManager,
    updateAutoBackupManager: backupIPC?.updateAutoBackupManager,
    updateUsageReportGenerator: reportIPC?.updateUsageReportGenerator,
    updateBehaviorTracker: behaviorIPC?.updateBehaviorTracker,
    updateContextAssociator: contextIPC?.updateContextAssociator,
  };
}

/**
 * Stop all memory system background tasks
 * @param {Object} managers - Manager instances
 */
function stopMemorySystem(managers) {
  console.log("[MemorySystem] Stopping memory system...");

  if (managers.autoBackupManager) {
    managers.autoBackupManager.stopScheduleChecker();
  }

  if (managers.usageReportGenerator) {
    managers.usageReportGenerator.stopScheduleChecker();
  }

  if (managers.behaviorTracker) {
    managers.behaviorTracker.stopPeriodicAnalysis();
  }

  console.log("[MemorySystem] Memory system stopped");
}

module.exports = {
  // Existing Classes
  PreferenceManager,
  LearnedPatternManager,

  // New Classes (v2.0.0)
  AutoBackupManager,
  UsageReportGenerator,
  BehaviorTracker,
  ContextAssociator,

  // IPC Registration
  registerPreferenceManagerIPC,
  registerLearnedPatternManagerIPC,
  registerAutoBackupManagerIPC,
  registerUsageReportGeneratorIPC,
  registerBehaviorTrackerIPC,
  registerContextAssociatorIPC,
  registerMemorySystemIPC,

  // Initialization and Lifecycle
  initializeMemorySystem,
  stopMemorySystem,
};
