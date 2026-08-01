/**
 * JSONL Session Store — append-only session persistence.
 */

import {
  existsSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  ftruncateSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { getHomeDir } from "../lib/paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../lib/secure-fs.js";
import {
  computeEventHash,
  TRANSCRIPT_CHAIN_STATUS,
} from "./transcript-integrity.js";
import { withFileLock } from "../lib/with-file-lock.js";
import {
  iterateFileLinesSync,
  iterateFileLinesReverseSync,
} from "../lib/file-lines.js";
import {
  emptySessionMeta,
  applyEventToSessionMeta,
  listIndexedSessions,
  publicSessionMeta,
  readSessionMeta,
  recordSessionDeleted,
  recordSessionEvent,
  recordSessionActivity,
  replaceSessionMeta,
} from "./session-list-index.js";

let securedSessionsDir = null;

function getSessionsDir() {
  const dir = join(getHomeDir(), "sessions");
  if (securedSessionsDir !== dir || !existsSync(dir)) {
    ensurePrivateDirectory(dir);
    securedSessionsDir = dir;
  }
  return dir;
}

/**
 * A session id must be a single safe path segment. Ids are generated as
 * `session-<ts>-<hex>`, but also arrive from CLI args (`cc agent --resume <id>`,
 * `cc insights <id>`, `cc session show <id>`), so an id like `../../etc/x` would
 * otherwise let sessionPath() read / append / delete a .jsonl OUTSIDE the
 * sessions dir. Reject any separator or `..` (mirrors goal-store's
 * isUnsafeGoalId / FileUploadService.isUnsafeSegment).
 */
export function isUnsafeSessionId(id) {
  return (
    id == null ||
    id === "" ||
    typeof id !== "string" ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("..")
  );
}

export function sessionPath(sessionId) {
  // Fail closed for path building: every write/delete goes through here, so a
  // traversal id can never escape the sessions dir. Reads guard separately and
  // degrade to not-found instead of throwing.
  if (isUnsafeSessionId(sessionId)) {
    throw new Error(`unsafe session id: ${String(sessionId).slice(0, 60)}`);
  }
  return join(getSessionsDir(), `${sessionId}.jsonl`);
}

export function appendTokenUsage(sessionId, usage) {
  appendEvent(sessionId, "token_usage", usage || {});
}

function inspectPhysicalTail(filePath, { dryRun = false } = {}) {
  const result = {
    action: "none",
    changed: false,
    discardedBytes: 0,
    discardedRecords: 0,
    fileSize: 0,
  };
  if (!existsSync(filePath)) return result;
  const fd = openSync(filePath, "r+");
  let normalizeNewline = false;
  try {
    const size = fstatSync(fd).size;
    result.fileSize = size;
    if (size > 0) {
      const lastByte = Buffer.allocUnsafe(1);
      readSync(fd, lastByte, 0, 1, size - 1);
      if (lastByte[0] !== 0x0a) {
        // Locate the beginning of the physical tail using bounded reverse IO.
        let cursor = size;
        let tailStart = 0;
        let found = false;
        const chunkSize = 64 * 1024;
        while (cursor > 0 && !found) {
          const length = Math.min(chunkSize, cursor);
          cursor -= length;
          const chunk = Buffer.allocUnsafe(length);
          readSync(fd, chunk, 0, length, cursor);
          const newline = chunk.lastIndexOf(0x0a);
          if (newline >= 0) {
            tailStart = cursor + newline + 1;
            found = true;
          }
        }
        const tail = Buffer.allocUnsafe(size - tailStart);
        if (tail.length > 0) readSync(fd, tail, 0, tail.length, tailStart);
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(tail);
          JSON.parse(text);
          // A valid legacy/manual last record merely lacks its newline; retain
          // it and normalize before appending the next chained event.
          result.action = "normalize-newline";
          result.changed = true;
          normalizeNewline = !dryRun;
        } catch {
          // Crash tail: discard only the one incomplete physical record.
          result.action = "discard-partial-record";
          result.changed = true;
          result.discardedBytes = size - tailStart;
          result.discardedRecords = 1;
          if (!dryRun) ftruncateSync(fd, tailStart);
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  if (normalizeNewline) {
    appendFileSync(filePath, "\n", { encoding: "utf8", mode: 0o600 });
  }
  if (!dryRun && result.changed) ensurePrivateFile(filePath);
  return result;
}

/**
 * Repair at most one crash-truncated physical tail and resolve the chain hash.
 * This is called only while the transcript's cross-process lock is held, so a
 * second writer can never reuse a stale in-process hash.
 */
function _resolveChainTail(filePath) {
  if (!existsSync(filePath)) return { prevHash: null, recovery: null };
  // Fast path: almost every append follows a newline-terminated record. Read
  // that tail once and avoid opening the file a second time just to inspect its
  // last byte. The slow repair path runs only for an unterminated crash tail.
  const initial = iterateFileLinesReverseSync(filePath);
  const first = initial.next();
  if (!first.done && first.value.terminated) {
    try {
      let current = first;
      while (!current.done) {
        try {
          const event = JSON.parse(current.value.line);
          return {
            prevHash: typeof event?.hash === "string" ? event.hash : null,
            recovery: null,
          };
        } catch {
          current = initial.next();
        }
      }
      return { prevHash: null, recovery: null };
    } finally {
      initial.return?.();
    }
  }
  initial.return?.();

  const recovery = inspectPhysicalTail(filePath);
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    try {
      const event = JSON.parse(line);
      return {
        prevHash: typeof event?.hash === "string" ? event.hash : null,
        recovery: recovery.changed ? recovery : null,
      };
    } catch {
      // A malformed historical line is verified separately; keep searching so
      // this append never chains from arbitrary bytes.
    }
  }
  return { prevHash: null, recovery: recovery.changed ? recovery : null };
}

function appendEventLocked(
  sessionId,
  type,
  data,
  { expectedHeadHash, compareHead = false } = {},
) {
  const filePath = sessionPath(sessionId);
  return withFileLock(
    filePath,
    () => {
      const existingMeta = readSessionMeta(getSessionsDir(), sessionId);
      if (
        !existsSync(filePath) &&
        existingMeta?.deleted === true &&
        type !== "session_start"
      ) {
        const error = new Error(`Session was deleted: ${sessionId}`);
        error.code = "SESSION_DELETED";
        throw error;
      }
      const { prevHash, recovery } = _resolveChainTail(filePath);
      if (compareHead && prevHash !== (expectedHeadHash || null)) {
        const error = new Error(
          `Session revision changed for ${sessionId}; refresh the checkpoint timeline`,
        );
        error.code = "SESSION_REVISION_STALE";
        error.expectedHeadHash = expectedHeadHash || null;
        error.actualHeadHash = prevHash;
        throw error;
      }
      const core = { type, timestamp: Date.now(), data };
      const hash = computeEventHash(prevHash, core);
      const event = { ...core, prevHash, hash };
      const line = JSON.stringify(event) + "\n";
      appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
      ensurePrivateFile(filePath);
      try {
        recordSessionEvent(getSessionsDir(), sessionId, event, hash);
      } catch {
        // The metadata index is explicitly rebuildable. Never turn a committed
        // transcript event into an apparent failure that a caller may retry.
      }
      return { hash, recovery };
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

export function appendEvent(sessionId, type, data) {
  return appendEventLocked(sessionId, type, data);
}

/**
 * Compare-and-append for revisioned IDE actions. The head check and append run
 * under the transcript's canonical writer lock, so a stale preview can never
 * commit after another session writer advances the chain.
 */
export function appendEventIfHead(
  sessionId,
  type,
  data,
  expectedHeadHash = null,
) {
  return appendEventLocked(sessionId, type, data, {
    expectedHeadHash,
    compareHead: true,
  });
}

function verifyTranscriptFile(filePath) {
  const result = {
    status: TRANSCRIPT_CHAIN_STATUS.EMPTY,
    chainedEvents: 0,
    legacyEvents: 0,
    malformedLines: 0,
    truncatedTail: false,
    firstInvalidLine: null,
    reason: null,
  };
  let lastHash = null;
  let sawChain = false;
  const tampered = (lineNo, reason) => ({
    ...result,
    status: TRANSCRIPT_CHAIN_STATUS.TAMPERED,
    firstInvalidLine: lineNo,
    reason,
  });

  for (const { line, lineNo, terminated } of iterateFileLinesSync(filePath)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      result.malformedLines += 1;
      if (!terminated) {
        result.truncatedTail = true;
        continue;
      }
      if (sawChain) {
        return tampered(lineNo, "malformed line inside hash chain");
      }
      continue;
    }

    if (event && typeof event.hash === "string") {
      const expectedPrev = sawChain ? lastHash : null;
      if ((event.prevHash ?? null) !== expectedPrev) {
        return tampered(
          lineNo,
          sawChain
            ? "hash chain linkage broken (record deleted, inserted, or reordered)"
            : "chain does not start at a genesis record (head records removed)",
        );
      }
      if (computeEventHash(expectedPrev, event) !== event.hash) {
        return tampered(lineNo, "event content does not match its hash");
      }
      sawChain = true;
      lastHash = event.hash;
      result.chainedEvents += 1;
    } else {
      if (sawChain) {
        return tampered(
          lineNo,
          "unchained record after hash chain started (manual append or downgrade write)",
        );
      }
      result.legacyEvents += 1;
    }
  }

  if (result.chainedEvents > 0) {
    result.status =
      result.legacyEvents > 0
        ? TRANSCRIPT_CHAIN_STATUS.PARTIAL
        : TRANSCRIPT_CHAIN_STATUS.VERIFIED;
  } else if (result.legacyEvents > 0 || result.malformedLines > 0) {
    result.status = TRANSCRIPT_CHAIN_STATUS.LEGACY;
  }
  return result;
}

/**
 * Verify a session transcript's hash chain (tamper-evidence).
 * Statuses: verified | partial (legacy prefix + valid chain) | legacy
 * (pre-chaining transcript) | tampered | empty — plus not-found / invalid-id.
 */
export function verifySession(sessionId) {
  if (isUnsafeSessionId(sessionId)) {
    return { sessionId, status: "invalid-id", reason: "invalid session id" };
  }
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) {
    return { sessionId, status: "not-found", reason: "session file not found" };
  }
  return {
    sessionId,
    ...verifyTranscriptFile(filePath),
  };
}

export function verifyAllSessions(options = {}) {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .slice(0, options.limit || 1000)
    .map((file) => verifySession(basename(file, ".jsonl")));
}

/**
 * Diagnose and repair only the final physical transcript record. Interior
 * corruption and hash-chain tampering are never rewritten: repair may append a
 * missing newline to one valid record or discard one crash-partial record.
 */
export function repairSession(sessionId, options = {}) {
  const dryRun = options.dryRun === true;
  if (isUnsafeSessionId(sessionId)) {
    return {
      sessionId,
      dryRun,
      changed: false,
      healthy: false,
      status: "invalid-id",
      reason: "invalid session id",
    };
  }
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) {
    return {
      sessionId,
      dryRun,
      changed: false,
      healthy: false,
      status: "not-found",
      reason: "session file not found",
    };
  }

  const result = withFileLock(
    filePath,
    () => {
      const before = verifyTranscriptFile(filePath);
      const beforeValidation = validateJsonlSession(sessionId);
      const repair = inspectPhysicalTail(filePath, { dryRun });
      const after = dryRun ? null : verifyTranscriptFile(filePath);
      const afterValidation = dryRun ? null : validateJsonlSession(sessionId);
      const effective = after || before;
      const effectiveValidation = afterValidation || beforeValidation;
      const healthy =
        effective.status !== TRANSCRIPT_CHAIN_STATUS.TAMPERED &&
        !(dryRun
          ? before.truncatedTail || repair.changed
          : after.truncatedTail) &&
        effectiveValidation.valid;
      return {
        sessionId,
        dryRun,
        changed: repair.changed,
        wouldChange: dryRun && repair.changed,
        action: repair.action,
        discardedBytes: repair.discardedBytes,
        discardedRecords: repair.discardedRecords,
        healthy,
        status: effective.status,
        before,
        after,
        beforeValidation,
        afterValidation,
        reason:
          effective.status === TRANSCRIPT_CHAIN_STATUS.TAMPERED
            ? effective.reason || "transcript remains tampered"
            : !effectiveValidation.valid
              ? effectiveValidation.reason ||
                "transcript remains structurally invalid"
              : null,
      };
    },
    { failIfUnavailable: true },
  );

  if (!dryRun && result.changed) {
    try {
      rebuildSessionMeta(sessionId);
    } catch {
      // Derived metadata is rebuilt lazily by list/search if this refresh loses
      // a race or the index is unavailable.
    }
  }
  return result;
}

/** All locally-stored session ids (the source of truth a mirror derives from). */
export function listSessionIds() {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => basename(file, ".jsonl"));
}

/** Resolve an exact id or one unambiguous prefix without reading transcripts. */
export function resolveSessionId(input) {
  if (isUnsafeSessionId(input)) return null;
  if (sessionExists(input)) return input;
  const matches = listSessionIds().filter((id) => id.startsWith(input));
  if (matches.length > 1) {
    const error = new Error(`Ambiguous session id prefix: ${input}`);
    error.code = "AMBIGUOUS_SESSION_ID";
    error.matches = matches.slice(0, 20);
    throw error;
  }
  return matches[0] || null;
}

export { TRANSCRIPT_CHAIN_STATUS };

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

/**
 * Compact tool-call record for usage attribution (用量归因): tool name +
 * error flag (+ optional skill, plugin/version, and bounded observed duration)
 * — deliberately NOT the args, which can carry whole file bodies (write_file
 * content) and would bloat the transcript. Written at tool-result time by the
 * agent drivers so `cc session usage --by tool|mcp|plugin` and `cc insights`
 * can aggregate tool use for any persisted session.
 */
export function appendToolCallCompact(
  sessionId,
  { tool, isError, skill, plugin, pluginVersion, durationMs } = {},
) {
  const duration = normalizeCompactDuration(durationMs);
  appendEvent(sessionId, "tool_call", {
    tool: tool || "?",
    is_error: Boolean(isError),
    ...(skill ? { skill: String(skill) } : {}),
    ...(plugin ? { plugin: String(plugin) } : {}),
    ...(pluginVersion ? { plugin_version: String(pluginVersion) } : {}),
    ...(duration !== null ? { duration_ms: duration } : {}),
  });
}

/** Hard cap for one observed failed LLM/tool attempt (seven days). */
export const MAX_COMPACT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeCompactDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(MAX_COMPACT_DURATION_MS, Math.round(number));
}

/**
 * Persist one automatic LLM stream retry without raw errors, prompts, URLs, or
 * credentials. Provider/model are bounded identity labels; reason is a closed
 * vocabulary produced by classifyStreamRetryReason().
 */
export function appendLlmRetryCompact(
  sessionId,
  { attempt, durationMs, provider, model, reason } = {},
) {
  const attemptNumber = Math.max(
    1,
    Math.min(15, Math.trunc(Number(attempt) || 1)),
  );
  const duration = normalizeCompactDuration(durationMs);
  const cleanLabel = (value, max) => {
    if (typeof value !== "string") return null;
    const clean = value.replace(/\p{Cc}/gu, "").trim();
    return clean ? clean.slice(0, max) : null;
  };
  const allowedReasons = new Set([
    "timeout",
    "dns",
    "connection_refused",
    "network_unreachable",
    "connection_reset",
    "unknown",
  ]);
  const cleanReason = allowedReasons.has(reason) ? reason : "unknown";
  const cleanProvider = cleanLabel(provider, 64);
  const cleanModel = cleanLabel(model, 128);
  appendEvent(sessionId, "llm_retry", {
    attempt: attemptNumber,
    duration_ms: duration ?? 0,
    reason: cleanReason,
    ...(cleanProvider ? { provider: cleanProvider } : {}),
    ...(cleanModel ? { model: cleanModel } : {}),
  });
}

export function appendToolResult(sessionId, toolName, result) {
  appendEvent(sessionId, "tool_result", { tool: toolName, result });
}

export function appendCompactEvent(sessionId, stats) {
  appendEvent(sessionId, "compact", stats);
}

export function readEvents(sessionId) {
  if (isUnsafeSessionId(sessionId)) return []; // traversal id → treat as empty
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return [];

  const events = [];
  for (const { line } of iterateFileLinesSync(filePath)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Return the newest event matching a type/predicate using bounded reverse IO.
 * This is the recovery path for snapshots and ledgers: callers never need to
 * materialize a multi-gigabyte transcript merely to inspect its latest state.
 */
export function findLatestEvent(sessionId, type, predicate = null) {
  if (isUnsafeSessionId(sessionId)) return null;
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return null;
  const wanted = Array.isArray(type) ? new Set(type) : null;
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const typeMatches = wanted
      ? wanted.has(event?.type)
      : type == null || event?.type === type;
    if (!typeMatches) continue;
    if (typeof predicate === "function" && !predicate(event)) continue;
    return event;
  }
  return null;
}

/**
 * A replayable chat message must be a `{ role, content }` object — guard
 * against a corrupt / partially-written / hand-edited event whose `data` is
 * missing, null, or not a message (it would otherwise inject `undefined` into
 * the resumed history and break the next LLM request).
 */
function isReplayableMessage(m) {
  return Boolean(m) && typeof m === "object" && typeof m.role === "string";
}

export function rebuildMessages(sessionId) {
  if (isUnsafeSessionId(sessionId)) return [];
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return [];

  // Scan newest-first and stop at the latest valid compact checkpoint. Memory
  // is therefore proportional to the active context suffix, not transcript
  // size. Without a compact event the full conversation is necessarily the
  // replay state, but the file itself is still never loaded as one giant string.
  const suffix = [];
  let checkpoint = [];
  for (const { line } of iterateFileLinesReverseSync(filePath)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      (event?.type === "compact" ||
        event?.type === "checkpoint_timeline_commit") &&
      Array.isArray(event.data?.messages)
    ) {
      checkpoint = event.data.messages.filter(isReplayableMessage);
      break;
    }
    if (
      event &&
      (event.type === "user_message" ||
        event.type === "assistant_message" ||
        event.type === "system") &&
      isReplayableMessage(event.data)
    ) {
      suffix.push(event.data);
    }
  }
  suffix.reverse();
  return [...checkpoint, ...suffix];
}

/** ISO string for a numeric ms timestamp, or "" when missing / non-finite /
 * invalid — `new Date(undefined).toISOString()` (and `new Date("garbage")`)
 * throw "Invalid time value", and one corrupt event must not crash a whole
 * `cc session list` / `cc session search`. Exported so command-layer readers of
 * the same (hand-editable) JSONL share the guard. */
export function toIsoSafe(ts) {
  if (ts == null) return ""; // null/undefined → "" (Number(null) is 0 = epoch)
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function rebuildSessionMeta(sessionId) {
  const dir = getSessionsDir();
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return null;
  return withFileLock(
    filePath,
    () => {
      let meta = emptySessionMeta(sessionId);
      for (const { line } of iterateFileLinesSync(filePath)) {
        try {
          const event = JSON.parse(line);
          meta = applyEventToSessionMeta(meta, event, event?.hash);
        } catch {
          // The validator/repair path reports malformed records. The index
          // remains a best-effort projection over all intact events.
        }
      }
      return replaceSessionMeta(dir, meta);
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
    },
  );
}

/** Read canonical session metadata without loading the transcript body. */
export function getJsonlSessionMetadata(sessionId) {
  if (isUnsafeSessionId(sessionId) || !sessionExists(sessionId)) return null;
  const dir = getSessionsDir();
  const meta = readSessionMeta(dir, sessionId) || rebuildSessionMeta(sessionId);
  return meta ? publicSessionMeta(meta) : null;
}

export function listJsonlSessions(options = {}) {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];

  const limit = options.limit || 20;
  const sessionIds = listSessionIds();
  let indexed = listIndexedSessions(dir, {
    limit,
    hasSession: (id) => sessionExists(id),
  });

  // First use after upgrade (or a lost/corrupt rebuildable index): stream each
  // legacy transcript once to seed its small sidecar and activity record.
  const expected = Math.min(Math.max(0, Number(limit) || 0), sessionIds.length);
  if (indexed.length < expected) {
    const rebuilt = [];
    for (const id of sessionIds) {
      const meta = readSessionMeta(dir, id);
      rebuilt.push(meta || rebuildSessionMeta(id));
    }
    // Directory enumeration order is not activity order. Re-append the rebuilt
    // snapshots oldest-first so reverse journal reads preserve the transcript
    // timestamps even on the first post-upgrade listing.
    for (const meta of rebuilt
      .filter(Boolean)
      .sort((a, b) => (a.updated_at_ms || 0) - (b.updated_at_ms || 0))) {
      recordSessionActivity(dir, meta);
    }
    indexed = listIndexedSessions(dir, {
      limit,
      hasSession: (id) => sessionExists(id),
    });
  }
  return indexed;
}

/**
 * Rename a session (gap-analysis 2026-07-11 P1 "命名会话"): appends a
 * `session_rename` event so the hash chain stays intact (no rewrite). The
 * LAST rename wins when listing/showing.
 */
export function renameSession(sessionId, title) {
  if (!sessionExists(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const normalized = String(title || "").trim();
  if (!normalized) throw new Error("A non-empty title is required");
  appendEvent(sessionId, "session_rename", { title: normalized.slice(0, 200) });
  return { id: sessionId, title: normalized.slice(0, 200) };
}

/** Delete the canonical transcript under its writer lock and publish a
 * rebuildable tombstone so an already-waiting stale writer cannot resurrect
 * the session after the deletion commits. */
export function deleteJsonlSession(sessionId) {
  if (isUnsafeSessionId(sessionId)) return false;
  const filePath = sessionPath(sessionId);
  if (!existsSync(filePath)) return false;
  return withFileLock(
    filePath,
    () => {
      if (!existsSync(filePath)) return false;
      rmSync(filePath, { force: true });
      try {
        recordSessionDeleted(getSessionsDir(), sessionId);
      } catch (error) {
        // writeMetaAtomic precedes the activity-journal append. If only the
        // rebuildable journal lock/release failed, the durable sidecar still
        // prevents a stale writer from resurrecting this deleted session.
        if (readSessionMeta(getSessionsDir(), sessionId)?.deleted !== true) {
          throw error;
        }
      }
      return true;
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
      yieldAfterReleaseMs: 2,
    },
  );
}

/**
 * Prune old sessions (gap-analysis 2026-07-11 P1 "保留期限"): delete session
 * transcripts whose LAST activity is older than `olderThanDays`, always
 * keeping the newest `keep` (default 10) regardless of age. Dry-run returns
 * the same shape without deleting.
 */
export function pruneJsonlSessions(options = {}) {
  const olderThanDays = Number(options.olderThanDays);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error(
      "prune requires --older-than <days> (a non-negative number)",
    );
  }
  const keep = Number.isFinite(Number(options.keep))
    ? Math.max(0, Math.floor(Number(options.keep)))
    : 10;
  const now = typeof options.now === "number" ? options.now : Date.now();
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  // listJsonlSessions sorts by last activity DESC — the first `keep` entries
  // survive unconditionally.
  const all = listJsonlSessions({ limit: 100000 });
  const candidates = all.slice(keep).filter((s) => {
    const last = Date.parse(s.updated_at || s.created_at || "");
    return Number.isFinite(last) && last < cutoff;
  });
  const deleted = [];
  for (const s of candidates) {
    if (options.dryRun === true) {
      deleted.push(s.id);
      continue;
    }
    try {
      if (deleteJsonlSession(s.id)) deleted.push(s.id);
    } catch {
      /* per-file failures never abort the sweep */
    }
  }
  return {
    scanned: all.length,
    kept: all.length - deleted.length,
    deleted,
    dryRun: options.dryRun === true,
  };
}

export function forkSession(sourceId) {
  const events = readEvents(sourceId);
  if (events.length === 0) return null;

  const newId = `session-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;
  const filePath = sessionPath(newId);

  for (const event of events) {
    const line = JSON.stringify(event) + "\n";
    appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
  }
  ensurePrivateFile(filePath);

  rebuildSessionMeta(newId);

  appendEvent(newId, "system", {
    role: "system",
    content: `[Forked from session ${sourceId}]`,
  });

  return newId;
}

/**
 * Create an independent BRANCH session ("从这里分支" — P0-3's fourth restore
 * action) that keeps a parent's conversation up to a chosen turn and diverges
 * from there. Unlike forkSession() (whole-session copy, random id, no lineage),
 * this writes ONLY the caller-supplied pre-branch messages under a deterministic
 * id (see deriveBranchSessionId) and records parent lineage — so the origin
 * session is never touched (preservesParent) and a replayed branch request
 * resolves to the SAME file instead of a duplicate (idempotent).
 *
 * @param {object} params
 * @param {string} params.branchSessionId   deterministic branch id
 * @param {string|null} [params.parentSessionId]
 * @param {string|null} [params.parentTurnId]
 * @param {Array<{role:string,content:any}>} [params.messages]  pre-branch turns
 * @param {{title?:string,provider?:string,model?:string}} [params.meta]
 * @returns {{branchSessionId:string, created:boolean, messages:number}}
 */
export function createBranchSession({
  branchSessionId,
  parentSessionId = null,
  parentTurnId = null,
  messages = [],
  meta = {},
} = {}) {
  if (isUnsafeSessionId(branchSessionId)) {
    throw new Error(
      `unsafe branch session id: ${String(branchSessionId).slice(0, 60)}`,
    );
  }
  // Idempotent: a replayed branch request resolves to the existing branch
  // rather than doubling it (matches deriveBranchId's determinism).
  if (existsSync(sessionPath(branchSessionId))) {
    return { branchSessionId, created: false, messages: 0 };
  }

  startSession(branchSessionId, {
    title: meta.title || `Branch of ${parentSessionId ?? "session"}`,
    provider: meta.provider || "",
    model: meta.model || "",
  });
  appendEvent(branchSessionId, "session_branch", {
    parentSessionId: parentSessionId == null ? null : String(parentSessionId),
    parentTurnId: parentTurnId == null ? null : String(parentTurnId),
  });

  let count = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.role == null) continue;
    if (m.role === "user") {
      appendUserMessage(branchSessionId, m.content);
      count += 1;
    } else if (m.role === "assistant") {
      appendAssistantMessage(branchSessionId, m.content);
      count += 1;
    }
    // system prompt + tool scaffolding are re-established on resume; skip here.
  }
  return { branchSessionId, created: true, messages: count };
}

export function sessionExists(sessionId) {
  if (isUnsafeSessionId(sessionId)) return false; // never resolve a traversal id
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
  if (isUnsafeSessionId(sessionId)) {
    return {
      sessionId,
      valid: false,
      reason: "invalid session id",
      malformedLines: 0,
      eventCount: 0,
    };
  }
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

  let malformedLines = 0;
  let eventCount = 0;
  let messageCount = 0;
  let hasStartEvent = false;
  for (const { line } of iterateFileLinesSync(filePath)) {
    try {
      const event = JSON.parse(line);
      eventCount += 1;
      if (event?.type === "session_start") hasStartEvent = true;
      if (
        event?.type === "user_message" ||
        event?.type === "assistant_message"
      ) {
        messageCount += 1;
      }
    } catch {
      malformedLines++;
    }
  }

  return {
    sessionId,
    valid: malformedLines === 0 && hasStartEvent,
    malformedLines,
    eventCount,
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

  // A legacy file carries its OWN `id` (payload.id), so a crafted file could
  // name a traversal target like "../../evil". sessionPath() throws on write
  // (the backstop), but fail-fast HERE with a clear reason so the migration
  // doesn't burn retry attempts on a deterministic error.
  if (isUnsafeSessionId(sessionId)) {
    return {
      file: sourcePath,
      sessionId,
      migrated: false,
      failed: true,
      dryRun: Boolean(options.dryRun),
      reason: "unsafe session id in legacy file",
    };
  }

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
    // Verify EVERY legacy message persisted, by event count — NOT by
    // `messageCount`, which counts only user_message/assistant_message events.
    // A legacy `system` message becomes a `system` event and a `tool` message a
    // `tool_result` event (see appendLegacyMessage); neither is a "message" by
    // that count, so comparing messageCount to legacy.messages.length wrongly
    // FAILED migration for any session with a system prompt or tool call.
    // appendLegacyMessage writes exactly one event per message, plus the leading
    // session_start and an optional trailing summary event.
    const expectedEvents =
      1 + legacy.messages.length + (legacy.summary ? 1 : 0);
    if (!validation.valid || validation.eventCount !== expectedEvents) {
      throw new Error(
        `post-migration validation failed for ${sessionId} (${validation.eventCount}/${expectedEvents} events)`,
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
