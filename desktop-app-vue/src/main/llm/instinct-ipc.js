/**
 * Instinct Learning System - IPC Handlers
 *
 * Registers IPC handlers for the instinct learning system,
 * enabling renderer process access to instinct CRUD, retrieval,
 * confidence adjustment, evolution, and statistics.
 *
 * @module llm/instinct-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * All IPC channels for the instinct system
 */
const INSTINCT_CHANNELS = [
  "instinct:get-all",
  "instinct:get-relevant",
  "instinct:add",
  "instinct:update",
  "instinct:delete",
  "instinct:reinforce",
  "instinct:decay",
  "instinct:evolve",
  "instinct:export",
  "instinct:import",
  "instinct:get-stats",
];

/**
 * Register all instinct IPC handlers
 * @param {import('./instinct-manager').InstinctManager} instinctManager - Manager instance
 */
function registerInstinctIPC(instinctManager) {
  if (!instinctManager) {
    logger.warn(
      "[InstinctIPC] No instinct manager provided, registering fallbacks",
    );
    for (const channel of INSTINCT_CHANNELS) {
      ipcMain.handle(channel, async () => ({
        success: false,
        error: "InstinctManager is not initialized",
        code: "INSTINCT_UNAVAILABLE",
      }));
    }
    return;
  }

  // ============================================================
  // Read Operations
  // ============================================================

  /**
   * Get all instincts with optional filters
   * @param {Object} filters - { category, minConfidence, source, orderBy, limit }
   */
  ipcMain.handle("instinct:get-all", async (_event, filters = {}) => {
    try {
      const instincts = instinctManager.getAll(filters);
      return { success: true, data: instincts };
    } catch (error) {
      logger.error("[InstinctIPC] get-all error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get relevant instincts for a given context
   * @param {string} context - Current context/query text
   * @param {number} limit - Max instincts to return
   */
  ipcMain.handle(
    "instinct:get-relevant",
    async (_event, context, limit = 5) => {
      try {
        const instincts = instinctManager.getRelevantInstincts(context, limit);
        return { success: true, data: instincts };
      } catch (error) {
        logger.error("[InstinctIPC] get-relevant error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Write Operations
  // ============================================================

  /**
   * Add a new instinct
   * @param {Object} data - { pattern, confidence, category, examples }
   */
  ipcMain.handle("instinct:add", async (_event, data = {}) => {
    try {
      if (!data.pattern) {
        return { success: false, error: "Pattern is required" };
      }
      const instinct = instinctManager.addInstinct(
        data.pattern,
        data.confidence,
        data.category,
        { source: "manual", examples: data.examples },
      );
      return { success: true, data: instinct };
    } catch (error) {
      logger.error("[InstinctIPC] add error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update an existing instinct
   * @param {string} id - Instinct ID
   * @param {Object} updates - Fields to update
   */
  ipcMain.handle("instinct:update", async (_event, id, updates = {}) => {
    try {
      if (!id) {
        return { success: false, error: "Instinct ID is required" };
      }
      const instinct = instinctManager.updateInstinct(id, updates);
      if (!instinct) {
        return { success: false, error: "Instinct not found" };
      }
      return { success: true, data: instinct };
    } catch (error) {
      logger.error("[InstinctIPC] update error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete an instinct
   * @param {string} id - Instinct ID
   */
  ipcMain.handle("instinct:delete", async (_event, id) => {
    try {
      if (!id) {
        return { success: false, error: "Instinct ID is required" };
      }
      const deleted = instinctManager.deleteInstinct(id);
      return { success: deleted };
    } catch (error) {
      logger.error("[InstinctIPC] delete error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Confidence Adjustment
  // ============================================================

  /**
   * Reinforce an instinct (increase confidence)
   * @param {string} id - Instinct ID
   */
  ipcMain.handle("instinct:reinforce", async (_event, id) => {
    try {
      if (!id) {
        return { success: false, error: "Instinct ID is required" };
      }
      const instinct = instinctManager.reinforceInstinct(id);
      if (!instinct) {
        return { success: false, error: "Instinct not found" };
      }
      return { success: true, data: instinct };
    } catch (error) {
      logger.error("[InstinctIPC] reinforce error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Decay an instinct (decrease confidence)
   * @param {string} id - Instinct ID
   */
  ipcMain.handle("instinct:decay", async (_event, id) => {
    try {
      if (!id) {
        return { success: false, error: "Instinct ID is required" };
      }
      const instinct = instinctManager.decayInstinct(id);
      if (!instinct) {
        return { success: false, error: "Instinct not found" };
      }
      return { success: true, data: instinct };
    } catch (error) {
      logger.error("[InstinctIPC] decay error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Evolution & Analysis
  // ============================================================

  /**
   * Trigger instinct evolution (pattern extraction from observations)
   */
  ipcMain.handle("instinct:evolve", async () => {
    try {
      const result = await instinctManager.evolveInstincts();
      return { success: result.success, data: result };
    } catch (error) {
      logger.error("[InstinctIPC] evolve error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Export / Import
  // ============================================================

  /**
   * Export all instincts as JSON
   */
  ipcMain.handle("instinct:export", async () => {
    try {
      const data = instinctManager.exportInstincts();
      return { success: true, data };
    } catch (error) {
      logger.error("[InstinctIPC] export error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import instincts from JSON
   * @param {Object} data - Export data to import
   */
  ipcMain.handle("instinct:import", async (_event, data) => {
    try {
      if (!data) {
        return { success: false, error: "Import data is required" };
      }
      const result = instinctManager.importInstincts(data);
      return result;
    } catch (error) {
      logger.error("[InstinctIPC] import error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get instinct system statistics
   */
  ipcMain.handle("instinct:get-stats", async () => {
    try {
      const stats = instinctManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[InstinctIPC] get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[InstinctIPC] Registered ${INSTINCT_CHANNELS.length} IPC handlers`,
  );
}

/**
 * Unregister all instinct IPC handlers
 */
function unregisterInstinctIPC() {
  for (const channel of INSTINCT_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info("[InstinctIPC] Unregistered all handlers");
}

module.exports = {
  registerInstinctIPC,
  unregisterInstinctIPC,
  INSTINCT_CHANNELS,
};
