"use strict";

// HBuilderX persists a small, section-oriented INI snapshot containing
// filepath/datetime/encoding metadata. This reader deliberately inspects only
// direct-child .ini files and only emits those three audited fields after the
// filepath has been reduced to a scope-bound digest. It never opens HBuilderX
// language indexes, logs, JSON state, external-command definitions, Local
// History bodies, project files, or credential stores.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const NAME = "hbuilderx";
const WINDOWS_DATA_DIRECTORY = "HBuilder X";
const DEFAULT_MAX_ROOTS = 16;
const HARD_MAX_ROOTS = 128;
const HARD_MAX_FILES = 5_000;
const DEFAULT_MAX_FILES = HARD_MAX_FILES;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const HARD_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_SECTIONS = 50_000;
const HARD_MAX_SECTIONS = 100_000;
const DEFAULT_MAX_LINE_CHARS = 16 * 1024;
const HARD_MAX_LINE_CHARS = 64 * 1024;
const DEFAULT_MAX_RECORDS = 50_000;
const HARD_MAX_RECORDS = 100_000;

const REQUIRED_ACTIVITY_FIELDS = Object.freeze([
  "filepath",
  "datetime",
  "encoding",
]);

const FILE_TYPE_BY_EXTENSION = Object.freeze({
  ".css": "style",
  ".htm": "markup",
  ".html": "markup",
  ".java": "code",
  ".js": "code",
  ".json": "config",
  ".json5": "config",
  ".jsx": "code",
  ".less": "style",
  ".md": "document",
  ".nvue": "code",
  ".scss": "style",
  ".ts": "code",
  ".tsx": "code",
  ".uts": "code",
  ".uvue": "code",
  ".vue": "code",
  ".xml": "config",
  ".yaml": "config",
  ".yml": "config",
});

function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function positiveInteger(value, fallback, optionName, hardMax) {
  if (value == null) return fallback;
  const numeric = Number(value);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0 ||
    (Number.isSafeInteger(hardMax) && numeric > hardMax)
  ) {
    const error = new Error(
      `${NAME}: ${optionName} must be a positive integer${
        Number.isSafeInteger(hardMax) ? ` not exceeding ${hardMax}` : ""
      }`,
    );
    error.code = "HBUILDERX_LIMIT_INVALID";
    throw error;
  }
  return numeric;
}

function defaultHBuilderXHomes(env = process.env, platform = process.platform) {
  if (platform !== "win32") return [];
  const homes = [];
  for (const root of [env?.APPDATA, env?.LOCALAPPDATA]) {
    if (typeof root === "string" && root.trim()) {
      homes.push(path.resolve(root.trim(), WINDOWS_DATA_DIRECTORY));
    }
  }
  return homes;
}

function canonicalHBuilderXRoot(value, fsMod = fs) {
  if (typeof value !== "string" || !value.trim()) return null;
  const resolved = path.resolve(value.trim());
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(resolved)
        : typeof fsMod.realpathSync === "function"
          ? fsMod.realpathSync(resolved)
          : resolved;
    return path.resolve(realpath);
  } catch {
    return resolved;
  }
}

function boundedRootValues(values) {
  const result = [];
  const visit = (value, depth) => {
    if (Array.isArray(value) && depth < 4) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "string" || !value.trim()) return;
    result.push(value);
    if (result.length > HARD_MAX_ROOTS) {
      const error = new Error(
        `${NAME}: root count must not exceed ${HARD_MAX_ROOTS}`,
      );
      error.code = "HBUILDERX_ROOT_LIMIT";
      throw error;
    }
  };
  visit(values, 0);
  return result;
}

function canonicalizeRoots(values, fsMod = fs) {
  const unique = new Map();
  for (const value of boundedRootValues(values)) {
    const canonical = canonicalHBuilderXRoot(value, fsMod);
    if (!canonical) continue;
    const identity =
      process.platform === "win32" ? canonical.toLowerCase() : canonical;
    if (!unique.has(identity)) unique.set(identity, canonical);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, canonical]) => canonical);
}

