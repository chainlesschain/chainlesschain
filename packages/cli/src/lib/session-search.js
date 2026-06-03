/**
 * Session Search Index — cross-session FTS5 full-text search.
 *
 * Enables searching across all past agent sessions using SQLite FTS5.
 * Indexes message content on SessionEnd and provides search with
 * snippet highlighting.
 *
 * Inspired by Hermes Agent's cross-session FTS5 search.
 *
 * @module session-search
 */

import {
  readEvents,
  listJsonlSessions,
} from "../harness/jsonl-session-store.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CONTENT_LENGTH = 10000; // per message, prevent bloat
const DEFAULT_SEARCH_LIMIT = 10;

// ─── SessionSearchIndex ─────────────────────────────────────────────────────

export class SessionSearchIndex {
  /**
   * @param {object} db - better-sqlite3 database instance
   */
  constructor(db) {
    this._db = db;
    this._initialized = false;
  }

  /**
   * Ensure FTS5 virtual table exists.
   */
  ensureTables() {
    if (!this._db) return;
    this._db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
        session_id UNINDEXED,
        role UNINDEXED,
        content,
        timestamp UNINDEXED,
        tokenize='unicode61'
      )
    `);
    this._initialized = true;
  }

  /**
   * Extract text messages from a JSONL session.
   * @param {string} sessionId
   * @returns {Array<{role: string, content: string, timestamp: number}>}
   */
  extractMessages(sessionId) {
    const events = readEvents(sessionId);
    const messages = [];

    for (const event of events) {
      if (event.type === "user_message" || event.type === "assistant_message") {
        const content = event.data?.content;
        if (content && typeof content === "string" && content.trim()) {
          messages.push({
            role:
              event.data.role ||
              (event.type === "user_message" ? "user" : "assistant"),
            content: content.substring(0, MAX_CONTENT_LENGTH),
            timestamp: event.timestamp || 0,
          });
        }
      }
    }

    return messages;
  }

  /**
   * Index a single session's messages into the FTS table.
   * Removes existing entries for this session first (idempotent).
   *
   * @param {string} sessionId
   * @returns {{ indexed: number }} count of messages indexed
   */
  indexSession(sessionId) {
    if (!this._db) return { indexed: 0 };
    if (!this._initialized) this.ensureTables();

    const messages = this.extractMessages(sessionId);
    if (messages.length === 0) return { indexed: 0 };

    // Remove existing entries for this session (idempotent re-index)
    this._db.exec(
      `DELETE FROM session_fts WHERE session_id = '${sessionId.replace(/'/g, "''")}'`,
    );

    const insert = this._db.prepare(
      `INSERT INTO session_fts (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
    );

    const insertMany = this._db.transaction((msgs) => {
      for (const msg of msgs) {
        insert.run(sessionId, msg.role, msg.content, String(msg.timestamp));
      }
    });

    insertMany(messages);
    return { indexed: messages.length };
  }

  /**
   * Search across all indexed sessions.
   *
   * @param {string} query - FTS5 search query
   * @param {object} [options]
   * @param {number} [options.limit=10] - Max results
   * @returns {Array<{sessionId: string, role: string, snippet: string, timestamp: string, rank: number}>}
   */
  search(query, options = {}) {
    if (!this._db) return [];
    if (!this._initialized) this.ensureTables();
    if (!query || !query.trim()) return [];

    const limit = options.limit || DEFAULT_SEARCH_LIMIT;

    // Use FTS5 match with highlight for snippet extraction
    const stmt = this._db.prepare(`
      SELECT
        session_id as sessionId,
        role,
        highlight(session_fts, 2, '>>>', '<<<') as snippet,
        timestamp,
        rank
      FROM session_fts
      WHERE session_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    try {
      return stmt.all(query, limit);
    } catch (_err) {
      // FTS5 syntax error (e.g. special chars) — try as quoted phrase
      try {
        return stmt.all(`"${query.replace(/"/g, '""')}"`, limit);
      } catch (_err2) {
        return [];
      }
    }
  }

  /**
   * Reindex all existing JSONL sessions into FTS.
   * Useful for one-time backfill of historical sessions.
   *
   * @returns {{ sessions: number, messages: number }}
   */
  reindexAll() {
    if (!this._db) return { sessions: 0, messages: 0 };
    if (!this._initialized) this.ensureTables();

    // Clear all existing FTS data
    this._db.exec(`DELETE FROM session_fts`);

    const sessions = listJsonlSessions({ limit: 10000 });
    let totalMessages = 0;

    for (const session of sessions) {
      const result = this.indexSession(session.id);
      totalMessages += result.indexed;
    }

    return { sessions: sessions.length, messages: totalMessages };
  }

  /**
   * Get index statistics.
   * @returns {{ totalRows: number }}
   */
  getStats() {
    if (!this._db) return { totalRows: 0 };
    if (!this._initialized) this.ensureTables();

    try {
      const row = this._db
        .prepare(`SELECT COUNT(*) as cnt FROM session_fts`)
        .get();
      return { totalRows: row?.cnt || 0 };
    } catch (_err) {
      return { totalRows: 0 };
    }
  }
}

