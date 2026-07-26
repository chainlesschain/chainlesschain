"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MAX_PROJECTS = 10_000;
const DEFAULT_MAX_TRANSCRIPT_FILES = 10_000;
const DEFAULT_MAX_TRANSCRIPT_RECORDS = 2_000_000;
const DEFAULT_MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_MESSAGE_CHARS = 1_000_000;
const DEFAULT_MAX_STATS_RECORDS = 100_000;
const MAX_TRANSCRIPT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TRANSCRIPT_LINE_BYTES = 4 * 1024 * 1024;
const MAX_STATS_FILE_BYTES = 4 * 1024 * 1024;

function defaultClaudeCodeHome() {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(configured.trim());
  }
  return path.join(os.homedir(), ".claude");
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

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeTimestamp(value, fallback = null) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (numeric >= 1e15) return Math.floor(numeric / 1000);
  if (numeric >= 1e12) return Math.floor(numeric);
  if (numeric >= 1e9) return Math.floor(numeric * 1000);
  return fallback;
}

function sortedEntries(directory, fsMod) {
  return fsMod
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inspectClaudeCodeLocalData(claudeHome, opts = {}) {
  const fsMod = opts.fs || fs;
  if (typeof claudeHome !== "string" || claudeHome.length === 0) {
    return {
      hasTranscripts: false,
      hasStats: false,
    };
  }
  return {
    hasTranscripts: fsMod.existsSync(path.join(claudeHome, "projects")),
    hasStats: fsMod.existsSync(path.join(claudeHome, "stats-cache.json")),
  };
}

function discoverTranscriptFiles(claudeHome, opts = {}) {
  const fsMod = opts.fs || fs;
  const projectsRoot = path.join(claudeHome, "projects");
  if (!fsMod.existsSync(projectsRoot)) {
    return { files: [], complete: true };
  }

  const includeSubagents = opts.includeSubagents !== false;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxProjects = positiveInteger(
    opts.maxProjects,
    Math.max(DEFAULT_MAX_PROJECTS, limit),
  );
  const maxTranscriptFiles = positiveInteger(
    opts.maxTranscriptFiles,
    Math.max(DEFAULT_MAX_TRANSCRIPT_FILES, limit),
  );
  let projectEntries;
  try {
    projectEntries = sortedEntries(projectsRoot, fsMod).filter((entry) =>
      entry.isDirectory(),
    );
  } catch {
    return { files: [], complete: false };
  }

  let complete = true;
  if (projectEntries.length > maxProjects) {
    projectEntries.length = maxProjects;
    complete = false;
  }

  const files = [];
  for (const projectEntry of projectEntries) {
    const projectName = projectEntry.name;
    const projectPath = path.join(projectsRoot, projectName);
    const projectHash = sha256Hex(projectName);
    let entries;
    try {
      entries = sortedEntries(projectPath, fsMod);
    } catch {
      complete = false;
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        const sessionHash = sha256Hex(`${projectName}\0${entry.name}`);
        files.push({
          filePath: path.join(projectPath, entry.name),
          fileKey: sha256Hex(`${projectName}\0${entry.name}`),
          projectHash,
          sessionHash,
          parentSessionHash: null,
          agentHash: null,
          isSubagent: false,
        });
      } else if (includeSubagents && entry.isDirectory()) {
        const subagentsPath = path.join(projectPath, entry.name, "subagents");
        if (!fsMod.existsSync(subagentsPath)) continue;
        let agentEntries;
        try {
          agentEntries = sortedEntries(subagentsPath, fsMod).filter(
            (agentEntry) =>
              agentEntry.isFile() &&
              agentEntry.name.toLowerCase().endsWith(".jsonl"),
          );
        } catch {
          complete = false;
          continue;
        }
        const parentSessionHash = sha256Hex(`${projectName}\0${entry.name}`);
        for (const agentEntry of agentEntries) {
          const fileKey = sha256Hex(
            `${projectName}\0${entry.name}\0subagents\0${agentEntry.name}`,
          );
          files.push({
            filePath: path.join(subagentsPath, agentEntry.name),
            fileKey,
            projectHash,
            sessionHash: fileKey,
            parentSessionHash,
            agentHash: sha256Hex(agentEntry.name),
            isSubagent: true,
          });
        }
      }

      if (files.length > maxTranscriptFiles) {
        files.length = maxTranscriptFiles;
        complete = false;
        break;
      }
    }
    if (files.length >= maxTranscriptFiles && !complete) break;
  }

  files.sort((a, b) => a.fileKey.localeCompare(b.fileKey));
  return { files, complete };
}

function textPartsFromMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (part) => part && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text);
}

