/**
 * PreferenceManager IPC Handlers
 * Handles IPC communication for preference management
 *
 * @module preference-manager-ipc
 * @version 1.0.0
 * @since 2026-01-17
 */

const { logger, createLogger } = require('../utils/logger.js');
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all PreferenceManager IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.preferenceManager - PreferenceManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerPreferenceManagerIPC({
  preferenceManager,
  ipcMain: injectedIpcMain,
}) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("preference-manager-ipc")) {
    logger.info(
      "[PreferenceManager IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info(
    "[PreferenceManager IPC] Registering PreferenceManager IPC handlers...",
  );

  // Create mutable reference for hot-reload support
  const managerRef = { current: preferenceManager };

  // ============================================================
  // Preference CRUD Operations
  // ============================================================

  /**
   * Get a single preference
   * Channel: 'preference:get'
   */
  ipcMain.handle(
    "preference:get",
    async (_event, category, key, defaultValue = null) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.get(category, key, defaultValue);
      } catch (error) {
        logger.error("[PreferenceManager IPC] Get failed:", error);
        throw error;
      }
    },
  );

  /**
   * Set a single preference
   * Channel: 'preference:set'
   */
  ipcMain.handle(
    "preference:set",
    async (_event, category, key, value, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.set(category, key, value, options);
      } catch (error) {
        logger.error("[PreferenceManager IPC] Set failed:", error);
        throw error;
      }
    },
  );

  /**
   * Delete a preference
   * Channel: 'preference:delete'
   */
  ipcMain.handle("preference:delete", async (_event, category, key) => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.delete(category, key);
    } catch (error) {
      logger.error("[PreferenceManager IPC] Delete failed:", error);
      throw error;
    }
  });

  /**
   * Get all preferences in a category
   * Channel: 'preference:get-category'
   */
  ipcMain.handle("preference:get-category", async (_event, category) => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.getCategory(category);
    } catch (error) {
      logger.error("[PreferenceManager IPC] Get category failed:", error);
      throw error;
    }
  });

  /**
   * Set multiple preferences in a category
   * Channel: 'preference:set-category'
   */
  ipcMain.handle(
    "preference:set-category",
    async (_event, category, values) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.setCategory(category, values);
      } catch (error) {
        logger.error("[PreferenceManager IPC] Set category failed:", error);
        throw error;
      }
    },
  );

  /**
   * Get all preferences
   * Channel: 'preference:get-all'
   */
  ipcMain.handle("preference:get-all", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.getAll();
    } catch (error) {
      logger.error("[PreferenceManager IPC] Get all failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Usage History
  // ============================================================

  /**
   * Record a usage event
   * Channel: 'preference:record-usage'
   */
  ipcMain.handle(
    "preference:record-usage",
    async (_event, feature, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.recordUsage(feature, options);
      } catch (error) {
        logger.error("[PreferenceManager IPC] Record usage failed:", error);
        throw error;
      }
    },
  );

  /**
   * Get recent usage history
   * Channel: 'preference:get-recent-history'
   */
  ipcMain.handle(
    "preference:get-recent-history",
    async (_event, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.getRecentHistory(options);
      } catch (error) {
        logger.error("[PreferenceManager IPC] Get history failed:", error);
        throw error;
      }
    },
  );

  /**
   * Get usage statistics
   * Channel: 'preference:get-usage-stats'
   */
  ipcMain.handle("preference:get-usage-stats", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.getUsageStats(options);
    } catch (error) {
      logger.error("[PreferenceManager IPC] Get usage stats failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Search History
  // ============================================================

  /**
   * Add to search history
   * Channel: 'preference:add-search-history'
   */
  ipcMain.handle(
    "preference:add-search-history",
    async (_event, query, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.addSearchHistory(query, options);
      } catch (error) {
        logger.error(
          "[PreferenceManager IPC] Add search history failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Get search history
   * Channel: 'preference:get-search-history'
   */
  ipcMain.handle(
    "preference:get-search-history",
    async (_event, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.getSearchHistory(options);
      } catch (error) {
        logger.error(
          "[PreferenceManager IPC] Get search history failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Get search suggestions
   * Channel: 'preference:get-search-suggestions'
   */
  ipcMain.handle(
    "preference:get-search-suggestions",
    async (_event, prefix, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.getSearchSuggestions(prefix, options);
      } catch (error) {
        logger.error("[PreferenceManager IPC] Get suggestions failed:", error);
        throw error;
      }
    },
  );

  /**
   * Clear search history
   * Channel: 'preference:clear-search-history'
   */
  ipcMain.handle(
    "preference:clear-search-history",
    async (_event, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("PreferenceManager not initialized");
        }
        return await managerRef.current.clearSearchHistory(options);
      } catch (error) {
        logger.error(
          "[PreferenceManager IPC] Clear search history failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Backup and Restore
  // ============================================================

  /**
   * Backup all preferences
   * Channel: 'preference:backup'
   */
  ipcMain.handle("preference:backup", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.backupAll();
    } catch (error) {
      logger.error("[PreferenceManager IPC] Backup failed:", error);
      throw error;
    }
  });

  /**
   * Restore from backup
   * Channel: 'preference:restore'
   */
  ipcMain.handle("preference:restore", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.restoreFromBackup(options);
    } catch (error) {
      logger.error("[PreferenceManager IPC] Restore failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Statistics and Maintenance
  // ============================================================

  /**
   * Get statistics
   * Channel: 'preference:get-stats'
   */
  ipcMain.handle("preference:get-stats", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.getStats();
    } catch (error) {
      logger.error("[PreferenceManager IPC] Get stats failed:", error);
      throw error;
    }
  });

  /**
   * Clear cache
   * Channel: 'preference:clear-cache'
   */
  ipcMain.handle("preference:clear-cache", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      managerRef.current.clearCache();
      return { success: true };
    } catch (error) {
      logger.error("[PreferenceManager IPC] Clear cache failed:", error);
      throw error;
    }
  });

  /**
   * Cleanup old records
   * Channel: 'preference:cleanup'
   */
  ipcMain.handle("preference:cleanup", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("PreferenceManager not initialized");
      }
      return await managerRef.current.cleanup(options);
    } catch (error) {
      logger.error("[PreferenceManager IPC] Cleanup failed:", error);
      throw error;
    }
  });

  /**
   * Update PreferenceManager reference
   * For hot-reload or reinitialization
   * @param {PreferenceManager} newManager - New PreferenceManager instance
   */
  function updatePreferenceManager(newManager) {
    managerRef.current = newManager;
    logger.info("[PreferenceManager IPC] Reference updated");
  }

  // Mark as registered
  ipcGuard.markModuleRegistered("preference-manager-ipc");

  logger.info(
    "[PreferenceManager IPC] PreferenceManager IPC handlers registered successfully",
  );

  return {
    updatePreferenceManager,
  };
}

module.exports = {
  registerPreferenceManagerIPC,
};
