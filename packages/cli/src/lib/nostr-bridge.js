/**
 * Nostr Bridge — relay management, event publishing,
 * keypair generation, and DID mapping for Nostr protocol.
 */

import crypto from "crypto";
import {
  generatePrivateKey as _genPriv,
  getPublicKey as _getPub,
  signEvent as _signEvent,
  verifyEvent as _verifyEvent,
  npubEncode as _npubEncode,
  nsecEncode as _nsecEncode,
} from "@chainlesschain/session-core/nostr-crypto";

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

/**
 * Publish a NIP-01 event. When `privateKey` is provided the event is
 * schnorr-signed with BIP-340 and `pubkey` is derived from it (any
 * caller-supplied `pubkey` is ignored and overridden to match the key).
 * Without a private key the caller gets an *unsigned* event — useful
 * for in-memory workflows (e.g. `cc nostr publish` from REPL demos) but
 * such events will be rejected by real relays.
 */
export function publishEvent(db, kind, content, pubkey, tags, privateKey) {
  if (content === undefined || content === null)
    throw new Error("Content is required");

  const createdAt = Math.floor(Date.now() / 1000);
  const resolvedKind = kind || EVENT_KINDS.TEXT_NOTE;
  const resolvedTags = tags || [];

  let event;
  if (privateKey) {
    const derivedPubkey = _getPub(privateKey);
    event = _signEvent(
      {
        pubkey: derivedPubkey,
        created_at: createdAt,
        kind: resolvedKind,
        tags: resolvedTags,
        content,
      },
      privateKey,
    );
  } else {
    // Unsigned path: compute a deterministic id from canonical serialization
    // so dedup still works, but leave sig empty to signal "not signed".
    const fallbackPubkey = pubkey || "anonymous";
    const serialized = JSON.stringify([
      0,
      fallbackPubkey,
      createdAt,
      resolvedKind,
      resolvedTags,
      content,
    ]);
    const id = crypto.createHash("sha256").update(serialized).digest("hex");
    event = {
      id,
      pubkey: fallbackPubkey,
      created_at: createdAt,
      kind: resolvedKind,
      tags: resolvedTags,
      content,
      sig: "",
    };
  }

  const storedEvent = {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    sig: event.sig,
    createdAt: event.created_at,
    relayUrl: null,
  };
  _events.set(event.id, storedEvent);

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
    event.id,
    event.pubkey,
    event.kind,
    content,
    JSON.stringify(resolvedTags),
    event.sig,
    new Date(createdAt * 1000).toISOString(),
    null,
    0,
  );

  return { success: true, event: storedEvent, sentCount };
}

/**
 * Verify an event's schnorr signature + id integrity (NIP-01).
 * Returns false for unsigned events (empty `sig`).
 */
export function verifyEventSignature(event) {
  if (!event || !event.sig) return false;
  return _verifyEvent({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.createdAt ?? event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  });
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
  const privateKey = _genPriv();
  const publicKey = _getPub(privateKey);
  const keypair = {
    id: crypto.randomUUID(),
    publicKey,
    privateKey,
    npub: _npubEncode(publicKey),
    nsec: _nsecEncode(privateKey),
    createdAt: new Date().toISOString(),
  };
  _keypairs.set(keypair.id, keypair);
  return keypair;
}

/* ── DID Mapping ──────────────────────────────────────────── */

export function mapDid(did, nostrPubkey) {
  if (!did) throw new Error("DID is required");
  if (!nostrPubkey) throw new Error("Nostr pubkey is required");

  _didMappings.set(did, nostrPubkey);
  return { did, nostrPubkey, mapped: true };
}

/* ── NIP-04: Encrypted Direct Messages ─────────────────────── */

/**
 * Compute NIP-04 ECDH shared secret.
 * Nostr pubkeys are x-only (32 bytes); prepend 0x02 to reconstruct a
 * compressed point. Point negation yields the same x-coordinate, so the
 * y-sign does not affect the shared secret.
 */
function _computeSharedSecret(privKeyHex, pubKeyHex) {
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(privKeyHex, "hex"));
  const compressedPub = Buffer.concat([
    Buffer.from([0x02]),
    Buffer.from(pubKeyHex, "hex"),
  ]);
  return ecdh.computeSecret(compressedPub);
}

/**
 * Publish a NIP-04 encrypted direct message (kind=4).
 * @param {Object} db - SQLite database handle
 * @param {Object} params - { senderPrivkey, senderPubkey, recipientPubkey, plaintext }
 * @returns {Object} { success, event, sentCount }
 */
