"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  createAccountScope,
  normalizeIdentity,
} = require("../../account-scope");
const {
  BrowserHistoryChromeAdapter,
} = require("../browser-history-chrome/adapter");
const {
  cleanupSafariHistorySnapshot,
  copySafariHistorySnapshot,
  defaultSafariProfileDir,
  findSafariBookmarksPath,
  findSafariDownloadsPath,
  normalizeSafariProfilePath,
  readSafariBookmarksPage,
  readSafariDownloadsPage,
  readSafariVisitsPage,
} = require("./safari-reader");

const NAME = "browser-history-safari";
const VERSION = "0.2.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function canonicalSafariProfileDir(profileDir, fsMod = fs) {
  const normalized = normalizeSafariProfilePath(profileDir);
  if (!normalized) return null;
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(normalized)
        : fsMod.realpathSync(normalized);
    return path.resolve(realpath);
  } catch {
    return path.resolve(normalized);
  }
}

function safariProfileFingerprint(profileDir, fsMod = fs) {
  const canonical = canonicalSafariProfileDir(profileDir, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return crypto
    .createHash("sha256")
    .update(`${NAME}\0${normalized}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function safariScopeForProfile(profileDir, fsMod = fs) {
  const canonical = canonicalSafariProfileDir(profileDir, fsMod);
  if (!canonical) return undefined;
  return createAccountScope(
    NAME,
    `profilePath:${normalizeIdentity(canonical)}`,
  );
}

function parseSince(opts) {
  const candidate = opts.since !== undefined ? opts.since : opts.sinceWatermark;
  if (candidate == null || candidate === "") return 0;
  const numeric = Number(candidate);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${NAME}.sync: since watermark must be unix milliseconds`);
  }
  return Math.floor(numeric);
}

function parsePositiveInteger(value, optionName) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
  }
  return numeric;
}

function parseScanLimit(opts) {
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInteger(opts.pageSize, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(`${NAME}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`);
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositiveInteger(opts.maxPages, "maxPages");
  const pageBudget =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : maxPages * pageSize;
  const limits = [pageBudget];
  if (opts.limit != null) {
    limits.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    limits.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...limits);
}

function stableFallback(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 24);
}

function sanitizedSafariError(error, fallbackCode) {
  const safeSourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : null;
  const sanitized = new Error(
    `${NAME}.sync: unable to read the selected Safari profile`,
  );
  sanitized.code =
    safeSourceCode === "EACCES" || safeSourceCode === "EPERM"
      ? "SAFARI_PERMISSION_DENIED"
      : safeSourceCode === "SAFARI_SCHEMA_MISMATCH" ||
          safeSourceCode === "SAFARI_BOOKMARKS_TOO_LARGE" ||
          safeSourceCode === "SAFARI_BOOKMARKS_LIMIT_EXCEEDED" ||
          safeSourceCode === "SAFARI_DOWNLOADS_TOO_LARGE" ||
          safeSourceCode === "SAFARI_DOWNLOADS_LIMIT_EXCEEDED"
        ? safeSourceCode
        : fallbackCode;
  if (safeSourceCode && sanitized.code !== safeSourceCode) {
    sanitized.sourceCode = safeSourceCode;
  }
  return sanitized;
}