function readBoundedDirectory(fsMod, root, maxEntries) {
  if (typeof fsMod.opendirSync === "function") {
    let directory;
    const entries = [];
    let complete = true;
    try {
      directory = fsMod.opendirSync(root);
      while (entries.length < maxEntries) {
        const entry = directory.readSync();
        if (!entry) break;
        entries.push(entry);
      }
      if (entries.length === maxEntries && directory.readSync()) {
        complete = false;
      }
    } finally {
      if (directory) {
        try {
          directory.closeSync();
        } catch {
          complete = false;
        }
      }
    }
    return { entries, complete };
  }

  const entries = fsMod.readdirSync(root, { withFileTypes: true });
  return {
    entries: entries.slice(0, maxEntries),
    complete: entries.length <= maxEntries,
  };
}

function isDirectIniEntry(entry) {
  return (
    entry &&
    typeof entry.name === "string" &&
    entry.name.toLowerCase().endsWith(".ini") &&
    typeof entry.isFile === "function" &&
    entry.isFile()
  );
}

function discoverHBuilderXIniFiles(roots, opts = {}) {
  const fsMod = opts.fs || fs;
  const maxRoots = positiveInteger(
    opts.maxRoots,
    DEFAULT_MAX_ROOTS,
    "maxRoots",
    HARD_MAX_ROOTS,
  );
  const maxFiles = positiveInteger(
    opts.maxFiles,
    DEFAULT_MAX_FILES,
    "maxFiles",
    HARD_MAX_FILES,
  );
  const canonicalRoots = canonicalizeRoots(roots, fsMod);
  let complete = true;
  let selectedRoots = canonicalRoots;
  if (selectedRoots.length > maxRoots) {
    selectedRoots = selectedRoots.slice(0, maxRoots);
    complete = false;
  }

  const files = [];
  let readableRootCount = 0;
  for (const root of selectedRoots) {
    let rootStat;
    try {
      rootStat = fsMod.statSync(root);
    } catch (error) {
      const optionalAbsence =
        opts.optionalMissingRoots === true &&
        (error?.code === "ENOENT" || error?.code === "ENOTDIR");
      if (!optionalAbsence) complete = false;
      continue;
    }
    if (
      typeof rootStat?.isDirectory === "function" &&
      rootStat.isDirectory() !== true
    ) {
      complete = false;
      continue;
    }

    let entries;
    try {
      const listing = readBoundedDirectory(fsMod, root, maxFiles);
      entries = listing.entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      complete = complete && listing.complete;
      readableRootCount += 1;
    } catch {
      complete = false;
      continue;
    }

    for (const entry of entries) {
      if (
        entry &&
        typeof entry.isSymbolicLink === "function" &&
        entry.isSymbolicLink()
      ) {
        if (
          typeof entry.name === "string" &&
          entry.name.toLowerCase().endsWith(".ini")
        ) {
          complete = false;
        }
        continue;
      }
      if (!isDirectIniEntry(entry)) continue;
      files.push({
        filePath: path.join(root, entry.name),
        root,
      });
      if (files.length > maxFiles) {
        files.length = maxFiles;
        complete = false;
        break;
      }
    }
    if (files.length >= maxFiles && !complete) break;
  }

  return {
    roots: selectedRoots,
    files,
    readableRootCount,
    complete,
  };
}

function hasActivityFieldNames(text) {
  if (typeof text !== "string") return false;
  return REQUIRED_ACTIVITY_FIELDS.every((field) =>
    new RegExp(`^\\s*${field}\\s*=`, "imu").test(text),
  );
}

function hasAnyActivityFieldName(text) {
  if (typeof text !== "string") return false;
  return REQUIRED_ACTIVITY_FIELDS.some((field) =>
    new RegExp(`^\\s*${field}\\s*=`, "imu").test(text),
  );
}

