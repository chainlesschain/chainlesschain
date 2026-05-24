"use strict";

// WinRecentAdapter — surfaces Windows' cross-application "recently opened"
// shortcut list as an Event(OTHER) stream. Windows-only; gracefully fails
// authenticate() on macOS/Linux.

const path = require("node:path");

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const {
  defaultRecentDir,
  readRecent,
} = require("./win-recent-reader");

const NAME = "win-recent";
const VERSION = "0.1.0";

class WinRecentAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:win-recent-shortcuts"];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.dataDisclosure = {
      fields: ["recent:name,mtimeMs,size,lnkPath"],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { recent: true },
    };
    this._deps = {
      fs: require("node:fs"),
      defaultDir: defaultRecentDir,
    };
    this._dirOverride = typeof opts.recentDir === "string" ? opts.recentDir : null;
  }

  _resolveDir(opts) {
    if (typeof opts?.recentDir === "string" && opts.recentDir.length > 0) {
      return opts.recentDir;
    }
    if (this._dirOverride) return this._dirOverride;
    return this._deps.defaultDir();
  }

  async authenticate(ctx = {}) {
    const dir = this._resolveDir(ctx);
    if (!dir) {
      return {
        ok: false,
        reason: "PLATFORM_UNSUPPORTED",
        message: "Windows Recent shortcuts only exist on win32; pass opts.recentDir to point at a directory on other platforms",
      };
    }
    if (!this._deps.fs.existsSync(dir)) {
      return {
        ok: false,
        reason: "RECENT_DIR_NOT_FOUND",
        message: `no Recent dir at ${dir}`,
      };
    }
    return { ok: true, mode: "file-import", recentDir: dir };
  }

  async healthCheck() {
    const dir = this._resolveDir({});
    return { ok: !!dir && this._deps.fs.existsSync(dir), lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const dir = this._resolveDir(opts);
    if (!dir || !this._deps.fs.existsSync(dir)) {
      throw new Error(`win-recent.sync: no Recent dir at ${dir || "?"} — set opts.recentDir`);
    }
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;
    for (const r of readRecent(dir, { fs: this._deps.fs, since: opts.since })) {
      if (emitted >= limit) return;
      yield {
        kind: "recent-file",
        // Path is unique within the device; mtime gets folded into the
        // event id so re-opening the same target produces a new row.
        originalId: `win-recent:${r.lnkPath}:${r.mtimeMs}`,
        capturedAt,
        payload: r,
      };
      emitted += 1;
    }
  }

  normalize(raw) {
    const ingestedAt = Date.now();
    const source = (originalId) => ({
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      originalId,
    });

    if (raw.kind === "recent-file") {
      const p = raw.payload || {};
      const name = typeof p.name === "string" && p.name.length > 0 ? p.name : "(无名)";
      const event = {
        id: `event-win-recent-${hashOriginal(raw.originalId)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(p.mtimeMs) ? p.mtimeMs : raw.capturedAt,
        ingestedAt,
        source: source(raw.originalId),
        actor: "self",
        content: {
          title: `打开了 ${name.length > 70 ? name.substring(0, 70) + "…" : name}`,
          text: name,
        },
        extra: {
          kind: "recent-file",
          targetName: name,
          lnkPath: typeof p.lnkPath === "string" ? p.lnkPath : null,
          lnkSize: Number.isInteger(p.size) ? p.size : null,
          source: "win-recent",
        },
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    throw new Error(`win-recent.normalize: unknown raw.kind=${raw.kind}`);
  }
}

function hashOriginal(s) {
  let h = 5381;
  const str = typeof s === "string" ? s : "";
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

module.exports = {
  WinRecentAdapter,
  WIN_RECENT_NAME: NAME,
  WIN_RECENT_VERSION: VERSION,
};
