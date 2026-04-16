/**
 * JSONL Session Store — append-only session persistence.
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "../lib/paths.js";

function getSessionsDir() {
  const dir = join(getHomeDir(), "sessions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionPath(sessionId) {
  return join(getSessionsDir(), `${sessionId}.jsonl`);
}

export function appendTokenUsage(sessionId, usage) {
  appendEvent(sessionId, "token_usage", usage || {});
}

export function appendEvent(sessionId, type, data) {
  const line = JSON.stringify({ type, timestamp: Date.now(), data }) + "\n";
  appendFileSync(sessionPath(sessionId), line, "utf-8");
}

export function startSession(sessionId, meta = {}) {
  const id =
    sessionId ||
    `session-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;

  appendEvent(id, "session_start", {
    title: meta.title || "Untitled",
    provider: meta.provider || "",
    model: meta.model || "",
  });

  return id;
}

export function appendUserMessage(sessionId, content) {
  appendEvent(sessionId, "user_message", { role: "user", content });
}

export function appendAssistantMessage(sessionId, content) {
  appendEvent(sessionId, "assistant_message", { role: "assistant", content });
}

export function appendToolCall(sessionId, toolName, args) {
  appendEvent(sessionId, "tool_call", { tool: toolName, args });
}

export function appendToolResult(sessionId, toolName, result) {
  appendEvent(sessionId, "tool_result", { tool: toolName, result });
}

export function appendCompactEvent(sessionId, stats) {
  appendEvent(sessionId, "compact", stats);
}

export function readEvents(sessionId) {
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf-8");
  const events = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (_e) {
      // Skip malformed lines
    }
  }

  return events;
}

export function rebuildMessages(sessionId) {
  const events = readEvents(sessionId);
  const messages = [];
  let lastCompactIndex = -1;

  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "compact" && events[i].data.messages) {
      lastCompactIndex = i;
      break;
    }
  }

  if (lastCompactIndex >= 0 && events[lastCompactIndex].data.messages) {
    messages.push(...events[lastCompactIndex].data.messages);
  }

  const startIndex = lastCompactIndex >= 0 ? lastCompactIndex + 1 : 0;

  for (let i = startIndex; i < events.length; i++) {
    const event = events[i];
    if (
      event.type === "user_message" ||
      event.type === "assistant_message" ||
      event.type === "system"
    ) {
      messages.push(event.data);
    }
  }

  return messages;
}

export function listJsonlSessions(options = {}) {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];

  const limit = options.limit || 20;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const id = basename(f, ".jsonl");
      const events = readEvents(id);
      const startEvent = events.find((e) => e.type === "session_start");
      const lastEvent = events[events.length - 1];
      const messageCount = events.filter(
        (e) => e.type === "user_message" || e.type === "assistant_message",
      ).length;

      return {
        id,
        title: startEvent?.data?.title || "Untitled",
        provider: startEvent?.data?.provider || "",
        model: startEvent?.data?.model || "",
        message_count: messageCount,
        created_at: startEvent
          ? new Date(startEvent.timestamp).toISOString()
          : "",
        updated_at: lastEvent
          ? new Date(lastEvent.timestamp).toISOString()
          : "",
        _lastTs: lastEvent?.timestamp || 0,
        _eventCount: events.length,
      };
    })
    .sort((a, b) => {
      // Primary: numeric timestamp descending
      if (b._lastTs !== a._lastTs) return b._lastTs - a._lastTs;
      // Tiebreak when ms collides: more events = more recent activity
      return b._eventCount - a._eventCount;
    })
    .slice(0, limit)
    .map(({ _lastTs, _eventCount, ...rest }) => rest);

  return files;
}

export function forkSession(sourceId) {
  const events = readEvents(sourceId);
  if (events.length === 0) return null;

  const newId = `session-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;
  const filePath = sessionPath(newId);

  for (const event of events) {
    const line = JSON.stringify(event) + "\n";
    appendFileSync(filePath, line, "utf-8");
  }

  appendEvent(newId, "system", {
    role: "system",
    content: `[Forked from session ${sourceId}]`,
  });

  return newId;
}

export function sessionExists(sessionId) {
  return existsSync(sessionPath(sessionId));
}

export function getLastSessionId() {
  const sessions = listJsonlSessions({ limit: 1 });
  return sessions.length > 0 ? sessions[0].id : null;
}

export function migrateLegacySessions(sourceDir, options = {}) {
  return migrateLegacySessionsBatch(sourceDir, options).results;
}

export function migrateLegacySessionsBatch(sourceDir, options = {}) {
  const directory = resolve(sourceDir || getSessionsDir());
  if (!existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const files = readdirSync(directory).filter(
    (file) =>
      file.endsWith(".json") &&
      !file.endsWith(".jsonl") &&
      !file.endsWith(".migrated.json"),
  );

  const results = [];
  for (const file of files) {
    const filePath = join(directory, file);
    results.push(migrateLegacySessionFile(filePath, options));
  }

  const summary = buildMigrationSummary(results, {
    directory,
    dryRun: Boolean(options.dryRun),
  });
  const sampledValidation = options.dryRun
    ? []
    : sampleMigratedSessionsValidation(results, {
        sampleSize: options.sampleSize,
      });

  return {
    directory,
    results,
    summary,
    sampledValidation,
  };
}

export function migrateLegacySessionFile(filePath, options = {}) {
  const sourcePath = resolve(filePath);
  const maxAttempts = Math.max(
    1,
    (options.retryFailures ? 2 : 1) + Math.max(0, options.retryCount || 0),
  );
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = performLegacySessionMigration(sourcePath, options);
      return {
        ...result,
        attempts: attempt,
        retried: attempt > 1,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    file: sourcePath,
    sessionId: basename(sourcePath, ".json"),
    migrated: false,
    failed: true,
    dryRun: Boolean(options.dryRun),
    attempts: maxAttempts,
    reason: lastError?.message || "migration failed",
  };
}

export function validateJsonlSession(sessionId) {
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) {
    return {
      sessionId,
      valid: false,
      reason: "session file not found",
      malformedLines: 0,
      eventCount: 0,
    };
  }

  const lines = readFileSync(filePath, "utf-8").split("\n");
  let malformedLines = 0;
  const events = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedLines++;
    }
  }

  const hasStartEvent = events.some((event) => event.type === "session_start");
  const messageCount = events.filter(
    (event) =>
      event.type === "user_message" || event.type === "assistant_message",
  ).length;

  return {
    sessionId,
    valid: malformedLines === 0 && hasStartEvent,
    malformedLines,
    eventCount: events.length,
    messageCount,
    hasStartEvent,
  };
}

export function validateAllJsonlSessions(options = {}) {
  const files = readdirSync(getSessionsDir())
    .filter((file) => file.endsWith(".jsonl"))
    .slice(0, options.limit || 1000);
  return files.map((file) => validateJsonlSession(basename(file, ".jsonl")));
}

export function sampleMigratedSessionsValidation(results, options = {}) {
  const sampleSize = Math.max(0, parseInt(options.sampleSize || 3, 10));
  const migrated = results.filter((item) => item.migrated && !item.dryRun);
  return migrated.slice(0, sampleSize).map((item) => {
    const validation = validateJsonlSession(item.sessionId);
    return {
      sessionId: item.sessionId,
      file: item.file,
      valid: validation.valid,
      messageCount: validation.messageCount,
      expectedMessageCount: item.messageCount,
      matchesExpectedMessages: validation.messageCount === item.messageCount,
      malformedLines: validation.malformedLines,
    };
  });
}

function performLegacySessionMigration(sourcePath, options) {
  const parsed = JSON.parse(readFileSync(sourcePath, "utf-8"));
  const legacy = normalizeLegacySession(parsed, basename(sourcePath, ".json"));
  const sessionId = legacy.id;

  if (!options.force && sessionExists(sessionId)) {
    return {
      file: sourcePath,
      sessionId,
      skipped: true,
      reason: "jsonl session already exists",
    };
  }

  if (!options.dryRun) {
    if (options.force && sessionExists(sessionId)) {
      rmSync(sessionPath(sessionId), { force: true });
    }
    startSession(sessionId, legacy.meta);
    for (const message of legacy.messages) {
      appendLegacyMessage(sessionId, message);
    }
    if (legacy.summary) {
      appendEvent(sessionId, "system", {
        role: "system",
        content: `[Migrated Summary]\n${legacy.summary}`,
      });
    }

    const validation = validateJsonlSession(sessionId);
    if (
      !validation.valid ||
      validation.messageCount !== legacy.messages.length
    ) {
      throw new Error(
        `post-migration validation failed for ${sessionId} (${validation.messageCount}/${legacy.messages.length} messages)`,
      );
    }

    if (options.archive !== false) {
      copyFileSync(sourcePath, `${sourcePath}.migrated.json`);
    }
  }

  return {
    file: sourcePath,
    sessionId,
    migrated: true,
    messageCount: legacy.messages.length,
    archived: options.archive !== false && !options.dryRun,
    dryRun: Boolean(options.dryRun),
  };
}

function buildMigrationSummary(results, options = {}) {
  const summary = {
    directory: options.directory || null,
    dryRun: Boolean(options.dryRun),
    scanned: results.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    retries: 0,
  };

  for (const result of results) {
    if (result.migrated) summary.migrated += 1;
    if (result.skipped) summary.skipped += 1;
    if (result.failed) summary.failed += 1;
    if (result.retried) summary.retries += 1;
  }

  return summary;
}

function normalizeLegacySession(payload, fallbackId) {
  const messages = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
      ? payload.messages
      : [];

  return {
    id: payload?.id || fallbackId || `session-${Date.now()}`,
    meta: {
      title:
        payload?.title || payload?.name || fallbackId || "Migrated Session",
      provider: payload?.provider || "",
      model: payload?.model || "",
    },
    summary: payload?.summary || "",
    messages: messages.map(normalizeLegacyMessage).filter(Boolean),
  };
}

function normalizeLegacyMessage(message) {
  if (!message) return null;
  if (typeof message === "string") {
    return { role: "user", content: message };
  }

  const role = message.role || message.sender || message.type || "user";
  const content =
    message.content ?? message.text ?? message.message ?? message.result ?? "";

  return {
    role,
    content: typeof content === "string" ? content : JSON.stringify(content),
    tool: message.tool || message.name || null,
    args: message.args || message.arguments || null,
  };
}

function appendLegacyMessage(sessionId, message) {
  switch (message.role) {
    case "assistant":
      appendAssistantMessage(sessionId, message.content);
      break;
    case "tool":
      appendToolResult(
        sessionId,
        message.tool || "legacy-tool",
        message.content,
      );
      break;
    case "system":
      appendEvent(sessionId, "system", {
        role: "system",
        content: message.content,
      });
      break;
    default:
      appendUserMessage(sessionId, message.content);
      break;
  }
}
