"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CAPTURED_BY,
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../constants");
const {
  createAccountScope,
  normalizeIdentity,
} = require("../../account-scope");
const {
  cleanupPlacesSnapshot,
  copyPlacesSnapshot,
  defaultFirefoxProfileDir,
  normalizeFirefoxProfilePath,
  readFirefoxData,
} = require("./firefox-db-reader");

const NAME = "browser-history-firefox";
const VERSION = "0.2.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function canonicalProfileDir(profileDir, fsMod = fs) {
  const normalized = normalizeFirefoxProfilePath(profileDir);
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

function profileFingerprint(profileDir, fsMod = fs) {
  const canonical = canonicalProfileDir(profileDir, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return crypto
    .createHash("sha256")
    .update(`${NAME}\0${normalized}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function scopeForProfile(profileDir, fsMod = fs) {
  const canonical = canonicalProfileDir(profileDir, fsMod);
  if (!canonical) return undefined;
  return createAccountScope(
    NAME,
    `profilePath:${normalizeIdentity(canonical)}`,
  );
}

function parseSince(opts) {
  if (
    opts.since === undefined &&
    typeof opts.inputPath === "string" &&
    opts.inputPath.trim()
  ) {
    // An explicitly selected database is a full import. It must not inherit
    // the unscoped watermark of a different previously imported profile.
    return 0;
  }
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
  const configuredLimits = [pageBudget];
  if (opts.limit != null) {
    configuredLimits.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    configuredLimits.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...configuredLimits);
}

function stableFallback(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 24);
}

class BrowserHistoryFirefoxAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:firefox-places-sqlite",
      "sync:profile-directory",
      "sync:file-import",
      "sync:firefox-downloads-sqlite",
      "parse:firefox-history",
      "parse:firefox-bookmarks",
      "parse:firefox-downloads",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 1000;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.runtimeCredentialOption = "profilePath";
    this.runtimeScopeIdentityKey = "profilePath";
    this.dataDisclosure = {
      fields: [
        "visits:url,title,visitTimeMs,visitType,visitCount,hidden",
        "bookmarks:url,name,dateAddedMs,lastModifiedMs,folderPath",
        "downloads:fileName,fileExtension,sourceUrl,startTimeMs,endTimeMs,state,fileSize,deleted,targetPathHash",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { history: true, bookmarks: true, downloads: true },
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultProfileDir:
        typeof opts.defaultProfileDir === "function"
          ? opts.defaultProfileDir
          : defaultFirefoxProfileDir,
    };
    this._profileOverride =
      typeof opts.profilePath === "string" && opts.profilePath.trim()
        ? opts.profilePath
        : null;
    if (this._profileOverride) {
      this.defaultScope = scopeForProfile(this._profileOverride, this._deps.fs);
    }
  }

  _resolveProfileDir(opts = {}) {
    const candidate =
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      (typeof opts.inputPath === "string" && opts.inputPath.trim()) ||
      this._profileOverride ||
      this._deps.defaultProfileDir();
    return canonicalProfileDir(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    return profileDir ? scopeForProfile(profileDir, this._deps.fs) : undefined;
  }

  async authenticate(ctx = {}) {
    const profileDir = this._resolveProfileDir(ctx);
    if (!profileDir) {
      return {
        ok: false,
        reason: "PROFILE_PATH_UNRESOLVED",
        message:
          "Firefox profile could not be resolved; select a profile directory",
      };
    }
    try {
      if (
        !this._deps.fs.statSync(path.join(profileDir, "places.sqlite")).isFile()
      ) {
        throw new Error("not a file");
      }
    } catch {
      return {
        ok: false,
        reason: "PROFILE_NOT_FOUND",
        message:
          "Firefox places.sqlite was not found; select a profile directory or the database file",
      };
    }
    if (ctx._skipSchemaProbe === true) {
      return {
        ok: true,
        mode: "file-import",
        profileId: profileFingerprint(profileDir, this._deps.fs),
      };
    }
    let snapshot = null;
    try {
      snapshot = copyPlacesSnapshot(profileDir, { fs: this._deps.fs });
      readFirefoxData(snapshot.dbPath, {
        limit: 1,
        includeHistory: false,
        includeBookmarks: true,
        includeDownloads: false,
      });
    } catch (error) {
      const schemaMissing = error?.code === "FIREFOX_SCHEMA_UNSUPPORTED";
      return {
        ok: false,
        reason: schemaMissing
          ? "PROFILE_NOT_INITIALIZED"
          : "PROFILE_UNREADABLE",
        message: schemaMissing
          ? "Firefox profile has not initialized its Places database; use Firefox once and retry"
          : "Firefox Places database could not be read from a local snapshot",
      };
    } finally {
      cleanupPlacesSnapshot(snapshot, { fs: this._deps.fs });
    }
    return {
      ok: true,
      mode: "file-import",
      profileId: profileFingerprint(profileDir, this._deps.fs),
    };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate({ ...ctx, readinessOnly: true });
    return { ok: result.ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    const auth = await this.authenticate({
      profilePath: profileDir,
      _skipSchemaProbe: true,
    });
    if (!auth.ok) {
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const since = parseSince(opts);
    const limit = parseScanLimit(opts);
    const scanStartedAt = Date.now();
    const profileId = profileFingerprint(profileDir, this._deps.fs);
    let snapshot = null;
    try {
      snapshot = copyPlacesSnapshot(profileDir, { fs: this._deps.fs });
      const result = readFirefoxData(snapshot.dbPath, {
        since,
        limit,
        includeHistory: opts.include?.history !== false,
        includeBookmarks: opts.include?.bookmarks !== false,
        includeDownloads: opts.include?.downloads !== false,
        includeHidden: opts.includeHidden === true,
      });
      if (
        !result.complete &&
        typeof opts.inputPath === "string" &&
        opts.inputPath.trim()
      ) {
        const error = new Error(
          `${NAME}.sync: selected places.sqlite exceeds the scan budget; increase maxPages or pageSize`,
        );
        error.code = "FIREFOX_SCAN_BUDGET_EXCEEDED";
        throw error;
      }

      const records = [
        ...result.visits.map((visit) => ({
          kind: "visit",
          id: visit.visitId,
          capturedAt: visit.visitTimeMs || scanStartedAt,
          payload: visit,
        })),
        ...result.bookmarks.map((bookmark) => ({
          kind: "bookmark",
          id:
            bookmark.guid ||
            bookmark.bookmarkId ||
            stableFallback(bookmark.url),
          capturedAt:
            bookmark.lastModifiedMs || bookmark.dateAddedMs || scanStartedAt,
          payload: bookmark,
        })),
        ...result.downloads.map((download) => ({
          kind: "download",
          id:
            download.placeGuid ||
            download.placeId ||
            stableFallback(`${download.sourceUrl}\0${download.startTimeMs}`),
          capturedAt: download.capturedAtMs || scanStartedAt,
          payload: download,
        })),
      ].sort(
        (a, b) =>
          a.capturedAt - b.capturedAt ||
          a.kind.localeCompare(b.kind) ||
          String(a.id).localeCompare(String(b.id)),
      );

      for (const record of records) {
        yield {
          kind: record.kind,
          originalId: `firefox-${record.kind}:${profileId}:${record.id}`,
          capturedAt: record.capturedAt,
          payload: {
            ...record.payload,
            profileId,
          },
        };
      }
      if (result.complete && typeof opts.markWatermarkComplete === "function") {
        opts.markWatermarkComplete();
      }
    } finally {
      cleanupPlacesSnapshot(snapshot, { fs: this._deps.fs });
    }
  }

  normalize(raw) {
    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
    };

    if (raw.kind === "visit") {
      const url = typeof payload.url === "string" ? payload.url : "";
      const rawTitle =
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : url || "(无标题)";
      const title =
        rawTitle.length > 200 ? `${rawTitle.slice(0, 200)}…` : rawTitle;
      const occurredAt = Number.isInteger(payload.visitTimeMs)
        ? payload.visitTimeMs
        : raw.capturedAt;
      return {
        events: [
          {
            id: `event-firefox-visit-${payload.profileId}-${payload.visitId}`,
            type: ENTITY_TYPES.EVENT,
            subtype: EVENT_SUBTYPES.BROWSE,
            occurredAt,
            ingestedAt,
            source,
            actor: "self",
            content: { title, text: url },
            extra: {
              url,
              visitType: payload.visitType || null,
              rawVisitType: Number.isInteger(payload.rawVisitType)
                ? payload.rawVisitType
                : null,
              visitCount: payload.visitCount || 0,
              typedCount: payload.typedCount || 0,
              hidden: payload.hidden === true,
              fromVisit: payload.fromVisit || 0,
              browser: "firefox",
              profileId: payload.profileId,
            },
          },
        ],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }

    if (raw.kind === "bookmark") {
      const url = typeof payload.url === "string" ? payload.url : "";
      const name =
        (typeof payload.name === "string" && payload.name.trim()) ||
        url ||
        "(无标题)";
      const stableId =
        payload.guid ||
        payload.bookmarkId ||
        stableFallback(`${payload.profileId}\0${url}`);
      return {
        events: [],
        persons: [],
        places: [],
        items: [
          {
            id: `item-firefox-bookmark-${payload.profileId}-${stableId}`,
            type: ENTITY_TYPES.ITEM,
            subtype: ITEM_SUBTYPES.LINK,
            name,
            category: "bookmark",
            ingestedAt,
            source,
            extra: {
              url,
              dateAddedMs: Number.isInteger(payload.dateAddedMs)
                ? payload.dateAddedMs
                : null,
              lastModifiedMs: Number.isInteger(payload.lastModifiedMs)
                ? payload.lastModifiedMs
                : null,
              folderPath:
                typeof payload.folderPath === "string"
                  ? payload.folderPath
                  : null,
              browser: "firefox",
              profileId: payload.profileId,
            },
          },
        ],
        topics: [],
      };
    }

    if (raw.kind === "download") {
      const fileName =
        (typeof payload.fileName === "string" && payload.fileName.trim()) ||
        "(unnamed download)";
      const title =
        fileName.length > 200 ? `${fileName.slice(0, 200)}\u2026` : fileName;
      const occurredAt = Number.isInteger(payload.startTimeMs)
        ? payload.startTimeMs
        : raw.capturedAt;
      const stableIdValue =
        payload.placeGuid ||
        payload.placeId ||
        stableFallback(
          `${payload.profileId}\0${payload.sourceUrl}\0${occurredAt}`,
        );
      const stableId = /^[A-Za-z0-9._-]{1,160}$/u.test(String(stableIdValue))
        ? String(stableIdValue)
        : stableFallback(stableIdValue);
      const event = {
        id: `event-firefox-download-${payload.profileId}-${stableId}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.DOWNLOAD,
        occurredAt,
        ingestedAt,
        source,
        actor: "self",
        content: {
          title,
          text: typeof payload.sourceUrl === "string" ? payload.sourceUrl : "",
        },
        extra: {
          browser: "firefox",
          profileId: payload.profileId,
          fileName,
          fileExtension: payload.fileExtension || null,
          sourceUrl: payload.sourceUrl || null,
          endTimeMs: Number.isInteger(payload.endTimeMs)
            ? payload.endTimeMs
            : null,
          fileSize: Number.isSafeInteger(payload.fileSize)
            ? payload.fileSize
            : null,
          state: payload.state || null,
          rawState: Number.isInteger(payload.rawState)
            ? payload.rawState
            : null,
          deleted: payload.deleted === true,
          reputationCheckVerdict: payload.reputationCheckVerdict || null,
          targetPathHash: payload.targetPathHash || null,
        },
      };
      if (
        Number.isInteger(payload.endTimeMs) &&
        payload.endTimeMs >= occurredAt
      ) {
        event.durationMs = payload.endTimeMs - occurredAt;
      }
      return {
        events: [event],
        persons: [],
        places: [],
        items: [],
        topics: [],
      };
    }

    throw new Error(`${NAME}.normalize: unknown raw.kind=${raw.kind}`);
  }
}

module.exports = {
  BrowserHistoryFirefoxAdapter,
  BROWSER_HISTORY_FIREFOX_NAME: NAME,
  BROWSER_HISTORY_FIREFOX_VERSION: VERSION,
  canonicalProfileDir,
  profileFingerprint,
  scopeForProfile,
};
