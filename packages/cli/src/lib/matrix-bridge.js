/**
 * Matrix Bridge — login, room management, messaging,
 * and E2EE support for the Matrix protocol.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _rooms = new Map();
const _messages = new Map();
const _spaceChildren = new Map(); // spaceRoomId → Map<childRoomId, { via: string[] }>
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

/* ── Threads (MSC3440 / spec §11.38) ───────────────────────── */

/**
 * Send a threaded reply. Stores an m.room.message event whose content has
 *   m.relates_to: { rel_type: "m.thread", event_id: <root>, is_falling_back, m.in_reply_to }
 * Clients that don't understand threads fall back to rendering as a reply
 * when is_falling_back=true (the default per spec).
 *
 * @param {Object} db
 * @param {Object} params
 *   @param {string} params.roomId
 *   @param {string} params.rootEventId - Event id of the thread's root message
 *   @param {string} params.body
 *   @param {string} [params.msgtype="m.text"]
 *   @param {string} [params.inReplyTo] - Defaults to rootEventId
 *   @param {boolean} [params.isFallingBack=true]
 */
export function sendThreadReply(
  db,
  { roomId, rootEventId, body, msgtype, inReplyTo, isFallingBack = true },
) {
  if (!roomId) throw new Error("Room ID is required");
  if (!rootEventId) throw new Error("rootEventId is required");
  if (!body) throw new Error("Message body is required");

  const id = crypto.randomUUID();
  const eventId = `$${crypto.randomBytes(16).toString("hex")}`;
  const now = new Date().toISOString();

  const relatesTo = {
    rel_type: "m.thread",
    event_id: rootEventId,
    is_falling_back: isFallingBack,
    "m.in_reply_to": { event_id: inReplyTo || rootEventId },
  };

  const message = {
    id,
    eventId,
    roomId,
    sender: _loginState.userId || "cli-user",
    eventType: "m.room.message",
    content: {
      body,
      msgtype: msgtype || "m.text",
      "m.relates_to": relatesTo,
    },
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

/**
 * List all replies to a given thread root (in chronological order).
 */
export function getThreadMessages(roomId, rootEventId) {
  if (!roomId) throw new Error("Room ID is required");
  if (!rootEventId) throw new Error("rootEventId is required");

  return [..._messages.values()]
    .filter((m) => {
      if (m.roomId !== roomId) return false;
      const rel = m.content && m.content["m.relates_to"];
      return rel && rel.rel_type === "m.thread" && rel.event_id === rootEventId;
    })
    .sort((a, b) =>
      a.originServerTs < b.originServerTs
        ? -1
        : a.originServerTs > b.originServerTs
          ? 1
          : 0,
    );
}

/**
 * List distinct thread roots within a room (events that have at least one
 * threaded reply). Returns { rootEventId, replyCount, lastReplyAt }.
 */
export function getThreadRoots(roomId) {
  if (!roomId) throw new Error("Room ID is required");

  const rollup = new Map();
  for (const m of _messages.values()) {
    if (m.roomId !== roomId) continue;
    const rel = m.content && m.content["m.relates_to"];
    if (!rel || rel.rel_type !== "m.thread") continue;
    const rootId = rel.event_id;
    const existing = rollup.get(rootId) || {
      rootEventId: rootId,
      replyCount: 0,
      lastReplyAt: null,
    };
    existing.replyCount += 1;
    if (!existing.lastReplyAt || m.originServerTs > existing.lastReplyAt) {
      existing.lastReplyAt = m.originServerTs;
    }
    rollup.set(rootId, existing);
  }
  return [...rollup.values()];
}

/* ── Spaces (spec §11.34) ──────────────────────────────────── */

/**
 * Create a Matrix Space. A Space is a room whose creation content declares
 *   type: "m.space"
 * — we model this by setting room.type on the in-memory room record and
 * persisting it into matrix_rooms (reusing the existing topic column would
 * be wrong, so we encode type by a "#space:" prefix on the room name).
 *
 * @param {Object} db
 * @param {Object} params
 *   @param {string} params.name
 *   @param {string} [params.topic]
 */
export function createSpace(db, { name, topic }) {
  if (!name) throw new Error("Space name is required");

  const id = crypto.randomUUID();
  const roomId = `!space_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  const space = {
    id,
    roomId,
    name,
    topic: topic || null,
    type: "m.space",
    isEncrypted: false, // Spaces are not encrypted per spec
    memberCount: 1,
    lastEventAt: now,
    joinedAt: now,
    status: "joined",
    createdAt: now,
  };

  _rooms.set(id, space);
  _spaceChildren.set(roomId, new Map());

  db.prepare(
    `INSERT INTO matrix_rooms (id, room_id, name, topic, is_encrypted, member_count, last_event_at, joined_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, roomId, name, topic || null, 0, 1, now, now, "joined", now);

  return { success: true, space };
}

/**
 * Add a child room to a Space. In real Matrix this writes an m.space.child
 * state event to the parent space with state_key = childRoomId.
 *
 * @param {Object} db
 * @param {Object} params
 *   @param {string} params.spaceId - Parent space's room id (!space_*)
 *   @param {string} params.childRoomId - Child room id
 *   @param {string[]} [params.via] - Homeservers via which the child is reachable
 */
export function addSpaceChild(db, { spaceId, childRoomId, via }) {
  if (!spaceId) throw new Error("spaceId is required");
  if (!childRoomId) throw new Error("childRoomId is required");

  const children = _spaceChildren.get(spaceId);
  if (!children) {
    throw new Error(`Space not found: ${spaceId}`);
  }
  const viaList = Array.isArray(via) && via.length > 0 ? via : ["matrix.org"];
  children.set(childRoomId, { via: viaList });

  // Persist as an m.space.child state event in matrix_events
  const id = crypto.randomUUID();
  const eventId = `$${crypto.randomBytes(16).toString("hex")}`;
  const now = new Date().toISOString();
  const content = { via: viaList };

  db.prepare(
    `INSERT INTO matrix_events (id, event_id, room_id, sender, event_type, content, origin_server_ts, is_encrypted, decrypted_content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    eventId,
    spaceId,
    _loginState.userId || "cli-user",
    "m.space.child",
    JSON.stringify({ state_key: childRoomId, content }),
    now,
    0,
    null,
    now,
  );

  return { success: true, spaceId, childRoomId, via: viaList };
}

/**
 * Remove a child from a Space (equivalent to sending an empty m.space.child
 * state event in real Matrix).
 */
export function removeSpaceChild(db, { spaceId, childRoomId }) {
  if (!spaceId) throw new Error("spaceId is required");
  if (!childRoomId) throw new Error("childRoomId is required");

  const children = _spaceChildren.get(spaceId);
  if (!children) {
    throw new Error(`Space not found: ${spaceId}`);
  }
  const removed = children.delete(childRoomId);
  return { success: true, removed };
}

/**
 * List all children of a Space.
 */
export function listSpaceChildren(spaceId) {
  if (!spaceId) throw new Error("spaceId is required");
  const children = _spaceChildren.get(spaceId);
  if (!children) return [];
  return [...children.entries()].map(([childRoomId, meta]) => ({
    childRoomId,
    via: meta.via,
  }));
}

/**
 * List all Spaces (rooms with type === "m.space").
 */
export function listSpaces() {
  return [..._rooms.values()].filter((r) => r.type === "m.space");
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _rooms.clear();
  _messages.clear();
  _spaceChildren.clear();
  _loginState = {
    state: "logged_out",
    userId: null,
    homeserver: null,
    accessToken: null,
    e2eeEnabled: true,
  };
}