class BrowserHistorySafariAdapter extends BrowserHistoryChromeAdapter {
  constructor(opts = {}) {
    super(opts);
    this.capabilities = [
      "sync:safari-history-sqlite",
      "sync:safari-bookmarks-plist",
      "sync:safari-downloads-plist",
      "sync:profile-directory",
    ];
    this.dataDisclosure = {
      fields: [
        "visits:url,title,visitTimeMs,visitCount,loadSuccessful,httpNonGet",
        "bookmarks:url,name,dateAddedMs,dateLastViewedMs,folderPath,readingList",
        "downloads:fileName,fileExtension,sourceUrl,startTimeMs,endTimeMs,state,receivedBytes,totalBytes,removeWhenDone,targetPathHash",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { history: true, bookmarks: true, downloads: true },
    };
    if (this._profileOverride) {
      this.defaultScope = safariScopeForProfile(
        this._profileOverride,
        this._deps.fs,
      );
    }
  }

  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "safari",
      defaultProfileDir: defaultSafariProfileDir,
    };
  }

  _resolveProfileDir(opts = {}) {
    const candidate =
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      this._profileOverride ||
      this._deps.defaultProfileDir();
    return canonicalSafariProfileDir(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    return profileDir
      ? safariScopeForProfile(profileDir, this._deps.fs)
      : undefined;
  }

  async authenticate(ctx = {}) {
    const profileDir = this._resolveProfileDir(ctx);
    if (!profileDir) {
      return {
        ok: false,
        reason: "PROFILE_PATH_UNRESOLVED",
        message:
          "Safari profile could not be resolved; select a directory containing History.db",
      };
    }
    try {
      if (
        !this._deps.fs.statSync(path.join(profileDir, "History.db")).isFile()
      ) {
        throw new Error("not a file");
      }
    } catch (error) {
      const permissionDenied =
        error?.code === "EACCES" || error?.code === "EPERM";
      return {
        ok: false,
        reason: permissionDenied
          ? "SAFARI_PERMISSION_DENIED"
          : "PROFILE_NOT_FOUND",
        message: permissionDenied
          ? "Safari data access was denied; grant Full Disk Access or select an exported profile copy"
          : "Safari History.db was not found; select a Safari profile directory",
      };
    }
    return {
      ok: true,
      mode: "file-import",
      profileId: safariProfileFingerprint(profileDir, this._deps.fs),
    };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate({ ...ctx, readinessOnly: true });
    return { ok: result.ok, lastChecked: Date.now(), reason: result.reason };
  }

  async *sync(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    const auth = await this.authenticate({ profilePath: profileDir });
    if (!auth.ok) {
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const since = parseSince(opts);
    const limit = parseScanLimit(opts);
    const profileId = safariProfileFingerprint(profileDir, this._deps.fs);
    const includeHistory =
      opts.include?.history !== false && opts.includeHistory !== false;
    const includeBookmarks =
      opts.include?.bookmarks !== false && opts.includeBookmarks !== false;
    const includeDownloads =
      opts.include?.downloads !== false && opts.includeDownloads !== false;
    let snapshot = null;
    let visitsResult = { visits: [], complete: true };
    let bookmarksResult = { bookmarks: [], complete: true };
    let downloadsResult = { downloads: [], complete: true };

    try {
      if (includeHistory) {
        snapshot = copySafariHistorySnapshot(profileDir, {
          fs: this._deps.fs,
        });
        visitsResult = readSafariVisitsPage(snapshot.dbPath, {
          since,
          limit,
        });
      }
    } catch (error) {
      throw sanitizedSafariError(error, "SAFARI_HISTORY_READ_FAILED");
    } finally {
      cleanupSafariHistorySnapshot(snapshot, { fs: this._deps.fs });
    }

    if (includeBookmarks) {
      const bookmarksPath = findSafariBookmarksPath(profileDir, {
        fs: this._deps.fs,
        bookmarksPath: opts.bookmarksPath,
      });
      if (bookmarksPath) {
        try {
          bookmarksResult = readSafariBookmarksPage(bookmarksPath, {
            fs: this._deps.fs,
            since,
            limit,
          });
        } catch (error) {
          throw sanitizedSafariError(error, "SAFARI_BOOKMARKS_READ_FAILED");
        }
      }
    }

    if (includeDownloads) {
      const downloadsPath = findSafariDownloadsPath(profileDir, {
        fs: this._deps.fs,
        downloadsPath: opts.downloadsPath,
      });
      if (downloadsPath) {
        try {
          downloadsResult = readSafariDownloadsPage(downloadsPath, {
            fs: this._deps.fs,
            since,
            limit,
          });
        } catch (error) {
          throw sanitizedSafariError(error, "SAFARI_DOWNLOADS_READ_FAILED");
        }
      }
    }

    const records = [
      ...visitsResult.visits.map((visit) => ({
        kind: "visit",
        id: visit.visitId,
        capturedAt: visit.visitTimeMs,
        payload: visit,
      })),
      ...bookmarksResult.bookmarks.map((bookmark) => ({
        kind: "bookmark",
        id:
          bookmark.guid || bookmark.bookmarkId || stableFallback(bookmark.url),
        capturedAt: bookmark.capturedAt,
        payload: bookmark,
      })),
      ...downloadsResult.downloads.map((download) => ({
        kind: "download",
        id:
          download.downloadId ||
          stableFallback(
            `${download.sourceUrl}\0${download.fileName}\0${download.startTimeMs}`,
          ),
        capturedAt: download.capturedAtMs,
        payload: download,
      })),
    ].sort(
      (a, b) =>
        a.capturedAt - b.capturedAt ||
        a.kind.localeCompare(b.kind) ||
        String(a.id).localeCompare(String(b.id)),
    );
    let complete =
      visitsResult.complete &&
      bookmarksResult.complete &&
      downloadsResult.complete;
    if (records.length > limit) {
      records.length = limit;
      complete = false;
    }

    for (const record of records) {
      yield {
        kind: record.kind,
        originalId: `safari-${record.kind}:${profileId}:${record.id}`,
        capturedAt: record.capturedAt,
        payload: {
          ...record.payload,
          profileId,
        },
      };
    }
    if (complete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    const result = super.normalize(raw);
    if (raw.kind === "visit" && result.events[0]) {
      const payload = raw.payload || {};
      if (typeof payload.loadSuccessful === "boolean") {
        result.events[0].extra.loadSuccessful = payload.loadSuccessful;
      }
      if (typeof payload.httpNonGet === "boolean") {
        result.events[0].extra.httpNonGet = payload.httpNonGet;
      }
    }
    if (raw.kind === "bookmark" && result.items[0]) {
      const payload = raw.payload || {};
      result.items[0].extra.dateLastViewedMs = Number.isInteger(
        payload.dateLastViewedMs,
      )
        ? payload.dateLastViewedMs
        : null;
      result.items[0].extra.readingList = payload.readingList === true;
    }
    if (raw.kind === "download" && result.events[0]) {
      const payload = raw.payload || {};
      result.events[0].extra.rawErrorCode = Number.isInteger(
        payload.rawErrorCode,
      )
        ? payload.rawErrorCode
        : null;
      result.events[0].extra.removeWhenDone = payload.removeWhenDone === true;
    }
    return result;
  }
}

module.exports = {
  BrowserHistorySafariAdapter,
  BROWSER_HISTORY_SAFARI_NAME: NAME,
  BROWSER_HISTORY_SAFARI_VERSION: VERSION,
  canonicalSafariProfileDir,
  safariProfileFingerprint,
  safariScopeForProfile,
};
