/**
 * CI/CD Optimizer - IPC Handlers
 *
 * Registers 10 IPC handlers for the CI/CD optimization system,
 * enabling renderer process access to intelligent test selection,
 * dependency graphs, incremental builds, and cache management.
 *
 * @module ai-engine/cowork/cicd-optimizer-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

/**
 * All IPC channels for the CI/CD optimizer
 */
const CICD_CHANNELS = [
  "cicd:select-tests",
  "cicd:get-cache-stats",
  "cicd:clear-cache",
  "cicd:get-test-history",
  "cicd:get-dependency-graph",
  "cicd:plan-build",
  "cicd:execute-build-step",
  "cicd:get-build-cache",
  "cicd:analyze-coverage",
  "cicd:get-config",
];

/**
 * Register all CI/CD optimizer IPC handlers
 * @param {Object} cicdOptimizer - CICDOptimizer instance
 */
function registerCICDOptimizerIPC(cicdOptimizer) {
  if (!cicdOptimizer) {
    logger.warn(
      "[CICDOptimizerIPC] No CI/CD optimizer provided, registering fallbacks",
    );
    for (const channel of CICD_CHANNELS) {
      ipcMain.handle(channel, async () => ({
        success: false,
        error: "CICDOptimizer is not initialized",
        code: "CICD_UNAVAILABLE",
      }));
    }
    return;
  }

  // ============================================================
  // Test Selection
  // ============================================================

  /**
   * Intelligent test selection for given changed files
   * @param {string[]} changedFiles - List of changed file paths
   */
  ipcMain.handle("cicd:select-tests", async (_event, changedFiles = []) => {
    try {
      const result = cicdOptimizer.selectTests(changedFiles);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] select-tests error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get cache hit rate and statistics
   */
  ipcMain.handle("cicd:get-cache-stats", async () => {
    try {
      const stats = cicdOptimizer.getCacheStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] get-cache-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Purge test selection cache
   */
  ipcMain.handle("cicd:clear-cache", async () => {
    try {
      const result = cicdOptimizer.clearCache();
      return { success: result.success, data: result };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] clear-cache error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // History & Analysis
  // ============================================================

  /**
   * Get test flakiness & performance data
   * @param {number} [limit=50] - Max records
   */
  ipcMain.handle("cicd:get-test-history", async (_event, limit = 50) => {
    try {
      const history = cicdOptimizer.getTestHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] get-test-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get dependency graph visualization data
   * @param {string} [testDir] - Limit to specific directory
   */
  ipcMain.handle(
    "cicd:get-dependency-graph",
    async (_event, testDir = null) => {
      try {
        const graph = cicdOptimizer.getDependencyGraph(testDir);
        return { success: true, data: graph };
      } catch (error) {
        logger.error(
          "[CICDOptimizerIPC] get-dependency-graph error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Build Operations
  // ============================================================

  /**
   * Generate incremental build plan
   * @param {string[]} changedFiles - Changed file paths
   */
  ipcMain.handle("cicd:plan-build", async (_event, changedFiles = []) => {
    try {
      const plan = cicdOptimizer.planIncrementalBuild(changedFiles);
      return { success: true, data: plan };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] plan-build error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Execute a single build step (placeholder - actual execution via shell)
   * @param {Object} step - Build step definition
   */
  ipcMain.handle("cicd:execute-build-step", async (_event, step = {}) => {
    try {
      // This is a planning endpoint; actual execution deferred to shell
      return {
        success: true,
        data: {
          step: step.name || "unknown",
          status: "planned",
          command: step.command || null,
          message: "Build step planned. Execute via shell or workflow engine.",
        },
      };
    } catch (error) {
      logger.error(
        "[CICDOptimizerIPC] execute-build-step error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  /**
   * Get build artifact cache stats
   */
  ipcMain.handle("cicd:get-build-cache", async () => {
    try {
      const stats = cicdOptimizer.getBuildCacheStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] get-build-cache error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Coverage & Config
  // ============================================================

  /**
   * Source→test coverage mapping analysis
   */
  ipcMain.handle("cicd:analyze-coverage", async () => {
    try {
      const coverage = cicdOptimizer.analyzeCoverage();
      return { success: true, data: coverage };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] analyze-coverage error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get optimizer configuration
   */
  ipcMain.handle("cicd:get-config", async () => {
    try {
      const config = cicdOptimizer.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error("[CICDOptimizerIPC] get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[CICDOptimizerIPC] Registered ${CICD_CHANNELS.length} handlers`);
}

module.exports = { registerCICDOptimizerIPC, CICD_CHANNELS };
