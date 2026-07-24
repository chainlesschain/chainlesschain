"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_EXCLUDES = Object.freeze([
  "xwechat_files",
  "WXWork",
  "node_modules",
  ".git",
]);
const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_FILES_PER_ROOT = 5000;
const HARD_MAX_ROOTS = 128;
const HARD_MAX_DEPTH = 32;
const HARD_MAX_FILES = 100_000;
const HARD_MAX_DIRECTORIES = 50_000;
const HARD_MAX_ENTRIES = 1_000_000;
const HARD_MAX_ENTRIES_PER_DIRECTORY = 100_000;
const HARD_MAX_METADATA_BYTES = 64 * 1024 * 1024;
const HARD_MAX_ROOT_BYTES = 32 * 1024;
const HARD_MAX_TOTAL_ROOT_BYTES = 256 * 1024;
const HARD_MAX_EXCLUDES = 256;
const HARD_MAX_EXCLUDE_BYTES = 16 * 1024;
const DEFAULT_MAX_SCAN_MS = 10_000;
const HARD_MAX_SCAN_MS = 60_000;

function defaultRoots() {
  const home = os.homedir();
  if (!home) return [];
  return [
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    path.join(home, "Downloads"),
    path.join(home, "Pictures"),
    path.join(home, "Videos"),
    path.join(home, "Music"),
  ];
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizedForCompare(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function unsupportedWindowsRoot(value) {
  if (process.platform !== "win32") return false;
  return String(value).replace(/\//gu, "\\").startsWith("\\\\");
}

function rootHasReparseComponent(candidate, fsMod) {
  if (process.platform !== "win32" || typeof fsMod.lstatSync !== "function") {
    return false;
  }
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  const segments = path
    .relative(parsed.root, resolved)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fsMod.lstatSync(current);
    } catch {
      return false;
    }
    if (stat?.isSymbolicLink()) return true;
  }
  return false;
}

function createScanStopError(code, message, name = "Error") {
  const error = new Error(message);
  error.code = code;
  error.name = name;
  return error;
}

function assertScanActive(opts, deadlineMs, now) {
  if (opts.signal?.aborted) {
    throw createScanStopError(
      "ABORT_ERR",
      "local-files: directory scan aborted",
      "AbortError",
    );
  }
  if (now() > deadlineMs) {
    throw createScanStopError(
      "LOCAL_FILES_SCAN_TIMEOUT",
      "local-files: directory scan exceeded its time budget",
    );
  }
}

function isScanStopError(error) {
  return (
    error?.code === "ABORT_ERR" || error?.code === "LOCAL_FILES_SCAN_TIMEOUT"
  );
}

function resolveRealPath(fsMod, value) {
  const candidate = path.resolve(value);
  const realpath =
    fsMod.realpathSync && typeof fsMod.realpathSync.native === "function"
      ? fsMod.realpathSync.native(candidate)
      : fsMod.realpathSync(candidate);
  return path.resolve(realpath);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function safeRealPath(root, candidate, fsMod) {
  const realPath = resolveRealPath(fsMod, candidate);
  const normalizedRoot = normalizedForCompare(root);
  const normalizedCandidate = normalizedForCompare(candidate);
  const normalizedRealPath = normalizedForCompare(realPath);
  if (
    !isWithin(normalizedRoot, normalizedRealPath) ||
    normalizedCandidate !== normalizedRealPath
  ) {
    return null;
  }
  return realPath;
}

function pathKind(stat) {
  if (stat?.isDirectory()) return "directory";
  if (stat?.isFile()) return "file";
  if (stat?.isSymbolicLink()) return "symlink";
  return "other";
}

function inspectStablePath(root, candidate, fsMod) {
  const before = fsMod.lstatSync(candidate);
  if (before.isSymbolicLink()) return { skippedSymlink: true };
  const realPathBefore = safeRealPath(root, candidate, fsMod);
  if (!realPathBefore) return { issue: "PATH_ESCAPE" };

  const after = fsMod.lstatSync(candidate);
  if (after.isSymbolicLink()) return { issue: "PATH_CHANGED" };
  const realPathAfter = safeRealPath(root, candidate, fsMod);
  if (!realPathAfter) return { issue: "PATH_ESCAPE" };
  if (
    normalizedForCompare(realPathBefore) !==
      normalizedForCompare(realPathAfter) ||
    pathKind(before) !== pathKind(after) ||
    statFingerprint(before) !== statFingerprint(after)
  ) {
    return { issue: "PATH_CHANGED" };
  }
  return { stat: after, realPath: realPathAfter };
}

function canonicalizeRoots(roots, fsMod = fs) {
  const source = Array.isArray(roots) ? roots : [];
  if (source.length > HARD_MAX_ROOTS) {
    const error = new Error(
      `local-files: root count must not exceed ${HARD_MAX_ROOTS}`,
    );
    error.code = "LOCAL_FILES_ROOT_LIMIT";
    throw error;
  }

  const unique = new Map();
  let totalRootBytes = 0;
  for (const entry of source) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.includes("\0")) {
      const error = new Error("local-files: roots must not contain NUL bytes");
      error.code = "LOCAL_FILES_ROOT_INVALID";
      throw error;
    }
    const rootBytes = Buffer.byteLength(entry, "utf8");
    totalRootBytes += rootBytes;
    if (
      rootBytes > HARD_MAX_ROOT_BYTES ||
      totalRootBytes > HARD_MAX_TOTAL_ROOT_BYTES
    ) {
      const error = new Error("local-files: selected roots are too large");
      error.code = "LOCAL_FILES_ROOT_LIMIT";
      throw error;
    }
    if (unsupportedWindowsRoot(entry)) {
      const error = new Error(
        "local-files: network and device roots are not supported",
      );
      error.code = "LOCAL_FILES_NETWORK_ROOT_UNSUPPORTED";
      throw error;
    }
    let canonical = path.resolve(entry);
    if (rootHasReparseComponent(canonical, fsMod)) {
      const error = new Error(
        "local-files: reparse-point roots are not supported",
      );
      error.code = "LOCAL_FILES_REPARSE_ROOT_UNSUPPORTED";
      throw error;
    }
    try {
      const realpath =
        fsMod.realpathSync && typeof fsMod.realpathSync.native === "function"
          ? fsMod.realpathSync.native(canonical)
          : fsMod.realpathSync(canonical);
      if (typeof realpath === "string" && realpath) canonical = realpath;
    } catch {
      // Missing roots are retained so readiness can report them explicitly.
    }
    if (unsupportedWindowsRoot(canonical)) {
      const error = new Error(
        "local-files: network and device roots are not supported",
      );
      error.code = "LOCAL_FILES_NETWORK_ROOT_UNSUPPORTED";
      throw error;
    }
    const key = normalizedForCompare(canonical);
    if (!unique.has(key)) unique.set(key, canonical);
  }

  const ordered = [...unique.values()].sort((left, right) => {
    const depthDelta =
      normalizedForCompare(left).split(path.sep).length -
      normalizedForCompare(right).split(path.sep).length;
    return (
      depthDelta ||
      compareText(normalizedForCompare(left), normalizedForCompare(right))
    );
  });
  return ordered;
}

