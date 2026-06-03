/**
 * @module core/core-ipc
 * Phase 79: IPC handlers for core services (4 handlers)
 *
 * Handlers:
 * 1. core:cache-stats - Get shared cache statistics
 * 2. core:event-bus-stats - Get event bus statistics
 * 3. core:service-health - Get service container health
 * 4. core:resource-usage - Get resource pool usage
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerCoreIPC(deps) {
  const { sharedCacheManager, eventBus, serviceContainer, resourcePool } = deps;

  ipcMain.handle("core:cache-stats", async () => {
    try {
      if (!sharedCacheManager) {
        return { success: false, error: "SharedCacheManager not available" };
      }
      return { success: true, data: sharedCacheManager.getStats() };
    } catch (error) {
      logger.error("[CoreIPC] cache-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("core:event-bus-stats", async () => {
    try {
      if (!eventBus) {
        return { success: false, error: "EventBus not available" };
      }
      return { success: true, data: eventBus.getStats() };
    } catch (error) {
      logger.error("[CoreIPC] event-bus-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("core:service-health", async () => {
    try {
      if (!serviceContainer) {
        return { success: false, error: "ServiceContainer not available" };
      }
      return { success: true, data: serviceContainer.getHealth() };
    } catch (error) {
      logger.error("[CoreIPC] service-health error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("core:resource-usage", async () => {
    try {
      if (!resourcePool) {
        return { success: false, error: "ResourcePool not available" };
      }
      return { success: true, data: resourcePool.getUsage() };
    } catch (error) {
      logger.error("[CoreIPC] resource-usage error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[CoreIPC] Registered 4 core service handlers");
}

module.exports = { registerCoreIPC };
