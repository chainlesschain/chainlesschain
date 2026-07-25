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
const { createAccountScope } = require("../../account-scope");

const { defaultRecentDir, readRecent } = require("./win-recent-reader");

const NAME = "win-recent";
const VERSION = "0.2.0";
const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 64 * 1024;
const MAX_CURSOR_PATH_BYTES = 32 * 1024;

function cursorError(code, message) {
  const error = new Error(`${NAME}.sync: ${message}`);
  error.code = code;
  error.retryable = false;
  return error;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function comparePath(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePosition(left, right) {
  if (left.mtimeMs !== right.mtimeMs) {
    return left.mtimeMs < right.mtimeMs ? -1 : 1;
  }
  return comparePath(left.path, right.path);
}

function positionForRecord(record) {
  return {
    mtimeMs: record.mtimeMs,
    // Recent is a flat directory, so its exact child name is a complete,
    // alias-independent cursor discriminator within the path-derived scope.
    path: path.basename(record.lnkPath),
  };
}

function parsePosition(value, field) {
  if (!isPlainObject(value)) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      `stored cursor ${field} must be an object`,
    );
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "mtimeMs" ||
    keys[1] !== "path" ||
    !Number.isSafeInteger(value.mtimeMs) ||
    value.mtimeMs <= 0 ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    path.basename(value.path) !== value.path ||
    !value.path.toLowerCase().endsWith(".lnk") ||
    Buffer.byteLength(value.path, "utf8") > MAX_CURSOR_PATH_BYTES
  ) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      `stored cursor ${field} is malformed`,
    );
  }
  return { mtimeMs: value.mtimeMs, path: value.path };
}

function resetCursor(migrated = false) {
  return { after: null, upper: null, migrated };
}

function parseCursor(value) {
  if (value == null || value === "") return resetCursor(false);
  if (
    typeof value === "string" &&
    Buffer.byteLength(value, "utf8") > MAX_CURSOR_BYTES
  ) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor exceeds the safe size limit",
    );
  }
  if (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value))
  ) {
    // v0.1 used Registry's count watermark even though it was not a source
    // position. Never reinterpret it as a timestamp or offset: replay once.
    return resetCursor(true);
  }
  if (typeof value !== "string") {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor must be a versioned string",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor is not valid JSON",
    );
  }
  if (!isPlainObject(parsed)) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor must be an object",
    );
  }
  if (parsed.v !== CURSOR_VERSION) {
    throw cursorError(
      "WIN_RECENT_CURSOR_UNSUPPORTED",
      `stored cursor version ${String(parsed.v)} is unsupported`,
    );
  }
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "after" ||
    keys[1] !== "upper" ||
    keys[2] !== "v"
  ) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor has unexpected fields",
    );
  }
  if (parsed.after === null && parsed.upper === null) {
    return resetCursor(false);
  }
  if (parsed.after === null || parsed.upper === null) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor must set both after and upper",
    );
  }
  const after = parsePosition(parsed.after, "after");
  const upper = parsePosition(parsed.upper, "upper");
  if (comparePosition(after, upper) > 0) {
    throw cursorError(
      "WIN_RECENT_CURSOR_INVALID",
      "stored cursor after exceeds upper",
    );
  }
  return { after, upper, migrated: false };
}

function serializeCursor(after, upper) {
  return JSON.stringify({
    v: CURSOR_VERSION,
    after,
    upper,
  });
}

const RESET_CURSOR = serializeCursor(null, null);

function canonicalDirectoryPath(value, fsMod) {
  if (typeof value !== "string" || value.length === 0) return null;
  let resolved = path.resolve(value);
  try {
    resolved =
      typeof fsMod.realpathSync?.native === "function"
        ? path.resolve(fsMod.realpathSync.native(resolved))
        : path.resolve(fsMod.realpathSync(resolved));
  } catch {
    // The health gate owns missing/unreadable directory diagnostics. A
    // resolved fallback still gives that failed attempt a deterministic scope.
  }
  return resolved;
}

