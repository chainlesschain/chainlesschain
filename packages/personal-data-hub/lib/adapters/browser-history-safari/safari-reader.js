"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseBplist } = require("../../mobile-extractor/bplist");

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const MAX_BOOKMARKS_BYTES = 64 * 1024 * 1024;
const MAX_BOOKMARK_NODES = 500_000;
const MAX_DOWNLOADS_BYTES = 64 * 1024 * 1024;
const MAX_DOWNLOAD_RECORDS = 500_000;

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
      // Try the next native ABI.
    }
  }
  throw new Error(
    "safari-reader: no compatible better-sqlite3 implementation is available",
  );
}

function safariSecondsToEpochMs(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(APPLE_EPOCH_MS + seconds * 1000);
}

function epochMsToSafariSeconds(value) {
  const epochMs = Number(value);
  if (!Number.isFinite(epochMs)) return null;
  return (epochMs - APPLE_EPOCH_MS) / 1000;
}

function normalizeSafariProfilePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  const basename = path.basename(resolved).toLowerCase();
  return basename === "history.db" ||
    basename === "bookmarks.plist" ||
    basename === "downloads.plist"
    ? path.dirname(resolved)
    : resolved;
}

function isSafariProfile(profileDir, fsMod = fs) {
  if (typeof profileDir !== "string" || profileDir.length === 0) return false;
  try {
    return fsMod.statSync(path.join(profileDir, "History.db")).isFile();
  } catch {
    return false;
  }
}

function defaultSafariRoots(opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== "darwin") return [];
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  return [
    path.join(home, "Library", "Safari"),
    path.join(
      home,
      "Library",
      "Containers",
      "com.apple.Safari",
      "Data",
      "Library",
      "Safari",
    ),
  ];
}

function findSafariProfiles(opts = {}) {
  const fsMod = opts.fs || fs;
  const platform = opts.platform || process.platform;
  const roots = Array.isArray(opts.roots)
    ? opts.roots
    : defaultSafariRoots(opts);
  const profiles = [];
  const seen = new Set();

  const add = (candidate) => {
    if (!isSafariProfile(candidate, fsMod)) return;
    const resolved = path.resolve(candidate);
    const key = platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    profiles.push(resolved);
  };

  for (const configuredRoot of roots) {
    if (typeof configuredRoot !== "string" || configuredRoot.length === 0) {
      continue;
    }
    const root = path.resolve(configuredRoot);
    add(root);

    // Safari 17+ stores non-default profile histories below the sandboxed
    // Safari/Profiles directory.
    const profileRoots = [path.join(root, "Profiles")];
    if (path.basename(root) === "Profiles") profileRoots.unshift(root);
    for (const profilesRoot of profileRoots) {
      let entries;
      try {
        entries = fsMod
          .readdirSync(profilesRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        continue;
      }
      for (const entry of entries) {
        add(path.join(profilesRoot, entry.name));
      }
    }
  }
  return profiles;
}

function defaultSafariProfileDir(opts = {}) {
  return findSafariProfiles(opts)[0] || null;
}

function copySafariHistorySnapshot(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const source = path.join(profileDir, "History.db");
  const tempDir = fsMod.mkdtempSync(path.join(os.tmpdir(), "pdh-safari-"));
  const dbPath = path.join(tempDir, "History.db");
  try {
    fsMod.copyFileSync(source, dbPath);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        if (fsMod.existsSync(source + suffix)) {
          fsMod.copyFileSync(source + suffix, dbPath + suffix);
        }
      } catch {
        // A sidecar can rotate while Safari is running. Equality replay on
        // the next sync covers rows that did not reach this snapshot.
      }
    }
    return { dbPath, tempDir };
  } catch (error) {
    try {
      fsMod.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Preserve the original source error.
    }
    throw error;
  }
}

