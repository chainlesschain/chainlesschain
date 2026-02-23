/**
 * Memory-Augmented Generation IPC Handlers
 *
 * Registers 8 IPC handlers for the Long-term Memory Enhancement system (F8),
 * enabling the renderer process to access preferences, patterns, insights,
 * feedback, search, and history management.
 *
 * @module llm/memory-augmented-ipc
 * @version 1.0.0
 * @since 2026-02-23
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * All IPC channels for the memory-augmented system
 */
const MEMORY_AUG_CHANNELS = [
  "memory-aug:get-preferences",
  "memory-aug:update-preference",
  "memory-aug:delete-preference",
  "memory-aug:get-patterns",
  "memory-aug:get-insights",
  "memory-aug:record-feedback",
  "memory-aug:search-history",
  "memory-aug:clear-history",
];

/**
 * Register all memory-augmented IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.memoryAugManager - MemoryAugmentedGeneration instance
 * @param {Object} deps.preferenceLearner - UserPreferenceLearner instance
 * @param {Object} deps.patternAnalyzer - BehaviorPatternAnalyzer instance
 */
function registerMemoryAugIPC({ memoryAugManager, preferenceLearner, patternAnalyzer }) {
  if (!memoryAugManager && !preferenceLearner && !patternAnalyzer) {
    logger.warn(
      "[MemoryAugIPC] No managers provided, registering fallback handlers",
    );
    for (const channel of MEMORY_AUG_CHANNELS) {
      ipcMain.handle(channel, async () => ({
        success: false,
        error: "Memory-Augmented system is not initialized",
        code: "MEMORY_AUG_UNAVAILABLE",
      }));
    }
    return;
  }

  // ============================================================
  // Preference Operations
  // ============================================================

  /**
   * Get user preferences, optionally filtered by category
   * @param {string} [category] - Filter by preference category
   */
  ipcMain.handle("memory-aug:get-preferences", async (_event, category) => {
    try {
      if (!preferenceLearner) {
        return { success: false, error: "PreferenceLearner is not initialized" };
      }
      const preferences = preferenceLearner.getPreferences(category);
      return { success: true, data: preferences };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] get-preferences error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  /**
   * Manually update or create a user preference
   * @param {Object} data - { category, key, value, source }
   */
  ipcMain.handle("memory-aug:update-preference", async (_event, data = {}) => {
    try {
      if (!preferenceLearner) {
        return { success: false, error: "PreferenceLearner is not initialized" };
      }
      if (!data.category || !data.key || data.value === undefined) {
        return {
          success: false,
          error: "category, key, and value are required",
        };
      }
      const preference = preferenceLearner.updatePreference(
        data.category,
        data.key,
        data.value,
        data.source || "explicit",
      );
      if (!preference) {
        return { success: false, error: "Failed to update preference" };
      }
      return { success: true, data: preference };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] update-preference error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete a specific preference by ID
   * @param {string} id - Preference ID
   */
  ipcMain.handle("memory-aug:delete-preference", async (_event, id) => {
    try {
      if (!preferenceLearner) {
        return { success: false, error: "PreferenceLearner is not initialized" };
      }
      if (!id) {
        return { success: false, error: "Preference ID is required" };
      }
      const deleted = preferenceLearner.deletePreference(id);
      return { success: deleted };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] delete-preference error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Pattern Operations
  // ============================================================

  /**
   * Get behavior patterns, optionally filtered by type
   * @param {Object} [options] - { patternType, minConfidence, limit, sortBy }
   */
  ipcMain.handle("memory-aug:get-patterns", async (_event, options = {}) => {
    try {
      if (!patternAnalyzer) {
        return { success: false, error: "PatternAnalyzer is not initialized" };
      }
      const patterns = patternAnalyzer.getPatterns(
        options.patternType,
        {
          minConfidence: options.minConfidence,
          limit: options.limit,
          sortBy: options.sortBy,
        },
      );
      return { success: true, data: patterns };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] get-patterns error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Insights & Analysis
  // ============================================================

  /**
   * Get interaction insights and statistics
   */
  ipcMain.handle("memory-aug:get-insights", async () => {
    try {
      if (!memoryAugManager) {
        return { success: false, error: "MemoryAugManager is not initialized" };
      }
      const insights = memoryAugManager.getInsights();
      return { success: true, data: insights };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] get-insights error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Feedback & History
  // ============================================================

  /**
   * Record feedback for a specific interaction
   * @param {Object} data - { interactionId, feedback }
   */
  ipcMain.handle("memory-aug:record-feedback", async (_event, data = {}) => {
    try {
      if (!memoryAugManager) {
        return { success: false, error: "MemoryAugManager is not initialized" };
      }
      if (!data.interactionId) {
        return { success: false, error: "interactionId is required" };
      }
      if (data.feedback === undefined) {
        return { success: false, error: "feedback is required" };
      }
      const result = memoryAugManager.recordFeedback(
        data.interactionId,
        data.feedback,
      );
      return { success: result };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] record-feedback error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  /**
   * Search past interactions
   * @param {Object} data - { query, options }
   */
  ipcMain.handle("memory-aug:search-history", async (_event, data = {}) => {
    try {
      if (!memoryAugManager) {
        return { success: false, error: "MemoryAugManager is not initialized" };
      }
      if (!data.query) {
        return { success: false, error: "query is required" };
      }
      const results = memoryAugManager.searchHistory(
        data.query,
        data.options || {},
      );
      return { success: true, data: results };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] search-history error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  /**
   * Clear interaction history with optional filters
   * @param {Object} [options] - { startTime, endTime, taskType }
   */
  ipcMain.handle("memory-aug:clear-history", async (_event, options = {}) => {
    try {
      if (!memoryAugManager) {
        return { success: false, error: "MemoryAugManager is not initialized" };
      }
      const result = memoryAugManager.clearHistory(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[MemoryAugIPC] clear-history error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[MemoryAugIPC] Registered ${MEMORY_AUG_CHANNELS.length} IPC handlers`,
  );
}

/**
 * Unregister all memory-augmented IPC handlers
 */
function unregisterMemoryAugIPC() {
  for (const channel of MEMORY_AUG_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info("[MemoryAugIPC] Unregistered all handlers");
}

module.exports = {
  registerMemoryAugIPC,
  unregisterMemoryAugIPC,
  MEMORY_AUG_CHANNELS,
};
