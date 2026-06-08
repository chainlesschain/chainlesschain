/**
 * Resolve the most-recent session id across both stores (DB + JSONL).
 *
 * Shared by `cc agent --continue` and `cc session resume` (id-less form) so a
 * user can pick up the last conversation with a one-liner — Claude-Code
 * `claude --continue` parity.
 */

import { listSessions } from "./session-manager.js";
import { listJsonlSessions } from "../harness/jsonl-session-store.js";
import { feature } from "./feature-flags.js";

/**
 * Merge both stores into a single newest-first, id-deduped list.
 *
 * @param {object} ctx   bootstrap() context (may be null; db is optional)
 * @param {object} [opts]
 * @param {number} [opts.scan=20]  how many recent rows to merge per store
 * @returns {Array<object>}  session rows (id, title, message_count, updated_at, _store)
 */
export function listRecentSessions(ctx, opts = {}) {
  const scan = Math.max(1, opts.scan || 20);
  const sessions = [];

  if (ctx && ctx.db) {
    try {
      const db = ctx.db.getDatabase();
      sessions.push(
        ...listSessions(db, { limit: scan }).map((s) => ({
          ...s,
          _store: "db",
        })),
      );
    } catch (err) {
      /* db unavailable — fall through to JSONL */
      void err;
    }
  }

  if (feature("JSONL_SESSION")) {
    try {
      sessions.push(
        ...listJsonlSessions({ limit: scan }).map((s) => ({
          ...s,
          _store: "jsonl",
        })),
      );
    } catch (err) {
      void err;
    }
  }

  // Dedup by id (JSONL precedence via sort+seen), newest updated_at first.
  const seen = new Set();
  return sessions
    .sort((a, b) => ((b.updated_at || "") > (a.updated_at || "") ? 1 : -1))
    .filter((s) => {
      if (!s || !s.id || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
}

/**
 * @param {object} ctx   bootstrap() context (may be null; db is optional)
 * @param {object} [opts] forwarded to {@link listRecentSessions}
 * @returns {string|null}  the most-recently-updated session id, or null
 */
export function resolveMostRecentSessionId(ctx, opts = {}) {
  const sessions = listRecentSessions(ctx, opts);
  return sessions.length > 0 ? sessions[0].id : null;
}