function cleanupSafariHistorySnapshot(snapshot, opts = {}) {
  const fsMod = opts.fs || fs;
  if (!snapshot?.tempDir) return;
  try {
    fsMod.rmSync(snapshot.tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function tableColumns(db, tableName) {
  try {
    return new Set(
      db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .map((row) => row.name),
    );
  } catch {
    return new Set();
  }
}

function requireColumns(columns, tableName, required) {
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length === 0) return;
  const error = new Error(
    `Safari History schema is missing ${tableName}.${missing.join(",")}`,
  );
  error.code = "SAFARI_SCHEMA_MISMATCH";
  throw error;
}

function optionalColumn(columns, expression, alias, fallback = "NULL") {
  const columnName = expression.split(".").at(-1);
  return columns.has(columnName)
    ? `${expression} AS ${alias}`
    : `${fallback} AS ${alias}`;
}

function readSafariVisitsPage(dbPath, opts = {}) {
  const since = Number.isFinite(Number(opts.since)) ? Number(opts.since) : 0;
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5000;
  const Database = loadDatabase();
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const itemColumns = tableColumns(db, "history_items");
    const visitColumns = tableColumns(db, "history_visits");
    requireColumns(itemColumns, "history_items", ["id", "url"]);
    requireColumns(visitColumns, "history_visits", [
      "id",
      "history_item",
      "visit_time",
    ]);

    const probeLimit =
      limit < Number.MAX_SAFE_INTEGER ? limit + 1 : Number.MAX_SAFE_INTEGER;
    const columns = [
      "v.id AS visit_id",
      "v.history_item AS history_item_id",
      "v.visit_time AS visit_time",
      "i.url AS url",
      optionalColumn(visitColumns, "v.title", "title", "''"),
      optionalColumn(itemColumns, "i.visit_count", "visit_count", "0"),
      optionalColumn(
        visitColumns,
        "v.load_successful",
        "load_successful",
        "NULL",
      ),
      optionalColumn(visitColumns, "v.http_non_get", "http_non_get", "NULL"),
    ];
    const rows = db
      .prepare(
        `SELECT ${columns.join(", ")}
           FROM history_visits v
           JOIN history_items i ON v.history_item = i.id
          WHERE v.visit_time >= ?
          ORDER BY v.visit_time ASC, v.id ASC
          LIMIT ?`,
      )
      .all(epochMsToSafariSeconds(since), probeLimit);
    const complete = rows.length <= limit;
    if (!complete) rows.length = limit;
    return {
      visits: rows
        .map((row) => ({
          visitId: row.visit_id,
          historyItemId: row.history_item_id,
          url: typeof row.url === "string" ? row.url : "",
          title: typeof row.title === "string" ? row.title : "",
          visitTimeMs: safariSecondsToEpochMs(row.visit_time),
          visitCount: Number.isInteger(row.visit_count) ? row.visit_count : 0,
          loadSuccessful:
            row.load_successful == null
              ? null
              : Number(row.load_successful) !== 0,
          httpNonGet:
            row.http_non_get == null ? null : Number(row.http_non_get) !== 0,
        }))
        .filter(
          (visit) =>
            visit.url.length > 0 && Number.isInteger(visit.visitTimeMs),
        ),
      complete,
    };
  } finally {
    db.close();
  }
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_match, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function parseXmlPlist(input) {
  const xml = String(input || "");
  if (/<!ENTITY/iu.test(xml)) {
    throw new Error("Safari XML plist contains unsupported entities");
  }
  const tokens = xml.match(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<[^>]+>|[^<]+/gu,
  );
  if (!tokens) throw new Error("Safari XML plist is empty");
  let index = 0;
  let objectCount = 0;

  const ignorable = (token) =>
    token == null ||
    /^\s*$/u.test(token) ||
    /^<\?/u.test(token) ||
    /^<!--/u.test(token) ||
    /^<!DOCTYPE/iu.test(token);
  const peek = () => {
    while (index < tokens.length && ignorable(tokens[index])) index += 1;
    return tokens[index];
  };
  const consume = () => {
    const token = peek();
    index += 1;
    return token;
  };
  const expect = (pattern, label) => {
    const token = consume();
    if (!pattern.test(token || "")) {
      throw new Error(`Safari XML plist expected ${label}`);
    }
    return token;
  };
  const readTextElement = (tag) => {
    expect(new RegExp(`^<${tag}>$`, "u"), `<${tag}>`);
    let text = "";
    while (
      index < tokens.length &&
      !new RegExp(`^</${tag}>$`, "u").test(tokens[index])
    ) {
      const token = tokens[index++];
      if (/^</u.test(token)) {
        throw new Error(`Safari XML plist has nested <${tag}> content`);
      }
      text += token;
    }
    expect(new RegExp(`^</${tag}>$`, "u"), `</${tag}>`);
    return decodeXmlEntities(text);
  };

  const parseValue = (depth = 0) => {
    if (depth > 128) throw new Error("Safari XML plist nesting is too deep");
    objectCount += 1;
    if (objectCount > MAX_BOOKMARK_NODES * 8) {
      throw new Error("Safari XML plist contains too many objects");
    }
    const token = peek();
    if (/^<dict\s*\/>$/u.test(token)) {
      consume();
      return {};
    }
    if (/^<array\s*\/>$/u.test(token)) {
      consume();
      return [];
    }
    if (/^<string\s*\/>$/u.test(token)) {
      consume();
      return "";
    }
    if (/^<data\s*\/>$/u.test(token)) {
      consume();
      return Buffer.alloc(0);
    }
    if (/^<dict>$/u.test(token)) {
      consume();
      const result = {};
      while (!/^<\/dict>$/u.test(peek() || "")) {
        const key = readTextElement("key");
        result[key] = parseValue(depth + 1);
      }
      consume();
      return result;
    }
    if (/^<array>$/u.test(token)) {
      consume();
      const result = [];
      while (!/^<\/array>$/u.test(peek() || "")) {
        result.push(parseValue(depth + 1));
      }
      consume();
      return result;
    }
    if (/^<string>$/u.test(token)) return readTextElement("string");
    if (/^<date>$/u.test(token)) {
      const parsed = new Date(readTextElement("date"));
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Safari XML plist contains an invalid date");
      }
      return parsed;
    }
    if (/^<integer>$/u.test(token)) {
      const parsed = Number(readTextElement("integer"));
      if (!Number.isSafeInteger(parsed)) {
        throw new Error("Safari XML plist contains an invalid integer");
      }
      return parsed;
    }
    if (/^<real>$/u.test(token)) {
      const parsed = Number(readTextElement("real"));
      if (!Number.isFinite(parsed)) {
        throw new Error("Safari XML plist contains an invalid real");
      }
      return parsed;
    }
    if (/^<data>$/u.test(token)) {
      return Buffer.from(
        readTextElement("data").replace(/\s+/gu, ""),
        "base64",
      );
    }
    if (/^<true\s*\/>$/u.test(token)) {
      consume();
      return true;
    }
    if (/^<false\s*\/>$/u.test(token)) {
      consume();
      return false;
    }
    throw new Error("Safari XML plist contains an unsupported value");
  };

  expect(/^<plist(?:\s[^>]*)?>$/u, "<plist>");
  const result = parseValue();
  expect(/^<\/plist>$/u, "</plist>");
  if (peek() !== undefined) {
    throw new Error("Safari XML plist contains trailing content");
  }
  return result;
}

function parseSafariBookmarksBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("Safari Bookmarks parser requires a Buffer");
  }
  return buffer.subarray(0, 8).toString("ascii") === "bplist00"
    ? parseBplist(buffer)
    : parseXmlPlist(buffer.toString("utf8"));
}

