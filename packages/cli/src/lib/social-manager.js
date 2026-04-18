/**
 * Social Manager — contacts, friends, posts, chat messaging,
 * and social statistics for CLI terminal use.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _contacts = new Map();
const _friends = new Map();
const _posts = new Map();
const _messages = new Map();

/* ── Schema ────────────────────────────────────────────────── */

export function ensureSocialTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      did TEXT,
      email TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_friends (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      author TEXT,
      content TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      sender TEXT,
      recipient TEXT,
      content TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Contacts ──────────────────────────────────────────────── */

export function addContact(db, name, did, email, notes) {
  if (!name) throw new Error("Contact name is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const contact = {
    id,
    name,
    did: did || null,
    email: email || null,
    notes: notes || "",
    createdAt: now,
  };

  _contacts.set(id, contact);

  db.prepare(
    `INSERT INTO social_contacts (id, name, did, email, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, contact.did, contact.email, contact.notes, now);

  return contact;
}

export function listContacts() {
  return [..._contacts.values()];
}

export function deleteContact(db, contactId) {
  const contact = _contacts.get(contactId);
  if (!contact) throw new Error(`Contact not found: ${contactId}`);

  _contacts.delete(contactId);
  _friends.delete(contactId);

  db.prepare(`DELETE FROM social_contacts WHERE id = ?`).run(contactId);

  return { success: true, contactId };
}

export function showContact(contactId) {
  const contact = _contacts.get(contactId);
  if (!contact) throw new Error(`Contact not found: ${contactId}`);
  return contact;
}

/* ── Friends ───────────────────────────────────────────────── */

export function addFriend(db, contactId) {
  if (!_contacts.has(contactId)) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const friend = { id, contactId, status: "pending", createdAt: now };
  _friends.set(contactId, friend);

  db.prepare(
    `INSERT INTO social_friends (id, contact_id, status, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, contactId, "pending", now);

  return friend;
}

export function listFriends() {
  return [..._friends.values()];
}

export function removeFriend(db, contactId) {
  if (!_friends.has(contactId)) {
    throw new Error(`Friend not found for contact: ${contactId}`);
  }

  _friends.delete(contactId);

  db.prepare(`DELETE FROM social_friends WHERE contact_id = ?`).run(contactId);

  return { success: true, contactId };
}

export function pendingRequests() {
  return [..._friends.values()].filter((f) => f.status === "pending");
}

export function acceptFriend(contactId) {
  const friend = _friends.get(contactId);
  if (!friend) throw new Error(`Friend request not found: ${contactId}`);
  friend.status = "accepted";
  return friend;
}

/* ── Posts ──────────────────────────────────────────────────── */

export function publishPost(db, content, author) {
  if (!content) throw new Error("Post content is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const post = {
    id,
    author: author || "cli-user",
    content,
    likes: 0,
    createdAt: now,
  };

  _posts.set(id, post);

  db.prepare(
    `INSERT INTO social_posts (id, author, content, likes, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, post.author, content, 0, now);

  return post;
}

export function listPosts(filter = {}) {
  let posts = [..._posts.values()];
  if (filter.author) {
    posts = posts.filter((p) => p.author === filter.author);
  }
  const limit = filter.limit || 50;
  return posts.slice(0, limit);
}

export function likePost(db, postId) {
  const post = _posts.get(postId);
  if (!post) throw new Error(`Post not found: ${postId}`);

  post.likes++;

  db.prepare(`UPDATE social_posts SET likes = ? WHERE id = ?`).run(
    post.likes,
    postId,
  );

  return post;
}

/* ── Chat Messaging ───────────────────────────────────────── */

export function sendChatMessage(db, recipient, content, sender) {
  if (!recipient) throw new Error("Recipient is required");
  if (!content) throw new Error("Message content is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const senderName = sender || "cli-user";

  // Thread ID is sorted pair
  const pair = [senderName, recipient].sort();
  const threadId = `${pair[0]}:${pair[1]}`;

  const message = {
    id,
    threadId,
    sender: senderName,
    recipient,
    content,
    read: false,
    createdAt: now,
  };

  _messages.set(id, message);

  db.prepare(
    `INSERT INTO social_messages (id, thread_id, sender, recipient, content, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, threadId, senderName, recipient, content, 0, now);

  return message;
}

export function getChatMessages(threadId, filter = {}) {
  if (!threadId) throw new Error("Thread ID is required");

  let messages = [..._messages.values()].filter((m) => m.threadId === threadId);
  const limit = filter.limit || 50;
  return messages.slice(0, limit);
}

export function getChatThreads() {
  const threads = new Map();
  for (const msg of _messages.values()) {
    if (!threads.has(msg.threadId)) {
      threads.set(msg.threadId, {
        threadId: msg.threadId,
        lastMessage: msg,
        messageCount: 0,
      });
    }
    const thread = threads.get(msg.threadId);
    thread.messageCount++;
    thread.lastMessage = msg;
  }
  return [...threads.values()];
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getSocialStats() {
  return {
    contacts: _contacts.size,
    friends: _friends.size,
    posts: _posts.size,
    messages: _messages.size,
    pendingRequests: [..._friends.values()].filter(
      (f) => f.status === "pending",
    ).length,
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _contacts.clear();
  _friends.clear();
  _posts.clear();
  _messages.clear();
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Social governance layer.
 * Tracks relationship maturity + thread lifecycle independent of
 * legacy contacts/friends/posts/messages stores above.
 * ═══════════════════════════════════════════════════════════════ */

export const RELATIONSHIP_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  CONNECTED: "connected",
  MUTED: "muted",
  BLOCKED: "blocked",
});

export const THREAD_LIFECYCLE_V2 = Object.freeze({
  OPEN: "open",
  ENGAGED: "engaged",
  RESOLVED: "resolved",
  ABANDONED: "abandoned",
  REPORTED: "reported",
});

const REL_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["connected", "blocked"])],
  ["connected", new Set(["muted", "blocked"])],
  ["muted", new Set(["connected", "blocked"])],
  ["blocked", new Set()],
]);
const REL_TERMINALS_V2 = new Set(["blocked"]);

