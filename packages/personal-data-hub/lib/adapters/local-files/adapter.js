"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  CAPTURED_BY,
  ENTITY_TYPES,
  EVENT_SUBTYPES,
} = require("../../constants");
const { createAccountScope } = require("../../account-scope");
const {
  DEFAULT_EXCLUDES,
  HARD_MAX_FILES,
  canonicalizeRoots,
  defaultRoots,
  inspectRoots,
  scanRoots,
} = require("./file-walker");

const NAME = "local-files";
const VERSION = "0.2.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 1;
const WATERMARK_LOOKBACK_MS = 1000;
const ROOT_CATEGORIES = new Set([
  "documents",
  "desktop",
  "downloads",
  "pictures",
  "videos",
  "music",
  "selected",
]);

function sha256Hex(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value == null ? "" : value), "utf8")
    .digest("hex")
    .slice(0, length);
}

function rootInput(options = {}) {
  for (const key of ["roots", "profilePath", "localFilesRoots"]) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    const value = options[key];
    if (Array.isArray(value)) return { provided: true, roots: value };
    if (typeof value === "string") {
      return { provided: true, roots: value.length > 0 ? [value] : [] };
    }
  }
  return { provided: false, roots: [] };
}

function normalizedRootIdentity(root) {
  return String(root);
}

function scopeForRoots(roots, fsMod = fs) {
  const canonicalRoots = canonicalizeRoots(roots, fsMod);
  if (canonicalRoots.length === 0) return undefined;
  const encodedRoots = canonicalRoots
    .map((root) =>
      Buffer.from(normalizedRootIdentity(root), "utf8").toString("hex"),
    )
    .sort();
  return createAccountScope(NAME, `roots:${encodedRoots.join(":")}`);
}

function parsePositiveInteger(value, optionName) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
  }
  return numeric;
}

function scanLimit(opts = {}) {
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
      : pageSize * maxPages;
  const candidates = [Math.min(pageBudget, HARD_MAX_FILES)];
  if (opts.limit != null) {
    candidates.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    candidates.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...candidates);
}

function safeTimestamp(value, fallback = 1, ceiling = Date.now()) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), ceiling));
}

function safeFilename(value) {
  const leaf =
    String(value == null ? "" : value)
      .split(/[/\\]+/u)
      .pop() || "";
  const normalized = leaf.replace(/\p{Cc}+/gu, "_").trim();
  return normalized ? normalized.slice(0, 255) : "(unnamed)";
}

function safeExtension(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  const extension = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9][a-z0-9+_-]{0,31}$/u.test(extension) ? extension : "";
}

