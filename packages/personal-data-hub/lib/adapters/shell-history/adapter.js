"use strict";

// Local shell history as a bounded, privacy-preserving event stream. Source
// paths are never archived: a canonical source is represented by SHA-256 and
// a fixed sourceName. Embedded shell timestamps win over file mtime.

const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");
const { createAccountScope } = require("../../account-scope");
const {
  DEFAULT_MAX_LINES,
  HARD_MAX_COMMAND_CHARS,
  HARD_MAX_FILE_BYTES,
  HARD_MAX_LINES,
  defaultHistorySources,
  describeHistorySource,
  entryHashFor,
  normalizeHistorySources,
  readAllHistory,
  safeShellName,
} = require("./shell-reader");

const NAME = "shell-history";
const VERSION = "0.2.0";
const DEFAULT_PAGE_SIZE = 2_500;
const MAX_PAGE_SIZE = 10_000;
const DEFAULT_MAX_PAGES = 20;

function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(String(value == null ? "" : value), "utf8")
    .digest("hex");
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(
      `${NAME}.sync: ${optionName} must be a positive integer`,
    );
    error.code = "SHELL_HISTORY_INVALID_OPTION";
    throw error;
  }
  return parsed;
}

function parseSince(opts = {}) {
  for (const value of [opts.sinceWatermark, opts.since]) {
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      const error = new Error(`${NAME}.sync: since must be unix milliseconds`);
      error.code = "SHELL_HISTORY_INVALID_OPTION";
      throw error;
    }
    return Math.floor(parsed);
  }
  return 0;
}

function parseScanBudget(opts = {}) {
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInteger(opts.pageSize, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) {
    const error = new Error(
      `${NAME}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`,
    );
    error.code = "SHELL_HISTORY_INVALID_OPTION";
    throw error;
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositiveInteger(opts.maxPages, "maxPages");
  const multiplied =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : pageSize * maxPages;
  const candidates = [multiplied];
  if (opts.limit != null) {
    candidates.push(parsePositiveInteger(opts.limit, "limit"));
  }
  if (opts.maxEvents != null) {
    candidates.push(parsePositiveInteger(opts.maxEvents, "maxEvents"));
  }
  return Math.min(...candidates);
}

function safeSourceName(value, shell) {
  const expected =
    shell === "pwsh"
      ? "powershell-history"
      : shell === "bash"
        ? "bash-history"
        : shell === "zsh"
          ? "zsh-history"
          : "shell-history";
  return value === expected ? value : expected;
}

function safeHash(value, fallback) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : sha256Hex(fallback);
}

function isSafeHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function safeOccurrence(value, fallback = 0) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : 0;
}

function asExplicitSource(source) {
  return source && typeof source === "object"
    ? { ...source, optional: false }
    : source;
}

function inspectSourcePresence(source, descriptor, fsMod) {
  if (!descriptor || !source || typeof source.file !== "string") {
    return "invalid";
  }
  let stat;
  try {
    stat = fsMod.statSync(source.file);
  } catch (error) {
    if (
      source.optional === true &&
      (error?.code === "ENOENT" || error?.code === "ENOTDIR")
    ) {
      return "optional-missing";
    }
    return "invalid";
  }
  if (typeof stat?.isFile === "function" && stat.isFile() !== true) {
    return "invalid";
  }
  if (typeof fsMod.accessSync === "function") {
    try {
      fsMod.accessSync(source.file, fsMod.constants?.R_OK ?? fs.constants.R_OK);
    } catch {
      return "invalid";
    }
  }
  return "readable";
}

function invalidNormalizeTimestamp() {
  const error = new Error(`${NAME}.normalize: invalid timestamp`);
  error.code = "SHELL_HISTORY_INVALID_TIMESTAMP";
  return error;
}

function isPositiveTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

class ShellHistoryAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:shell-history-files"];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 1_000;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.dataDisclosure = {
      fields: [
        "commands:shell,sourceName,sourceHash,value,contentHash,entryHash,occurrence,sourceIndex,capturedAt,timestampSource",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { commands: true },
      excludedFields: [
        "absolute history file paths",
        "environment variables and credentials outside command text",
        "shell profile and startup-script contents",
      ],
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultSources:
        typeof opts.defaultHistorySources === "function"
          ? opts.defaultHistorySources
          : defaultHistorySources,
      readHistory:
        typeof opts.readAllHistory === "function"
          ? opts.readAllHistory
          : readAllHistory,
      now: typeof opts.now === "function" ? opts.now : Date.now,
    };
    this._maxSources = opts.maxSources;
    this._sourcesOverride = Array.isArray(opts.sources)
      ? opts.sources.map(asExplicitSource)
      : null;
    this.defaultScope = this.resolveDefaultScope();
  }

  _resolveSources(opts = {}) {
    let sources;
    if (Array.isArray(opts.sources)) {
      sources = opts.sources.map(asExplicitSource);
    } else if (this._sourcesOverride) {
      sources = [...this._sourcesOverride];
    } else {
      const defaults = this._deps.defaultSources();
      sources = Array.isArray(defaults) ? [...defaults] : [];
    }
    return normalizeHistorySources(sources, {
      fs: this._deps.fs,
      maxSources: opts.maxSources == null ? this._maxSources : opts.maxSources,
    });
  }

  _describeSources(sources) {
    return sources.map((source) =>
      describeHistorySource(source, { fs: this._deps.fs }),
    );
  }

  resolveDefaultScope(opts = {}) {
    const descriptors = this._describeSources(this._resolveSources(opts));
    if (descriptors.length === 0 || descriptors.some((entry) => !entry)) {
      return undefined;
    }
    const identity = descriptors
      .map((entry) => `${entry.shell}:${entry.sourceHash}`)
      .sort()
      .join("\0");
    return createAccountScope(NAME, `sources:${identity}`);
  }

  async authenticate(ctx = {}) {
    const sources = this._resolveSources(ctx);
    if (sources.length === 0) {
      return {
        ok: false,
        reason: "NO_HISTORY_SOURCES",
        message: "No shell history sources were configured",
      };
    }
    const descriptors = this._describeSources(sources);
    if (descriptors.some((entry) => !entry)) {
      return {
        ok: false,
        reason: "INVALID_HISTORY_SOURCE",
        message: "A shell history source is invalid",
      };
    }
    const readableDescriptors = [];
    for (let index = 0; index < sources.length; index += 1) {
      const presence = inspectSourcePresence(
        sources[index],
        descriptors[index],
        this._deps.fs,
      );
      if (presence === "invalid") {
        return {
          ok: false,
          reason: "INVALID_HISTORY_SOURCE",
          message: "A shell history source is missing or not readable",
        };
      }
      if (presence === "readable") {
        readableDescriptors.push(descriptors[index]);
      }
    }
    if (readableDescriptors.length === 0) {
      return {
        ok: false,
        reason: "NO_HISTORY_SOURCES",
        message: "No local shell history files were found",
      };
    }
    return {
      ok: true,
      mode: "file-import",
      sourceCount: readableDescriptors.length,
      sources: readableDescriptors,
    };
  }

  async healthCheck(ctx = {}) {
    const auth = await this.authenticate(ctx);
    return auth.ok
      ? { ok: true, lastChecked: Date.now() }
      : {
          ok: false,
          reason: auth.reason,
          error: auth.message,
          lastChecked: Date.now(),
        };
  }

  async *sync(opts = {}) {
    if (opts.include?.commands === false) return;
    const sources = this._resolveSources(opts);
    if (sources.length === 0) {
      const error = new Error(`${NAME}.sync: no history sources configured`);
      error.code = "NO_HISTORY_SOURCES";
      throw error;
    }
    if (this._describeSources(sources).some((entry) => !entry)) {
      const error = new Error(`${NAME}.sync: invalid history source`);
      error.code = "INVALID_HISTORY_SOURCE";
      throw error;
    }

    const since = parseSince(opts);
    const pageBudget = parseScanBudget(opts);
    const maxLines =
      opts.maxLines == null
        ? Math.min(HARD_MAX_LINES, Math.max(DEFAULT_MAX_LINES, pageBudget))
        : opts.maxLines;
    let iterator;
    try {
      iterator = this._deps.readHistory(sources, {
        fs: this._deps.fs,
        since,
        maxRecords: pageBudget,
        maxFileBytes:
          opts.maxFileBytes == null ? HARD_MAX_FILE_BYTES : opts.maxFileBytes,
        maxLines,
        maxCommandChars:
          opts.maxCommandChars == null
            ? HARD_MAX_COMMAND_CHARS
            : opts.maxCommandChars,
        maxSources:
          opts.maxSources == null ? this._maxSources : opts.maxSources,
        now: this._deps.now,
      });
    } catch {
      const error = new Error(`${NAME}.sync: history source read failed`);
      error.code = "SHELL_HISTORY_READ_FAILED";
      throw error;
    }
    if (!iterator || typeof iterator.next !== "function") {
      const error = new Error(`${NAME}.sync: history reader failed`);
      error.code = "SHELL_HISTORY_READ_FAILED";
      throw error;
    }

    let summary = { complete: false };
    let recordsComplete = true;
    let finishedNaturally = false;
    try {
      while (true) {
        let step;
        try {
          step = iterator.next();
        } catch {
          const error = new Error(`${NAME}.sync: history source read failed`);
          error.code = "SHELL_HISTORY_READ_FAILED";
          throw error;
        }
        if (step.done) {
          summary =
            step.value && typeof step.value === "object"
              ? step.value
              : { complete: false };
          finishedNaturally = true;
          break;
        }
        const row = step.value || {};
        const shell = safeShellName(row.shell);
        const capturedAt =
          Number.isSafeInteger(row.capturedAt) && row.capturedAt > 0
            ? row.capturedAt
            : Number.isSafeInteger(row.snapshotTs) && row.snapshotTs > 0
              ? row.snapshotTs
              : 0;
        if (!shell || capturedAt <= 0 || typeof row.value !== "string") {
          recordsComplete = false;
          continue;
        }
        if (
          !isSafeHash(row.sourceHash) ||
          !isSafeHash(row.contentHash) ||
          !isSafeHash(row.entryHash) ||
          !Number.isSafeInteger(row.occurrence) ||
          row.occurrence < 0
        ) {
          recordsComplete = false;
        }
        const sourceHash = safeHash(row.sourceHash, `${shell}\0unknown-source`);
        const contentHash = safeHash(row.contentHash, row.value);
        const timestampSource =
          row.timestampSource === "zsh-extended-history" ||
          row.timestampSource === "bash-epoch"
            ? row.timestampSource
            : "file-mtime";
        const entryHash = entryHashFor(
          contentHash,
          capturedAt,
          timestampSource,
        );
        if (row.entryHash !== entryHash) recordsComplete = false;
        const occurrence = safeOccurrence(row.occurrence);
        yield {
          kind: "shell-command",
          originalId: `shell-cmd:${sourceHash}:${entryHash}:${occurrence}`,
          capturedAt,
          payload: {
            shell,
            sourceName: safeSourceName(row.sourceName, shell),
            sourceHash,
            value: row.value,
            contentHash,
            entryHash,
            occurrence,
            capturedAt,
            sourceIndex: Number.isSafeInteger(row.sourceIndex)
              ? row.sourceIndex
              : null,
            snapshotTs: Number.isSafeInteger(row.snapshotTs)
              ? row.snapshotTs
              : capturedAt,
            timestampSource,
          },
        };
      }
    } finally {
      if (!finishedNaturally && typeof iterator.return === "function") {
        try {
          await iterator.return();
        } catch {
          // Best-effort cleanup must not replace a sanitized read error or a
          // consumer-requested early return.
        }
      }
    }

    if (
      summary.complete &&
      recordsComplete &&
      typeof opts.markWatermarkComplete === "function"
    ) {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    if (!raw || typeof raw !== "object" || raw.kind !== "shell-command") {
      throw new Error(`${NAME}.normalize: unsupported raw record kind`);
    }
    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const shell = safeShellName(payload.shell);
    if (!shell) {
      const error = new Error(`${NAME}.normalize: invalid shell`);
      error.code = "INVALID_HISTORY_SOURCE";
      throw error;
    }
    if (!isPositiveTimestamp(raw.capturedAt)) {
      throw invalidNormalizeTimestamp();
    }
    for (const key of ["capturedAt", "snapshotTs"]) {
      if (
        Object.prototype.hasOwnProperty.call(payload, key) &&
        !isPositiveTimestamp(payload[key])
      ) {
        throw invalidNormalizeTimestamp();
      }
    }
    const command = typeof payload.value === "string" ? payload.value : "";
    const sourceName = safeSourceName(payload.sourceName, shell);
    const sourceHash = safeHash(
      payload.sourceHash,
      `${shell}\0${sourceName}\0${payload.file || ""}`,
    );
    const contentHash = safeHash(payload.contentHash, command);
    const occurrence = safeOccurrence(payload.occurrence, payload.sourceIndex);
    const hasEmbeddedTimestamp =
      payload.timestampSource === "zsh-extended-history" ||
      payload.timestampSource === "bash-epoch";
    const occurredAt = hasEmbeddedTimestamp
      ? Number.isSafeInteger(payload.capturedAt) && payload.capturedAt > 0
        ? payload.capturedAt
        : raw.capturedAt
      : raw.capturedAt;
    if (!isPositiveTimestamp(occurredAt)) {
      throw invalidNormalizeTimestamp();
    }
    const timestampSource = hasEmbeddedTimestamp
      ? payload.timestampSource
      : "file-mtime";
    const entryHash = entryHashFor(contentHash, occurredAt, timestampSource);
    const originalId = `shell-cmd:${sourceHash}:${entryHash}:${occurrence}`;
    const titleText = `[${shell}] ${command}`;
    const title =
      titleText.length > 100 ? `${titleText.substring(0, 100)}…` : titleText;
    const event = {
      id: `event-shell-cmd-${sourceHash.slice(0, 16)}-${entryHash.slice(0, 24)}-${occurrence}`,
      type: ENTITY_TYPES.EVENT,
      subtype: EVENT_SUBTYPES.OTHER,
      occurredAt,
      ingestedAt,
      source: {
        adapter: NAME,
        adapterVersion: VERSION,
        capturedAt: raw.capturedAt,
        capturedBy: CAPTURED_BY.EXPORT,
        originalId,
      },
      actor: "self",
      content: {
        title,
        text: command,
      },
      extra: {
        kind: "shell-command",
        shell,
        sourceName,
        sourceHash,
        contentHash,
        entryHash,
        occurrence,
        sourceIndex: Number.isSafeInteger(payload.sourceIndex)
          ? payload.sourceIndex
          : null,
        timestampSource,
        ...(hasEmbeddedTimestamp
          ? {}
          : { temporalSemantics: "first-observed-snapshot" }),
      },
    };
    return { events: [event], persons: [], places: [], items: [], topics: [] };
  }
}

module.exports = {
  ShellHistoryAdapter,
  SHELL_HISTORY_NAME: NAME,
  SHELL_HISTORY_VERSION: VERSION,
};
