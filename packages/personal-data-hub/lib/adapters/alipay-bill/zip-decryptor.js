"use strict";

const fs = require("node:fs");
const {
  DEFAULT_MAX_SNAPSHOT_BYTES,
  HARD_MAX_SNAPSHOT_BYTES,
  SnapshotFileError,
  readBoundedSnapshotBuffer,
  resolveMaxSnapshotBytes,
} = require("../../snapshot-file");

const DEFAULT_MAX_ARCHIVE_BYTES = DEFAULT_MAX_SNAPSHOT_BYTES;
const HARD_MAX_ARCHIVE_BYTES = HARD_MAX_SNAPSHOT_BYTES;
const DEFAULT_MAX_CSV_BYTES = DEFAULT_MAX_SNAPSHOT_BYTES;
const HARD_MAX_CSV_BYTES = HARD_MAX_SNAPSHOT_BYTES;
const DEFAULT_MAX_ZIP_ENTRIES = 128;
const HARD_MAX_ZIP_ENTRIES = 4096;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const EOCD_FIXED_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const CENTRAL_FILE_HEADER_BYTES = 46;

class AlipayArchiveError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "AlipayArchiveError";
    this.code = code;
  }
}

function resolveNamedByteLimit(value, fallback, name) {
  try {
    return resolveMaxSnapshotBytes(value == null ? fallback : value);
  } catch (error) {
    throw new SnapshotFileError(
      "SNAPSHOT_LIMIT_INVALID",
      `${name} must be a positive safe integer no greater than ${HARD_MAX_SNAPSHOT_BYTES}`,
      { cause: error },
    );
  }
}

function resolveZipEntryLimit(value, fallback = DEFAULT_MAX_ZIP_ENTRIES) {
  const resolved = value == null ? fallback : value;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > HARD_MAX_ZIP_ENTRIES
  ) {
    throw new AlipayArchiveError(
      "ZIP_ENTRY_LIMIT_INVALID",
      `maxZipEntries must be a positive safe integer no greater than ${HARD_MAX_ZIP_ENTRIES}`,
    );
  }
  return resolved;
}

function resolveAlipayImportLimits(opts = {}, defaults = {}) {
  const maxSnapshotBytes = resolveNamedByteLimit(
    opts.maxSnapshotBytes,
    defaults.maxSnapshotBytes == null
      ? DEFAULT_MAX_SNAPSHOT_BYTES
      : defaults.maxSnapshotBytes,
    "maxSnapshotBytes",
  );
  const archiveLimit = resolveNamedByteLimit(
    opts.maxArchiveBytes,
    defaults.maxArchiveBytes == null
      ? DEFAULT_MAX_ARCHIVE_BYTES
      : defaults.maxArchiveBytes,
    "maxArchiveBytes",
  );
  const csvLimit = resolveNamedByteLimit(
    opts.maxCsvBytes,
    defaults.maxCsvBytes == null ? DEFAULT_MAX_CSV_BYTES : defaults.maxCsvBytes,
    "maxCsvBytes",
  );
  return {
    maxSnapshotBytes,
    maxArchiveBytes: Math.min(maxSnapshotBytes, archiveLimit),
    maxCsvBytes: Math.min(maxSnapshotBytes, csvLimit),
    maxZipEntries: resolveZipEntryLimit(
      opts.maxZipEntries,
      defaults.maxZipEntries,
    ),
  };
}