function safeUsage(message) {
  const usage = message?.usage;
  if (!usage || typeof usage !== "object") return null;
  const safe = {
    inputTokens: safeCount(usage.input_tokens),
    outputTokens: safeCount(usage.output_tokens),
    cacheCreationInputTokens: safeCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: safeCount(usage.cache_read_input_tokens),
  };
  return Object.values(safe).some((value) => value !== null) ? safe : null;
}

function readClaudeCodeTranscripts(claudeHome, opts = {}) {
  const fsMod = opts.fs || fs;
  const since =
    Number.isSafeInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxTranscriptRecords = positiveInteger(
    opts.maxTranscriptRecords,
    Math.max(DEFAULT_MAX_TRANSCRIPT_RECORDS, limit),
  );
  const maxTranscriptBytes = positiveInteger(
    opts.maxTranscriptBytes,
    DEFAULT_MAX_TRANSCRIPT_BYTES,
  );
  const maxMessageChars = positiveInteger(
    opts.maxMessageChars,
    DEFAULT_MAX_MESSAGE_CHARS,
  );
  const discovery = discoverTranscriptFiles(claudeHome, { ...opts, limit });
  let complete = discovery.complete;
  let inspectedRecords = 0;
  let inspectedBytes = 0;
  const messages = [];

  for (const descriptor of discovery.files) {
    let stat;
    let text;
    try {
      stat = fsMod.statSync(descriptor.filePath);
      if (!stat.isFile()) {
        complete = false;
        continue;
      }
      if (since > 0 && Math.floor(stat.mtimeMs) < since) continue;
      if (
        stat.size > MAX_TRANSCRIPT_FILE_BYTES ||
        inspectedBytes + stat.size > maxTranscriptBytes
      ) {
        complete = false;
        continue;
      }
      inspectedBytes += stat.size;
      text = fsMod.readFileSync(descriptor.filePath, "utf8");
    } catch {
      complete = false;
      continue;
    }

    const fileMessages = [];
    let sessionTitle = null;
    const lines = text.split(/\r?\n/u);
    for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
      const line = lines[sourceIndex];
      if (!line) continue;
      inspectedRecords += 1;
      if (inspectedRecords > maxTranscriptRecords) {
        complete = false;
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

      if (parsed?.type === "ai-title" && typeof parsed.aiTitle === "string") {
        const boundedTitle = boundedContent(parsed.aiTitle, 500);
        if (boundedTitle.truncated) complete = false;
        sessionTitle = boundedTitle.value || sessionTitle;
        continue;
      }
      if (
        (parsed?.type !== "user" && parsed?.type !== "assistant") ||
        parsed.isMeta === true
      ) {
        continue;
      }
      const role = parsed.type;
      if (parsed?.message?.role !== role) {
        complete = false;
        continue;
      }

      const textParts = textPartsFromMessage(parsed.message);
      if (textParts.length === 0) continue;
      const bounded = boundedContent(textParts.join("\n"), maxMessageChars);
      if (!bounded.value) continue;
      if (bounded.truncated) complete = false;

      const recordTimestamp = normalizeTimestamp(parsed.timestamp);
      const capturedAt =
        recordTimestamp || Math.max(1, Math.floor(stat.mtimeMs));
      if (since > 0 && capturedAt < since) continue;
      const rawMessageIdentity =
        (typeof parsed.uuid === "string" && parsed.uuid) ||
        (typeof parsed?.message?.id === "string" && parsed.message.id) ||
        `${descriptor.fileKey}\0${sourceIndex}\0${role}\0${bounded.value}`;
      const messageHash = sha256Hex(rawMessageIdentity);
      fileMessages.push({
        recordId: `${descriptor.sessionHash.slice(0, 24)}:${messageHash.slice(0, 32)}`,
        capturedAt,
        payload: {
          role,
          text: bounded.value,
          projectHash: descriptor.projectHash,
          sessionHash: descriptor.sessionHash,
          parentSessionHash: descriptor.parentSessionHash,
          agentHash: descriptor.agentHash,
          isSubagent: descriptor.isSubagent,
          sourceIndex,
          textPartCount: textParts.length,
          timestampSource: recordTimestamp
            ? "record-timestamp"
            : "transcript-file-mtime",
          occurredAt: capturedAt,
          model: boundedMetadata(parsed.message.model, 128),
          stopReason: boundedMetadata(parsed.message.stop_reason, 64),
          usage: safeUsage(parsed.message),
        },
      });
    }

    if (sessionTitle) {
      for (const message of fileMessages) {
        message.payload.sessionTitle = sessionTitle;
      }
    }
    messages.push(...fileMessages);
    if (inspectedRecords > maxTranscriptRecords) break;
  }

  messages.sort(
    (a, b) =>
      a.capturedAt - b.capturedAt ||
      a.payload.sessionHash.localeCompare(b.payload.sessionHash) ||
      a.payload.sourceIndex - b.payload.sourceIndex ||
      a.recordId.localeCompare(b.recordId),
  );
  if (messages.length > limit) {
    messages.length = limit;
    complete = false;
  }
  return {
    messages,
    complete,
    inspectedFiles: discovery.files.length,
    inspectedRecords: Math.min(inspectedRecords, maxTranscriptRecords),
    inspectedBytes,
  };
}

function parseDayTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function readClaudeCodeStats(claudeHome, opts = {}) {
  const fsMod = opts.fs || fs;
  const statsPath = path.join(claudeHome, "stats-cache.json");
  if (!fsMod.existsSync(statsPath)) {
    return { activity: [], modelUsage: [], complete: true };
  }

  const since =
    Number.isSafeInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const maxStatsRecords = positiveInteger(
    opts.maxStatsRecords,
    Math.max(DEFAULT_MAX_STATS_RECORDS, limit),
  );
  let parsed;
  let statsMtime;
  try {
    const stat = fsMod.statSync(statsPath);
    if (!stat.isFile() || stat.size > MAX_STATS_FILE_BYTES) {
      return { activity: [], modelUsage: [], complete: false };
    }
    statsMtime = Math.max(1, Math.floor(stat.mtimeMs));
    parsed = JSON.parse(fsMod.readFileSync(statsPath, "utf8"));
  } catch {
    return { activity: [], modelUsage: [], complete: false };
  }

  const datedRows = [
    ...(Array.isArray(parsed.dailyActivity) ? parsed.dailyActivity : []),
    ...(Array.isArray(parsed.dailyModelTokens) ? parsed.dailyModelTokens : []),
  ];
  const latestDate = datedRows
    .map((row) => (parseDayTimestamp(row?.date) ? row.date : null))
    .filter(Boolean)
    .sort()
    .at(-1);
  const observedAt = (date, occurredAt) =>
    date === latestDate ? Math.max(occurredAt, statsMtime) : occurredAt;

  let complete = true;
  let inspected = 0;
  const activity = [];
  const modelUsage = [];
  for (const row of Array.isArray(parsed.dailyActivity)
    ? parsed.dailyActivity
    : []) {
    inspected += 1;
    if (inspected > maxStatsRecords) {
      complete = false;
      break;
    }
    const occurredAt = parseDayTimestamp(row?.date);
    if (!occurredAt) {
      complete = false;
      continue;
    }
    const capturedAt = observedAt(row.date, occurredAt);
    if (since > 0 && capturedAt < since) continue;
    const messageCount = safeCount(row.messageCount);
    const sessionCount = safeCount(row.sessionCount);
    const toolCallCount = safeCount(row.toolCallCount);
    if (
      messageCount === null &&
      sessionCount === null &&
      toolCallCount === null
    ) {
      complete = false;
      continue;
    }
    activity.push({
      recordId: sha256Hex(`activity\0${row.date}`).slice(0, 48),
      capturedAt,
      payload: {
        date: row.date,
        messageCount,
        sessionCount,
        toolCallCount,
        occurredAt,
      },
    });
  }

  for (const row of Array.isArray(parsed.dailyModelTokens)
    ? parsed.dailyModelTokens
    : []) {
    const occurredAt = parseDayTimestamp(row?.date);
    if (!occurredAt) {
      complete = false;
      continue;
    }
    const capturedAt = observedAt(row.date, occurredAt);
    const entries =
      row.tokensByModel && typeof row.tokensByModel === "object"
        ? Object.entries(row.tokensByModel)
        : [];
    for (const [rawModel, rawTokens] of entries) {
      inspected += 1;
      if (inspected > maxStatsRecords) {
        complete = false;
        break;
      }
      if (since > 0 && capturedAt < since) continue;
      const model = boundedMetadata(rawModel, 128);
      const tokenCount = safeCount(rawTokens);
      if (!model || tokenCount === null) {
        complete = false;
        continue;
      }
      modelUsage.push({
        recordId: sha256Hex(`model-usage\0${row.date}\0${model}`).slice(0, 48),
        capturedAt,
        payload: {
          date: row.date,
          model,
          tokenCount,
          occurredAt,
        },
      });
    }
    if (inspected > maxStatsRecords) break;
  }

  return { activity, modelUsage, complete };
}

module.exports = {
  defaultClaudeCodeHome,
  inspectClaudeCodeLocalData,
  discoverTranscriptFiles,
  readClaudeCodeTranscripts,
  readClaudeCodeStats,
};
