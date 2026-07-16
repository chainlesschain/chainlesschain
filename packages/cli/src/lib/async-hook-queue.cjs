"use strict";

/**
 * async-hook-queue — a small, best-effort, PERSISTENT queue for async settings
 * hooks that opted into `asyncRewake: true` and finished in a FAILURE state.
 *
 * Why: AsyncHookSupervisor runs `async: true` hooks fire-and-forget and keeps
 * their results ONLY in memory (`_results`/`_rewakes`). A rewake is the one
 * actionable signal it produces — "a background check (e.g. `npm test`) failed,
 * re-engage the agent with the error". If the process dies (crash, kill,
 * hard exit) after the rewake was recorded but BEFORE the turn loop drained and
 * surfaced it, that signal is silently lost: the next `--resume` of the same
 * session has no idea a background check failed.
 *
 * This module gives the supervisor a durable place to park undrained rewakes,
 * keyed by session id, so `--resume <id>` can recover them. The gap's P2 "Hooks"
 * item calls for an "async hook 持久队列"; this is the reliability half of it
 * (paired with the already-shipped `allowManagedHooksOnly`).
 *
 * Lifecycle (rewake-scoped on purpose — non-rewake results are informational and
 * cheap to lose; rewakes are the failure signal worth surviving a crash):
 *   record a rewake  → appendRewake()  (immediate write, survives even SIGKILL)
 *   drain / surface  → removeRewakes() (consumed → no longer pending)
 *   resume a session → takePending()   (load + clear that session's bucket)
 *
 * Design mirrors hook-stats-store.cjs: pure folds (no clock/RNG/fs inside), an
 * injected fs for load/save, atomic tmp+rename writes, and per-session +
 * per-session-count bounds so a runaway producer never grows the file without
 * bound. Every path is best-effort — a corrupt/io-failed queue file must never
 * block a hook or the agent.
 */

const os = require("node:os");
const path = require("node:path");
const fsDefault = require("node:fs");

const CONFIG_DIR_NAME = ".chainlesschain";
const MAX_RECORDS_PER_SESSION = 200; // drop oldest-recorded beyond this
const MAX_SESSIONS = 100; // bound distinct session buckets
const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000; // prune buckets untouched >7d

/** Default on-disk location (matches the ESM getHomeDir() layout). */
function defaultAsyncHookQueuePath() {
  return path.join(os.homedir(), CONFIG_DIR_NAME, "async-hook-queue.json");
}

/**
 * Stable de-dupe key for one rewake record. Two records with the same
 * (command, event, ts, ms, exitCode) are treated as the same pending item —
 * enough to make removeRewakes() idempotent and appendRewake() not double-store
 * a record that a caller replays. Pure, no hashing needed.
 */
function queueEntryKey(rec) {
  if (!rec || typeof rec !== "object") return "";
  return [
    String(rec.command || ""),
    String(rec.event || ""),
    String(rec.ts ?? ""),
    String(rec.ms ?? ""),
    String(rec.exitCode ?? ""),
  ].join("|");
}

/** Normalize a raw supervisor record into a compact stored rewake entry. */
function normalizeRecord(rec) {
  if (!rec || typeof rec !== "object") return null;
  const command = String(rec.command || "").trim();
  if (!command) return null;
  return {
    command,
    event: rec.event ?? null,
    exitCode: rec.exitCode ?? null,
    error: rec.error ? String(rec.error) : null,
    additionalContext: rec.additionalContext
      ? String(rec.additionalContext)
      : null,
    blocked: !!rec.blocked,
    ts: Number.isFinite(Number(rec.ts)) ? Number(rec.ts) : 0,
    ms: Number.isFinite(Number(rec.ms)) ? Number(rec.ms) : 0,
  };
}

/** Fresh empty queue. */
function emptyQueue() {
  return { sessions: {} };
}

/** Coerce an arbitrary parsed value into the queue shape. */
function coerceQueue(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.sessions !== "object" ||
    !parsed.sessions
  ) {
    return emptyQueue();
  }
  return { sessions: parsed.sessions };
}

/**
 * PURE fold: append `records` into `queue` under `sessionId` (mutates + returns
 * `queue`). De-dupes by queueEntryKey, keeps the most-recent MAX_RECORDS_PER_
 * SESSION, and stamps the bucket's `updatedAt` for stale pruning. `now` is
 * supplied by the caller so the fold stays clock-free.
 */
function foldAppend(queue, sessionId, records, now) {
  if (!queue || typeof queue !== "object") queue = emptyQueue();
  if (!queue.sessions) queue.sessions = {};
  const id = String(sessionId || "").trim();
  if (!id) return queue;
  const list = Array.isArray(records) ? records : [records];
  const bucket = queue.sessions[id] || { records: [], updatedAt: 0 };
  const seen = new Set(bucket.records.map(queueEntryKey));
  for (const raw of list) {
    const rec = normalizeRecord(raw);
    if (!rec) continue;
    const key = queueEntryKey(rec);
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.records.push(rec);
  }
  // Never persist an empty bucket (all-invalid input, or nothing new for a
  // session that had none) — it would just be dead weight in the file.
  if (bucket.records.length === 0) return queue;
  if (bucket.records.length > MAX_RECORDS_PER_SESSION) {
    bucket.records = bucket.records.slice(
      bucket.records.length - MAX_RECORDS_PER_SESSION,
    );
  }
  bucket.updatedAt = Number.isFinite(Number(now))
    ? Number(now)
    : bucket.updatedAt;
  queue.sessions[id] = bucket;
  boundSessions(queue);
  return queue;
}

