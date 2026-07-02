/**
 * `/sessions` REPL command — list recent RESUMABLE conversations (Claude-Code
 * `/resume` parity, read-only half + mirrors the VS Code panel's /sessions).
 * Where `/session` shows the CURRENT session, this lists past ones (across the
 * DB + JSONL stores, via lib/recent-session.js listRecentSessions) with the
 * ids you can pass to `cc agent --resume <id>`.
 *
 * Pure: renders the listRecentSessions row shape
 *   { id, title?, message_count?, updated_at?, _store? }
 * The REPL gathers the rows + supplies the current id.
 */

/**
 * @param {Array} sessions  listRecentSessions() rows
 * @param {{currentId?:string, limit?:number}} [opts]
 * @returns {string}
 */
export function renderRecentSessions(sessions, opts = {}) {
  const limit = opts.limit || 15;
  const list = Array.isArray(sessions) ? sessions : [];
  if (list.length === 0) {
    return "No recent sessions found. Start chatting, or resume one later with `cc agent --resume <id>`.";
  }

  const lines = ["Recent sessions (resume with `cc agent --resume <id>`):"];
  for (const s of list.slice(0, limit)) {
    const id = String(s?.id || "");
    if (!id) continue;
    const current =
      opts.currentId && id === opts.currentId ? "  ← current" : "";
    const store = s._store ? `[${s._store}]` : "";
    const msgs = Number.isFinite(s.message_count)
      ? `${s.message_count} msgs`
      : "";
    const when = s.updated_at
      ? String(s.updated_at).slice(0, 19).replace("T", " ")
      : "";
    const title = s.title && s.title !== "Untitled" ? ` — ${s.title}` : "";
    const meta = [store, msgs, when].filter(Boolean).join(" · ");
    lines.push(`  ${id.slice(0, 12)}${current}  ${meta}${title}`);
  }
  if (list.length > limit) {
    lines.push(`  … +${list.length - limit} more`);
  }
  return lines.join("\n");
}
