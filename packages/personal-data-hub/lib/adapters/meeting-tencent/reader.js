"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HISTORY_TABLES = Object.freeze([
  "historical_meetings",
  "historical_meetings_cloud_cache",
  "historical_meetings_new",
]);
const TABLE_SCORES = Object.freeze({
  historical_meetings: 1,
  historical_meetings_cloud_cache: 4,
  historical_meetings_new: 2,
});
const MEETING_COLUMNS = Object.freeze([
  "meeting_id",
  "period_id",
  "meeting_subject",
  "meeting_begin_time",
  "meeting_end_time",
  "meeting_join_time",
  "meeting_leave_time",
  "meeting_total_elapsed_time",
  "creator_nickname",
  "creator_app_uid",
  "meeting_type",
  "media_set_type",
  "meeting_description",
  "activity_name",
  "activity_sponsor_name",
  "meeting_remark",
  "meeting_docs_name",
  "meeting_docs_num",
  "record_num",
  "record_duration",
  "record_ai_summarize",
  "chat_num",
  "participants_json",
  "participants_count",
  "has_ai_summary",
  "ai_summary_num",
  "record_status",
  "record_permission",
]);
const MAX_DATABASE_FILES = 256;
const DEFAULT_MAX_PARTICIPANTS = 1000;
const MAX_MAX_PARTICIPANTS = 10_000;
const MAX_PARTICIPANTS_JSON_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200_000;
const PARTICIPANT_COLUMNS = new Set([
  "creator_nickname",
  "creator_app_uid",
  "participants_json",
  "participants_count",
]);
const ARTIFACT_COLUMNS = new Set([
  "meeting_docs_name",
  "meeting_docs_num",
  "record_num",
  "record_duration",
  "record_ai_summarize",
  "chat_num",
  "has_ai_summary",
  "ai_summary_num",
  "record_status",
  "record_permission",
]);

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
    "meeting-tencent reader: no compatible better-sqlite3 implementation is available",
  );
}

function defaultTencentMeetingRoot(opts = {}) {
  const platform = opts.platform || process.platform;
  const home = typeof opts.homedir === "string" ? opts.homedir : os.homedir();
  if (platform === "win32") {
    const appData = opts.appData || process.env.APPDATA;
    return appData ? path.join(appData, "Tencent", "WeMeet") : null;
  }
  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Containers",
      "com.tencent.meeting",
      "Data",
      "Library",
    );
  }
  return null;
}

function normalizeSourcePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return path.resolve(value.trim());
}

function isPermissionError(error) {
  return error?.code === "EACCES" || error?.code === "EPERM";
}

function tableNames(db) {
  return new Set(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => row.name),
  );
}

function inspectHistoryDatabase(dbPath) {
  const Database = loadDatabase();
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const names = tableNames(db);
    const tables = HISTORY_TABLES.filter((table) => names.has(table));
    return {
      dbPath,
      tables,
      score: tables.reduce(
        (total, table) => total + (TABLE_SCORES[table] || 0),
        0,
      ),
      validSqlite: true,
    };
  } catch (error) {
    if (isPermissionError(error)) throw error;
    return {
      dbPath,
      tables: [],
      score: 0,
      validSqlite: false,
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Read-only probe cleanup only.
    }
  }
}

function candidateDatabaseDirs(rootPath) {
  return [
    path.join(rootPath, "Global", "Database"),
    path.join(rootPath, "Database"),
    path.join(rootPath, "Data", "Library", "Global", "Database"),
    path.join(rootPath, "Caches", "Storage", "Database"),
    path.join(rootPath, "Storage", "Database"),
  ];
}

