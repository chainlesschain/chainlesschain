/**
 * P2P Manager — Peer-to-peer messaging and device pairing for CLI.
 * Uses a bridge protocol to connect to desktop app or runs standalone
 * with a lightweight signaling mechanism.
 */

import crypto from "crypto";
import { EventEmitter } from "events";

const DEFAULT_SIGNALING_PORT = 9001;
const BRIDGE_TIMEOUT = 5000;

/**
 * Ensure P2P tables exist.
 */
export function ensureP2PTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS p2p_peers (
      peer_id TEXT PRIMARY KEY,
      display_name TEXT,
      did TEXT,
      public_key TEXT,
      last_seen TEXT,
      status TEXT DEFAULT 'offline',
      device_type TEXT DEFAULT 'unknown',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS p2p_messages (
      id TEXT PRIMARY KEY,
      from_peer TEXT NOT NULL,
      to_peer TEXT NOT NULL,
      content TEXT NOT NULL,
      encrypted INTEGER DEFAULT 0,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS p2p_paired_devices (
      device_id TEXT PRIMARY KEY,
      device_name TEXT,
      device_type TEXT,
      pairing_code TEXT,
      paired_at TEXT DEFAULT (datetime('now')),
      last_sync TEXT,
      status TEXT DEFAULT 'active'
    )
  `);
}

/**
 * Generate a unique peer ID.
 */
export function generatePeerId() {
  return `peer-${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Generate a pairing code (6-digit).
 */
export function generatePairingCode() {
  return String(crypto.randomInt(100000, 999999));
}

/**
 * Register a peer in the database.
 */
export function registerPeer(
  db,
  peerId,
  displayName,
  did,
  publicKey,
  deviceType,
) {
  ensureP2PTables(db);
  db.prepare(
    `INSERT OR REPLACE INTO p2p_peers (peer_id, display_name, did, public_key, last_seen, status, device_type)
     VALUES (?, ?, ?, ?, datetime('now'), ?, ?)`,
  ).run(
    peerId,
    displayName || null,
    did || null,
    publicKey || null,
    "online",
    deviceType || "cli",
  );
  return {
    peerId,
    displayName,
    did,
    deviceType: deviceType || "cli",
    status: "online",
  };
}

/**
 * Get a peer by ID.
 */
export function getPeer(db, peerId) {
  ensureP2PTables(db);
  return db.prepare("SELECT * FROM p2p_peers WHERE peer_id = ?").get(peerId);
}

/**
 * Get all peers.
 */
export function getAllPeers(db) {
  ensureP2PTables(db);
  return db.prepare("SELECT * FROM p2p_peers ORDER BY last_seen DESC").all();
}

/**
 * Get online peers.
 */
export function getOnlinePeers(db) {
  ensureP2PTables(db);
  return db.prepare("SELECT * FROM p2p_peers WHERE status = ?").get("online")
    ? db.prepare("SELECT * FROM p2p_peers WHERE status = ?").all("online")
    : [];
}

/**
 * Update peer status.
 */
export function updatePeerStatus(db, peerId, status) {
  ensureP2PTables(db);
  const result = db
    .prepare(
      "UPDATE p2p_peers SET status = ?, last_seen = datetime('now') WHERE peer_id = ?",
    )
    .run(status, peerId);
  return result.changes > 0;
}

/**
 * Send a message to a peer (store in DB).
 */
export function sendMessage(db, fromPeer, toPeer, content, encrypted = false) {
  ensureP2PTables(db);
  const id = `msg-${crypto.randomBytes(8).toString("hex")}`;

  // Verify recipient exists
  const recipient = getPeer(db, toPeer);
  if (!recipient) {
    throw new Error(`Peer not found: ${toPeer}`);
  }

  db.prepare(
    `INSERT INTO p2p_messages (id, from_peer, to_peer, content, encrypted)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, fromPeer, toPeer, content, encrypted ? 1 : 0);

  return {
    id,
    fromPeer,
    toPeer,
    content,
    encrypted,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get inbox messages for a peer.
 */
export function getInbox(db, peerId, options = {}) {
  ensureP2PTables(db);
  const { unreadOnly = false, limit = 50 } = options;

  let sql = "SELECT * FROM p2p_messages WHERE to_peer = ?";
  const params = [peerId];

  if (unreadOnly) {
    sql += " AND read = 0";
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * Mark a message as read.
 */
export function markMessageRead(db, messageId) {
  ensureP2PTables(db);
  const result = db
    .prepare("UPDATE p2p_messages SET read = 1 WHERE id = ?")
    .run(messageId);
  return result.changes > 0;
}

/**
 * Get message count for a peer.
 */
export function getMessageCount(db, peerId) {
  ensureP2PTables(db);
  const allMsgs = db
    .prepare("SELECT * FROM p2p_messages WHERE to_peer = ?")
    .all(peerId);
  const total = allMsgs.length;
  const unread = allMsgs.filter((m) => !m.read || m.read === 0).length;
  return { total, unread };
}

/**
 * Pair a device.
 */
export function pairDevice(db, deviceName, deviceType) {
  ensureP2PTables(db);
  const deviceId = `device-${crypto.randomBytes(8).toString("hex")}`;
  const pairingCode = generatePairingCode();

  db.prepare(
    `INSERT INTO p2p_paired_devices (device_id, device_name, device_type, pairing_code, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(deviceId, deviceName, deviceType || "unknown", pairingCode, "pending");

  return { deviceId, deviceName, deviceType, pairingCode, status: "pending" };
}

/**
 * Confirm device pairing with code.
 */
export function confirmPairing(db, deviceId, code) {
  ensureP2PTables(db);
  const device = db
    .prepare("SELECT * FROM p2p_paired_devices WHERE device_id = ?")
    .get(deviceId);
  if (!device) return { success: false, error: "Device not found" };
  if (device.pairing_code !== code)
    return { success: false, error: "Invalid pairing code" };

  db.prepare(
    "UPDATE p2p_paired_devices SET status = ? WHERE device_id = ?",
  ).run("active", deviceId);
  return { success: true, deviceId, deviceName: device.device_name };
}

/**
 * Get all paired devices.
 */
export function getPairedDevices(db) {
  ensureP2PTables(db);
  return db
    .prepare("SELECT * FROM p2p_paired_devices ORDER BY paired_at DESC")
    .all();
}

/**
 * Unpair a device.
 */
export function unpairDevice(db, deviceId) {
  ensureP2PTables(db);
  const result = db
    .prepare("DELETE FROM p2p_paired_devices WHERE device_id = ?")
    .run(deviceId);
  return result.changes > 0;
}

/**
 * Delete a peer.
 */
export function deletePeer(db, peerId) {
  ensureP2PTables(db);
  const result = db
    .prepare("DELETE FROM p2p_peers WHERE peer_id = ?")
    .run(peerId);
  return result.changes > 0;
}

/**
 * P2P Bridge — connects CLI to desktop app via HTTP/WebSocket.
 */
export class P2PBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || "localhost";
    this.port = options.port || DEFAULT_SIGNALING_PORT;
    this.timeout = options.timeout || BRIDGE_TIMEOUT;
    this.connected = false;
  }

  /**
   * Check if desktop bridge is available.
   */
  async checkBridge() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      const response = await fetch(`http://${this.host}:${this.port}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response.ok;
    } catch (_err) {
      // Bridge not available
      return false;
    }
  }

  /**
   * Get bridge status info.
   */
  getStatus() {
    return {
      host: this.host,
      port: this.port,
      connected: this.connected,
      endpoint: `http://${this.host}:${this.port}`,
    };
  }
}

/* ─────────────────────────────────────────────────────────────────
 * V2 Governance Layer (in-memory, independent of SQLite p2p tables)
 *
 *   Peer maturity: pending → active → offline → archived
 *     - archived terminal
 *     - offline → active recovery (cap-exempt)
 *
 *   Message lifecycle: queued → sending → delivered | failed | cancelled
 *     - 3 terminals
 *     - per-peer pending-message cap counts queued+sending
 *
 *   Per-network active-peer cap on pending→active only (recovery exempt).
 *   Per-peer pending-message cap enforced at createMessageV2.
 *
 *   Auto-flip:
 *     - autoOfflineIdlePeersV2  active w/ lastSeenAt past idle threshold → offline
 *     - autoFailStuckMessagesV2 sending w/ startedAt past stuck threshold → failed
 * ───────────────────────────────────────────────────────────────── */

export const PEER_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  OFFLINE: "offline",
  ARCHIVED: "archived",
});

