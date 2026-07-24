"use strict";

// BrowserHistoryAospAdapter — Android AOSP / MIUI stock Browser
// (`com.android.browser` → `browser2.db`). The MIUI stock browser is the
// default on Xiaomi/Redmi devices, so its history is a primary browsing-
// interest source the Chrome/Edge adapters can't read (different schema).
//
// Reuses BrowserHistoryChromeAdapter.normalize() (BROWSE Event / LINK Item
// shape → identical downstream analysis), but reads the AOSP `history` /
// `bookmarks` tables directly: a single plaintext SQLite with epoch-MS
// timestamps, NOT Chrome's urls/visits join with WebKit microseconds.
//
// Input is a path to a browser2.db pulled from the device (the contacts/
// browser providers block `content query`, so collection is root-read +
// pull, mirroring system-data-android). `opts.dbPath` (preferred) or
// `opts.profilePath`; a directory is accepted and `browser2.db` looked up
// inside it. `opts.inputPath` is the generic UI/CLI file-import alias.
//
// Device-verified schema 2026-06-17, docs/internal/pdh-app-db-schemas.md.

const path = require("node:path");

const {
  BrowserHistoryChromeAdapter,
} = require("../browser-history-chrome/adapter");
const reader = require("./aosp-db-reader");

const NAME = "browser-history-aosp";
const VERSION = "0.2.0";
const DB_FILENAME = "browser2.db";

class BrowserHistoryAospAdapter extends BrowserHistoryChromeAdapter {
  constructor(opts = {}) {
    super(opts);
    // Parent set Chrome-shaped capabilities (json bookmarks) + profile fields;
    // correct them for the AOSP SQLite-bookmarks / db-file layout.
    this.capabilities = [
      "sync:file-import",
      "sync:aosp-browser-history-sqlite",
      "sync:aosp-browser-bookmarks-sqlite",
    ];
    this.dataDisclosure = {
      ...this.dataDisclosure,
      fields: ["history:url,title,visitTimeMs,visitCount", "bookmarks:url,name"],
    };
    this._dbPathOverride =
      (typeof opts.dbPath === "string" && opts.dbPath) ||
      (typeof opts.profilePath === "string" && opts.profilePath) ||
      null;
    this._deps.reader = reader;
  }

  // Virtual — called by the parent constructor; drives name/version/browser.
  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "aosp",
      defaultProfileDir: () => null, // host has no AOSP browser; db is pulled
    };
  }

  _resolveDbPath(opts = {}) {
    const raw =
      (typeof opts.inputPath === "string" && opts.inputPath) ||
      (typeof opts.dbPath === "string" && opts.dbPath) ||
      (typeof opts.profilePath === "string" && opts.profilePath) ||
      this._dbPathOverride;
    if (!raw) return null;
    // Accept either the file itself or a directory containing browser2.db.
    try {
      if (
        this._deps.fs.existsSync(raw) &&
        this._deps.fs.statSync(raw).isDirectory()
      ) {
        return path.join(raw, DB_FILENAME);
      }
    } catch (_e) {
      // stat failed — fall through and treat `raw` as a file path
    }
    return raw;
  }

  async authenticate(ctx = {}) {
    const dbPath = this._resolveDbPath(ctx);
    if (!dbPath) {
      return {
        ok: false,
        reason: "DB_PATH_UNRESOLVED",
        message: `pass opts.dbPath pointing at a ${DB_FILENAME} pulled from the device`,
      };
    }
    if (!this._deps.fs.existsSync(dbPath)) {
      return {
        ok: false,
        reason: "DB_NOT_FOUND",
        message: `no ${DB_FILENAME} at ${dbPath}`,
      };
    }
    return { ok: true, mode: "file-import", dbPath };
  }

  async healthCheck(opts = {}) {
    const dbPath = this._resolveDbPath(opts);
    const ok = !!dbPath && this._deps.fs.existsSync(dbPath);
    return { ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dbPath = this._resolveDbPath(opts);
    if (!dbPath || !this._deps.fs.existsSync(dbPath)) {
      throw new Error(
        `${this.name}.sync: no ${DB_FILENAME} at ${dbPath || "?"} — set opts.dbPath`,
      );
    }

    const includeHistory = opts.include?.history !== false;
    const includeBookmarks = opts.include?.bookmarks !== false;
    const limit =
      Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;

    if (includeHistory) {
      let tmp = null;
      try {
        tmp = this._deps.reader.copyDbSnapshot(dbPath, { fs: this._deps.fs });
        for (const v of this._deps.reader.readHistory(tmp, {
          since: opts.since,
          limit: Number.isFinite(limit) ? limit : undefined,
        })) {
          if (emitted >= limit) return;
          yield {
            kind: "visit",
            originalId: `aosp-visit:${dbPath}:${v.visitId}`,
            capturedAt,
            payload: { ...v, profileDir: dbPath },
          };
          emitted += 1;
        }
      } finally {
        if (tmp) this._deps.reader.cleanupDbSnapshot(tmp, { fs: this._deps.fs });
      }
    }

    if (includeBookmarks) {
      let tmp = null;
      try {
        tmp = this._deps.reader.copyDbSnapshot(dbPath, { fs: this._deps.fs });
        for (const b of this._deps.reader.readBookmarks(tmp, {
          fs: this._deps.fs,
        })) {
          if (emitted >= limit) return;
          yield {
            kind: "bookmark",
            originalId: `aosp-bookmark:${dbPath}:${b.id || b.url}`,
            capturedAt,
            payload: { ...b, profileDir: dbPath },
          };
          emitted += 1;
        }
      } finally {
        if (tmp) this._deps.reader.cleanupDbSnapshot(tmp, { fs: this._deps.fs });
      }
    }
  }
}

module.exports = {
  BrowserHistoryAospAdapter,
  BROWSER_HISTORY_AOSP_NAME: NAME,
  BROWSER_HISTORY_AOSP_VERSION: VERSION,
};
