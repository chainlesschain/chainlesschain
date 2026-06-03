/**
 * Production Hardening IPC Handlers
 *
 * 6 IPC handlers for performance baselines and security auditing:
 * - Collect/compare/get baselines
 * - Run audit, get reports, get single report
 *
 * @module performance/hardening-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "hardening:collect-baseline",
  "hardening:compare-baseline",
  "hardening:get-baselines",
  "hardening:run-security-audit",
  "hardening:get-audit-reports",
  "hardening:get-audit-report",
];

function registerHardeningIPC({
  performanceBaseline,
  securityAuditor,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("hardening-ipc")
  ) {
    logger.info("[Hardening IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Hardening IPC] Registering Hardening IPC handlers...");

  ipcMain.handle("hardening:collect-baseline", async (_event, params) => {
    try {
      if (!performanceBaseline) {
        throw new Error("PerformanceBaseline not initialized");
      }
      const baseline = await performanceBaseline.collectBaseline(params);
      return { success: true, baseline };
    } catch (error) {
      logger.error("[Hardening IPC] Collect baseline failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hardening:compare-baseline", async (_event, params) => {
    try {
      if (!performanceBaseline) {
        throw new Error("PerformanceBaseline not initialized");
      }
      const comparison = await performanceBaseline.compareBaseline(params);
      return { success: true, comparison };
    } catch (error) {
      logger.error("[Hardening IPC] Compare baseline failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hardening:get-baselines", async (_event, filter) => {
    try {
      if (!performanceBaseline) {
        throw new Error("PerformanceBaseline not initialized");
      }
      const baselines = await performanceBaseline.getBaselines(filter || {});
      return { success: true, baselines };
    } catch (error) {
      logger.error("[Hardening IPC] Get baselines failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hardening:run-security-audit", async (_event, params) => {
    try {
      if (!securityAuditor) {
        throw new Error("SecurityAuditor not initialized");
      }
      const report = await securityAuditor.runAudit(params || {});
      return { success: true, report };
    } catch (error) {
      logger.error("[Hardening IPC] Run security audit failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hardening:get-audit-reports", async (_event, filter) => {
    try {
      if (!securityAuditor) {
        throw new Error("SecurityAuditor not initialized");
      }
      const reports = await securityAuditor.getReports(filter || {});
      return { success: true, reports };
    } catch (error) {
      logger.error("[Hardening IPC] Get audit reports failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("hardening:get-audit-report", async (_event, reportId) => {
    try {
      if (!securityAuditor) {
        throw new Error("SecurityAuditor not initialized");
      }
      const report = await securityAuditor.getReport(reportId);
      return { success: true, report };
    } catch (error) {
      logger.error("[Hardening IPC] Get audit report failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("hardening-ipc", CHANNELS);
  }

  logger.info(
    `[Hardening IPC] Registered ${CHANNELS.length} Hardening IPC handlers`,
  );
  return { handlerCount: CHANNELS.length };
}

function unregisterHardeningIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Intentionally empty - handler may not exist
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("hardening-ipc");
  }
  logger.info("[Hardening IPC] All handlers unregistered");
}

export { registerHardeningIPC, unregisterHardeningIPC, CHANNELS };