function parseBookmarkTime(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1_000_000_000_000) return Math.floor(value);
    return safariSecondsToEpochMs(value);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return parseBookmarkTime(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.split("\0").join("").trim().slice(0, maxLength);
}

function nonNegativeSafeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function sanitizeDownloadUrl(value) {
  const raw = boundedString(value, 32_768);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return boundedString(parsed.toString(), 20_000) || null;
  } catch {
    return null;
  }
}

function portableBasename(value) {
  const candidates = [
    path.win32.basename(value),
    path.posix.basename(value),
  ].filter(
    (candidate) => candidate && candidate !== "." && candidate !== path.sep,
  );
  if (candidates.length === 0) return "";
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return boundedString(candidates[0], 512);
}

function fileNameFromUrl(value) {
  if (!value) return "";
  try {
    const encodedName = portableBasename(new URL(value).pathname);
    if (!encodedName) return "";
    try {
      return boundedString(decodeURIComponent(encodedName), 512);
    } catch {
      return encodedName;
    }
  } catch {
    return "";
  }
}

function sanitizeDownloadTarget(value) {
  const raw = boundedString(value, 32_768);
  if (!raw) {
    return { fileName: "", fileExtension: "", targetPathHash: null };
  }
  let pathValue = raw;
  let pathLike = /[\\/]/u.test(raw);
  if (/^file:/iu.test(raw)) {
    pathLike = true;
    try {
      pathValue = decodeURIComponent(new URL(raw).pathname);
    } catch {
      // Keep the original value for a safe basename fallback.
    }
  }
  const fileName = portableBasename(pathValue);
  return {
    fileName,
    fileExtension: boundedString(
      path.extname(fileName).slice(1).toLowerCase(),
      64,
    ),
    targetPathHash: pathLike
      ? crypto.createHash("sha256").update(raw, "utf8").digest("hex")
      : null,
  };
}

