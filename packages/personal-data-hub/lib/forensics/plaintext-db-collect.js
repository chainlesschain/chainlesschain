'use strict';
/**
 * plaintext-db-collect — generic ingester for an app's PLAINTEXT SQLite dbs.
 *
 * Many app dbs aren't encrypted (browse/read/history/content/config). The Magisk
 * daemon (root) can read them directly on MIUI; this turns any such db into vault
 * events by pulling readable text records from each table — comprehensive coverage
 * of the "明文库" personal data without per-db schema work. Encrypted IM dbs
 * (QQNT/WeChat/WCDB2) have their own decrypt collectors; this is for the rest.
 *
 * Heuristics: skip system/Room-internal tables; per table, take TEXT-ish columns;
 * keep a row only if it has a meaningful readable value (CJK, or ≥6 letters, not a
 * uuid/hash/base64 blob); derive a time from any *time/*date/created/_at column.
 * Pure Node + a caller-provided better-sqlite3 ctor.
 */
const crypto = require('crypto');

const SKIP_TABLE = /^(android_metadata|sqlite_|room_master_table|_room|.*_fts(_.*)?$|.*_log$|.*_index$)/i;
const TEXT_TYPE = /text|char|clob|json|varchar|string/i;
const TIME_COL = /(^|_)(time|date|created|updated|_at|timestamp|ctime|mtime)($|_)/i;
const NOISE_VAL = /^(([0-9a-f]{16,})|([A-Za-z0-9+/=_-]{24,})|(\d{6,})|(https?:\/\/\S+)|(\{.{0,3}\})|(\[\]))$/;

function normTime(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e16) return Math.floor(n / 1e6); // ns? → ms
  if (n > 1e14) return Math.floor(n / 1e3); // µs → ms
  if (n > 1e12) return n; // ms
  if (n > 1e9) return n * 1000; // s → ms
  return 0;
}
function readable(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length < 4 || s.length > 2000) return false;
  if (NOISE_VAL.test(s)) return false;
  if (/[一-鿿]/.test(s)) return true; // any CJK
  return (s.match(/[A-Za-z]/g) || []).length >= 6; // or enough letters
}

/**
 * @param Database better-sqlite3 ctor (injected)
 * @param dbPath   path to a plaintext SQLite db
 * @param app      app key (→ source.adapter `local-<app>`)
 * @returns {Array} vault events (subtype:"record")
 */
function ingestPlaintextDb(Database, dbPath, app) {
  const db = new Database(dbPath, { readonly: true });
  const events = [];
  const dbName = String(dbPath).split(/[\\/]/).pop();
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map((r) => r.name).filter((t) => !SKIP_TABLE.test(t));
    for (const t of tables) {
      let cols, rows;
      try {
        cols = db.prepare(`PRAGMA table_info("${t}")`).all();
        rows = db.prepare(`SELECT * FROM "${t}" LIMIT 2000`).all();
      } catch { continue; }
      const textCols = cols.filter((c) => TEXT_TYPE.test(c.type || '')).map((c) => c.name);
      if (!textCols.length || !rows.length) continue;
      const timeCol = (cols.find((c) => TIME_COL.test(c.name)) || {}).name;
      for (const row of rows) {
        const parts = textCols.map((c) => row[c]).filter(readable);
        if (!parts.length) continue;
        const text = [...new Set(parts)].join(' · ').slice(0, 800);
        const occurredAt = timeCol ? normTime(row[timeCol]) : 0;
        const id = `${app}:${dbName}:${t}:` +
          crypto.createHash('md5').update(JSON.stringify(row)).digest('hex').slice(0, 12);
        events.push({
          type: 'event', subtype: 'record',
          id, occurredAt: occurredAt || Date.now(),
          content: { text },
          source: {
            adapter: `local-${app}`, adapterVersion: '0.1.0',
            originalId: `${dbName}:${t}`, capturedAt: occurredAt || Date.now(), capturedBy: 'sqlite',
          },
          topics: [`local-${app}`, `db-${dbName}`],
          ingestedAt: Date.now(),
        });
      }
    }
  } finally {
    db.close();
  }
  return events;
}

module.exports = { ingestPlaintextDb, readable, normTime };
