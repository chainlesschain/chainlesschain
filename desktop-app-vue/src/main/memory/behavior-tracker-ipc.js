/**
 * BehaviorTracker IPC Handlers
 * Handles IPC communication for behavior tracking
 *
 * @module behavior-tracker-ipc
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger } = require("../utils/logger.js");
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all BehaviorTracker IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.behaviorTracker - BehaviorTracker instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerBehaviorTrackerIPC({
  behaviorTracker,
  ipcMain: injectedIpcMain,
}) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("behavior-tracker-ipc")) {
    logger.info(
      "[BehaviorTracker IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info(
    "[BehaviorTracker IPC] Registering BehaviorTracker IPC handlers...",
  );

  // Create mutable reference for hot-reload support
  const trackerRef = { current: behaviorTracker };

  // ============================================================
  // Event Tracking
  // ============================================================

  /**
   * Track page visit
   * Channel: 'behavior:track-page'
   */
  ipcMain.handle(
    "behavior:track-page",
    async (_event, pageName, options = {}) => {
      try {
        if (!trackerRef.current) {
          throw new Error("BehaviorTracker not initialized");
        }
        return await trackerRef.current.trackPageVisit(pageName, options);
      } catch (error) {
        logger.error("[BehaviorTracker IPC] Track page failed:", error);
        throw error;
      }
    },
  );

  /**
   * Track feature use
   * Channel: 'behavior:track-feature'
   */
  ipcMain.handle(
    "behavior:track-feature",
    async (_event, featureName, action = "use", options = {}) => {
      try {
        if (!trackerRef.current) {
          throw new Error("BehaviorTracker not initialized");
        }
        return await trackerRef.current.trackFeatureUse(
          featureName,
          action,
          options,
        );
      } catch (error) {
        logger.error("[BehaviorTracker IPC] Track feature failed:", error);
        throw error;
      }
    },
  );

  /**
   * Track LLM interaction
   * Channel: 'behavior:track-llm'
   */
  ipcMain.handle("behavior:track-llm", async (_event, params) => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      return await trackerRef.current.trackLLMInteraction(params);
    } catch (error) {
      logger.error("[BehaviorTracker IPC] Track LLM failed:", error);
      throw error;
    }
  });

  /**
   * Track search
   * Channel: 'behavior:track-search'
   */
  ipcMain.handle(
    "behavior:track-search",
    async (_event, query, options = {}) => {
      try {
        if (!trackerRef.current) {
          throw new Error("BehaviorTracker not initialized");
        }
        return await trackerRef.current.trackSearch(query, options);
      } catch (error) {
        logger.error("[BehaviorTracker IPC] Track search failed:", error);
        throw error;
      }
    },
  );

  /**
   * Track error
   * Channel: 'behavior:track-error'
   */
  ipcMain.handle(
    "behavior:track-error",
    async (_event, errorType, options = {}) => {
      try {
        if (!trackerRef.current) {
          throw new Error("BehaviorTracker not initialized");
        }
        return await trackerRef.current.trackError(errorType, options);
      } catch (error) {
        logger.error("[BehaviorTracker IPC] Track error failed:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // Pattern Analysis
  // ============================================================

  /**
   * Trigger pattern analysis
   * Channel: 'behavior:analyze-now'
   */
  ipcMain.handle("behavior:analyze-now", async () => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      return await trackerRef.current.analyzePatterns();
    } catch (error) {
      logger.error("[BehaviorTracker IPC] Analyze patterns failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Recommendations
  // ============================================================

  /**
   * Get recommendations
   * Channel: 'behavior:get-recommendations'
   */
  ipcMain.handle(
    "behavior:get-recommendations",
    async (_event, context = {}) => {
      try {
        if (!trackerRef.current) {
          throw new Error("BehaviorTracker not initialized");
        }
        return await trackerRef.current.getRecommendations(context);
      } catch (error) {
        logger.error(
          "[BehaviorTracker IPC] Get recommendations failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Mark recommendation as shown
   * Channel: 'behavior:recommendation-shown'
   */
  ipcMain.handle("behavior:recommendation-shown", async (_event, id) => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      await trackerRef.current.markRecommendationShown(id);
      return { success: true };
    } catch (error) {
      logger.error("[BehaviorTracker IPC] Mark shown failed:", error);
      throw error;
    }
  });

  /**
   * Accept recommendation
   * Channel: 'behavior:accept-recommendation'
   */
  ipcMain.handle("behavior:accept-recommendation", async (_event, id) => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      await trackerRef.current.acceptRecommendation(id);
      return { success: true };
    } catch (error) {
      logger.error(
        "[BehaviorTracker IPC] Accept recommendation failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Dismiss recommendation
   * Channel: 'behavior:dismiss-recommendation'
   */
  ipcMain.handle("behavior:dismiss-recommendation", async (_event, id) => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      await trackerRef.current.dismissRecommendation(id);
      return { success: true };
    } catch (error) {
      logger.error(
        "[BehaviorTracker IPC] Dismiss recommendation failed:",
        error,
      );
      throw error;
    }
  });

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get behavior statistics
   * Channel: 'behavior:get-stats'
   */
  ipcMain.handle("behavior:get-stats", async () => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      return await trackerRef.current.getStats();
    } catch (error) {
      logger.error("[BehaviorTracker IPC] Get stats failed:", error);
      throw error;
    }
  });

  /**
   * Start new session
   * Channel: 'behavior:start-session'
   */
  ipcMain.handle("behavior:start-session", async () => {
    try {
      if (!trackerRef.current) {
        throw new Error("BehaviorTracker not initialized");
      }
      return { sessionId: trackerRef.current.startNewSession() };
    } catch (error) {
      logger.error("[BehaviorTracker IPC] Start session failed:", error);
      throw error;
    }
  });

  /**
   * Update BehaviorTracker reference
   * For hot-reload or reinitialization
   * @param {BehaviorTracker} newTracker - New instance
   */
  function updateBehaviorTracker(newTracker) {
    trackerRef.current = newTracker;
    logger.info("[BehaviorTracker IPC] Reference updated");
  }

  // Mark as registered
  ipcGuard.markModuleRegistered("behavior-tracker-ipc");

  logger.info(
    "[BehaviorTracker IPC] BehaviorTracker IPC handlers registered successfully",
  );

  return {
    updateBehaviorTracker,
  };
}

module.exports = {
  registerBehaviorTrackerIPC,
};