function canonicalDirectoryIdentity(value, fsMod) {
  const canonical = canonicalDirectoryPath(value, fsMod);
  if (!canonical) return null;
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function scopeForDirectory(value, fsMod) {
  const canonical = canonicalDirectoryIdentity(value, fsMod);
  if (!canonical) return undefined;
  const encoded = Buffer.from(canonical, "utf8").toString("hex");
  return createAccountScope(NAME, `recent-dir:${encoded}`);
}

function resolveEventLimit(opts) {
  const candidates = [opts.limit, opts.maxEvents].filter(
    (value) => Number.isInteger(value) && value > 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : Infinity;
}

class WinRecentAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:win-recent-shortcuts"];
    this.extractMode = "file-import";
    this.watermarkStrategy = "explicit";
    this.watermarkRequiresCompleteScan = true;
    // A flat Recent directory enumeration is one logical source page.
    this.initialPageBudget = 1;
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
    this._dirOverride =
      typeof opts.recentDir === "string" ? opts.recentDir : null;
  }

  _resolveDir(opts) {
    if (typeof opts?.recentDir === "string" && opts.recentDir.length > 0) {
      return opts.recentDir;
    }
    if (this._dirOverride) return this._dirOverride;
    return this._deps.defaultDir();
  }

  resolveDefaultScope(opts = {}) {
    return scopeForDirectory(this._resolveDir(opts), this._deps.fs);
  }

  async authenticate(ctx = {}) {
    const dir = this._resolveDir(ctx);
    if (!dir) {
      return {
        ok: false,
        reason: "PLATFORM_UNSUPPORTED",
        message:
          "Windows Recent shortcuts only exist on win32; pass opts.recentDir to point at a directory on other platforms",
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

  async healthCheck(opts = {}) {
    const dir = this._resolveDir(opts);
    return {
      ok: !!dir && this._deps.fs.existsSync(dir),
      lastChecked: Date.now(),
    };
  }

  async *sync(opts = {}) {
    const dir = this._resolveDir(opts);
    if (!dir || !this._deps.fs.existsSync(dir)) {
      throw new Error(
        `win-recent.sync: no Recent dir at ${dir || "?"} — set opts.recentDir`,
      );
    }
    if (
      opts.maxPages != null &&
      (!Number.isSafeInteger(opts.maxPages) || opts.maxPages <= 0)
    ) {
      throw new TypeError(`${NAME}.sync: maxPages must be a positive integer`);
    }
    // This local source has exactly one logical page; every positive maxPages
    // budget covers its single bounded directory enumeration.
    const limit = resolveEventLimit(opts);
    const capturedAt = Date.now();
    const cursor = parseCursor(opts.sinceWatermark);
    const canonicalDir = canonicalDirectoryPath(dir, this._deps.fs);
    const records = Array.from(
      readRecent(dir, {
        fs: this._deps.fs,
        since: opts.since,
        strict: true,
      }),
    );
    const upper =
      cursor.upper ||
      (records.length > 0 ? positionForRecord(records.at(-1)) : null);
    const eligible =
      upper === null
        ? []
        : records.filter((record) => {
            const position = positionForRecord(record);
            return (
              (cursor.after === null ||
                comparePosition(position, cursor.after) > 0) &&
              comparePosition(position, upper) <= 0
            );
          });
    const selected = eligible.slice(0, limit);
    const complete = selected.length === eligible.length;

    for (const r of selected) {
      const position = positionForRecord(r);
      if (typeof opts.updateWatermark === "function") {
        opts.updateWatermark(serializeCursor(position, upper));
      }
      yield {
        kind: "recent-file",
        // Canonicalize the directory so aliases that share a scope also share
        // source identity. The exact child name and mtime keep distinct
        // directories and repeated opens separate.
        originalId:
          `win-recent:${path.join(canonicalDir, position.path)}:` +
          `${r.mtimeMs}`,
        capturedAt,
        payload: r,
      };
    }

    // Keep completion outside finally: Registry closes the generator with
    // return() at a hard event limit, which must retain the last exact
    // pre-yield continuation instead of resetting an unfinished cycle.
    if (complete && typeof opts.updateWatermark === "function") {
      opts.updateWatermark(RESET_CURSOR);
      if (typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
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
      const name =
        typeof p.name === "string" && p.name.length > 0 ? p.name : "(无名)";
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
      return {
        events: [event],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
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
  WIN_RECENT_CURSOR_VERSION: CURSOR_VERSION,
  WIN_RECENT_RESET_CURSOR: RESET_CURSOR,
  parseWinRecentCursor: parseCursor,
  serializeWinRecentCursor: serializeCursor,
};