const THREAD_TRANSITIONS_V2 = new Map([
  ["open", new Set(["engaged", "abandoned", "reported"])],
  ["engaged", new Set(["resolved", "abandoned", "reported"])],
  ["resolved", new Set()],
  ["abandoned", new Set()],
  ["reported", new Set()],
]);
const THREAD_TERMINALS_V2 = new Set(["resolved", "abandoned", "reported"]);

export const SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER = 500;
export const SOCIAL_DEFAULT_MAX_OPEN_THREADS_PER_USER = 50;
export const SOCIAL_DEFAULT_RELATIONSHIP_IDLE_MS = 1000 * 60 * 60 * 24 * 180; // 180 days
export const SOCIAL_DEFAULT_THREAD_STUCK_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const _relationshipsV2 = new Map();
const _threadsV2 = new Map();
let _maxConnectedPerUserV2 = SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER;
let _maxOpenThreadsPerUserV2 = SOCIAL_DEFAULT_MAX_OPEN_THREADS_PER_USER;
let _relationshipIdleMsV2 = SOCIAL_DEFAULT_RELATIONSHIP_IDLE_MS;
let _threadStuckMsV2 = SOCIAL_DEFAULT_THREAD_STUCK_MS;

function _posIntSocialV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxConnectedPerUserV2() {
  return _maxConnectedPerUserV2;
}
export function setMaxConnectedPerUserV2(n) {
  _maxConnectedPerUserV2 = _posIntSocialV2(n, "maxConnectedPerUser");
}
export function getMaxOpenThreadsPerUserV2() {
  return _maxOpenThreadsPerUserV2;
}
export function setMaxOpenThreadsPerUserV2(n) {
  _maxOpenThreadsPerUserV2 = _posIntSocialV2(n, "maxOpenThreadsPerUser");
}
export function getRelationshipIdleMsV2() {
  return _relationshipIdleMsV2;
}
export function setRelationshipIdleMsV2(n) {
  _relationshipIdleMsV2 = _posIntSocialV2(n, "relationshipIdleMs");
}
export function getThreadStuckMsV2() {
  return _threadStuckMsV2;
}
export function setThreadStuckMsV2(n) {
  _threadStuckMsV2 = _posIntSocialV2(n, "threadStuckMs");
}

