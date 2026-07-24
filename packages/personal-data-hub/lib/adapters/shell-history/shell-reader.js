"use strict";

// Bounded, privacy-preserving readers for PowerShell, bash, and zsh history.
// Absolute source paths are used only while opening a file. Public reader
// results identify a canonical source with a SHA-256 digest and a fixed,
// non-user-controlled source name.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { TextDecoder } = require("node:util");

const SOURCE_HASH_NAMESPACE = "shell-history";
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_LINES = 200_000;
const HARD_MAX_LINES = 1_000_000;
const DEFAULT_MAX_COMMAND_CHARS = 65_536;
const HARD_MAX_COMMAND_CHARS = 262_144;
const DEFAULT_MAX_SOURCES = 16;
const HARD_MAX_SOURCES = 128;
const MIN_EMBEDDED_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 24 * 60 * 60 * 1000;

function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(String(value == null ? "" : value), "utf8")
    .digest("hex");
}

function safeShellName(value) {
  const normalized = String(value == null ? "" : value)
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (normalized === "powershell" || normalized === "pwsh") return "pwsh";
  if (normalized === "bash") return "bash";
  if (normalized === "zsh") return "zsh";
  return null;
}

function safeSourceName(shell) {
  if (shell === "pwsh") return "powershell-history";
  if (shell === "bash") return "bash-history";
  if (shell === "zsh") return "zsh-history";
  return "shell-history";
}

function canonicalSourceIdentity(source, fsMod = fs) {
  if (
    !source ||
    typeof source !== "object" ||
    typeof source.file !== "string" ||
    source.file.trim().length === 0
  ) {
    return null;
  }
  const shell = safeShellName(source.shell);
  if (!shell) return null;
  let canonical = path.resolve(source.file.trim());
  try {
    canonical =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(canonical)
        : fsMod.realpathSync(canonical);
    canonical = path.resolve(canonical);
  } catch {
    // A default history file is commonly absent. Its resolved path remains a
    // stable source identity without exposing it outside this module.
  }
  if (process.platform === "win32") canonical = canonical.toLowerCase();
  return `${shell}\0${canonical}`;
}

function describeHistorySource(source, opts = {}) {
  const fsMod = opts.fs || fs;
  const identity = canonicalSourceIdentity(source, fsMod);
  if (!identity) return null;
  const shell = safeShellName(source.shell);
  if (!shell) return null;
  return {
    shell,
    sourceName: safeSourceName(shell),
    sourceHash: sha256Hex(`${SOURCE_HASH_NAMESPACE}\0${identity}`),
  };
}

function defaultHistorySources() {
  const home = os.homedir();
  const sources = [];
  if (process.platform === "win32") {
    const appData =
      typeof process.env.APPDATA === "string" && process.env.APPDATA
        ? process.env.APPDATA
        : path.join(home, "AppData", "Roaming");
    sources.push({
      shell: "pwsh",
      file: path.join(
        appData,
        "Microsoft",
        "Windows",
        "PowerShell",
        "PSReadLine",
        "ConsoleHost_history.txt",
      ),
      optional: true,
    });
  } else {
    const dataHome =
      typeof process.env.XDG_DATA_HOME === "string" && process.env.XDG_DATA_HOME
        ? process.env.XDG_DATA_HOME
        : path.join(home, ".local", "share");
    sources.push({
      shell: "pwsh",
      file: path.join(
        dataHome,
        "powershell",
        "PSReadLine",
        "ConsoleHost_history.txt",
      ),
      optional: true,
    });
  }
  sources.push({
    shell: "bash",
    file: path.join(home, ".bash_history"),
    optional: true,
  });
  if (process.platform !== "win32") {
    sources.push({
      shell: "zsh",
      file: path.join(home, ".zsh_history"),
      optional: true,
    });
  }
  return sources;
}

function boundedPositiveInteger(value, fallback, hardMax, optionName) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > hardMax) {
    const error = new Error(
      `shell-history: ${optionName} must be a positive integer not exceeding ${hardMax}`,
    );
    error.code = "SHELL_HISTORY_INVALID_LIMIT";
    throw error;
  }
  return parsed;
}

