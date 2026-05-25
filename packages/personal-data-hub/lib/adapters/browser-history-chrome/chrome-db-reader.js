"use strict";

// chrome-db-reader — opens a copy of Chrome's History SQLite and yields
// rows. We MUST copy first; Chrome holds an exclusive lock on the live
// file while running, and even when closed the WAL files (`-wal`, `-shm`)
// need to come along or we'd see a stale snapshot.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
// Dual-load: bs3mc tracks Electron's ABI 140 (runtime path), plain
// better-sqlite3 tracks Node's ABI 127 (test path). Whichever loads
// without NODE_MODULE_VERSION mismatch wins. Both expose the same
// Database class for unencrypted DBs.
//
// CRITICAL: must be lazy. Calling at module-load time means any require()
// of this file (e.g. via PDH wiring's eager `require("@chainlesschain/
// personal-data-hub/adapters/browser-history-chrome")`) throws synchronously
// when both modules are absent/ABI-mismatched, killing the entire main
// process before the BrowserHistoryChromeAdapter try/catch in wiring.js
// can swallow it. See v5.0.3.87 crash + handbook trap #23.
let _cachedDatabaseClass = null;
function loadDatabase() {
  if (_cachedDatabaseClass) return _cachedDatabaseClass;
  for (const mod of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    let cls;
    try {
      // eslint-disable-next-line global-require
      cls = require(mod);
    } catch (_e) {
      continue; // require failed, try next
    }
    // require() returns the JS class even when the native binding is
    // ABI-mismatched; instantiation is what actually loads the .node
    // and throws. Smoke-test with an in-memory DB.
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
    "chrome-db-reader: neither better-sqlite3-multiple-ciphers nor better-sqlite3 loaded — both ABI-mismatched",
  );
}

// WebKit timestamps are microseconds since 1601-01-01 UTC. Convert to
// epoch-ms by shifting the epoch (11644473600 seconds × 1e6 µs/s).
const WEBKIT_EPOCH_DELTA_US = 11_644_473_600_000_000n;
function webkitUsToEpochMs(wkUs) {
  if (wkUs == null) return null;
  // wkUs may arrive as Number (up to 2^53) or BigInt — handle both.
  const bn = typeof wkUs === "bigint" ? wkUs : BigInt(wkUs);
  return Number((bn - WEBKIT_EPOCH_DELTA_US) / 1000n);
}
function epochMsToWebkitUs(ms) {
  return BigInt(ms) * 1000n + WEBKIT_EPOCH_DELTA_US;
}

// Chrome transition flags (lower 8 bits of `transition`). See
// chromium/src/components/history/core/browser/history_types.h.
const CORE_TRANSITION_NAMES = {
  0: "link",
  1: "typed",
  2: "auto_bookmark",
  3: "auto_subframe",
  4: "manual_subframe",
  5: "generated",
  6: "auto_toplevel",
  7: "form_submit",
  8: "reload",
  9: "keyword",
  10: "keyword_generated",
};
function decodeTransition(raw) {
  if (!Number.isFinite(raw)) return null;
  const core = raw & 0xff;
  return CORE_TRANSITION_NAMES[core] || `unknown(${core})`;
}

function defaultChromeProfileDir() {
  if (process.platform === "win32") {
    const lad = process.env.LOCALAPPDATA;
    if (!lad) return null;
    return path.join(lad, "Google", "Chrome", "User Data", "Default");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "Default");
  }
  return path.join(os.homedir(), ".config", "google-chrome", "Default");
}

// Edge is Chromium under the hood — identical History/Bookmarks schema,
// just a different on-disk profile root. Same reader code works.
function defaultEdgeProfileDir() {
  if (process.platform === "win32") {
    const lad = process.env.LOCALAPPDATA;
    if (!lad) return null;
    return path.join(lad, "Microsoft", "Edge", "User Data", "Default");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Microsoft Edge", "Default");
  }
  return path.join(os.homedir(), ".config", "microsoft-edge", "Default");
}

