"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
      // The JavaScript package can exist while its native binding targets a
      // different Node/Electron ABI. Try the other compatible package.
    }
  }
  throw new Error(
    "firefox-db-reader: no compatible SQLite runtime is available",
  );
}

function parseIni(text) {
  const sections = [];
  let current = null;
  for (const rawLine of String(text || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      current = { name: sectionMatch[1], values: {} };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    current.values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }
  return sections;
}

function defaultFirefoxRoots(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  if (platform === "win32") {
    const roots = [];
    if (env.APPDATA) {
      roots.push(path.join(env.APPDATA, "Mozilla", "Firefox"));
    }
    if (env.LOCALAPPDATA) {
      roots.push(
        path.join(
          env.LOCALAPPDATA,
          "Packages",
          "Mozilla.Firefox_n80bbvh6b1yt2",
          "LocalCache",
          "Roaming",
          "Mozilla",
          "Firefox",
        ),
      );
    }
    return roots;
  }
  if (platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "Firefox")];
  }
  return [
    path.join(home, ".mozilla", "firefox"),
    path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
    path.join(
      home,
      ".var",
      "app",
      "org.mozilla.firefox",
      ".mozilla",
      "firefox",
    ),
  ];
}

function isPlacesProfile(profileDir, fsMod) {
  if (typeof profileDir !== "string" || profileDir.length === 0) return false;
  try {
    return fsMod.statSync(path.join(profileDir, "places.sqlite")).isFile();
  } catch {
    return false;
  }
}

function resolveIniProfile(root, section) {
  const configuredPath = section?.values?.Path;
  if (!configuredPath) return null;
  if (section.values.IsRelative === "0" || path.isAbsolute(configuredPath)) {
    return path.resolve(configuredPath);
  }
  return path.resolve(root, configuredPath);
}

function findFirefoxProfiles(opts = {}) {
  const fsMod = opts.fs || fs;
  const roots = Array.isArray(opts.roots)
    ? opts.roots
    : defaultFirefoxRoots(opts);
  const found = [];
  const seen = new Set();

  const add = (candidate) => {
    if (!isPlacesProfile(candidate, fsMod)) return;
    const resolved = path.resolve(candidate);
    const key =
      (opts.platform || process.platform) === "win32"
        ? resolved.toLowerCase()
        : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(resolved);
  };

  for (const configuredRoot of roots) {
    if (typeof configuredRoot !== "string" || configuredRoot.length === 0) {
      continue;
    }
    const root = path.resolve(configuredRoot);
    let sections = [];
    try {
      sections = parseIni(
        fsMod.readFileSync(path.join(root, "profiles.ini"), "utf8"),
      );
    } catch {
      // A profile root may exist without profiles.ini after a manual copy.
    }

    // The install-specific Default entry points at the profile currently
    // selected by Firefox and is more precise than ProfileN.Default.
    for (const section of sections.filter((entry) =>
      entry.name.startsWith("Install"),
    )) {
      if (section.values.Default) {
        add(path.resolve(root, section.values.Default));
      }
    }
    for (const section of sections.filter(
      (entry) =>
        entry.name.startsWith("Profile") && entry.values.Default === "1",
    )) {
      add(resolveIniProfile(root, section));
    }
    for (const section of sections.filter((entry) =>
      entry.name.startsWith("Profile"),
    )) {
      add(resolveIniProfile(root, section));
    }

    const profilesDir = path.join(root, "Profiles");
    try {
      const entries = fsMod
        .readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => {
          const aDefault = /default-release|\.default$/iu.test(a.name) ? 0 : 1;
          const bDefault = /default-release|\.default$/iu.test(b.name) ? 0 : 1;
          return aDefault - bDefault || a.name.localeCompare(b.name);
        });
      for (const entry of entries) add(path.join(profilesDir, entry.name));
    } catch {
      // Missing fallback directory is a normal "Firefox not installed" case.
    }
  }
  return found;
}

function defaultFirefoxProfileDir(opts = {}) {
  return findFirefoxProfiles(opts)[0] || null;
}

function normalizeFirefoxProfilePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  return path.basename(resolved).toLowerCase() === "places.sqlite"
    ? path.dirname(resolved)
    : resolved;
}

