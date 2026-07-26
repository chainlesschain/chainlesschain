"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MAX_PROJECTS = 10_000;
const DEFAULT_MAX_AGENT_DIRECTORIES = 100_000;
const DEFAULT_MAX_TRANSCRIPT_FILES = 100_000;
const DEFAULT_MAX_TRANSCRIPT_RECORDS = 1_000_000;
const DEFAULT_MAX_TRACKING_ROWS = 100_000;
const DEFAULT_MAX_MESSAGE_CHARS = 1_000_000;
const DEFAULT_MAX_SUMMARY_CHARS = 1_000_000;
const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_TRANSCRIPT_LINE_BYTES = 2 * 1024 * 1024;
const MAX_TRACKING_DB_BYTES = 256 * 1024 * 1024;

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
    "cursor-reader: no compatible better-sqlite3 implementation is available",
  );
}

function defaultCursorRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData ? path.join(appData, "Cursor") : null;
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  }
  const configHome =
    typeof process.env.XDG_CONFIG_HOME === "string" &&
    process.env.XDG_CONFIG_HOME.trim()
      ? process.env.XDG_CONFIG_HOME.trim()
      : path.join(os.homedir(), ".config");
  return path.join(configHome, "Cursor");
}

function defaultCursorHome() {
  return path.join(os.homedir(), ".cursor");
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

function boundedContent(value, maxChars) {
  if (typeof value !== "string") return { value: "", truncated: false };
  const cleaned = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint > 31 && codePoint !== 127)
      );
    })
    .join("")
    .trim();
  return {
    value: cleaned.slice(0, maxChars),
    truncated: cleaned.length > maxChars,
  };
}

function boundedMetadata(value, maxChars = 255) {
  if (typeof value !== "string") return null;
  const bounded = boundedContent(value, maxChars).value.replace(
    /[\r\n\t]+/gu,
    " ",
  );
  return bounded || null;
}

function normalizeTimestamp(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (numeric >= 1e15) return Math.floor(numeric / 1000);
  if (numeric >= 1e12) return Math.floor(numeric);
  if (numeric >= 1e9) return Math.floor(numeric * 1000);
  return fallback;
}

