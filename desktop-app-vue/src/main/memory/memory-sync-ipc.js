/**
 * MemorySyncService IPC Handlers
 *
 * 提供内存数据同步服务的 IPC 接口
 *
 * @module memory-sync-ipc
 * @version 1.0.0
 * @since 2026-01-18
 */

const ipcGuard = require("../ipc-guard");

/**
 * Register Memory Sync IPC handlers
 * @param {Object} options - Options
 * @param {Object} options.memorySyncService - MemorySyncService instance
 * @param {Object} [options.ipcMain] - IPC main object (for testing)
 * @returns {Object} Handler update functions
 */
function registerMemorySyncIPC(options) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("memory-sync-ipc")) {
    console.log("[MemorySync IPC] Handlers already registered, skipping...");
    return;
  }

  const electron = require("electron");
  const ipcMain = options.ipcMain || electron.ipcMain;

  console.log("[MemorySync IPC] Registering handlers...");

  // Mutable reference for hot-reload
  let syncService = options.memorySyncService;

  // ============================================================
  // Sync Operations
  // ============================================================

  /**
   * Trigger full sync of all data to filesystem
   * Channel: 'memory-sync:sync-all'
   */
  ipcMain.handle("memory-sync:sync-all", async () => {
    try {
      if (!syncService) {
        throw new Error("MemorySyncService not initialized");
      }

      const result = await syncService.syncAll();
      return result;
    } catch (error) {
      console.error("[MemorySync IPC] Sync all failed:", error);
      throw error;
    }
  });

  /**
   * Sync specific category to filesystem
   * Channel: 'memory-sync:sync-category'
   */
  ipcMain.handle("memory-sync:sync-category", async (_event, category) => {
    try {
      if (!syncService) {
        throw new Error("MemorySyncService not initialized");
      }

      const result = await syncService.syncCategory(category);
      return result;
    } catch (error) {
      console.error(
        `[MemorySync IPC] Sync category ${category} failed:`,
        error,
      );
      throw error;
    }
  });

  /**
   * Get sync status
   * Channel: 'memory-sync:get-status'
   */
  ipcMain.handle("memory-sync:get-status", async () => {
    try {
      if (!syncService) {
        return {
          initialized: false,
          isSyncing: false,
          lastSyncTime: null,
          stats: null,
        };
      }

      return {
        initialized: true,
        ...syncService.getStatus(),
      };
    } catch (error) {
      console.error("[MemorySync IPC] Get status failed:", error);
      throw error;
    }
  });

  /**
   * Start periodic sync
   * Channel: 'memory-sync:start-periodic'
   */
  ipcMain.handle("memory-sync:start-periodic", async () => {
    try {
      if (!syncService) {
        throw new Error("MemorySyncService not initialized");
      }

      syncService.startPeriodicSync();
      return { success: true };
    } catch (error) {
      console.error("[MemorySync IPC] Start periodic sync failed:", error);
      throw error;
    }
  });

  /**
   * Stop periodic sync
   * Channel: 'memory-sync:stop-periodic'
   */
  ipcMain.handle("memory-sync:stop-periodic", async () => {
    try {
      if (!syncService) {
        throw new Error("MemorySyncService not initialized");
      }

      syncService.stopPeriodicSync();
      return { success: true };
    } catch (error) {
      console.error("[MemorySync IPC] Stop periodic sync failed:", error);
      throw error;
    }
  });

  /**
   * Generate sync report
   * Channel: 'memory-sync:generate-report'
   */
  ipcMain.handle("memory-sync:generate-report", async () => {
    try {
      if (!syncService) {
        throw new Error("MemorySyncService not initialized");
      }

      const report = await syncService.generateSyncReport();
      return report;
    } catch (error) {
      console.error("[MemorySync IPC] Generate report failed:", error);
      throw error;
    }
  });

  /**
   * Ensure all directories exist
   * Channel: 'memory-sync:ensure-directories'
   */
  ipcMain.handle("memory-sync:ensure-directories", async () => {
    try {
      if (!syncService) {
        throw new Error("MemorySyncService not initialized");
      }

      await syncService.ensureDirectories();
      return { success: true };
    } catch (error) {
      console.error("[MemorySync IPC] Ensure directories failed:", error);
      throw error;
    }
  });

  // Mark as registered
  ipcGuard.markModuleRegistered("memory-sync-ipc");

  console.log("[MemorySync IPC] Handlers registered successfully");

  return {
    updateSyncService: (newService) => {
      syncService = newService;
      console.log("[MemorySync IPC] SyncService reference updated");
    },
  };
}

module.exports = {
  registerMemorySyncIPC,
};
