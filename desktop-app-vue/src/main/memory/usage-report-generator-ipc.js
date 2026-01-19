/**
 * UsageReportGenerator IPC Handlers
 * Handles IPC communication for usage report generation
 *
 * @module usage-report-generator-ipc
 * @version 1.0.0
 * @since 2026-01-18
 */

const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all UsageReportGenerator IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.usageReportGenerator - UsageReportGenerator instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerUsageReportGeneratorIPC({
  usageReportGenerator,
  ipcMain: injectedIpcMain,
}) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("usage-report-generator-ipc")) {
    console.log(
      "[UsageReportGenerator IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  console.log(
    "[UsageReportGenerator IPC] Registering UsageReportGenerator IPC handlers...",
  );

  // Create mutable reference for hot-reload support
  const generatorRef = { current: usageReportGenerator };

  // ============================================================
  // Report Generation
  // ============================================================

  /**
   * Generate weekly report
   * Channel: 'report:generate-weekly'
   */
  ipcMain.handle("report:generate-weekly", async (_event, options = {}) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.generateWeeklyReport(options);
    } catch (error) {
      console.error(
        "[UsageReportGenerator IPC] Generate weekly report failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Generate monthly report
   * Channel: 'report:generate-monthly'
   */
  ipcMain.handle("report:generate-monthly", async (_event, options = {}) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.generateMonthlyReport(options);
    } catch (error) {
      console.error(
        "[UsageReportGenerator IPC] Generate monthly report failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Generate cost analysis
   * Channel: 'report:get-cost-analysis'
   */
  ipcMain.handle(
    "report:get-cost-analysis",
    async (_event, startDate, endDate) => {
      try {
        if (!generatorRef.current) {
          throw new Error("UsageReportGenerator not initialized");
        }
        return await generatorRef.current.generateCostAnalysis(
          startDate,
          endDate,
        );
      } catch (error) {
        console.error(
          "[UsageReportGenerator IPC] Get cost analysis failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Report Management
  // ============================================================

  /**
   * Export report
   * Channel: 'report:export'
   */
  ipcMain.handle("report:export", async (_event, reportId, options = {}) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.exportReport(reportId, options);
    } catch (error) {
      console.error("[UsageReportGenerator IPC] Export report failed:", error);
      throw error;
    }
  });

  /**
   * Get report by ID
   * Channel: 'report:get'
   */
  ipcMain.handle("report:get", async (_event, reportId) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.getReport(reportId);
    } catch (error) {
      console.error("[UsageReportGenerator IPC] Get report failed:", error);
      throw error;
    }
  });

  /**
   * List reports
   * Channel: 'report:list'
   */
  ipcMain.handle("report:list", async (_event, options = {}) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.listReports(options);
    } catch (error) {
      console.error("[UsageReportGenerator IPC] List reports failed:", error);
      throw error;
    }
  });

  // ============================================================
  // Subscription Management
  // ============================================================

  /**
   * Configure subscription
   * Channel: 'report:configure-subscription'
   */
  ipcMain.handle("report:configure-subscription", async (_event, config) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.configureSubscription(config);
    } catch (error) {
      console.error(
        "[UsageReportGenerator IPC] Configure subscription failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Get subscriptions
   * Channel: 'report:get-subscriptions'
   */
  ipcMain.handle("report:get-subscriptions", async () => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      return await generatorRef.current.getSubscriptions();
    } catch (error) {
      console.error(
        "[UsageReportGenerator IPC] Get subscriptions failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Delete subscription
   * Channel: 'report:delete-subscription'
   */
  ipcMain.handle("report:delete-subscription", async (_event, id) => {
    try {
      if (!generatorRef.current) {
        throw new Error("UsageReportGenerator not initialized");
      }
      await generatorRef.current.deleteSubscription(id);
      return { success: true };
    } catch (error) {
      console.error(
        "[UsageReportGenerator IPC] Delete subscription failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Update UsageReportGenerator reference
   * For hot-reload or reinitialization
   * @param {UsageReportGenerator} newGenerator - New instance
   */
  function updateUsageReportGenerator(newGenerator) {
    generatorRef.current = newGenerator;
    console.log("[UsageReportGenerator IPC] Reference updated");
  }

  // Mark as registered
  ipcGuard.markModuleRegistered("usage-report-generator-ipc");

  console.log(
    "[UsageReportGenerator IPC] UsageReportGenerator IPC handlers registered successfully",
  );

  return {
    updateUsageReportGenerator,
  };
}

module.exports = {
  registerUsageReportGeneratorIPC,
};