/**
 * PURE fold: remove `records` (by key) from `sessionId`'s bucket (mutates +
 * returns `queue`). Empties → the bucket is deleted so the file self-cleans.
 */
function foldRemove(queue, sessionId, records) {
  if (!queue || !queue.sessions) return queue || emptyQueue();
  const id = String(sessionId || "").trim();
  const bucket = queue.sessions[id];
  if (!bucket) return queue;
  const kill = new Set(
    (Array.isArray(records) ? records : [records])
      .map(normalizeRecord)
      .filter(Boolean)
      .map(queueEntryKey),
  );
  bucket.records = bucket.records.filter((r) => !kill.has(queueEntryKey(r)));
  if (bucket.records.length === 0) delete queue.sessions[id];
  return queue;
}

/** Keep only the MAX_SESSIONS most-recently-updated buckets. */
function boundSessions(queue) {
  if (!queue || !queue.sessions) return queue;
  const ids = Object.keys(queue.sessions);
  if (ids.length <= MAX_SESSIONS) return queue;
  ids
    .sort(
      (a, b) =>
        (queue.sessions[a].updatedAt || 0) - (queue.sessions[b].updatedAt || 0),
    )
    .slice(0, ids.length - MAX_SESSIONS)
    .forEach((id) => delete queue.sessions[id]);
  return queue;
}

/**
 * PURE fold: drop buckets whose `updatedAt` is older than `now - staleMs`
 * (mutates + returns `queue`). Guards the file against unbounded growth from
 * sessions that were never resumed to drain their pending rewakes.
 */
function foldPruneStale(queue, now, staleMs = DEFAULT_STALE_MS) {
  if (!queue || !queue.sessions) return queue || emptyQueue();
  const cutoff = (Number.isFinite(Number(now)) ? Number(now) : 0) - staleMs;
  for (const [id, bucket] of Object.entries(queue.sessions)) {
    if (!bucket || (bucket.updatedAt || 0) < cutoff) delete queue.sessions[id];
  }
  return queue;
}

/** Best-effort read of the on-disk queue (→ empty on missing/corrupt). */
function loadQueue(file = defaultAsyncHookQueuePath(), fs = fsDefault) {
  try {
    if (!fs.existsSync(file)) return emptyQueue();
    return coerceQueue(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch {
    return emptyQueue();
  }
}

/** Best-effort atomic write (tmp + rename). Never throws. */
function saveQueue(queue, file = defaultAsyncHookQueuePath(), fs = fsDefault) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(queue), "utf-8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one/more rewake records for `sessionId` and write back. Best-effort;
 * returns true on a successful write. `now` defaults to Date.now() (the only
 * non-pure entry point besides load/save).
 */
function appendRewake(
  { sessionId, records, now } = {},
  file = defaultAsyncHookQueuePath(),
  fs = fsDefault,
) {
  const id = String(sessionId || "").trim();
  if (!id || records == null) return false;
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const queue = foldAppend(loadQueue(file, fs), id, records, at);
  return saveQueue(queue, file, fs);
}

/**
 * Remove (mark consumed) rewake records for `sessionId` and write back.
 * Best-effort; a no-op when nothing matches.
 */
function removeRewakes(
  { sessionId, records } = {},
  file = defaultAsyncHookQueuePath(),
  fs = fsDefault,
) {
  const id = String(sessionId || "").trim();
  if (!id || records == null) return false;
  const queue = foldRemove(loadQueue(file, fs), id, records);
  return saveQueue(queue, file, fs);
}

/**
 * Load a session's pending rewakes AND clear its bucket (also prunes stale
 * buckets while we hold the file). Returns the recovered records (possibly []).
 * The single call a resuming runner makes on startup.
 */
function takePending(
  { sessionId, now, staleMs } = {},
  file = defaultAsyncHookQueuePath(),
  fs = fsDefault,
) {
  const id = String(sessionId || "").trim();
  if (!id) return [];
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  let queue = loadQueue(file, fs);
  const bucket = queue.sessions[id];
  const recovered =
    bucket && Array.isArray(bucket.records) ? bucket.records : [];
  if (bucket) delete queue.sessions[id];
  queue = foldPruneStale(queue, at, staleMs);
  // Only rewrite if we actually changed something (recovered a bucket or the
  // prune dropped one) — a pure read of an empty/unrelated queue leaves the
  // file byte-unchanged.
  if (recovered.length > 0 || bucket) saveQueue(queue, file, fs);
  return recovered;
}

module.exports = {
  defaultAsyncHookQueuePath,
  queueEntryKey,
  normalizeRecord,
  emptyQueue,
  coerceQueue,
  foldAppend,
  foldRemove,
  foldPruneStale,
  boundSessions,
  loadQueue,
  saveQueue,
  appendRewake,
  removeRewakes,
  takePending,
  MAX_RECORDS_PER_SESSION,
  MAX_SESSIONS,
  DEFAULT_STALE_MS,
};