function normalizeHistorySources(sources, opts = {}) {
  const list = Array.isArray(sources) ? sources : [];
  const maxSources = boundedPositiveInteger(
    opts.maxSources,
    DEFAULT_MAX_SOURCES,
    HARD_MAX_SOURCES,
    "maxSources",
  );
  if (list.length > HARD_MAX_SOURCES) {
    const error = new Error(
      `shell-history: source count must not exceed ${HARD_MAX_SOURCES}`,
    );
    error.code = "SHELL_HISTORY_SOURCE_LIMIT";
    throw error;
  }

  const unique = [];
  const seen = new Set();
  for (const source of list) {
    const descriptor = describeHistorySource(source, { fs: opts.fs || fs });
    if (!descriptor) {
      unique.push(source);
      continue;
    }
    const identity = `${descriptor.shell}\0${descriptor.sourceHash}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(source);
  }
  if (unique.length > maxSources) {
    const error = new Error(
      `shell-history: source count must not exceed ${maxSources}`,
    );
    error.code = "SHELL_HISTORY_SOURCE_LIMIT";
    throw error;
  }
  return unique;
}

function emptyResult(descriptor, complete, issue) {
  return {
    ...descriptor,
    mtimeMs: 0,
    rows: [],
    complete,
    issues: issue ? [issue] : [],
  };
}

function safeStat(fsMod, file) {
  try {
    return fsMod.statSync(file);
  } catch {
    return null;
  }
}

function statChanged(before, after) {
  if (!before || !after) return true;
  return (
    Number(before.size) !== Number(after.size) ||
    Number(before.mtimeMs) !== Number(after.mtimeMs) ||
    Number(before.ctimeMs) !== Number(after.ctimeMs) ||
    (before.ino != null &&
      after.ino != null &&
      String(before.ino) !== String(after.ino))
  );
}

function readBoundedFile(fsMod, file, expectedStat, maxFileBytes) {
  const expectedSize = Number(expectedStat?.size);
  if (
    typeof fsMod.openSync === "function" &&
    typeof fsMod.readSync === "function" &&
    typeof fsMod.closeSync === "function"
  ) {
    const allocation = Math.min(
      maxFileBytes + 1,
      Math.max(1, expectedSize + 1),
    );
    const buffer = Buffer.allocUnsafe(allocation);
    let descriptor;
    let offset = 0;
    let descriptorStable = false;
    let closeFailed = false;
    try {
      descriptor = fsMod.openSync(file, "r");
      if (typeof fsMod.fstatSync === "function") {
        const descriptorBefore = fsMod.fstatSync(descriptor);
        if (!statChanged(expectedStat, descriptorBefore)) {
          while (offset < buffer.length) {
            const bytesRead = fsMod.readSync(
              descriptor,
              buffer,
              offset,
              buffer.length - offset,
              offset,
            );
            if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0) break;
            offset += bytesRead;
          }
          const descriptorAfter = fsMod.fstatSync(descriptor);
          descriptorStable = !statChanged(descriptorBefore, descriptorAfter);
        }
      }
    } finally {
      if (descriptor !== undefined) {
        try {
          fsMod.closeSync(descriptor);
        } catch {
          closeFailed = true;
        }
      }
    }
    return {
      buffer: buffer.subarray(0, offset),
      exceeded: offset > maxFileBytes,
      descriptorStable,
      closeFailed,
    };
  }

  const raw = fsMod.readFileSync(file);
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return {
    buffer,
    exceeded: buffer.length > maxFileBytes,
    descriptorStable: false,
    closeFailed: false,
  };
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function resolveNowMs(value) {
  let candidate;
  try {
    candidate = typeof value === "function" ? value() : value;
  } catch {
    candidate = undefined;
  }
  return Number.isSafeInteger(candidate) && candidate > 0
    ? candidate
    : Date.now();
}

function parseEpochSeconds(value, nowMs) {
  if (!/^[0-9]{9,12}$/u.test(value)) return null;
  const seconds = Number(value);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds > Math.floor(Number.MAX_SAFE_INTEGER / 1000)
  ) {
    return null;
  }
  const timestamp = seconds * 1000;
  if (
    timestamp < MIN_EMBEDDED_TIMESTAMP_MS ||
    timestamp > nowMs + MAX_FUTURE_TIMESTAMP_SKEW_MS
  ) {
    return null;
  }
  return timestamp;
}

function entryHashFor(contentHash, capturedAt, timestampSource) {
  if (
    timestampSource === "bash-epoch" ||
    timestampSource === "zsh-extended-history"
  ) {
    return sha256Hex(`${timestampSource}\0${capturedAt}\0${contentHash}`);
  }
  return contentHash;
}

function hasInvalidControl(value) {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return (
      (point >= 0 && point <= 8) ||
      point === 11 ||
      point === 12 ||
      (point >= 14 && point <= 31) ||
      point === 127
    );
  });
}

function hasOddTrailingCharacter(value, character) {
  let count = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== character) break;
    count += 1;
  }
  return count % 2 === 1;
}

function physicalEntry(value, sourceIndex, capturedAt) {
  return {
    value,
    sourceIndex,
    capturedAt,
    timestampSource: "file-mtime",
  };
}

function parseBashEntries(lines, mtimeMs, nowMs, truncated) {
  const entries = [];
  const issues = [];
  let pending = null;

  const flushPending = (wasTruncated = false) => {
    if (!pending) return;
    if (wasTruncated) {
      issues.push("BASH_RECORD_TRUNCATED");
    } else {
      const value = pending.lines.join("\n");
      if (value.trim()) {
        entries.push({
          value,
          sourceIndex: pending.sourceIndex,
          capturedAt: pending.capturedAt,
          timestampSource: "bash-epoch",
        });
      } else {
        issues.push("BASH_TIMESTAMP_ORPHANED");
      }
    }
    pending = null;
  };

  for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
    const value = lines[sourceIndex];
    const marker = value.match(/^\s*#([0-9]+)\s*$/u);
    if (marker) {
      flushPending();
      const parsed = parseEpochSeconds(marker[1], nowMs);
      if (parsed == null) {
        issues.push("BASH_TIMESTAMP_INVALID");
      } else {
        pending = {
          lines: [],
          sourceIndex: sourceIndex + 1,
          capturedAt: parsed,
        };
      }
      continue;
    }
    if (pending) {
      pending.lines.push(value);
    } else {
      entries.push(physicalEntry(value, sourceIndex, mtimeMs));
    }
  }
  flushPending(truncated);
  return { entries, issues };
}

function parseZshEntries(lines, mtimeMs, nowMs, truncated) {
  const entries = [];
  const issues = [];
  let pending = null;

  const flushPending = (wasTruncated = false) => {
    if (!pending) return;
    if (wasTruncated) {
      issues.push("ZSH_RECORD_TRUNCATED");
    } else {
      entries.push({
        value: pending.lines.join("\n"),
        sourceIndex: pending.sourceIndex,
        capturedAt: pending.capturedAt,
        timestampSource: "zsh-extended-history",
      });
    }
    pending = null;
  };

  for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
    const value = lines[sourceIndex];
    const extended = value.match(/^: ([0-9]{1,12}):([0-9]+);(.*)$/u);
    if (extended) {
      flushPending();
      const parsed = parseEpochSeconds(extended[1], nowMs);
      if (parsed == null) {
        issues.push("ZSH_TIMESTAMP_INVALID");
      } else {
        pending = {
          lines: [extended[3]],
          sourceIndex,
          capturedAt: parsed,
        };
      }
      continue;
    }
    if (/^: [0-9]/u.test(value)) {
      flushPending();
      issues.push("ZSH_RECORD_MALFORMED");
      continue;
    }
    if (pending) {
      pending.lines.push(value);
    } else {
      entries.push(physicalEntry(value, sourceIndex, mtimeMs));
    }
  }
  flushPending(truncated);
  return { entries, issues };
}

function parsePowerShellEntries(lines, mtimeMs, truncated) {
  const entries = [];
  const issues = [];
  let pending = [];
  let pendingIndex = 0;

  for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
    const value = lines[sourceIndex];
    if (pending.length === 0) pendingIndex = sourceIndex;
    pending.push(value);
    if (!hasOddTrailingCharacter(value, "`")) {
      entries.push(physicalEntry(pending.join("\n"), pendingIndex, mtimeMs));
      pending = [];
    }
  }
  if (pending.length > 0) {
    issues.push(
      truncated
        ? "POWERSHELL_RECORD_TRUNCATED"
        : "POWERSHELL_CONTINUATION_ORPHANED",
    );
  }
  return { entries, issues };
}