function probeDirectory(root, fsMod) {
  const stat = fsMod.statSync(root);
  if (!stat || !stat.isDirectory()) {
    const error = new Error("selected root is not a directory");
    error.code = "ENOTDIR";
    throw error;
  }
  if (typeof fsMod.accessSync === "function") {
    fsMod.accessSync(root, fsMod.constants?.R_OK ?? fs.constants.R_OK);
  }
  if (typeof fsMod.opendirSync === "function") {
    const handle = fsMod.opendirSync(root);
    try {
      handle.readSync();
    } finally {
      handle.closeSync();
    }
    return;
  }
  fsMod.readdirSync(root, { withFileTypes: true });
}

function inspectRoots(roots, opts = {}) {
  const fsMod = opts.fs || fs;
  const optionalMissingRoots = opts.optionalMissingRoots === true;
  const canonicalRoots = canonicalizeRoots(roots, fsMod);
  const readableRoots = [];
  let missingCount = 0;
  let unreadableCount = 0;
  let invalidCount = 0;

  for (const root of canonicalRoots) {
    if (opts.signal?.aborted) {
      throw createScanStopError(
        "ABORT_ERR",
        "local-files: root inspection aborted",
        "AbortError",
      );
    }
    try {
      probeDirectory(root, fsMod);
      readableRoots.push(root);
    } catch (error) {
      if (error?.code === "ENOENT") {
        missingCount += 1;
      } else if (error?.code === "ENOTDIR") {
        invalidCount += 1;
      } else {
        unreadableCount += 1;
      }
    }
  }

  return {
    roots: canonicalRoots,
    readableRoots,
    missingCount,
    unreadableCount,
    invalidCount,
    complete:
      unreadableCount === 0 &&
      invalidCount === 0 &&
      (optionalMissingRoots || missingCount === 0),
  };
}

