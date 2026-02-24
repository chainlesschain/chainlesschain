/**
 * Autonomous Ops IPC Handlers — Anomaly Detection & Incident Management (v3.3)
 *
 * Registers IPC handlers for autonomous operations:
 * Phase A: 6 handlers (get-incidents, get-incident-detail, acknowledge, get-baseline, update-baseline, get-config)
 * Phase B: +9 handlers (resolve, get-playbooks, create-playbook, update-playbook, trigger-remediation, rollback, get-alerts, configure-alerts, generate-postmortem)
 *
 * @module ai-engine/cowork/autonomous-ops-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const OPS_CHANNELS = [
  // Incident Management (3 — Phase A)
  "ops:get-incidents",
  "ops:get-incident-detail",
  "ops:acknowledge",

  // Monitoring & Config (3 — Phase A)
  "ops:get-baseline",
  "ops:update-baseline",
  "ops:get-config",

  // Remediation & Alerts (9 — Phase B)
  "ops:resolve",
  "ops:get-playbooks",
  "ops:create-playbook",
  "ops:update-playbook",
  "ops:trigger-remediation",
  "ops:rollback",
  "ops:get-alerts",
  "ops:configure-alerts",
  "ops:generate-postmortem",
];

/**
 * Register all autonomous ops IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.anomalyDetector - AnomalyDetector instance
 * @param {Object} deps.incidentClassifier - IncidentClassifier instance
 * @param {Object} [deps.autoRemediator] - AutoRemediator instance (Phase B)
 * @param {Object} [deps.rollbackManager] - RollbackManager instance (Phase B)
 * @param {Object} [deps.alertManager] - AlertManager instance (Phase B)
 * @returns {Object} Registration metadata
 */
