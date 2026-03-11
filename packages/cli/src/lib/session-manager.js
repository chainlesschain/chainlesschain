/**
 * Session manager for CLI
 *
 * Persists chat/agent conversations to DB for resume and export.
 * Lightweight port of desktop-app-vue/src/main/llm/session-manager.js
 */

import { createHash } from "crypto";

function ensureSessionsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_sessions (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT 'Untitled',
      provider TEXT DEFAULT '',
      model TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      messages TEXT DEFAULT '[]',
      summary TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Create a new session
 */
export function createSession(db, options = {}) {
  ensureSessionsTable(db);

  const id =
    options.id ||
    `session-${Date.now()}-${createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 6)}`;

  db.prepare(
    `INSERT INTO llm_sessions (id, title, provider, model, messages) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.title || "Untitled",
    options.provider || "",
    options.model || "",
    JSON.stringify(options.messages || []),
  );

  return { id, title: options.title || "Untitled" };
}

/**
 * Add a message to a session
 */
export function addMessage(db, sessionId, role, content) {
  ensureSessionsTable(db);

  const session = db
    .prepare("SELECT messages, message_count FROM llm_sessions WHERE id = ?")
    .get(sessionId);

  if (!session) return null;

  const messages = JSON.parse(session.messages || "[]");
  messages.push({ role, content, timestamp: new Date().toISOString() });

  db.prepare(
    `UPDATE llm_sessions SET messages = ?, message_count = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(messages), messages.length, sessionId);

  return { messageCount: messages.length };
}

/**
 * Save all messages at once (batch update)
 */
export function saveMessages(db, sessionId, messages) {
  ensureSessionsTable(db);

  const result = db
    .prepare(
      `UPDATE llm_sessions SET messages = ?, message_count = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(JSON.stringify(messages), messages.length, sessionId);

  return { messageCount: messages.length, updated: result.changes > 0 };
}

/**
 * Get a session by ID
 */
export function getSession(db, sessionId) {
  ensureSessionsTable(db);

  // Try exact match first, then prefix match
  let session = db
    .prepare("SELECT * FROM llm_sessions WHERE id = ?")
    .get(sessionId);

  if (!session) {
    session = db
      .prepare("SELECT * FROM llm_sessions WHERE id LIKE ? LIMIT 1")
      .get(`${sessionId}%`);
  }

  if (!session) return null;

  return {
    ...session,
    messages: JSON.parse(session.messages || "[]"),
  };
}

/**
 * List all sessions
 */
export function listSessions(db, options = {}) {
  ensureSessionsTable(db);

  const limit = options.limit || 20;

  return db
    .prepare(
      `SELECT id, title, provider, model, message_count, summary, created_at, updated_at
       FROM llm_sessions
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

/**
 * Update session title or summary
 */
export function updateSession(db, sessionId, updates) {
  ensureSessionsTable(db);

  if (updates.title) {
    db.prepare(
      "UPDATE llm_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(updates.title, sessionId);
  }
  if (updates.summary) {
    db.prepare(
      "UPDATE llm_sessions SET summary = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(updates.summary, sessionId);
  }
}

/**
 * Delete a session
 */
export function deleteSession(db, sessionId) {
  ensureSessionsTable(db);
  const result = db
    .prepare("DELETE FROM llm_sessions WHERE id = ?")
    .run(sessionId);
  return result.changes > 0;
}

/**
 * Export session as markdown
 */
export function exportSessionMarkdown(session) {
  const lines = [
    `# ${session.title}`,
    "",
    `- **Created**: ${session.created_at}`,
    `- **Provider**: ${session.provider || "unknown"}`,
    `- **Model**: ${session.model || "unknown"}`,
    `- **Messages**: ${session.message_count}`,
    "",
    "---",
    "",
  ];

  const messages =
    typeof session.messages === "string"
      ? JSON.parse(session.messages)
      : session.messages || [];

  for (const msg of messages) {
    if (msg.role === "system") continue;
    const label = msg.role === "user" ? "**You**" : "**AI**";
    lines.push(`### ${label}`);
    lines.push("");
    lines.push(msg.content || "");
    lines.push("");
  }

  return lines.join("\n");
}
