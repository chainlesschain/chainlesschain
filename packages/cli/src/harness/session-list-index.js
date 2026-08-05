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
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { iterateFileLinesReverseSync } from "../lib/file-lines.js";
import { ensurePrivateFile } from "../lib/secure-fs.js";

export const SESSION_INDEX_SCHEMA = 2;
export const SESSION_INDEX_FILE = ".sessions-index-v2.ndjson";
export const SESSION_TOMBSTONE_MARKER_SUFFIX = ".tombstone";

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

export function sessionTombstoneMarkerPath(dir, sessionId) {
  return join(dir, `${sessionId}${SESSION_TOMBSTONE_MARKER_SUFFIX}`);
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
  } else if (
    event?.type === "ws_turn" &&
    event.data?.schemaVersion === 1 &&
    event.data?.outcome === "completed" &&
    event.data?.user?.role === "user" &&
    event.data?.assistant?.role === "assistant"
  ) {
    next.message_count = Math.max(0, Number(next.message_count) || 0) + 2;
  }
  next.last_hash = typeof lastHash === "string" ? lastHash : null;
  return next;
}

function writeMetaSnapshot(dir, meta) {
  const filePath = sessionMetaPath(dir, meta.id);
  const tombstoneMarker = sessionTombstoneMarkerPath(dir, meta.id);
  // The marker is the durable per-session namespace witness that makes a
  // tombstoned identity discoverable without reading every live sidecar on
  // `--continue`; the meta snapshot remains the content/status authority.
  // Publish the marker before the tombstone snapshot, and fail the delete if
  // that publication fails. Remove it only after a live generation snapshot
  // commits, so crashes can cause an extra candidate read but never hide a
  // successfully committed tombstone.
  if (meta.deleted === true) {
    writeFileSync(tombstoneMarker, "", { encoding: "utf8", mode: 0o600 });
    ensurePrivateFile(tombstoneMarker);
  }
  // The owning transcript lock serializes this derived snapshot. It need not
  // use a second temp+rename protocol: interruption can only corrupt a cache,
  // which readSessionMeta rejects and rebuildSessionMeta regenerates.
  writeFileSync(filePath, `${JSON.stringify(meta)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  ensurePrivateFile(filePath);
  if (meta.deleted !== true) rmSync(tombstoneMarker, { force: true });
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
export function recordSessionEvent(
  dir,
  sessionId,
  event,
  lastHash,
  { resetGeneration = false } = {},
) {
  const existing = readSessionMeta(dir, sessionId);
  // Only the transcript writer may authorize a new generation after checking
  // the tombstone and physical file under its lock. The index cannot infer
  // that authority from an attacker-controlled genesis-shaped event alone.
  const current = resetGeneration
    ? emptySessionMeta(sessionId)
    : existing || emptySessionMeta(sessionId);
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
  {
    limit = 20,
    hasSession = () => true,
    includeDeleted = () => false,
    onScanComplete = null,
  } = {},
) {
  const filePath = sessionIndexPath(dir);
  if (!existsSync(filePath)) {
    if (typeof onScanComplete === "function") {
      onScanComplete({
        exhausted: true,
        seenSessionIds: new Set(),
        latestBySessionId: new Map(),
      });
    }
    return [];
  }
  const wanted = Math.max(0, Number(limit) || 0);
  const seen = new Set();
  const latestBySessionId = new Map();
  const result = [];
  let exhausted = true;
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
    latestBySessionId.set(meta.id, meta);
    if (
      (meta.deleted && !includeDeleted(meta.id, meta)) ||
      !hasSession(meta.id)
    ) {
      continue;
    }
    result.push(publicSessionMeta(meta));
    if (wanted > 0 && result.length >= wanted) {
      exhausted = false;
      break;
    }
  }
  if (typeof onScanComplete === "function") {
    onScanComplete({ exhausted, seenSessionIds: seen, latestBySessionId });
  }
  return result;
}