function shouldSkip(name, excludes) {
  if (typeof name !== "string" || !name || name.startsWith(".")) return true;
  const normalized = process.platform === "win32" ? name.toLowerCase() : name;
  return excludes.some((entry) => {
    const candidate =
      process.platform === "win32"
        ? String(entry).toLowerCase()
        : String(entry);
    return normalized === candidate;
  });
}

function boundedExcludes(value) {
  if (!Array.isArray(value)) return DEFAULT_EXCLUDES;
  if (value.length > HARD_MAX_EXCLUDES) {
    const error = new Error(
      `local-files: exclude count must not exceed ${HARD_MAX_EXCLUDES}`,
    );
    error.code = "LOCAL_FILES_EXCLUDE_LIMIT";
    throw error;
  }
  let totalBytes = 0;
  const excludes = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.includes("\0")) {
      const error = new Error("local-files: excludes must not contain NUL");
      error.code = "LOCAL_FILES_EXCLUDE_INVALID";
      throw error;
    }
    totalBytes += Buffer.byteLength(entry, "utf8");
    if (totalBytes > HARD_MAX_EXCLUDE_BYTES) {
      const error = new Error("local-files: excludes are too large");
      error.code = "LOCAL_FILES_EXCLUDE_LIMIT";
      throw error;
    }
    excludes.push(entry);
  }
  return excludes;
}

function positiveBounded(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, maximum);
}

