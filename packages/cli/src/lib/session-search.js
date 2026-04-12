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