/**
 * Extract the single CSV file from an Alipay ZIP without ever giving the ZIP
 * library a filesystem path. The selected archive is opened and verified by
 * the shared bounded snapshot reader first, then adm-zip only sees its Buffer.
 *
 * @param {string} zipPath
 * @param {object} [opts]
 * @param {string} [opts.password]
 * @param {Function} [opts.admZipImpl]
 * @param {object} [opts.fsImpl]
 * @param {number} [opts.maxSnapshotBytes]
 * @param {number} [opts.maxArchiveBytes]
 * @param {number} [opts.maxCsvBytes]
 * @param {number} [opts.maxZipEntries]
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function extractCsvFromZip(zipPath, opts = {}) {
  if (typeof zipPath !== "string" || zipPath.length === 0) {
    throw new AlipayArchiveError(
      "ZIP_PATH_REQUIRED",
      "Alipay ZIP file path is required",
    );
  }

  const limits = resolveAlipayImportLimits(opts);
  let archiveBuffer;
  try {
    archiveBuffer = readBoundedSnapshotBuffer(opts.fsImpl || fs, zipPath, {
      maxBytes: limits.maxArchiveBytes,
    });
  } catch (error) {
    throw sanitizeFileBoundaryError(error);
  }
  const directory = inspectClassicZipDirectory(
    archiveBuffer,
    limits.maxZipEntries,
  );
  const AdmZip =
    typeof opts.admZipImpl === "function" ? opts.admZipImpl : loadAdmZip();

  let zip;
  try {
    zip = new AdmZip(archiveBuffer);
  } catch {
    throw new AlipayArchiveError(
      "ZIP_INVALID",
      "Alipay ZIP could not be opened",
    );
  }

  let entries;
  try {
    entries = zip.getEntries();
  } catch {
    throw new AlipayArchiveError(
      "ZIP_INVALID",
      "Alipay ZIP directory could not be read",
    );
  }
  if (!Array.isArray(entries)) {
    throw new AlipayArchiveError(
      "ZIP_INVALID",
      "Alipay ZIP directory is invalid",
    );
  }
  if (entries.length > limits.maxZipEntries) {
    throw new AlipayArchiveError(
      "ZIP_TOO_MANY_ENTRIES",
      `Alipay ZIP exceeds the ${limits.maxZipEntries}-entry import limit`,
    );
  }
  if (entries.length !== directory.entryCount) {
    throw new AlipayArchiveError(
      "ZIP_CENTRAL_DIRECTORY_INVALID",
      "Alipay ZIP entry count does not match its central directory",
    );
  }

  for (const entry of entries) {
    if (!isSafeArchiveEntry(entry)) {
      throw new AlipayArchiveError(
        "ZIP_ENTRY_UNSAFE",
        "Alipay ZIP contains an unsafe entry name",
      );
    }
  }
  const csvEntries = entries.filter(
    (entry) => !entry.isDirectory && /\.csv$/iu.test(entry.entryName),
  );
  if (csvEntries.length === 0) {
    throw new AlipayArchiveError(
      "ZIP_CSV_MISSING",
      "Alipay ZIP does not contain a CSV file",
    );
  }
  if (csvEntries.length !== 1) {
    throw new AlipayArchiveError(
      "ZIP_CSV_AMBIGUOUS",
      "Alipay ZIP must contain exactly one CSV file",
    );
  }

  const csvEntry = csvEntries[0];
  const declaredSize = declaredUncompressedSize(csvEntry);
  if (declaredSize > limits.maxCsvBytes) {
    throw new AlipayArchiveError(
      "ZIP_CSV_TOO_LARGE",
      `Alipay CSV exceeds the ${limits.maxCsvBytes}-byte import limit`,
    );
  }

  let csvBuffer;
  try {
    csvBuffer = zip.readFile(csvEntry, opts.password || "");
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    if (/password|wrong/iu.test(detail)) {
      throw new AlipayArchiveError(
        "ZIP_PASSWORD_FAILED",
        "Alipay ZIP password is incorrect or missing",
      );
    }
    throw new AlipayArchiveError(
      "ZIP_EXTRACT_FAILED",
      "Alipay ZIP CSV could not be extracted",
    );
  }

  if (!Buffer.isBuffer(csvBuffer) || csvBuffer.length === 0) {
    throw new AlipayArchiveError(
      "ZIP_PASSWORD_FAILED",
      "Alipay ZIP password is incorrect or returned an empty CSV",
    );
  }
  if (csvBuffer.length > limits.maxCsvBytes) {
    throw new AlipayArchiveError(
      "ZIP_CSV_TOO_LARGE",
      `Alipay CSV exceeds the ${limits.maxCsvBytes}-byte import limit`,
    );
  }

  return { buffer: csvBuffer, filename: csvEntry.entryName };
}

function inspectClassicZipDirectory(buffer, maxZipEntries) {
  if (!Buffer.isBuffer(buffer) || buffer.length < EOCD_FIXED_BYTES) {
    throw new AlipayArchiveError(
      "ZIP_EOCD_INVALID",
      "Alipay ZIP end-of-central-directory record is missing",
    );
  }
  const earliest = Math.max(
    0,
    buffer.length - EOCD_FIXED_BYTES - MAX_ZIP_COMMENT_BYTES,
  );
  let eocdOffset = -1;
  for (
    let offset = buffer.length - EOCD_FIXED_BYTES;
    offset >= earliest;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_FIXED_BYTES + commentLength === buffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new AlipayArchiveError(
      "ZIP_EOCD_INVALID",
      "Alipay ZIP end-of-central-directory record is malformed",
    );
  }
  if (
    eocdOffset >= 20 &&
    buffer.readUInt32LE(eocdOffset - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    throw new AlipayArchiveError(
      "ZIP64_UNSUPPORTED",
      "ZIP64 Alipay exports are not supported",
    );
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber === 0xffff ||
    centralDirectoryDisk === 0xffff ||
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new AlipayArchiveError(
      "ZIP64_UNSUPPORTED",
      "ZIP64 Alipay exports are not supported",
    );
  }
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    throw new AlipayArchiveError(
      "ZIP_MULTIDISK_UNSUPPORTED",
      "Multi-disk Alipay ZIP exports are not supported",
    );
  }
  if (entryCount > maxZipEntries) {
    throw new AlipayArchiveError(
      "ZIP_TOO_MANY_ENTRIES",
      `Alipay ZIP exceeds the ${maxZipEntries}-entry import limit`,
    );
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    !Number.isSafeInteger(centralDirectoryEnd) ||
    centralDirectoryOffset > eocdOffset ||
    centralDirectorySize > eocdOffset - centralDirectoryOffset ||
    centralDirectoryEnd > eocdOffset ||
    (entryCount === 0 && centralDirectorySize !== 0) ||
    (entryCount > 0 &&
      centralDirectorySize < entryCount * CENTRAL_FILE_HEADER_BYTES)
  ) {
    throw new AlipayArchiveError(
      "ZIP_CENTRAL_DIRECTORY_INVALID",
      "Alipay ZIP central-directory bounds are invalid",
    );
  }

  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + CENTRAL_FILE_HEADER_BYTES > centralDirectoryEnd ||
      buffer.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER_SIGNATURE
    ) {
      throw new AlipayArchiveError(
        "ZIP_CENTRAL_DIRECTORY_INVALID",
        "Alipay ZIP central-directory record is malformed",
      );
    }
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const entryDisk = buffer.readUInt16LE(cursor + 34);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      entryDisk === 0xffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new AlipayArchiveError(
        "ZIP64_UNSUPPORTED",
        "ZIP64 Alipay exports are not supported",
      );
    }
    if (entryDisk !== 0) {
      throw new AlipayArchiveError(
        "ZIP_MULTIDISK_UNSUPPORTED",
        "Multi-disk Alipay ZIP exports are not supported",
      );
    }

    const extraStart = cursor + CENTRAL_FILE_HEADER_BYTES + filenameLength;
    const extraEnd = extraStart + extraLength;
    const recordEnd = extraEnd + commentLength;
    if (
      filenameLength === 0 ||
      recordEnd > centralDirectoryEnd ||
      localHeaderOffset + 4 > centralDirectoryOffset ||
      buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new AlipayArchiveError(
        "ZIP_CENTRAL_DIRECTORY_INVALID",
        "Alipay ZIP central-directory record is malformed",
      );
    }
    inspectClassicExtraFields(buffer, extraStart, extraEnd);
    cursor = recordEnd;
  }
  if (cursor !== centralDirectoryEnd) {
    throw new AlipayArchiveError(
      "ZIP_CENTRAL_DIRECTORY_INVALID",
      "Alipay ZIP central-directory size does not match its entries",
    );
  }
  return {
    entryCount,
    centralDirectoryOffset,
    centralDirectorySize,
  };
}

function inspectClassicExtraFields(buffer, start, end) {
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) {
      throw new AlipayArchiveError(
        "ZIP_CENTRAL_DIRECTORY_INVALID",
        "Alipay ZIP extra-field metadata is malformed",
      );
    }
    const fieldId = buffer.readUInt16LE(cursor);
    const fieldLength = buffer.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + fieldLength > end) {
      throw new AlipayArchiveError(
        "ZIP_CENTRAL_DIRECTORY_INVALID",
        "Alipay ZIP extra-field metadata is malformed",
      );
    }
    if (fieldId === ZIP64_EXTRA_FIELD_ID) {
      throw new AlipayArchiveError(
        "ZIP64_UNSUPPORTED",
        "ZIP64 Alipay exports are not supported",
      );
    }
    cursor += fieldLength;
  }
}

function isSafeArchiveEntry(entry) {
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.entryName !== "string" ||
    entry.entryName.length === 0 ||
    entry.entryName.includes("\0")
  ) {
    return false;
  }
  const normalized = entry.entryName.replace(/\\/gu, "/");
  return !(
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  );
}

function declaredUncompressedSize(entry) {
  const value = entry && entry.header && entry.header.size;
  const size =
    typeof value === "bigint"
      ? value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : NaN
      : Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new AlipayArchiveError(
      "ZIP_ENTRY_SIZE_INVALID",
      "Alipay ZIP CSV declares an invalid uncompressed size",
    );
  }
  return size;
}

function sanitizeFileBoundaryError(error) {
  if (
    error instanceof SnapshotFileError ||
    (error && typeof error.code === "string")
  ) {
    return new SnapshotFileError(
      error.code,
      typeof error.message === "string"
        ? error.message
        : "Alipay bill export is unavailable or unreadable",
    );
  }
  return new SnapshotFileError(
    "INPUT_PATH_UNREADABLE",
    "Alipay bill export is unavailable or unreadable",
  );
}

let admZipCache = null;
function loadAdmZip() {
  if (admZipCache) return admZipCache;
  try {
    admZipCache = require("adm-zip");
  } catch {
    throw new AlipayArchiveError(
      "ZIP_SUPPORT_UNAVAILABLE",
      "Alipay ZIP support is unavailable",
    );
  }
  return admZipCache;
}

module.exports = {
  AlipayArchiveError,
  DEFAULT_MAX_ARCHIVE_BYTES,
  DEFAULT_MAX_CSV_BYTES,
  DEFAULT_MAX_ZIP_ENTRIES,
  HARD_MAX_ARCHIVE_BYTES,
  HARD_MAX_CSV_BYTES,
  HARD_MAX_ZIP_ENTRIES,
  declaredUncompressedSize,
  extractCsvFromZip,
  inspectClassicZipDirectory,
  isSafeArchiveEntry,
  resolveAlipayImportLimits,
};
