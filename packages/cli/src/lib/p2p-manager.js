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
