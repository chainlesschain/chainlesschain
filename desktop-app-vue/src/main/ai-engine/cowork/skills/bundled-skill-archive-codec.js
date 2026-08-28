"use strict";

/**
 * Bounded in-memory ZIP codec for bundled Skills.
 *
 * adm-zip is never given a filesystem path. All host I/O stays behind the
 * branded bundled filesystem proxy, while this module bounds archive shape,
 * expanded bytes, and extraction paths before writing anything.
 */

const AdmZip = require("adm-zip");
const path = require("node:path");
const { bundledSkillFs: fs } = require("./bundled-skill-filesystem-broker.js");

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_NAME_BYTES = 1024 * 1024;
const MAX_ENTRY_NAME_BYTES = 1024;

function archiveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeArchiveEntryName(entryName, { directory = false } = {}) {
  if (
    typeof entryName !== "string" ||
    !entryName ||
    entryName.includes("\0") ||
    Buffer.byteLength(entryName, "utf8") > MAX_ENTRY_NAME_BYTES
  ) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_ENTRY_INVALID",
      "Archive entry name is invalid",
    );
  }
  const portable = entryName.replace(/\\/g, "/");
  if (portable.startsWith("/") || /^[A-Za-z]:/.test(portable)) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_ENTRY_ESCAPE",
      "Archive entry escapes the approved extraction root",
    );
  }
  const segments = portable.split("/").filter((segment) => segment !== "");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_ENTRY_ESCAPE",
      "Archive entry escapes the approved extraction root",
    );
  }
  return `${segments.join("/")}${directory ? "/" : ""}`;
}

function isSymlinkEntry(entry) {
  const unixMode = (Number(entry.attr) >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function inspectEntries(zip) {
  const rawEntries = zip.getEntries();
  if (rawEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_TOO_MANY_ENTRIES",
      "Archive entry count exceeded the configured limit",
    );
  }
  let totalSize = 0;
  let totalNameBytes = 0;
  const entries = rawEntries.map((entry) => {
    if (isSymlinkEntry(entry)) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_SYMLINK_DENIED",
        "Archive symbolic-link entries are not allowed",
      );
    }
    const isDirectory = Boolean(entry.isDirectory);
    const name = normalizeArchiveEntryName(entry.entryName, {
      directory: isDirectory,
    });
    totalNameBytes += Buffer.byteLength(name, "utf8");
    if (totalNameBytes > MAX_ARCHIVE_NAME_BYTES) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_NAMES_TOO_LARGE",
        "Archive entry names exceeded the configured limit",
      );
    }
    const size = Number(entry.header?.size || 0);
    const compressedSize = Number(entry.header?.compressedSize || 0);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !Number.isSafeInteger(compressedSize) ||
      compressedSize < 0
    ) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_SIZE_INVALID",
        "Archive entry size is invalid",
      );
    }
    totalSize += size;
    if (size > MAX_ARCHIVE_BYTES || totalSize > MAX_ARCHIVE_BYTES) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_EXPANSION_TOO_LARGE",
        "Archive expanded size exceeded the configured limit",
      );
    }
    return Object.freeze({
      compressedSize,
      isDirectory,
      name,
      size,
      entry,
    });
  });
  return { entries, totalSize };
}

function loadArchive(zipPath) {
  const archiveBytes = fs.readFileSync(zipPath);
  if (!Buffer.isBuffer(archiveBytes)) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_BYTES_INVALID",
      "Archive input must be binary data",
    );
  }
  return inspectEntries(new AdmZip(archiveBytes));
}

function inspectArchive(zipPath) {
  const { entries, totalSize } = loadArchive(zipPath);
  return Object.freeze({
    entries: Object.freeze(
      entries.map(({ entry: _entry, ...metadata }) => Object.freeze(metadata)),
    ),
    totalSize,
  });
}

function writeArchiveFromFiles(outputPath, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_FILES_REQUIRED",
      "At least one archive input file is required",
    );
  }
  if (files.length > MAX_ARCHIVE_ENTRIES) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_TOO_MANY_ENTRIES",
      "Archive entry count exceeded the configured limit",
    );
  }
  const zip = new AdmZip();
  let totalSize = 0;
  let totalNameBytes = 0;
  for (const file of files) {
    const name = normalizeArchiveEntryName(file?.name);
    totalNameBytes += Buffer.byteLength(name, "utf8");
    if (totalNameBytes > MAX_ARCHIVE_NAME_BYTES) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_NAMES_TOO_LARGE",
        "Archive entry names exceeded the configured limit",
      );
    }
    const data = fs.readFileSync(file?.path);
    if (!Buffer.isBuffer(data)) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_BYTES_INVALID",
        "Archive input must be binary data",
      );
    }
    totalSize += data.length;
    if (data.length > MAX_ARCHIVE_BYTES || totalSize > MAX_ARCHIVE_BYTES) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_INPUT_TOO_LARGE",
        "Archive input size exceeded the configured limit",
      );
    }
    zip.addFile(name, data);
  }
  const archiveBytes = zip.toBuffer();
  if (archiveBytes.length > MAX_ARCHIVE_BYTES) {
    throw archiveError(
      "CC_BUNDLED_SKILL_ARCHIVE_OUTPUT_TOO_LARGE",
      "Archive output size exceeded the configured limit",
    );
  }
  fs.writeFileSync(outputPath, archiveBytes);
  return Object.freeze({
    archiveSize: archiveBytes.length,
    fileCount: files.length,
    totalSize,
  });
}

function extractArchiveTo(zipPath, targetDirectory) {
  const { entries, totalSize } = loadArchive(zipPath);
  const extractionRoot = path.resolve(targetDirectory);
  const planned = entries.map((metadata) => {
    const outputPath = path.resolve(
      extractionRoot,
      ...metadata.name.split("/").filter(Boolean),
    );
    const relative = path.relative(extractionRoot, outputPath);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_ENTRY_ESCAPE",
        "Archive entry escapes the approved extraction root",
      );
    }
    return { metadata, outputPath };
  });

  let expandedBytes = 0;
  const expanded = planned.map(({ metadata, outputPath }) => {
    if (metadata.isDirectory) return { metadata, outputPath, data: null };
    const data = metadata.entry.getData();
    if (!Buffer.isBuffer(data)) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_BYTES_INVALID",
        "Archive entry must expand to binary data",
      );
    }
    expandedBytes += data.length;
    if (data.length > MAX_ARCHIVE_BYTES || expandedBytes > MAX_ARCHIVE_BYTES) {
      throw archiveError(
        "CC_BUNDLED_SKILL_ARCHIVE_EXPANSION_TOO_LARGE",
        "Archive expanded size exceeded the configured limit",
      );
    }
    return { metadata, outputPath, data };
  });

  for (const { metadata, outputPath, data } of expanded) {
    if (metadata.isDirectory) {
      fs.mkdirSync(outputPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, data);
  }

  return Object.freeze({
    entries: Object.freeze(
      entries.map(({ entry: _entry, ...metadata }) => Object.freeze(metadata)),
    ),
    fileCount: entries.filter((entry) => !entry.isDirectory).length,
    totalSize,
  });
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  extractArchiveTo,
  inspectArchive,
  normalizeArchiveEntryName,
  writeArchiveFromFiles,
};
