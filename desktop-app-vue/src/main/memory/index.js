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
 * - MemorySyncService: Filesystem synchronization service (v2.2.0)
 * - MemGPTCore: Long-term memory with self-editing (v2.3.0)
 * - MemoryHierarchy: Working/Recall/Archival memory layers (v2.3.0)
 * - MemorySearchEngine: Advanced memory retrieval (v2.3.0)
 *
 * Part of the Memory Bank system (.chainlesschain/memory/)
 *
 * @module memory
 * @version 2.3.0
 * @since 2026-01-17
 * @updated 2026-01-26
 */

const { logger, createLogger } = require('../utils/logger.js');
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

// Dashboard IPC (v2.1.0)
const { registerMemoryDashboardIPC } = require("./memory-dashboard-ipc");

// Sync Service (v2.2.0)
const { MemorySyncService } = require("./memory-sync-service");
const { registerMemorySyncIPC } = require("./memory-sync-ipc");

// MemGPT Long-term Memory (v2.3.0)
const { MemGPTCore, getMemGPTCore, MEMGPT_TOOLS } = require("./memgpt-core");
const { MemoryHierarchy, MemoryType, MemoryImportance, WorkingMemory, RecallMemory, ArchivalMemory } = require("./memory-hierarchy");
const { MemorySearchEngine, SearchMode } = require("./memory-search");
const { registerMemGPTIPC } = require("./memgpt-ipc");

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

  logger.info("[MemorySystem] Initializing memory system...");
  logger.info("[MemorySystem] Memory base directory:", paths.memory);

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
          logger.info(
            "[MemorySystem] Triggering auto-backup after pattern changes",
          );
          await autoBackupManager.createIncrementalBackup("patterns");
        }
      } catch (error) {
        logger.error("[MemorySystem] Auto-backup trigger failed:", error);
      }
    });
  }

  // Initialize MemorySyncService (v2.2.0)
  const memorySyncService = new MemorySyncService({
    configManager,
    preferenceManager,
    learnedPatternManager,
    sessionManager,
    autoBackupManager,
    usageReportGenerator,
    behaviorTracker,
    contextAssociator,
    syncInterval: 5 * 60 * 1000, // 5 minutes
    enablePeriodicSync: true,
  });

  // Initialize and perform first sync
  await memorySyncService.initialize();

  logger.info("[MemorySystem] Memory system initialized successfully");
  logger.info("[MemorySystem] Data synced to filesystem:", paths.memory);

  return {
    preferenceManager,
    learnedPatternManager,
    autoBackupManager,
    usageReportGenerator,
    behaviorTracker,
    contextAssociator,
    memorySyncService,
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
 * @param {Object} [options.memorySyncService] - MemorySyncService instance (v2.2.0)
 * @param {Object} [options.sessionManager] - SessionManager instance (for dashboard)
 * @param {Object} [options.configManager] - UnifiedConfigManager instance (for dashboard)
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
    memorySyncService,
    sessionManager,
    configManager,
    ipcMain,
  } = options;

  logger.info("[MemorySystem] Registering IPC handlers...");

  const preferenceIPC = registerPreferenceManagerIPC({
    preferenceManager,
    ipcMain,
  });

  const patternIPC = registerLearnedPatternManagerIPC({
    learnedPatternManager,
    ipcMain,
  });

  // Register new IPC handlers
  let backupIPC, reportIPC, behaviorIPC, contextIPC, syncIPC;

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

  // Register sync service IPC handlers (v2.2.0)
  if (memorySyncService) {
    syncIPC = registerMemorySyncIPC({
      memorySyncService,
      ipcMain,
    });
  }

  // Register dashboard IPC handlers (aggregates all managers)
  let dashboardIPC;
  dashboardIPC = registerMemoryDashboardIPC({
    preferenceManager,
    learnedPatternManager,
    autoBackupManager,
    usageReportGenerator,
    behaviorTracker,
    contextAssociator,
    sessionManager,
    configManager,
    ipcMain,
  });

  logger.info("[MemorySystem] IPC handlers registered");

  return {
    updatePreferenceManager: preferenceIPC?.updatePreferenceManager,
    updateLearnedPatternManager: patternIPC?.updateLearnedPatternManager,
    updateAutoBackupManager: backupIPC?.updateAutoBackupManager,
    updateUsageReportGenerator: reportIPC?.updateUsageReportGenerator,
    updateBehaviorTracker: behaviorIPC?.updateBehaviorTracker,
    updateContextAssociator: contextIPC?.updateContextAssociator,
    updateMemorySyncService: syncIPC?.updateSyncService,
    updateDashboard: dashboardIPC?.updateManagers,
  };
}

/**
 * Stop all memory system background tasks
 * @param {Object} managers - Manager instances
 */
function stopMemorySystem(managers) {
  logger.info("[MemorySystem] Stopping memory system...");

  if (managers.autoBackupManager) {
    managers.autoBackupManager.stopScheduleChecker();
  }

  if (managers.usageReportGenerator) {
    managers.usageReportGenerator.stopScheduleChecker();
  }

  if (managers.behaviorTracker) {
    managers.behaviorTracker.stopPeriodicAnalysis();
  }

  // Stop sync service (v2.2.0)
  if (managers.memorySyncService) {
    managers.memorySyncService.stop();
  }

  logger.info("[MemorySystem] Memory system stopped");
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

  // Sync Service (v2.2.0)
  MemorySyncService,

  // MemGPT Long-term Memory (v2.3.0)
  MemGPTCore,
  getMemGPTCore,
  MEMGPT_TOOLS,
  MemoryHierarchy,
  MemoryType,
  MemoryImportance,
  WorkingMemory,
  RecallMemory,
  ArchivalMemory,
  MemorySearchEngine,
  SearchMode,

  // IPC Registration
  registerPreferenceManagerIPC,
  registerLearnedPatternManagerIPC,
  registerAutoBackupManagerIPC,
  registerUsageReportGeneratorIPC,
  registerBehaviorTrackerIPC,
  registerContextAssociatorIPC,
  registerMemoryDashboardIPC,
  registerMemorySyncIPC,
  registerMemorySystemIPC,
  registerMemGPTIPC,

  // Initialization and Lifecycle
  initializeMemorySystem,
  stopMemorySystem,
};