function findTencentMeetingHistoryDb(inputPath, opts = {}) {
  const fsMod = opts.fs || fs;
  const normalized = normalizeSourcePath(inputPath);
  if (!normalized) return null;

  let stat;
  try {
    stat = fsMod.statSync(normalized);
  } catch (error) {
    if (isPermissionError(error)) throw error;
    return null;
  }
  if (stat.isFile()) {
    const inspected = inspectHistoryDatabase(normalized);
    return inspected.score > 0
      ? { ...inspected, scopePath: normalized }
      : { ...inspected, scopePath: normalized, schemaMismatch: true };
  }
  if (!stat.isDirectory()) return null;

  const candidates = [];
  const seen = new Set();
  for (const databaseDir of candidateDatabaseDirs(normalized)) {
    let entries;
    try {
      entries = fsMod
        .readdirSync(databaseDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.db$/iu.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, MAX_DATABASE_FILES);
    } catch (error) {
      if (isPermissionError(error)) throw error;
      continue;
    }
    for (const entry of entries) {
      const dbPath = path.join(databaseDir, entry.name);
      const key = process.platform === "win32" ? dbPath.toLowerCase() : dbPath;
      if (seen.has(key)) continue;
      seen.add(key);
      const inspected = inspectHistoryDatabase(dbPath);
      if (inspected.score <= 0) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = Math.floor(fsMod.statSync(dbPath).mtimeMs);
      } catch {
        // A disappearing candidate will fail cleanly during snapshot copy.
      }
      candidates.push({
        ...inspected,
        scopePath: normalized,
        mtimeMs,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.mtimeMs - a.mtimeMs ||
      a.dbPath.localeCompare(b.dbPath),
  );
  return candidates[0] || null;
}

function copyTencentMeetingSnapshot(dbPath, opts = {}) {
  const fsMod = opts.fs || fs;
  const sourceMtimeMs = Math.floor(fsMod.statSync(dbPath).mtimeMs);
  const tempDir = fsMod.mkdtempSync(
    path.join(os.tmpdir(), "pdh-tencent-meeting-"),
  );
  const snapshotPath = path.join(tempDir, "meeting-history.db");
  try {
    fsMod.copyFileSync(dbPath, snapshotPath);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        if (fsMod.existsSync(dbPath + suffix)) {
          fsMod.copyFileSync(dbPath + suffix, snapshotPath + suffix);
        }
      } catch {
        // The app can rotate a sidecar while running. File-mtime replay causes
        // the affected history rows to be revisited on the next collection.
      }
    }
    return { dbPath: snapshotPath, tempDir, sourceMtimeMs };
  } catch (error) {
    try {
      fsMod.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Preserve the original copy failure.
    }
    throw error;
  }
}

function cleanupTencentMeetingSnapshot(snapshot, opts = {}) {
  const fsMod = opts.fs || fs;
  if (!snapshot?.tempDir) return;
  try {
    fsMod.rmSync(snapshot.tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function tableColumns(db, tableName) {
  return new Set(
    db
      .prepare(`PRAGMA table_info("${tableName}")`)
      .all()
      .map((row) => row.name),
  );
}

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") return null;
  const normalized = value.split("\0").join("").trim();
  if (!normalized) return null;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function unixTimeToMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number < 100_000_000_000) return Math.round(number * 1000);
  if (number < 100_000_000_000_000) return Math.round(number);
  if (number < 100_000_000_000_000_000) {
    return Math.round(number / 1000);
  }
  return null;
}

function parseParticipants(value, maxParticipants) {
  if (value === null || value === undefined) {
    return { participants: [], truncated: false, complete: true };
  }
  if (typeof value !== "string") {
    return { participants: [], truncated: false, complete: false };
  }
  if (Buffer.byteLength(value, "utf8") > MAX_PARTICIPANTS_JSON_BYTES) {
    return { participants: [], truncated: true, complete: false };
  }
  if (value.trim().length === 0) {
    return { participants: [], truncated: false, complete: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { participants: [], truncated: false, complete: false };
  }
  if (!Array.isArray(parsed)) {
    return { participants: [], truncated: false, complete: false };
  }
  const participants = [];
  let truncated = parsed.length > maxParticipants;
  for (const entry of parsed.slice(0, maxParticipants)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      truncated = true;
      continue;
    }
    const rawDisplayName = safeText(entry.nick_name);
    const rawAppId = safeText(entry.app_id);
    const rawAppUid = safeText(entry.app_uid);
    if (
      (rawDisplayName?.length || 0) > 500 ||
      (rawAppId?.length || 0) > 500 ||
      (rawAppUid?.length || 0) > 1000
    ) {
      truncated = true;
    }
    const displayName = rawDisplayName?.slice(0, 500) || null;
    const appId = rawAppId?.slice(0, 500) || null;
    const appUid = rawAppUid?.slice(0, 1000) || null;
    if (!displayName && !appUid) {
      truncated = true;
      continue;
    }
    participants.push({ displayName, appId, appUid });
  }
  return {
    participants,
    truncated,
    complete: !truncated,
  };
}

function meaningful(value) {
  return value !== null && value !== undefined && value !== "";
}

function mergeMeetingRows(existing, incoming) {
  if (!existing) return { ...incoming };
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "participants") {
      if (Array.isArray(value) && value.length > 0) merged.participants = value;
      continue;
    }
    if (key === "participantsTruncated") {
      merged.participantsTruncated =
        existing.participantsTruncated === true || value === true;
      continue;
    }
    if (
      key === "participantCount" &&
      value === 0 &&
      Number(existing.participantCount) > 0
    ) {
      continue;
    }
    if (meaningful(value)) merged[key] = value;
  }
  return merged;
}

