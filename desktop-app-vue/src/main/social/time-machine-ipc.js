/**
 * Time Machine IPC Handlers
 *
 * Registers IPC handlers for timeline time machine, memory generation,
 * sentiment analysis, and social statistics.
 *
 * @module social/time-machine-ipc
 * @version 0.43.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register all Time Machine IPC handlers
 * @param {Object} dependencies - Dependency objects
 * @param {Object} dependencies.timeMachine - TimeMachine instance
 * @param {Object} dependencies.memoryGenerator - MemoryGenerator instance
 * @param {Object} dependencies.sentimentAnalyzer - SentimentAnalyzer instance
 * @param {Object} dependencies.socialStats - SocialStats instance
 */
function registerTimeMachineIPC({
  timeMachine,
  memoryGenerator,
  sentimentAnalyzer,
  socialStats,
}) {
  logger.info("[TimeMachine IPC] Registering Time Machine IPC handlers...");

  // ============================================================
  // Timeline Browsing (5 handlers)
  // ============================================================

  /**
   * Get timeline posts for a specific date
   * Channel: 'time-machine:get-timeline'
   */
  ipcMain.handle("time-machine:get-timeline", async (_event, { year, month, day }) => {
    try {
      if (!timeMachine) {
        throw new Error("TimeMachine not initialized");
      }

      return await timeMachine.getTimelinePosts(year, month, day);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get timeline:", error);
      throw error;
    }
  });

  /**
   * Get "on this day" memories
   * Channel: 'time-machine:get-on-this-day'
   */
  ipcMain.handle("time-machine:get-on-this-day", async (_event, { month, day }) => {
    try {
      if (!timeMachine) {
        return [];
      }

      return await timeMachine.getOnThisDay(month, day);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get on-this-day:", error);
      return [];
    }
  });

  /**
   * Get memories list
   * Channel: 'time-machine:get-memories'
   */
  ipcMain.handle("time-machine:get-memories", async (_event, limit) => {
    try {
      if (!timeMachine) {
        return [];
      }

      return await timeMachine.getMemories(limit || 20);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get memories:", error);
      return [];
    }
  });

  /**
   * Mark a memory as read
   * Channel: 'time-machine:mark-read'
   */
  ipcMain.handle("time-machine:mark-read", async (_event, memoryId) => {
    try {
      if (!timeMachine) {
        throw new Error("TimeMachine not initialized");
      }

      return await timeMachine.markMemoryRead(memoryId);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to mark memory read:", error);
      throw error;
    }
  });

  /**
   * Get year summary
   * Channel: 'time-machine:get-year-summary'
   */
  ipcMain.handle("time-machine:get-year-summary", async (_event, year) => {
    try {
      if (!timeMachine) {
        return null;
      }

      return await timeMachine.getYearSummary(year);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get year summary:", error);
      return null;
    }
  });

  /**
   * Get timeline range
   * Channel: 'time-machine:get-range'
   */
  ipcMain.handle("time-machine:get-range", async (_event, { startDate, endDate }) => {
    try {
      if (!timeMachine) {
        return [];
      }

      return await timeMachine.getTimelineRange(startDate, endDate);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get timeline range:", error);
      return [];
    }
  });

  // ============================================================
  // Memory Generation (2 handlers)
  // ============================================================

  /**
   * Generate annual report
   * Channel: 'memory:generate-annual-report'
   */
  ipcMain.handle("memory:generate-annual-report", async (_event, year) => {
    try {
      if (!memoryGenerator) {
        throw new Error("MemoryGenerator not initialized");
      }

      return await memoryGenerator.generateAnnualReport(year);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to generate annual report:", error);
      throw error;
    }
  });

  /**
   * Generate throwback memory
   * Channel: 'memory:generate-throwback'
   */
  ipcMain.handle("memory:generate-throwback", async () => {
    try {
      if (!memoryGenerator) {
        throw new Error("MemoryGenerator not initialized");
      }

      return await memoryGenerator.generateThrowback();
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to generate throwback:", error);
      throw error;
    }
  });

  // ============================================================
  // Sentiment Analysis (2 handlers)
  // ============================================================

  /**
   * Get sentiment trend
   * Channel: 'sentiment:get-trend'
   */
  ipcMain.handle("sentiment:get-trend", async (_event, { startDate, endDate }) => {
    try {
      if (!sentimentAnalyzer) {
        return [];
      }

      return await sentimentAnalyzer.getSentimentTrend(startDate, endDate);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get sentiment trend:", error);
      return [];
    }
  });

  /**
   * Get emotion distribution
   * Channel: 'sentiment:get-distribution'
   */
  ipcMain.handle("sentiment:get-distribution", async (_event, { startDate, endDate }) => {
    try {
      if (!sentimentAnalyzer) {
        return { total: 0, distribution: {} };
      }

      return await sentimentAnalyzer.getEmotionDistribution(startDate, endDate);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get emotion distribution:", error);
      return { total: 0, distribution: {} };
    }
  });

  // ============================================================
  // Social Stats (5 handlers)
  // ============================================================

  /**
   * Get activity stats
   * Channel: 'stats:get-activity'
   */
  ipcMain.handle("stats:get-activity", async (_event, period) => {
    try {
      if (!socialStats) {
        return null;
      }

      return await socialStats.getActivityStats(period || "month");
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get activity stats:", error);
      return null;
    }
  });

  /**
   * Get network stats
   * Channel: 'stats:get-network'
   */
  ipcMain.handle("stats:get-network", async () => {
    try {
      if (!socialStats) {
        return null;
      }

      return await socialStats.getNetworkStats();
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get network stats:", error);
      return null;
    }
  });

  /**
   * Get interaction heatmap
   * Channel: 'stats:get-heatmap'
   */
  ipcMain.handle("stats:get-heatmap", async (_event, year) => {
    try {
      if (!socialStats) {
        return [];
      }

      return await socialStats.getInteractionHeatmap(year || new Date().getFullYear());
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get heatmap:", error);
      return [];
    }
  });

  /**
   * Get word cloud data
   * Channel: 'stats:get-wordcloud'
   */
  ipcMain.handle("stats:get-wordcloud", async (_event, { startDate, endDate }) => {
    try {
      if (!socialStats) {
        return [];
      }

      return await socialStats.getWordCloud(startDate, endDate);
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to get word cloud:", error);
      return [];
    }
  });

  /**
   * Refresh all stats
   * Channel: 'stats:refresh'
   */
  ipcMain.handle("stats:refresh", async () => {
    try {
      if (!socialStats) {
        throw new Error("SocialStats not initialized");
      }

      return await socialStats.refreshStats();
    } catch (error) {
      logger.error("[TimeMachine IPC] Failed to refresh stats:", error);
      throw error;
    }
  });

  logger.info(
    "[TimeMachine IPC] All Time Machine IPC handlers registered successfully (15 handlers)",
  );
}

module.exports = {
  registerTimeMachineIPC,
};
