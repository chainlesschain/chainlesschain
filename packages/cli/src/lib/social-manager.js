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

  db.prepare(`UPDATE social_posts SET likes = ? WHERE id = ?`).run(post.likes, postId);

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
      threads.set(msg.threadId, { threadId: msg.threadId, lastMessage: msg, messageCount: 0 });
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
    pendingRequests: [..._friends.values()].filter((f) => f.status === "pending").length,
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _contacts.clear();
  _friends.clear();
  _posts.clear();
  _messages.clear();
}