export const MESSAGE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _PEER_TRANSITIONS_V2 = new Map([
  [
    PEER_MATURITY_V2.PENDING,
    new Set([PEER_MATURITY_V2.ACTIVE, PEER_MATURITY_V2.ARCHIVED]),
  ],
  [
    PEER_MATURITY_V2.ACTIVE,
    new Set([PEER_MATURITY_V2.OFFLINE, PEER_MATURITY_V2.ARCHIVED]),
  ],
  [
    PEER_MATURITY_V2.OFFLINE,
    new Set([PEER_MATURITY_V2.ACTIVE, PEER_MATURITY_V2.ARCHIVED]),
  ],
  [PEER_MATURITY_V2.ARCHIVED, new Set()],
]);
const _PEER_TERMINALS_V2 = new Set([PEER_MATURITY_V2.ARCHIVED]);

const _MSG_TRANSITIONS_V2 = new Map([
  [
    MESSAGE_LIFECYCLE_V2.QUEUED,
    new Set([MESSAGE_LIFECYCLE_V2.SENDING, MESSAGE_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    MESSAGE_LIFECYCLE_V2.SENDING,
    new Set([
      MESSAGE_LIFECYCLE_V2.DELIVERED,
      MESSAGE_LIFECYCLE_V2.FAILED,
      MESSAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [MESSAGE_LIFECYCLE_V2.DELIVERED, new Set()],
  [MESSAGE_LIFECYCLE_V2.FAILED, new Set()],
  [MESSAGE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _MSG_TERMINALS_V2 = new Set([
  MESSAGE_LIFECYCLE_V2.DELIVERED,
  MESSAGE_LIFECYCLE_V2.FAILED,
  MESSAGE_LIFECYCLE_V2.CANCELLED,
]);

export const PEER_DEFAULT_MAX_ACTIVE_PER_NETWORK = 100;
export const PEER_DEFAULT_MAX_PENDING_MESSAGES_PER_PEER = 50;
export const PEER_DEFAULT_PEER_IDLE_MS = 10 * 60 * 1000;
export const PEER_DEFAULT_MESSAGE_STUCK_MS = 60 * 1000;

const _stateP2pV2 = {
  peers: new Map(),
  messages: new Map(),
  maxActivePeersPerNetwork: PEER_DEFAULT_MAX_ACTIVE_PER_NETWORK,
  maxPendingMessagesPerPeer: PEER_DEFAULT_MAX_PENDING_MESSAGES_PER_PEER,
  peerIdleMs: PEER_DEFAULT_PEER_IDLE_MS,
  messageStuckMs: PEER_DEFAULT_MESSAGE_STUCK_MS,
};

function _posIntP2pV2(n, label) {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return v;
}

function _copyPeerV2(p) {
  return { ...p, metadata: { ...p.metadata } };
}

function _copyMsgV2(m) {
  return { ...m, metadata: { ...m.metadata } };
}

export function getMaxActivePeersPerNetworkV2() {
  return _stateP2pV2.maxActivePeersPerNetwork;
}

export function setMaxActivePeersPerNetworkV2(n) {
  _stateP2pV2.maxActivePeersPerNetwork = _posIntP2pV2(
    n,
    "maxActivePeersPerNetwork",
  );
}

export function getMaxPendingMessagesPerPeerV2() {
  return _stateP2pV2.maxPendingMessagesPerPeer;
}

export function setMaxPendingMessagesPerPeerV2(n) {
  _stateP2pV2.maxPendingMessagesPerPeer = _posIntP2pV2(
    n,
    "maxPendingMessagesPerPeer",
  );
}

export function getPeerIdleMsV2() {
  return _stateP2pV2.peerIdleMs;
}

export function setPeerIdleMsV2(ms) {
  _stateP2pV2.peerIdleMs = _posIntP2pV2(ms, "peerIdleMs");
}

export function getMessageStuckMsV2() {
  return _stateP2pV2.messageStuckMs;
}

export function setMessageStuckMsV2(ms) {
  _stateP2pV2.messageStuckMs = _posIntP2pV2(ms, "messageStuckMs");
}

export function getActivePeerCountV2(networkId) {
  let count = 0;
  for (const p of _stateP2pV2.peers.values()) {
    if (p.networkId === networkId && p.status === PEER_MATURITY_V2.ACTIVE) {
      count++;
    }
  }
  return count;
}

export function getPendingMessageCountV2(peerId) {
  let count = 0;
  for (const m of _stateP2pV2.messages.values()) {
    if (
      m.peerId === peerId &&
      (m.status === MESSAGE_LIFECYCLE_V2.QUEUED ||
        m.status === MESSAGE_LIFECYCLE_V2.SENDING)
    ) {
      count++;
    }
  }
  return count;
}

export function registerPeerV2(
  id,
  { networkId, deviceName, deviceType, metadata } = {},
) {
  if (!id) throw new Error("peer id is required");
  if (!networkId) throw new Error("networkId is required");
  if (_stateP2pV2.peers.has(id)) throw new Error(`peer ${id} already exists`);
  const now = Date.now();
  const peer = {
    id,
    networkId,
    deviceName: deviceName || id,
    deviceType: deviceType || "desktop",
    status: PEER_MATURITY_V2.PENDING,
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateP2pV2.peers.set(id, peer);
  return _copyPeerV2(peer);
}

export function getPeerV2(id) {
  const p = _stateP2pV2.peers.get(id);
  return p ? _copyPeerV2(p) : null;
}

export function listPeersV2({ networkId, status, deviceType } = {}) {
  const out = [];
  for (const p of _stateP2pV2.peers.values()) {
    if (networkId && p.networkId !== networkId) continue;
    if (status && p.status !== status) continue;
    if (deviceType && p.deviceType !== deviceType) continue;
    out.push(_copyPeerV2(p));
  }
  return out;
}

export function setPeerStatusV2(id, next) {
  const p = _stateP2pV2.peers.get(id);
  if (!p) throw new Error(`peer ${id} not found`);
  const allowed = _PEER_TRANSITIONS_V2.get(p.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid peer transition: ${p.status} → ${next}`);
  }
  if (
    p.status === PEER_MATURITY_V2.PENDING &&
    next === PEER_MATURITY_V2.ACTIVE
  ) {
    const count = getActivePeerCountV2(p.networkId);
    if (count >= _stateP2pV2.maxActivePeersPerNetwork) {
      throw new Error(
        `network ${p.networkId} active-peer cap reached (${count}/${_stateP2pV2.maxActivePeersPerNetwork})`,
      );
    }
  }
  const now = Date.now();
  p.status = next;
  p.lastSeenAt = now;
  if (next === PEER_MATURITY_V2.ACTIVE && !p.activatedAt) p.activatedAt = now;
  if (_PEER_TERMINALS_V2.has(next) && !p.archivedAt) p.archivedAt = now;
  return _copyPeerV2(p);
}

export function activatePeerV2(id) {
  return setPeerStatusV2(id, PEER_MATURITY_V2.ACTIVE);
}

export function offlinePeerV2(id) {
  return setPeerStatusV2(id, PEER_MATURITY_V2.OFFLINE);
}

export function archivePeerV2(id) {
  return setPeerStatusV2(id, PEER_MATURITY_V2.ARCHIVED);
}

export function touchPeerV2(id) {
  const p = _stateP2pV2.peers.get(id);
  if (!p) throw new Error(`peer ${id} not found`);
  p.lastSeenAt = Date.now();
  return _copyPeerV2(p);
}

export function createMessageV2(id, { peerId, kind, metadata } = {}) {
  if (!id) throw new Error("message id is required");
  if (!peerId) throw new Error("peerId is required");
  if (_stateP2pV2.messages.has(id))
    throw new Error(`message ${id} already exists`);
  const peer = _stateP2pV2.peers.get(peerId);
  if (!peer) throw new Error(`peer ${peerId} not found`);
  const pending = getPendingMessageCountV2(peerId);
  if (pending >= _stateP2pV2.maxPendingMessagesPerPeer) {
    throw new Error(
      `peer ${peerId} pending-message cap reached (${pending}/${_stateP2pV2.maxPendingMessagesPerPeer})`,
    );
  }
  const now = Date.now();
  const msg = {
    id,
    peerId,
    kind: kind || "text",
    status: MESSAGE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateP2pV2.messages.set(id, msg);
  return _copyMsgV2(msg);
}

export function getMessageV2(id) {
  const m = _stateP2pV2.messages.get(id);
  return m ? _copyMsgV2(m) : null;
}

export function listMessagesV2({ peerId, status } = {}) {
  const out = [];
  for (const m of _stateP2pV2.messages.values()) {
    if (peerId && m.peerId !== peerId) continue;
    if (status && m.status !== status) continue;
    out.push(_copyMsgV2(m));
  }
  return out;
}

export function setMessageStatusV2(id, next) {
  const m = _stateP2pV2.messages.get(id);
  if (!m) throw new Error(`message ${id} not found`);
  const allowed = _MSG_TRANSITIONS_V2.get(m.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid message transition: ${m.status} → ${next}`);
  }
  const now = Date.now();
  m.status = next;
  m.lastSeenAt = now;
  if (next === MESSAGE_LIFECYCLE_V2.SENDING && !m.startedAt) m.startedAt = now;
  if (_MSG_TERMINALS_V2.has(next) && !m.settledAt) m.settledAt = now;
  return _copyMsgV2(m);
}

export function startMessageV2(id) {
  return setMessageStatusV2(id, MESSAGE_LIFECYCLE_V2.SENDING);
}

export function deliverMessageV2(id) {
  return setMessageStatusV2(id, MESSAGE_LIFECYCLE_V2.DELIVERED);
}

export function failMessageV2(id) {
  return setMessageStatusV2(id, MESSAGE_LIFECYCLE_V2.FAILED);
}

export function cancelMessageV2(id) {
  return setMessageStatusV2(id, MESSAGE_LIFECYCLE_V2.CANCELLED);
}

export function autoOfflineIdlePeersV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const p of _stateP2pV2.peers.values()) {
    if (
      p.status === PEER_MATURITY_V2.ACTIVE &&
      now - p.lastSeenAt >= _stateP2pV2.peerIdleMs
    ) {
      p.status = PEER_MATURITY_V2.OFFLINE;
      p.lastSeenAt = now;
      flipped.push(p.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckMessagesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const m of _stateP2pV2.messages.values()) {
    if (
      m.status === MESSAGE_LIFECYCLE_V2.SENDING &&
      m.startedAt &&
      now - m.startedAt >= _stateP2pV2.messageStuckMs
    ) {
      m.status = MESSAGE_LIFECYCLE_V2.FAILED;
      m.lastSeenAt = now;
      if (!m.settledAt) m.settledAt = now;
      flipped.push(m.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function getP2pManagerStatsV2() {
  const peersByStatus = {};
  for (const s of Object.values(PEER_MATURITY_V2)) peersByStatus[s] = 0;
  for (const p of _stateP2pV2.peers.values()) peersByStatus[p.status]++;
  const messagesByStatus = {};
  for (const s of Object.values(MESSAGE_LIFECYCLE_V2)) messagesByStatus[s] = 0;
  for (const m of _stateP2pV2.messages.values()) messagesByStatus[m.status]++;
  return {
    totalPeersV2: _stateP2pV2.peers.size,
    totalMessagesV2: _stateP2pV2.messages.size,
    maxActivePeersPerNetwork: _stateP2pV2.maxActivePeersPerNetwork,
    maxPendingMessagesPerPeer: _stateP2pV2.maxPendingMessagesPerPeer,
    peerIdleMs: _stateP2pV2.peerIdleMs,
    messageStuckMs: _stateP2pV2.messageStuckMs,
    peersByStatus,
    messagesByStatus,
  };
}

export function _resetStateP2pManagerV2() {
  _stateP2pV2.peers.clear();
  _stateP2pV2.messages.clear();
  _stateP2pV2.maxActivePeersPerNetwork = PEER_DEFAULT_MAX_ACTIVE_PER_NETWORK;
  _stateP2pV2.maxPendingMessagesPerPeer =
    PEER_DEFAULT_MAX_PENDING_MESSAGES_PER_PEER;
  _stateP2pV2.peerIdleMs = PEER_DEFAULT_PEER_IDLE_MS;
  _stateP2pV2.messageStuckMs = PEER_DEFAULT_MESSAGE_STUCK_MS;
}

// =====================================================================
// p2p-manager V2 governance overlay (iter20)
// =====================================================================
export const P2PGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const P2PGOV_GOSSIP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  BROADCASTING: "broadcasting",
  BROADCAST: "broadcast",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _p2pgovPTrans = new Map([
  [
    P2PGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      P2PGOV_PROFILE_MATURITY_V2.ACTIVE,
      P2PGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    P2PGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      P2PGOV_PROFILE_MATURITY_V2.SUSPENDED,
      P2PGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    P2PGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      P2PGOV_PROFILE_MATURITY_V2.ACTIVE,
      P2PGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [P2PGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _p2pgovPTerminal = new Set([P2PGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _p2pgovJTrans = new Map([
  [
    P2PGOV_GOSSIP_LIFECYCLE_V2.QUEUED,
    new Set([
      P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCASTING,
      P2PGOV_GOSSIP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCASTING,
    new Set([
      P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCAST,
      P2PGOV_GOSSIP_LIFECYCLE_V2.FAILED,
      P2PGOV_GOSSIP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCAST, new Set()],
  [P2PGOV_GOSSIP_LIFECYCLE_V2.FAILED, new Set()],
  [P2PGOV_GOSSIP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _p2pgovPsV2 = new Map();
const _p2pgovJsV2 = new Map();
let _p2pgovMaxActive = 12,
  _p2pgovMaxPending = 30,
  _p2pgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _p2pgovStuckMs = 60 * 1000;
function _p2pgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _p2pgovCheckP(from, to) {
  const a = _p2pgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid p2pgov profile transition ${from} → ${to}`);
}
function _p2pgovCheckJ(from, to) {
  const a = _p2pgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid p2pgov gossip transition ${from} → ${to}`);
}
function _p2pgovCountActive(owner) {
  let c = 0;
  for (const p of _p2pgovPsV2.values())
    if (p.owner === owner && p.status === P2PGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _p2pgovCountPending(profileId) {
  let c = 0;
  for (const j of _p2pgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === P2PGOV_GOSSIP_LIFECYCLE_V2.QUEUED ||
        j.status === P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCASTING)
    )
      c++;
  return c;
}
export function setMaxActiveP2pgovProfilesPerOwnerV2(n) {
  _p2pgovMaxActive = _p2pgovPos(n, "maxActiveP2pgovProfilesPerOwner");
}
export function getMaxActiveP2pgovProfilesPerOwnerV2() {
  return _p2pgovMaxActive;
}
export function setMaxPendingP2pgovGossipsPerProfileV2(n) {
  _p2pgovMaxPending = _p2pgovPos(n, "maxPendingP2pgovGossipsPerProfile");
}
export function getMaxPendingP2pgovGossipsPerProfileV2() {
  return _p2pgovMaxPending;
}
export function setP2pgovProfileIdleMsV2(n) {
  _p2pgovIdleMs = _p2pgovPos(n, "p2pgovProfileIdleMs");
}
export function getP2pgovProfileIdleMsV2() {
  return _p2pgovIdleMs;
}
export function setP2pgovGossipStuckMsV2(n) {
  _p2pgovStuckMs = _p2pgovPos(n, "p2pgovGossipStuckMs");
}
export function getP2pgovGossipStuckMsV2() {
  return _p2pgovStuckMs;
}
export function _resetStateP2pManagerGovV2() {
  _p2pgovPsV2.clear();
  _p2pgovJsV2.clear();
  _p2pgovMaxActive = 12;
  _p2pgovMaxPending = 30;
  _p2pgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _p2pgovStuckMs = 60 * 1000;
}
export function registerP2pgovProfileV2({
  id,
  owner,
  transport,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_p2pgovPsV2.has(id))
    throw new Error(`p2pgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    transport: transport || "tcp",
    status: P2PGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _p2pgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateP2pgovProfileV2(id) {
  const p = _p2pgovPsV2.get(id);
  if (!p) throw new Error(`p2pgov profile ${id} not found`);
  const isInitial = p.status === P2PGOV_PROFILE_MATURITY_V2.PENDING;
  _p2pgovCheckP(p.status, P2PGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _p2pgovCountActive(p.owner) >= _p2pgovMaxActive)
    throw new Error(`max active p2pgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = P2PGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendP2pgovProfileV2(id) {
  const p = _p2pgovPsV2.get(id);
  if (!p) throw new Error(`p2pgov profile ${id} not found`);
  _p2pgovCheckP(p.status, P2PGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = P2PGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveP2pgovProfileV2(id) {
  const p = _p2pgovPsV2.get(id);
  if (!p) throw new Error(`p2pgov profile ${id} not found`);
  _p2pgovCheckP(p.status, P2PGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = P2PGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchP2pgovProfileV2(id) {
  const p = _p2pgovPsV2.get(id);
  if (!p) throw new Error(`p2pgov profile ${id} not found`);
  if (_p2pgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal p2pgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getP2pgovProfileV2(id) {
  const p = _p2pgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listP2pgovProfilesV2() {
  return [..._p2pgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createP2pgovGossipV2({ id, profileId, topic, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_p2pgovJsV2.has(id))
    throw new Error(`p2pgov gossip ${id} already exists`);
  if (!_p2pgovPsV2.has(profileId))
    throw new Error(`p2pgov profile ${profileId} not found`);
  if (_p2pgovCountPending(profileId) >= _p2pgovMaxPending)
    throw new Error(
      `max pending p2pgov gossips for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    topic: topic || "",
    status: P2PGOV_GOSSIP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _p2pgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function broadcastingP2pgovGossipV2(id) {
  const j = _p2pgovJsV2.get(id);
  if (!j) throw new Error(`p2pgov gossip ${id} not found`);
  _p2pgovCheckJ(j.status, P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCASTING);
  const now = Date.now();
  j.status = P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCASTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeGossipP2pgovV2(id) {
  const j = _p2pgovJsV2.get(id);
  if (!j) throw new Error(`p2pgov gossip ${id} not found`);
  _p2pgovCheckJ(j.status, P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCAST);
  const now = Date.now();
  j.status = P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCAST;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failP2pgovGossipV2(id, reason) {
  const j = _p2pgovJsV2.get(id);
  if (!j) throw new Error(`p2pgov gossip ${id} not found`);
  _p2pgovCheckJ(j.status, P2PGOV_GOSSIP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = P2PGOV_GOSSIP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelP2pgovGossipV2(id, reason) {
  const j = _p2pgovJsV2.get(id);
  if (!j) throw new Error(`p2pgov gossip ${id} not found`);
  _p2pgovCheckJ(j.status, P2PGOV_GOSSIP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = P2PGOV_GOSSIP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getP2pgovGossipV2(id) {
  const j = _p2pgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listP2pgovGossipsV2() {
  return [..._p2pgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleP2pgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _p2pgovPsV2.values())
    if (
      p.status === P2PGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _p2pgovIdleMs
    ) {
      p.status = P2PGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckP2pgovGossipsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _p2pgovJsV2.values())
    if (
      j.status === P2PGOV_GOSSIP_LIFECYCLE_V2.BROADCASTING &&
      j.startedAt != null &&
      t - j.startedAt >= _p2pgovStuckMs
    ) {
      j.status = P2PGOV_GOSSIP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getP2pManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(P2PGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _p2pgovPsV2.values()) profilesByStatus[p.status]++;
  const gossipsByStatus = {};
  for (const v of Object.values(P2PGOV_GOSSIP_LIFECYCLE_V2))
    gossipsByStatus[v] = 0;
  for (const j of _p2pgovJsV2.values()) gossipsByStatus[j.status]++;
  return {
    totalP2pgovProfilesV2: _p2pgovPsV2.size,
    totalP2pgovGossipsV2: _p2pgovJsV2.size,
    maxActiveP2pgovProfilesPerOwner: _p2pgovMaxActive,
    maxPendingP2pgovGossipsPerProfile: _p2pgovMaxPending,
    p2pgovProfileIdleMs: _p2pgovIdleMs,
    p2pgovGossipStuckMs: _p2pgovStuckMs,
    profilesByStatus,
    gossipsByStatus,
  };
}