function truncateText(value, maxLength) {
  const text = String(value);
  return text.length <= maxLength
    ? text
    : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function safeOriginalId(value) {
  return typeof value === "string" &&
    /^local-file-entry:[a-f0-9]{48}$/u.test(value)
    ? value
    : `local-file-entry:${sha256Hex(value, 48)}`;
}

function sanitizedReadError(error) {
  if (error?.code === "ABORT_ERR" || error?.name === "AbortError") {
    const aborted = new Error(`${NAME}.sync: local directory scan aborted`);
    aborted.name = "AbortError";
    aborted.code = "ABORT_ERR";
    return aborted;
  }
  if (error?.code === "LOCAL_FILES_SCAN_TIMEOUT") {
    const timedOut = new Error(
      `${NAME}.sync: local directory scan exceeded its time budget`,
    );
    timedOut.code = "LOCAL_FILES_SCAN_TIMEOUT";
    return timedOut;
  }
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${NAME}.sync: unable to scan the selected local directories (${sourceCode})`,
  );
  wrapped.code = "LOCAL_FILES_READ_FAILED";
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

function incompleteScanError(result, limit, opts = {}) {
  if (result?.complete === true) return null;
  const issues = Array.isArray(result?.issues)
    ? [
        ...new Set(result.issues.filter((issue) => typeof issue === "string")),
      ].sort()
    : [];
  const hasFileLimit = issues.includes("FILE_LIMIT");
  const hasOnlyCardinalityIssues =
    hasFileLimit &&
    issues.every(
      (issue) => issue === "FILE_LIMIT" || issue === "ROOT_INCOMPLETE",
    );
  const configuredPerRootLimit = Number(opts.maxFilesPerRoot);
  const perRootLimitStopsGrowth =
    Number.isSafeInteger(configuredPerRootLimit) &&
    configuredPerRootLimit > 0 &&
    configuredPerRootLimit <= limit;
  if (
    hasOnlyCardinalityIssues &&
    limit < HARD_MAX_FILES &&
    !perRootLimitStopsGrowth
  ) {
    return null;
  }

  const limitExhausted =
    hasOnlyCardinalityIssues &&
    (limit >= HARD_MAX_FILES || perRootLimitStopsGrowth);
  const code = limitExhausted
    ? "LOCAL_FILES_SCAN_LIMIT_EXHAUSTED"
    : "LOCAL_FILES_SCAN_INCOMPLETE";
  const issueSummary = issues.length > 0 ? issues.join(",") : "UNKNOWN";
  const message = limitExhausted
    ? "reduce the selected scope or raise the explicit per-root limit"
    : "resolve unreadable, changing, escaped, or structurally capped entries";
  const error = new Error(
    `${NAME}.sync: local directory scan incomplete (${issueSummary}); ${message}`,
  );
  error.code = code;
  error.issueCodes = issues;
  return error;
}

class LocalFilesAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:local-file-walk",
      "sync:scan-directory",
      "sync:profile-directory",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = WATERMARK_LOOKBACK_MS;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.dataDisclosure = {
      fields: [
        "files:fileHash,rootHash,name,extension,size,mtimeMs,rootCategory,relativeDepth",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { files: true },
      excludedFields: [
        "absolute and relative paths",
        "file contents, thumbnails and extended attributes",
        "owner, ACL, alternate data streams and network share addresses",
        "symlink and reparse-point targets",
      ],
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultRoots:
        typeof opts.defaultRoots === "function"
          ? opts.defaultRoots
          : defaultRoots,
      inspectRoots:
        typeof opts.inspectRoots === "function"
          ? opts.inspectRoots
          : inspectRoots,
      scanRoots:
        typeof opts.scanRoots === "function" ? opts.scanRoots : scanRoots,
    };
    this._now = typeof opts.now === "function" ? opts.now : Date.now;
    this._excludesOverride = Array.isArray(opts.excludes)
      ? [...opts.excludes]
      : null;
    const configured = rootInput(opts);
    this._rootOverride = configured.provided
      ? canonicalizeRoots(configured.roots, this._deps.fs)
      : null;
    this.defaultScope =
      this._rootOverride && this._rootOverride.length > 0
        ? scopeForRoots(this._rootOverride, this._deps.fs)
        : undefined;
  }

  _resolveRootSelection(opts = {}) {
    const runtime = rootInput(opts);
    if (runtime.provided) {
      return {
        roots: canonicalizeRoots(runtime.roots, this._deps.fs),
        optionalMissingRoots: false,
      };
    }
    if (this._rootOverride !== null) {
      return {
        roots: [...this._rootOverride],
        optionalMissingRoots: false,
      };
    }
    return {
      roots: canonicalizeRoots(this._deps.defaultRoots(), this._deps.fs),
      optionalMissingRoots: true,
    };
  }

  _resolveExcludes(opts = {}) {
    if (Array.isArray(opts.excludes)) return [...opts.excludes];
    if (this._excludesOverride !== null) return [...this._excludesOverride];
    return DEFAULT_EXCLUDES;
  }

  _inspectSelection(opts = {}) {
    const selection = this._resolveRootSelection(opts);
    const inspection = this._deps.inspectRoots(selection.roots, {
      fs: this._deps.fs,
      optionalMissingRoots: selection.optionalMissingRoots,
      signal: opts.signal,
    });
    return { ...selection, inspection };
  }

  resolveDefaultScope(opts = {}) {
    return scopeForRoots(this._resolveRootSelection(opts).roots, this._deps.fs);
  }

  async authenticate(ctx = {}) {
    let resolved;
    try {
      resolved = this._inspectSelection(ctx);
    } catch (error) {
      const reason = [
        "LOCAL_FILES_NETWORK_ROOT_UNSUPPORTED",
        "LOCAL_FILES_REPARSE_ROOT_UNSUPPORTED",
      ].includes(error?.code)
        ? error.code
        : "LOCAL_FILES_ROOT_UNRESOLVED";
      return {
        ok: false,
        reason,
        message: "local file roots could not be resolved",
      };
    }
    const { optionalMissingRoots, inspection } = resolved;
    if (
      inspection.roots.length === 0 ||
      inspection.readableRoots.length === 0
    ) {
      return {
        ok: false,
        reason: "LOCAL_FILES_ROOT_UNRESOLVED",
        message: "no readable local file directory was found",
      };
    }
    if (
      inspection.invalidCount > 0 ||
      (!optionalMissingRoots && inspection.missingCount > 0)
    ) {
      return {
        ok: false,
        reason: "LOCAL_FILES_ROOT_UNRESOLVED",
        message: "one or more selected local file directories do not exist",
      };
    }
    if (inspection.unreadableCount > 0) {
      return {
        ok: false,
        reason: "LOCAL_FILES_NOT_READABLE",
        message: "one or more selected local file directories are not readable",
      };
    }
    return {
      ok: true,
      mode: "file-import",
      rootCount: inspection.readableRoots.length,
      metadataOnly: true,
    };
  }

  async healthCheck(opts = {}) {
    if (opts.include?.files === false) {
      return { ok: true, skipped: true, lastChecked: Date.now() };
    }
    const result = await this.authenticate(opts);
    return result.ok
      ? { ok: true, lastChecked: Date.now() }
      : {
          ok: false,
          reason: result.reason,
          error: result.message,
          lastChecked: Date.now(),
        };
  }

  async *sync(opts = {}) {
    if (opts.include?.files === false) return;
    if (opts.signal?.aborted) {
      throw sanitizedReadError({ code: "ABORT_ERR", name: "AbortError" });
    }
    const resolved = this._inspectSelection(opts);
    const auth = await this.authenticate(opts);
    if (opts.signal?.aborted) {
      throw sanitizedReadError({ code: "ABORT_ERR", name: "AbortError" });
    }
    if (!auth.ok) {
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const limit = scanLimit(opts);
    const roots = resolved.inspection.readableRoots;
    const scope = scopeForRoots(resolved.roots, this._deps.fs);
    let result;
    try {
      result = this._deps.scanRoots(roots, {
        fs: this._deps.fs,
        excludes: this._resolveExcludes(opts),
        maxDepth: opts.maxDepth,
        maxDirectories: opts.maxDirectories,
        maxEntries: opts.maxEntries,
        maxEntriesPerDirectory: opts.maxEntriesPerDirectory,
        maxMetadataBytes: opts.maxMetadataBytes,
        maxScanMs: opts.maxScanMs,
        maxFilesPerRoot: opts.maxFilesPerRoot,
        maxRecords: limit,
        signal: opts.signal,
        // A persisted timestamp is intentionally not used as a filter. A
        // bounded full metadata rescan is required to discover old files
        // copied into a selected root after the previous sync.
        since: opts.since,
      });
    } catch (error) {
      throw sanitizedReadError(error);
    }

    const incompleteError = incompleteScanError(result, limit, opts);
    if (incompleteError) throw incompleteError;

    const now = this._now();
    for (const record of result.records) {
      const rootHash = sha256Hex(normalizedRootIdentity(record.root));
      const fileHash = sha256Hex(
        `${scope}\0${rootHash}\0${String(record.relativePath)}`,
      );
      const name = safeFilename(record.name);
      const sourceMtimeMs =
        Number.isFinite(Number(record.mtimeMs)) && Number(record.mtimeMs) > 0
          ? Math.floor(Number(record.mtimeMs))
          : 1;
      const capturedAt =
        sourceMtimeMs > now ? 1 : safeTimestamp(sourceMtimeMs, 1, now);
      const size =
        Number.isSafeInteger(record.size) && record.size >= 0 ? record.size : 0;
      const originalId = `local-file-entry:${sha256Hex(
        `${fileHash}\0${sourceMtimeMs}\0${size}`,
        48,
      )}`;
      yield {
        kind: "local-file",
        originalId,
        capturedAt,
        scope,
        payload: {
          fileHash,
          rootHash,
          name,
          extension: safeExtension(name),
          size,
          mtimeMs: capturedAt,
          rootCategory: ROOT_CATEGORIES.has(record.rootCategory)
            ? record.rootCategory
            : "selected",
          relativeDepth:
            Number.isSafeInteger(record.relativeDepth) &&
            record.relativeDepth >= 0
              ? Math.min(record.relativeDepth, 32)
              : 0,
        },
      };
    }

    if (result.complete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || raw.kind !== "local-file") {
      throw new Error(`${NAME}.normalize: unknown raw.kind=${raw && raw.kind}`);
    }
    const payload =
      raw.payload && typeof raw.payload === "object" ? raw.payload : {};
    const capturedAt = safeTimestamp(
      raw.capturedAt,
      safeTimestamp(payload.mtimeMs, 1),
    );
    const originalId = safeOriginalId(raw.originalId);
    const name = safeFilename(payload.name);
    const extension = safeExtension(name);
    const fileHash =
      typeof payload.fileHash === "string" &&
      /^[a-f0-9]{64}$/u.test(payload.fileHash)
        ? payload.fileHash
        : sha256Hex(`${originalId}\0file`);
    const rootHash =
      typeof payload.rootHash === "string" &&
      /^[a-f0-9]{64}$/u.test(payload.rootHash)
        ? payload.rootHash
        : sha256Hex(`${originalId}\0root`);
    const scope =
      typeof raw.scope === "string" &&
      /^account:local-files:[a-f0-9]{32}$/u.test(raw.scope)
        ? raw.scope
        : null;
    const rootCategory = ROOT_CATEGORIES.has(payload.rootCategory)
      ? payload.rootCategory
      : "selected";
    const relativeDepth =
      Number.isSafeInteger(payload.relativeDepth) && payload.relativeDepth >= 0
        ? Math.min(payload.relativeDepth, 32)
        : 0;
    const size =
      Number.isSafeInteger(payload.size) && payload.size >= 0
        ? payload.size
        : 0;
    const title = truncateText(`[file] ${name}`, 100);
    const event = {
      id: `event-local-file-${sha256Hex(originalId, 32)}`,
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.OTHER,
      occurredAt: capturedAt,
      ingestedAt: Date.now(),
      source: {
        adapter: NAME,
        adapterVersion: VERSION,
        capturedAt,
        capturedBy: CAPTURED_BY.SQLITE,
        originalId,
      },
      actor: "self",
      content: {
        title,
        text: name,
      },
      extra: {
        kind: "local-file",
        fileHash,
        rootHash,
        name,
        extension,
        size,
        rootCategory,
        relativeDepth,
      },
    };
    if (scope) event.extra.scope = scope;
    return {
      events: [event],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };
  }
}

module.exports = {
  LocalFilesAdapter,
  LOCAL_FILES_NAME: NAME,
  LOCAL_FILES_VERSION: VERSION,
  scopeForRoots,
};