function sortedDirectoryNames(directory, fsMod) {
  return fsMod
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

function inspectCursorLocalData(cursorHome, opts = {}) {
  const fsMod = opts.fs || fs;
  if (typeof cursorHome !== "string" || cursorHome.length === 0) {
    return {
      hasAgentTranscripts: false,
      hasAiTracking: false,
    };
  }
  return {
    hasAgentTranscripts: fsMod.existsSync(path.join(cursorHome, "projects")),
    hasAiTracking: fsMod.existsSync(
      path.join(cursorHome, "ai-tracking", "ai-code-tracking.db"),
    ),
  };
}

function readAgentTranscripts(cursorHome, opts = {}) {
  const fsMod = opts.fs || fs;
  const projectsRoot = path.join(cursorHome, "projects");
  if (!fsMod.existsSync(projectsRoot)) {
    return { messages: [], complete: true };
  }

  const since = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxProjects = positiveInteger(
    opts.maxProjects,
    Math.max(DEFAULT_MAX_PROJECTS, limit),
  );
  const maxAgentDirectories = positiveInteger(
    opts.maxAgentDirectories,
    Math.max(DEFAULT_MAX_AGENT_DIRECTORIES, limit),
  );
  const maxTranscriptFiles = positiveInteger(
    opts.maxTranscriptFiles,
    Math.max(DEFAULT_MAX_TRANSCRIPT_FILES, limit),
  );
  const maxTranscriptRecords = positiveInteger(
    opts.maxTranscriptRecords,
    Math.max(DEFAULT_MAX_TRANSCRIPT_RECORDS, limit),
  );
  const maxMessageChars = positiveInteger(
    opts.maxMessageChars,
    DEFAULT_MAX_MESSAGE_CHARS,
  );

  let complete = true;
  let projectNames;
  try {
    projectNames = sortedDirectoryNames(projectsRoot, fsMod);
  } catch {
    return { messages: [], complete: false };
  }
  if (projectNames.length > maxProjects) {
    projectNames.length = maxProjects;
    complete = false;
  }

  const messages = [];
  let inspectedAgentDirectories = 0;
  let inspectedFiles = 0;
  let inspectedRecords = 0;
  let stop = false;

  for (const projectName of projectNames) {
    const transcriptRoot = path.join(
      projectsRoot,
      projectName,
      "agent-transcripts",
    );
    if (!fsMod.existsSync(transcriptRoot)) continue;

    let agentNames;
    try {
      agentNames = sortedDirectoryNames(transcriptRoot, fsMod);
    } catch {
      complete = false;
      continue;
    }
    for (const agentName of agentNames) {
      inspectedAgentDirectories += 1;
      if (inspectedAgentDirectories > maxAgentDirectories) {
        complete = false;
        stop = true;
        break;
      }

      const agentDirectory = path.join(transcriptRoot, agentName);
      let transcriptNames;
      try {
        transcriptNames = fsMod
          .readdirSync(agentDirectory, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() &&
              !entry.isSymbolicLink() &&
              entry.name.toLowerCase().endsWith(".jsonl"),
          )
          .map((entry) => entry.name)
          .sort();
      } catch {
        complete = false;
        continue;
      }

      for (const transcriptName of transcriptNames) {
        inspectedFiles += 1;
        if (inspectedFiles > maxTranscriptFiles) {
          complete = false;
          stop = true;
          break;
        }

        const transcriptPath = path.join(agentDirectory, transcriptName);
        let stat;
        let text;
        try {
          stat = fsMod.statSync(transcriptPath);
          if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES) {
            complete = false;
            continue;
          }
          const snapshotTs = Math.floor(stat.mtimeMs);
          if (since > 0 && snapshotTs < since) continue;
          text = fsMod.readFileSync(transcriptPath, "utf8");
        } catch {
          complete = false;
          continue;
        }

        const snapshotTs = Math.floor(stat.mtimeMs);
        const projectHash = sha256Hex(projectName);
        const transcriptHash = sha256Hex(
          `${projectName}\0${agentName}\0${transcriptName}`,
        );
        const occurrences = new Map();
        const lines = text.split(/\r?\n/u);

        for (
          let sourceIndex = 0;
          sourceIndex < lines.length;
          sourceIndex += 1
        ) {
          const line = lines[sourceIndex];
          if (!line) continue;
          inspectedRecords += 1;
          if (inspectedRecords > maxTranscriptRecords) {
            complete = false;
            stop = true;
            break;
          }
          if (Buffer.byteLength(line, "utf8") > MAX_TRANSCRIPT_LINE_BYTES) {
            complete = false;
            continue;
          }

          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            complete = false;
            continue;
          }
          if (
            (parsed?.role !== "user" && parsed?.role !== "assistant") ||
            !Array.isArray(parsed?.message?.content)
          ) {
            continue;
          }

          const textParts = parsed.message.content
            .filter(
              (part) => part?.type === "text" && typeof part.text === "string",
            )
            .map((part) => part.text);
          if (textParts.length === 0) continue;
          const bounded = boundedContent(textParts.join("\n"), maxMessageChars);
          if (!bounded.value) continue;
          if (bounded.truncated) complete = false;

          const contentHash = sha256Hex(`${parsed.role}\0${bounded.value}`);
          const occurrence = occurrences.get(contentHash) || 0;
          occurrences.set(contentHash, occurrence + 1);
          messages.push({
            recordId: `${transcriptHash.slice(0, 24)}:${contentHash.slice(0, 24)}:${occurrence}`,
            capturedAt: snapshotTs,
            payload: {
              role: parsed.role,
              text: bounded.value,
              projectHash,
              transcriptHash,
              sourceIndex,
              contentPartCount: textParts.length,
              snapshotTs,
            },
          });
        }
        if (stop) break;
      }
      if (stop) break;
    }
    if (stop) break;
  }

  messages.sort(
    (a, b) =>
      a.capturedAt - b.capturedAt ||
      a.payload.transcriptHash.localeCompare(b.payload.transcriptHash) ||
      a.payload.sourceIndex - b.payload.sourceIndex ||
      a.recordId.localeCompare(b.recordId),
  );
  if (messages.length > limit) {
    messages.length = limit;
    complete = false;
  }
  return { messages, complete };
}

