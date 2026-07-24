"use strict";

// Read desktop-local VS Code activity without requiring an extension or network
// access. Only metadata manifests are read for Local History; the adjacent
// version files contain source content and must never be opened by this reader.
//
// Official format source:
// https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/common/workingCopyHistoryService.ts

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MAX_WORKSPACES = 100_000;
const DEFAULT_MAX_HISTORY_DIRECTORIES = 100_000;
const DEFAULT_MAX_HISTORY_ENTRIES = 1_000_000;
const DEFAULT_MAX_TERMINAL_ENTRIES = 100_000;
const MAX_WORKSPACE_MANIFEST_BYTES = 1024 * 1024;
const MAX_HISTORY_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_TERMINAL_JSON_BYTES = 8 * 1024 * 1024;
const MAX_STATE_DB_BYTES = 256 * 1024 * 1024;

// Dual-load: better-sqlite3-multiple-ciphers tracks Electron's native ABI,
// while better-sqlite3 tracks the Node test ABI. Loading must remain lazy so
// an unavailable native module cannot crash the Electron main process.
let cachedDatabaseClass = null;
function loadDatabase() {
  if (cachedDatabaseClass) return cachedDatabaseClass;
  for (const moduleName of [
    "better-sqlite3-multiple-ciphers",
    "better-sqlite3",
  ]) {
    let Database;
    try {
      Database = require(moduleName);
    } catch {
      continue;
    }
    try {
      const probe = new Database(":memory:");
      probe.close();
      cachedDatabaseClass = Database;
      return Database;
    } catch {
      // Native ABI mismatch: try the other package.
    }
  }
  throw new Error(
    "vscode-reader: no compatible better-sqlite3 implementation is available",
  );
}

function defaultVscodeRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, "Code") : null;
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code");
  }
  return path.join(os.homedir(), ".config", "Code");
}

