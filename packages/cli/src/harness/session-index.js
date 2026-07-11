/**
 * Session index (gap-2026-07-11 P2#14) — a SQLite index over the append-only
 * JSONL session store.
 *
 * The JSONL files stay the source of truth (append-only, hash-chained,
 * tamper-evident — see jsonl-session-store.js + transcript-integrity.js). But
 * listing/searching them means reading and parsing every file on every call,
 * which does not scale past a few hundred sessions. This index gives O(1) list
 * ordering and indexed content search, and stays in sync incrementally by
 * file mtime+size so a resume/fork/search/verify is cheap.
 *
 * The index is a derived cache: it can be deleted and fully rebuilt from the
 * JSONL at any time (`syncIndex({ force: true })`). Nothing authoritative lives
 * only here.
 *
 * `Database` is injected via `_deps` so tests run against an in-memory SQLite
 * without touching the user's home dir.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { getHomeDir } from "../lib/paths.js";
import { readEvents, toIsoSafe } from "./jsonl-session-store.js";
import { latestChainHash } from "./transcript-integrity.js";

const requireCjs = createRequire(import.meta.url);

// Lazy so importing this module never forces the native addon to load (matters
// for fast CLI paths and for environments where better-sqlite3 is unavailable).
export const _deps = {
  Database: null,
  loadDatabase() {
    if (!_deps.Database) {
      _deps.Database = requireCjs("better-sqlite3");
    }
    return _deps.Database;
  },
};

function sessionsDir() {
  return join(getHomeDir(), "sessions");
}

function indexPath() {
  const dir = getHomeDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "session-index.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  provider      TEXT,
  model         TEXT,
  message_count INTEGER,
  event_count   INTEGER,
  created_at    TEXT,
  updated_at    TEXT,
  last_ts       INTEGER,
  chain_hash    TEXT,
  mtime_ms      INTEGER,
  size_bytes    INTEGER
);
CREATE TABLE IF NOT EXISTS session_content (
  id   TEXT PRIMARY KEY,
  text TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_ts ON sessions(last_ts DESC);
`;

/**
 * Open (and migrate) the index database. Caller owns closing it. Pass
 * `{ file: ":memory:" }` for tests.
 */