function copyTrackingSnapshot(dbPath, opts = {}) {
  const fsMod = opts.fs || fs;
  const stat = fsMod.statSync(dbPath);
  if (!stat.isFile() || stat.size > MAX_TRACKING_DB_BYTES) {
    const error = new Error("Cursor AI tracking database is too large");
    error.code = "CURSOR_TRACKING_DB_TOO_LARGE";
    throw error;
  }
  const tempDirectory = fsMod.mkdtempSync(
    path.join(os.tmpdir(), "pdh-cursor-"),
  );
  const snapshotPath = path.join(tempDirectory, "ai-code-tracking.db");
  fsMod.copyFileSync(dbPath, snapshotPath);
  for (const suffix of ["-wal", "-shm"]) {
    const source = dbPath + suffix;
    if (!fsMod.existsSync(source)) continue;
    try {
      fsMod.copyFileSync(source, snapshotPath + suffix);
    } catch {
      // A concurrent WAL update will be replayed on the next sync.
    }
  }
  return { tempDirectory, snapshotPath };
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

function columnOrNull(columns, name) {
  return columns.has(name) ? name : `NULL AS ${name}`;
}

function readAiTracking(cursorHome, opts = {}) {
  const fsMod = opts.fs || fs;
  const dbPath = path.join(cursorHome, "ai-tracking", "ai-code-tracking.db");
  if (!fsMod.existsSync(dbPath)) {
    return { summaries: [], aiCodeEvents: [], complete: true };
  }

  const since = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxRows = positiveInteger(
    opts.maxTrackingRows,
    Math.max(DEFAULT_MAX_TRACKING_ROWS, limit),
  );
  const probeRows = maxRows < Number.MAX_SAFE_INTEGER ? maxRows + 1 : maxRows;
  const maxSummaryChars = positiveInteger(
    opts.maxSummaryChars,
    DEFAULT_MAX_SUMMARY_CHARS,
  );
  const snapshot = copyTrackingSnapshot(dbPath, { fs: fsMod });
  let db = null;
  let complete = true;

  try {
    const Database = loadDatabase();
    db = new Database(snapshot.snapshotPath, { readonly: true });
    const summaries = [];
    const aiCodeEvents = [];

    const summaryColumns = tableColumns(db, "conversation_summaries");
    if (
      summaryColumns.has("conversationId") &&
      summaryColumns.has("updatedAt")
    ) {
      const selected = [
        "conversationId",
        columnOrNull(summaryColumns, "title"),
        columnOrNull(summaryColumns, "tldr"),
        columnOrNull(summaryColumns, "overview"),
        columnOrNull(summaryColumns, "summaryBullets"),
        columnOrNull(summaryColumns, "model"),
        columnOrNull(summaryColumns, "mode"),
        "updatedAt",
      ].join(", ");
      let rows = db
        .prepare(
          `SELECT ${selected} FROM conversation_summaries ORDER BY updatedAt DESC LIMIT ?`,
        )
        .all(probeRows);
      if (rows.length > maxRows) {
        rows = rows.slice(0, maxRows);
        complete = false;
      }
      for (const row of rows) {
        const capturedAt = normalizeTimestamp(row.updatedAt);
        if (!capturedAt) {
          complete = false;
          continue;
        }
        if (since > 0 && capturedAt < since) continue;
        const fields = {};
        for (const key of ["title", "tldr", "overview", "summaryBullets"]) {
          const bounded = boundedContent(row[key], maxSummaryChars);
          if (bounded.truncated) complete = false;
          fields[key] = bounded.value || null;
        }
        const conversationHash = sha256Hex(row.conversationId);
        summaries.push({
          recordId: conversationHash.slice(0, 48),
          capturedAt,
          payload: {
            conversationHash,
            ...fields,
            model: boundedMetadata(row.model, 128),
            mode: boundedMetadata(row.mode, 64),
            updatedAt: capturedAt,
          },
        });
      }
    }

    const codeColumns = tableColumns(db, "ai_code_hashes");
    if (codeColumns.has("hash") && codeColumns.has("timestamp")) {
      const selected = [
        "hash",
        columnOrNull(codeColumns, "source"),
        columnOrNull(codeColumns, "fileExtension"),
        columnOrNull(codeColumns, "model"),
        "timestamp",
        columnOrNull(codeColumns, "createdAt"),
      ].join(", ");
      let rows = db
        .prepare(
          `SELECT ${selected} FROM ai_code_hashes ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(probeRows);
      if (rows.length > maxRows) {
        rows = rows.slice(0, maxRows);
        complete = false;
      }
      for (const row of rows) {
        const capturedAt =
          normalizeTimestamp(row.timestamp) ||
          normalizeTimestamp(row.createdAt);
        if (!capturedAt) {
          complete = false;
          continue;
        }
        if (since > 0 && capturedAt < since) continue;
        const recordHash = sha256Hex(row.hash);
        aiCodeEvents.push({
          recordId: `${recordHash.slice(0, 40)}:${capturedAt}`,
          capturedAt,
          payload: {
            recordHash,
            source: boundedMetadata(row.source, 64),
            fileExtension: boundedMetadata(row.fileExtension, 32),
            model: boundedMetadata(row.model, 128),
            occurredAt: capturedAt,
          },
        });
      }
    }

    summaries.sort(
      (a, b) =>
        a.capturedAt - b.capturedAt || a.recordId.localeCompare(b.recordId),
    );
    aiCodeEvents.sort(
      (a, b) =>
        a.capturedAt - b.capturedAt || a.recordId.localeCompare(b.recordId),
    );
    if (summaries.length + aiCodeEvents.length > limit) {
      const combined = [
        ...summaries.map((record) => ({ ...record, kind: "summary" })),
        ...aiCodeEvents.map((record) => ({ ...record, kind: "ai-code" })),
      ]
        .sort(
          (a, b) =>
            a.capturedAt - b.capturedAt ||
            a.kind.localeCompare(b.kind) ||
            a.recordId.localeCompare(b.recordId),
        )
        .slice(0, limit);
      summaries.length = 0;
      aiCodeEvents.length = 0;
      for (const record of combined) {
        if (record.kind === "summary") summaries.push(record);
        else aiCodeEvents.push(record);
        delete record.kind;
      }
      complete = false;
    }
    return { summaries, aiCodeEvents, complete };
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close of the private read-only snapshot.
    }
    try {
      fsMod.rmSync(snapshot.tempDirectory, {
        recursive: true,
        force: true,
      });
    } catch {
      // A stale private snapshot can be removed by the OS later.
    }
  }
}

module.exports = {
  defaultCursorRoot,
  defaultCursorHome,
  inspectCursorLocalData,
  readAgentTranscripts,
  readAiTracking,
};