function readDirectoryBounded(fsMod, directory, maxEntries, assertActive) {
  let entries = [];
  let complete = true;
  if (typeof fsMod.opendirSync === "function") {
    const handle = fsMod.opendirSync(directory);
    try {
      for (;;) {
        if (assertActive) assertActive();
        const entry = handle.readSync();
        if (!entry) break;
        if (entries.length >= maxEntries) {
          complete = false;
          break;
        }
        entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
  } else {
    const all = fsMod.readdirSync(directory, { withFileTypes: true });
    if (assertActive) assertActive();
    complete = all.length <= maxEntries;
    entries = all.slice(0, maxEntries);
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  return { entries, complete };
}

function statFingerprint(stat) {
  if (!stat) return "";
  return [
    Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : 0,
    Number.isFinite(stat.ctimeMs) ? Math.floor(stat.ctimeMs) : 0,
    Number.isFinite(stat.size) ? stat.size : 0,
  ].join(":");
}

function safeRelativePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.split(path.sep).join("/");
}

function rootCategory(root) {
  const label = path.basename(root).normalize("NFKC").toLowerCase();
  const known = new Map([
    ["documents", "documents"],
    ["desktop", "desktop"],
    ["downloads", "downloads"],
    ["pictures", "pictures"],
    ["videos", "videos"],
    ["music", "music"],
  ]);
  return known.get(label) || "selected";
}

function recordMetadataBytes(record) {
  return (
    128 +
    Buffer.byteLength(record.relativePath, "utf8") +
    Buffer.byteLength(record.name, "utf8")
  );
}

function scanRoot(root, opts = {}) {
  const fsMod = opts.fs || fs;
  const excludes = boundedExcludes(opts.excludes);
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const maxScanMs = positiveBounded(
    opts.maxScanMs,
    DEFAULT_MAX_SCAN_MS,
    HARD_MAX_SCAN_MS,
  );
  const deadlineMs = Number.isFinite(opts.deadlineMs)
    ? opts.deadlineMs
    : now() + maxScanMs;
  const maxDepth = positiveBounded(
    opts.maxDepth,
    DEFAULT_MAX_DEPTH,
    HARD_MAX_DEPTH,
  );
  const maxFiles = positiveBounded(
    opts.maxFiles,
    DEFAULT_MAX_FILES_PER_ROOT,
    HARD_MAX_FILES + 1,
  );
  const maxDirectories = positiveBounded(
    opts.maxDirectories,
    HARD_MAX_DIRECTORIES,
    HARD_MAX_DIRECTORIES,
  );
  const maxEntries = positiveBounded(
    opts.maxEntries,
    HARD_MAX_ENTRIES,
    HARD_MAX_ENTRIES,
  );
  const maxEntriesPerDirectory = positiveBounded(
    opts.maxEntriesPerDirectory,
    HARD_MAX_ENTRIES_PER_DIRECTORY,
    HARD_MAX_ENTRIES_PER_DIRECTORY,
  );
  const maxMetadataBytes = positiveBounded(
    opts.maxMetadataBytes,
    HARD_MAX_METADATA_BYTES,
    HARD_MAX_METADATA_BYTES,
  );
  const records = [];
  const issues = new Set();
  const pending = [{ directory: root, depth: 0 }];
  let visitedDirectories = 0;
  let visitedEntries = 0;
  let metadataBytes = 0;

  while (pending.length > 0 && records.length < maxFiles) {
    assertScanActive(opts, deadlineMs, now);
    if (visitedDirectories >= maxDirectories) {
      issues.add("DIRECTORY_LIMIT");
      break;
    }
    if (visitedEntries >= maxEntries) {
      issues.add("ENTRY_LIMIT");
      break;
    }
    const { directory, depth } = pending.pop();
    visitedDirectories += 1;

    let before;
    let realPathBefore;
    let listing;
    try {
      const inspected = inspectStablePath(root, directory, fsMod);
      if (inspected.skippedSymlink || inspected.issue) {
        issues.add(inspected.issue || "DIRECTORY_CHANGED");
        continue;
      }
      before = inspected.stat;
      realPathBefore = inspected.realPath;
      if (!before.isDirectory()) {
        issues.add("DIRECTORY_CHANGED");
        continue;
      }
      listing = readDirectoryBounded(
        fsMod,
        directory,
        Math.min(maxEntriesPerDirectory, maxEntries - visitedEntries),
        () => assertScanActive(opts, deadlineMs, now),
      );
      visitedEntries += listing.entries.length;
      assertScanActive(opts, deadlineMs, now);
    } catch (error) {
      if (isScanStopError(error)) throw error;
      issues.add("READ_FAILED");
      continue;
    }
    if (!listing.complete) issues.add("ENTRY_LIMIT");

    const childDirectories = [];
    const directoryRecords = [];
    let directoryMetadataBytes = 0;
    for (const entry of listing.entries) {
      assertScanActive(opts, deadlineMs, now);
      if (shouldSkip(entry.name, excludes)) continue;
      const absolutePath = path.join(directory, entry.name);
      let inspected;
      try {
        inspected = inspectStablePath(root, absolutePath, fsMod);
      } catch {
        issues.add("STAT_FAILED");
        continue;
      }
      if (inspected.skippedSymlink) continue;
      if (inspected.issue) {
        issues.add(inspected.issue);
        continue;
      }
      const stat = inspected.stat;
      if (stat.isDirectory()) {
        if (depth >= maxDepth) {
          issues.add("DEPTH_LIMIT");
        } else {
          childDirectories.push({
            directory: absolutePath,
            depth: depth + 1,
          });
        }
        continue;
      }
      if (!stat.isFile()) continue;
      if (records.length + directoryRecords.length >= maxFiles) {
        issues.add("FILE_LIMIT");
        break;
      }
      const relativePath = safeRelativePath(root, absolutePath);
      if (!relativePath) {
        issues.add("PATH_ESCAPE");
        continue;
      }
      const record = {
        relativePath,
        name: entry.name,
        extension: path.extname(entry.name).toLowerCase().replace(/^\./u, ""),
        size: Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : 0,
        mtimeMs:
          Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0
            ? Math.floor(stat.mtimeMs)
            : 1,
        relativeDepth: relativePath.split("/").length - 1,
        rootCategory: rootCategory(root),
      };
      const nextMetadataBytes = recordMetadataBytes(record);
      if (
        metadataBytes + directoryMetadataBytes + nextMetadataBytes >
        maxMetadataBytes
      ) {
        issues.add("BYTE_LIMIT");
        break;
      }
      directoryRecords.push(record);
      directoryMetadataBytes += nextMetadataBytes;
    }

    let directoryStable = true;
    try {
      const inspected = inspectStablePath(root, directory, fsMod);
      if (
        inspected.skippedSymlink ||
        inspected.issue ||
        !inspected.stat?.isDirectory() ||
        normalizedForCompare(realPathBefore) !==
          normalizedForCompare(inspected.realPath) ||
        statFingerprint(before) !== statFingerprint(inspected.stat)
      ) {
        issues.add("DIRECTORY_CHANGED");
        directoryStable = false;
      }
    } catch {
      issues.add("DIRECTORY_CHANGED");
      directoryStable = false;
    }

    if (!directoryStable) continue;
    records.push(...directoryRecords);
    metadataBytes += directoryMetadataBytes;
    if (issues.has("BYTE_LIMIT")) {
      pending.length = 0;
      continue;
    }
    childDirectories.sort((left, right) =>
      compareText(left.directory, right.directory),
    );
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      pending.push(childDirectories[index]);
    }
  }

  if (pending.length > 0 && records.length >= maxFiles) {
    issues.add("FILE_LIMIT");
  }
  return {
    records,
    complete: issues.size === 0,
    issues: [...issues].sort(compareText),
    visitedDirectories,
    visitedEntries,
    metadataBytes,
  };
}

function scanRoots(roots, opts = {}) {
  const fsMod = opts.fs || fs;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const maxScanMs = positiveBounded(
    opts.maxScanMs,
    DEFAULT_MAX_SCAN_MS,
    HARD_MAX_SCAN_MS,
  );
  const deadlineMs = Number.isFinite(opts.deadlineMs)
    ? opts.deadlineMs
    : now() + maxScanMs;
  const canonicalRoots = canonicalizeRoots(roots, fsMod);
  const maxRecords = positiveBounded(
    opts.maxRecords,
    DEFAULT_MAX_FILES_PER_ROOT,
    HARD_MAX_FILES,
  );
  const probeLimit = Math.min(maxRecords + 1, HARD_MAX_FILES + 1);
  const maxFilesPerRoot = positiveBounded(
    opts.maxFilesPerRoot,
    probeLimit,
    HARD_MAX_FILES + 1,
  );
  const maxDirectories = positiveBounded(
    opts.maxDirectories,
    HARD_MAX_DIRECTORIES,
    HARD_MAX_DIRECTORIES,
  );
  const maxEntries = positiveBounded(
    opts.maxEntries,
    HARD_MAX_ENTRIES,
    HARD_MAX_ENTRIES,
  );
  const maxMetadataBytes = positiveBounded(
    opts.maxMetadataBytes,
    HARD_MAX_METADATA_BYTES,
    HARD_MAX_METADATA_BYTES,
  );
  const records = [];
  const issues = new Set();
  const seenPhysicalPaths = new Set();
  let scannedRoots = 0;
  let visitedDirectories = 0;
  let visitedEntries = 0;
  let metadataBytes = 0;

  for (let rootIndex = 0; rootIndex < canonicalRoots.length; rootIndex += 1) {
    assertScanActive(opts, deadlineMs, now);
    if (records.length >= probeLimit) {
      issues.add("FILE_LIMIT");
      break;
    }
    if (visitedDirectories >= maxDirectories) {
      issues.add("DIRECTORY_LIMIT");
      break;
    }
    if (visitedEntries >= maxEntries) {
      issues.add("ENTRY_LIMIT");
      break;
    }
    if (metadataBytes >= maxMetadataBytes) {
      issues.add("BYTE_LIMIT");
      break;
    }
    const root = canonicalRoots[rootIndex];
    const result = scanRoot(root, {
      ...opts,
      fs: fsMod,
      now,
      deadlineMs,
      maxFiles: Math.min(maxFilesPerRoot, probeLimit - records.length),
      maxDirectories: maxDirectories - visitedDirectories,
      maxEntries: maxEntries - visitedEntries,
      maxMetadataBytes: maxMetadataBytes - metadataBytes,
    });
    scannedRoots += 1;
    visitedDirectories += result.visitedDirectories;
    visitedEntries += result.visitedEntries;
    metadataBytes += result.metadataBytes;
    for (const issue of result.issues) issues.add(issue);
    for (const record of result.records) {
      const physicalPath = path.resolve(
        root,
        ...record.relativePath.split("/"),
      );
      const physicalKey = normalizedForCompare(physicalPath);
      if (seenPhysicalPaths.has(physicalKey)) continue;
      seenPhysicalPaths.add(physicalKey);
      records.push({ ...record, root, rootIndex });
    }
    if (!result.complete) issues.add("ROOT_INCOMPLETE");
  }
  if (records.length > maxRecords) {
    issues.add("FILE_LIMIT");
  }

  const explicitSince =
    opts.since != null && Number.isFinite(Number(opts.since))
      ? Math.max(0, Math.floor(Number(opts.since)))
      : 0;
  const visible = records
    .slice(0, maxRecords)
    .filter((record) => explicitSince === 0 || record.mtimeMs >= explicitSince);
  return {
    records: visible,
    complete: issues.size === 0,
    issues: [...issues].sort(compareText),
    scannedRoots,
    visitedDirectories,
    visitedEntries,
    metadataBytes,
  };
}

function* walkRoot(root, opts = {}) {
  const result = scanRoot(root, {
    ...opts,
    maxFiles: opts.maxFilesPerRoot,
  });
  yield* result.records;
}

function* walkRoots(roots, opts = {}) {
  yield* scanRoots(roots, {
    ...opts,
    maxRecords: opts.maxRecords || opts.maxFilesPerRoot,
  }).records;
}

module.exports = {
  DEFAULT_EXCLUDES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILES_PER_ROOT,
  HARD_MAX_DEPTH,
  HARD_MAX_DIRECTORIES,
  HARD_MAX_ENTRIES,
  HARD_MAX_ENTRIES_PER_DIRECTORY,
  HARD_MAX_FILES,
  HARD_MAX_METADATA_BYTES,
  HARD_MAX_ROOTS,
  canonicalizeRoots,
  defaultRoots,
  inspectRoots,
  rootCategory,
  scanRoot,
  scanRoots,
  walkRoot,
  walkRoots,
};
