"use strict";

const { logger } = require("../../utils/logger.js");

/**
 * Register Multi-tenant SaaS IPC handlers.
 *
 * 8 IPC handlers:
 * - saas:create-tenant, saas:configure, saas:get-usage, saas:manage-subscription
 * - saas:export-data, saas:import-data, saas:get-tenants, saas:delete-tenant
 *
 * @module enterprise/saas/saas-ipc
 * @param {Object} deps
 * @param {Object} deps.tenantManager - TenantManager instance (must be initialized)
 * @param {Object} [deps.ipcMain] - Optional injected ipcMain (for testing)
 */
function registerSaaSIPC({ tenantManager, ipcMain: injectedIpcMain } = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  let registeredCount = 0;

  const safeHandle = (channel, handler) => {
    try {
      try {
        ipcMain.removeHandler(channel);
      } catch (_e) {
        /* ignore */
      }
      ipcMain.handle(channel, handler);
      registeredCount++;
    } catch (err) {
      logger.warn(`[SaaS IPC] Failed to register ${channel}: ${err.message}`);
    }
  };

  safeHandle("saas:create-tenant", async (_event, { name, options }) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const data = tenantManager.createTenant(name, options || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("saas:configure", async (_event, { tenantId, config }) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const data = tenantManager.configureTenant(tenantId, config);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("saas:get-usage", async (_event, tenantId) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const data = tenantManager.getUsage(tenantId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(
    "saas:manage-subscription",
    async (_event, { tenantId, plan, options }) => {
      try {
        if (!tenantManager) {
          return { success: false, error: "Not available" };
        }
        const data = tenantManager.manageSubscription(
          tenantId,
          plan,
          options || {},
        );
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  );

  safeHandle("saas:export-data", async (_event, tenantId) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const data = tenantManager.exportData(tenantId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("saas:import-data", async (_event, { tenantId, data }) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const result = tenantManager.importData(tenantId, data);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("saas:get-tenants", async (_event, filter) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const data = tenantManager.getTenants(filter || {});
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle("saas:delete-tenant", async (_event, tenantId) => {
    try {
      if (!tenantManager) {
        return { success: false, error: "Not available" };
      }
      const data = tenantManager.deleteTenant(tenantId);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  logger.info(`[SaaS IPC] Registered ${registeredCount} handlers`);
  return { handlerCount: registeredCount };
}

module.exports = { registerSaaSIPC };