function sameStableFile(left, right) {
  if (!left || !right) return false;
  for (const field of ["size", "mtimeMs", "ctimeMs", "dev", "ino"]) {
    if (
      left[field] != null &&
      right[field] != null &&
      Number(left[field]) !== Number(right[field])
    ) {
      return false;
    }
  }
  return true;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function safeReadStableText(filePath, opts = {}) {
  const fsMod = opts.fs || fs;
  const maxFileBytes = positiveInteger(
    opts.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    "maxFileBytes",
    HARD_MAX_FILE_BYTES,
  );
  let before;
  let text;
  let after;
  try {
    if (typeof fsMod.lstatSync === "function") {
      const linkStat = fsMod.lstatSync(filePath);
      if (
        typeof linkStat.isSymbolicLink === "function" &&
        linkStat.isSymbolicLink()
      ) {
        return { ok: false, symbolicLink: true };
      }
    }
    before = fsMod.statSync(filePath);
    if (
      !before.isFile() ||
      !Number.isSafeInteger(Number(before.size)) ||
      Number(before.size) < 0 ||
      Number(before.size) > maxFileBytes
    ) {
      return {
        ok: false,
        overBudget: Number(before.size) > maxFileBytes,
      };
    }

    if (
      typeof fsMod.openSync === "function" &&
      typeof fsMod.readSync === "function" &&
      typeof fsMod.fstatSync === "function" &&
      typeof fsMod.closeSync === "function"
    ) {
      let descriptor;
      let opened;
      let closed;
      let offset = 0;
      const buffer = Buffer.allocUnsafe(
        Math.min(maxFileBytes + 1, Number(before.size) + 1),
      );
      try {
        descriptor = fsMod.openSync(filePath, "r");
        opened = fsMod.fstatSync(descriptor);
        if (!opened.isFile() || !sameStableFile(before, opened)) {
          return { ok: false, changedDuringRead: true };
        }
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
        closed = fsMod.fstatSync(descriptor);
      } finally {
        if (descriptor !== undefined) fsMod.closeSync(descriptor);
      }
      after = fsMod.statSync(filePath);
      if (
        offset !== Number(before.size) ||
        offset > maxFileBytes ||
        !sameStableFile(before, opened) ||
        !sameStableFile(opened, closed) ||
        !sameStableFile(closed, after)
      ) {
        return { ok: false, changedDuringRead: true };
      }
      text = decodeUtf8(buffer.subarray(0, offset));
      if (text == null) return { ok: false, invalidEncoding: true };
    } else {
      text = fsMod.readFileSync(filePath, "utf8");
      after = fsMod.statSync(filePath);
    }
  } catch {
    return { ok: false, readFailed: true };
  }

  const stable =
    after.isFile() &&
    sameStableFile(before, after) &&
    Buffer.byteLength(text, "utf8") === before.size;
  if (!stable) return { ok: false, changedDuringRead: true };
  if (text.includes("\uFFFD")) return { ok: false, invalidEncoding: true };
  return {
    ok: true,
    text: text.replace(/^\uFEFF/u, ""),
    size: before.size,
    mtimeMs: Math.floor(before.mtimeMs),
  };
}

function inspectHBuilderXLocalData(roots, opts = {}) {
  const discovery = discoverHBuilderXIniFiles(roots, opts);
  const maxFileBytes = positiveInteger(
    opts.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    "maxFileBytes",
    HARD_MAX_FILE_BYTES,
  );
  const maxTotalBytes = positiveInteger(
    opts.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    "maxTotalBytes",
    HARD_MAX_TOTAL_BYTES,
  );
  let complete = discovery.complete;
  let activityFileCount = 0;
  let totalBytes = 0;
  for (const descriptor of discovery.files) {
    const remainingBytes = maxTotalBytes - totalBytes;
    if (remainingBytes <= 0) {
      complete = false;
      break;
    }
    const read = safeReadStableText(descriptor.filePath, {
      ...opts,
      maxFileBytes: Math.min(maxFileBytes, remainingBytes),
    });
    if (!read.ok) {
      complete = false;
      continue;
    }
    totalBytes += read.size;
    if (hasActivityFieldNames(read.text)) {
      activityFileCount += 1;
    } else if (hasAnyActivityFieldName(read.text)) {
      complete = false;
    }
  }
  return {
    rootCount: discovery.roots.length,
    readableRootCount: discovery.readableRootCount,
    candidateIniFileCount: discovery.files.length,
    activityFileCount,
    hasFileActivity: activityFileCount > 0,
    totalBytes,
    complete,
  };
}

function parseFixedOffset(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^(?:z|utc|gmt)$/iu.test(trimmed)) return 0;
  const match = /^(?:(?:utc|gmt)\s*)?([+-])(\d{1,2})(?::?(\d{2}))?$/iu.exec(
    trimmed,
  );
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    return null;
  }
  const total = hours * 60 + minutes;
  return match[1] === "-" ? -total : total;
}