function downloadErrorCode(value) {
  if (value == null || value === "") return null;
  if (Number.isSafeInteger(Number(value))) return Number(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of [
    "code",
    "Code",
    "errorCode",
    "ErrorCode",
    "NSURLErrorKey",
  ]) {
    if (Number.isSafeInteger(Number(value[key]))) return Number(value[key]);
  }
  return null;
}

function safariDownloadState({
  receivedBytes,
  totalBytes,
  endTimeMs,
  errorCode,
}) {
  if (Number.isInteger(errorCode)) {
    return errorCode === -999 ? "cancelled" : "failed";
  }
  if (
    Number.isInteger(endTimeMs) ||
    (Number.isSafeInteger(receivedBytes) &&
      Number.isSafeInteger(totalBytes) &&
      totalBytes > 0 &&
      receivedBytes >= totalBytes)
  ) {
    return "complete";
  }
  return "in-progress";
}

function readSafariDownloadsPage(plistPath, opts = {}) {
  const fsMod = opts.fs || fs;
  const since = Number.isFinite(Number(opts.since)) ? Number(opts.since) : 0;
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5000;
  const stat = fsMod.statSync(plistPath);
  if (!stat.isFile()) {
    const error = new Error("Safari Downloads source is not a file");
    error.code = "SAFARI_DOWNLOADS_NOT_FOUND";
    throw error;
  }
  if (stat.size > MAX_DOWNLOADS_BYTES) {
    const error = new Error("Safari Downloads source exceeds the 64 MiB limit");
    error.code = "SAFARI_DOWNLOADS_TOO_LARGE";
    throw error;
  }

  const root = parseSafariBookmarksBuffer(fsMod.readFileSync(plistPath));
  const entries = Array.isArray(root)
    ? root
    : Array.isArray(root?.DownloadHistory)
      ? root.DownloadHistory
      : [];
  if (entries.length > MAX_DOWNLOAD_RECORDS) {
    const error = new Error("Safari Downloads contains too many records");
    error.code = "SAFARI_DOWNLOADS_LIMIT_EXCEEDED";
    throw error;
  }

  const fileCapturedAt = Math.floor(stat.mtimeMs);
  const downloads = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const sourceUrl = sanitizeDownloadUrl(entry.DownloadEntryURL);
    const target = sanitizeDownloadTarget(entry.DownloadEntryPath);
    const fileName =
      target.fileName || fileNameFromUrl(sourceUrl) || "(unnamed download)";
    const startTimeMs = parseBookmarkTime(entry.DownloadEntryDateAddedKey);
    const endTimeMs = parseBookmarkTime(entry.DownloadEntryDateFinishedKey);
    const capturedAtMs =
      Math.max(startTimeMs || 0, endTimeMs || 0) || fileCapturedAt;
    if (capturedAtMs < since) continue;
    const receivedBytes = nonNegativeSafeInteger(
      entry.DownloadEntryProgressBytesSoFar,
    );
    const totalBytes = nonNegativeSafeInteger(
      entry.DownloadEntryProgressTotalToLoad,
    );
    const rawErrorCode = downloadErrorCode(
      entry.DownloadEntryErrorCodeDictionaryKey,
    );

    const rawIdentifier = boundedString(entry.DownloadEntryIdentifier, 160);
    const downloadId = /^[A-Za-z0-9._-]{1,160}$/u.test(rawIdentifier)
      ? rawIdentifier
      : crypto
          .createHash("sha256")
          .update(
            rawIdentifier ||
              `${sourceUrl || ""}\0${fileName}\0${startTimeMs || index}`,
          )
          .digest("hex")
          .slice(0, 24);
    downloads.push({
      downloadId,
      fileName,
      fileExtension:
        target.fileExtension ||
        boundedString(path.extname(fileName).slice(1).toLowerCase(), 64),
      targetPathHash: target.targetPathHash,
      sourceUrl,
      startTimeMs,
      endTimeMs,
      capturedAtMs,
      receivedBytes,
      totalBytes,
      state: safariDownloadState({
        receivedBytes,
        totalBytes,
        endTimeMs,
        errorCode: rawErrorCode,
      }),
      rawErrorCode,
      removeWhenDone: entry.DownloadEntryRemoveWhenDoneKey === true,
    });
  }
  downloads.sort(
    (a, b) =>
      a.capturedAtMs - b.capturedAtMs ||
      String(a.downloadId).localeCompare(String(b.downloadId)),
  );
  const complete = downloads.length <= limit;
  if (!complete) downloads.length = limit;
  return { downloads, complete };
}

