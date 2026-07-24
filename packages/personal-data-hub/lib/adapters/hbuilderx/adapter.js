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
  HARD_MAX_ROOTS,
  HARD_MAX_RECORDS,
  canonicalizeRoots,
  defaultHBuilderXHomes,
  inspectHBuilderXLocalData,
  normalizeHBuilderXEncoding,
  readHBuilderXFileActivity,
  resolveSourceTimezone,
} = require("./hbuilderx-reader");

const NAME = "hbuilderx";
const VERSION = "0.1.0";
const WATERMARK_LOOKBACK_MS = 1000;
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;
const MAX_SCAN_RECORDS = 50_000;
const SAFE_FILE_TYPES = new Set([
  "code",
  "config",
  "document",
  "markup",
  "other",
  "style",
]);

function sha256Hex(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

function asRootList(value) {
  const roots = [];
  const visit = (entry, depth) => {
    if (Array.isArray(entry) && depth < 4) {
      for (const child of entry) visit(child, depth + 1);
      return;
    }
    if (typeof entry !== "string" || !entry.trim()) return;
    roots.push(entry.trim());
    if (roots.length > HARD_MAX_ROOTS) {
      const error = new Error(
        `${NAME}: root count must not exceed ${HARD_MAX_ROOTS}`,
      );
      error.code = "HBUILDERX_ROOT_LIMIT";
      throw error;
    }
  };
  visit(value, 0);
  return roots;
}

function rootInput(options = {}) {
  for (const key of [
    "hbuilderxHomes",
    "hbuilderxHome",
    "roots",
    "profilePath",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    const value = options[key];
    if (value == null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (typeof value !== "string" && !Array.isArray(value)) continue;
    return { provided: true, roots: asRootList(value) };
  }
  return { provided: false, roots: [] };
}

function scopeForRoots(roots, fsMod = fs, timezoneIdentity = "timezone:local") {
  const canonicalRoots = canonicalizeRoots(roots, fsMod);
  if (canonicalRoots.length === 0) return undefined;
  const identity = canonicalRoots
    .map((root) => {
      const normalized =
        process.platform === "win32" ? root.toLowerCase() : root;
      return Buffer.from(normalized, "utf8").toString("hex");
    })
    .sort()
    .join("\0");
  return createAccountScope(
    NAME,
    `roots:${identity}\0${String(timezoneIdentity)}`,
  );
}

function parsePositiveInteger(value, optionName) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${NAME}.sync: ${optionName} must be a positive integer`);
  }
  return numeric;
}

function parseSince(opts = {}) {
  const candidate = opts.since !== undefined ? opts.since : opts.sinceWatermark;
  if (candidate == null || candidate === "") return 0;
  const numeric = Number(candidate);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${NAME}.sync: since watermark must be unix milliseconds`);
  }
  return Math.floor(numeric);
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
  const candidates = [Math.min(pageBudget, MAX_SCAN_RECORDS)];
  if (opts.limit != null) {
    candidates.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    candidates.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...candidates);
}