function timezoneError() {
  const error = new Error(`${NAME}: source timezone is invalid`);
  error.code = "HBUILDERX_TIMEZONE_INVALID";
  return error;
}

function resolveSourceTimezone(opts = {}) {
  for (const candidate of [
    opts.sourceTimezoneOffsetMinutes,
    opts.sourceOffsetMinutes,
  ]) {
    if (candidate == null) continue;
    const numeric = Number(candidate);
    if (
      !Number.isSafeInteger(numeric) ||
      numeric < -14 * 60 ||
      numeric > 14 * 60
    ) {
      throw timezoneError();
    }
    return { kind: "offset", offsetMinutes: numeric };
  }

  const configured =
    typeof opts.sourceTimezone === "string" ? opts.sourceTimezone.trim() : "";
  const systemTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezone =
    !configured || configured.toLowerCase() === "local"
      ? systemTimezone
      : configured;
  const fixedOffset = parseFixedOffset(timezone);
  if (fixedOffset !== null) {
    return { kind: "offset", offsetMinutes: fixedOffset };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw timezoneError();
  }
  return { kind: "iana", timeZone: timezone };
}

function dateTimeParts(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\d{2})$/u.exec(
      value.trim(),
    );
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number(match[7]) * 10,
  };
  if (
    parts.year < 1970 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    return null;
  }
  const check = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

function partsInTimezone(timestamp, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function sameWallClock(left, right) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function timestampFromIana(parts, timeZone) {
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let guess = wallClockUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const projected = partsInTimezone(guess, timeZone);
    const projectedUtc = Date.UTC(
      projected.year,
      projected.month - 1,
      projected.day,
      projected.hour,
      projected.minute,
      projected.second,
      parts.millisecond,
    );
    const next = guess + (wallClockUtc - projectedUtc);
    if (next === guess) break;
    guess = next;
  }
  return sameWallClock(partsInTimezone(guess, timeZone), parts) ? guess : null;
}