export function openIndex({ file } = {}) {
  const Database = _deps.loadDatabase();
  const db = new Database(file || indexPath());
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Max characters of concatenated message content indexed per session. */
const CONTENT_CAP = 200_000;

function summarizeEvents(id, events) {
  const startEvent = events.find((e) => e.type === "session_start");
  const lastEvent = events[events.length - 1];
  const messageCount = events.filter(
    (e) => e.type === "user_message" || e.type === "assistant_message",
  ).length;
  const parts = [];
  let used = 0;
  for (const e of events) {
    if (e.type !== "user_message" && e.type !== "assistant_message") continue;
    const c = e.data?.content;
    const s = typeof c === "string" ? c : c == null ? "" : JSON.stringify(c);
    if (!s) continue;
    parts.push(s);
    used += s.length;
    if (used >= CONTENT_CAP) break;
  }
  return {
    id,
    title: startEvent?.data?.title || "Untitled",
    provider: startEvent?.data?.provider || "",
    model: startEvent?.data?.model || "",
    message_count: messageCount,
    event_count: events.length,
    created_at: toIsoSafe(startEvent?.timestamp),
    updated_at: toIsoSafe(lastEvent?.timestamp),
    last_ts: lastEvent?.timestamp || 0,
    content: parts.join("\n").slice(0, CONTENT_CAP),
  };
}

const UPSERT_SESSION = `
INSERT INTO sessions
  (id,title,provider,model,message_count,event_count,created_at,updated_at,last_ts,chain_hash,mtime_ms,size_bytes)
VALUES (@id,@title,@provider,@model,@message_count,@event_count,@created_at,@updated_at,@last_ts,@chain_hash,@mtime_ms,@size_bytes)
ON CONFLICT(id) DO UPDATE SET
  title=@title, provider=@provider, model=@model, message_count=@message_count,
  event_count=@event_count, created_at=@created_at, updated_at=@updated_at,
  last_ts=@last_ts, chain_hash=@chain_hash, mtime_ms=@mtime_ms, size_bytes=@size_bytes
`;

/**
 * Index (or re-index) a single session from its JSONL into `db`.
 * @returns {boolean} true if a row was written.
 */
export function indexOneSession(db, id, { mtimeMs = 0, sizeBytes = 0 } = {}) {
  const events = readEvents(id);
  if (events.length === 0) return false;
  const s = summarizeEvents(id, events);
  const filePath = join(sessionsDir(), `${id}.jsonl`);
  let chainHash = "";
  try {
    chainHash = latestChainHash(readFileSync(filePath, "utf-8")) || "";
  } catch {
    /* chain hash is best-effort */
  }
  db.prepare(UPSERT_SESSION).run({
    id: s.id,
    title: s.title,
    provider: s.provider,
    model: s.model,
    message_count: s.message_count,
    event_count: s.event_count,
    created_at: s.created_at,
    updated_at: s.updated_at,
    last_ts: s.last_ts,
    chain_hash: chainHash,
    mtime_ms: Math.floor(mtimeMs),
    size_bytes: sizeBytes,
  });
  db.prepare(
    "INSERT INTO session_content (id,text) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text",
  ).run(s.id, s.content);
  return true;
}

/**
 * Incrementally sync the index with the sessions dir. A session is re-indexed
 * only when its file mtime or size changed since last time (or `force`).
 * Deleted JSONL files have their index rows removed.
 * @returns {{ scanned, updated, removed, total }}
 */
export function syncIndex(db, { force = false } = {}) {
  const dir = sessionsDir();
  let scanned = 0;
  let updated = 0;
  let removed = 0;
  const seen = new Set();

  if (existsSync(dir)) {
    const known = new Map(
      db
        .prepare("SELECT id, mtime_ms, size_bytes FROM sessions")
        .all()
        .map((r) => [r.id, r]),
    );
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    const tx = db.transaction((entries) => {
      for (const { id, mtimeMs, size } of entries) {
        seen.add(id);
        scanned++;
        const prev = known.get(id);
        if (
          !force &&
          prev &&
          prev.mtime_ms === Math.floor(mtimeMs) &&
          prev.size_bytes === size
        ) {
          continue; // unchanged
        }
        if (indexOneSession(db, id, { mtimeMs, sizeBytes: size })) updated++;
      }
    });
    const entries = [];
    for (const f of files) {
      const id = basename(f, ".jsonl");
      let st;
      try {
        st = statSync(join(dir, f));
      } catch {
        continue;
      }
      entries.push({ id, mtimeMs: st.mtimeMs, size: st.size });
    }
    tx(entries);

    // Drop rows whose JSONL no longer exists.
    for (const id of known.keys()) {
      if (!seen.has(id)) {
        db.prepare("DELETE FROM sessions WHERE id=?").run(id);
        db.prepare("DELETE FROM session_content WHERE id=?").run(id);
        removed++;
      }
    }
  }

  const total = db.prepare("SELECT COUNT(*) c FROM sessions").get().c;
  return { scanned, updated, removed, total };
}

const LIST_COLUMNS =
  "id,title,provider,model,message_count,event_count,created_at,updated_at";

/** List indexed sessions, newest activity first. */
export function listSessions(db, { limit = 20 } = {}) {
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM sessions ORDER BY last_ts DESC, event_count DESC LIMIT ?`,
    )
    .all(Math.max(1, limit | 0));
}

/**
 * Full-text-ish search over session titles and message content (LIKE). Returns
 * matched sessions with a short snippet around the first hit.
 */
export function searchSessions(db, query, { limit = 20 } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const rows = db
    .prepare(
      `SELECT s.${LIST_COLUMNS.split(",").join(", s.")}, c.text AS _text
       FROM sessions s LEFT JOIN session_content c ON c.id = s.id
       WHERE s.title LIKE ? ESCAPE '\\' OR c.text LIKE ? ESCAPE '\\'
       ORDER BY s.last_ts DESC LIMIT ?`,
    )
    .all(like, like, Math.max(1, limit | 0));
  const needle = q.toLowerCase();
  return rows.map((r) => {
    const text = r._text || "";
    const at = text.toLowerCase().indexOf(needle);
    const snippet =
      at >= 0
        ? text
            .slice(Math.max(0, at - 40), at + q.length + 40)
            .replace(/\s+/g, " ")
            .trim()
        : "";
    const { _text, ...rest } = r;
    return { ...rest, snippet };
  });
}

/** One indexed session row, or null. */
export function getIndexedSession(db, id) {
  return db.prepare(`SELECT * FROM sessions WHERE id=?`).get(id) || null;
}

/** Index-wide counters for `cc doctor` / `cc session index --stats`. */
export function indexStats(db) {
  const row = db
    .prepare(
      "SELECT COUNT(*) sessions, COALESCE(SUM(message_count),0) messages, COALESCE(SUM(event_count),0) events FROM sessions",
    )
    .get();
  return {
    sessions: row.sessions,
    messages: row.messages,
    events: row.events,
  };
}