// ===== V2 Surface: Session Search governance overlay (CLI v0.142.0) =====
export const SSCH_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const SSCH_QUERY_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SEARCHING: "searching",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _sschPTrans = new Map([
  [
    SSCH_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SSCH_PROFILE_MATURITY_V2.ACTIVE,
      SSCH_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SSCH_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SSCH_PROFILE_MATURITY_V2.STALE,
      SSCH_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SSCH_PROFILE_MATURITY_V2.STALE,
    new Set([
      SSCH_PROFILE_MATURITY_V2.ACTIVE,
      SSCH_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SSCH_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _sschPTerminal = new Set([SSCH_PROFILE_MATURITY_V2.ARCHIVED]);
const _sschQTrans = new Map([
  [
    SSCH_QUERY_LIFECYCLE_V2.QUEUED,
    new Set([
      SSCH_QUERY_LIFECYCLE_V2.SEARCHING,
      SSCH_QUERY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SSCH_QUERY_LIFECYCLE_V2.SEARCHING,
    new Set([
      SSCH_QUERY_LIFECYCLE_V2.COMPLETED,
      SSCH_QUERY_LIFECYCLE_V2.FAILED,
      SSCH_QUERY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SSCH_QUERY_LIFECYCLE_V2.COMPLETED, new Set()],
  [SSCH_QUERY_LIFECYCLE_V2.FAILED, new Set()],
  [SSCH_QUERY_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _sschPsV2 = new Map();
const _sschQsV2 = new Map();
let _sschMaxActive = 8,
  _sschMaxPending = 20,
  _sschIdleMs = 30 * 24 * 60 * 60 * 1000,
  _sschStuckMs = 30 * 1000;
function _sschPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _sschCheckP(from, to) {
  const a = _sschPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ssch profile transition ${from} → ${to}`);
}
function _sschCheckQ(from, to) {
  const a = _sschQTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ssch query transition ${from} → ${to}`);
}
export function setMaxActiveSschProfilesPerOwnerV2(n) {
  _sschMaxActive = _sschPos(n, "maxActiveSschProfilesPerOwner");
}
export function getMaxActiveSschProfilesPerOwnerV2() {
  return _sschMaxActive;
}
export function setMaxPendingSschQueriesPerProfileV2(n) {
  _sschMaxPending = _sschPos(n, "maxPendingSschQueriesPerProfile");
}
export function getMaxPendingSschQueriesPerProfileV2() {
  return _sschMaxPending;
}
export function setSschProfileIdleMsV2(n) {
  _sschIdleMs = _sschPos(n, "sschProfileIdleMs");
}
export function getSschProfileIdleMsV2() {
  return _sschIdleMs;
}
export function setSschQueryStuckMsV2(n) {
  _sschStuckMs = _sschPos(n, "sschQueryStuckMs");
}
export function getSschQueryStuckMsV2() {
  return _sschStuckMs;
}
export function _resetStateSessionSearchV2() {
  _sschPsV2.clear();
  _sschQsV2.clear();
  _sschMaxActive = 8;
  _sschMaxPending = 20;
  _sschIdleMs = 30 * 24 * 60 * 60 * 1000;
  _sschStuckMs = 30 * 1000;
}
export function registerSschProfileV2({ id, owner, scope, metadata } = {}) {
  if (!id) throw new Error("ssch profile id required");
  if (!owner) throw new Error("ssch profile owner required");
  if (_sschPsV2.has(id))
    throw new Error(`ssch profile ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    scope: scope || "all",
    status: SSCH_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _sschPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _sschCountActive(owner) {
  let n = 0;
  for (const p of _sschPsV2.values())
    if (p.owner === owner && p.status === SSCH_PROFILE_MATURITY_V2.ACTIVE) n++;
  return n;
}
export function activateSschProfileV2(id) {
  const p = _sschPsV2.get(id);
  if (!p) throw new Error(`ssch profile ${id} not found`);
  _sschCheckP(p.status, SSCH_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === SSCH_PROFILE_MATURITY_V2.STALE;
  if (!recovery && _sschCountActive(p.owner) >= _sschMaxActive)
    throw new Error(`max active ssch profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SSCH_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleSschProfileV2(id) {
  const p = _sschPsV2.get(id);
  if (!p) throw new Error(`ssch profile ${id} not found`);
  _sschCheckP(p.status, SSCH_PROFILE_MATURITY_V2.STALE);
  p.status = SSCH_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSschProfileV2(id) {
  const p = _sschPsV2.get(id);
  if (!p) throw new Error(`ssch profile ${id} not found`);
  _sschCheckP(p.status, SSCH_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SSCH_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSschProfileV2(id) {
  const p = _sschPsV2.get(id);
  if (!p) throw new Error(`ssch profile ${id} not found`);
  if (_sschPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ssch profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSschProfileV2(id) {
  const p = _sschPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSschProfilesV2() {
  return [..._sschPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
function _sschCountPending(profileId) {
  let n = 0;
  for (const q of _sschQsV2.values())
    if (
      q.profileId === profileId &&
      (q.status === SSCH_QUERY_LIFECYCLE_V2.QUEUED ||
        q.status === SSCH_QUERY_LIFECYCLE_V2.SEARCHING)
    )
      n++;
  return n;
}
export function createSschQueryV2({ id, profileId, q, metadata } = {}) {
  if (!id) throw new Error("ssch query id required");
  if (!profileId) throw new Error("ssch query profileId required");
  if (_sschQsV2.has(id)) throw new Error(`ssch query ${id} already exists`);
  if (!_sschPsV2.has(profileId))
    throw new Error(`ssch profile ${profileId} not found`);
  if (_sschCountPending(profileId) >= _sschMaxPending)
    throw new Error(
      `max pending ssch queries for profile ${profileId} reached`,
    );
  const now = Date.now();
  const r = {
    id,
    profileId,
    q: q || "",
    status: SSCH_QUERY_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sschQsV2.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
export function searchingSschQueryV2(id) {
  const r = _sschQsV2.get(id);
  if (!r) throw new Error(`ssch query ${id} not found`);
  _sschCheckQ(r.status, SSCH_QUERY_LIFECYCLE_V2.SEARCHING);
  const now = Date.now();
  r.status = SSCH_QUERY_LIFECYCLE_V2.SEARCHING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function completeSschQueryV2(id) {
  const r = _sschQsV2.get(id);
  if (!r) throw new Error(`ssch query ${id} not found`);
  _sschCheckQ(r.status, SSCH_QUERY_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  r.status = SSCH_QUERY_LIFECYCLE_V2.COMPLETED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failSschQueryV2(id, reason) {
  const r = _sschQsV2.get(id);
  if (!r) throw new Error(`ssch query ${id} not found`);
  _sschCheckQ(r.status, SSCH_QUERY_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = SSCH_QUERY_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelSschQueryV2(id, reason) {
  const r = _sschQsV2.get(id);
  if (!r) throw new Error(`ssch query ${id} not found`);
  _sschCheckQ(r.status, SSCH_QUERY_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = SSCH_QUERY_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getSschQueryV2(id) {
  const r = _sschQsV2.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listSschQueriesV2() {
  return [..._sschQsV2.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}
export function autoStaleIdleSschProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _sschPsV2.values())
    if (
      p.status === SSCH_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _sschIdleMs
    ) {
      p.status = SSCH_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSschQueriesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _sschQsV2.values())
    if (
      r.status === SSCH_QUERY_LIFECYCLE_V2.SEARCHING &&
      r.startedAt != null &&
      t - r.startedAt >= _sschStuckMs
    ) {
      r.status = SSCH_QUERY_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}
export function getSessionSearchGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SSCH_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _sschPsV2.values()) profilesByStatus[p.status]++;
  const queriesByStatus = {};
  for (const v of Object.values(SSCH_QUERY_LIFECYCLE_V2))
    queriesByStatus[v] = 0;
  for (const r of _sschQsV2.values()) queriesByStatus[r.status]++;
  return {
    totalSschProfilesV2: _sschPsV2.size,
    totalSschQueriesV2: _sschQsV2.size,
    maxActiveSschProfilesPerOwner: _sschMaxActive,
    maxPendingSschQueriesPerProfile: _sschMaxPending,
    sschProfileIdleMs: _sschIdleMs,
    sschQueryStuckMs: _sschStuckMs,
    profilesByStatus,
    queriesByStatus,
  };
}