function parseHBuilderXDateTime(value, opts = {}) {
  const parts = dateTimeParts(value);
  if (!parts) return null;
  const timezone = resolveSourceTimezone(opts);
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const timestamp =
    timezone.kind === "offset"
      ? wallClockUtc - timezone.offsetMinutes * 60_000
      : timestampFromIana(parts, timezone.timeZone);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function stripOptionalQuotes(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function normalizeActivityPath(value) {
  const raw = stripOptionalQuotes(value);
  if (!raw || raw.includes("\0")) return null;
  const windowsAbsolute = path.win32.isAbsolute(raw);
  const nativeAbsolute = path.isAbsolute(raw);
  if (!windowsAbsolute && !nativeAbsolute) return null;

  const canonical = windowsAbsolute
    ? path.win32.normalize(raw)
    : path.resolve(raw);

  const normalized = canonical.replace(/\\/gu, "/");
  return windowsAbsolute || process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function safeExtension(normalizedPath) {
  const extension = (
    /^[a-z]:\//iu.test(normalizedPath)
      ? path.posix.extname(normalizedPath)
      : path.extname(normalizedPath)
  ).toLowerCase();
  return /^\.[a-z0-9][a-z0-9._+-]{0,30}$/u.test(extension) ? extension : null;
}

function normalizeHBuilderXEncoding(value) {
  const normalized = stripOptionalQuotes(value);
  if (!normalized || normalized.length > 32) return null;
  const byteArray = /^@bytearray\(([a-z0-9._+-]+)\)$/iu.exec(normalized);
  const candidate = byteArray ? byteArray[1] : normalized;
  const knownEncoding =
    /^(?:utf-?(?:8|16(?:le|be)?|32(?:le|be)?)|gbk|gb2312|gb18030|big5|ascii|latin-?1|iso-8859-(?:1|15)|windows-125[0-8]|shift[_-]?jis|euc-(?:jp|kr))(?:\((?:bom|no-?bom|without-?bom|[0-9]{3,6})\))?$/iu;
  return knownEncoding.test(candidate) ? candidate : null;
}

function flushSection(section, context) {
  const keys = section.values;
  const hasActivityField = REQUIRED_ACTIVITY_FIELDS.some((field) =>
    keys.has(field),
  );
  if (!hasActivityField) return { record: null, complete: true };
  if (
    section.duplicateRequiredField ||
    !REQUIRED_ACTIVITY_FIELDS.every((field) => keys.has(field))
  ) {
    return { record: null, complete: false };
  }

  const normalizedPath = normalizeActivityPath(keys.get("filepath"));
  const occurredAt = parseHBuilderXDateTime(keys.get("datetime"), context);
  const rawEncoding = stripOptionalQuotes(keys.get("encoding"));
  const encoding = normalizeHBuilderXEncoding(rawEncoding);
  if (!normalizedPath || !occurredAt || !encoding) {
    return { record: null, complete: false };
  }

  const pathHash = sha256Hex(
    `${NAME}\0${context.scopeIdentity}\0path\0${normalizedPath}`,
  );
  const encodingHash = sha256Hex(encoding.toLowerCase());
  const occurrenceKey = `${pathHash}\0${occurredAt}\0${encodingHash}`;
  const occurrence = context.occurrences.get(occurrenceKey) || 0;
  context.occurrences.set(occurrenceKey, occurrence + 1);
  const recordId = sha256Hex(
    `${NAME}\0${context.scopeIdentity}\0${pathHash}\0${occurredAt}\0${occurrence}\0${encodingHash}`,
  );
  const extension = safeExtension(normalizedPath);
  return {
    complete: true,
    record: {
      recordId,
      capturedAt: occurredAt,
      payload: {
        pathHash,
        extension,
        fileType: FILE_TYPE_BY_EXTENSION[extension] || "other",
        encoding,
        timestampSource: "hbuilderx-ini-local-datetime",
        occurredAt,
      },
    },
  };
}

function parseActivityIni(text, opts = {}) {
  const maxSections = positiveInteger(
    opts.maxSections,
    DEFAULT_MAX_SECTIONS,
    "maxSections",
    HARD_MAX_SECTIONS,
  );
  const maxLineChars = positiveInteger(
    opts.maxLineChars,
    DEFAULT_MAX_LINE_CHARS,
    "maxLineChars",
    HARD_MAX_LINE_CHARS,
  );
  const maxRecords = positiveInteger(
    opts.maxRecords,
    DEFAULT_MAX_RECORDS,
    "maxRecords",
    HARD_MAX_RECORDS,
  );
  const context = {
    ...opts,
    fs: opts.fs || fs,
    scopeIdentity:
      typeof opts.scopeIdentity === "string" && opts.scopeIdentity
        ? opts.scopeIdentity
        : sha256Hex(NAME),
    occurrences: opts.occurrences || new Map(),
  };

  const records = [];
  let complete = true;
  let inspectedSections = 0;
  let section = null;
  let discardCurrentSection = false;
  const lines = String(text || "").split(/\r?\n/u);

  const finishSection = () => {
    if (!section) return true;
    inspectedSections += 1;
    if (inspectedSections > maxSections) {
      complete = false;
      return false;
    }
    const flushed = flushSection(section, context);
    complete = complete && flushed.complete;
    if (flushed.record) {
      if (records.length >= maxRecords) {
        complete = false;
        return false;
      }
      records.push(flushed.record);
    }
    return true;
  };

  for (const line of lines) {
    if (line.length > maxLineChars) {
      complete = false;
      discardCurrentSection = true;
      break;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) {
      continue;
    }
    if (/^\[[^\]\r\n]+\]$/u.test(trimmed)) {
      if (!finishSection()) {
        section = null;
        break;
      }
      section = {
        values: new Map(),
        duplicateRequiredField: false,
      };
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!REQUIRED_ACTIVITY_FIELDS.includes(key)) continue;
    if (!section) {
      complete = false;
      continue;
    }
    if (section.values.has(key)) section.duplicateRequiredField = true;
    section.values.set(key, line.slice(separator + 1).trim());
  }
  if (section && !discardCurrentSection) finishSection();

  return {
    records,
    inspectedSections: Math.min(inspectedSections, maxSections),
    complete,
  };
}

function readHBuilderXFileActivity(roots, opts = {}) {
  const fsMod = opts.fs || fs;
  const maxFileBytes = positiveInteger(
    opts.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    "maxFileBytes",
    HARD_MAX_FILE_BYTES,
  );
  const maxTotalBytes = positiveInteger(
    opts.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    "maxTotalBytes",
    HARD_MAX_TOTAL_BYTES,
  );
  const maxSections = positiveInteger(
    opts.maxSections,
    DEFAULT_MAX_SECTIONS,
    "maxSections",
    HARD_MAX_SECTIONS,
  );
  const maxRecords = positiveInteger(
    opts.maxRecords,
    DEFAULT_MAX_RECORDS,
    "maxRecords",
    HARD_MAX_RECORDS,
  );
  const since =
    Number.isSafeInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const canonicalRoots = canonicalizeRoots(roots, fsMod);
  const scopeIdentity =
    typeof opts.scope === "string" && opts.scope
      ? opts.scope
      : sha256Hex(
          `${NAME}\0roots\0${canonicalRoots
            .map((root) =>
              process.platform === "win32" ? root.toLowerCase() : root,
            )
            .join("\0")}`,
        );
  const discovery = discoverHBuilderXIniFiles(canonicalRoots, {
    ...opts,
    fs: fsMod,
  });
  let complete = discovery.complete;
  let inspectedFiles = 0;
  let inspectedSections = 0;
  let totalBytes = 0;
  const occurrences = new Map();
  const records = [];

  for (const descriptor of discovery.files) {
    const remainingBytes = maxTotalBytes - totalBytes;
    if (remainingBytes <= 0) {
      complete = false;
      break;
    }
    const read = safeReadStableText(descriptor.filePath, {
      ...opts,
      fs: fsMod,
      maxFileBytes: Math.min(maxFileBytes, remainingBytes),
    });
    inspectedFiles += 1;
    if (!read.ok) {
      complete = false;
      continue;
    }
    totalBytes += read.size;
    if (read.size === 0) {
      complete = false;
      continue;
    }

    const remainingSections = maxSections - inspectedSections;
    const remainingRecords = maxRecords - records.length;
    if (remainingSections <= 0 || remainingRecords <= 0) {
      complete = false;
      break;
    }
    const parsed = parseActivityIni(read.text, {
      ...opts,
      fs: fsMod,
      scopeIdentity,
      occurrences,
      maxSections: remainingSections,
      maxRecords: remainingRecords,
    });
    inspectedSections += parsed.inspectedSections;
    complete = complete && parsed.complete;
    records.push(...parsed.records);
  }

  records.sort(
    (left, right) =>
      left.capturedAt - right.capturedAt ||
      left.payload.pathHash.localeCompare(right.payload.pathHash) ||
      left.recordId.localeCompare(right.recordId),
  );
  return {
    records:
      since > 0
        ? records.filter((record) => record.capturedAt >= since)
        : records,
    inspectedFiles,
    inspectedSections,
    totalBytes,
    complete,
  };
}

module.exports = {
  WINDOWS_DATA_DIRECTORY,
  DEFAULT_MAX_ROOTS,
  HARD_MAX_ROOTS,
  DEFAULT_MAX_FILES,
  HARD_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  HARD_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  HARD_MAX_TOTAL_BYTES,
  DEFAULT_MAX_SECTIONS,
  HARD_MAX_SECTIONS,
  DEFAULT_MAX_LINE_CHARS,
  HARD_MAX_LINE_CHARS,
  DEFAULT_MAX_RECORDS,
  HARD_MAX_RECORDS,
  defaultHBuilderXHomes,
  canonicalHBuilderXRoot,
  canonicalizeRoots,
  discoverHBuilderXIniFiles,
  inspectHBuilderXLocalData,
  resolveSourceTimezone,
  parseHBuilderXDateTime,
  normalizeHBuilderXEncoding,
  parseActivityIni,
  readHBuilderXFileActivity,
};
