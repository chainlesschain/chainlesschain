"use strict";

// AOSP / MIUI stock Browser reader (`com.android.browser` → `browser2.db`).
//
// Distinct schema from Chrome: a single PLAINTEXT `history` table with
// epoch-MILLISECOND timestamps (no urls/visits join, no WebKit microseconds)
// plus a `bookmarks` table. Device-verified 2026-06-17, see
// docs/internal/pdh-app-db-schemas.md → "AOSP 浏览器 MIUI Browser".
//
// Columns vary slightly by ROM build, so every column is resolved via
// `PRAGMA table_info` rather than hard-coded — the same defensive approach
// the douyin/weibo on-device parsers use.

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

// Mirror chrome-db-reader.loadDatabase: prefer the multi-cipher build, fall
// back to vanilla, and smoke-test instantiation (require() returns the JS
// class even when the native binding is ABI-mismatched; `new` is what throws).
let _cachedDatabaseClass = null;
function loadDatabase() {
  if (_cachedDatabaseClass) return _cachedDatabaseClass;
  for (const mod of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    let cls;
    try {
      // eslint-disable-next-line global-require
      cls = require(mod);
    } catch (_e) {
      continue; // require failed, try next candidate
    }
    try {
      const probe = new cls(":memory:");
      probe.close();
      _cachedDatabaseClass = cls;
      return cls;
    } catch (_e) {
      // ABI mismatch — try next candidate
    }
  }
  throw new Error(
    "aosp-db-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

// Scale a raw timestamp to epoch-ms by magnitude (seconds/ms/µs/ns). browser2.db
// stores `date` in ms, but stay defensive against ROM variants.
function normalizeEpochMs(t) {
  if (t == null) return null;
  const n = typeof t === "bigint" ? Number(t) : Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e11) return Math.round(n * 1000); // seconds
  if (n < 1e14) return Math.round(n); // milliseconds
  if (n < 1e17) return Math.round(n / 1000); // microseconds
  return Math.round(n / 1e6); // nanoseconds
}

// browser2.db is locked while the browser runs (and we usually read a
// root-pulled copy anyway). Snapshot via copyFileSync, carrying WAL sidecars.
function copyDbSnapshot(dbPath, opts = {}) {
  const fsMod = opts.fs || fs;
  if (!fsMod.existsSync(dbPath)) {
    const err = new Error(`AOSP browser2.db not found at ${dbPath}`);
    err.code = "AOSP_BROWSER_DB_NOT_FOUND";
    throw err;
  }
  const tmp = path.join(
    os.tmpdir(),
    `pdh-aosp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  fsMod.copyFileSync(dbPath, tmp);
  for (const ext of ["-journal", "-wal", "-shm"]) {
    const w = dbPath + ext;
    if (fsMod.existsSync(w)) {
      try {
        fsMod.copyFileSync(w, tmp + ext);
      } catch (_e) {
        // Sidecar copy failure is non-fatal — we want the pre-WAL state.
      }
    }
  }
  return tmp;
}

function cleanupDbSnapshot(tmpPath, opts = {}) {
  const fsMod = opts.fs || fs;
  for (const ext of ["", "-journal", "-wal", "-shm"]) {
    try {
      fsMod.unlinkSync(tmpPath + ext);
    } catch (_e) {
      // best-effort
    }
  }
}

function pickCol(cols, candidates) {
  const set = new Set(cols.map((c) => c.name));
  for (const c of candidates) if (set.has(c)) return c;
  return null;
}

// Yields history rows ascending by visit time so the registry watermark
// (max occurredAt) advances monotonically across syncs. Shape matches what
// BrowserHistoryChromeAdapter.normalize() consumes for kind="visit".
function* readHistory(tmpPath, opts = {}) {
  const since = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit =
    Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200_000;
  const Database = loadDatabase();
  const db = new Database(tmpPath, { readonly: true });
  try {
    const cols = db.prepare("PRAGMA table_info(history)").all();
    if (cols.length === 0) return; // no history table in this DB
    const idCol = pickCol(cols, ["_id", "id"]);
    const urlCol = pickCol(cols, ["url"]);
    const titleCol = pickCol(cols, ["title"]);
    const dateCol = pickCol(cols, ["date", "created", "visit_time"]);
    const visitsCol = pickCol(cols, ["visits", "visit_count"]);
    if (!urlCol || !dateCol) return; // schema we don't recognise
    const fields = [
      `${idCol || "rowid"} AS hid`,
      `${urlCol} AS url`,
      `${titleCol || "NULL"} AS title`,
      `${dateCol} AS date`,
      `${visitsCol || "0"} AS visits`,
    ];
    const stmt = db.prepare(
      `SELECT ${fields.join(", ")} FROM history
       WHERE ${dateCol} > ?
       ORDER BY ${dateCol} ASC
       LIMIT ?`,
    );
    for (const r of stmt.iterate(since, limit)) {
      yield {
        visitId: r.hid,
        url: typeof r.url === "string" ? r.url : "",
        title: typeof r.title === "string" ? r.title : "",
        visitTimeMs: normalizeEpochMs(r.date),
        visitCount: Number.isInteger(r.visits) ? r.visits : 0,
      };
    }
  } finally {
    db.close();
  }
}

// Yields bookmark leaves (folder=0, deleted=0). Shape matches what
// BrowserHistoryChromeAdapter.normalize() consumes for kind="bookmark".
function* readBookmarks(tmpPath, opts = {}) {
  const Database = loadDatabase();
  const db = new Database(tmpPath, { readonly: true });
  try {
    const cols = db.prepare("PRAGMA table_info(bookmarks)").all();
    if (cols.length === 0) return; // no bookmarks table
    const idCol = pickCol(cols, ["_id", "id"]);
    const urlCol = pickCol(cols, ["url"]);
    const titleCol = pickCol(cols, ["title"]);
    const folderCol = pickCol(cols, ["folder"]);
    const deletedCol = pickCol(cols, ["deleted"]);
    const createdCol = pickCol(cols, ["created", "date"]);
    if (!urlCol) return;
    const where = [];
    if (folderCol) where.push(`${folderCol} = 0`); // folder=0 → actual bookmark leaf
    if (deletedCol) where.push(`${deletedCol} = 0`);
    where.push(`${urlCol} IS NOT NULL AND ${urlCol} != ''`);
    const fields = [
      `${idCol || "rowid"} AS bid`,
      `${urlCol} AS url`,
      `${titleCol || "NULL"} AS title`,
      `${createdCol || "NULL"} AS created`,
    ];
    const stmt = db.prepare(
      `SELECT ${fields.join(", ")} FROM bookmarks WHERE ${where.join(" AND ")}`,
    );
    for (const r of stmt.all()) {
      const url = typeof r.url === "string" ? r.url : "";
      yield {
        id: r.bid,
        name: typeof r.title === "string" && r.title.length > 0 ? r.title : url,
        url,
        dateAddedMs: r.created != null ? normalizeEpochMs(r.created) : null,
        folderPath: null, // browser2.db bookmarks are flat (no folder tree)
      };
    }
  } finally {
    db.close();
  }
}

module.exports = {
  loadDatabase,
  normalizeEpochMs,
  copyDbSnapshot,
  cleanupDbSnapshot,
  readHistory,
  readBookmarks,
};