export function getConnectedCountV2(userId) {
  let n = 0;
  for (const r of _relationshipsV2.values()) {
    if (r.userId === userId && r.status === "connected") n += 1;
  }
  return n;
}

export function getOpenThreadCountV2(userId) {
  let n = 0;
  for (const t of _threadsV2.values()) {
    if (t.userId === userId && (t.status === "open" || t.status === "engaged"))
      n += 1;
  }
  return n;
}

function _copyRelV2(r) {
  return { ...r, metadata: { ...r.metadata } };
}
function _copyThreadV2(t) {
  return { ...t, metadata: { ...t.metadata } };
}

export function registerRelationshipV2(
  id,
  { userId, peerId, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!userId || typeof userId !== "string")
    throw new Error("userId must be a string");
  if (!peerId || typeof peerId !== "string")
    throw new Error("peerId must be a string");
  if (_relationshipsV2.has(id))
    throw new Error(`relationship ${id} already exists`);
  const r = {
    id,
    userId,
    peerId,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    connectedAt: null,
    blockedAt: null,
    metadata: { ...metadata },
  };
  _relationshipsV2.set(id, r);
  return _copyRelV2(r);
}

export function getRelationshipV2(id) {
  const r = _relationshipsV2.get(id);
  return r ? _copyRelV2(r) : null;
}

export function listRelationshipsV2({ userId, status } = {}) {
  const out = [];
  for (const r of _relationshipsV2.values()) {
    if (userId && r.userId !== userId) continue;
    if (status && r.status !== status) continue;
    out.push(_copyRelV2(r));
  }
  return out;
}

export function setRelationshipStatusV2(id, next, { now = Date.now() } = {}) {
  const r = _relationshipsV2.get(id);
  if (!r) throw new Error(`relationship ${id} not found`);
  if (!REL_TRANSITIONS_V2.has(next))
    throw new Error(`unknown relationship status: ${next}`);
  if (REL_TERMINALS_V2.has(r.status))
    throw new Error(`relationship ${id} is in terminal state ${r.status}`);
  const allowed = REL_TRANSITIONS_V2.get(r.status);
  if (!allowed.has(next))
    throw new Error(
      `cannot transition relationship from ${r.status} to ${next}`,
    );
  if (next === "connected") {
    if (r.status === "pending") {
      const count = getConnectedCountV2(r.userId);
      if (count >= _maxConnectedPerUserV2)
        throw new Error(
          `user ${r.userId} already at connected cap (${_maxConnectedPerUserV2})`,
        );
    }
    if (!r.connectedAt) r.connectedAt = now;
  }
  if (next === "blocked" && !r.blockedAt) r.blockedAt = now;
  r.status = next;
  r.lastSeenAt = now;
  return _copyRelV2(r);
}

export function connectRelationshipV2(id, opts) {
  return setRelationshipStatusV2(id, "connected", opts);
}
export function muteRelationshipV2(id, opts) {
  return setRelationshipStatusV2(id, "muted", opts);
}
export function blockRelationshipV2(id, opts) {
  return setRelationshipStatusV2(id, "blocked", opts);
}

export function touchRelationshipV2(id, { now = Date.now() } = {}) {
  const r = _relationshipsV2.get(id);
  if (!r) throw new Error(`relationship ${id} not found`);
  r.lastSeenAt = now;
  return _copyRelV2(r);
}

