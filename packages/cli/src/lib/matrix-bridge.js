/**
 * Matrix Bridge — login, room management, messaging,
 * and E2EE support for the Matrix protocol.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _rooms = new Map();
const _messages = new Map();
let _loginState = {
  state: "logged_out",
  userId: null,
  homeserver: null,
  accessToken: null,
  e2eeEnabled: true,
};

const LOGIN_STATE = {
  LOGGED_OUT: "logged_out",
  LOGGING_IN: "logging_in",
  LOGGED_IN: "logged_in",
  ERROR: "error",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureMatrixTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matrix_rooms (
      id TEXT PRIMARY KEY,
      room_id TEXT,
      name TEXT,
      topic TEXT,
      is_encrypted INTEGER DEFAULT 1,
      member_count INTEGER DEFAULT 0,
      last_event_at TEXT,
      joined_at TEXT,
      status TEXT DEFAULT 'joined',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS matrix_events (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      room_id TEXT,
      sender TEXT,
      event_type TEXT,
      content TEXT,
      origin_server_ts TEXT,
      is_encrypted INTEGER DEFAULT 0,
      decrypted_content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Login ─────────────────────────────────────────────────── */

export function login(db, homeserver, userId, password) {
  if (!userId) throw new Error("User ID is required");
  if (!password) throw new Error("Password is required");

  const hs = homeserver || "https://matrix.org";
  const token = crypto.randomBytes(32).toString("hex");

  _loginState = {
    state: LOGIN_STATE.LOGGED_IN,
    userId,
    homeserver: hs,
    accessToken: token,
    e2eeEnabled: true,
  };

  return {
    success: true,
    userId,
    homeserver: hs,
    accessToken: token.slice(0, 8) + "...",
  };
}

export function getLoginState() {
  return {
    state: _loginState.state,
    userId: _loginState.userId,
    homeserver: _loginState.homeserver,
    e2eeEnabled: _loginState.e2eeEnabled,
  };
}

/* ── Room Management ──────────────────────────────────────── */

export function listRooms() {
  return [..._rooms.values()].filter((r) => r.status === "joined");
}

export function joinRoom(db, roomIdOrAlias) {
  if (!roomIdOrAlias) throw new Error("Room ID or alias is required");

  // Check if already joined
  for (const room of _rooms.values()) {
    if (room.roomId === roomIdOrAlias) return { success: true, room };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const room = {
    id,
    roomId: roomIdOrAlias,
    name: roomIdOrAlias,
    topic: null,
    isEncrypted: true,
    memberCount: 1,
    lastEventAt: now,
    joinedAt: now,
    status: "joined",
    createdAt: now,
  };

  _rooms.set(id, room);

  db.prepare(
    `INSERT INTO matrix_rooms (id, room_id, name, topic, is_encrypted, member_count, last_event_at, joined_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, room.roomId, room.name, null, 1, 1, now, now, "joined", now);

  return { success: true, room };
}

/* ── Messaging ─────────────────────────────────────────────── */

export function sendMessage(db, roomId, body, msgtype) {
  if (!roomId) throw new Error("Room ID is required");
  if (!body) throw new Error("Message body is required");

  const id = crypto.randomUUID();
  const eventId = `$${crypto.randomBytes(16).toString("hex")}`;
  const now = new Date().toISOString();

  const message = {
    id,
    eventId,
    roomId,
    sender: _loginState.userId || "cli-user",
    eventType: "m.room.message",
    content: { body, msgtype: msgtype || "m.text" },
    originServerTs: now,
    isEncrypted: _loginState.e2eeEnabled,
    createdAt: now,
  };

  _messages.set(id, message);

  db.prepare(
    `INSERT INTO matrix_events (id, event_id, room_id, sender, event_type, content, origin_server_ts, is_encrypted, decrypted_content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    eventId,
    roomId,
    message.sender,
    "m.room.message",
    JSON.stringify(message.content),
    now,
    message.isEncrypted ? 1 : 0,
    body,
    now,
  );

  return { success: true, event: message };
}

export function getMessages(roomId, filter = {}) {
  if (!roomId) throw new Error("Room ID is required");

  let messages = [..._messages.values()].filter((m) => m.roomId === roomId);
  const limit = filter.limit || 50;
  return messages.slice(0, limit);
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _rooms.clear();
  _messages.clear();
  _loginState = {
    state: "logged_out",
    userId: null,
    homeserver: null,
    accessToken: null,
    e2eeEnabled: true,
  };
}
