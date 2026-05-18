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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Session governance layer.
 * Tracks conversation maturity + turn lifecycle independent of
 * legacy llm_sessions SQLite store above.
 * ═══════════════════════════════════════════════════════════════ */

export const CONVERSATION_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});

export const TURN_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  STREAMING: "streaming",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const CONV_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["active", "archived"])],
  ["active", new Set(["paused", "archived"])],
  ["paused", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const CONV_TERMINALS_V2 = new Set(["archived"]);

const TURN_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["streaming", "cancelled"])],
  ["streaming", new Set(["completed", "failed", "cancelled"])],
  ["completed", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);
const TURN_TERMINALS_V2 = new Set(["completed", "failed", "cancelled"]);

export const SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER = 50;
export const SESSION_DEFAULT_MAX_PENDING_TURNS_PER_CONV = 3;
export const SESSION_DEFAULT_CONV_IDLE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const SESSION_DEFAULT_TURN_STUCK_MS = 1000 * 60 * 5; // 5 min

const _conversationsV2 = new Map();
const _turnsV2 = new Map();
let _maxActiveConvPerUserV2 = SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER;
let _maxPendingTurnsPerConvV2 = SESSION_DEFAULT_MAX_PENDING_TURNS_PER_CONV;
let _convIdleMsV2 = SESSION_DEFAULT_CONV_IDLE_MS;
let _turnStuckMsV2 = SESSION_DEFAULT_TURN_STUCK_MS;

function _posIntSessionV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveConvPerUserV2() {
  return _maxActiveConvPerUserV2;
}
export function setMaxActiveConvPerUserV2(n) {
  _maxActiveConvPerUserV2 = _posIntSessionV2(n, "maxActiveConvPerUser");
}
export function getMaxPendingTurnsPerConvV2() {
  return _maxPendingTurnsPerConvV2;
}
export function setMaxPendingTurnsPerConvV2(n) {
  _maxPendingTurnsPerConvV2 = _posIntSessionV2(n, "maxPendingTurnsPerConv");
}
export function getConvIdleMsV2() {
  return _convIdleMsV2;
}
export function setConvIdleMsV2(n) {
  _convIdleMsV2 = _posIntSessionV2(n, "convIdleMs");
}
export function getTurnStuckMsV2() {
  return _turnStuckMsV2;
}
export function setTurnStuckMsV2(n) {
  _turnStuckMsV2 = _posIntSessionV2(n, "turnStuckMs");
}

export function getActiveConvCountV2(userId) {
  let n = 0;
  for (const c of _conversationsV2.values()) {
    if (c.userId === userId && c.status === "active") n += 1;
  }
  return n;
}

export function getPendingTurnCountV2(conversationId) {
  let n = 0;
  for (const t of _turnsV2.values()) {
    if (
      t.conversationId === conversationId &&
      (t.status === "pending" || t.status === "streaming")
    )
      n += 1;
  }
  return n;
}

function _copyConvV2(c) {
  return { ...c, metadata: { ...c.metadata } };
}
function _copyTurnV2(t) {
  return { ...t, metadata: { ...t.metadata } };
}