function copyPlacesSnapshot(profileDir, opts = {}) {
  const fsMod = opts.fs || fs;
  const source = path.join(profileDir, "places.sqlite");
  if (!isPlacesProfile(profileDir, fsMod)) {
    const error = new Error("Firefox places.sqlite was not found");
    error.code = "FIREFOX_PLACES_NOT_FOUND";
    throw error;
  }
  const tempDir = fsMod.mkdtempSync(path.join(os.tmpdir(), "pdh-firefox-"));
  const dbPath = path.join(tempDir, "places.sqlite");
  try {
    fsMod.copyFileSync(source, dbPath);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        if (fsMod.existsSync(source + suffix)) {
          fsMod.copyFileSync(source + suffix, dbPath + suffix);
        }
      } catch {
        // A sidecar may rotate while Firefox is running. The copied main DB
        // remains a valid older snapshot and the next watermark overlap will
        // collect rows that were still in the live WAL.
      }
    }
    return { dbPath, tempDir };
  } catch (error) {
    try {
      fsMod.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Preserve the original copy failure.
    }
    throw error;
  }
}

function cleanupPlacesSnapshot(snapshot, opts = {}) {
  if (!snapshot?.tempDir) return;
  const fsMod = opts.fs || fs;
  try {
    fsMod.rmSync(snapshot.tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function tableColumns(db, table) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name),
  );
}

function assertColumns(actual, required, table) {
  const missing = required.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    const error = new Error(
      `unsupported Firefox Places schema: ${table} is missing ${missing.join(", ")}`,
    );
    error.code = "FIREFOX_SCHEMA_UNSUPPORTED";
    throw error;
  }
}

function optionalColumn(
  columns,
  columnName,
  qualifiedExpression,
  fallback,
  alias,
) {
  return columns.has(columnName)
    ? `${qualifiedExpression} AS ${alias}`
    : `${fallback} AS ${alias}`;
}

function prTimeUsToEpochMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric / 1000);
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.split("\0").join("").trim().slice(0, maxLength);
}

