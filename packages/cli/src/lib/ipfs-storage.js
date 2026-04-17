/**
 * IPFS Storage — CLI port of Phase 17
 * (docs/design/modules/17_IPFS去中心化存储.md).
 *
 * Desktop uses IPFSManager with dual-engine mode
 * (embedded Helia + external Kubo RPC) and 18 IPC handlers.
 *
 * CLI port ships:
 *
 *   - Content-addressed store backed by SQLite (CID = sha256(content))
 *   - AES-256-GCM encryption (same scheme as desktop: iv + tag + ct)
 *   - Pin / unpin / list-pins lifecycle
 *   - Storage stats + quota enforcement + garbage collection
 *   - Knowledge attachment linkage (knowledge_id → CIDs)
 *   - Mode toggle (embedded/external) stored as metadata only
 *
 * What does NOT port: real Helia node, libp2p peer discovery,
 * Kubo HTTP RPC, real DAG sharding, bitswap protocol.
 * CIDs are deterministic sha256 hashes (not real CIDv1),
 * so content is local-only.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const NODE_MODE = Object.freeze({
  EMBEDDED: "embedded",
  EXTERNAL: "external",
});

export const NODE_STATUS = Object.freeze({
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  ERROR: "error",
});

export const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB

/* ── State ──────────────────────────────────────────────── */

let _content = new Map(); // cid → row
let _knowledgeLinks = new Map(); // knowledge_id → Set(cid)
let _node = {
  status: NODE_STATUS.STOPPED,
  mode: NODE_MODE.EMBEDDED,
  startedAt: null,
  peerId: null,
};
let _quotaBytes = DEFAULT_QUOTA_BYTES;

/* ── Helpers ────────────────────────────────────────────── */

function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

function _computeCid(buffer) {
  // Deterministic content addressing using sha256.
  // Real IPFS uses CIDv1 with multihash, but for CLI port we
  // use a base58-like hex prefix to keep CIDs identifiable.
  const hash = crypto.createHash("sha256").update(buffer).digest();
  return `bafy${hash.toString("hex").slice(0, 48)}`;
}

function _toBuffer(content) {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === "string") return Buffer.from(content, "utf-8");
  if (content instanceof Uint8Array) return Buffer.from(content);
  return Buffer.from(JSON.stringify(content), "utf-8");
}

/* ── Schema ─────────────────────────────────────────────── */

export function ensureIpfsTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ipfs_content (
    id TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    filename TEXT,
    size INTEGER NOT NULL,
    mime_type TEXT,
    pinned INTEGER DEFAULT 0,
    encrypted INTEGER DEFAULT 0,
    encryption_key TEXT,
    knowledge_id TEXT,
    metadata TEXT,
    payload TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS ipfs_node_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT,
    updated_at INTEGER NOT NULL
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _content.clear();
  _knowledgeLinks.clear();

  try {
    for (const row of db.prepare("SELECT * FROM ipfs_content").all()) {
      const r = _strip(row);
      _content.set(r.cid, r);
      if (r.knowledge_id) {
        if (!_knowledgeLinks.has(r.knowledge_id))
          _knowledgeLinks.set(r.knowledge_id, new Set());
        _knowledgeLinks.get(r.knowledge_id).add(r.cid);
      }
    }
  } catch (_e) {
    /* table may not exist */
  }

  try {
    for (const row of db.prepare("SELECT * FROM ipfs_node_config").all()) {
      const r = _strip(row);
      if (r.config_key === "quota")
        _quotaBytes = Number(r.config_value) || DEFAULT_QUOTA_BYTES;
      else if (r.config_key === "mode") _node.mode = r.config_value;
    }
  } catch (_e) {
    /* empty */
  }
}

/* ── Encryption ─────────────────────────────────────────── */

function _encrypt(data) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([iv, tag, encrypted]),
    key: key.toString("hex"),
  };
}