function sanitizedReadError(error) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${NAME}.sync: unable to read the selected HBuilderX local metadata (${sourceCode})`,
  );
  wrapped.code = "HBUILDERX_READ_FAILED";
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

function emptyBatch() {
  return {
    events: [],
    persons: [],
    places: [],
    items: [],
    topics: [],
  };
}

class HBuilderXAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:hbuilderx-file-activity-ini",
      "sync:profile-directory",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = WATERMARK_LOOKBACK_MS;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.runtimeCredentialOption = "hbuilderxHomes";
    this.runtimeScopeIdentityKey = "hbuilderxHomes";
    this.dataDisclosure = {
      fields: [
        "file-activity:pathHash,extension,fileType,encoding,occurredAt,timestampSource",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: {
        fileActivity: true,
      },
      excludedFields: [
        "absolute filepath values and file basenames",
        "project and workspace names or paths",
        "language-index projectUri,lineText,context,value and source bodies",
        "Local History bodies and file snapshots",
        "diagnostic log lines and process information",
        "external-command command,name,workingDir,url and output",
        "terminal history and command output",
        "AI chat prompts,responses,tool calls and model credentials",
        "account identifiers,tokens,cookies,passwords,secrets and credentials",
        "raw INI section names and dynamic object keys",
        "lock files and JSON state unrelated to audited file activity",
      ],
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultHomes:
        typeof opts.defaultHBuilderXHomes === "function"
          ? opts.defaultHBuilderXHomes
          : defaultHBuilderXHomes,
    };
    const configured = rootInput(opts);
    this._rootOverride = configured.provided
      ? canonicalizeRoots(configured.roots, this._deps.fs)
      : null;
    this._timezoneDefaults = {
      sourceTimezone: opts.sourceTimezone,
      sourceTimezoneOffsetMinutes: opts.sourceTimezoneOffsetMinutes,
      sourceOffsetMinutes: opts.sourceOffsetMinutes,
    };
    try {
      this.defaultScope = this.resolveDefaultScope();
    } catch {
      this.defaultScope = undefined;
    }
  }

  _resolveRootSelection(opts = {}) {
    const runtime = rootInput(opts);
    if (runtime.provided) {
      return {
        roots: canonicalizeRoots(runtime.roots, this._deps.fs),
        optionalMissingRoots: false,
      };
    }
    if (this._rootOverride) {
      return {
        roots: [...this._rootOverride],
        optionalMissingRoots: false,
      };
    }
    return {
      roots: canonicalizeRoots(this._deps.defaultHomes(), this._deps.fs),
      optionalMissingRoots: true,
    };
  }

  _resolveRoots(opts = {}) {
    return this._resolveRootSelection(opts).roots;
  }

  _timezoneOptions(opts = {}) {
    return {
      sourceTimezone:
        opts.sourceTimezone !== undefined
          ? opts.sourceTimezone
          : this._timezoneDefaults.sourceTimezone,
      sourceTimezoneOffsetMinutes:
        opts.sourceTimezoneOffsetMinutes !== undefined
          ? opts.sourceTimezoneOffsetMinutes
          : this._timezoneDefaults.sourceTimezoneOffsetMinutes,
      sourceOffsetMinutes:
        opts.sourceOffsetMinutes !== undefined
          ? opts.sourceOffsetMinutes
          : this._timezoneDefaults.sourceOffsetMinutes,
    };
  }

  _resolvedTimezone(opts = {}) {
    return resolveSourceTimezone(this._timezoneOptions(opts));
  }

  resolveDefaultScope(opts = {}) {
    const timezone = this._resolvedTimezone(opts);
    const timezoneIdentity =
      timezone.kind === "offset"
        ? `timezone:offset:${timezone.offsetMinutes}`
        : `timezone:iana:${timezone.timeZone}`;
    return scopeForRoots(
      this._resolveRoots(opts),
      this._deps.fs,
      timezoneIdentity,
    );
  }

  async authenticate(ctx = {}) {
    const selection = this._resolveRootSelection(ctx);
    const roots = selection.roots;
    if (roots.length === 0) {
      return {
        ok: false,
        reason: "HBUILDERX_ROOT_UNRESOLVED",
        message: "HBuilderX local data directories could not be resolved",
      };
    }
    try {
      this._resolvedTimezone(ctx);
    } catch {
      return {
        ok: false,
        reason: "HBUILDERX_TIMEZONE_INVALID",
        message: "HBuilderX source timezone is invalid",
      };
    }

    let inspection;
    try {
      inspection = inspectHBuilderXLocalData(roots, {
        ...ctx,
        fs: this._deps.fs,
        optionalMissingRoots: selection.optionalMissingRoots,
      });
    } catch {
      return {
        ok: false,
        reason: "HBUILDERX_NOT_READABLE",
        message: "HBuilderX local metadata is not readable",
      };
    }
    if (inspection.hasFileActivity) {
      return {
        ok: true,
        mode: "file-import",
        rootCount: inspection.rootCount,
        activityFileCount: inspection.activityFileCount,
        hasFileActivity: true,
      };
    }
    if (inspection.readableRootCount === 0) {
      return {
        ok: false,
        reason: "HBUILDERX_NOT_READABLE",
        message: "HBuilderX local metadata is not readable",
      };
    }
    return {
      ok: false,
      reason: "HBUILDERX_FILE_ACTIVITY_NOT_FOUND",
      message: "No HBuilderX file activity metadata was found locally",
    };
  }

  async healthCheck(opts = {}) {
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
    if (opts.include?.fileActivity === false) return;
    const selection = this._resolveRootSelection(opts);
    const roots = selection.roots;
    const auth = await this.authenticate(opts);
    if (!auth.ok) {
      if (auth.reason === "HBUILDERX_TIMEZONE_INVALID") {
        const sourceError = new Error("invalid source timezone");
        sourceError.code = auth.reason;
        throw sanitizedReadError(sourceError);
      }
      const error = new Error(`${NAME}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const since = parseSince(opts);
    const limit = scanLimit(opts);
    const scope = this.resolveDefaultScope(opts);
    let result = { records: [], complete: true };
    if (opts.include?.fileActivity !== false) {
      try {
        result = readHBuilderXFileActivity(roots, {
          ...opts,
          ...this._timezoneOptions(opts),
          fs: this._deps.fs,
          optionalMissingRoots: selection.optionalMissingRoots,
          scope,
          since,
          maxRecords: Math.min(
            opts.maxRecords == null
              ? HARD_MAX_RECORDS
              : Number(opts.maxRecords),
            limit + 1,
          ),
        });
      } catch (error) {
        throw sanitizedReadError(error);
      }
    }

    if (result.records.length > limit) {
      result.records.length = limit;
      result.complete = false;
    }
    for (const record of result.records) {
      yield {
        kind: "hbuilderx-file-activity",
        originalId: `${NAME}-file-activity:${sha256Hex(
          `${scope}\0${record.payload.pathHash}\0${record.capturedAt}\0${record.recordId}`,
          48,
        )}`,
        capturedAt: record.capturedAt,
        scope,
        payload: record.payload,
      };
    }

    if (result.complete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (raw.kind !== "hbuilderx-file-activity") {
      throw new Error(`${NAME}.normalize: unsupported raw kind`);
    }
    const payload = raw.payload || {};
    const capturedAt =
      Number.isSafeInteger(raw.capturedAt) && raw.capturedAt > 0
        ? raw.capturedAt
        : Number.isSafeInteger(payload.occurredAt) && payload.occurredAt > 0
          ? payload.occurredAt
          : 0;
    if (capturedAt <= 0) {
      throw new Error(`${NAME}.normalize: invalid raw envelope`);
    }
    const originalId =
      typeof raw.originalId === "string" &&
      /^hbuilderx-file-activity:[a-f0-9]{48}$/u.test(raw.originalId)
        ? raw.originalId
        : `hbuilderx-file-activity:${sha256Hex(raw.originalId, 48)}`;
    const scope =
      typeof raw.scope === "string" &&
      /^account:hbuilderx:[a-f0-9]{32}$/u.test(raw.scope)
        ? raw.scope
        : null;
    const pathHash =
      typeof payload.pathHash === "string" &&
      /^[a-f0-9]{64}$/u.test(payload.pathHash)
        ? payload.pathHash
        : sha256Hex(`${originalId}\0path`);
    const extension =
      typeof payload.extension === "string" &&
      /^\.[a-z0-9][a-z0-9._+-]{0,30}$/u.test(payload.extension)
        ? payload.extension
        : null;
    const fileType = SAFE_FILE_TYPES.has(payload.fileType)
      ? payload.fileType
      : "other";
    const encoding = normalizeHBuilderXEncoding(payload.encoding);
    const ingestedAt = Date.now();
    const source = {
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt,
      capturedBy: CAPTURED_BY.EXPORT,
      originalId,
      ...(scope ? { scope } : {}),
    };
    const event = {
      id: `event-hbuilderx-file-activity-${sha256Hex(originalId, 32)}`,
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.OTHER,
      occurredAt:
        Number.isSafeInteger(payload.occurredAt) && payload.occurredAt > 0
          ? payload.occurredAt
          : capturedAt,
      ingestedAt,
      source,
      actor: "self",
      content: {
        title: "HBuilderX file activity",
        text: "",
      },
      extra: {
        kind: "hbuilderx-file-activity",
        editor: "hbuilderx",
        pathHash,
        extension,
        fileType,
        encoding,
        timestampSource: "hbuilderx-ini-local-datetime",
      },
    };
    return {
      ...emptyBatch(),
      events: [event],
    };
  }
}

module.exports = {
  HBuilderXAdapter,
  HBUILDERX_NAME: NAME,
  HBUILDERX_VERSION: VERSION,
  HBUILDERX_WATERMARK_LOOKBACK_MS: WATERMARK_LOOKBACK_MS,
  scopeForRoots,
};
