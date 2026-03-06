/**
 * Compliance IPC Handlers
 *
 * 12 IPC handlers for SOC 2 compliance, data classification, and policy management.
 *
 * @module audit/compliance-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";

const CHANNELS = [
  "compliance:collect-audit-evidence",
  "compliance:collect-access-evidence",
  "compliance:collect-config-evidence",
  "compliance:generate-report",
  "compliance:verify-evidence",
  "compliance:get-evidence",
  "compliance:classify-content",
  "compliance:batch-scan",
  "compliance:get-classifications",
  "compliance:auto-tag",
  "compliance:get-policies",
  "compliance:check-access",
];

function registerComplianceIPC({ soc2Compliance, dataClassifier, classificationPolicy, ipcMain: injectedIpcMain } = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;

  logger.info("[Compliance IPC] Registering compliance IPC handlers...");

  // SOC 2 Evidence Collection
  ipcMain.handle("compliance:collect-audit-evidence", async (_event, options) => {
    try {
      if (!soc2Compliance) {throw new Error("SOC2 Compliance not initialized");}
      return { success: true, evidence: await soc2Compliance.collectAuditLogEvidence(options) };
    } catch (error) {
      logger.error("[Compliance IPC] Collect audit evidence failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:collect-access-evidence", async () => {
    try {
      if (!soc2Compliance) {throw new Error("SOC2 Compliance not initialized");}
      return { success: true, evidence: await soc2Compliance.collectAccessControlEvidence() };
    } catch (error) {
      logger.error("[Compliance IPC] Collect access evidence failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:collect-config-evidence", async () => {
    try {
      if (!soc2Compliance) {throw new Error("SOC2 Compliance not initialized");}
      return { success: true, evidence: await soc2Compliance.collectConfigurationEvidence() };
    } catch (error) {
      logger.error("[Compliance IPC] Collect config evidence failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:generate-report", async (_event, options) => {
    try {
      if (!soc2Compliance) {throw new Error("SOC2 Compliance not initialized");}
      return { success: true, report: await soc2Compliance.generateReport(options) };
    } catch (error) {
      logger.error("[Compliance IPC] Generate report failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:verify-evidence", async (_event, { evidenceId, verifiedBy }) => {
    try {
      if (!soc2Compliance) {throw new Error("SOC2 Compliance not initialized");}
      return await soc2Compliance.verifyEvidence(evidenceId, verifiedBy);
    } catch (error) {
      logger.error("[Compliance IPC] Verify evidence failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:get-evidence", async (_event, { criteria }) => {
    try {
      if (!soc2Compliance) {throw new Error("SOC2 Compliance not initialized");}
      const evidence = await soc2Compliance.getEvidenceByCriteria(criteria);
      return { success: true, evidence };
    } catch (error) {
      logger.error("[Compliance IPC] Get evidence failed:", error);
      return { success: false, error: error.message };
    }
  });

  // Data Classification
  ipcMain.handle("compliance:classify-content", async (_event, { content, options }) => {
    try {
      if (!dataClassifier) {throw new Error("Data Classifier not initialized");}
      return { success: true, result: await dataClassifier.classify(content, options) };
    } catch (error) {
      logger.error("[Compliance IPC] Classify content failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:batch-scan", async (_event, { items }) => {
    try {
      if (!dataClassifier) {throw new Error("Data Classifier not initialized");}
      return { success: true, ...(await dataClassifier.batchScan(items)) };
    } catch (error) {
      logger.error("[Compliance IPC] Batch scan failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:get-classifications", async (_event, options) => {
    try {
      if (!dataClassifier) {throw new Error("Data Classifier not initialized");}
      const records = await dataClassifier.getHistory(options);
      return { success: true, records };
    } catch (error) {
      logger.error("[Compliance IPC] Get classifications failed:", error);
      return { success: false, error: error.message };
    }
  });

  // Classification Policy
  ipcMain.handle("compliance:auto-tag", async (_event, { contentId, classificationResult }) => {
    try {
      if (!classificationPolicy) {throw new Error("Classification Policy not initialized");}
      return { success: true, tag: await classificationPolicy.autoTag(contentId, classificationResult) };
    } catch (error) {
      logger.error("[Compliance IPC] Auto-tag failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:get-policies", async () => {
    try {
      if (!classificationPolicy) {throw new Error("Classification Policy not initialized");}
      return { success: true, policies: classificationPolicy.getPolicies() };
    } catch (error) {
      logger.error("[Compliance IPC] Get policies failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("compliance:check-access", async (_event, { requiredLevel, userClearance }) => {
    try {
      if (!classificationPolicy) {throw new Error("Classification Policy not initialized");}
      const allowed = classificationPolicy.checkAccess(requiredLevel, userClearance);
      return { success: true, allowed };
    } catch (error) {
      logger.error("[Compliance IPC] Check access failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[Compliance IPC] ✓ Registered ${CHANNELS.length} compliance IPC handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterComplianceIPC() {
  for (const channel of CHANNELS) {
    electronIpcMain.removeHandler(channel);
  }
  logger.info("[Compliance IPC] All handlers unregistered");
}

export { registerComplianceIPC, unregisterComplianceIPC, CHANNELS };
