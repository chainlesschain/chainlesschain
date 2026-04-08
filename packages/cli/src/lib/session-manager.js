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
      metadata TEXT DEFAULT '{}',
      summary TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  try {
    db.exec("ALTER TABLE llm_sessions ADD COLUMN metadata TEXT DEFAULT '{}'");
  } catch (_error) {
    // Column already exists or ALTER TABLE is unsupported by the mock DB.
  }
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
    `INSERT INTO llm_sessions (id, title, provider, model, messages, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.title || "Untitled",
    options.provider || "",
    options.model || "",
    JSON.stringify(options.messages || []),
    JSON.stringify(options.metadata || {}),
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
export function saveMessages(db, sessionId, messages, metadata) {
  ensureSessionsTable(db);

  const hasMetadata = metadata !== undefined;
  const result = hasMetadata
    ? db
        .prepare(
          `UPDATE llm_sessions SET messages = ?, metadata = ?, message_count = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(
          JSON.stringify(messages),
          JSON.stringify(metadata || {}),
          messages.length,
          sessionId,
        )
    : db
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
    metadata:
      typeof session.metadata === "string"
        ? JSON.parse(session.metadata || "{}")
        : session.metadata || {},
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
      , metadata
       FROM llm_sessions
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((session) => ({
      ...session,
      metadata:
        typeof session.metadata === "string"
          ? JSON.parse(session.metadata || "{}")
          : session.metadata || {},
    }));
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
  if (updates.metadata !== undefined) {
    db.prepare(
      "UPDATE llm_sessions SET metadata = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(updates.metadata || {}), sessionId);
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
 * Compress a session's messages using a context engineering compact function.
 * Reduces stored message count while preserving important context.
 *
 * @param {object} db - Database instance
 * @param {string} sessionId - Session to compress
 * @param {function} compactFn - (messages, options) => compacted messages
 * @param {object} [options] - Options passed to compactFn
 * @returns {{ original: number, compressed: number }}
 */
export function compressSession(db, sessionId, compactFn, options = {}) {
  ensureSessionsTable(db);

  const session = db
    .prepare("SELECT messages FROM llm_sessions WHERE id = ?")
    .get(sessionId);

  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const messages = JSON.parse(session.messages || "[]");
  if (messages.length <= 5) {
    return { original: messages.length, compressed: messages.length };
  }

  const compacted = compactFn(messages, options);

  db.prepare(
    `UPDATE llm_sessions SET messages = ?, message_count = ?, summary = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    JSON.stringify(compacted),
    compacted.length,
    `Compressed from ${messages.length} to ${compacted.length} messages`,
    sessionId,
  );

  return { original: messages.length, compressed: compacted.length };
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
