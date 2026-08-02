/**
 * Rebuildable metadata index for append-only JSONL sessions.
 *
 * Each transcript owns a tiny `<id>.meta.json` snapshot. A global reverse-read
 * activity journal points at the newest snapshots, so `session list --limit N`
 * reads O(N recent sessions) instead of every transcript body. The transcript
 * remains the content authority; both index layers may be deleted and rebuilt.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { iterateFileLinesReverseSync } from "../lib/file-lines.js";
import { ensurePrivateFile } from "../lib/secure-fs.js";

export const SESSION_INDEX_SCHEMA = 2;
export const SESSION_INDEX_FILE = ".sessions-index-v2.ndjson";

// Used only by an opted-in child in the independent session-scale crash gate.
// Keeping the injection immediately around the production sidecar/journal
// boundary makes that gate deterministic without replacing either write.
export const _sessionScaleFaultHooks = Object.seal({
  afterMetaSnapshot: null,
});

function runSessionScaleFaultHook(name, payload) {
  if (process.env.CC_SESSION_SCALE_FAULT_INJECTION !== "1") return;
  const hook = _sessionScaleFaultHooks[name];
  if (typeof hook === "function") hook(payload);
}

export function sessionMetaPath(dir, sessionId) {
  return join(dir, `${sessionId}.meta.json`);
}

export function sessionIndexPath(dir) {
  return join(dir, SESSION_INDEX_FILE);
}

export function emptySessionMeta(sessionId) {
  return {
    schema: SESSION_INDEX_SCHEMA,
    id: sessionId,
    title: "Untitled",
    provider: "",
    model: "",
    message_count: 0,
    event_count: 0,
    created_at_ms: 0,
    updated_at_ms: 0,
    last_hash: null,
    deleted: false,
  };
}

export function readSessionMeta(dir, sessionId) {
  const filePath = sessionMetaPath(dir, sessionId);
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return value?.schema === SESSION_INDEX_SCHEMA && value?.id === sessionId
      ? value
      : null;
  } catch {
    // A sidecar interrupted mid-write is discarded and streamed from the
    // authoritative transcript on the next list/search operation.
    return null;
  }
}

export function applyEventToSessionMeta(meta, event, lastHash) {
  const next = { ...(meta || emptySessionMeta("")) };
  next.schema = SESSION_INDEX_SCHEMA;
  next.deleted = false;
  next.event_count = Math.max(0, Number(next.event_count) || 0) + 1;
  const timestamp = Number(event?.timestamp);
  if (Number.isFinite(timestamp)) {
    if (!next.created_at_ms) next.created_at_ms = timestamp;
    next.updated_at_ms = Math.max(next.updated_at_ms || 0, timestamp);
  }
  if (event?.type === "session_start") {
    next.title = event.data?.title || next.title || "Untitled";
    next.provider = event.data?.provider || "";
    next.model = event.data?.model || "";
  } else if (event?.type === "session_rename" && event.data?.title) {
    next.title = String(event.data.title);
  } else if (
    event?.type === "user_message" ||
    event?.type === "assistant_message"
  ) {
    next.message_count = Math.max(0, Number(next.message_count) || 0) + 1;
  }
  next.last_hash = typeof lastHash === "string" ? lastHash : null;
  return next;
}

function writeMetaSnapshot(dir, meta) {
  const filePath = sessionMetaPath(dir, meta.id);
  // The owning transcript lock serializes this derived snapshot. It need not
  // use a second temp+rename protocol: interruption can only corrupt a cache,
  // which readSessionMeta rejects and rebuildSessionMeta regenerates.
  writeFileSync(filePath, `${JSON.stringify(meta)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  ensurePrivateFile(filePath);
}

function appendActivity(dir, meta) {
  const filePath = sessionIndexPath(dir);
  // One compact line is emitted through one O_APPEND write. The journal is a
  // disposable ordering hint (the per-session sidecar and transcript remain
  // authoritative). Prefixing the record with a newline isolates any
  // crash-partial physical tail before publishing the next valid snapshot;
  // reverse readers already skip the resulting empty lines. Avoiding a second
  // global directory lock keeps concurrent transcript appends from serializing
  // on derived metadata.
  appendFileSync(filePath, `\n${JSON.stringify(meta)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  ensurePrivateFile(filePath);
}

/** Called while the owning transcript lock is held. */
export function recordSessionEvent(dir, sessionId, event, lastHash) {
  const current =
    readSessionMeta(dir, sessionId) || emptySessionMeta(sessionId);
  current.id = sessionId;
  const next = applyEventToSessionMeta(current, event, lastHash);
  writeMetaSnapshot(dir, next);
  runSessionScaleFaultHook("afterMetaSnapshot", {
    dir,
    sessionId,
    event,
    meta: next,
  });
  appendActivity(dir, next);
  return next;
}

export function replaceSessionMeta(dir, meta) {
  const normalized = { ...emptySessionMeta(meta.id), ...meta };
  writeMetaSnapshot(dir, normalized);
  appendActivity(dir, normalized);
  return normalized;
}

/** Re-emit an existing snapshot only to the global activity order. */
export function recordSessionActivity(dir, meta) {
  const normalized = { ...emptySessionMeta(meta.id), ...meta };
  appendActivity(dir, normalized);
  return normalized;
}

export function recordSessionDeleted(dir, sessionId, timestamp = Date.now()) {
  const current =
    readSessionMeta(dir, sessionId) || emptySessionMeta(sessionId);
  const tombstone = {
    ...current,
    updated_at_ms: timestamp,
    deleted: true,
  };
  writeMetaSnapshot(dir, tombstone);
  appendActivity(dir, tombstone);
  return tombstone;
}

/** Newest journal snapshot for one session, or null if none survived. */
export function readLatestSessionActivity(dir, sessionId) {
  const filePath = sessionIndexPath(dir);
  if (!existsSync(filePath) || typeof sessionId !== "string") return null;
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    try {
      const meta = JSON.parse(line);
      if (meta?.schema === SESSION_INDEX_SCHEMA && meta.id === sessionId) {
        return meta;
      }
    } catch {
      // A crash-partial tail is not an activity snapshot.
    }
  }
  return null;
}

function iso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  try {
    return new Date(number).toISOString();
  } catch {
    return "";
  }
}

export function publicSessionMeta(meta) {
  return {
    id: meta.id,
    title: meta.title || "Untitled",
    provider: meta.provider || "",
    model: meta.model || "",
    message_count: Math.max(0, Number(meta.message_count) || 0),
    created_at: iso(meta.created_at_ms),
    updated_at: iso(meta.updated_at_ms),
  };
}

/**
 * Read the activity journal newest-first and return the first record seen for
 * each session. This is the latest snapshot because every metadata mutation
 * appends after its sidecar commit.
 */
export function listIndexedSessions(
  dir,
  { limit = 20, hasSession = () => true } = {},
) {
  const filePath = sessionIndexPath(dir);
  if (!existsSync(filePath)) return [];
  const wanted = Math.max(0, Number(limit) || 0);
  const seen = new Set();
  const result = [];
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    let meta;
    try {
      meta = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      meta?.schema !== SESSION_INDEX_SCHEMA ||
      typeof meta.id !== "string" ||
      seen.has(meta.id)
    ) {
      continue;
    }
    seen.add(meta.id);
    if (meta.deleted || !hasSession(meta.id)) continue;
    result.push(publicSessionMeta(meta));
    if (wanted > 0 && result.length >= wanted) break;
  }
  return result;
}