export function publishDirectMessage(
  db,
  { senderPrivkey, senderPubkey, recipientPubkey, plaintext },
) {
  if (!senderPrivkey || !senderPubkey || !recipientPubkey) {
    throw new Error(
      "senderPrivkey, senderPubkey, and recipientPubkey are required",
    );
  }
  if (plaintext === undefined || plaintext === null) {
    throw new Error("plaintext is required");
  }

  const sharedSecret = _computeSharedSecret(senderPrivkey, recipientPubkey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", sharedSecret, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const content = `${encrypted.toString("base64")}?iv=${iv.toString("base64")}`;

  return publishEvent(db, EVENT_KINDS.ENCRYPTED_DM, content, senderPubkey, [
    ["p", recipientPubkey],
  ]);
}

/**
 * Decrypt a NIP-04 direct message event.
 * @param {Object} params - { event, recipientPrivkey }
 * @returns {string} decrypted plaintext
 */
export function decryptDirectMessage({ event, recipientPrivkey }) {
  if (!event || !event.content || !event.pubkey) {
    throw new Error("event with content and pubkey is required");
  }
  if (!recipientPrivkey) {
    throw new Error("recipientPrivkey is required");
  }
  if (event.kind !== EVENT_KINDS.ENCRYPTED_DM) {
    throw new Error(
      `Expected kind=${EVENT_KINDS.ENCRYPTED_DM}, got kind=${event.kind}`,
    );
  }

  const parts = event.content.split("?iv=");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid NIP-04 content format");
  }

  const ciphertext = Buffer.from(parts[0], "base64");
  const iv = Buffer.from(parts[1], "base64");
  const sharedSecret = _computeSharedSecret(recipientPrivkey, event.pubkey);
  const decipher = crypto.createDecipheriv("aes-256-cbc", sharedSecret, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/* ── NIP-09: Event Deletion Request ─────────────────────────── */

/**
 * Publish a NIP-09 deletion request (kind=5) referencing prior events.
 * @param {Object} db - SQLite database handle
 * @param {Object} params - { eventIds: string[], reason?: string, pubkey?: string }
 */
export function publishDeletion(db, { eventIds, reason = "", pubkey }) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    throw new Error("eventIds must be a non-empty array");
  }
  const tags = eventIds.map((id) => ["e", id]);
  return publishEvent(db, EVENT_KINDS.DELETE, reason, pubkey, tags);
}

/* ── NIP-25: Reactions ──────────────────────────────────────── */

/**
 * Publish a NIP-25 reaction (kind=7) to another event.
 * @param {Object} db - SQLite database handle
 * @param {Object} params - { targetEventId, targetPubkey, content?, pubkey? }
 */
export function publishReaction(
  db,
  { targetEventId, targetPubkey, content = "+", pubkey },
) {
  if (!targetEventId || !targetPubkey) {
    throw new Error("targetEventId and targetPubkey are required");
  }
  return publishEvent(db, EVENT_KINDS.REACTION, content, pubkey, [
    ["e", targetEventId],
    ["p", targetPubkey],
  ]);
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _relays.clear();
  _events.clear();
  _keypairs.clear();
  _didMappings.clear();
}

