"use strict";

// BrowserHistoryChromeAdapter — desktop Chrome (and Chromium-family) data
// adapter. Reads History.sqlite + Bookmarks JSON directly from the user's
// own profile directory; no extension, no network, no permission prompts.
//
// Supported profiles auto-detected on platform:
//   Windows: %LOCALAPPDATA%\Google\Chrome\User Data\Default
//   macOS:   ~/Library/Application Support/Google/Chrome/Default
//   Linux:   ~/.config/google-chrome/Default
// `opts.profilePath` overrides — point at "Profile 1", an Edge profile,
// or a copy of one for testing.
//
// Chrome locks History while running. We snapshot via fs.copyFileSync to
// %TEMP% (carrying the WAL sidecar) and read from the copy. ~7 MB DB copies
// in <50ms; even 100k-visit profiles iterate in seconds.

const path = require("node:path");
const fs = require("node:fs");

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const {
  defaultChromeProfileDir,
  copyHistorySnapshot,
  cleanupHistorySnapshot,
  readVisits,
} = require("./chrome-db-reader");
const { readBookmarks } = require("./bookmarks-reader");

const NAME = "browser-history-chrome";
const VERSION = "0.1.0";

// The adapter is browser-agnostic — Chromium-derived browsers (Chrome / Edge /
// Brave / Vivaldi / Arc) share the History SQLite + Bookmarks JSON schema.
// Subclasses override `_browserConfig()` to point at a different profile root.
class BrowserHistoryChromeAdapter {
  constructor(opts = {}) {
    const cfg = this._browserConfig();
    this.name = cfg.name;
    this.version = cfg.version;
    this._browser = cfg.browser;
    this.capabilities = [
      `sync:${cfg.browser}-history-sqlite`,
      `sync:${cfg.browser}-bookmarks-json`,
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 }; // ~once per 15 min ceiling
    this.dataDisclosure = {
      fields: [
        "visits:url,title,visitTimeMs,transition,visitDurationMs,hidden",
        "bookmarks:url,name,dateAddedMs,folderPath",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { history: true, bookmarks: true },
    };
    this._deps = {
      fs: require("node:fs"),
      defaultProfileDir: cfg.defaultProfileDir,
    };
    this._profileOverride = typeof opts.profilePath === "string" ? opts.profilePath : null;
  }

  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "chrome",
      defaultProfileDir: defaultChromeProfileDir,
    };
  }

  _resolveProfileDir(opts) {
    if (typeof opts?.profilePath === "string" && opts.profilePath.length > 0) {
      return opts.profilePath;
    }
    if (this._profileOverride) return this._profileOverride;
    return this._deps.defaultProfileDir();
  }

  async authenticate(ctx = {}) {
    const dir = this._resolveProfileDir(ctx);
    if (!dir) {
      return {
        ok: false,
        reason: "PROFILE_PATH_UNRESOLVED",
        message: `no default ${this._browser} profile dir on this platform; pass opts.profilePath`,
      };
    }
    const histPath = path.join(dir, "History");
    if (!this._deps.fs.existsSync(histPath)) {
      return {
        ok: false,
        reason: "PROFILE_NOT_FOUND",
        message: `no ${this._browser} History at ${histPath} — install ${this._browser} / open it at least once, or point opts.profilePath at a different profile`,
      };
    }
    return { ok: true, mode: "file-import", profileDir: dir };
  }

  async healthCheck() {
    const dir = this._resolveProfileDir({});
    const ok = !!dir && this._deps.fs.existsSync(path.join(dir, "History"));
    return { ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    if (!profileDir || !this._deps.fs.existsSync(path.join(profileDir, "History"))) {
      throw new Error(
        `${this.name}.sync: no History at ${path.join(profileDir || "?", "History")} — set opts.profilePath`,
      );
    }

    const includeHistory = opts.include?.history !== false;
    const includeBookmarks = opts.include?.bookmarks !== false;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;

    // History (SQLite snapshot)
    if (includeHistory) {
      let tmp = null;
      try {
        tmp = copyHistorySnapshot(profileDir, { fs: this._deps.fs });
        for (const v of readVisits(tmp, {
          since: opts.since,
          limit: Number.isFinite(limit) ? limit : undefined,
          includeHidden: opts.includeHidden === true,
        })) {
          if (emitted >= limit) return;
          yield {
            kind: "visit",
            originalId: `${this._browser}-visit:${profileDir}:${v.visitId}`,
            capturedAt,
            payload: { ...v, profileDir },
          };
          emitted += 1;
        }
      } finally {
        if (tmp) cleanupHistorySnapshot(tmp, { fs: this._deps.fs });
      }
    }

    // Bookmarks (JSON)
    if (includeBookmarks) {
      for (const b of readBookmarks(profileDir, { fs: this._deps.fs })) {
        if (emitted >= limit) return;
        yield {
          kind: "bookmark",
          originalId: `${this._browser}-bookmark:${profileDir}:${b.guid || b.id || b.url}`,
          capturedAt,
          payload: { ...b, profileDir },
        };
        emitted += 1;
      }
    }
  }

  normalize(raw) {
    const ingestedAt = Date.now();
    const browser = this._browser;
    const source = (originalId) => ({
      adapter: this.name,
      adapterVersion: this.version,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      originalId,
    });

    if (raw.kind === "visit") {
      const p = raw.payload || {};
      const url = typeof p.url === "string" ? p.url : "";
      const title = typeof p.title === "string" && p.title.length > 0
        ? p.title
        : (url || "(无标题)");
      const occurredAt = Number.isInteger(p.visitTimeMs) ? p.visitTimeMs : raw.capturedAt;
      const event = {
        id: `event-${browser}-visit-${p.visitId}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.BROWSE,
        occurredAt,
        ingestedAt,
        source: source(`${browser}-visit:${p.profileDir}:${p.visitId}`),
        actor: "self",
        content: {
          title: title.length > 200 ? title.substring(0, 200) + "…" : title,
          text: url,
        },
      };
      if (Number.isInteger(p.visitDurationMs) && p.visitDurationMs > 0) {
        event.durationMs = p.visitDurationMs;
      }
      event.extra = {
        url,
        transition: p.transition || null,
        rawTransition: Number.isInteger(p.rawTransition) ? p.rawTransition : null,
        visitCount: p.visitCount || 0,
        typedCount: p.typedCount || 0,
        hidden: p.hidden === true,
        fromVisit: p.fromVisit || 0,
        browser,
        profileDir: p.profileDir,
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    if (raw.kind === "bookmark") {
      const p = raw.payload || {};
      const url = typeof p.url === "string" ? p.url : "";
      const name = typeof p.name === "string" && p.name.length > 0 ? p.name : url;
      const stableId = p.guid || p.id || url;
      const item = {
        id: `item-${browser}-bookmark-${stableId}`,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.LINK,
        name,
        category: "bookmark",
        ingestedAt,
        source: source(`${browser}-bookmark:${p.profileDir}:${stableId}`),
        extra: {
          url,
          dateAddedMs: Number.isInteger(p.dateAddedMs) ? p.dateAddedMs : null,
          dateLastUsedMs: Number.isInteger(p.dateLastUsedMs) ? p.dateLastUsedMs : null,
          folderPath: typeof p.folderPath === "string" ? p.folderPath : null,
          browser,
          profileDir: p.profileDir,
        },
      };
      return { events: [], persons: [], places: [], items: [item], topics: [] };
    }

    throw new Error(`${this.name}.normalize: unknown raw.kind=${raw.kind}`);
  }
}

module.exports = {
  BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME: NAME,
  BROWSER_HISTORY_CHROME_VERSION: VERSION,
};
