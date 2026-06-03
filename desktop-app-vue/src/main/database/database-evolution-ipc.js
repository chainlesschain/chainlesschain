/**
 * @module database/database-evolution-ipc
 * Phase 80: IPC handlers for database evolution features (4 handlers)
 *
 * Handlers:
 * 1. db:migration-status - Get migration status
 * 2. db:run-migration - Run pending migrations
 * 3. db:index-suggestions - Get index optimization suggestions
 * 4. db:query-stats - Get query performance statistics
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerDatabaseEvolutionIPC(deps) {
  const { migrationManager, indexOptimizer } = deps;

  ipcMain.handle("db:migration-status", async () => {
    try {
      if (!migrationManager) {
        return { success: false, error: "MigrationManager not available" };
      }
      return { success: true, data: migrationManager.getStatus() };
    } catch (error) {
      logger.error(
        "[DatabaseEvolutionIPC] migration-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("db:run-migration", async () => {
    try {
      if (!migrationManager) {
        return { success: false, error: "MigrationManager not available" };
      }
      const result = await migrationManager.runAll();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DatabaseEvolutionIPC] run-migration error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("db:index-suggestions", async () => {
    try {
      if (!indexOptimizer) {
        return { success: false, error: "IndexOptimizer not available" };
      }
      const result = indexOptimizer.analyze();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[DatabaseEvolutionIPC] index-suggestions error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("db:query-stats", async () => {
    try {
      if (!indexOptimizer) {
        return { success: false, error: "IndexOptimizer not available" };
      }
      return { success: true, data: indexOptimizer.getQueryStats() };
    } catch (error) {
      logger.error("[DatabaseEvolutionIPC] query-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    "[DatabaseEvolutionIPC] Registered 4 database evolution handlers",
  );
}

module.exports = { registerDatabaseEvolutionIPC };
