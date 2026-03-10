/**
 * Agent Sandbox v2 IPC Handlers
 * 6 IPC handlers for Phase 87: Agent Sandbox v2
 * @module security/sandbox-v2-ipc
 * @version 5.0.0
 */
const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register Agent Sandbox v2 IPC handlers
 * @param {Object} sandboxManager - AgentSandboxV2 instance
 */
function registerSandboxV2IPC(sandboxManager) {
  // Create sandbox
  ipcMain.handle("sandbox:create", async (_event, params) => {
    try {
      if (!sandboxManager) {
        return { success: false, error: "AgentSandboxV2 not available" };
      }
      const result = sandboxManager.createSandbox(
        params.agentId,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SandboxV2IPC] create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Execute code in sandbox
  ipcMain.handle("sandbox:execute", async (_event, params) => {
    try {
      if (!sandboxManager) {
        return { success: false, error: "AgentSandboxV2 not available" };
      }
      const result = await sandboxManager.execute(
        params.sandboxId,
        params.code,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SandboxV2IPC] execute error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Set permissions
  ipcMain.handle("sandbox:set-permissions", async (_event, params) => {
    try {
      if (!sandboxManager) {
        return { success: false, error: "AgentSandboxV2 not available" };
      }
      const result = sandboxManager.setPermissions(
        params.sandboxId,
        params.permissions,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SandboxV2IPC] set-permissions error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Get audit log
  ipcMain.handle("sandbox:get-audit-log", async (_event, params) => {
    try {
      if (!sandboxManager) {
        return { success: false, error: "AgentSandboxV2 not available" };
      }
      const result = sandboxManager.getAuditLog(
        params.sandboxId,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SandboxV2IPC] get-audit-log error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Set quota
  ipcMain.handle("sandbox:set-quota", async (_event, params) => {
    try {
      if (!sandboxManager) {
        return { success: false, error: "AgentSandboxV2 not available" };
      }
      const result = sandboxManager.setQuota(params.sandboxId, params.quota);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SandboxV2IPC] set-quota error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Monitor behavior
  ipcMain.handle("sandbox:monitor-behavior", async (_event, params) => {
    try {
      if (!sandboxManager) {
        return { success: false, error: "AgentSandboxV2 not available" };
      }
      const result = sandboxManager.monitorBehavior(params.sandboxId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[SandboxV2IPC] monitor-behavior error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[SandboxV2IPC] Registered 6 handlers");
  return { handlerCount: 6 };
}

module.exports = { registerSandboxV2IPC };
