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
  cleanupHistorySnapshot,
  copyHistorySnapshot,
  defaultChromeProfileDir,
  readDownloadsPage,
  readVisitsPage,
} = require("./chrome-db-reader");
const { bookmarkCapturedAt, readBookmarksPage } = require("./bookmarks-reader");

const NAME = "browser-history-chrome";
const VERSION = "0.3.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function normalizeChromiumProfilePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  const basename = path.basename(resolved).toLowerCase();
  return basename === "history" || basename === "bookmarks"
    ? path.dirname(resolved)
    : resolved;
}

function canonicalProfileDir(profileDir, fsMod = fs) {
  const normalized = normalizeChromiumProfilePath(profileDir);
  if (!normalized) return null;
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(normalized)
        : fsMod.realpathSync(normalized);
    return path.resolve(realpath);
  } catch {
    return normalized;
  }
}

function profileFingerprint(adapterName, profileDir, fsMod = fs) {
  const canonical = canonicalProfileDir(profileDir, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return crypto
    .createHash("sha256")
    .update(`${adapterName}\0${normalized}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function scopeForProfile(adapterName, profileDir, fsMod = fs) {
  const canonical = canonicalProfileDir(profileDir, fsMod);
  if (!canonical) return undefined;
  return createAccountScope(
    adapterName,
    `profilePath:${normalizeIdentity(canonical)}`,
  );
}

function parseSince(opts, adapterName = NAME) {
  const candidate = opts.since !== undefined ? opts.since : opts.sinceWatermark;
  if (candidate == null || candidate === "") return 0;
  const numeric = Number(candidate);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(
      `${adapterName}.sync: since watermark must be unix milliseconds`,
    );
  }
  return Math.floor(numeric);
}

function parsePositiveInteger(value, optionName, adapterName = NAME) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(
      `${adapterName}.sync: ${optionName} must be a positive integer`,
    );
  }
  return numeric;
}

function parseScanLimit(opts, adapterName = NAME) {
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInteger(opts.pageSize, "pageSize", adapterName);
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(
      `${adapterName}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`,
    );
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositiveInteger(opts.maxPages, "maxPages", adapterName);
  const pageBudget =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : maxPages * pageSize;
  const configuredLimits = [pageBudget];
  if (opts.limit != null) {
    configuredLimits.push(
      parsePositiveInteger(opts.limit, "limit", adapterName),
    );
  }
  if (opts.maxEvents != null) {
    configuredLimits.push(
      parsePositiveInteger(opts.maxEvents, "maxEvents", adapterName),
    );
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

function sanitizedProfileReadError(adapterName, error) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${adapterName}.sync: unable to read the selected browser profile (${sourceCode})`,
  );
  wrapped.code = "CHROMIUM_PROFILE_READ_FAILED";
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

// Chrome, Edge, Brave and other Chromium-derived browsers share the History
// SQLite and Bookmarks JSON formats. Subclasses only provide browser identity
// and a platform-specific default profile resolver.
class BrowserHistoryChromeAdapter {
  constructor(opts = {}) {
    const cfg = this._browserConfig();
    this.name = cfg.name;
    this.version = cfg.version;
    this._browser = cfg.browser;
    this.capabilities = [
      `sync:${cfg.browser}-history-sqlite`,
      `sync:${cfg.browser}-downloads-sqlite`,
      `sync:${cfg.browser}-bookmarks-json`,
      "sync:profile-directory",
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
        "visits:url,title,visitTimeMs,transition,visitDurationMs,hidden",
        "downloads:fileName,fileExtension,sourceUrl,startTimeMs,endTimeMs,state,danger,receivedBytes,totalBytes,opened,targetPathHash",
        "bookmarks:url,name,dateAddedMs,dateLastUsedMs,folderPath",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { history: true, downloads: true, bookmarks: true },
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultProfileDir:
        typeof opts.defaultProfileDir === "function"
          ? opts.defaultProfileDir
          : cfg.defaultProfileDir,
    };
    this._profileOverride =
      typeof opts.profilePath === "string" && opts.profilePath.trim()
        ? opts.profilePath
        : null;
    if (this._profileOverride) {
      this.defaultScope = scopeForProfile(
        this.name,
        this._profileOverride,
        this._deps.fs,
      );
    }
  }

  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "chrome",
      defaultProfileDir: defaultChromeProfileDir,
    };
  }

  _resolveProfileDir(opts = {}) {
    const candidate =
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      this._profileOverride ||
      this._deps.defaultProfileDir();
    return canonicalProfileDir(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    return profileDir
      ? scopeForProfile(this.name, profileDir, this._deps.fs)
      : undefined;
  }

  async authenticate(ctx = {}) {
    const profileDir = this._resolveProfileDir(ctx);
    if (!profileDir) {
      return {
        ok: false,
        reason: "PROFILE_PATH_UNRESOLVED",
        message: `No ${this._browser} profile could be resolved`,
      };
    }
    try {
      if (!this._deps.fs.statSync(path.join(profileDir, "History")).isFile()) {
        throw new Error("not a file");
      }
    } catch {
      return {
        ok: false,
        reason: "PROFILE_NOT_FOUND",
        message: `${this._browser} History was not found; select a profile directory`,
      };
    }
    return {
      ok: true,
      mode: "file-import",
      profileId: profileFingerprint(this.name, profileDir, this._deps.fs),
    };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate({ ...ctx, readinessOnly: true });
    return { ok: result.ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const profileDir = this._resolveProfileDir(opts);
    const auth = await this.authenticate({ profilePath: profileDir });
    if (!auth.ok) {
      const error = new Error(`${this.name}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const includeHistory = opts.include?.history !== false;
    const includeDownloads = opts.include?.downloads !== false;
    const includeBookmarks = opts.include?.bookmarks !== false;
    const since = parseSince(opts, this.name);
    const limit = parseScanLimit(opts, this.name);
    const profileId = profileFingerprint(this.name, profileDir, this._deps.fs);
    const records = [];
    let complete = true;

    if (includeHistory || includeDownloads) {
      let snapshot = null;
      try {
        snapshot = copyHistorySnapshot(profileDir, { fs: this._deps.fs });
        if (includeHistory) {
          const result = readVisitsPage(snapshot, {
            since,
            limit,
            includeHidden: opts.includeHidden === true,
          });
          complete = complete && result.complete;
          for (const visit of result.visits) {
            records.push({
              kind: "visit",
              id: visit.visitId,
              capturedAt: visit.visitTimeMs,
              payload: visit,
            });
          }
        }
        if (includeDownloads) {
          const result = readDownloadsPage(snapshot, { since, limit });
          complete = complete && result.complete;
          for (const download of result.downloads) {
            records.push({
              kind: "download",
              id:
                download.guid ||
                download.downloadId ||
                stableFallback(`${download.fileName}\0${download.startTimeMs}`),
              capturedAt: download.capturedAtMs,
              payload: download,
            });
          }
        }
      } catch (error) {
        throw sanitizedProfileReadError(this.name, error);
      } finally {
        if (snapshot) {
          cleanupHistorySnapshot(snapshot, { fs: this._deps.fs });
        }
      }
    }

    if (includeBookmarks) {
      let result;
      try {
        result = readBookmarksPage(profileDir, {
          fs: this._deps.fs,
          since,
          limit,
        });
      } catch (error) {
        throw sanitizedProfileReadError(this.name, error);
      }
      complete = complete && result.complete;
      for (const bookmark of result.bookmarks) {
        records.push({
          kind: "bookmark",
          id:
            bookmark.guid ||
            bookmark.id ||
            stableFallback(`${bookmark.url}\0${bookmark.folderPath}`),
          capturedAt: bookmarkCapturedAt(bookmark),
          payload: bookmark,
        });
      }
    }

    records.sort(
      (a, b) =>
        a.capturedAt - b.capturedAt ||
        a.kind.localeCompare(b.kind) ||
        String(a.id).localeCompare(String(b.id)),
    );
    if (records.length > limit) {
      records.length = limit;
      complete = false;
    }

    for (const record of records) {
      yield {
        kind: record.kind,
        originalId: `${this._browser}-${record.kind}:${profileId}:${record.id}`,
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
    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const source = {
      adapter: this.name,
      adapterVersion: this.version,
      originalId: raw.originalId,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
    };

    if (raw.kind === "visit") {
      const url = typeof payload.url === "string" ? payload.url : "";
      const rawTitle =
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim()
          : url || "(\u65e0\u6807\u9898)";
      const title =
        rawTitle.length > 200 ? `${rawTitle.slice(0, 200)}\u2026` : rawTitle;
      const occurredAt = Number.isInteger(payload.visitTimeMs)
        ? payload.visitTimeMs
        : raw.capturedAt;
      const event = {
        id: `event-${this._browser}-visit-${payload.profileId}-${payload.visitId}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.BROWSE,
        occurredAt,
        ingestedAt,
        source,
        actor: "self",
        content: { title, text: url },
        extra: {
          url,
          transition: payload.transition || null,
          rawTransition: Number.isInteger(payload.rawTransition)
            ? payload.rawTransition
            : null,
          visitCount: payload.visitCount || 0,
          typedCount: payload.typedCount || 0,
          hidden: payload.hidden === true,
          fromVisit: payload.fromVisit || 0,
          browser: this._browser,
          profileId: payload.profileId,
        },
      };
      if (
        Number.isInteger(payload.visitDurationMs) &&
        payload.visitDurationMs > 0
      ) {
        event.durationMs = payload.visitDurationMs;
      }
      return {
        events: [event],
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
        "(\u65e0\u6807\u9898)";
      const stableId =
        payload.guid ||
        payload.id ||
        stableFallback(`${payload.profileId}\0${url}`);
      return {
        events: [],
        persons: [],
        places: [],
        items: [
          {
            id: `item-${this._browser}-bookmark-${payload.profileId}-${stableId}`,
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
              dateLastUsedMs: Number.isInteger(payload.dateLastUsedMs)
                ? payload.dateLastUsedMs
                : null,
              folderPath:
                typeof payload.folderPath === "string"
                  ? payload.folderPath
                  : null,
              browser: this._browser,
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
      const rawTitle =
        fileName.length > 200 ? `${fileName.slice(0, 200)}\u2026` : fileName;
      const occurredAt = Number.isInteger(payload.startTimeMs)
        ? payload.startTimeMs
        : raw.capturedAt;
      const stableIdValue =
        payload.guid ||
        payload.downloadId ||
        stableFallback(`${payload.profileId}\0${fileName}\0${occurredAt}`);
      const stableId = /^[A-Za-z0-9._-]{1,160}$/u.test(String(stableIdValue))
        ? String(stableIdValue)
        : stableFallback(stableIdValue);
      const event = {
        id: `event-${this._browser}-download-${payload.profileId}-${stableId}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.DOWNLOAD,
        occurredAt,
        ingestedAt,
        source,
        actor: "self",
        content: {
          title: rawTitle,
          text: typeof payload.sourceUrl === "string" ? payload.sourceUrl : "",
        },
        extra: {
          browser: this._browser,
          profileId: payload.profileId,
          fileName,
          fileExtension: payload.fileExtension || null,
          sourceUrl: payload.sourceUrl || null,
          initialUrl: payload.initialUrl || null,
          finalUrl: payload.finalUrl || null,
          referrerUrl: payload.referrerUrl || null,
          siteUrl: payload.siteUrl || null,
          tabUrl: payload.tabUrl || null,
          tabReferrerUrl: payload.tabReferrerUrl || null,
          endTimeMs: Number.isInteger(payload.endTimeMs)
            ? payload.endTimeMs
            : null,
          lastAccessTimeMs: Number.isInteger(payload.lastAccessTimeMs)
            ? payload.lastAccessTimeMs
            : null,
          receivedBytes: Number.isSafeInteger(payload.receivedBytes)
            ? payload.receivedBytes
            : null,
          totalBytes: Number.isSafeInteger(payload.totalBytes)
            ? payload.totalBytes
            : null,
          state: payload.state || null,
          rawState: Number.isInteger(payload.rawState)
            ? payload.rawState
            : null,
          danger: payload.danger || null,
          rawDanger: Number.isInteger(payload.rawDanger)
            ? payload.rawDanger
            : null,
          interruptReason: Number.isSafeInteger(payload.interruptReason)
            ? payload.interruptReason
            : null,
          opened: payload.opened === true,
          transient: payload.transient === true,
          mimeType: payload.mimeType || null,
          originalMimeType: payload.originalMimeType || null,
          httpMethod: payload.httpMethod || null,
          extensionName: payload.extensionName || null,
          targetPathHash: payload.targetPathHash || null,
          contentHashSha256: payload.contentHashSha256 || null,
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

    throw new Error(`${this.name}.normalize: unknown raw.kind=${raw.kind}`);
  }
}

module.exports = {
  BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME: NAME,
  BROWSER_HISTORY_CHROME_VERSION: VERSION,
  canonicalChromiumProfileDir: canonicalProfileDir,
  chromiumProfileFingerprint: profileFingerprint,
  normalizeChromiumProfilePath,
};
