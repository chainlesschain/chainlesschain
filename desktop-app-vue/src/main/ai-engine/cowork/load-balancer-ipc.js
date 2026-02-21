/**
 * Load Balancer - IPC Handlers
 *
 * Registers 8 IPC handlers for the dynamic load balancing system,
 * enabling renderer process access to agent metrics, load monitoring,
 * task migration, and threshold configuration.
 *
 * @module ai-engine/cowork/load-balancer-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

/**
 * All IPC channels for the load balancer system
 */
const LOAD_BALANCER_CHANNELS = [
  "load-balancer:get-metrics",
  "load-balancer:get-agent-load",
  "load-balancer:get-system-load",
  "load-balancer:suggest-assignment",
  "load-balancer:migrate-task",
  "load-balancer:set-threshold",
  "load-balancer:get-history",
  "load-balancer:get-config",
];

/**
 * Register all load balancer IPC handlers
 * @param {Object} loadBalancer - LoadBalancer instance
 */
function registerLoadBalancerIPC(loadBalancer) {
  if (!loadBalancer) {
    logger.warn(
      "[LoadBalancerIPC] No load balancer provided, registering fallbacks",
    );
    for (const channel of LOAD_BALANCER_CHANNELS) {
      ipcMain.handle(channel, async () => ({
        success: false,
        error: "LoadBalancer is not initialized",
        code: "LOAD_BALANCER_UNAVAILABLE",
      }));
    }
    return;
  }

  // ============================================================
  // Metrics Queries
  // ============================================================

  /**
   * Get all agent load metrics
   */
  ipcMain.handle("load-balancer:get-metrics", async () => {
    try {
      const metrics = loadBalancer.getAllMetrics();
      return { success: true, data: metrics };
    } catch (error) {
      logger.error("[LoadBalancerIPC] get-metrics error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get load for a specific agent
   * @param {string} agentId - Agent ID
   */
  ipcMain.handle("load-balancer:get-agent-load", async (_event, agentId) => {
    try {
      const load = loadBalancer.getAgentLoad(agentId);
      if (!load) {
        return {
          success: false,
          error: `Agent ${agentId} not found in metrics`,
        };
      }
      return { success: true, data: load };
    } catch (error) {
      logger.error("[LoadBalancerIPC] get-agent-load error:", error.message);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get system-wide load summary
   */
  ipcMain.handle("load-balancer:get-system-load", async () => {
    try {
      const systemLoad = loadBalancer.getSystemLoad();
      return { success: true, data: systemLoad };
    } catch (error) {
      logger.error("[LoadBalancerIPC] get-system-load error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Task Operations
  // ============================================================

  /**
   * Suggest best agent for a task
   * @param {Object} task - Task details
   */
  ipcMain.handle(
    "load-balancer:suggest-assignment",
    async (_event, task = {}) => {
      try {
        const suggestion = loadBalancer.suggestAssignment(task);
        return { success: true, data: suggestion };
      } catch (error) {
        logger.error(
          "[LoadBalancerIPC] suggest-assignment error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Migrate task between agents
   * @param {string} taskId - Task ID
   * @param {string} fromAgentId - Source agent
   * @param {string} toAgentId - Target agent
   */
  ipcMain.handle(
    "load-balancer:migrate-task",
    async (_event, taskId, fromAgentId, toAgentId) => {
      try {
        const result = await loadBalancer.migrateTask(
          taskId,
          fromAgentId,
          toAgentId,
        );
        return { success: result.success, data: result };
      } catch (error) {
        logger.error("[LoadBalancerIPC] migrate-task error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Set load thresholds
   * @param {Object} thresholds - Threshold updates
   */
  ipcMain.handle(
    "load-balancer:set-threshold",
    async (_event, thresholds = {}) => {
      try {
        const config = loadBalancer.setThreshold(thresholds);
        return { success: true, data: config };
      } catch (error) {
        logger.error("[LoadBalancerIPC] set-threshold error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get load history for charts
   * @param {string} [agentId] - Specific agent (null for all)
   * @param {number} [limit=100] - Max entries per agent
   */
  ipcMain.handle(
    "load-balancer:get-history",
    async (_event, agentId = null, limit = 100) => {
      try {
        const history = loadBalancer.getHistory(agentId, limit);
        return { success: true, data: history };
      } catch (error) {
        logger.error("[LoadBalancerIPC] get-history error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get current balancer configuration
   */
  ipcMain.handle("load-balancer:get-config", async () => {
    try {
      const config = loadBalancer.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error("[LoadBalancerIPC] get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[LoadBalancerIPC] Registered ${LOAD_BALANCER_CHANNELS.length} handlers`,
  );
}

module.exports = { registerLoadBalancerIPC, LOAD_BALANCER_CHANNELS };