function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function boundedText(value, maxLength = 255) {
  if (typeof value !== "string") return "";
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Decode a file:// URI into a platform path. This public helper remains for
// callers that explicitly need a path, but adapter records never archive the
// returned absolute value.
function decodeFileUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  const raw = uri.slice("file://".length);
  let decoded = safeDecode(raw);
  if (process.platform === "win32") {
    if (decoded.startsWith("/")) decoded = decoded.slice(1);
    return decoded.replace(/\//gu, "\\");
  }
  return decoded;
}

function resourceMetadata(resource, { workspace = false } = {}) {
  const raw = typeof resource === "string" ? resource.trim() : "";
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/iu.exec(raw);
  const resourceScheme = schemeMatch
    ? schemeMatch[1].toLowerCase().slice(0, 64)
    : "unknown";

  let resourcePath = raw;
  try {
    resourcePath = new URL(raw).pathname || raw;
  } catch {
    const separator = raw.indexOf(":");
    if (separator >= 0) resourcePath = raw.slice(separator + 1);
  }
  const normalizedPath = safeDecode(resourcePath)
    .replace(/\\/gu, "/")
    .replace(/\/+$/gu, "");
  let name = boundedText(path.posix.basename(normalizedPath), 255);
  if (workspace && name.toLowerCase().endsWith(".code-workspace")) {
    name = name.slice(0, -".code-workspace".length);
  }
  const fileExtension = workspace
    ? ""
    : boundedText(path.posix.extname(name).toLowerCase(), 32);

  return {
    name: name || (workspace ? "(unnamed workspace)" : "(unnamed file)"),
    fileExtension,
    resourceScheme,
    resourceHash: sha256Hex(raw),
  };
}

function localPathMetadata(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw.replace(/\\/gu, "/").replace(/\/+$/gu, "");
  const name = boundedText(path.posix.basename(normalized), 255);
  return {
    name: name || "(unknown directory)",
    pathHash: sha256Hex(raw),
  };
}

function readWorkspaces(vscodeRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const workspaceRoot = path.join(vscodeRoot, "User", "workspaceStorage");
  if (!fsMod.existsSync(workspaceRoot)) {
    return { workspaces: [], complete: true };
  }

  const since = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxWorkspaces = positiveInteger(
    opts.maxWorkspaces,
    DEFAULT_MAX_WORKSPACES,
  );
  let directoryNames;
  try {
    directoryNames = fsMod.readdirSync(workspaceRoot).sort();
  } catch {
    return { workspaces: [], complete: false };
  }

  let complete = true;
  if (directoryNames.length > maxWorkspaces) {
    directoryNames.length = maxWorkspaces;
    complete = false;
  }

  const workspaces = [];
  for (const directoryName of directoryNames) {
    const manifestPath = path.join(
      workspaceRoot,
      directoryName,
      "workspace.json",
    );
    if (!fsMod.existsSync(manifestPath)) continue;

    let stat;
    let manifest;
    try {
      stat = fsMod.statSync(manifestPath);
      if (!stat.isFile() || stat.size > MAX_WORKSPACE_MANIFEST_BYTES) {
        complete = false;
        continue;
      }
      manifest = JSON.parse(fsMod.readFileSync(manifestPath, "utf8"));
    } catch {
      complete = false;
      continue;
    }

    const lastOpenedMs = Math.floor(stat.mtimeMs);
    if (since > 0 && lastOpenedMs < since) continue;
    const resource =
      typeof manifest?.folder === "string"
        ? manifest.folder
        : typeof manifest?.workspace === "string"
          ? manifest.workspace
          : null;
    if (!resource) continue;

    const metadata = resourceMetadata(resource, { workspace: true });
    workspaces.push({
      workspaceId: sha256Hex(directoryName),
      name: metadata.name,
      resourceScheme: metadata.resourceScheme,
      resourceHash: metadata.resourceHash,
      lastOpenedMs,
    });
  }

  workspaces.sort(
    (a, b) =>
      a.lastOpenedMs - b.lastOpenedMs ||
      a.workspaceId.localeCompare(b.workspaceId),
  );
  if (workspaces.length > limit) {
    workspaces.length = limit;
    complete = false;
  }
  return { workspaces, complete };
}

function readTerminalHistory(vscodeRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const sourcePath = path.join(
    vscodeRoot,
    "User",
    "globalStorage",
    "state.vscdb",
  );
  if (!fsMod.existsSync(sourcePath)) {
    return {
      commands: [],
      dirs: [],
      commandsTimestampMs: null,
      dirsTimestampMs: null,
      databaseMtimeMs: null,
      complete: true,
    };
  }

  const sourceStat = fsMod.statSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size > MAX_STATE_DB_BYTES) {
    return {
      commands: [],
      dirs: [],
      commandsTimestampMs: null,
      dirsTimestampMs: null,
      databaseMtimeMs: Math.floor(sourceStat.mtimeMs),
      complete: false,
    };
  }

  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxEntries = positiveInteger(
    opts.maxTerminalEntries,
    DEFAULT_MAX_TERMINAL_ENTRIES,
  );
  const tempDirectory = fsMod.mkdtempSync(
    path.join(os.tmpdir(), "pdh-vscode-"),
  );
  const snapshotPath = path.join(tempDirectory, "state.vscdb");
  fsMod.copyFileSync(sourcePath, snapshotPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = sourcePath + suffix;
    if (!fsMod.existsSync(sidecar)) continue;
    try {
      fsMod.copyFileSync(sidecar, snapshotPath + suffix);
    } catch {
      // The main database snapshot can still be read without an optional
      // sidecar; a missing concurrent update will be retried next sync.
    }
  }

  let db = null;
  let complete = true;
  try {
    const Database = loadDatabase();
    db = new Database(snapshotPath, { readonly: true });
    const getValue = (key) => {
      try {
        const row = db
          .prepare("SELECT value FROM ItemTable WHERE key = ?")
          .get(key);
        return row ? row.value : null;
      } catch {
        complete = false;
        return null;
      }
    };

    const parseEntries = (rawValue, kind) => {
      if (rawValue == null) return [];
      const text = Buffer.isBuffer(rawValue)
        ? rawValue.toString("utf8")
        : String(rawValue);
      if (Buffer.byteLength(text, "utf8") > MAX_TERMINAL_JSON_BYTES) {
        complete = false;
        return [];
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        complete = false;
        return [];
      }
      const sourceEntries = Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];
      const boundedEntries = sourceEntries.slice(0, maxEntries);
      if (boundedEntries.length < sourceEntries.length) complete = false;
      const records = [];
      for (
        let sourceIndex = 0;
        sourceIndex < boundedEntries.length;
        sourceIndex++
      ) {
        const entry = boundedEntries[sourceIndex];
        const value = typeof entry?.key === "string" ? entry.key : "";
        if (!value) continue;
        const shellType = boundedText(entry?.value?.shellType, 64) || null;
        if (kind === "command") {
          records.push({ value, shellType, sourceIndex });
        } else {
          records.push({
            ...localPathMetadata(value),
            shellType,
            sourceIndex,
          });
        }
      }
      if (records.length > limit) {
        records.length = limit;
        complete = false;
      }
      return records;
    };

    const parseTimestamp = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0
        ? Math.floor(numeric)
        : null;
    };

    return {
      commands: parseEntries(
        getValue("terminal.history.entries.commands"),
        "command",
      ),
      dirs: parseEntries(getValue("terminal.history.entries.dirs"), "dir"),
      commandsTimestampMs: parseTimestamp(
        getValue("terminal.history.timestamp.commands"),
      ),
      dirsTimestampMs: parseTimestamp(
        getValue("terminal.history.timestamp.dirs"),
      ),
      databaseMtimeMs: Math.floor(sourceStat.mtimeMs),
      complete,
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close of the private read-only snapshot.
    }
    // tempDirectory was created by mkdtempSync immediately above and contains
    // only this reader's database snapshot.
    try {
      fsMod.rmSync(tempDirectory, { recursive: true, force: true });
    } catch {
      // A stale private temp snapshot can be removed by the OS later.
    }
  }
}

