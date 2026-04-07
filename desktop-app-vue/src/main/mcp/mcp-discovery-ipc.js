/**
 * MCP Discovery IPC Handlers
 *
 * 6 IPC handlers for MCP server discovery and health monitoring.
 *
 * @module mcp/mcp-discovery-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

let discoveryManager = null;

/**
 * Register MCP discovery IPC handlers
 * @param {Object} options
 * @param {import('./mcp-discovery-manager').MCPDiscoveryManager} options.discoveryManager
 */
function registerMCPDiscoveryIPC(options = {}) {
  discoveryManager = options.discoveryManager || null;

  logger.info("[MCPDiscoveryIPC] Registering 6 handlers...");

  // 1. Scan directories for MCP servers
  ipcMain.handle("mcp:discovery:scan", async (_event, { dirs } = {}) => {
    try {
      if (!discoveryManager) {
        return { success: false, error: "DiscoveryManager not initialized" };
      }
      const discovered = await discoveryManager.scanDirectories(
        dirs && dirs.length > 0 ? dirs : null,
      );
      return { success: true, data: discovered, count: discovered.length };
    } catch (error) {
      logger.error("[MCPDiscoveryIPC] scan error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 2. Get discovery status (watched dirs, health, discovered servers)
  ipcMain.handle("mcp:discovery:get-status", async () => {
    try {
      if (!discoveryManager) {
        return { success: false, error: "DiscoveryManager not initialized" };
      }
      const status = discoveryManager.getStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error("[MCPDiscoveryIPC] get-status error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 3. Start auto-discovery watching
  ipcMain.handle("mcp:discovery:start", async () => {
    try {
      if (!discoveryManager) {
        return { success: false, error: "DiscoveryManager not initialized" };
      }
      discoveryManager.start();
      return { success: true };
    } catch (error) {
      logger.error("[MCPDiscoveryIPC] start error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 4. Stop watching
  ipcMain.handle("mcp:discovery:stop", async () => {
    try {
      if (!discoveryManager) {
        return { success: false, error: "DiscoveryManager not initialized" };
      }
      discoveryManager.stop();
      return { success: true };
    } catch (error) {
      logger.error("[MCPDiscoveryIPC] stop error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 5. Manual health check all servers
  ipcMain.handle("mcp:discovery:health-check", async () => {
    try {
      if (!discoveryManager) {
        return { success: false, error: "DiscoveryManager not initialized" };
      }
      const results = await discoveryManager.healthCheck();
      return { success: true, data: Object.fromEntries(results) };
    } catch (error) {
      logger.error("[MCPDiscoveryIPC] health-check error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 6. Restart specific server
  ipcMain.handle(
    "mcp:discovery:restart-server",
    async (_event, { serverName }) => {
      try {
        if (!discoveryManager) {
          return { success: false, error: "DiscoveryManager not initialized" };
        }
        await discoveryManager.restartServer(serverName);
        return { success: true };
      } catch (error) {
        logger.error("[MCPDiscoveryIPC] restart-server error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[MCPDiscoveryIPC] ✓ 6 handlers registered");
}

module.exports = { registerMCPDiscoveryIPC };
