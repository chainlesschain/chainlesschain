"use strict";

// LocalFilesAdapter — walks user-data roots (Documents / Desktop / Downloads
// / Pictures / Videos / Music) and surfaces one Event(OTHER) per file. Same
// "what did I touch and when" shape as win-recent, but rooted in real on-disk
// files instead of .lnk shortcuts — so it captures files the user created /
// saved / downloaded even if they never opened them via Explorer.
//
// Excludes app cache dirs (xwechat_files / WXWork / node_modules / .git) by
// default to keep the vault signal-rich.

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const {
  defaultRoots,
  walkRoots,
  DEFAULT_EXCLUDES,
} = require("./file-walker");

const NAME = "local-files";
const VERSION = "0.1.0";

class LocalFilesAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:local-file-walk"];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 24 };
    this.dataDisclosure = {
      fields: ["files:path,name,ext,size,mtimeMs,root"],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { files: true },
    };
    this._deps = {
      defaultRoots,
      walkRoots,
    };
    this._rootsOverride = Array.isArray(opts.roots) ? opts.roots : null;
    this._excludesOverride = Array.isArray(opts.excludes) ? opts.excludes : null;
  }

  _resolveRoots(opts) {
    if (Array.isArray(opts?.roots) && opts.roots.length > 0) return opts.roots;
    if (this._rootsOverride) return this._rootsOverride;
    return this._deps.defaultRoots();
  }

  _resolveExcludes(opts) {
    if (Array.isArray(opts?.excludes) && opts.excludes.length > 0) return opts.excludes;
    if (this._excludesOverride) return this._excludesOverride;
    return DEFAULT_EXCLUDES;
  }

  async authenticate(ctx = {}) {
    const roots = this._resolveRoots(ctx);
    if (!roots || roots.length === 0) {
      return {
        ok: false,
        reason: "NO_DATA_ROOTS",
        message: "no default user-data dirs available; pass opts.roots",
      };
    }
    return { ok: true, mode: "file-import", roots };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const roots = this._resolveRoots(opts);
    const excludes = this._resolveExcludes(opts);
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;
    for (const row of this._deps.walkRoots(roots, { ...opts, excludes })) {
      if (emitted >= limit) return;
      yield {
        kind: "local-file",
        originalId: `local-file:${row.path}:${row.mtimeMs}`,
        capturedAt,
        payload: row,
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

    if (raw.kind === "local-file") {
      const p = raw.payload || {};
      const name = typeof p.name === "string" && p.name.length > 0 ? p.name : "(无名)";
      const titleText = `[file] ${name}`;
      const event = {
        id: `event-local-file-${shortHash(raw.originalId)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(p.mtimeMs) ? p.mtimeMs : raw.capturedAt,
        ingestedAt,
        source: source(raw.originalId),
        actor: "self",
        content: {
          title: titleText.length > 100 ? titleText.substring(0, 100) + "…" : titleText,
          text: typeof p.path === "string" ? p.path : name,
        },
        extra: {
          kind: "local-file",
          path: typeof p.path === "string" ? p.path : null,
          name,
          ext: typeof p.ext === "string" ? p.ext : "",
          size: Number.isFinite(p.size) ? p.size : null,
          root: typeof p.root === "string" ? p.root : null,
        },
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    throw new Error(`local-files.normalize: unknown raw.kind=${raw.kind}`);
  }
}

function shortHash(s) {
  let h = 5381;
  const str = typeof s === "string" ? s : "";
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).substring(0, 10);
}

module.exports = {
  LocalFilesAdapter,
  LOCAL_FILES_NAME: NAME,
  LOCAL_FILES_VERSION: VERSION,
};