// Download URLs can contain credentials, signed query parameters and access
// tokens. Keep only the useful origin/path before a raw record can be archived.
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
      const parsed = new URL(raw);
      pathValue = decodeURIComponent(parsed.pathname);
    } catch {
      // The basename fallback still handles malformed legacy file URI values.
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

const DOWNLOAD_STATE_NAMES = Object.freeze({
  1: "complete",
  2: "failed",
  3: "cancelled",
  4: "paused",
  6: "blocked-parental-controls",
  8: "blocked-reputation-check",
});

function decodeDownloadState(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return DOWNLOAD_STATE_NAMES[numeric] || `unknown(${numeric})`;
}

function dateValueToEpochMs(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = Math.floor(numeric);
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  if (typeof value !== "string" || value.length > 128) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeSafeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function parseDownloadMetaData(value) {
  const raw = boundedString(value, 65_536);
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const rawState =
    parsed.state == null || parsed.state === "" ? NaN : Number(parsed.state);
  return {
    rawState: Number.isInteger(rawState) ? rawState : null,
    state: decodeDownloadState(rawState),
    deleted: parsed.deleted === true,
    endTimeMs: dateValueToEpochMs(parsed.endTime),
    fileSize: nonNegativeSafeInteger(parsed.fileSize),
    reputationCheckVerdict:
      boundedString(parsed.reputationCheckVerdict, 128) || null,
  };
}

const VISIT_TYPES = Object.freeze({
  1: "link",
  2: "typed",
  3: "bookmark",
  4: "embed",
  5: "redirect-permanent",
  6: "redirect-temporary",
  7: "download",
  8: "framed-link",
  9: "reload",
});

function decodeVisitType(value) {
  const numeric = Number(value);
  return (
    VISIT_TYPES[numeric] ||
    `unknown(${Number.isFinite(numeric) ? numeric : "?"})`
  );
}

const ROOT_GUID_LABELS = Object.freeze({
  root________: "Firefox",
  menu________: "书签菜单",
  toolbar_____: "书签工具栏",
  unfiled_____: "其他书签",
  mobile______: "移动设备书签",
  tags________: "标签",
});

function folderPathFor(parentId, folders) {
  const names = [];
  const visited = new Set();
  let currentId = parentId;
  while (currentId != null && !visited.has(currentId) && names.length < 64) {
    visited.add(currentId);
    const folder = folders.get(currentId);
    if (!folder) break;
    const label =
      ROOT_GUID_LABELS[folder.guid] ||
      (typeof folder.title === "string" && folder.title.trim()) ||
      null;
    if (label) names.unshift(label);
    currentId = folder.parent;
  }
  return names.join(" / ") || null;
}

function queryRows(statement, params, limit) {
  if (Number.isSafeInteger(limit)) {
    return statement.all(...params, limit + 1);
  }
  return statement.all(...params);
}

function readFirefoxData(dbPath, opts = {}) {
  const Database = loadDatabase();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const sinceMs =
    Number.isFinite(Number(opts.since)) && Number(opts.since) > 0
      ? Math.floor(Number(opts.since))
      : 0;
  const sinceUs = sinceMs * 1000;
  const finiteLimit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : null;
  const includeHistory = opts.includeHistory !== false;
  const includeBookmarks = opts.includeBookmarks !== false;
  const includeDownloads = opts.includeDownloads !== false;
  const includeHidden = opts.includeHidden === true;

  try {
    const places = tableColumns(db, "moz_places");
    const visits = tableColumns(db, "moz_historyvisits");
    assertColumns(places, ["id", "url"], "moz_places");
    assertColumns(
      visits,
      ["id", "place_id", "visit_date"],
      "moz_historyvisits",
    );

    let visitRows = [];
    let complete = true;
    let remaining = finiteLimit;
    if (includeHistory) {
      const visitLimitClause = Number.isSafeInteger(remaining) ? "LIMIT ?" : "";
      const visitSql = `
        SELECT v.id AS visit_id,
               v.place_id AS place_id,
               v.visit_date AS visit_date,
               ${optionalColumn(visits, "visit_type", "v.visit_type", "0", "visit_type")},
               ${optionalColumn(visits, "from_visit", "v.from_visit", "0", "from_visit")},
               p.url AS url,
               ${optionalColumn(places, "title", "p.title", "''", "title")},
               ${optionalColumn(places, "visit_count", "p.visit_count", "0", "visit_count")},
               ${optionalColumn(places, "typed", "p.typed", "0", "typed_count")},
               ${optionalColumn(places, "hidden", "p.hidden", "0", "hidden")},
               ${optionalColumn(places, "guid", "p.guid", "NULL", "place_guid")}
        FROM moz_historyvisits v
        JOIN moz_places p ON p.id = v.place_id
        WHERE v.visit_date >= ?
          ${visits.has("visit_type") ? "AND v.visit_type != 7" : ""}
          ${includeHidden || !places.has("hidden") ? "" : "AND p.hidden = 0"}
        ORDER BY v.visit_date ASC, v.id ASC
        ${visitLimitClause}`;
      const rows = queryRows(db.prepare(visitSql), [sinceUs], remaining);
      if (Number.isSafeInteger(remaining) && rows.length > remaining) {
        complete = false;
        rows.length = remaining;
      }
      visitRows = rows.map((row) => ({
        visitId: row.visit_id,
        placeId: row.place_id,
        placeGuid: row.place_guid || null,
        url: typeof row.url === "string" ? row.url : "",
        title: typeof row.title === "string" ? row.title : "",
        visitTimeMs: prTimeUsToEpochMs(row.visit_date),
        visitType: decodeVisitType(row.visit_type),
        rawVisitType: Number(row.visit_type) || 0,
        fromVisit: Number(row.from_visit) || 0,
        visitCount: Number(row.visit_count) || 0,
        typedCount: Number(row.typed_count) || 0,
        hidden: Number(row.hidden) === 1,
      }));
      if (Number.isSafeInteger(remaining)) remaining -= visitRows.length;
    }

    let bookmarkRows = [];
    if (includeBookmarks && complete) {
      const bookmarks = tableColumns(db, "moz_bookmarks");
      assertColumns(bookmarks, ["id", "type", "fk", "parent"], "moz_bookmarks");
      const folderSql = `
        SELECT id, parent,
               ${optionalColumn(bookmarks, "title", "title", "''", "title")},
               ${optionalColumn(bookmarks, "guid", "guid", "NULL", "guid")}
        FROM moz_bookmarks
        WHERE type = 2`;
      const folders = new Map(
        db
          .prepare(folderSql)
          .all()
          .map((row) => [
            row.id,
            {
              parent: row.parent,
              title: row.title,
              guid: row.guid,
            },
          ]),
      );
      const modifiedExpr = bookmarks.has("lastModified")
        ? "NULLIF(b.lastModified, 0)"
        : "NULL";
      const addedExpr = bookmarks.has("dateAdded")
        ? "NULLIF(b.dateAdded, 0)"
        : "NULL";
      const bookmarkTimeExpr = `COALESCE(${modifiedExpr}, ${addedExpr}, 0)`;
      const bookmarkLimitClause = Number.isSafeInteger(remaining)
        ? "LIMIT ?"
        : "";
      const bookmarkSql = `
        SELECT b.id AS bookmark_id,
               b.parent AS parent_id,
               ${optionalColumn(bookmarks, "title", "b.title", "''", "bookmark_title")},
               ${optionalColumn(bookmarks, "dateAdded", "b.dateAdded", "0", "date_added")},
               ${optionalColumn(bookmarks, "lastModified", "b.lastModified", "0", "last_modified")},
               ${optionalColumn(bookmarks, "guid", "b.guid", "NULL", "bookmark_guid")},
               p.id AS place_id,
               p.url AS url,
               ${optionalColumn(places, "title", "p.title", "''", "place_title")},
               ${optionalColumn(places, "guid", "p.guid", "NULL", "place_guid")}
        FROM moz_bookmarks b
        JOIN moz_places p ON p.id = b.fk
        WHERE b.type = 1
          AND b.fk IS NOT NULL
          AND ${bookmarkTimeExpr} >= ?
        ORDER BY ${bookmarkTimeExpr} ASC, b.id ASC
        ${bookmarkLimitClause}`;
      const rows = queryRows(db.prepare(bookmarkSql), [sinceUs], remaining);
      if (Number.isSafeInteger(remaining) && rows.length > remaining) {
        complete = false;
        rows.length = remaining;
      }
      bookmarkRows = rows.map((row) => ({
        bookmarkId: row.bookmark_id,
        guid: row.bookmark_guid || null,
        placeId: row.place_id,
        placeGuid: row.place_guid || null,
        url: typeof row.url === "string" ? row.url : "",
        name:
          (typeof row.bookmark_title === "string" &&
            row.bookmark_title.trim()) ||
          (typeof row.place_title === "string" && row.place_title.trim()) ||
          (typeof row.url === "string" ? row.url : ""),
        dateAddedMs: prTimeUsToEpochMs(row.date_added),
        lastModifiedMs: prTimeUsToEpochMs(row.last_modified),
        folderPath: folderPathFor(row.parent_id, folders),
      }));
      if (Number.isSafeInteger(remaining)) remaining -= bookmarkRows.length;
    } else if (includeBookmarks && Number.isSafeInteger(remaining)) {
      complete = false;
    }

    let downloadRows = [];
    if (includeDownloads && complete) {
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name),
      );
      const hasDownloadVisits = visits.has("visit_type");
      const annoColumns = tables.has("moz_annos")
        ? tableColumns(db, "moz_annos")
        : new Set();
      const annoAttributeColumns = tables.has("moz_anno_attributes")
        ? tableColumns(db, "moz_anno_attributes")
        : new Set();
      const hasDownloadAnnotations =
        annoColumns.has("place_id") &&
        annoColumns.has("anno_attribute_id") &&
        annoColumns.has("content") &&
        annoAttributeColumns.has("id") &&
        annoAttributeColumns.has("name");

      if (hasDownloadVisits) {
        const annotationTimeParts = [];
        if (annoColumns.has("lastModified")) {
          annotationTimeParts.push("COALESCE(a.lastModified, 0)");
        }
        if (annoColumns.has("dateAdded")) {
          annotationTimeParts.push("COALESCE(a.dateAdded, 0)");
        }
        const annotationTimeExpression =
          annotationTimeParts.length === 0
            ? "0"
            : annotationTimeParts.length === 1
              ? annotationTimeParts[0]
              : `MAX(${annotationTimeParts.join(", ")})`;
        const annotationCte = hasDownloadAnnotations
          ? `,
          download_annotations AS (
            SELECT a.place_id,
                   MAX(CASE WHEN aa.name = 'downloads/metaData'
                            THEN a.content END) AS metadata,
                   MAX(CASE WHEN aa.name = 'downloads/destinationFileURI'
                            THEN a.content END) AS destination_file_uri,
                   MAX(CASE WHEN aa.name = 'downloads/destinationFileName'
                            THEN a.content END) AS destination_file_name,
                   MAX(${annotationTimeExpression}) AS annotation_time
            FROM moz_annos a
            JOIN moz_anno_attributes aa ON aa.id = a.anno_attribute_id
            WHERE aa.name IN (
              'downloads/metaData',
              'downloads/destinationFileURI',
              'downloads/destinationFileName'
            )
            GROUP BY a.place_id
          )`
          : "";
        const annotationSelect = hasDownloadAnnotations
          ? `da.metadata AS metadata,
             da.destination_file_uri AS destination_file_uri,
             da.destination_file_name AS destination_file_name,
             COALESCE(da.annotation_time, 0) AS annotation_time`
          : `NULL AS metadata,
             NULL AS destination_file_uri,
             NULL AS destination_file_name,
             0 AS annotation_time`;
        const annotationJoin = hasDownloadAnnotations
          ? "LEFT JOIN download_annotations da ON da.place_id = p.id"
          : "";
        const capturedTimeExpression = hasDownloadAnnotations
          ? "MAX(dv.start_time, COALESCE(da.annotation_time, 0))"
          : "dv.start_time";
        const downloadLimitClause = Number.isSafeInteger(remaining)
          ? "LIMIT ?"
          : "";
        const downloadSql = `
          WITH latest_download_visits AS (
            SELECT place_id, MAX(visit_date) AS start_time
            FROM moz_historyvisits
            WHERE visit_type = 7
            GROUP BY place_id
          )
          ${annotationCte}
          SELECT p.id AS place_id,
                 ${optionalColumn(places, "guid", "p.guid", "NULL", "place_guid")},
                 p.url AS url,
                 dv.start_time AS start_time,
                 ${annotationSelect},
                 ${capturedTimeExpression} AS captured_time
          FROM latest_download_visits dv
          JOIN moz_places p ON p.id = dv.place_id
          ${annotationJoin}
          WHERE ${capturedTimeExpression} >= ?
          ORDER BY captured_time ASC, p.id ASC
          ${downloadLimitClause}`;
        const rows = queryRows(db.prepare(downloadSql), [sinceUs], remaining);
        if (Number.isSafeInteger(remaining) && rows.length > remaining) {
          complete = false;
          rows.length = remaining;
        }
        downloadRows = rows.map((row) => {
          const sourceUrl = sanitizeDownloadUrl(row.url);
          const uriTarget = sanitizeDownloadTarget(row.destination_file_uri);
          const nameTarget = sanitizeDownloadTarget(row.destination_file_name);
          const target = {
            fileName: nameTarget.fileName || uriTarget.fileName,
            fileExtension: nameTarget.fileExtension || uriTarget.fileExtension,
            targetPathHash:
              uriTarget.targetPathHash || nameTarget.targetPathHash,
          };
          const metaData = parseDownloadMetaData(row.metadata);
          const startTimeMs = prTimeUsToEpochMs(row.start_time);
          const annotationTimeMs = prTimeUsToEpochMs(row.annotation_time);
          const capturedAtMs = Math.max(
            startTimeMs || 0,
            annotationTimeMs || 0,
            metaData.endTimeMs || 0,
          );
          const fileName =
            target.fileName ||
            fileNameFromUrl(sourceUrl) ||
            "(unnamed download)";
          return {
            placeId: row.place_id,
            placeGuid: boundedString(row.place_guid, 128) || null,
            fileName,
            fileExtension:
              target.fileExtension ||
              boundedString(path.extname(fileName).slice(1).toLowerCase(), 64),
            targetPathHash: target.targetPathHash,
            sourceUrl,
            startTimeMs,
            endTimeMs: metaData.endTimeMs || null,
            capturedAtMs: capturedAtMs || startTimeMs,
            fileSize: metaData.fileSize ?? null,
            state: metaData.state || null,
            rawState: Number.isInteger(metaData.rawState)
              ? metaData.rawState
              : null,
            deleted: metaData.deleted === true,
            reputationCheckVerdict: metaData.reputationCheckVerdict || null,
          };
        });
      }
    } else if (includeDownloads && Number.isSafeInteger(remaining)) {
      complete = false;
    }

    return {
      visits: visitRows,
      bookmarks: bookmarkRows,
      downloads: downloadRows,
      complete,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  ROOT_GUID_LABELS,
  cleanupPlacesSnapshot,
  copyPlacesSnapshot,
  decodeDownloadState,
  decodeVisitType,
  defaultFirefoxProfileDir,
  defaultFirefoxRoots,
  findFirefoxProfiles,
  normalizeFirefoxProfilePath,
  parseIni,
  parseDownloadMetaData,
  prTimeUsToEpochMs,
  readFirefoxData,
  sanitizeDownloadTarget,
  sanitizeDownloadUrl,
};