export function registerConversationV2(
  id,
  { userId, model, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!userId || typeof userId !== "string")
    throw new Error("userId must be a string");
  if (!model || typeof model !== "string")
    throw new Error("model must be a string");
  if (_conversationsV2.has(id))
    throw new Error(`conversation ${id} already exists`);
  const c = {
    id,
    userId,
    model,
    status: "draft",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _conversationsV2.set(id, c);
  return _copyConvV2(c);
}

export function getConversationV2(id) {
  const c = _conversationsV2.get(id);
  return c ? _copyConvV2(c) : null;
}

export function listConversationsV2({ userId, status } = {}) {
  const out = [];
  for (const c of _conversationsV2.values()) {
    if (userId && c.userId !== userId) continue;
    if (status && c.status !== status) continue;
    out.push(_copyConvV2(c));
  }
  return out;
}

export function setConversationStatusV2(id, next, { now = Date.now() } = {}) {
  const c = _conversationsV2.get(id);
  if (!c) throw new Error(`conversation ${id} not found`);
  if (!CONV_TRANSITIONS_V2.has(next))
    throw new Error(`unknown conversation status: ${next}`);
  if (CONV_TERMINALS_V2.has(c.status))
    throw new Error(`conversation ${id} is in terminal state ${c.status}`);
  const allowed = CONV_TRANSITIONS_V2.get(c.status);
  if (!allowed.has(next))
    throw new Error(
      `cannot transition conversation from ${c.status} to ${next}`,
    );
  if (next === "active") {
    if (c.status === "draft") {
      const count = getActiveConvCountV2(c.userId);
      if (count >= _maxActiveConvPerUserV2)
        throw new Error(
          `user ${c.userId} already at active-conversation cap (${_maxActiveConvPerUserV2})`,
        );
    }
    if (!c.activatedAt) c.activatedAt = now;
  }
  if (next === "archived" && !c.archivedAt) c.archivedAt = now;
  c.status = next;
  c.lastSeenAt = now;
  return _copyConvV2(c);
}

export function activateConversationV2(id, opts) {
  return setConversationStatusV2(id, "active", opts);
}
export function pauseConversationV2(id, opts) {
  return setConversationStatusV2(id, "paused", opts);
}
export function archiveConversationV2(id, opts) {
  return setConversationStatusV2(id, "archived", opts);
}

export function touchConversationV2(id, { now = Date.now() } = {}) {
  const c = _conversationsV2.get(id);
  if (!c) throw new Error(`conversation ${id} not found`);
  c.lastSeenAt = now;
  return _copyConvV2(c);
}

export function createTurnV2(
  id,
  { conversationId, role = "user", metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!conversationId || typeof conversationId !== "string")
    throw new Error("conversationId must be a string");
  if (_turnsV2.has(id)) throw new Error(`turn ${id} already exists`);
  const count = getPendingTurnCountV2(conversationId);
  if (count >= _maxPendingTurnsPerConvV2)
    throw new Error(
      `conversation ${conversationId} already at pending-turn cap (${_maxPendingTurnsPerConvV2})`,
    );
  const t = {
    id,
    conversationId,
    role,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    streamingStartedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _turnsV2.set(id, t);
  return _copyTurnV2(t);
}

export function getTurnV2(id) {
  const t = _turnsV2.get(id);
  return t ? _copyTurnV2(t) : null;
}

export function listTurnsV2({ conversationId, status } = {}) {
  const out = [];
  for (const t of _turnsV2.values()) {
    if (conversationId && t.conversationId !== conversationId) continue;
    if (status && t.status !== status) continue;
    out.push(_copyTurnV2(t));
  }
  return out;
}

export function setTurnStatusV2(id, next, { now = Date.now() } = {}) {
  const t = _turnsV2.get(id);
  if (!t) throw new Error(`turn ${id} not found`);
  if (!TURN_TRANSITIONS_V2.has(next))
    throw new Error(`unknown turn status: ${next}`);
  if (TURN_TERMINALS_V2.has(t.status))
    throw new Error(`turn ${id} is in terminal state ${t.status}`);
  const allowed = TURN_TRANSITIONS_V2.get(t.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition turn from ${t.status} to ${next}`);
  if (next === "streaming" && !t.streamingStartedAt) t.streamingStartedAt = now;
  if (TURN_TERMINALS_V2.has(next) && !t.settledAt) t.settledAt = now;
  t.status = next;
  t.lastSeenAt = now;
  return _copyTurnV2(t);
}

export function streamTurnV2(id, opts) {
  return setTurnStatusV2(id, "streaming", opts);
}
export function completeTurnV2(id, opts) {
  return setTurnStatusV2(id, "completed", opts);
}
export function failTurnV2(id, opts) {
  return setTurnStatusV2(id, "failed", opts);
}
export function cancelTurnV2(id, opts) {
  return setTurnStatusV2(id, "cancelled", opts);
}

export function autoArchiveIdleConversationsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const c of _conversationsV2.values()) {
    if (c.status === "archived" || c.status === "draft") continue;
    if (now - c.lastSeenAt > _convIdleMsV2) {
      c.status = "archived";
      c.lastSeenAt = now;
      if (!c.archivedAt) c.archivedAt = now;
      flipped.push(_copyConvV2(c));
    }
  }
  return flipped;
}

export function autoFailStuckTurnsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const t of _turnsV2.values()) {
    if (t.status !== "streaming") continue;
    const ref = t.streamingStartedAt ?? t.lastSeenAt;
    if (now - ref > _turnStuckMsV2) {
      t.status = "failed";
      t.lastSeenAt = now;
      if (!t.settledAt) t.settledAt = now;
      flipped.push(_copyTurnV2(t));
    }
  }
  return flipped;
}

export function getSessionManagerStatsV2() {
  const conversationsByStatus = {};
  for (const v of Object.values(CONVERSATION_MATURITY_V2))
    conversationsByStatus[v] = 0;
  for (const c of _conversationsV2.values())
    conversationsByStatus[c.status] += 1;

  const turnsByStatus = {};
  for (const v of Object.values(TURN_LIFECYCLE_V2)) turnsByStatus[v] = 0;
  for (const t of _turnsV2.values()) turnsByStatus[t.status] += 1;

  return {
    totalConversationsV2: _conversationsV2.size,
    totalTurnsV2: _turnsV2.size,
    maxActiveConvPerUser: _maxActiveConvPerUserV2,
    maxPendingTurnsPerConv: _maxPendingTurnsPerConvV2,
    convIdleMs: _convIdleMsV2,
    turnStuckMs: _turnStuckMsV2,
    conversationsByStatus,
    turnsByStatus,
  };
}

export function _resetStateSessionManagerV2() {
  _conversationsV2.clear();
  _turnsV2.clear();
  _maxActiveConvPerUserV2 = SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER;
  _maxPendingTurnsPerConvV2 = SESSION_DEFAULT_MAX_PENDING_TURNS_PER_CONV;
  _convIdleMsV2 = SESSION_DEFAULT_CONV_IDLE_MS;
  _turnStuckMsV2 = SESSION_DEFAULT_TURN_STUCK_MS;
}

// =====================================================================
// session-manager V2 governance overlay (iter21)
// =====================================================================
export const SESGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const SESGOV_TURN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ADVANCING: "advancing",
  ADVANCED: "advanced",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _sesgovPTrans = new Map([
  [
    SESGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SESGOV_PROFILE_MATURITY_V2.ACTIVE,
      SESGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SESGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SESGOV_PROFILE_MATURITY_V2.PAUSED,
      SESGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SESGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      SESGOV_PROFILE_MATURITY_V2.ACTIVE,
      SESGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SESGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _sesgovPTerminal = new Set([SESGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _sesgovJTrans = new Map([
  [
    SESGOV_TURN_LIFECYCLE_V2.QUEUED,
    new Set([
      SESGOV_TURN_LIFECYCLE_V2.ADVANCING,
      SESGOV_TURN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SESGOV_TURN_LIFECYCLE_V2.ADVANCING,
    new Set([
      SESGOV_TURN_LIFECYCLE_V2.ADVANCED,
      SESGOV_TURN_LIFECYCLE_V2.FAILED,
      SESGOV_TURN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SESGOV_TURN_LIFECYCLE_V2.ADVANCED, new Set()],
  [SESGOV_TURN_LIFECYCLE_V2.FAILED, new Set()],
  [SESGOV_TURN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _sesgovPsV2 = new Map();
const _sesgovJsV2 = new Map();
let _sesgovMaxActive = 8,
  _sesgovMaxPending = 20,
  _sesgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _sesgovStuckMs = 60 * 1000;
function _sesgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _sesgovCheckP(from, to) {
  const a = _sesgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid sesgov profile transition ${from} → ${to}`);
}
function _sesgovCheckJ(from, to) {
  const a = _sesgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid sesgov turn transition ${from} → ${to}`);
}
function _sesgovCountActive(owner) {
  let c = 0;
  for (const p of _sesgovPsV2.values())
    if (p.owner === owner && p.status === SESGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _sesgovCountPending(profileId) {
  let c = 0;
  for (const j of _sesgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SESGOV_TURN_LIFECYCLE_V2.QUEUED ||
        j.status === SESGOV_TURN_LIFECYCLE_V2.ADVANCING)
    )
      c++;
  return c;
}
export function setMaxActiveSesgovProfilesPerOwnerV2(n) {
  _sesgovMaxActive = _sesgovPos(n, "maxActiveSesgovProfilesPerOwner");
}
export function getMaxActiveSesgovProfilesPerOwnerV2() {
  return _sesgovMaxActive;
}
export function setMaxPendingSesgovTurnsPerProfileV2(n) {
  _sesgovMaxPending = _sesgovPos(n, "maxPendingSesgovTurnsPerProfile");
}
export function getMaxPendingSesgovTurnsPerProfileV2() {
  return _sesgovMaxPending;
}
export function setSesgovProfileIdleMsV2(n) {
  _sesgovIdleMs = _sesgovPos(n, "sesgovProfileIdleMs");
}
export function getSesgovProfileIdleMsV2() {
  return _sesgovIdleMs;
}
export function setSesgovTurnStuckMsV2(n) {
  _sesgovStuckMs = _sesgovPos(n, "sesgovTurnStuckMs");
}
export function getSesgovTurnStuckMsV2() {
  return _sesgovStuckMs;
}
export function _resetStateSessionManagerGovV2() {
  _sesgovPsV2.clear();
  _sesgovJsV2.clear();
  _sesgovMaxActive = 8;
  _sesgovMaxPending = 20;
  _sesgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _sesgovStuckMs = 60 * 1000;
}
export function registerSesgovProfileV2({ id, owner, channel, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_sesgovPsV2.has(id))
    throw new Error(`sesgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    channel: channel || "default",
    status: SESGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sesgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateSesgovProfileV2(id) {
  const p = _sesgovPsV2.get(id);
  if (!p) throw new Error(`sesgov profile ${id} not found`);
  const isInitial = p.status === SESGOV_PROFILE_MATURITY_V2.PENDING;
  _sesgovCheckP(p.status, SESGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _sesgovCountActive(p.owner) >= _sesgovMaxActive)
    throw new Error(`max active sesgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SESGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseSesgovProfileV2(id) {
  const p = _sesgovPsV2.get(id);
  if (!p) throw new Error(`sesgov profile ${id} not found`);
  _sesgovCheckP(p.status, SESGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = SESGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveSesgovProfileV2(id) {
  const p = _sesgovPsV2.get(id);
  if (!p) throw new Error(`sesgov profile ${id} not found`);
  _sesgovCheckP(p.status, SESGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SESGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchSesgovProfileV2(id) {
  const p = _sesgovPsV2.get(id);
  if (!p) throw new Error(`sesgov profile ${id} not found`);
  if (_sesgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal sesgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getSesgovProfileV2(id) {
  const p = _sesgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listSesgovProfilesV2() {
  return [..._sesgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createSesgovTurnV2({ id, profileId, topic, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_sesgovJsV2.has(id)) throw new Error(`sesgov turn ${id} already exists`);
  if (!_sesgovPsV2.has(profileId))
    throw new Error(`sesgov profile ${profileId} not found`);
  if (_sesgovCountPending(profileId) >= _sesgovMaxPending)
    throw new Error(
      `max pending sesgov turns for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    topic: topic || "",
    status: SESGOV_TURN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _sesgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function advancingSesgovTurnV2(id) {
  const j = _sesgovJsV2.get(id);
  if (!j) throw new Error(`sesgov turn ${id} not found`);
  _sesgovCheckJ(j.status, SESGOV_TURN_LIFECYCLE_V2.ADVANCING);
  const now = Date.now();
  j.status = SESGOV_TURN_LIFECYCLE_V2.ADVANCING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeTurnSesgovV2(id) {
  const j = _sesgovJsV2.get(id);
  if (!j) throw new Error(`sesgov turn ${id} not found`);
  _sesgovCheckJ(j.status, SESGOV_TURN_LIFECYCLE_V2.ADVANCED);
  const now = Date.now();
  j.status = SESGOV_TURN_LIFECYCLE_V2.ADVANCED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failSesgovTurnV2(id, reason) {
  const j = _sesgovJsV2.get(id);
  if (!j) throw new Error(`sesgov turn ${id} not found`);
  _sesgovCheckJ(j.status, SESGOV_TURN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SESGOV_TURN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelSesgovTurnV2(id, reason) {
  const j = _sesgovJsV2.get(id);
  if (!j) throw new Error(`sesgov turn ${id} not found`);
  _sesgovCheckJ(j.status, SESGOV_TURN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SESGOV_TURN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getSesgovTurnV2(id) {
  const j = _sesgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listSesgovTurnsV2() {
  return [..._sesgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleSesgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _sesgovPsV2.values())
    if (
      p.status === SESGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _sesgovIdleMs
    ) {
      p.status = SESGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckSesgovTurnsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _sesgovJsV2.values())
    if (
      j.status === SESGOV_TURN_LIFECYCLE_V2.ADVANCING &&
      j.startedAt != null &&
      t - j.startedAt >= _sesgovStuckMs
    ) {
      j.status = SESGOV_TURN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getSessionManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SESGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _sesgovPsV2.values()) profilesByStatus[p.status]++;
  const turnsByStatus = {};
  for (const v of Object.values(SESGOV_TURN_LIFECYCLE_V2)) turnsByStatus[v] = 0;
  for (const j of _sesgovJsV2.values()) turnsByStatus[j.status]++;
  return {
    totalSesgovProfilesV2: _sesgovPsV2.size,
    totalSesgovTurnsV2: _sesgovJsV2.size,
    maxActiveSesgovProfilesPerOwner: _sesgovMaxActive,
    maxPendingSesgovTurnsPerProfile: _sesgovMaxPending,
    sesgovProfileIdleMs: _sesgovIdleMs,
    sesgovTurnStuckMs: _sesgovStuckMs,
    profilesByStatus,
    turnsByStatus,
  };
}