function _decrypt(data, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = data.subarray(0, 16);
  const tag = data.subarray(16, 32);
  const ciphertext = data.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/* ── Node lifecycle ─────────────────────────────────────── */

export function startNode(db, { mode } = {}) {
  if (_node.status === NODE_STATUS.RUNNING)
    return { started: false, reason: "already_running" };

  const resolvedMode = mode || _node.mode || NODE_MODE.EMBEDDED;
  if (!Object.values(NODE_MODE).includes(resolvedMode))
    return { started: false, reason: "invalid_mode" };

  _node.status = NODE_STATUS.RUNNING;
  _node.mode = resolvedMode;
  _node.startedAt = _now();
  _node.peerId = `sim-${crypto.randomUUID()}`;

  _persistConfig(db, "mode", resolvedMode);
  return {
    started: true,
    status: _node.status,
    mode: _node.mode,
    peerId: _node.peerId,
  };
}

export function stopNode(db) {
  if (_node.status !== NODE_STATUS.RUNNING)
    return { stopped: false, reason: "not_running" };
  _node.status = NODE_STATUS.STOPPED;
  _node.startedAt = null;
  _node.peerId = null;
  return { stopped: true };
}

export function getNodeStatus() {
  return {
    status: _node.status,
    mode: _node.mode,
    startedAt: _node.startedAt,
    peerId: _node.peerId,
    uptimeMs: _node.startedAt ? _now() - _node.startedAt : 0,
  };
}

export function setMode(db, mode) {
  if (!Object.values(NODE_MODE).includes(mode))
    return { set: false, reason: "invalid_mode" };
  if (_node.status === NODE_STATUS.RUNNING)
    return { set: false, reason: "stop_node_first" };
  _node.mode = mode;
  _persistConfig(db, "mode", mode);
  return { set: true, mode };
}

/* ── Config persistence ─────────────────────────────────── */

function _persistConfig(db, key, value) {
  const now = _now();
  const valueStr = String(value);
  const existing = db
    .prepare("SELECT config_key FROM ipfs_node_config WHERE config_key = ?")
    .get(key);
  if (existing) {
    db.prepare(
      "UPDATE ipfs_node_config SET config_value = ?, updated_at = ? WHERE config_key = ?",
    ).run(valueStr, now, key);
  } else {
    db.prepare(
      "INSERT INTO ipfs_node_config (config_key, config_value, updated_at) VALUES (?, ?, ?)",
    ).run(key, valueStr, now);
  }
}

/* ── Content operations ─────────────────────────────────── */

export function addContent(
  db,
  content,
  { filename, mimeType, encrypt, pin, knowledgeId, metadata } = {},
) {
  if (_node.status !== NODE_STATUS.RUNNING)
    return { added: false, reason: "node_not_running" };
  if (content == null || content === "")
    return { added: false, reason: "empty_content" };

  const buffer = _toBuffer(content);
  const size = buffer.length;

  // Quota check (sum pinned only — desktop semantics)
  const pinnedSize = _pinnedBytes();
  if (pin && pinnedSize + size > _quotaBytes)
    return { added: false, reason: "quota_exceeded" };

  let payload = buffer;
  let encryptionKey = null;
  if (encrypt) {
    const enc = _encrypt(buffer);
    payload = enc.encrypted;
    encryptionKey = enc.key;
  }

  const cid = _computeCid(payload);

  // Idempotent: if CID exists, just update flags
  const existing = _content.get(cid);
  if (existing) {
    const now = _now();
    if (pin && !existing.pinned) {
      existing.pinned = 1;
      existing.updated_at = now;
      db.prepare(
        "UPDATE ipfs_content SET pinned = 1, updated_at = ? WHERE cid = ?",
      ).run(now, cid);
    }
    return {
      added: true,
      cid,
      size: existing.size,
      pinned: Boolean(existing.pinned),
      duplicate: true,
    };
  }

  const id = crypto.randomUUID();
  const now = _now();
  const metadataJson = metadata
    ? typeof metadata === "string"
      ? metadata
      : JSON.stringify(metadata)
    : null;
  const payloadBase64 = payload.toString("base64");

  const entry = {
    id,
    cid,
    filename: filename || null,
    size,
    mime_type: mimeType || null,
    pinned: pin ? 1 : 0,
    encrypted: encrypt ? 1 : 0,
    encryption_key: encryptionKey,
    knowledge_id: knowledgeId || null,
    metadata: metadataJson,
    payload: payloadBase64,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO ipfs_content (id, cid, filename, size, mime_type, pinned, encrypted, encryption_key, knowledge_id, metadata, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    cid,
    entry.filename,
    size,
    entry.mime_type,
    entry.pinned,
    entry.encrypted,
    entry.encryption_key,
    entry.knowledge_id,
    entry.metadata,
    entry.payload,
    now,
    now,
  );

  _content.set(cid, entry);
  if (knowledgeId) {
    if (!_knowledgeLinks.has(knowledgeId))
      _knowledgeLinks.set(knowledgeId, new Set());
    _knowledgeLinks.get(knowledgeId).add(cid);
  }

  return {
    added: true,
    cid,
    size,
    pinned: Boolean(entry.pinned),
    encrypted: Boolean(entry.encrypted),
  };
}

export function getContent(db, cid, { asString } = {}) {
  if (_node.status !== NODE_STATUS.RUNNING) return null;
  const entry = _content.get(cid);
  if (!entry) return null;

  let buffer = Buffer.from(entry.payload, "base64");
  if (entry.encrypted && entry.encryption_key) {
    try {
      buffer = _decrypt(buffer, entry.encryption_key);
    } catch (_e) {
      return null;
    }
  }

  return {
    cid: entry.cid,
    size: entry.size,
    filename: entry.filename,
    mimeType: entry.mime_type,
    encrypted: Boolean(entry.encrypted),
    pinned: Boolean(entry.pinned),
    content: asString ? buffer.toString("utf-8") : buffer,
    base64: buffer.toString("base64"),
    metadata: entry.metadata ? _parseMaybe(entry.metadata) : null,
  };
}

function _parseMaybe(raw) {
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw;
  }
}

export function hasContent(db, cid) {
  return _content.has(cid);
}

export function listContent(db, { pinned, knowledgeId, limit = 50 } = {}) {
  let results = [..._content.values()];
  if (pinned != null) {
    const v = pinned ? 1 : 0;
    results = results.filter((c) => c.pinned === v);
  }
  if (knowledgeId)
    results = results.filter((c) => c.knowledge_id === knowledgeId);
  return results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((c) => {
      const { payload, encryption_key, ...rest } = c;
      return rest;
    });
}

/* ── Pin management ─────────────────────────────────────── */

export function pin(db, cid) {
  const entry = _content.get(cid);
  if (!entry) return { pinned: false, reason: "not_found" };
  if (entry.pinned) return { pinned: false, reason: "already_pinned" };

  const pinnedSize = _pinnedBytes();
  if (pinnedSize + entry.size > _quotaBytes)
    return { pinned: false, reason: "quota_exceeded" };

  const now = _now();
  entry.pinned = 1;
  entry.updated_at = now;
  db.prepare(
    "UPDATE ipfs_content SET pinned = 1, updated_at = ? WHERE cid = ?",
  ).run(now, cid);
  return { pinned: true, cid };
}

export function unpin(db, cid) {
  const entry = _content.get(cid);
  if (!entry) return { unpinned: false, reason: "not_found" };
  if (!entry.pinned) return { unpinned: false, reason: "not_pinned" };

  const now = _now();
  entry.pinned = 0;
  entry.updated_at = now;
  db.prepare(
    "UPDATE ipfs_content SET pinned = 0, updated_at = ? WHERE cid = ?",
  ).run(now, cid);
  return { unpinned: true, cid };
}

export function listPins(db, { limit = 50, sortBy = "created_at" } = {}) {
  const pinned = [..._content.values()].filter((c) => c.pinned === 1);
  const sorter =
    sortBy === "size"
      ? (a, b) => b.size - a.size
      : sortBy === "filename"
        ? (a, b) => (a.filename || "").localeCompare(b.filename || "")
        : (a, b) => b.created_at - a.created_at;
  return pinned
    .sort(sorter)
    .slice(0, limit)
    .map((c) => {
      const { payload, encryption_key, ...rest } = c;
      return rest;
    });
}

/* ── Storage stats + GC + quota ─────────────────────────── */

function _pinnedBytes() {
  let total = 0;
  for (const c of _content.values()) if (c.pinned) total += c.size;
  return total;
}

function _totalBytes() {
  let total = 0;
  for (const c of _content.values()) total += c.size;
  return total;
}

export function getStorageStats() {
  const pinnedBytes = _pinnedBytes();
  const totalBytes = _totalBytes();
  let pinnedCount = 0;
  let encryptedCount = 0;
  for (const c of _content.values()) {
    if (c.pinned) pinnedCount++;
    if (c.encrypted) encryptedCount++;
  }
  return {
    totalContent: _content.size,
    pinnedCount,
    encryptedCount,
    totalBytes,
    pinnedBytes,
    quotaBytes: _quotaBytes,
    usagePercent:
      _quotaBytes > 0
        ? Number(((pinnedBytes / _quotaBytes) * 100).toFixed(2))
        : 0,
    peerCount: _node.status === NODE_STATUS.RUNNING ? 0 : 0,
  };
}

export function garbageCollect(db) {
  // Remove all unpinned content (desktop semantics)
  const before = _content.size;
  let freedBytes = 0;
  const toRemove = [];
  for (const [cid, entry] of _content) {
    if (!entry.pinned) {
      toRemove.push(cid);
      freedBytes += entry.size;
    }
  }
  for (const cid of toRemove) {
    _content.delete(cid);
    db.prepare("DELETE FROM ipfs_content WHERE cid = ?").run(cid);
  }
  // Clean up knowledge links pointing to removed CIDs
  for (const [kid, set] of _knowledgeLinks) {
    for (const cid of [...set]) {
      if (!_content.has(cid)) set.delete(cid);
    }
    if (set.size === 0) _knowledgeLinks.delete(kid);
  }
  return {
    removed: toRemove.length,
    freedBytes,
    before,
    after: _content.size,
  };
}

export function setQuota(db, quotaBytes) {
  const n = Number(quotaBytes);
  if (!Number.isFinite(n) || n <= 0)
    return { set: false, reason: "invalid_quota" };
  _quotaBytes = Math.floor(n);
  _persistConfig(db, "quota", _quotaBytes);
  return { set: true, quotaBytes: _quotaBytes };
}

/* ── Knowledge attachment linkage ───────────────────────── */

export function addKnowledgeAttachment(
  db,
  knowledgeId,
  content,
  metadata = {},
) {
  if (!knowledgeId) return { added: false, reason: "missing_knowledge_id" };
  const result = addContent(db, content, {
    knowledgeId,
    metadata,
    pin: true,
    filename: metadata?.filename,
    mimeType: metadata?.mimeType,
  });
  if (!result.added) return result;
  return { ...result, knowledgeId };
}

export function getKnowledgeAttachments(db, knowledgeId) {
  const set = _knowledgeLinks.get(knowledgeId);
  if (!set) return [];
  return [...set]
    .map((cid) => _content.get(cid))
    .filter(Boolean)
    .map((c) => {
      const { payload, encryption_key, ...rest } = c;
      return rest;
    });
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _content.clear();
  _knowledgeLinks.clear();
  _node = {
    status: NODE_STATUS.STOPPED,
    mode: NODE_MODE.EMBEDDED,
    startedAt: null,
    peerId: null,
  };
  _quotaBytes = DEFAULT_QUOTA_BYTES;
}
