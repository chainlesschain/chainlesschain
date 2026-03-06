/**
 * SIEM Exporter
 *
 * Export audit logs to external SIEM platforms:
 * - Splunk HEC (HTTP Event Collector)
 * - Elasticsearch
 * - Azure Sentinel
 *
 * Supports JSON, CEF, and LEEF output formats with
 * batched export, per-target tracking, and resume capability.
 *
 * @module audit/siem-exporter
 * @version 1.1.0
 */

const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const SIEM_FORMATS = {
  JSON: "json",
  CEF: "cef",
  LEEF: "leef",
};

const SIEM_TARGETS = {
  SPLUNK_HEC: "splunk_hec",
  ELASTICSEARCH: "elasticsearch",
  AZURE_SENTINEL: "azure_sentinel",
};

// ============================================================
// SIEMExporter
// ============================================================

class SIEMExporter extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._targets = new Map();
    this._lastExportedId = null;
    this._exportQueue = [];
    this._batchSize = 100;
    this._format = "json";
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {return;}

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS siem_exports (
        id TEXT PRIMARY KEY,
        target_type TEXT,
        target_url TEXT,
        format TEXT,
        last_exported_log_id TEXT,
        exported_count INTEGER DEFAULT 0,
        last_export_at INTEGER,
        status TEXT DEFAULT 'active',
        config TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_siem_exports_target_type ON siem_exports(target_type);
    `);
  }

  async initialize() {
    logger.info("[SIEMExporter] Initializing SIEM exporter...");
    this._ensureTables();

    // Load existing targets from DB
    try {
      if (this.database && this.database.db) {
        const rows = this.database.db.prepare(
          "SELECT * FROM siem_exports WHERE status = 'active'"
        ).all();

        for (const row of rows) {
          this._targets.set(row.id, {
            id: row.id,
            type: row.target_type,
            url: row.target_url,
            format: row.format || SIEM_FORMATS.JSON,
            exportedCount: row.exported_count || 0,
            lastExportAt: row.last_export_at,
            lastExportedLogId: row.last_exported_log_id,
            status: row.status,
            config: row.config ? JSON.parse(row.config) : {},
          });

          // Restore the most recent last_exported_id across all targets
          if (row.last_exported_log_id) {
            this._lastExportedId = this._lastExportedId || row.last_exported_log_id;
          }
        }

        logger.info(`[SIEMExporter] Loaded ${this._targets.size} active target(s)`);
      }
    } catch (err) {
      logger.error("[SIEMExporter] Failed to load targets:", err);
    }

    this.initialized = true;
    logger.info("[SIEMExporter] SIEM exporter initialized");
  }

  /**
   * Add a new SIEM target.
   * @param {Object} params
   * @param {string} params.type - Target type from SIEM_TARGETS
   * @param {string} params.url - Target endpoint URL
   * @param {string} [params.format] - Output format from SIEM_FORMATS
   * @param {Object} [params.config] - Additional target-specific config
   * @returns {Object} The created target record
   */
  async addTarget({ type, url, format, config } = {}) {
    const validTypes = Object.values(SIEM_TARGETS);
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid target type: ${type}. Must be one of: ${validTypes.join(", ")}`);
    }
    if (!url) {
      throw new Error("Target URL is required");
    }

    const id = uuidv4();
    const targetFormat = format || SIEM_FORMATS.JSON;
    const now = Date.now();

    const target = {
      id,
      type,
      url,
      format: targetFormat,
      exportedCount: 0,
      lastExportAt: null,
      lastExportedLogId: null,
      status: "active",
      config: config || {},
    };

    // Persist to DB
    if (this.database && this.database.db) {
      this.database.db.prepare(`
        INSERT INTO siem_exports (id, target_type, target_url, format, status, config, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(id, type, url, targetFormat, JSON.stringify(config || {}), now);
    }

    this._targets.set(id, target);
    this.emit("target-added", target);
    logger.info(`[SIEMExporter] Added target: ${type} → ${url} (${id})`);
    return target;
  }

  /**
   * Remove a SIEM target.
   * @param {string} targetId - Target ID to remove
   */
  async removeTarget(targetId) {
    if (!this._targets.has(targetId)) {
      throw new Error(`Target not found: ${targetId}`);
    }

    if (this.database && this.database.db) {
      this.database.db.prepare(
        "UPDATE siem_exports SET status = 'removed' WHERE id = ?"
      ).run(targetId);
    }

    const target = this._targets.get(targetId);
    this._targets.delete(targetId);
    this.emit("target-removed", { id: targetId });
    logger.info(`[SIEMExporter] Removed target: ${targetId}`);
    return target;
  }

  /**
   * List all targets with current status.
   * @returns {Array} Array of target objects
   */
  async listTargets() {
    return Array.from(this._targets.values());
  }

  /**
   * Export audit logs to a specific target.
   * @param {Object} params
   * @param {string} params.targetId - Target ID to export to
   * @param {number} [params.limit] - Max logs to export per batch
   * @returns {Object} Export result { exported, lastId }
   */
  async exportLogs({ targetId, limit } = {}) {
    const target = this._targets.get(targetId);
    if (!target) {
      throw new Error(`Target not found: ${targetId}`);
    }

    const batchLimit = limit || this._batchSize;
    let logs = [];

    // Fetch audit_logs after the target's last exported ID
    if (this.database && this.database.db) {
      const lastId = target.lastExportedLogId;
      if (lastId) {
        logs = this.database.db.prepare(
          "SELECT * FROM audit_logs WHERE id > ? ORDER BY id ASC LIMIT ?"
        ).all(lastId, batchLimit);
      } else {
        logs = this.database.db.prepare(
          "SELECT * FROM audit_logs ORDER BY id ASC LIMIT ?"
        ).all(batchLimit);
      }
    }

    if (logs.length === 0) {
      return { exported: 0, lastId: target.lastExportedLogId };
    }

    // Convert logs to target format
    const formatted = logs.map((log) => this._formatLog(log, target.format));

    // Mock HTTP send in batches
    let sent = 0;
    for (let i = 0; i < formatted.length; i += this._batchSize) {
      const batch = formatted.slice(i, i + this._batchSize);
      try {
        // In production, this would be an HTTP POST to target.url
        logger.info(
          `[SIEMExporter] Sending batch of ${batch.length} logs to ${target.type} (${target.url})`
        );
        sent += batch.length;
      } catch (err) {
        logger.error(`[SIEMExporter] Failed to send batch to ${target.type}:`, err);
        break;
      }
    }

    // Update tracking
    const lastLogId = logs[logs.length - 1].id;
    const now = Date.now();
    target.lastExportedLogId = lastLogId;
    target.exportedCount = (target.exportedCount || 0) + sent;
    target.lastExportAt = now;

    if (this.database && this.database.db) {
      this.database.db.prepare(`
        UPDATE siem_exports
        SET last_exported_log_id = ?, exported_count = ?, last_export_at = ?
        WHERE id = ?
      `).run(lastLogId, target.exportedCount, now, targetId);
    }

    this._lastExportedId = lastLogId;
    this.emit("logs-exported", { targetId, exported: sent, lastId: lastLogId });
    logger.info(`[SIEMExporter] Exported ${sent} logs to target ${targetId}`);
    return { exported: sent, lastId: lastLogId };
  }

  /**
   * Export logs to all active targets.
   * @returns {Object} Per-target export results
   */
  async exportAll() {
    const results = {};
    for (const [targetId, target] of this._targets) {
      if (target.status !== "active") {continue;}
      try {
        results[targetId] = await this.exportLogs({ targetId });
      } catch (err) {
        logger.error(`[SIEMExporter] Export failed for target ${targetId}:`, err);
        results[targetId] = { exported: 0, error: err.message };
      }
    }
    return results;
  }

  /**
   * Convert a log entry to standard JSON format.
   * @param {Object} logEntry - Raw audit log entry
   * @returns {Object} Formatted JSON object
   */
  _toJSON(logEntry) {
    return {
      timestamp: logEntry.created_at || logEntry.timestamp || Date.now(),
      severity: logEntry.severity || logEntry.level || "INFO",
      source: logEntry.source || "chainlesschain-desktop",
      message: logEntry.message || logEntry.action || "",
      metadata: {
        eventId: logEntry.id,
        userId: logEntry.user_id,
        action: logEntry.action,
        resource: logEntry.resource,
        ip: logEntry.ip_address,
        ...(logEntry.details ? JSON.parse(logEntry.details) : {}),
      },
    };
  }

  /**
   * Convert a log entry to CEF (Common Event Format) string.
   * @param {Object} logEntry - Raw audit log entry
   * @returns {string} CEF formatted string
   */
  _toCEF(logEntry) {
    const eventId = logEntry.id || "unknown";
    const eventName = logEntry.action || logEntry.message || "AuditEvent";
    const severity = this._cefSeverity(logEntry.severity || logEntry.level);
    const extension = [
      `src=${logEntry.ip_address || ""}`,
      `suser=${logEntry.user_id || ""}`,
      `msg=${(logEntry.message || "").replace(/[|\\]/g, "")}`,
      `rt=${logEntry.created_at || Date.now()}`,
    ].join(" ");

    return `CEF:0|ChainlessChain|Desktop|1.1.0|${eventId}|${eventName}|${severity}|${extension}`;
  }

  /**
   * Convert a log entry to LEEF (Log Event Extended Format) string.
   * @param {Object} logEntry - Raw audit log entry
   * @returns {string} LEEF formatted string
   */
  _toLEEF(logEntry) {
    const eventId = logEntry.id || "unknown";
    const fields = [
      `devTime=${logEntry.created_at || Date.now()}`,
      `usrName=${logEntry.user_id || ""}`,
      `action=${logEntry.action || ""}`,
      `src=${logEntry.ip_address || ""}`,
      `msg=${logEntry.message || ""}`,
    ].join("\t");

    return `LEEF:2.0|ChainlessChain|Desktop|1.1.0|${eventId}|${fields}`;
  }

  /**
   * Format a log entry according to the specified format.
   * @param {Object} logEntry - Raw audit log entry
   * @param {string} format - Output format
   * @returns {string|Object} Formatted log
   */
  _formatLog(logEntry, format) {
    switch (format) {
      case SIEM_FORMATS.CEF:
        return this._toCEF(logEntry);
      case SIEM_FORMATS.LEEF:
        return this._toLEEF(logEntry);
      case SIEM_FORMATS.JSON:
      default:
        return this._toJSON(logEntry);
    }
  }

  /**
   * Map severity string to CEF numeric severity (0-10).
   * @param {string} level
   * @returns {number}
   */
  _cefSeverity(level) {
    const map = { DEBUG: 1, INFO: 3, WARN: 5, WARNING: 5, ERROR: 7, CRITICAL: 9, FATAL: 10 };
    return map[(level || "INFO").toUpperCase()] || 3;
  }

  /**
   * Get export statistics per target.
   * @returns {Array} Per-target stats with counts and timestamps
   */
  async getExportStats() {
    const stats = [];
    for (const [_id, target] of this._targets) {
      stats.push({
        id: target.id,
        type: target.type,
        url: target.url,
        format: target.format,
        exportedCount: target.exportedCount || 0,
        lastExportAt: target.lastExportAt,
        status: target.status,
      });
    }
    return stats;
  }

  async close() {
    this.removeAllListeners();
    this._targets.clear();
    this.initialized = false;
    logger.info("[SIEMExporter] Closed");
  }
}

let _instance;
function getSIEMExporter() {
  if (!_instance) {_instance = new SIEMExporter();}
  return _instance;
}

module.exports = { SIEMExporter, getSIEMExporter, SIEM_FORMATS, SIEM_TARGETS };
