/**
 * Incident Classifier — Severity Classification & Correlation (v3.3)
 *
 * Classifies anomaly events into incidents with severity levels:
 * - P0 (Critical): Service down / data loss
 * - P1 (Major): Significant degradation
 * - P2 (Minor): Noticeable degradation
 * - P3 (Warning): Potential issue / threshold approached
 *
 * Features:
 * - Automatic severity classification based on anomaly metrics
 * - Historical incident correlation
 * - Incident lifecycle management (open → acknowledged → resolved)
 * - Deduplication of related anomalies into single incidents
 * - Timeline tracking for postmortem
 *
 * @module ai-engine/cowork/incident-classifier
 */

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

// ============================================================
// Constants
// ============================================================

const INCIDENT_STATUS = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  REMEDIATING: "remediating",
  REMEDIATED: "remediated",
  RESOLVED: "resolved",
  ESCALATED: "escalated",
};

const SEVERITY = {
  P0: "P0",
  P1: "P1",
  P2: "P2",
  P3: "P3",
};

const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Severity classification rules per metric
 */
const SEVERITY_RULES = {
  error_rate: [
    { severity: SEVERITY.P0, condition: (v) => v > 50 },
    { severity: SEVERITY.P1, condition: (v) => v > 20 },
    { severity: SEVERITY.P2, condition: (v) => v > 10 },
    { severity: SEVERITY.P3, condition: (v) => v > 5 },
  ],
  response_time_p99: [
    { severity: SEVERITY.P0, condition: (v) => v > 10000 },
    { severity: SEVERITY.P1, condition: (v) => v > 5000 },
    { severity: SEVERITY.P2, condition: (v) => v > 2000 },
    { severity: SEVERITY.P3, condition: (v) => v > 1000 },
  ],
  memory_usage: [
    { severity: SEVERITY.P0, condition: (v) => v > 95 },
    { severity: SEVERITY.P1, condition: (v) => v > 90 },
    { severity: SEVERITY.P2, condition: (v) => v > 80 },
    { severity: SEVERITY.P3, condition: (v) => v > 70 },
  ],
  cpu_usage: [
    { severity: SEVERITY.P0, condition: (v) => v > 98 },
    { severity: SEVERITY.P1, condition: (v) => v > 90 },
    { severity: SEVERITY.P2, condition: (v) => v > 80 },
    { severity: SEVERITY.P3, condition: (v) => v > 70 },
  ],
  disk_usage: [
    { severity: SEVERITY.P0, condition: (v) => v > 98 },
    { severity: SEVERITY.P1, condition: (v) => v > 95 },
    { severity: SEVERITY.P2, condition: (v) => v > 90 },
    { severity: SEVERITY.P3, condition: (v) => v > 85 },
  ],
};

/**
 * Deduplication window — anomalies within this window for the same metric
 * are grouped into a single incident
 */
const DEDUP_WINDOW_MS = 300000; // 5 minutes

// ============================================================
// IncidentClassifier Class
// ============================================================

