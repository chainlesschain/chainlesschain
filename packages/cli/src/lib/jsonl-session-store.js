/**
 * JSONL Session Store — append-only session persistence.
 *
 * Each session is a file: .chainlesschain/sessions/{session-id}.jsonl
 * Each line: {"type":"...", "timestamp":..., "data":{...}}
 *
 * Types: session_start, user_message, assistant_message, tool_call,
 *        tool_result, system, compact, session_end
 *
 * Feature-flag gated: JSONL_SESSION
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "./paths.js";

function getSessionsDir() {
  const dir = join(getHomeDir(), "sessions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(sessionId) {
  return join(getSessionsDir(), `${sessionId}.jsonl`);
}

// ── Write operations ────────────────────────────────────────────────────

/**
 * Append a single event to the session log.
 * User messages are written synchronously for crash recovery.
 */
export function appendEvent(sessionId, type, data) {
  const line = JSON.stringify({ type, timestamp: Date.now(), data }) + "\n";
  appendFileSync(sessionPath(sessionId), line, "utf-8");
}

/**
 * Start a new session (writes session_start event).
 */
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

/**
 * Append a user message (synchronous write for crash recovery).
 */
export function appendUserMessage(sessionId, content) {
  appendEvent(sessionId, "user_message", { role: "user", content });
}

/**
 * Append an assistant message.
 */
export function appendAssistantMessage(sessionId, content) {
  appendEvent(sessionId, "assistant_message", { role: "assistant", content });
}

/**
 * Append a tool call event.
 */
export function appendToolCall(sessionId, toolName, args) {
  appendEvent(sessionId, "tool_call", { tool: toolName, args });
}

/**
 * Append a tool result event.
 */
export function appendToolResult(sessionId, toolName, result) {
  appendEvent(sessionId, "tool_result", { tool: toolName, result });
}

/**
 * Append a compact event (context was compressed).
 */
export function appendCompactEvent(sessionId, stats) {
  appendEvent(sessionId, "compact", stats);
}

// ── Read operations ─────────────────────────────────────────────────────

/**
 * Read all events from a session file.
 * @returns {Array<{type, timestamp, data}>}
 */
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

/**
 * Reconstruct messages array from JSONL events (for API calls).
 * Skips compact events and rebuilds the current conversation state.
 */
export function rebuildMessages(sessionId) {
  const events = readEvents(sessionId);
  const messages = [];
  let lastCompactIndex = -1;

  // Find the last compact event (start from there)
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "compact" && events[i].data.messages) {
      lastCompactIndex = i;
      break;
    }
  }

  if (lastCompactIndex >= 0 && events[lastCompactIndex].data.messages) {
    messages.push(...events[lastCompactIndex].data.messages);
  }

  // Replay events after last compact
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

/**
 * List all sessions (reads session_start events from all .jsonl files).
 */
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
      };
    })
    .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))
    .slice(0, limit);

  return files;
}

/**
 * Fork a session — copies all events to a new session ID.
 */
export function forkSession(sourceId) {
  const events = readEvents(sourceId);
  if (events.length === 0) return null;

  const newId = `session-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;
  const filePath = sessionPath(newId);

  for (const event of events) {
    const line = JSON.stringify(event) + "\n";
    appendFileSync(filePath, line, "utf-8");
  }

  // Mark the fork
  appendEvent(newId, "system", {
    role: "system",
    content: `[Forked from session ${sourceId}]`,
  });

  return newId;
}

/**
 * Check if a JSONL session exists.
 */
export function sessionExists(sessionId) {
  return existsSync(sessionPath(sessionId));
}

/**
 * Get the most recent session ID (for --continue).
 */
export function getLastSessionId() {
  const sessions = listJsonlSessions({ limit: 1 });
  return sessions.length > 0 ? sessions[0].id : null;
}