// Brave: another Chromium fork; same schema again. Not auto-registered unless
// the user has Brave installed, since the wiring layer calls authenticate()
// at the adapter level rather than the registry filtering ahead of time.
function defaultBraveProfileDir() {
  if (process.platform === "win32") {
    const lad = process.env.LOCALAPPDATA;
    if (!lad) return null;
    return path.join(lad, "BraveSoftware", "Brave-Browser", "User Data", "Default");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "BraveSoftware",
      "Brave-Browser",
      "Default",
    );
  }
  return path.join(os.homedir(), ".config", "BraveSoftware", "Brave-Browser", "Default");
}

// Copy the History file + any sidecar journal/WAL/SHM next to it. Returns
// the temp path that the caller is responsible for cleaning up.
function copyHistorySnapshot(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const src = path.join(profileDir, "History");
  if (!fsMod.existsSync(src)) {
    const err = new Error(`Chrome History not found at ${src}`);
    err.code = "CHROME_HISTORY_NOT_FOUND";
    throw err;
  }
  const tmp = path.join(
    os.tmpdir(),
    `pdh-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  fsMod.copyFileSync(src, tmp);
  for (const ext of ["-journal", "-wal", "-shm"]) {
    const w = src + ext;
    if (fsMod.existsSync(w)) {
      try {
        fsMod.copyFileSync(w, tmp + ext);
      } catch (_e) {
        // Sidecar copy failures are non-fatal — better-sqlite3 will just
        // see the pre-WAL state, which is what we want anyway.
      }
    }
  }
  return tmp;
}

function cleanupHistorySnapshot(tmpPath, opts = {}) {
  const fsMod = opts.fs || fs;
  for (const ext of ["", "-journal", "-wal", "-shm"]) {
    try {
      fsMod.unlinkSync(tmpPath + ext);
    } catch (_e) {
      // best-effort
    }
  }
}

// Yields visit rows in occurredAt-ascending order so the registry's
// watermark (max occurredAt) advances monotonically across syncs.
function* readVisits(tmpPath, opts = {}) {
  const sinceWk = Number.isInteger(opts.since) && opts.since > 0
    ? epochMsToWebkitUs(opts.since)
    : 0n;
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 200_000;
  const includeHidden = opts.includeHidden === true;
  const Database = loadDatabase();
  const db = new Database(tmpPath, { readonly: true });
  try {
    // Bind sinceWk as a string — better-sqlite3 accepts BigInt only when
    // safeIntegers is on, which we don't enable. SQLite compares numerically
    // so passing the decimal string is safe (and avoids 2^53 truncation).
    const stmt = db.prepare(
      `SELECT v.id AS visit_id, v.url AS url_id, v.visit_time AS visit_time,
              v.transition AS transition, v.visit_duration AS visit_duration,
              v.from_visit AS from_visit, u.url AS url, u.title AS title,
              u.visit_count AS visit_count, u.typed_count AS typed_count,
              u.hidden AS hidden
       FROM visits v
       JOIN urls u ON v.url = u.id
       WHERE v.visit_time > ?
         ${includeHidden ? "" : "AND u.hidden = 0"}
       ORDER BY v.visit_time ASC
       LIMIT ?`,
    );
    const rows = stmt.iterate(sinceWk.toString(), limit);
    for (const r of rows) {
      yield {
        visitId: r.visit_id,
        urlId: r.url_id,
        url: r.url,
        title: r.title || "",
        visitTimeMs: webkitUsToEpochMs(r.visit_time),
        visitDurationMs: Number.isInteger(r.visit_duration)
          ? Math.floor(r.visit_duration / 1000)
          : 0,
        transition: decodeTransition(r.transition),
        rawTransition: r.transition,
        fromVisit: r.from_visit || 0,
        visitCount: r.visit_count || 0,
        typedCount: r.typed_count || 0,
        hidden: r.hidden === 1,
      };
    }
  } finally {
    db.close();
  }
}

module.exports = {
  defaultChromeProfileDir,
  defaultEdgeProfileDir,
  defaultBraveProfileDir,
  copyHistorySnapshot,
  cleanupHistorySnapshot,
  readVisits,
  webkitUsToEpochMs,
  epochMsToWebkitUs,
  decodeTransition,
};