function readLocalHistory(vscodeRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const historyRoot = path.join(vscodeRoot, "User", "History");
  if (!fsMod.existsSync(historyRoot)) {
    return { entries: [], complete: true };
  }

  const since = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxDirectories = positiveInteger(
    opts.maxHistoryDirectories,
    DEFAULT_MAX_HISTORY_DIRECTORIES,
  );
  const maxEntries = positiveInteger(
    opts.maxHistoryEntries,
    DEFAULT_MAX_HISTORY_ENTRIES,
  );
  let directoryNames;
  try {
    directoryNames = fsMod.readdirSync(historyRoot).sort();
  } catch {
    return { entries: [], complete: false };
  }

  let complete = true;
  if (directoryNames.length > maxDirectories) {
    directoryNames.length = maxDirectories;
    complete = false;
  }

  const entries = [];
  let inspectedEntries = 0;
  for (const directoryName of directoryNames) {
    const manifestPath = path.join(historyRoot, directoryName, "entries.json");
    if (!fsMod.existsSync(manifestPath)) continue;

    let manifest;
    try {
      const stat = fsMod.statSync(manifestPath);
      if (!stat.isFile() || stat.size > MAX_HISTORY_MANIFEST_BYTES) {
        complete = false;
        continue;
      }
      manifest = JSON.parse(fsMod.readFileSync(manifestPath, "utf8"));
    } catch {
      complete = false;
      continue;
    }

    if (
      typeof manifest?.resource !== "string" ||
      !Array.isArray(manifest?.entries)
    ) {
      complete = false;
      continue;
    }
    const metadata = resourceMetadata(manifest.resource);
    const historyId = sha256Hex(directoryName);
    for (const entry of manifest.entries) {
      inspectedEntries += 1;
      if (inspectedEntries > maxEntries) {
        complete = false;
        break;
      }
      const savedAtMs = Number(entry?.timestamp);
      if (
        typeof entry?.id !== "string" ||
        entry.id.length === 0 ||
        entry.id.length > 1024 ||
        !Number.isFinite(savedAtMs) ||
        savedAtMs <= 0
      ) {
        complete = false;
        continue;
      }
      const timestamp = Math.floor(savedAtMs);
      if (since > 0 && timestamp < since) continue;
      entries.push({
        historyId,
        entryIdHash: sha256Hex(`${directoryName}\0${entry.id}`),
        fileName: metadata.name,
        fileExtension: metadata.fileExtension,
        resourceScheme: metadata.resourceScheme,
        resourceHash: metadata.resourceHash,
        savedAtMs: timestamp,
        hasSaveSource:
          typeof entry.source === "string" && entry.source.length > 0,
      });
    }
    if (inspectedEntries > maxEntries) break;
  }

  entries.sort(
    (a, b) =>
      a.savedAtMs - b.savedAtMs ||
      a.resourceHash.localeCompare(b.resourceHash) ||
      a.entryIdHash.localeCompare(b.entryIdHash),
  );
  if (entries.length > limit) {
    entries.length = limit;
    complete = false;
  }
  return { entries, complete };
}

module.exports = {
  defaultVscodeRoot,
  decodeFileUri,
  resourceMetadata,
  readWorkspaces,
  readTerminalHistory,
  readLocalHistory,
};