function parseLogicalEntries(lines, shell, mtimeMs, nowMs, truncated) {
  if (shell === "bash") {
    return parseBashEntries(lines, mtimeMs, nowMs, truncated);
  }
  if (shell === "zsh") {
    return parseZshEntries(lines, mtimeMs, nowMs, truncated);
  }
  return parsePowerShellEntries(lines, mtimeMs, truncated);
}

// Reads one source into a stable in-memory snapshot. Missing default files are
// an empty complete source. Read errors, concurrent mutation, invalid UTF-8,
// and every configured truncation are incomplete so callers cannot advance a
// complete-scan watermark.
function readHistoryFile(source, opts = {}) {
  const fsMod = opts.fs || fs;
  const descriptor = describeHistorySource(source, { fs: fsMod });
  if (!descriptor) {
    return emptyResult(
      {
        shell: null,
        sourceName: "invalid-history-source",
        sourceHash: sha256Hex(`${SOURCE_HASH_NAMESPACE}\0invalid-source`),
      },
      false,
      "INVALID_SOURCE",
    );
  }

  const maxFileBytes = boundedPositiveInteger(
    opts.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    HARD_MAX_FILE_BYTES,
    "maxFileBytes",
  );
  const maxLines = boundedPositiveInteger(
    opts.maxLines,
    DEFAULT_MAX_LINES,
    HARD_MAX_LINES,
    "maxLines",
  );
  const maxCommandChars = boundedPositiveInteger(
    opts.maxCommandChars,
    DEFAULT_MAX_COMMAND_CHARS,
    HARD_MAX_COMMAND_CHARS,
    "maxCommandChars",
  );
  const nowMs = resolveNowMs(opts.now);

  let statBefore;
  try {
    statBefore = fsMod.statSync(source.file);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return source.optional === true
        ? null
        : emptyResult(descriptor, false, "SOURCE_MISSING");
    }
    return emptyResult(descriptor, false, "SOURCE_STAT_FAILED");
  }
  if (typeof statBefore.isFile === "function" && statBefore.isFile() !== true) {
    return emptyResult(descriptor, false, "SOURCE_NOT_FILE");
  }
  if (
    !Number.isSafeInteger(Number(statBefore.size)) ||
    Number(statBefore.size) < 0 ||
    Number(statBefore.size) > maxFileBytes
  ) {
    return emptyResult(descriptor, false, "SOURCE_SIZE_LIMIT");
  }

  let readResult;
  try {
    readResult = readBoundedFile(fsMod, source.file, statBefore, maxFileBytes);
  } catch {
    return emptyResult(descriptor, false, "SOURCE_READ_FAILED");
  }
  if (readResult.exceeded) {
    return emptyResult(descriptor, false, "SOURCE_SIZE_LIMIT");
  }
  if (readResult.closeFailed) {
    return emptyResult(descriptor, false, "SOURCE_CLOSE_FAILED");
  }
  if (!readResult.descriptorStable) {
    return emptyResult(descriptor, false, "SOURCE_DESCRIPTOR_UNSTABLE");
  }

  const statAfter = safeStat(fsMod, source.file);
  if (statChanged(statBefore, statAfter)) {
    return emptyResult(descriptor, false, "SOURCE_CHANGED_DURING_READ");
  }
  if (readResult.buffer.length !== Number(statBefore.size)) {
    return emptyResult(descriptor, false, "SOURCE_SHORT_READ");
  }
  const text = decodeUtf8(readResult.buffer);
  if (text == null) {
    return emptyResult(descriptor, false, "SOURCE_INVALID_UTF8");
  }

  const mtimeMs = Math.floor(Number(statBefore.mtimeMs));
  if (!Number.isSafeInteger(mtimeMs) || mtimeMs <= 0) {
    return emptyResult(descriptor, false, "SOURCE_INVALID_MTIME");
  }

  let complete = true;
  const issues = [];
  let lines = text.split(/\r\n|\n|\r/u);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const lineLimitReached = lines.length > maxLines;
  if (lineLimitReached) {
    lines = lines.slice(0, maxLines);
    complete = false;
    issues.push("SOURCE_LINE_LIMIT");
  }

  const rows = [];
  const occurrences = new Map();
  const logical = parseLogicalEntries(
    lines,
    descriptor.shell,
    mtimeMs,
    nowMs,
    lineLimitReached,
  );
  if (logical.issues.length > 0) {
    complete = false;
    issues.push(...logical.issues);
  }
  for (const entry of logical.entries) {
    const value = entry.value.replace(/[\r\n]+$/u, "").trim();
    if (!value) continue;
    if (hasInvalidControl(value)) {
      complete = false;
      issues.push("COMMAND_INVALID_CONTROL");
      continue;
    }
    if (value.length > maxCommandChars) {
      complete = false;
      issues.push("COMMAND_LENGTH_LIMIT");
      continue;
    }

    const contentHash = sha256Hex(value);
    const entryHash = entryHashFor(
      contentHash,
      entry.capturedAt,
      entry.timestampSource,
    );
    const occurrence = occurrences.get(entryHash) || 0;
    occurrences.set(entryHash, occurrence + 1);
    rows.push({
      ...descriptor,
      value,
      contentHash,
      entryHash,
      occurrence,
      sourceIndex: entry.sourceIndex,
      capturedAt: entry.capturedAt,
      snapshotTs: mtimeMs,
      timestampSource: entry.timestampSource,
    });
  }

  return {
    ...descriptor,
    mtimeMs,
    rows,
    complete,
    issues: [...new Set(issues)],
  };
}

