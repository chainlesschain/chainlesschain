/**
 * Recommendation IPC Handlers
 *
 * IPC bridge for the Smart Content Recommendation system (Phase 48).
 * Provides 6 handlers for recommendations and interest profiles.
 *
 * @module social/recommendation-ipc
 * @description Handles recommendation:* and interest profile IPC channels
 */

const { ipcMain: electronIpcMain } = require("electron");
const ipcGuardModule = require("../ipc/ipc-guard.js");
const { logger } = require("../utils/logger.js");

/**
 * Register all Recommendation IPC handlers
 * @param {Object} dependencies - Dependency object
 * @param {Object} dependencies.localRecommender - LocalRecommender instance
 * @param {Object} dependencies.interestProfiler - InterestProfiler instance
 * @param {Object} [dependencies.ipcMain] - Injected ipcMain (for testing)
 * @param {Object} [dependencies.ipcGuard] - Injected ipcGuard (for testing)
 */
function registerRecommendationIPC({
  localRecommender,
  interestProfiler,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  const ipcMain = injectedIpcMain || electronIpcMain;

  logger.info("[Recommendation IPC] Registering Recommendation IPC handlers...");

  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("recommendation-ipc")) {
    logger.info("[Recommendation IPC] Module already registered, cleaning up...");

    try {
      ipcMain.removeHandler("recommendation:get-recommendations");
      ipcMain.removeHandler("recommendation:generate");
      ipcMain.removeHandler("recommendation:mark-viewed");
      ipcMain.removeHandler("recommendation:feedback");
      ipcMain.removeHandler("recommendation:get-profile");
      ipcMain.removeHandler("recommendation:update-profile");
    } catch (_err) {
      // Intentionally empty - cleanup errors are non-critical
    }

    ipcGuard.unregisterModule("recommendation-ipc");
  }

  // ============================================================
  // Recommendation handlers (4)
  // ============================================================

  /**
   * Get recommendations for a user
   * Channel: 'recommendation:get-recommendations'
   */
  ipcMain.handle("recommendation:get-recommendations", async (_event, params) => {
    try {
      if (!localRecommender) {
        return { success: false, error: "LocalRecommender not initialized" };
      }

      const recommendations = await localRecommender.getRecommendations(params);
      return { success: true, recommendations };
    } catch (error) {
      logger.error("[Recommendation IPC] get-recommendations failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate recommendations from a content pool
   * Channel: 'recommendation:generate'
   */
  ipcMain.handle("recommendation:generate", async (_event, params) => {
    try {
      if (!localRecommender) {
        return { success: false, error: "LocalRecommender not initialized" };
      }

      const recommendations = await localRecommender.generateRecommendations(params);
      return { success: true, recommendations, count: recommendations.length };
    } catch (error) {
      logger.error("[Recommendation IPC] generate failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Mark a recommendation as viewed
   * Channel: 'recommendation:mark-viewed'
   */
  ipcMain.handle("recommendation:mark-viewed", async (_event, recommendationId) => {
    try {
      if (!localRecommender) {
        return { success: false, error: "LocalRecommender not initialized" };
      }

      const result = await localRecommender.markViewed(recommendationId);
      return { success: result };
    } catch (error) {
      logger.error("[Recommendation IPC] mark-viewed failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Provide feedback on a recommendation
   * Channel: 'recommendation:feedback'
   */
  ipcMain.handle("recommendation:feedback", async (_event, params) => {
    try {
      if (!localRecommender) {
        return { success: false, error: "LocalRecommender not initialized" };
      }

      const result = await localRecommender.provideFeedback(params);
      return { success: result };
    } catch (error) {
      logger.error("[Recommendation IPC] feedback failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Interest profile handlers (2)
  // ============================================================

  /**
   * Get user interest profile
   * Channel: 'recommendation:get-profile'
   */
  ipcMain.handle("recommendation:get-profile", async (_event, userId) => {
    try {
      if (!interestProfiler) {
        return { success: false, error: "InterestProfiler not initialized" };
      }

      const profile = await interestProfiler.getProfile(userId);
      return { success: true, profile };
    } catch (error) {
      logger.error("[Recommendation IPC] get-profile failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update user interest profile
   * Channel: 'recommendation:update-profile'
   */
  ipcMain.handle("recommendation:update-profile", async (_event, params) => {
    try {
      if (!interestProfiler) {
        return { success: false, error: "InterestProfiler not initialized" };
      }

      const profile = await interestProfiler.updateProfile(params);
      return { success: true, profile };
    } catch (error) {
      logger.error("[Recommendation IPC] update-profile failed:", error);
      return { success: false, error: error.message };
    }
  });

  // Mark module as registered
  ipcGuard.markModuleRegistered("recommendation-ipc");

  logger.info("[Recommendation IPC] All Recommendation IPC handlers registered successfully (6 handlers)");
}

module.exports = { registerRecommendationIPC };