function registerAutonomousOpsIPC(deps) {
  const {
    anomalyDetector,
    incidentClassifier,
    autoRemediator,
    rollbackManager,
    alertManager,
  } = deps;

  // ============================================================
  // Incident Management (3 handlers)
  // ============================================================

  ipcMain.handle("ops:get-incidents", async (_event, filter) => {
    try {
      if (!incidentClassifier?.initialized) {
        return { success: false, error: "IncidentClassifier not initialized" };
      }
      const result = incidentClassifier.getIncidents(filter || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:get-incidents error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:get-incident-detail", async (_event, options) => {
    try {
      if (!incidentClassifier?.initialized) {
        return { success: false, error: "IncidentClassifier not initialized" };
      }
      const { incidentId } = options || {};
      const result = incidentClassifier.getIncident(incidentId);
      if (!result) {
        return { success: false, error: `Incident not found: ${incidentId}` };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:get-incident-detail error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:acknowledge", async (_event, options) => {
    try {
      if (!incidentClassifier?.initialized) {
        return { success: false, error: "IncidentClassifier not initialized" };
      }
      const { incidentId, acknowledgedBy, comment } = options || {};
      const result = incidentClassifier.acknowledge(incidentId, {
        acknowledgedBy,
        comment,
      });
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:acknowledge error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Monitoring & Config (3 handlers)
  // ============================================================

  ipcMain.handle("ops:get-baseline", async (_event, options) => {
    try {
      if (!anomalyDetector?.initialized) {
        return { success: false, error: "AnomalyDetector not initialized" };
      }
      const { metricName } = options || {};
      if (metricName) {
        const result = anomalyDetector.getBaseline(metricName);
        return { success: true, data: result };
      }
      const result = anomalyDetector.getBaselines();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:get-baseline error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:update-baseline", async (_event, options) => {
    try {
      if (!anomalyDetector?.initialized) {
        return { success: false, error: "AnomalyDetector not initialized" };
      }
      const { metrics } = options || {};
      const result = await anomalyDetector.updateBaselines(metrics || []);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:update-baseline error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:get-config", async () => {
    try {
      const detectorConfig = anomalyDetector?.initialized
        ? anomalyDetector.getConfig()
        : null;
      const classifierStats = incidentClassifier?.initialized
        ? incidentClassifier.getStats()
        : null;
      const detectorStats = anomalyDetector?.initialized
        ? anomalyDetector.getStats()
        : null;

      return {
        success: true,
        data: {
          detector: detectorConfig,
          detectorStats,
          classifierStats,
        },
      };
    } catch (error) {
      logger.error("[OpsIPC] ops:get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Remediation & Alerts (9 handlers — Phase B)
  // ============================================================

  ipcMain.handle("ops:resolve", async (_event, options) => {
    try {
      if (!incidentClassifier?.initialized) {
        return { success: false, error: "IncidentClassifier not initialized" };
      }
      const { incidentId, resolvedBy, comment } = options || {};
      const result = incidentClassifier.resolve(incidentId, {
        resolvedBy,
        comment,
      });
      // Cancel escalation when resolved
      if (alertManager?.initialized) {
        alertManager.cancelEscalation(incidentId);
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:resolve error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:get-playbooks", async () => {
    try {
      if (!autoRemediator?.initialized) {
        return { success: false, error: "AutoRemediator not initialized" };
      }
      const result = autoRemediator.getPlaybooks();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:get-playbooks error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:create-playbook", async (_event, options) => {
    try {
      if (!autoRemediator?.initialized) {
        return { success: false, error: "AutoRemediator not initialized" };
      }
      const result = autoRemediator.createPlaybook(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:create-playbook error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:update-playbook", async (_event, options) => {
    try {
      if (!autoRemediator?.initialized) {
        return { success: false, error: "AutoRemediator not initialized" };
      }
      const { playbookId, ...updates } = options || {};
      if (!playbookId) {
        return { success: false, error: "playbookId is required" };
      }
      const result = autoRemediator.updatePlaybook(playbookId, updates);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:update-playbook error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:trigger-remediation", async (_event, options) => {
    try {
      if (!autoRemediator?.initialized) {
        return { success: false, error: "AutoRemediator not initialized" };
      }
      const { incidentId } = options || {};
      // Get incident details
      const incident = incidentClassifier?.initialized
        ? incidentClassifier.getIncident(incidentId)
        : null;
      if (!incident) {
        return { success: false, error: `Incident not found: ${incidentId}` };
      }
      const result = await autoRemediator.triggerRemediation(incident);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:trigger-remediation error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:rollback", async (_event, options) => {
    try {
      if (!rollbackManager?.initialized) {
        return { success: false, error: "RollbackManager not initialized" };
      }
      const result = await rollbackManager.rollback(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:rollback error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:get-alerts", async (_event, options) => {
    try {
      if (!alertManager?.initialized) {
        return { success: false, error: "AlertManager not initialized" };
      }
      const result = alertManager.getAlerts(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:get-alerts error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:configure-alerts", async (_event, options) => {
    try {
      if (!alertManager?.initialized) {
        return { success: false, error: "AlertManager not initialized" };
      }
      const result = alertManager.configureAlerts(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[OpsIPC] ops:configure-alerts error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ops:generate-postmortem", async (_event, options) => {
    try {
      // Phase C placeholder — PostmortemGenerator LLM report
      return {
        success: false,
        error: "ops:generate-postmortem — Phase C implementation pending",
      };
    } catch (error) {
      logger.error("[OpsIPC] ops:generate-postmortem error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Wire anomaly → incident → auto-remediation pipeline
  // ============================================================

  if (anomalyDetector && incidentClassifier) {
    anomalyDetector.on("anomaly:detected", (anomaly) => {
      try {
        if (incidentClassifier.initialized) {
          const incident = incidentClassifier.classify(anomaly);

          // Auto-trigger remediation if available
          if (
            incident &&
            autoRemediator?.initialized &&
            autoRemediator.config?.autoTrigger
          ) {
            autoRemediator.triggerRemediation(incident).catch((err) => {
              logger.error(
                "[OpsIPC] Auto-remediation trigger error:",
                err.message,
              );
            });
          }

          // Send alert for new incidents
          if (incident && alertManager?.initialized) {
            alertManager.sendAlert({
              type: "incident",
              severity: incident.severity,
              title: `${incident.severity} Incident: ${incident.metricName}`,
              description: incident.description || anomaly.message,
              incidentId: incident.id,
            });
          }
        }
      } catch (error) {
        logger.error(
          "[OpsIPC] Anomaly→Incident pipeline error:",
          error.message,
        );
      }
    });
  }

  logger.info(`[OpsIPC] Registered ${OPS_CHANNELS.length} handlers`);

  return { handlerCount: OPS_CHANNELS.length };
}

/**
 * Unregister all autonomous ops IPC handlers
 */
function unregisterAutonomousOpsIPC() {
  for (const channel of OPS_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
  }
  logger.info("[OpsIPC] Unregistered all handlers");
}

module.exports = {
  registerAutonomousOpsIPC,
  unregisterAutonomousOpsIPC,
  OPS_CHANNELS,
};