// Yields records across configured sources. The generator return value is a
// completion summary consumed by the adapter; ordinary for-of callers remain
// backward compatible and can ignore it.
function* readAllHistory(sources, opts = {}) {
  const sinceMs =
    Number.isSafeInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const maxRecords =
    Number.isSafeInteger(opts.maxRecords) && opts.maxRecords > 0
      ? opts.maxRecords
      : Number.MAX_SAFE_INTEGER;
  let complete = true;
  let emitted = 0;
  let sourceCount = 0;
  const normalizedSources = normalizeHistorySources(sources, opts);

  for (const source of normalizedSources) {
    const descriptor = describeHistorySource(source, { fs: opts.fs || fs });
    if (!descriptor) {
      complete = false;
      continue;
    }
    sourceCount += 1;
    const parsed = readHistoryFile(source, opts);
    if (!parsed) continue;
    if (!parsed.complete) complete = false;
    for (const row of parsed.rows) {
      if (row.capturedAt < sinceMs) continue;
      if (emitted >= maxRecords) {
        return {
          complete: false,
          reason: "PAGE_BUDGET_EXHAUSTED",
          emitted,
          sourceCount,
        };
      }
      yield row;
      emitted += 1;
    }
  }

  return { complete, emitted, sourceCount };
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  HARD_MAX_FILE_BYTES,
  DEFAULT_MAX_LINES,
  HARD_MAX_LINES,
  DEFAULT_MAX_COMMAND_CHARS,
  HARD_MAX_COMMAND_CHARS,
  DEFAULT_MAX_SOURCES,
  HARD_MAX_SOURCES,
  MIN_EMBEDDED_TIMESTAMP_MS,
  MAX_FUTURE_TIMESTAMP_SKEW_MS,
  defaultHistorySources,
  describeHistorySource,
  normalizeHistorySources,
  readHistoryFile,
  readAllHistory,
  entryHashFor,
  safeShellName,
};