function bookmarkTimes(node) {
  const readingList =
    node?.ReadingList && typeof node.ReadingList === "object"
      ? node.ReadingList
      : {};
  const dateAddedMs =
    parseBookmarkTime(node?.DateAdded) ||
    parseBookmarkTime(node?.dateAdded) ||
    parseBookmarkTime(readingList.DateAdded);
  const dateLastViewedMs =
    parseBookmarkTime(node?.DateLastViewed) ||
    parseBookmarkTime(readingList.DateLastViewed);
  return { dateAddedMs, dateLastViewedMs };
}

function readSafariBookmarksPage(plistPath, opts = {}) {
  const fsMod = opts.fs || fs;
  const since = Number.isFinite(Number(opts.since)) ? Number(opts.since) : 0;
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5000;
  const stat = fsMod.statSync(plistPath);
  if (!stat.isFile()) {
    const error = new Error("Safari Bookmarks source is not a file");
    error.code = "SAFARI_BOOKMARKS_NOT_FOUND";
    throw error;
  }
  if (stat.size > MAX_BOOKMARKS_BYTES) {
    const error = new Error("Safari Bookmarks source exceeds the 64 MiB limit");
    error.code = "SAFARI_BOOKMARKS_TOO_LARGE";
    throw error;
  }
  const root = parseSafariBookmarksBuffer(fsMod.readFileSync(plistPath));
  const fileCapturedAt = Math.floor(stat.mtimeMs);
  const bookmarks = [];
  let visitedNodes = 0;

  const walk = (node, parentFolders = [], depth = 0) => {
    if (!node || typeof node !== "object") return;
    if (depth > 128) {
      const error = new Error("Safari Bookmarks tree nesting is too deep");
      error.code = "SAFARI_BOOKMARKS_LIMIT_EXCEEDED";
      throw error;
    }
    visitedNodes += 1;
    if (visitedNodes > MAX_BOOKMARK_NODES) {
      const error = new Error("Safari Bookmarks tree contains too many nodes");
      error.code = "SAFARI_BOOKMARKS_LIMIT_EXCEEDED";
      throw error;
    }

    const url = typeof node.URLString === "string" ? node.URLString.trim() : "";
    if (url) {
      const { dateAddedMs, dateLastViewedMs } = bookmarkTimes(node);
      const capturedAt = Math.max(
        fileCapturedAt,
        dateAddedMs || 0,
        dateLastViewedMs || 0,
      );
      if (capturedAt >= since) {
        const uriTitle =
          node.URIDictionary &&
          typeof node.URIDictionary === "object" &&
          typeof node.URIDictionary.title === "string"
            ? node.URIDictionary.title
            : "";
        bookmarks.push({
          bookmarkId:
            node.WebBookmarkUUID || node.UUID || node.WebBookmarkIdentifier,
          guid: node.WebBookmarkUUID || node.UUID || null,
          url,
          name:
            uriTitle ||
            (typeof node.Title === "string" ? node.Title : "") ||
            url,
          dateAddedMs,
          dateLastViewedMs,
          dateLastUsedMs: dateLastViewedMs,
          folderPath:
            parentFolders.length > 0 ? parentFolders.join(" / ") : null,
          readingList:
            !!node.ReadingList || node.WebBookmarkIdentifier === "ReadingList",
          capturedAt,
        });
      }
    }

    if (!Array.isArray(node.Children)) return;
    const title =
      typeof node.Title === "string" && node.Title.trim()
        ? node.Title.trim()
        : null;
    const nextFolders = title ? [...parentFolders, title] : parentFolders;
    for (const child of node.Children) walk(child, nextFolders, depth + 1);
  };
  walk(root);
  bookmarks.sort(
    (a, b) =>
      a.capturedAt - b.capturedAt ||
      String(a.bookmarkId || a.url).localeCompare(
        String(b.bookmarkId || b.url),
      ),
  );
  const complete = bookmarks.length <= limit;
  if (!complete) bookmarks.length = limit;
  return { bookmarks, complete };
}