function normalizeMeetingRow(row, sourceMtimeMs, maxParticipants, opts = {}) {
  const includeParticipants = opts.includeParticipants !== false;
  const includeArtifacts = opts.includeArtifacts !== false;
  const meetingId = safeText(row.meeting_id, 2000);
  if (!meetingId) return null;
  const periodId = safeText(row.period_id, 2000) || "";
  const beginTimeMs = unixTimeToMs(row.meeting_begin_time);
  if (!beginTimeMs) return null;
  const endTimeMs = unixTimeToMs(row.meeting_end_time);
  const joinTimeMs = unixTimeToMs(row.meeting_join_time);
  const leaveTimeMs = unixTimeToMs(row.meeting_leave_time);
  const participantResult = includeParticipants
    ? parseParticipants(row.participants_json, maxParticipants)
    : null;
  const rawCreatorNickname = includeParticipants
    ? safeText(row.creator_nickname)
    : null;
  const rawCreatorAppUid = includeParticipants
    ? safeText(row.creator_app_uid)
    : null;
  const creatorTruncated =
    (rawCreatorNickname?.length || 0) > 1000 ||
    (rawCreatorAppUid?.length || 0) > 2000;
  const participantCount = includeParticipants
    ? parsePositiveInteger(row.participants_count)
    : null;
  const participantCountTruncated =
    includeParticipants &&
    participantCount !== null &&
    participantCount > participantResult.participants.length;
  const capturedAt = Math.max(
    sourceMtimeMs || 0,
    beginTimeMs,
    endTimeMs || 0,
    joinTimeMs || 0,
    leaveTimeMs || 0,
  );
  return {
    complete:
      !includeParticipants ||
      (participantResult.complete === true &&
        !creatorTruncated &&
        !participantCountTruncated),
    meeting: {
      meetingIdentity: `${meetingId}\0${periodId}`,
      meetingId,
      periodId,
      subject: safeText(row.meeting_subject, 10_000),
      beginTimeMs,
      endTimeMs,
      joinTimeMs,
      leaveTimeMs,
      elapsedSeconds: parsePositiveInteger(row.meeting_total_elapsed_time),
      meetingType: parsePositiveInteger(row.meeting_type),
      mediaSetType: parsePositiveInteger(row.media_set_type),
      description: safeText(row.meeting_description),
      activityName: safeText(row.activity_name, 10_000),
      activitySponsorName: safeText(row.activity_sponsor_name, 10_000),
      remark: safeText(row.meeting_remark),
      ...(includeParticipants
        ? {
            creatorNickname: rawCreatorNickname?.slice(0, 1000) || null,
            creatorAppUid: rawCreatorAppUid?.slice(0, 2000) || null,
            participants: participantResult.participants,
            participantsTruncated:
              participantResult.truncated ||
              creatorTruncated ||
              participantCountTruncated,
            participantCount,
          }
        : {}),
      ...(includeArtifacts
        ? {
            documentName: safeText(row.meeting_docs_name, 10_000),
            documentCount: parsePositiveInteger(row.meeting_docs_num),
            recordCount: parsePositiveInteger(row.record_num),
            recordDurationSeconds: parsePositiveInteger(row.record_duration),
            recordAiSummary: safeText(row.record_ai_summarize),
            chatCount: parsePositiveInteger(row.chat_num),
            hasAiSummary:
              row.has_ai_summary == null
                ? null
                : Number(row.has_ai_summary) !== 0,
            aiSummaryCount: parsePositiveInteger(row.ai_summary_num),
            recordStatus: parsePositiveInteger(row.record_status),
            recordPermission: parsePositiveInteger(row.record_permission),
          }
        : {}),
      capturedAt,
    },
  };
}

