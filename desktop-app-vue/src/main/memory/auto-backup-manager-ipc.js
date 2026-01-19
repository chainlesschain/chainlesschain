/**
 * AutoBackupManager IPC Handlers
 * Handles IPC communication for automatic backup management
 *
 * @module auto-backup-manager-ipc
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger, createLogger } = require('../utils/logger.js');
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all AutoBackupManager IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.autoBackupManager - AutoBackupManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerAutoBackupManagerIPC({
  autoBackupManager,
  ipcMain: injectedIpcMain,
}) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("auto-backup-manager-ipc")) {
    logger.info(
      "[AutoBackupManager IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info(
    "[AutoBackupManager IPC] Registering AutoBackupManager IPC handlers...",
  );

  // Create mutable reference for hot-reload support
  const managerRef = { current: autoBackupManager };

  // ============================================================
  // Backup Operations
  // ============================================================

  /**
   * Create a full backup
   * Channel: 'backup:create-full'
   */
  ipcMain.handle("backup:create-full", async (_event, scope = "all") => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.createFullBackup(scope);
    } catch (error) {
      logger.error(
        "[AutoBackupManager IPC] Create full backup failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Create an incremental backup
   * Channel: 'backup:create-incremental'
   */
  ipcMain.handle("backup:create-incremental", async (_event, scope = "all") => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.createIncrementalBackup(scope);
    } catch (error) {
      logger.error(
        "[AutoBackupManager IPC] Create incremental backup failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Restore from backup
   * Channel: 'backup:restore'
   */
  ipcMain.handle("backup:restore", async (_event, backupId, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.restoreFromBackup(backupId, options);
    } catch (error) {
      logger.error("[AutoBackupManager IPC] Restore backup failed:", error);
      throw error;
    }
  });

  /**
   * Delete a backup
   * Channel: 'backup:delete'
   */
  ipcMain.handle("backup:delete", async (_event, backupId) => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      await managerRef.current.deleteBackup(backupId);
      return { success: true };
    } catch (error) {
      logger.error("[AutoBackupManager IPC] Delete backup failed:", error);
      throw error;
    }
  });

  /**
   * Get backup history
   * Channel: 'backup:list'
   */
  ipcMain.handle("backup:list", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.getBackupHistory(options);
    } catch (error) {
      logger.error("[AutoBackupManager IPC] List backups failed:", error);
      throw error;
    }
  });

  /**
   * Get backup statistics
   * Channel: 'backup:get-stats'
   */
  ipcMain.handle("backup:get-stats", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.getStats();
    } catch (error) {
      logger.error("[AutoBackupManager IPC] Get stats failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Schedule Management
  // ============================================================

  /**
   * Configure a backup schedule
   * Channel: 'backup:configure-schedule'
   */
  ipcMain.handle("backup:configure-schedule", async (_event, config) => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.configureSchedule(config);
    } catch (error) {
      logger.error(
        "[AutoBackupManager IPC] Configure schedule failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Update a backup schedule
   * Channel: 'backup:update-schedule'
   */
  ipcMain.handle("backup:update-schedule", async (_event, id, updates) => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.updateSchedule(id, updates);
    } catch (error) {
      logger.error("[AutoBackupManager IPC] Update schedule failed:", error);
      throw error;
    }
  });

  /**
   * Delete a backup schedule
   * Channel: 'backup:delete-schedule'
   */
  ipcMain.handle("backup:delete-schedule", async (_event, id) => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      await managerRef.current.deleteSchedule(id);
      return { success: true };
    } catch (error) {
      logger.error("[AutoBackupManager IPC] Delete schedule failed:", error);
      throw error;
    }
  });

  /**
   * Get all schedules
   * Channel: 'backup:get-schedules'
   */
  ipcMain.handle("backup:get-schedules", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("AutoBackupManager not initialized");
      }
      return await managerRef.current.getSchedules();
    } catch (error) {
      logger.error("[AutoBackupManager IPC] Get schedules failed:", error);
      throw error;
    }
  });

  /**
   * Update AutoBackupManager reference
   * For hot-reload or reinitialization
   * @param {AutoBackupManager} newManager - New instance
   */
  function updateAutoBackupManager(newManager) {
    managerRef.current = newManager;
    logger.info("[AutoBackupManager IPC] Reference updated");
  }

  // Mark as registered
  ipcGuard.markModuleRegistered("auto-backup-manager-ipc");

  logger.info(
    "[AutoBackupManager IPC] AutoBackupManager IPC handlers registered successfully",
  );

  return {
    updateAutoBackupManager,
  };
}

module.exports = {
  registerAutoBackupManagerIPC,
};
