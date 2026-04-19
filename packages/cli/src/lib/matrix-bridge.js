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

// ===== V2 Surface: Matrix Bridge governance overlay (CLI v0.134.0) =====
export const MX_ROOM_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  MUTED: "muted",
  ARCHIVED: "archived",
});
export const MX_MESSAGE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _mxRoomTrans = new Map([
  [
    MX_ROOM_MATURITY_V2.PENDING,
    new Set([MX_ROOM_MATURITY_V2.ACTIVE, MX_ROOM_MATURITY_V2.ARCHIVED]),
  ],
  [
    MX_ROOM_MATURITY_V2.ACTIVE,
    new Set([MX_ROOM_MATURITY_V2.MUTED, MX_ROOM_MATURITY_V2.ARCHIVED]),
  ],
  [
    MX_ROOM_MATURITY_V2.MUTED,
    new Set([MX_ROOM_MATURITY_V2.ACTIVE, MX_ROOM_MATURITY_V2.ARCHIVED]),
  ],
  [MX_ROOM_MATURITY_V2.ARCHIVED, new Set()],
]);
const _mxRoomTerminal = new Set([MX_ROOM_MATURITY_V2.ARCHIVED]);
const _mxMsgTrans = new Map([
  [
    MX_MESSAGE_LIFECYCLE_V2.QUEUED,
    new Set([
      MX_MESSAGE_LIFECYCLE_V2.SENDING,
      MX_MESSAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    MX_MESSAGE_LIFECYCLE_V2.SENDING,
    new Set([
      MX_MESSAGE_LIFECYCLE_V2.DELIVERED,
      MX_MESSAGE_LIFECYCLE_V2.FAILED,
      MX_MESSAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MX_MESSAGE_LIFECYCLE_V2.DELIVERED, new Set()],
  [MX_MESSAGE_LIFECYCLE_V2.FAILED, new Set()],
  [MX_MESSAGE_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _mxRooms = new Map();
const _mxMsgs = new Map();
let _mxMaxActivePerOwner = 20;
let _mxMaxPendingPerRoom = 40;
let _mxRoomIdleMs = 24 * 60 * 60 * 1000;
let _mxMsgStuckMs = 3 * 60 * 1000;

function _mxPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveMatrixRoomsPerOwnerV2(n) {
  _mxMaxActivePerOwner = _mxPos(n, "maxActiveMatrixRoomsPerOwner");
}
export function getMaxActiveMatrixRoomsPerOwnerV2() {
  return _mxMaxActivePerOwner;
}
export function setMaxPendingMatrixMessagesPerRoomV2(n) {
  _mxMaxPendingPerRoom = _mxPos(n, "maxPendingMatrixMessagesPerRoom");
}
export function getMaxPendingMatrixMessagesPerRoomV2() {
  return _mxMaxPendingPerRoom;
}
export function setMatrixRoomIdleMsV2(n) {
  _mxRoomIdleMs = _mxPos(n, "matrixRoomIdleMs");
}
export function getMatrixRoomIdleMsV2() {
  return _mxRoomIdleMs;
}
export function setMatrixMessageStuckMsV2(n) {
  _mxMsgStuckMs = _mxPos(n, "matrixMessageStuckMs");
}
export function getMatrixMessageStuckMsV2() {
  return _mxMsgStuckMs;
}

export function _resetStateMatrixBridgeV2() {
  _mxRooms.clear();
  _mxMsgs.clear();
  _mxMaxActivePerOwner = 20;
  _mxMaxPendingPerRoom = 40;
  _mxRoomIdleMs = 24 * 60 * 60 * 1000;
  _mxMsgStuckMs = 3 * 60 * 1000;
}

export function registerMatrixRoomV2({ id, owner, alias, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_mxRooms.has(id)) throw new Error(`matrix room ${id} already registered`);
  const now = Date.now();
  const r = {
    id,
    owner,
    alias: alias || id,
    status: MX_ROOM_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _mxRooms.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _mxCheckR(from, to) {
  const a = _mxRoomTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid matrix room transition ${from} → ${to}`);
}
function _mxCountActive(owner) {
  let n = 0;
  for (const r of _mxRooms.values())
    if (r.owner === owner && r.status === MX_ROOM_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateMatrixRoomV2(id) {
  const r = _mxRooms.get(id);
  if (!r) throw new Error(`matrix room ${id} not found`);
  _mxCheckR(r.status, MX_ROOM_MATURITY_V2.ACTIVE);
  const recovery = r.status === MX_ROOM_MATURITY_V2.MUTED;
  if (!recovery) {
    const a = _mxCountActive(r.owner);
    if (a >= _mxMaxActivePerOwner)
      throw new Error(
        `max active matrix rooms per owner (${_mxMaxActivePerOwner}) reached for ${r.owner}`,
      );
  }
  const now = Date.now();
  r.status = MX_ROOM_MATURITY_V2.ACTIVE;
  r.updatedAt = now;
  r.lastTouchedAt = now;
  if (!r.activatedAt) r.activatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function muteMatrixRoomV2(id) {
  const r = _mxRooms.get(id);
  if (!r) throw new Error(`matrix room ${id} not found`);
  _mxCheckR(r.status, MX_ROOM_MATURITY_V2.MUTED);
  r.status = MX_ROOM_MATURITY_V2.MUTED;
  r.updatedAt = Date.now();
  return { ...r, metadata: { ...r.metadata } };
}
export function archiveMatrixRoomV2(id) {
  const r = _mxRooms.get(id);
  if (!r) throw new Error(`matrix room ${id} not found`);
  _mxCheckR(r.status, MX_ROOM_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  r.status = MX_ROOM_MATURITY_V2.ARCHIVED;
  r.updatedAt = now;
  if (!r.archivedAt) r.archivedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function touchMatrixRoomV2(id) {
  const r = _mxRooms.get(id);
  if (!r) throw new Error(`matrix room ${id} not found`);
  if (_mxRoomTerminal.has(r.status))
    throw new Error(`cannot touch terminal matrix room ${id}`);
  const now = Date.now();
  r.lastTouchedAt = now;
  r.updatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function getMatrixRoomV2(id) {
  const r = _mxRooms.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listMatrixRoomsV2() {
  return [..._mxRooms.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}

function _mxCountPending(rid) {
  let n = 0;
  for (const m of _mxMsgs.values())
    if (
      m.roomId === rid &&
      (m.status === MX_MESSAGE_LIFECYCLE_V2.QUEUED ||
        m.status === MX_MESSAGE_LIFECYCLE_V2.SENDING)
    )
      n++;
  return n;
}

export function createMatrixMessageV2({ id, roomId, body, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!roomId || typeof roomId !== "string")
    throw new Error("roomId is required");
  if (_mxMsgs.has(id)) throw new Error(`matrix message ${id} already exists`);
  if (!_mxRooms.has(roomId)) throw new Error(`matrix room ${roomId} not found`);
  const pending = _mxCountPending(roomId);
  if (pending >= _mxMaxPendingPerRoom)
    throw new Error(
      `max pending matrix messages per room (${_mxMaxPendingPerRoom}) reached for ${roomId}`,
    );
  const now = Date.now();
  const m = {
    id,
    roomId,
    body: body || "",
    status: MX_MESSAGE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _mxMsgs.set(id, m);
  return { ...m, metadata: { ...m.metadata } };
}
function _mxCheckM(from, to) {
  const a = _mxMsgTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid matrix message transition ${from} → ${to}`);
}
export function startMatrixMessageV2(id) {
  const m = _mxMsgs.get(id);
  if (!m) throw new Error(`matrix message ${id} not found`);
  _mxCheckM(m.status, MX_MESSAGE_LIFECYCLE_V2.SENDING);
  const now = Date.now();
  m.status = MX_MESSAGE_LIFECYCLE_V2.SENDING;
  m.updatedAt = now;
  if (!m.startedAt) m.startedAt = now;
  return { ...m, metadata: { ...m.metadata } };
}
export function deliverMatrixMessageV2(id) {
  const m = _mxMsgs.get(id);
  if (!m) throw new Error(`matrix message ${id} not found`);
  _mxCheckM(m.status, MX_MESSAGE_LIFECYCLE_V2.DELIVERED);
  const now = Date.now();
  m.status = MX_MESSAGE_LIFECYCLE_V2.DELIVERED;
  m.updatedAt = now;
  if (!m.settledAt) m.settledAt = now;
  return { ...m, metadata: { ...m.metadata } };
}
export function failMatrixMessageV2(id, reason) {
  const m = _mxMsgs.get(id);
  if (!m) throw new Error(`matrix message ${id} not found`);
  _mxCheckM(m.status, MX_MESSAGE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  m.status = MX_MESSAGE_LIFECYCLE_V2.FAILED;
  m.updatedAt = now;
  if (!m.settledAt) m.settledAt = now;
  if (reason) m.metadata.failReason = String(reason);
  return { ...m, metadata: { ...m.metadata } };
}
export function cancelMatrixMessageV2(id, reason) {
  const m = _mxMsgs.get(id);
  if (!m) throw new Error(`matrix message ${id} not found`);
  _mxCheckM(m.status, MX_MESSAGE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  m.status = MX_MESSAGE_LIFECYCLE_V2.CANCELLED;
  m.updatedAt = now;
  if (!m.settledAt) m.settledAt = now;
  if (reason) m.metadata.cancelReason = String(reason);
  return { ...m, metadata: { ...m.metadata } };
}
export function getMatrixMessageV2(id) {
  const m = _mxMsgs.get(id);
  if (!m) return null;
  return { ...m, metadata: { ...m.metadata } };
}
export function listMatrixMessagesV2() {
  return [..._mxMsgs.values()].map((m) => ({
    ...m,
    metadata: { ...m.metadata },
  }));
}

export function autoMuteIdleMatrixRoomsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _mxRooms.values())
    if (
      r.status === MX_ROOM_MATURITY_V2.ACTIVE &&
      t - r.lastTouchedAt >= _mxRoomIdleMs
    ) {
      r.status = MX_ROOM_MATURITY_V2.MUTED;
      r.updatedAt = t;
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckMatrixMessagesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const m of _mxMsgs.values())
    if (
      m.status === MX_MESSAGE_LIFECYCLE_V2.SENDING &&
      m.startedAt != null &&
      t - m.startedAt >= _mxMsgStuckMs
    ) {
      m.status = MX_MESSAGE_LIFECYCLE_V2.FAILED;
      m.updatedAt = t;
      if (!m.settledAt) m.settledAt = t;
      m.metadata.failReason = "auto-fail-stuck";
      flipped.push(m.id);
    }
  return { flipped, count: flipped.length };
}

export function getMatrixBridgeStatsV2() {
  const roomsByStatus = {};
  for (const s of Object.values(MX_ROOM_MATURITY_V2)) roomsByStatus[s] = 0;
  for (const r of _mxRooms.values()) roomsByStatus[r.status]++;
  const msgsByStatus = {};
  for (const s of Object.values(MX_MESSAGE_LIFECYCLE_V2)) msgsByStatus[s] = 0;
  for (const m of _mxMsgs.values()) msgsByStatus[m.status]++;
  return {
    totalRoomsV2: _mxRooms.size,
    totalMessagesV2: _mxMsgs.size,
    maxActiveMatrixRoomsPerOwner: _mxMaxActivePerOwner,
    maxPendingMatrixMessagesPerRoom: _mxMaxPendingPerRoom,
    matrixRoomIdleMs: _mxRoomIdleMs,
    matrixMessageStuckMs: _mxMsgStuckMs,
    roomsByStatus,
    msgsByStatus,
  };
}

// =====================================================================
// matrix-bridge V2 governance overlay (iter21)
// =====================================================================
export const MATGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const MATGOV_SEND_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _matgovPTrans = new Map([
  [
    MATGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      MATGOV_PROFILE_MATURITY_V2.ACTIVE,
      MATGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MATGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      MATGOV_PROFILE_MATURITY_V2.SUSPENDED,
      MATGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    MATGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      MATGOV_PROFILE_MATURITY_V2.ACTIVE,
      MATGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [MATGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _matgovPTerminal = new Set([MATGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _matgovJTrans = new Map([
  [
    MATGOV_SEND_LIFECYCLE_V2.QUEUED,
    new Set([
      MATGOV_SEND_LIFECYCLE_V2.SENDING,
      MATGOV_SEND_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    MATGOV_SEND_LIFECYCLE_V2.SENDING,
    new Set([
      MATGOV_SEND_LIFECYCLE_V2.SENT,
      MATGOV_SEND_LIFECYCLE_V2.FAILED,
      MATGOV_SEND_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MATGOV_SEND_LIFECYCLE_V2.SENT, new Set()],
  [MATGOV_SEND_LIFECYCLE_V2.FAILED, new Set()],
  [MATGOV_SEND_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _matgovPsV2 = new Map();
const _matgovJsV2 = new Map();
let _matgovMaxActive = 6,
  _matgovMaxPending = 20,
  _matgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _matgovStuckMs = 60 * 1000;
function _matgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _matgovCheckP(from, to) {
  const a = _matgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid matgov profile transition ${from} → ${to}`);
}
function _matgovCheckJ(from, to) {
  const a = _matgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid matgov send transition ${from} → ${to}`);
}
function _matgovCountActive(owner) {
  let c = 0;
  for (const p of _matgovPsV2.values())
    if (p.owner === owner && p.status === MATGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _matgovCountPending(profileId) {
  let c = 0;
  for (const j of _matgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === MATGOV_SEND_LIFECYCLE_V2.QUEUED ||
        j.status === MATGOV_SEND_LIFECYCLE_V2.SENDING)
    )
      c++;
  return c;
}
export function setMaxActiveMatgovProfilesPerOwnerV2(n) {
  _matgovMaxActive = _matgovPos(n, "maxActiveMatgovProfilesPerOwner");
}
export function getMaxActiveMatgovProfilesPerOwnerV2() {
  return _matgovMaxActive;
}
export function setMaxPendingMatgovSendsPerProfileV2(n) {
  _matgovMaxPending = _matgovPos(n, "maxPendingMatgovSendsPerProfile");
}
export function getMaxPendingMatgovSendsPerProfileV2() {
  return _matgovMaxPending;
}
export function setMatgovProfileIdleMsV2(n) {
  _matgovIdleMs = _matgovPos(n, "matgovProfileIdleMs");
}
export function getMatgovProfileIdleMsV2() {
  return _matgovIdleMs;
}
export function setMatgovSendStuckMsV2(n) {
  _matgovStuckMs = _matgovPos(n, "matgovSendStuckMs");
}
export function getMatgovSendStuckMsV2() {
  return _matgovStuckMs;
}
export function _resetStateMatrixBridgeGovV2() {
  _matgovPsV2.clear();
  _matgovJsV2.clear();
  _matgovMaxActive = 6;
  _matgovMaxPending = 20;
  _matgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _matgovStuckMs = 60 * 1000;
}
export function registerMatgovProfileV2({
  id,
  owner,
  homeserver,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_matgovPsV2.has(id))
    throw new Error(`matgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    homeserver: homeserver || "matrix.org",
    status: MATGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _matgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateMatgovProfileV2(id) {
  const p = _matgovPsV2.get(id);
  if (!p) throw new Error(`matgov profile ${id} not found`);
  const isInitial = p.status === MATGOV_PROFILE_MATURITY_V2.PENDING;
  _matgovCheckP(p.status, MATGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _matgovCountActive(p.owner) >= _matgovMaxActive)
    throw new Error(`max active matgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = MATGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendMatgovProfileV2(id) {
  const p = _matgovPsV2.get(id);
  if (!p) throw new Error(`matgov profile ${id} not found`);
  _matgovCheckP(p.status, MATGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = MATGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveMatgovProfileV2(id) {
  const p = _matgovPsV2.get(id);
  if (!p) throw new Error(`matgov profile ${id} not found`);
  _matgovCheckP(p.status, MATGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = MATGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchMatgovProfileV2(id) {
  const p = _matgovPsV2.get(id);
  if (!p) throw new Error(`matgov profile ${id} not found`);
  if (_matgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal matgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getMatgovProfileV2(id) {
  const p = _matgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listMatgovProfilesV2() {
  return [..._matgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createMatgovSendV2({ id, profileId, room, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_matgovJsV2.has(id)) throw new Error(`matgov send ${id} already exists`);
  if (!_matgovPsV2.has(profileId))
    throw new Error(`matgov profile ${profileId} not found`);
  if (_matgovCountPending(profileId) >= _matgovMaxPending)
    throw new Error(
      `max pending matgov sends for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    room: room || "",
    status: MATGOV_SEND_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _matgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function sendingMatgovSendV2(id) {
  const j = _matgovJsV2.get(id);
  if (!j) throw new Error(`matgov send ${id} not found`);
  _matgovCheckJ(j.status, MATGOV_SEND_LIFECYCLE_V2.SENDING);
  const now = Date.now();
  j.status = MATGOV_SEND_LIFECYCLE_V2.SENDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeSendMatgovV2(id) {
  const j = _matgovJsV2.get(id);
  if (!j) throw new Error(`matgov send ${id} not found`);
  _matgovCheckJ(j.status, MATGOV_SEND_LIFECYCLE_V2.SENT);
  const now = Date.now();
  j.status = MATGOV_SEND_LIFECYCLE_V2.SENT;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failMatgovSendV2(id, reason) {
  const j = _matgovJsV2.get(id);
  if (!j) throw new Error(`matgov send ${id} not found`);
  _matgovCheckJ(j.status, MATGOV_SEND_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = MATGOV_SEND_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelMatgovSendV2(id, reason) {
  const j = _matgovJsV2.get(id);
  if (!j) throw new Error(`matgov send ${id} not found`);
  _matgovCheckJ(j.status, MATGOV_SEND_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = MATGOV_SEND_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getMatgovSendV2(id) {
  const j = _matgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listMatgovSendsV2() {
  return [..._matgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleMatgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _matgovPsV2.values())
    if (
      p.status === MATGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _matgovIdleMs
    ) {
      p.status = MATGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckMatgovSendsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _matgovJsV2.values())
    if (
      j.status === MATGOV_SEND_LIFECYCLE_V2.SENDING &&
      j.startedAt != null &&
      t - j.startedAt >= _matgovStuckMs
    ) {
      j.status = MATGOV_SEND_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getMatrixBridgeGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(MATGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _matgovPsV2.values()) profilesByStatus[p.status]++;
  const sendsByStatus = {};
  for (const v of Object.values(MATGOV_SEND_LIFECYCLE_V2)) sendsByStatus[v] = 0;
  for (const j of _matgovJsV2.values()) sendsByStatus[j.status]++;
  return {
    totalMatgovProfilesV2: _matgovPsV2.size,
    totalMatgovSendsV2: _matgovJsV2.size,
    maxActiveMatgovProfilesPerOwner: _matgovMaxActive,
    maxPendingMatgovSendsPerProfile: _matgovMaxPending,
    matgovProfileIdleMs: _matgovIdleMs,
    matgovSendStuckMs: _matgovStuckMs,
    profilesByStatus,
    sendsByStatus,
  };
}