function readTencentMeetingHistory(dbPath, opts = {}) {
  const includeParticipants = opts.includeParticipants !== false;
  const includeArtifacts = opts.includeArtifacts !== false;
  const since = Number.isFinite(Number(opts.since))
    ? Math.max(0, Math.floor(Number(opts.since)))
    : 0;
  const limit =
    Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 10_000;
  const maxParticipantsCandidate =
    Number.isSafeInteger(opts.maxParticipants) && opts.maxParticipants > 0
      ? opts.maxParticipants
      : DEFAULT_MAX_PARTICIPANTS;
  const maxParticipants = Math.min(
    maxParticipantsCandidate,
    MAX_MAX_PARTICIPANTS,
  );
  const sourceMtimeMs = Number.isInteger(opts.sourceMtimeMs)
    ? opts.sourceMtimeMs
    : 0;
  const querySinceSeconds =
    sourceMtimeMs >= since ? 0 : Math.max(0, Math.floor(since / 1000));
  const Database = loadDatabase();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const availableTables = tableNames(db);
    const supportedTables = HISTORY_TABLES.filter((table) =>
      availableTables.has(table),
    );
    if (supportedTables.length === 0) {
      const error = new Error(
        "Tencent Meeting history schema does not contain a supported history table",
      );
      error.code = "MEETING_SCHEMA_MISMATCH";
      throw error;
    }

    const merged = new Map();
    let complete = true;
    for (const tableName of supportedTables) {
      const columns = tableColumns(db, tableName);
      if (!columns.has("meeting_id") || !columns.has("meeting_begin_time")) {
        const error = new Error(
          `Tencent Meeting history schema is missing required ${tableName} columns`,
        );
        error.code = "MEETING_SCHEMA_MISMATCH";
        throw error;
      }
      const selectedColumns = MEETING_COLUMNS.filter(
        (column) =>
          columns.has(column) &&
          (includeParticipants || !PARTICIPANT_COLUMNS.has(column)) &&
          (includeArtifacts || !ARTIFACT_COLUMNS.has(column)),
      );
      const orderTieBreaker = columns.has("id") ? '"id"' : '"meeting_id"';
      const probeLimit =
        limit < Number.MAX_SAFE_INTEGER ? limit + 1 : Number.MAX_SAFE_INTEGER;
      const rows = db
        .prepare(
          `SELECT ${selectedColumns.map((column) => `"${column}"`).join(", ")}
             FROM "${tableName}"
            WHERE "meeting_begin_time" >= ?
            ORDER BY "meeting_begin_time" ASC, ${orderTieBreaker} ASC
            LIMIT ?`,
        )
        .all(querySinceSeconds, probeLimit);
      if (rows.length > limit) {
        rows.length = limit;
        complete = false;
      }
      for (const row of rows) {
        const normalizedResult = normalizeMeetingRow(
          row,
          sourceMtimeMs,
          maxParticipants,
          { includeParticipants, includeArtifacts },
        );
        if (!normalizedResult) continue;
        if (!normalizedResult.complete) complete = false;
        const normalized = normalizedResult.meeting;
        merged.set(
          normalized.meetingIdentity,
          mergeMeetingRows(merged.get(normalized.meetingIdentity), normalized),
        );
      }
    }

    const meetings = [...merged.values()]
      .filter((meeting) => meeting.capturedAt >= since)
      .sort(
        (a, b) =>
          a.capturedAt - b.capturedAt ||
          a.beginTimeMs - b.beginTimeMs ||
          a.meetingIdentity.localeCompare(b.meetingIdentity),
      );
    if (meetings.length > limit) {
      meetings.length = limit;
      complete = false;
    }
    return { meetings, complete, tables: supportedTables };
  } finally {
    db.close();
  }
}

module.exports = {
  DEFAULT_MAX_PARTICIPANTS,
  HISTORY_TABLES,
  MAX_DATABASE_FILES,
  MAX_MAX_PARTICIPANTS,
  MAX_PARTICIPANTS_JSON_BYTES,
  cleanupTencentMeetingSnapshot,
  copyTencentMeetingSnapshot,
  defaultTencentMeetingRoot,
  findTencentMeetingHistoryDb,
  inspectHistoryDatabase,
  normalizeSourcePath,
  readTencentMeetingHistory,
  unixTimeToMs,
};
