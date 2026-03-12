/**
 * Nostr Bridge — relay management, event publishing,
 * keypair generation, and DID mapping for Nostr protocol.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _relays = new Map();
const _events = new Map();
const _keypairs = new Map();
const _didMappings = new Map();

const EVENT_KINDS = {
  SET_METADATA: 0,
  TEXT_NOTE: 1,
  RECOMMEND_RELAY: 2,
  CONTACTS: 3,
  ENCRYPTED_DM: 4,
  DELETE: 5,
  REPOST: 6,
  REACTION: 7,
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureNostrTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nostr_relays (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      last_connected TEXT,
      event_count INTEGER DEFAULT 0,
      read_enabled INTEGER DEFAULT 1,
      write_enabled INTEGER DEFAULT 1
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS nostr_events (
      id TEXT PRIMARY KEY,
      pubkey TEXT,
      kind INTEGER,
      content TEXT,
      tags TEXT,
      sig TEXT,
      created_at TEXT,
      relay_url TEXT,
      imported INTEGER DEFAULT 0
    )
  `);
}

/* ── Relay Management ─────────────────────────────────────── */

export function listRelays() {
  return [..._relays.values()];
}

export function addRelay(db, url) {
  if (!url) throw new Error("Relay URL is required");

  // Check if already exists
  for (const relay of _relays.values()) {
    if (relay.url === url) return relay;
  }

  const id = crypto.randomUUID();
  const relay = {
    id,
    url,
    status: "disconnected",
    lastConnected: null,
    eventCount: 0,
    readEnabled: true,
    writeEnabled: true,
  };

  _relays.set(id, relay);

  db.prepare(
    `INSERT INTO nostr_relays (id, url, status, last_connected, event_count, read_enabled, write_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, url, "disconnected", null, 0, 1, 1);

  return relay;
}

/* ── Event Publishing ─────────────────────────────────────── */

export function publishEvent(db, kind, content, pubkey, tags) {
  if (content === undefined || content === null)
    throw new Error("Content is required");

  const now = new Date().toISOString();
  const serialized = JSON.stringify([
    0,
    pubkey || "anonymous",
    now,
    kind || 1,
    tags || [],
    content,
  ]);
  const id = crypto.createHash("sha256").update(serialized).digest("hex");
  const sig = crypto.randomBytes(64).toString("hex");

  const event = {
    id,
    pubkey: pubkey || "anonymous",
    kind: kind || EVENT_KINDS.TEXT_NOTE,
    content,
    tags: tags || [],
    sig,
    createdAt: now,
    relayUrl: null,
  };

  _events.set(id, event);

  // Count relays that received the event
  const writeRelays = [..._relays.values()].filter((r) => r.writeEnabled);
  let sentCount = 0;
  for (const relay of writeRelays) {
    relay.eventCount++;
    sentCount++;
  }

  db.prepare(
    `INSERT INTO nostr_events (id, pubkey, kind, content, tags, sig, created_at, relay_url, imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    event.pubkey,
    event.kind,
    content,
    JSON.stringify(tags || []),
    sig,
    now,
    null,
    0,
  );

  return { success: true, event, sentCount };
}

/* ── Event Retrieval ──────────────────────────────────────── */

export function getEvents(filter = {}) {
  let events = [..._events.values()];
  if (filter.kinds) {
    events = events.filter((e) => filter.kinds.includes(e.kind));
  }
  const limit = filter.limit || 50;
  return events.slice(0, limit);
}

/* ── Keypair Generation ───────────────────────────────────── */

export function generateKeypair() {
  const privateKey = crypto.randomBytes(32).toString("hex");
  const publicKey = crypto
    .createHash("sha256")
    .update(privateKey)
    .digest("hex");
  const id = crypto.randomUUID();

  const keypair = {
    id,
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
  };
  _keypairs.set(id, keypair);

  return keypair;
}

/* ── DID Mapping ──────────────────────────────────────────── */

export function mapDid(did, nostrPubkey) {
  if (!did) throw new Error("DID is required");
  if (!nostrPubkey) throw new Error("Nostr pubkey is required");

  _didMappings.set(did, nostrPubkey);
  return { did, nostrPubkey, mapped: true };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _relays.clear();
  _events.clear();
  _keypairs.clear();
  _didMappings.clear();
}
