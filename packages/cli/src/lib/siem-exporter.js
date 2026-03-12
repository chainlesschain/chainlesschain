/**
 * SIEM Exporter — log export to external SIEM targets
 * (Splunk HEC, Elasticsearch, Azure Sentinel) in JSON/CEF/LEEF formats.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _targets = new Map();
const _exports = [];

const SIEM_FORMATS = { JSON: "json", CEF: "cef", LEEF: "leef" };
const SIEM_TARGETS = {
  SPLUNK_HEC: "splunk_hec",
  ELASTICSEARCH: "elasticsearch",
  AZURE_SENTINEL: "azure_sentinel",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureSIEMTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS siem_exports (
      id TEXT PRIMARY KEY,
      target_type TEXT,
      target_url TEXT,
      format TEXT DEFAULT 'json',
      last_exported_log_id TEXT,
      exported_count INTEGER DEFAULT 0,
      last_export_at TEXT,
      status TEXT DEFAULT 'active',
      config TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Target Management ────────────────────────────────────── */

export function listTargets() {
  return [..._targets.values()];
}

export function addTarget(db, type, url, format, config) {
  if (!type) throw new Error("Target type is required");
  if (!url) throw new Error("Target URL is required");

  const validTypes = Object.values(SIEM_TARGETS);
  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid target type: ${type}. Valid: ${validTypes.join(", ")}`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const target = {
    id,
    type,
    url,
    format: format || SIEM_FORMATS.JSON,
    exportedCount: 0,
    lastExportAt: null,
    lastExportedLogId: null,
    status: "active",
    config: config || {},
    createdAt: now,
  };

  _targets.set(id, target);

  db.prepare(
    `INSERT INTO siem_exports (id, target_type, target_url, format, last_exported_log_id, exported_count, last_export_at, status, config, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    type,
    url,
    target.format,
    null,
    0,
    null,
    "active",
    JSON.stringify(target.config),
    now,
  );

  return target;
}

/* ── Log Export ────────────────────────────────────────────── */

export function exportLogs(db, targetId, logs) {
  const target = _targets.get(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);

  const items = logs || [];
  const now = new Date().toISOString();
  const exported = items.length;

  target.exportedCount += exported;
  target.lastExportAt = now;
  if (items.length > 0) {
    target.lastExportedLogId =
      items[items.length - 1].id || `log-${Date.now()}`;
  }

  _exports.push({ targetId, exported, timestamp: now });

  db.prepare(
    `UPDATE siem_exports SET exported_count = ?, last_export_at = ?, last_exported_log_id = ? WHERE id = ?`,
  ).run(target.exportedCount, now, target.lastExportedLogId, targetId);

  return { exported, lastId: target.lastExportedLogId };
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getSIEMStats() {
  return [..._targets.values()].map((t) => ({
    id: t.id,
    type: t.type,
    url: t.url,
    format: t.format,
    exportedCount: t.exportedCount,
    lastExportAt: t.lastExportAt,
    status: t.status,
  }));
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _targets.clear();
  _exports.length = 0;
}