// ===== V2 Surface: Nostr Bridge governance overlay (CLI v0.134.0) =====
export const NOSTR_RELAY_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  OFFLINE: "offline",
  RETIRED: "retired",
});
export const NOSTR_EVENT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PUBLISHING: "publishing",
  PUBLISHED: "published",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _nsRelayTrans = new Map([
  [
    NOSTR_RELAY_MATURITY_V2.PENDING,
    new Set([NOSTR_RELAY_MATURITY_V2.ACTIVE, NOSTR_RELAY_MATURITY_V2.RETIRED]),
  ],
  [
    NOSTR_RELAY_MATURITY_V2.ACTIVE,
    new Set([NOSTR_RELAY_MATURITY_V2.OFFLINE, NOSTR_RELAY_MATURITY_V2.RETIRED]),
  ],
  [
    NOSTR_RELAY_MATURITY_V2.OFFLINE,
    new Set([NOSTR_RELAY_MATURITY_V2.ACTIVE, NOSTR_RELAY_MATURITY_V2.RETIRED]),
  ],
  [NOSTR_RELAY_MATURITY_V2.RETIRED, new Set()],
]);
const _nsRelayTerminal = new Set([NOSTR_RELAY_MATURITY_V2.RETIRED]);
const _nsEventTrans = new Map([
  [
    NOSTR_EVENT_LIFECYCLE_V2.QUEUED,
    new Set([
      NOSTR_EVENT_LIFECYCLE_V2.PUBLISHING,
      NOSTR_EVENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    NOSTR_EVENT_LIFECYCLE_V2.PUBLISHING,
    new Set([
      NOSTR_EVENT_LIFECYCLE_V2.PUBLISHED,
      NOSTR_EVENT_LIFECYCLE_V2.FAILED,
      NOSTR_EVENT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [NOSTR_EVENT_LIFECYCLE_V2.PUBLISHED, new Set()],
  [NOSTR_EVENT_LIFECYCLE_V2.FAILED, new Set()],
  [NOSTR_EVENT_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _nsRelays = new Map();
const _nsEvents = new Map();
let _nsMaxActivePerOwner = 10;
let _nsMaxPendingPerRelay = 30;
let _nsRelayIdleMs = 60 * 60 * 1000;
let _nsEventStuckMs = 2 * 60 * 1000;

function _nsPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveNostrRelaysPerOwnerV2(n) {
  _nsMaxActivePerOwner = _nsPos(n, "maxActiveNostrRelaysPerOwner");
}
export function getMaxActiveNostrRelaysPerOwnerV2() {
  return _nsMaxActivePerOwner;
}
export function setMaxPendingNostrEventsPerRelayV2(n) {
  _nsMaxPendingPerRelay = _nsPos(n, "maxPendingNostrEventsPerRelay");
}
export function getMaxPendingNostrEventsPerRelayV2() {
  return _nsMaxPendingPerRelay;
}
export function setNostrRelayIdleMsV2(n) {
  _nsRelayIdleMs = _nsPos(n, "nostrRelayIdleMs");
}
export function getNostrRelayIdleMsV2() {
  return _nsRelayIdleMs;
}
export function setNostrEventStuckMsV2(n) {
  _nsEventStuckMs = _nsPos(n, "nostrEventStuckMs");
}
export function getNostrEventStuckMsV2() {
  return _nsEventStuckMs;
}

export function _resetStateNostrBridgeV2() {
  _nsRelays.clear();
  _nsEvents.clear();
  _nsMaxActivePerOwner = 10;
  _nsMaxPendingPerRelay = 30;
  _nsRelayIdleMs = 60 * 60 * 1000;
  _nsEventStuckMs = 2 * 60 * 1000;
}

export function registerNostrRelayV2({ id, owner, url, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_nsRelays.has(id))
    throw new Error(`nostr relay ${id} already registered`);
  const now = Date.now();
  const r = {
    id,
    owner,
    url: url || "",
    status: NOSTR_RELAY_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _nsRelays.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _nsCheckR(from, to) {
  const a = _nsRelayTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid nostr relay transition ${from} → ${to}`);
}
function _nsCountActive(owner) {
  let n = 0;
  for (const r of _nsRelays.values())
    if (r.owner === owner && r.status === NOSTR_RELAY_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateNostrRelayV2(id) {
  const r = _nsRelays.get(id);
  if (!r) throw new Error(`nostr relay ${id} not found`);
  _nsCheckR(r.status, NOSTR_RELAY_MATURITY_V2.ACTIVE);
  const recovery = r.status === NOSTR_RELAY_MATURITY_V2.OFFLINE;
  if (!recovery) {
    const a = _nsCountActive(r.owner);
    if (a >= _nsMaxActivePerOwner)
      throw new Error(
        `max active nostr relays per owner (${_nsMaxActivePerOwner}) reached for ${r.owner}`,
      );
  }
  const now = Date.now();
  r.status = NOSTR_RELAY_MATURITY_V2.ACTIVE;
  r.updatedAt = now;
  r.lastTouchedAt = now;
  if (!r.activatedAt) r.activatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function offlineNostrRelayV2(id) {
  const r = _nsRelays.get(id);
  if (!r) throw new Error(`nostr relay ${id} not found`);
  _nsCheckR(r.status, NOSTR_RELAY_MATURITY_V2.OFFLINE);
  r.status = NOSTR_RELAY_MATURITY_V2.OFFLINE;
  r.updatedAt = Date.now();
  return { ...r, metadata: { ...r.metadata } };
}
export function retireNostrRelayV2(id) {
  const r = _nsRelays.get(id);
  if (!r) throw new Error(`nostr relay ${id} not found`);
  _nsCheckR(r.status, NOSTR_RELAY_MATURITY_V2.RETIRED);
  const now = Date.now();
  r.status = NOSTR_RELAY_MATURITY_V2.RETIRED;
  r.updatedAt = now;
  if (!r.retiredAt) r.retiredAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function touchNostrRelayV2(id) {
  const r = _nsRelays.get(id);
  if (!r) throw new Error(`nostr relay ${id} not found`);
  if (_nsRelayTerminal.has(r.status))
    throw new Error(`cannot touch terminal nostr relay ${id}`);
  const now = Date.now();
  r.lastTouchedAt = now;
  r.updatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function getNostrRelayV2(id) {
  const r = _nsRelays.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listNostrRelaysV2() {
  return [..._nsRelays.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}

function _nsCountPending(rid) {
  let n = 0;
  for (const e of _nsEvents.values())
    if (
      e.relayId === rid &&
      (e.status === NOSTR_EVENT_LIFECYCLE_V2.QUEUED ||
        e.status === NOSTR_EVENT_LIFECYCLE_V2.PUBLISHING)
    )
      n++;
  return n;
}

export function createNostrEventV2({ id, relayId, kind, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!relayId || typeof relayId !== "string")
    throw new Error("relayId is required");
  if (_nsEvents.has(id)) throw new Error(`nostr event ${id} already exists`);
  if (!_nsRelays.has(relayId))
    throw new Error(`nostr relay ${relayId} not found`);
  const pending = _nsCountPending(relayId);
  if (pending >= _nsMaxPendingPerRelay)
    throw new Error(
      `max pending nostr events per relay (${_nsMaxPendingPerRelay}) reached for ${relayId}`,
    );
  const now = Date.now();
  const e = {
    id,
    relayId,
    kind: typeof kind === "number" ? kind : 1,
    status: NOSTR_EVENT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _nsEvents.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}
function _nsCheckE(from, to) {
  const a = _nsEventTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid nostr event transition ${from} → ${to}`);
}
export function startNostrEventV2(id) {
  const e = _nsEvents.get(id);
  if (!e) throw new Error(`nostr event ${id} not found`);
  _nsCheckE(e.status, NOSTR_EVENT_LIFECYCLE_V2.PUBLISHING);
  const now = Date.now();
  e.status = NOSTR_EVENT_LIFECYCLE_V2.PUBLISHING;
  e.updatedAt = now;
  if (!e.startedAt) e.startedAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function publishNostrEventV2(id) {
  const e = _nsEvents.get(id);
  if (!e) throw new Error(`nostr event ${id} not found`);
  _nsCheckE(e.status, NOSTR_EVENT_LIFECYCLE_V2.PUBLISHED);
  const now = Date.now();
  e.status = NOSTR_EVENT_LIFECYCLE_V2.PUBLISHED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  return { ...e, metadata: { ...e.metadata } };
}
export function failNostrEventV2(id, reason) {
  const e = _nsEvents.get(id);
  if (!e) throw new Error(`nostr event ${id} not found`);
  _nsCheckE(e.status, NOSTR_EVENT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  e.status = NOSTR_EVENT_LIFECYCLE_V2.FAILED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.failReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function cancelNostrEventV2(id, reason) {
  const e = _nsEvents.get(id);
  if (!e) throw new Error(`nostr event ${id} not found`);
  _nsCheckE(e.status, NOSTR_EVENT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  e.status = NOSTR_EVENT_LIFECYCLE_V2.CANCELLED;
  e.updatedAt = now;
  if (!e.settledAt) e.settledAt = now;
  if (reason) e.metadata.cancelReason = String(reason);
  return { ...e, metadata: { ...e.metadata } };
}
export function getNostrEventV2(id) {
  const e = _nsEvents.get(id);
  if (!e) return null;
  return { ...e, metadata: { ...e.metadata } };
}
export function listNostrEventsV2() {
  return [..._nsEvents.values()].map((e) => ({
    ...e,
    metadata: { ...e.metadata },
  }));
}

export function autoOfflineIdleNostrRelaysV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _nsRelays.values())
    if (
      r.status === NOSTR_RELAY_MATURITY_V2.ACTIVE &&
      t - r.lastTouchedAt >= _nsRelayIdleMs
    ) {
      r.status = NOSTR_RELAY_MATURITY_V2.OFFLINE;
      r.updatedAt = t;
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckNostrEventsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const e of _nsEvents.values())
    if (
      e.status === NOSTR_EVENT_LIFECYCLE_V2.PUBLISHING &&
      e.startedAt != null &&
      t - e.startedAt >= _nsEventStuckMs
    ) {
      e.status = NOSTR_EVENT_LIFECYCLE_V2.FAILED;
      e.updatedAt = t;
      if (!e.settledAt) e.settledAt = t;
      e.metadata.failReason = "auto-fail-stuck";
      flipped.push(e.id);
    }
  return { flipped, count: flipped.length };
}

export function getNostrBridgeStatsV2() {
  const relaysByStatus = {};
  for (const s of Object.values(NOSTR_RELAY_MATURITY_V2)) relaysByStatus[s] = 0;
  for (const r of _nsRelays.values()) relaysByStatus[r.status]++;
  const eventsByStatus = {};
  for (const s of Object.values(NOSTR_EVENT_LIFECYCLE_V2))
    eventsByStatus[s] = 0;
  for (const e of _nsEvents.values()) eventsByStatus[e.status]++;
  return {
    totalRelaysV2: _nsRelays.size,
    totalEventsV2: _nsEvents.size,
    maxActiveNostrRelaysPerOwner: _nsMaxActivePerOwner,
    maxPendingNostrEventsPerRelay: _nsMaxPendingPerRelay,
    nostrRelayIdleMs: _nsRelayIdleMs,
    nostrEventStuckMs: _nsEventStuckMs,
    relaysByStatus,
    eventsByStatus,
  };
}
