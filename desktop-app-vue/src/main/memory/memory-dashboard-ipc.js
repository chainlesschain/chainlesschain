/**
 * Memory Dashboard IPC Handlers
 * Aggregates memory system data for the Memory Bank dashboard
 *
 * @module memory-dashboard-ipc
 * @version 1.0.0
 * @since 2026-01-18
 */

const fs = require("fs").promises;
const path = require("path");
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register Memory Dashboard IPC handlers
 * @param {Object} dependencies - Memory system managers
 * @param {Object} dependencies.preferenceManager - PreferenceManager instance
 * @param {Object} dependencies.learnedPatternManager - LearnedPatternManager instance
 * @param {Object} dependencies.autoBackupManager - AutoBackupManager instance
 * @param {Object} dependencies.usageReportGenerator - UsageReportGenerator instance
 * @param {Object} dependencies.behaviorTracker - BehaviorTracker instance
 * @param {Object} dependencies.contextAssociator - ContextAssociator instance
 * @param {Object} dependencies.sessionManager - SessionManager instance
 * @param {Object} dependencies.configManager - UnifiedConfigManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerMemoryDashboardIPC(dependencies) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("memory-dashboard-ipc")) {
    console.log(
      "[MemoryDashboard IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = dependencies.ipcMain || electron.ipcMain;

  console.log("[MemoryDashboard IPC] Registering handlers...");

  // Create mutable references for hot-reload support
  const refs = {
    preferenceManager: dependencies.preferenceManager,
    learnedPatternManager: dependencies.learnedPatternManager,
    autoBackupManager: dependencies.autoBackupManager,
    usageReportGenerator: dependencies.usageReportGenerator,
    behaviorTracker: dependencies.behaviorTracker,
    contextAssociator: dependencies.contextAssociator,
    sessionManager: dependencies.sessionManager,
    configManager: dependencies.configManager,
  };

  // ============================================================
  // Dashboard Overview Stats
  // ============================================================

  /**
   * Get aggregated stats for dashboard overview
   * Channel: 'memory:get-dashboard-stats'
   */
  ipcMain.handle("memory:get-dashboard-stats", async () => {
    try {
      const stats = {
        patterns: { total: 0, prompt: 0, errorFix: 0, snippet: 0, workflow: 0 },
        preferences: { total: 0, categories: 0 },
        sessions: { total: 0, withSummary: 0 },
        insights: { recommendations: 0, behaviors: 0 },
        storage: { totalSize: 0, backups: 0 },
      };

      // Get pattern stats
      if (refs.learnedPatternManager) {
        try {
          const patternStats = await refs.learnedPatternManager.getStats();
          stats.patterns = {
            total:
              (patternStats.promptPatterns?.count || 0) +
              (patternStats.errorFixes?.count || 0) +
              (patternStats.codeSnippets?.count || 0) +
              (patternStats.workflows?.count || 0),
            prompt: patternStats.promptPatterns?.count || 0,
            errorFix: patternStats.errorFixes?.count || 0,
            snippet: patternStats.codeSnippets?.count || 0,
            workflow: patternStats.workflows?.count || 0,
          };
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get pattern stats:", e);
        }
      }

      // Get preference stats
      if (refs.preferenceManager) {
        try {
          const prefStats = await refs.preferenceManager.getStats();
          stats.preferences = {
            total: prefStats.totalPreferences || 0,
            categories: prefStats.categories?.length || 0,
          };
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get preference stats:", e);
        }
      }

      // Get session stats
      if (refs.sessionManager) {
        try {
          const sessionStats = await refs.sessionManager.getGlobalStats();
          stats.sessions = {
            total: sessionStats.totalSessions || 0,
            withSummary: sessionStats.sessionsWithSummary || 0,
          };
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get session stats:", e);
        }
      }

      // Get behavior insights stats
      if (refs.behaviorTracker) {
        try {
          const behaviorStats = await refs.behaviorTracker.getStats();
          stats.insights = {
            recommendations: behaviorStats.recommendations?.count || 0,
            behaviors: behaviorStats.totalBehaviors || 0,
          };
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get behavior stats:", e);
        }
      }

      // Get storage stats
      if (refs.autoBackupManager) {
        try {
          const backupStats = await refs.autoBackupManager.getStats();
          stats.storage = {
            totalSize: backupStats.totalBackupSize || 0,
            backups: backupStats.totalBackups || 0,
          };
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get backup stats:", e);
        }
      }

      return stats;
    } catch (error) {
      console.error("[MemoryDashboard IPC] Get dashboard stats failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Pattern Operations
  // ============================================================

  /**
   * Get all patterns (aggregated by type)
   * Channel: 'memory:get-all-patterns'
   */
  ipcMain.handle("memory:get-all-patterns", async () => {
    try {
      if (!refs.learnedPatternManager) {
        return {
          promptPatterns: [],
          errorFixes: [],
          codeSnippets: [],
          workflows: [],
        };
      }

      const stats = await refs.learnedPatternManager.getStats();

      return {
        promptPatterns: stats.promptPatterns?.recentPatterns || [],
        errorFixes: stats.errorFixes?.recentFixes || [],
        codeSnippets: stats.codeSnippets?.recentSnippets || [],
        workflows: stats.workflows?.recentWorkflows || [],
      };
    } catch (error) {
      console.error("[MemoryDashboard IPC] Get all patterns failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Preference Operations
  // ============================================================

  /**
   * Get all preferences
   * Channel: 'memory:get-all-preferences'
   */
  ipcMain.handle("memory:get-all-preferences", async () => {
    try {
      if (!refs.preferenceManager) {
        return [];
      }

      const allPrefs = await refs.preferenceManager.getAll();

      // Convert to flat list for table display
      const list = [];
      for (const [category, prefs] of Object.entries(allPrefs)) {
        for (const [key, value] of Object.entries(prefs)) {
          list.push({
            category,
            key,
            value: typeof value === "object" ? JSON.stringify(value) : value,
            type: typeof value,
          });
        }
      }

      return list;
    } catch (error) {
      console.error("[MemoryDashboard IPC] Get all preferences failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Behavior Insights
  // ============================================================

  /**
   * Get behavior insights and recommendations
   * Channel: 'memory:get-behavior-insights'
   */
  ipcMain.handle("memory:get-behavior-insights", async () => {
    try {
      const insights = {
        usageHabits: [],
        recommendations: [],
      };

      if (refs.behaviorTracker) {
        try {
          const recommendations =
            await refs.behaviorTracker.getRecommendations();
          insights.recommendations = recommendations || [];

          const stats = await refs.behaviorTracker.getStats();
          insights.usageHabits = stats.usageHabits || [];
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get behavior insights:", e);
        }
      }

      return insights;
    } catch (error) {
      console.error(
        "[MemoryDashboard IPC] Get behavior insights failed:",
        error,
      );
      throw error;
    }
  });

  // ============================================================
  // Session Summaries
  // ============================================================

  /**
   * Get session list with summaries
   * Channel: 'memory:get-session-summaries'
   */
  ipcMain.handle(
    "memory:get-session-summaries",
    async (_event, options = {}) => {
      try {
        if (!refs.sessionManager) {
          return { sessions: [], total: 0 };
        }

        const result = await refs.sessionManager.loadSessions({
          limit: options.limit || 50,
          offset: options.offset || 0,
          sortBy: options.sortBy || "updated_at",
          sortOrder: options.sortOrder || "desc",
        });

        return result;
      } catch (error) {
        console.error(
          "[MemoryDashboard IPC] Get session summaries failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Generate summaries for sessions without summary
   * Channel: 'memory:generate-session-summaries'
   */
  ipcMain.handle(
    "memory:generate-session-summaries",
    async (_event, options = {}) => {
      try {
        if (!refs.sessionManager) {
          throw new Error("SessionManager not initialized");
        }

        const result = await refs.sessionManager.generateSummariesBatch({
          limit: options.limit || 10,
          overwrite: options.overwrite || false,
        });

        return result;
      } catch (error) {
        console.error(
          "[MemoryDashboard IPC] Generate summaries failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Export a single session summary to file
   * Channel: 'memory:export-session-summary'
   */
  ipcMain.handle(
    "memory:export-session-summary",
    async (_event, sessionId, format = "markdown") => {
      try {
        if (!refs.sessionManager) {
          throw new Error("SessionManager not initialized");
        }

        let content;
        let ext;

        if (format === "json") {
          content = await refs.sessionManager.exportToJSON(sessionId);
          ext = "json";
        } else {
          content = await refs.sessionManager.exportToMarkdown(sessionId, {
            includeMetadata: true,
          });
          ext = "md";
        }

        // Get session info for filename
        const session = await refs.sessionManager.loadSession(sessionId);
        const title = (session?.title || "session").replace(
          /[^a-zA-Z0-9_\u4e00-\u9fa5]/g,
          "_",
        );
        const filename = `${title}_${sessionId.substring(0, 8)}.${ext}`;

        // Save to exports directory
        const paths = refs.configManager?.getPaths();
        const exportsDir =
          paths?.exports ||
          path.join(process.cwd(), ".chainlesschain", "exports");
        await fs.mkdir(exportsDir, { recursive: true });

        const filePath = path.join(exportsDir, filename);
        await fs.writeFile(filePath, content, "utf-8");

        return { success: true, filePath, filename };
      } catch (error) {
        console.error(
          "[MemoryDashboard IPC] Export session summary failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Auto-Summary Management
  // ============================================================

  /**
   * Get auto-summary configuration and statistics
   * Channel: 'memory:get-auto-summary-info'
   */
  ipcMain.handle("memory:get-auto-summary-info", async () => {
    try {
      if (!refs.sessionManager) {
        return {
          config: null,
          stats: null,
          enabled: false,
        };
      }

      const config = refs.sessionManager.getAutoSummaryConfig();
      const stats = await refs.sessionManager.getAutoSummaryStats();

      return {
        config,
        stats,
        enabled: config.enabled,
      };
    } catch (error) {
      console.error(
        "[MemoryDashboard IPC] Get auto-summary info failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Update auto-summary configuration
   * Channel: 'memory:update-auto-summary-config'
   */
  ipcMain.handle(
    "memory:update-auto-summary-config",
    async (_event, config) => {
      try {
        if (!refs.sessionManager) {
          throw new Error("SessionManager not initialized");
        }

        return refs.sessionManager.updateAutoSummaryConfig(config);
      } catch (error) {
        console.error(
          "[MemoryDashboard IPC] Update auto-summary config failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Toggle background summary generator
   * Channel: 'memory:toggle-background-summary'
   */
  ipcMain.handle("memory:toggle-background-summary", async (_event, enable) => {
    try {
      if (!refs.sessionManager) {
        throw new Error("SessionManager not initialized");
      }

      if (enable) {
        refs.sessionManager.startBackgroundSummaryGenerator();
      } else {
        refs.sessionManager.stopBackgroundSummaryGenerator();
      }

      return {
        success: true,
        isRunning: refs.sessionManager.getAutoSummaryConfig().isRunning,
      };
    } catch (error) {
      console.error(
        "[MemoryDashboard IPC] Toggle background summary failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Trigger bulk summary generation for sessions without summaries
   * Channel: 'memory:trigger-auto-summaries'
   */
  ipcMain.handle(
    "memory:trigger-auto-summaries",
    async (_event, options = {}) => {
      try {
        if (!refs.sessionManager) {
          throw new Error("SessionManager not initialized");
        }

        const result = await refs.sessionManager.triggerBulkSummaryGeneration({
          overwrite: options.overwrite || false,
          limit: options.limit || 50,
        });

        return result;
      } catch (error) {
        console.error(
          "[MemoryDashboard IPC] Trigger auto-summaries failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Get sessions without summaries
   * Channel: 'memory:get-sessions-without-summary'
   */
  ipcMain.handle(
    "memory:get-sessions-without-summary",
    async (_event, options = {}) => {
      try {
        if (!refs.sessionManager) {
          return { sessions: [], total: 0 };
        }

        const sessions = await refs.sessionManager.getSessionsWithoutSummary({
          limit: options.limit || 50,
          minMessages: options.minMessages || 5,
        });

        return {
          sessions,
          total: sessions.length,
        };
      } catch (error) {
        console.error(
          "[MemoryDashboard IPC] Get sessions without summary failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Storage Management
  // ============================================================

  /**
   * Get storage statistics
   * Channel: 'memory:get-storage-stats'
   */
  ipcMain.handle("memory:get-storage-stats", async () => {
    try {
      const stats = {
        backups: { count: 0, totalSize: 0, lastBackup: null },
        patterns: { count: 0, estimatedSize: 0 },
        preferences: { count: 0, estimatedSize: 0 },
        sessions: { count: 0, totalMessages: 0 },
        memoryDir: null,
      };

      // Get backup stats
      if (refs.autoBackupManager) {
        try {
          const backupStats = await refs.autoBackupManager.getStats();
          stats.backups = {
            count: backupStats.totalBackups || 0,
            totalSize: backupStats.totalBackupSize || 0,
            lastBackup: backupStats.lastBackupTime || null,
          };
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get backup stats:", e);
        }
      }

      // Get pattern count
      if (refs.learnedPatternManager) {
        try {
          const patternStats = await refs.learnedPatternManager.getStats();
          stats.patterns.count =
            (patternStats.promptPatterns?.count || 0) +
            (patternStats.errorFixes?.count || 0) +
            (patternStats.codeSnippets?.count || 0) +
            (patternStats.workflows?.count || 0);
          stats.patterns.estimatedSize = stats.patterns.count * 2048; // ~2KB per pattern
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get pattern stats:", e);
        }
      }

      // Get preference count
      if (refs.preferenceManager) {
        try {
          const prefStats = await refs.preferenceManager.getStats();
          stats.preferences.count = prefStats.totalPreferences || 0;
          stats.preferences.estimatedSize = stats.preferences.count * 512; // ~512B per pref
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get preference stats:", e);
        }
      }

      // Get session count
      if (refs.sessionManager) {
        try {
          const sessionStats = await refs.sessionManager.getGlobalStats();
          stats.sessions.count = sessionStats.totalSessions || 0;
          stats.sessions.totalMessages = sessionStats.totalMessages || 0;
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to get session stats:", e);
        }
      }

      // Get memory directory path
      const paths = refs.configManager?.getPaths();
      stats.memoryDir =
        paths?.memory || path.join(process.cwd(), ".chainlesschain", "memory");

      return stats;
    } catch (error) {
      console.error("[MemoryDashboard IPC] Get storage stats failed:", error);
      throw error;
    }
  });

  /**
   * Create a manual backup
   * Channel: 'memory:create-backup'
   */
  ipcMain.handle("memory:create-backup", async (_event, type = "full") => {
    try {
      if (!refs.autoBackupManager) {
        throw new Error("AutoBackupManager not initialized");
      }

      let result;
      if (type === "full") {
        result = await refs.autoBackupManager.createFullBackup();
      } else {
        result = await refs.autoBackupManager.createIncrementalBackup(type);
      }

      return result;
    } catch (error) {
      console.error("[MemoryDashboard IPC] Create backup failed:", error);
      throw error;
    }
  });

  /**
   * Clean up expired data
   * Channel: 'memory:cleanup-expired'
   */
  ipcMain.handle("memory:cleanup-expired", async (_event, options = {}) => {
    try {
      const results = {
        preferences: 0,
        backups: 0,
        patterns: 0,
      };

      // Clean preferences
      if (refs.preferenceManager) {
        try {
          const cleaned = await refs.preferenceManager.cleanup({
            maxAgeDays: options.maxAgeDays || 90,
          });
          results.preferences = cleaned?.deletedCount || 0;
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to cleanup preferences:", e);
        }
      }

      // Clean old backups
      if (refs.autoBackupManager) {
        try {
          const cleaned = await refs.autoBackupManager.cleanupOldBackups({
            maxAgeDays: options.maxAgeDays || 30,
          });
          results.backups = cleaned?.deletedCount || 0;
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to cleanup backups:", e);
        }
      }

      return results;
    } catch (error) {
      console.error("[MemoryDashboard IPC] Cleanup expired failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Data Export
  // ============================================================

  /**
   * Export all memory data to files
   * Channel: 'memory:export-data'
   */
  ipcMain.handle("memory:export-data", async (_event, exportType = "all") => {
    try {
      const paths = refs.configManager?.getPaths();
      const exportsDir =
        paths?.exports ||
        path.join(process.cwd(), ".chainlesschain", "exports");
      await fs.mkdir(exportsDir, { recursive: true });

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const exportDir = path.join(exportsDir, `memory-export-${timestamp}`);
      await fs.mkdir(exportDir, { recursive: true });

      const exportedFiles = [];

      // Export preferences
      if (
        (exportType === "all" || exportType === "preferences") &&
        refs.preferenceManager
      ) {
        try {
          const allPrefs = await refs.preferenceManager.getAll();
          const prefFile = path.join(exportDir, "preferences.json");
          await fs.writeFile(
            prefFile,
            JSON.stringify(allPrefs, null, 2),
            "utf-8",
          );
          exportedFiles.push({ type: "preferences", file: prefFile });
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to export preferences:", e);
        }
      }

      // Export patterns
      if (
        (exportType === "all" || exportType === "patterns") &&
        refs.learnedPatternManager
      ) {
        try {
          const stats = await refs.learnedPatternManager.getStats();
          const patternFile = path.join(exportDir, "patterns.json");
          await fs.writeFile(
            patternFile,
            JSON.stringify(
              {
                promptPatterns: stats.promptPatterns?.recentPatterns || [],
                errorFixes: stats.errorFixes?.recentFixes || [],
                codeSnippets: stats.codeSnippets?.recentSnippets || [],
                workflows: stats.workflows?.recentWorkflows || [],
              },
              null,
              2,
            ),
            "utf-8",
          );
          exportedFiles.push({ type: "patterns", file: patternFile });
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to export patterns:", e);
        }
      }

      // Export sessions (just metadata)
      if (
        (exportType === "all" || exportType === "sessions") &&
        refs.sessionManager
      ) {
        try {
          const { sessions } = await refs.sessionManager.loadSessions({
            limit: 1000,
          });
          const sessionFile = path.join(exportDir, "sessions.json");
          await fs.writeFile(
            sessionFile,
            JSON.stringify(sessions, null, 2),
            "utf-8",
          );
          exportedFiles.push({ type: "sessions", file: sessionFile });
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to export sessions:", e);
        }
      }

      // Export behavior insights
      if (
        (exportType === "all" || exportType === "insights") &&
        refs.behaviorTracker
      ) {
        try {
          const stats = await refs.behaviorTracker.getStats();
          const recommendations =
            await refs.behaviorTracker.getRecommendations();
          const insightsFile = path.join(exportDir, "insights.json");
          await fs.writeFile(
            insightsFile,
            JSON.stringify(
              {
                stats,
                recommendations,
              },
              null,
              2,
            ),
            "utf-8",
          );
          exportedFiles.push({ type: "insights", file: insightsFile });
        } catch (e) {
          console.warn("[MemoryDashboard] Failed to export insights:", e);
        }
      }

      return {
        success: true,
        exportDir,
        files: exportedFiles,
        timestamp,
      };
    } catch (error) {
      console.error("[MemoryDashboard IPC] Export data failed:", error);
      throw error;
    }
  });

  // Mark as registered
  ipcGuard.markModuleRegistered("memory-dashboard-ipc");

  console.log("[MemoryDashboard IPC] Handlers registered successfully");

  return {
    updateManagers: (newDeps) => {
      Object.assign(refs, newDeps);
      console.log("[MemoryDashboard IPC] Manager references updated");
    },
  };
}

module.exports = {
  registerMemoryDashboardIPC,
};