function findSafariBookmarksPath(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const candidates = [];
  if (typeof opts.bookmarksPath === "string" && opts.bookmarksPath.trim()) {
    candidates.push(path.resolve(opts.bookmarksPath.trim()));
  }
  candidates.push(path.join(profileDir, "Bookmarks.plist"));
  if (path.basename(path.dirname(profileDir)) === "Profiles") {
    candidates.push(
      path.join(path.dirname(path.dirname(profileDir)), "Bookmarks.plist"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (fsMod.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next shared/profile-local candidate.
    }
  }
  return null;
}

function findSafariDownloadsPath(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const candidates = [];
  if (typeof opts.downloadsPath === "string" && opts.downloadsPath.trim()) {
    candidates.push(path.resolve(opts.downloadsPath.trim()));
  }
  candidates.push(path.join(profileDir, "Downloads.plist"));
  if (path.basename(path.dirname(profileDir)) === "Profiles") {
    candidates.push(
      path.join(path.dirname(path.dirname(profileDir)), "Downloads.plist"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (fsMod.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next shared/profile-local candidate.
    }
  }
  return null;
}

module.exports = {
  APPLE_EPOCH_MS,
  MAX_BOOKMARKS_BYTES,
  MAX_DOWNLOADS_BYTES,
  cleanupSafariHistorySnapshot,
  copySafariHistorySnapshot,
  defaultSafariProfileDir,
  defaultSafariRoots,
  epochMsToSafariSeconds,
  findSafariBookmarksPath,
  findSafariDownloadsPath,
  findSafariProfiles,
  isSafariProfile,
  normalizeSafariProfilePath,
  parseSafariBookmarksBuffer,
  parseXmlPlist,
  readSafariBookmarksPage,
  readSafariDownloadsPage,
  readSafariVisitsPage,
  safariDownloadState,
  safariSecondsToEpochMs,
  sanitizeDownloadTarget,
  sanitizeDownloadUrl,
};