class IncidentClassifier extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;

    // Active incidents: id → incident
    this._incidents = new Map();

    // Recent anomalies for dedup: metricName → { incidentId, lastSeen }
    this._recentAnomalies = new Map();

    // Custom severity rules (user-defined)
    this._customRules = new Map();

    // Config
    this._config = {
      dedupWindowMs: DEDUP_WINDOW_MS,
      autoEscalateAfterMs: 1800000, // 30 min without ack → escalate
      maxOpenIncidents: 100,
      enabled: true,
    };
  }

  /**
   * Initialize with database
   * @param {Object} db - Database instance
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this._ensureTables();
    await this._loadOpenIncidents();

    this.initialized = true;
    logger.info(
      `[IncidentClassifier] Initialized: ${this._incidents.size} open incidents`,
    );
  }

  // ============================================================
  // Public API — Classification
  // ============================================================

  /**
   * Classify an anomaly event into an incident
   * @param {Object} anomaly - Anomaly event from AnomalyDetector
   * @returns {Object} Incident
   */
  classify(anomaly) {
    if (!this._config.enabled) {
      return null;
    }

    const {
      metricName,
      value,
      baselineValue,
      severity: anomalySeverity,
    } = anomaly;

    // Check for deduplication
    const existing = this._findExistingIncident(metricName);
    if (existing) {
      return this._updateExistingIncident(existing, anomaly);
    }

    // Classify severity
    const severity = this._classifySeverity(metricName, value, anomalySeverity);

    // Create new incident
    const incident = {
      id: `inc-${uuidv4().slice(0, 8)}`,
      severity,
      status: INCIDENT_STATUS.OPEN,
      anomalyMetric: metricName,
      anomalyValue: value,
      anomalyMethod: anomaly.method,
      baselineValue: baselineValue,
      playbookId: null,
      remediationResult: null,
      rollbackExecuted: false,
      alertChannels: [],
      postmortem: null,
      timeline: [
        {
          event: "incident_created",
          severity,
          value,
          method: anomaly.method,
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
    };

    // Check max open incidents
    const openCount = [...this._incidents.values()].filter(
      (i) => i.status === INCIDENT_STATUS.OPEN,
    ).length;
    if (openCount >= this._config.maxOpenIncidents) {
      logger.warn(
        `[IncidentClassifier] Max open incidents reached (${this._config.maxOpenIncidents})`,
      );
    }

    // Save
    this._incidents.set(incident.id, incident);
    this._recentAnomalies.set(metricName, {
      incidentId: incident.id,
      lastSeen: Date.now(),
    });
    this._saveIncident(incident);

    this.emit("incident:created", incident);
    logger.info(
      `[IncidentClassifier] Incident created: ${incident.id} (${severity}) — ${metricName}=${value}`,
    );

    return incident;
  }

  // ============================================================
  // Public API — Incident Management
  // ============================================================

  /**
   * Get all incidents with optional filters
   * @param {Object} [filter]
   * @returns {Array} Incidents
   */
  getIncidents(filter = {}) {
    let incidents = [...this._incidents.values()];

    if (filter.status) {
      incidents = incidents.filter((i) => i.status === filter.status);
    }
    if (filter.severity) {
      incidents = incidents.filter((i) => i.severity === filter.severity);
    }
    if (filter.since) {
      const since = new Date(filter.since).getTime();
      incidents = incidents.filter(
        (i) => new Date(i.createdAt).getTime() >= since,
      );
    }

    // Sort by severity (P0 first), then by creation time (newest first)
    incidents.sort((a, b) => {
      const sevDiff =
        (SEVERITY_ORDER[a.severity] || 99) - (SEVERITY_ORDER[b.severity] || 99);
      if (sevDiff !== 0) {
        return sevDiff;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    if (filter.limit) {
      incidents = incidents.slice(0, filter.limit);
    }

    return incidents;
  }

  /**
   * Get incident by ID
   * @param {string} incidentId
   * @returns {Object} Incident
   */
  getIncident(incidentId) {
    const incident = this._incidents.get(incidentId);
    if (!incident) {
      // Try loading from DB
      return this._loadIncidentFromDB(incidentId);
    }
    return incident;
  }

  /**
   * Acknowledge an incident
   * @param {string} incidentId
   * @param {Object} [options]
   * @returns {Object} Updated incident
   */
  acknowledge(incidentId, options = {}) {
    const incident = this._getIncidentOrThrow(incidentId);

    if (incident.status !== INCIDENT_STATUS.OPEN) {
      throw new Error(
        `Cannot acknowledge incident in status: ${incident.status}`,
      );
    }

    incident.status = INCIDENT_STATUS.ACKNOWLEDGED;
    incident.acknowledgedAt = new Date().toISOString();
    incident.timeline.push({
      event: "acknowledged",
      by: options.acknowledgedBy || "system",
      comment: options.comment || "",
      timestamp: incident.acknowledgedAt,
    });

    this._updateIncidentDB(incident);
    this.emit("incident:acknowledged", incident);
    logger.info(`[IncidentClassifier] Incident acknowledged: ${incidentId}`);

    return incident;
  }

  /**
   * Mark incident as resolved
   * @param {string} incidentId
   * @param {Object} [options]
   * @returns {Object} Updated incident
   */
  resolve(incidentId, options = {}) {
    const incident = this._getIncidentOrThrow(incidentId);

    if (incident.status === INCIDENT_STATUS.RESOLVED) {
      throw new Error("Incident already resolved");
    }

    incident.status = INCIDENT_STATUS.RESOLVED;
    incident.resolvedAt = new Date().toISOString();
    incident.remediationResult = options.result || "manually resolved";
    incident.timeline.push({
      event: "resolved",
      by: options.resolvedBy || "system",
      result: incident.remediationResult,
      timestamp: incident.resolvedAt,
    });

    this._updateIncidentDB(incident);

    // Clean up dedup tracking
    for (const [metric, entry] of this._recentAnomalies.entries()) {
      if (entry.incidentId === incidentId) {
        this._recentAnomalies.delete(metric);
      }
    }

    this.emit("incident:resolved", incident);
    logger.info(`[IncidentClassifier] Incident resolved: ${incidentId}`);

    return incident;
  }

  /**
   * Update incident with remediation info
   * @param {string} incidentId
   * @param {Object} update
   * @returns {Object} Updated incident
   */
  updateIncident(incidentId, update = {}) {
    const incident = this._getIncidentOrThrow(incidentId);

    if (
      update.status &&
      Object.values(INCIDENT_STATUS).includes(update.status)
    ) {
      incident.status = update.status;
    }
    if (update.playbookId) {
      incident.playbookId = update.playbookId;
    }
    if (update.remediationResult) {
      incident.remediationResult = update.remediationResult;
    }
    if (update.rollbackExecuted !== undefined) {
      incident.rollbackExecuted = update.rollbackExecuted;
    }
    if (update.alertChannels) {
      incident.alertChannels = update.alertChannels;
    }
    if (update.timelineEvent) {
      incident.timeline.push({
        ...update.timelineEvent,
        timestamp: new Date().toISOString(),
      });
    }

    this._updateIncidentDB(incident);
    return incident;
  }

  /**
   * Get classifier statistics
   * @returns {Object}
   */
  getStats() {
    const incidents = [...this._incidents.values()];
    const bySeverity = {};
    const byStatus = {};

    for (const inc of incidents) {
      bySeverity[inc.severity] = (bySeverity[inc.severity] || 0) + 1;
      byStatus[inc.status] = (byStatus[inc.status] || 0) + 1;
    }

    return {
      totalIncidents: incidents.length,
      bySeverity,
      byStatus,
      openCount: byStatus[INCIDENT_STATUS.OPEN] || 0,
      mttr: this._computeMTTR(incidents),
      config: this._config,
    };
  }

  // ============================================================
  // Classification Logic
  // ============================================================

  /**
   * Classify severity based on metric rules
   * @private
   */
  _classifySeverity(metricName, value, fallbackSeverity) {
    // Check custom rules first
    const custom = this._customRules.get(metricName);
    if (custom) {
      for (const rule of custom) {
        if (rule.condition(value)) {
          return rule.severity;
        }
      }
    }

    // Check built-in rules
    const rules = SEVERITY_RULES[metricName];
    if (rules) {
      for (const rule of rules) {
        if (rule.condition(value)) {
          return rule.severity;
        }
      }
    }

    // Use the anomaly detector's severity as fallback
    return fallbackSeverity || SEVERITY.P3;
  }

  /**
   * Find existing incident for deduplication
   * @private
   */
  _findExistingIncident(metricName) {
    const recent = this._recentAnomalies.get(metricName);
    if (!recent) {
      return null;
    }

    // Check if within dedup window
    if (Date.now() - recent.lastSeen > this._config.dedupWindowMs) {
      this._recentAnomalies.delete(metricName);
      return null;
    }

    const incident = this._incidents.get(recent.incidentId);
    if (!incident || incident.status === INCIDENT_STATUS.RESOLVED) {
      this._recentAnomalies.delete(metricName);
      return null;
    }

    return incident;
  }

  /**
   * Update an existing incident with new anomaly data
   * @private
   */
  _updateExistingIncident(incident, anomaly) {
    // Update severity if worse
    const newSeverity = this._classifySeverity(
      anomaly.metricName,
      anomaly.value,
      anomaly.severity,
    );
    if (
      (SEVERITY_ORDER[newSeverity] || 99) <
      (SEVERITY_ORDER[incident.severity] || 99)
    ) {
      incident.severity = newSeverity;
    }

    // Update values
    incident.anomalyValue = anomaly.value;

    // Add to timeline
    incident.timeline.push({
      event: "anomaly_repeated",
      value: anomaly.value,
      severity: newSeverity,
      method: anomaly.method,
      timestamp: new Date().toISOString(),
    });

    // Refresh dedup window
    this._recentAnomalies.set(anomaly.metricName, {
      incidentId: incident.id,
      lastSeen: Date.now(),
    });

    this._updateIncidentDB(incident);
    this.emit("incident:updated", incident);

    return incident;
  }

  /**
   * Compute Mean Time To Resolution
   * @private
   */
  _computeMTTR(incidents) {
    const resolved = incidents.filter(
      (i) =>
        i.status === INCIDENT_STATUS.RESOLVED && i.resolvedAt && i.createdAt,
    );
    if (resolved.length === 0) {
      return null;
    }

    const totalMs = resolved.reduce((sum, inc) => {
      return sum + (new Date(inc.resolvedAt) - new Date(inc.createdAt));
    }, 0);

    const avgMs = totalMs / resolved.length;
    return {
      avgMs: Math.round(avgMs),
      avgMinutes: parseFloat((avgMs / 60000).toFixed(1)),
      sampleSize: resolved.length,
    };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  _getIncidentOrThrow(incidentId) {
    const incident = this._incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }
    return incident;
  }

  // ============================================================
  // Database Operations
  // ============================================================

  _ensureTables() {
    try {
      this.db.prepare(`SELECT 1 FROM ops_incidents LIMIT 0`).get();
    } catch {
      logger.warn(
        "[IncidentClassifier] Tables not found — run database migration",
      );
    }
  }

  async _loadOpenIncidents() {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM ops_incidents WHERE status NOT IN ('resolved') ORDER BY created_at DESC LIMIT 200`,
        )
        .all();

      for (const row of rows) {
        const incident = {
          id: row.id,
          severity: row.severity,
          status: row.status,
          anomalyMetric: row.anomaly_metric,
          anomalyValue: row.anomaly_value,
          anomalyMethod: row.anomaly_method,
          baselineValue: row.baseline_value,
          playbookId: row.playbook_id,
          remediationResult: row.remediation_result,
          rollbackExecuted: !!row.rollback_executed,
          alertChannels: JSON.parse(row.alert_channels || "[]"),
          postmortem: row.postmortem,
          timeline: JSON.parse(row.timeline || "[]"),
          createdAt: row.created_at,
          acknowledgedAt: row.acknowledged_at,
          resolvedAt: row.resolved_at,
        };
        this._incidents.set(incident.id, incident);
      }
    } catch (error) {
      logger.warn(
        `[IncidentClassifier] Failed to load incidents: ${error.message}`,
      );
    }
  }

  _loadIncidentFromDB(incidentId) {
    try {
      const row = this.db
        .prepare(`SELECT * FROM ops_incidents WHERE id = ?`)
        .get(incidentId);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        severity: row.severity,
        status: row.status,
        anomalyMetric: row.anomaly_metric,
        anomalyValue: row.anomaly_value,
        anomalyMethod: row.anomaly_method,
        baselineValue: row.baseline_value,
        playbookId: row.playbook_id,
        remediationResult: row.remediation_result,
        rollbackExecuted: !!row.rollback_executed,
        alertChannels: JSON.parse(row.alert_channels || "[]"),
        postmortem: row.postmortem,
        timeline: JSON.parse(row.timeline || "[]"),
        createdAt: row.created_at,
        acknowledgedAt: row.acknowledged_at,
        resolvedAt: row.resolved_at,
      };
    } catch (error) {
      logger.warn(`[IncidentClassifier] Load incident error: ${error.message}`);
      return null;
    }
  }

  _saveIncident(incident) {
    try {
      this.db
        .prepare(
          `INSERT INTO ops_incidents (id, severity, status, anomaly_metric, anomaly_value, anomaly_method, baseline_value, playbook_id, remediation_result, rollback_executed, alert_channels, postmortem, timeline, created_at, acknowledged_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          incident.id,
          incident.severity,
          incident.status,
          incident.anomalyMetric,
          incident.anomalyValue,
          incident.anomalyMethod,
          incident.baselineValue,
          incident.playbookId,
          incident.remediationResult,
          incident.rollbackExecuted ? 1 : 0,
          JSON.stringify(incident.alertChannels),
          incident.postmortem,
          JSON.stringify(incident.timeline),
          incident.createdAt,
          incident.acknowledgedAt,
          incident.resolvedAt,
        );
    } catch (error) {
      logger.error(
        `[IncidentClassifier] Save incident error: ${error.message}`,
      );
    }
  }

  _updateIncidentDB(incident) {
    try {
      this.db
        .prepare(
          `UPDATE ops_incidents SET severity = ?, status = ?, anomaly_value = ?, playbook_id = ?, remediation_result = ?, rollback_executed = ?, alert_channels = ?, postmortem = ?, timeline = ?, acknowledged_at = ?, resolved_at = ? WHERE id = ?`,
        )
        .run(
          incident.severity,
          incident.status,
          incident.anomalyValue,
          incident.playbookId,
          incident.remediationResult,
          incident.rollbackExecuted ? 1 : 0,
          JSON.stringify(incident.alertChannels),
          incident.postmortem,
          JSON.stringify(incident.timeline),
          incident.acknowledgedAt,
          incident.resolvedAt,
          incident.id,
        );
    } catch (error) {
      logger.error(
        `[IncidentClassifier] Update incident error: ${error.message}`,
      );
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getIncidentClassifier() {
  if (!instance) {
    instance = new IncidentClassifier();
  }
  return instance;
}

module.exports = {
  IncidentClassifier,
  getIncidentClassifier,
  INCIDENT_STATUS,
  SEVERITY,
  SEVERITY_RULES,
};
