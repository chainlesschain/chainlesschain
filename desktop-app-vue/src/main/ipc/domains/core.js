/**
 * @module ipc/domains/core
 * Core domain IPC handlers
 * Handles: app lifecycle, config, database, settings
 *
 * Phase 78 - IPC Registry Domain Split
 */
const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

function registerCoreDomain(deps) {
  logger.info("[IPC:Core] Registering core domain handlers");

  // Phase 78 handlers - registry introspection
  ipcMain.handle("ipc:get-registry-stats", async () => {
    try {
      const { getLazyPhaseLoader } = require("../lazy-phase-loader");
      const loader = getLazyPhaseLoader();
      return { success: true, data: loader.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipc:get-domain-status", async () => {
    try {
      const { getLazyPhaseLoader } = require("../lazy-phase-loader");
      const loader = getLazyPhaseLoader();
      const stats = loader.getStats();
      return { success: true, data: stats.phases };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ipc:preload-domain", async (event, domain) => {
    try {
      const { getLazyPhaseLoader } = require("../lazy-phase-loader");
      const loader = getLazyPhaseLoader();
      const results = await loader.preloadDomain(domain);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  logger.info("[IPC:Core] Core domain registered (3 handlers)");
}

module.exports = { registerCoreDomain };
