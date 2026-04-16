/**
 * Threat Intelligence Store — SQLite-backed IoC (indicator of
 * compromise) catalog. Imports STIX 2.1 bundles, deduplicates
 * indicators by (type, value), and supports fast O(1) matching of
 * an arbitrary observable against the stored feed.
 *
 * Designed to pair with `compliance-manager.js`: a compliance scan
 * can call `matchObservable` to flag blocklisted artefacts during
 * evidence ingestion.
 */

import crypto from "crypto";
import fs from "fs";
import {
  extractIndicatorsFromBundle,
  classifyObservable,
  IOC_TYPES,
} from "./stix-parser.js";

/* ── Schema ────────────────────────────────────────────────── */

export function ensureThreatIntelTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threat_intel_indicators (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      labels TEXT,
      confidence INTEGER,
      source_id TEXT,
      source_name TEXT,
      valid_from TEXT,
      valid_until TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      UNIQUE(type, value)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_threat_intel_type ON threat_intel_indicators(type)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_threat_intel_value ON threat_intel_indicators(value)`,
  );
}

/* ── Import ────────────────────────────────────────────────── */

/**
 * Import a parsed STIX bundle (or a loose array of STIX objects) into
 * the store. Returns `{imported, updated, skipped, total}`.
 *
 * - `imported`: new (type,value) pairs inserted.
 * - `updated`:  existing pairs whose metadata was refreshed.
 * - `skipped`:  objects that yielded no usable indicator (unknown
 *   observable type, non-stix pattern_type, malformed pattern, etc.).
 */
export function importStixBundle(db, bundle) {
  if (!db) throw new Error("Database is required");
  const iocs = extractIndicatorsFromBundle(bundle);
  const total = Array.isArray(bundle?.objects)
    ? bundle.objects.filter((o) => o?.type === "indicator").length
    : Array.isArray(bundle)
      ? bundle.filter((o) => o?.type === "indicator").length
      : 0;

  let imported = 0;
  let updated = 0;

  const insert = db.prepare(
    `INSERT INTO threat_intel_indicators
       (id, type, value, labels, confidence, source_id, source_name,
        valid_from, valid_until, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  );
  const update = db.prepare(
    `UPDATE threat_intel_indicators
        SET labels       = ?,
            confidence   = ?,
            source_id    = ?,
            source_name  = ?,
            valid_from   = ?,
            valid_until  = ?,
            last_seen_at = datetime('now')
      WHERE type = ? AND value = ?`,
  );
  const selectExisting = db.prepare(
    `SELECT id FROM threat_intel_indicators WHERE type = ? AND value = ?`,
  );

  for (const rawIoc of iocs) {
    // File hashes are case-insensitive — normalize on write so that
    // equality lookups in `matchObservable` don't depend on SQLite's
    // COLLATE NOCASE (which the mock-db used in tests doesn't emulate).
    const ioc = rawIoc.type.startsWith("file-")
      ? { ...rawIoc, value: String(rawIoc.value).toLowerCase() }
      : rawIoc;
    const prior = selectExisting.get(ioc.type, ioc.value);
    const labels = JSON.stringify(ioc.source?.labels || []);
    const confidence = ioc.source?.confidence ?? null;
    const sourceId = ioc.source?.indicatorId || null;
    const sourceName = ioc.source?.name || null;
    const validFrom = ioc.source?.validFrom || null;
    const validUntil = ioc.source?.validUntil || null;

    if (prior) {
      update.run(
        labels,
        confidence,
        sourceId,
        sourceName,
        validFrom,
        validUntil,
        ioc.type,
        ioc.value,
      );
      updated += 1;
    } else {
      insert.run(
        crypto.randomUUID(),
        ioc.type,
        ioc.value,
        labels,
        confidence,
        sourceId,
        sourceName,
        validFrom,
        validUntil,
      );
      imported += 1;
    }
  }
  const skipped = Math.max(total - iocs.length, 0);
  return { imported, updated, skipped, total };
}

/**
 * Import a STIX bundle from a file path. Convenience wrapper over
 * `importStixBundle` — reads the JSON, parses it, defers to the
 * core importer.
 */
export function importStixFile(db, filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
  }
  return importStixBundle(db, bundle);
}

/* ── Query ─────────────────────────────────────────────────── */

function _rowToIndicator(r) {
  if (!r) return null;
  let labels = [];
  try {
    labels = r.labels ? JSON.parse(r.labels) : [];
  } catch {
    labels = [];
  }
  return {
    id: r.id,
    type: r.type,
    value: r.value,
    labels,
    confidence: r.confidence ?? null,
    sourceId: r.source_id || null,
    sourceName: r.source_name || null,
    validFrom: r.valid_from || null,
    validUntil: r.valid_until || null,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/**
 * List indicators, optionally filtered by type. `limit` caps result
 * size (default 100, 0 = unlimited).
 */
export function listIndicators(db, options = {}) {
  const { type, limit = 100 } = options;
  if (type && !IOC_TYPES.includes(type)) {
    throw new Error(
      `Unknown IOC type: ${type}. Valid: ${IOC_TYPES.join(", ")}`,
    );
  }
  let sql = `SELECT * FROM threat_intel_indicators`;
  const params = [];
  if (type) {
    sql += ` WHERE type = ?`;
    params.push(type);
  }
  sql += ` ORDER BY last_seen_at DESC`;
  if (limit && limit > 0) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  return db
    .prepare(sql)
    .all(...params)
    .map(_rowToIndicator);
}

/**
 * Match an arbitrary observable against the stored feed. Returns:
 *   {matched:true, type, indicator} on hit
 *   {matched:false, type}            on miss (type still classified)
 *   {matched:false, type:"unknown"}  if we can't classify the input
 */
export function matchObservable(db, value) {
  const type = classifyObservable(value);
  if (type === "unknown") return { matched: false, type: "unknown" };

  const trimmed = String(value).trim();
  const normalized = type.startsWith("file-") ? trimmed.toLowerCase() : trimmed;

  const row = db
    .prepare(
      `SELECT * FROM threat_intel_indicators
         WHERE type = ? AND value = ?
         LIMIT 1`,
    )
    .get(type, normalized);

  if (!row) return { matched: false, type };
  return { matched: true, type, indicator: _rowToIndicator(row) };
}

/**
 * Aggregate stats — total indicators + counts per type.
 */
export function getStats(db) {
  const total =
    db.prepare(`SELECT COUNT(*) AS n FROM threat_intel_indicators`).get()?.n ??
    0;
  const rows = db
    .prepare(
      `SELECT type, COUNT(*) AS n
         FROM threat_intel_indicators
         GROUP BY type
         ORDER BY n DESC`,
    )
    .all();
  const byType = {};
  for (const r of rows) byType[r.type] = r.n;
  return { total, byType };
}

/**
 * Remove a single indicator by (type, value). Returns true if a row
 * was deleted.
 */
export function removeIndicator(db, type, value) {
  const info = db
    .prepare(`DELETE FROM threat_intel_indicators WHERE type = ? AND value = ?`)
    .run(type, value);
  return info.changes > 0;
}

/**
 * Drop every stored indicator. Returns the number of rows removed.
 */
export function clearAll(db) {
  const info = db.prepare(`DELETE FROM threat_intel_indicators`).run();
  return info.changes;
}