export function createThreadV2(
  id,
  { userId, topic, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!userId || typeof userId !== "string")
    throw new Error("userId must be a string");
  if (!topic || typeof topic !== "string")
    throw new Error("topic must be a string");
  if (_threadsV2.has(id)) throw new Error(`thread ${id} already exists`);
  const count = getOpenThreadCountV2(userId);
  if (count >= _maxOpenThreadsPerUserV2)
    throw new Error(
      `user ${userId} already at open-thread cap (${_maxOpenThreadsPerUserV2})`,
    );
  const t = {
    id,
    userId,
    topic,
    status: "open",
    createdAt: now,
    lastSeenAt: now,
    engagedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _threadsV2.set(id, t);
  return _copyThreadV2(t);
}

export function getThreadV2(id) {
  const t = _threadsV2.get(id);
  return t ? _copyThreadV2(t) : null;
}

export function listThreadsV2({ userId, status } = {}) {
  const out = [];
  for (const t of _threadsV2.values()) {
    if (userId && t.userId !== userId) continue;
    if (status && t.status !== status) continue;
    out.push(_copyThreadV2(t));
  }
  return out;
}

export function setThreadStatusV2(id, next, { now = Date.now() } = {}) {
  const t = _threadsV2.get(id);
  if (!t) throw new Error(`thread ${id} not found`);
  if (!THREAD_TRANSITIONS_V2.has(next))
    throw new Error(`unknown thread status: ${next}`);
  if (THREAD_TERMINALS_V2.has(t.status))
    throw new Error(`thread ${id} is in terminal state ${t.status}`);
  const allowed = THREAD_TRANSITIONS_V2.get(t.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition thread from ${t.status} to ${next}`);
  if (next === "engaged" && !t.engagedAt) t.engagedAt = now;
  if (THREAD_TERMINALS_V2.has(next) && !t.settledAt) t.settledAt = now;
  t.status = next;
  t.lastSeenAt = now;
  return _copyThreadV2(t);
}

export function engageThreadV2(id, opts) {
  return setThreadStatusV2(id, "engaged", opts);
}
export function resolveThreadV2(id, opts) {
  return setThreadStatusV2(id, "resolved", opts);
}
export function abandonThreadV2(id, opts) {
  return setThreadStatusV2(id, "abandoned", opts);
}
export function reportThreadV2(id, opts) {
  return setThreadStatusV2(id, "reported", opts);
}

export function autoMuteIdleRelationshipsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const r of _relationshipsV2.values()) {
    if (r.status !== "connected") continue;
    if (now - r.lastSeenAt > _relationshipIdleMsV2) {
      r.status = "muted";
      r.lastSeenAt = now;
      flipped.push(_copyRelV2(r));
    }
  }
  return flipped;
}

export function autoAbandonStuckThreadsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const t of _threadsV2.values()) {
    if (t.status !== "open" && t.status !== "engaged") continue;
    if (now - t.lastSeenAt > _threadStuckMsV2) {
      t.status = "abandoned";
      t.lastSeenAt = now;
      if (!t.settledAt) t.settledAt = now;
      flipped.push(_copyThreadV2(t));
    }
  }
  return flipped;
}

export function getSocialManagerStatsV2() {
  const relationshipsByStatus = {};
  for (const v of Object.values(RELATIONSHIP_MATURITY_V2))
    relationshipsByStatus[v] = 0;
  for (const r of _relationshipsV2.values())
    relationshipsByStatus[r.status] += 1;

  const threadsByStatus = {};
  for (const v of Object.values(THREAD_LIFECYCLE_V2)) threadsByStatus[v] = 0;
  for (const t of _threadsV2.values()) threadsByStatus[t.status] += 1;

  return {
    totalRelationshipsV2: _relationshipsV2.size,
    totalThreadsV2: _threadsV2.size,
    maxConnectedPerUser: _maxConnectedPerUserV2,
    maxOpenThreadsPerUser: _maxOpenThreadsPerUserV2,
    relationshipIdleMs: _relationshipIdleMsV2,
    threadStuckMs: _threadStuckMsV2,
    relationshipsByStatus,
    threadsByStatus,
  };
}

export function _resetStateSocialManagerV2() {
  _relationshipsV2.clear();
  _threadsV2.clear();
  _maxConnectedPerUserV2 = SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER;
  _maxOpenThreadsPerUserV2 = SOCIAL_DEFAULT_MAX_OPEN_THREADS_PER_USER;
  _relationshipIdleMsV2 = SOCIAL_DEFAULT_RELATIONSHIP_IDLE_MS;
  _threadStuckMsV2 = SOCIAL_DEFAULT_THREAD_STUCK_MS;
}
