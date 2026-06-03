/**
 * Decentralized Agent Network — CLI port of Phase 24
 * (docs/design/modules/24_去中心化Agent网络.md).
 *
 * Desktop ships 20 IPC handlers across 6 components (AgentDID,
 * AgentReputation, FederatedAgentRegistry, AgentAuthenticator,
 * AgentCredentialManager, CrossOrgTaskRouter) with 7 SQLite tables.
 *
 * CLI port is headless & single-process: no real Kademlia DHT, no
 * libp2p peer sync, no EventEmitter. Kademlia k-buckets are simulated
 * as rows in federated_registry_peers (k-bucket index derived from
 * XOR prefix of SHA-256(peerId)). Challenge-response uses the same
 * Ed25519 key stored against the DID.
 */

import crypto from "crypto";

/* ── Constants ───────────────────────────────────────────── */

export const DID_STATUS = Object.freeze({
  ACTIVE: "active",
  DEACTIVATED: "deactivated",
});

export const REG_STATUS = Object.freeze({
  ONLINE: "online",
  OFFLINE: "offline",
});

export const AUTH_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  EXPIRED: "expired",
});

export const CRED_STATUS = Object.freeze({
  ACTIVE: "active",
  REVOKED: "revoked",
});

export const TASK_STATUS = Object.freeze({
  PENDING: "pending",
  ROUTED: "routed",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const REPUTATION_DIMENSIONS = Object.freeze([
  "reliability",
  "quality",
  "speed",
  "cooperation",
]);

export const REPUTATION_WEIGHTS = Object.freeze({
  reliability: 1.2,
  quality: 1.3,
  speed: 0.8,
  cooperation: 1.0,
});

export const KADEMLIA_BITS = 160;
export const KADEMLIA_K = 20;

export const SESSION_TTL_MS = 15 * 60_000;
export const HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
export const MAX_REPUTATION = 5.0;
export const MIN_REPUTATION = 0.0;
export const REPUTATION_DECAY_WEEKLY = 0.95;

/* ── Schema ──────────────────────────────────────────────── */

export function ensureAgentNetworkTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_dids (
      did TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      did_document TEXT NOT NULL,
      metadata TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_reputation (
      id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      dimension TEXT NOT NULL,
      score REAL NOT NULL,
      evidence TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS federated_agent_registry (
      agent_did TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      endpoint TEXT,
      status TEXT NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS federated_registry_peers (
      peer_id TEXT PRIMARY KEY,
      endpoint TEXT,
      agent_did TEXT,
      k_bucket INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_auth_sessions (
      session_id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      token TEXT NOT NULL,
      challenge TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_credentials (
      id TEXT PRIMARY KEY,
      issuer_did TEXT NOT NULL,
      subject_did TEXT NOT NULL,
      type TEXT NOT NULL,
      claims TEXT NOT NULL,
      proof TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS federated_task_log (
      task_id TEXT PRIMARY KEY,
      source_org TEXT NOT NULL,
      target_org TEXT,
      agent_did TEXT,
      task_type TEXT NOT NULL,
      payload TEXT,
      requirements TEXT,
      status TEXT NOT NULL,
      result TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);
}

/* ── Helpers ─────────────────────────────────────────────── */

function _now() {
  return Date.now();
}

function _uuid() {
  return crypto.randomUUID();
}

function _sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function _hex(buf) {
  return Buffer.from(buf).toString("hex");
}

function _json(v) {
  if (v == null) return null;
  return JSON.stringify(v);
}

function _parse(s, fallback = null) {
  if (s == null || s === "") return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/* ── Ed25519 keypair ─────────────────────────────────────── */

function _generateEd25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey.toString("hex"),
    privateKey: privateKey.toString("hex"),
  };
}

function _signEd25519(privateKeyHex, data) {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(data), key).toString("hex");
}

function _verifyEd25519(publicKeyHex, data, signatureHex) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, "hex"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(data),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

/* ── Kademlia helpers ────────────────────────────────────── */

function _kBucketFor(peerId, localId = "local") {
  const a = _sha256(Buffer.from(peerId));
  const b = _sha256(Buffer.from(localId));
  for (let i = 0; i < a.length; i++) {
    const xor = a[i] ^ b[i];
    if (xor === 0) continue;
    const prefixZeros = Math.clz32(xor) - 24;
    return i * 8 + prefixZeros;
  }
  return KADEMLIA_BITS - 1;
}

/* ── DID management ──────────────────────────────────────── */

export function createAgentDID(db, { displayName, metadata = {} } = {}) {
  const { publicKey, privateKey } = _generateEd25519();
  const idHash = _sha256(Buffer.from(publicKey, "hex"))
    .toString("base64url")
    .slice(0, 32);
  const did = `did:chainless:${idHash}`;
  const now = _now();

  const didDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyHex: publicKey,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    service: displayName
      ? [
          {
            id: `${did}#agent-service`,
            type: "AgentService",
            serviceEndpoint: { name: displayName },
          },
        ]
      : [],
  };

  db.prepare(
    `INSERT INTO agent_dids
      (did, public_key, private_key, did_document, metadata, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    did,
    publicKey,
    privateKey,
    JSON.stringify(didDocument),
    _json({ displayName, ...metadata }),
    DID_STATUS.ACTIVE,
    now,
    now,
  );

  return { did, publicKey, didDocument };
}

export function resolveAgentDID(db, did) {
  const row = db.prepare(`SELECT * FROM agent_dids WHERE did = ?`).get(did);
  if (!row) return null;
  return {
    did: row.did,
    publicKey: row.public_key,
    status: row.status,
    didDocument: _parse(row.did_document),
    metadata: _parse(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAgentDIDs(db, { status, limit = 100 } = {}) {
  const params = [];
  let sql = `SELECT * FROM agent_dids`;
  if (status) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    did: r.did,
    publicKey: r.public_key,
    status: r.status,
    metadata: _parse(r.metadata, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function deactivateAgentDID(db, did) {
  const row = db.prepare(`SELECT did FROM agent_dids WHERE did = ?`).get(did);
  if (!row) return { changed: false };
  const now = _now();
  db.prepare(
    `UPDATE agent_dids SET status = ?, updated_at = ? WHERE did = ?`,
  ).run(DID_STATUS.DEACTIVATED, now, did);
  db.prepare(
    `UPDATE federated_agent_registry SET status = ? WHERE agent_did = ?`,
  ).run(REG_STATUS.OFFLINE, did);
  return { changed: true, did, deactivatedAt: now };
}

export function signWithAgent(db, did, data) {
  const row = db
    .prepare(`SELECT private_key, status FROM agent_dids WHERE did = ?`)
    .get(did);
  if (!row) throw new Error(`Unknown agent DID: ${did}`);
  if (row.status !== DID_STATUS.ACTIVE)
    throw new Error(`Agent DID is not active: ${did}`);
  return _signEd25519(row.private_key, data);
}

export function verifyWithAgent(db, did, data, signature) {
  const row = db
    .prepare(`SELECT public_key FROM agent_dids WHERE did = ?`)
    .get(did);
  if (!row) return false;
  return _verifyEd25519(row.public_key, data, signature);
}

/* ── Federated registry ──────────────────────────────────── */

export function registerAgent(
  db,
  { did, orgId, capabilities = [], endpoint = null } = {},
) {
  if (!did) throw new Error("did is required");
  if (!orgId) throw new Error("orgId is required");
  const agent = resolveAgentDID(db, did);
  if (!agent) throw new Error(`Unknown agent DID: ${did}`);
  if (agent.status !== DID_STATUS.ACTIVE)
    throw new Error(`Agent DID not active: ${did}`);
  const now = _now();
  const existing = db
    .prepare(
      `SELECT agent_did FROM federated_agent_registry WHERE agent_did = ?`,
    )
    .get(did);
  if (existing) {
    db.prepare(
      `UPDATE federated_agent_registry
         SET org_id = ?, capabilities = ?, endpoint = ?, status = ?, last_heartbeat = ?
         WHERE agent_did = ?`,
    ).run(
      orgId,
      JSON.stringify(capabilities),
      endpoint,
      REG_STATUS.ONLINE,
      now,
      did,
    );
  } else {
    db.prepare(
      `INSERT INTO federated_agent_registry
         (agent_did, org_id, capabilities, endpoint, status, last_heartbeat, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      did,
      orgId,
      JSON.stringify(capabilities),
      endpoint,
      REG_STATUS.ONLINE,
      now,
      now,
    );
  }
  return { did, orgId, capabilities, endpoint, registeredAt: now };
}

export function unregisterAgent(db, did) {
  const row = db
    .prepare(
      `SELECT agent_did FROM federated_agent_registry WHERE agent_did = ?`,
    )
    .get(did);
  if (!row) return { changed: false };
  db.prepare(`DELETE FROM federated_agent_registry WHERE agent_did = ?`).run(
    did,
  );
  return { changed: true, did };
}

export function heartbeatAgent(db, did) {
  const row = db
    .prepare(
      `SELECT agent_did FROM federated_agent_registry WHERE agent_did = ?`,
    )
    .get(did);
  if (!row) return { changed: false };
  const now = _now();
  db.prepare(
    `UPDATE federated_agent_registry SET last_heartbeat = ?, status = ? WHERE agent_did = ?`,
  ).run(now, REG_STATUS.ONLINE, did);
  return { changed: true, did, heartbeatAt: now };
}

export function discoverAgents(
  db,
  { capability, orgId, status = REG_STATUS.ONLINE, limit = 50 } = {},
) {
  const params = [];
  let sql = `SELECT * FROM federated_agent_registry`;
  const wheres = [];
  if (status) {
    wheres.push(`status = ?`);
    params.push(status);
  }
  if (orgId) {
    wheres.push(`org_id = ?`);
    params.push(orgId);
  }
  if (wheres.length > 0) sql += ` WHERE ` + wheres.join(` AND `);
  sql += ` ORDER BY last_heartbeat DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  let out = rows.map((r) => ({
    agentDid: r.agent_did,
    orgId: r.org_id,
    capabilities: _parse(r.capabilities, []),
    endpoint: r.endpoint,
    status: r.status,
    lastHeartbeat: r.last_heartbeat,
  }));
  if (capability) {
    out = out.filter((a) => a.capabilities.includes(capability));
  }
  return out;
}

export function sweepStaleAgents(db, now = _now()) {
  const cutoff = now - HEARTBEAT_TIMEOUT_MS;
  const rows = db
    .prepare(
      `SELECT agent_did FROM federated_agent_registry WHERE status = ? AND last_heartbeat < ?`,
    )
    .all(REG_STATUS.ONLINE, cutoff);
  let swept = 0;
  for (const r of rows) {
    db.prepare(
      `UPDATE federated_agent_registry SET status = ? WHERE agent_did = ?`,
    ).run(REG_STATUS.OFFLINE, r.agent_did);
    swept++;
  }
  return { swept };
}

/* ── Kademlia peer bookkeeping ───────────────────────────── */

export function addPeer(db, { peerId, endpoint = null, agentDid = null } = {}) {
  if (!peerId) throw new Error("peerId is required");
  const now = _now();
  const kb = _kBucketFor(peerId);
  const existing = db
    .prepare(`SELECT peer_id FROM federated_registry_peers WHERE peer_id = ?`)
    .get(peerId);
  if (existing) {
    db.prepare(
      `UPDATE federated_registry_peers
         SET endpoint = ?, agent_did = ?, k_bucket = ?, last_seen = ?
         WHERE peer_id = ?`,
    ).run(endpoint, agentDid, kb, now, peerId);
  } else {
    db.prepare(
      `INSERT INTO federated_registry_peers
         (peer_id, endpoint, agent_did, k_bucket, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(peerId, endpoint, agentDid, kb, now, now);
  }
  return { peerId, kBucket: kb, lastSeen: now };
}

export function removePeer(db, peerId) {
  const row = db
    .prepare(`SELECT peer_id FROM federated_registry_peers WHERE peer_id = ?`)
    .get(peerId);
  if (!row) return { changed: false };
  db.prepare(`DELETE FROM federated_registry_peers WHERE peer_id = ?`).run(
    peerId,
  );
  return { changed: true };
}

export function listPeers(db, { kBucket, limit = 100 } = {}) {
  const params = [];
  let sql = `SELECT * FROM federated_registry_peers`;
  if (kBucket != null) {
    sql += ` WHERE k_bucket = ?`;
    params.push(kBucket);
  }
  sql += ` ORDER BY last_seen DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    peerId: r.peer_id,
    endpoint: r.endpoint,
    agentDid: r.agent_did,
    kBucket: r.k_bucket,
    lastSeen: r.last_seen,
  }));
}

/* ── Authentication (challenge-response) ─────────────────── */

export function startAuth(db, did) {
  const agent = resolveAgentDID(db, did);
  if (!agent) throw new Error(`Unknown agent DID: ${did}`);
  if (agent.status !== DID_STATUS.ACTIVE)
    throw new Error(`Agent DID not active: ${did}`);
  const sessionId = _uuid();
  const challenge = _hex(crypto.randomBytes(32));
  const token = _hex(crypto.randomBytes(24));
  const now = _now();
  const expires = now + SESSION_TTL_MS;
  db.prepare(
    `INSERT INTO agent_auth_sessions
       (session_id, agent_did, token, challenge, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, did, token, challenge, AUTH_STATUS.PENDING, expires, now);
  return { sessionId, challenge, expiresAt: expires };
}

export function completeAuth(db, sessionId, signatureHex) {
  const row = db
    .prepare(`SELECT * FROM agent_auth_sessions WHERE session_id = ?`)
    .get(sessionId);
  if (!row) throw new Error(`Unknown auth session: ${sessionId}`);
  const now = _now();
  if (row.status !== AUTH_STATUS.PENDING)
    throw new Error(`Session not in PENDING state: ${row.status}`);
  if (now > row.expires_at) {
    db.prepare(
      `UPDATE agent_auth_sessions SET status = ? WHERE session_id = ?`,
    ).run(AUTH_STATUS.EXPIRED, sessionId);
    throw new Error(`Session expired`);
  }
  const ok = verifyWithAgent(db, row.agent_did, row.challenge, signatureHex);
  if (!ok) throw new Error(`Signature verification failed`);
  db.prepare(
    `UPDATE agent_auth_sessions SET status = ? WHERE session_id = ?`,
  ).run(AUTH_STATUS.ACTIVE, sessionId);
  return {
    sessionId,
    token: row.token,
    agentDid: row.agent_did,
    expiresAt: row.expires_at,
  };
}

export function validateSession(db, token) {
  const row = db
    .prepare(`SELECT * FROM agent_auth_sessions WHERE token = ?`)
    .get(token);
  if (!row) return null;
  const now = _now();
  if (row.status !== AUTH_STATUS.ACTIVE) return null;
  if (now > row.expires_at) {
    db.prepare(
      `UPDATE agent_auth_sessions SET status = ? WHERE session_id = ?`,
    ).run(AUTH_STATUS.EXPIRED, row.session_id);
    return null;
  }
  return {
    sessionId: row.session_id,
    agentDid: row.agent_did,
    expiresAt: row.expires_at,
  };
}

export function listSessions(db, { agentDid, status, limit = 50 } = {}) {
  const params = [];
  let sql = `SELECT * FROM agent_auth_sessions`;
  const wheres = [];
  if (agentDid) {
    wheres.push(`agent_did = ?`);
    params.push(agentDid);
  }
  if (status) {
    wheres.push(`status = ?`);
    params.push(status);
  }
  if (wheres.length) sql += ` WHERE ` + wheres.join(` AND `);
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    sessionId: r.session_id,
    agentDid: r.agent_did,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

/* ── Credential management (W3C VC) ──────────────────────── */

function _credentialProof(issuerPrivateKey, payload) {
  return _signEd25519(issuerPrivateKey, JSON.stringify(payload));
}

export function issueCredential(
  db,
  {
    issuerDid,
    subjectDid,
    type = "AgentCapabilityCredential",
    claims = {},
    expiresAt = null,
  } = {},
) {
  if (!issuerDid) throw new Error("issuerDid is required");
  if (!subjectDid) throw new Error("subjectDid is required");
  const issuer = db
    .prepare(`SELECT private_key, status FROM agent_dids WHERE did = ?`)
    .get(issuerDid);
  if (!issuer) throw new Error(`Unknown issuer DID: ${issuerDid}`);
  if (issuer.status !== DID_STATUS.ACTIVE)
    throw new Error(`Issuer DID not active: ${issuerDid}`);
  const subject = resolveAgentDID(db, subjectDid);
  if (!subject) throw new Error(`Unknown subject DID: ${subjectDid}`);
  const now = _now();
  const id = `vc:${_uuid()}`;
  const payload = {
    id,
    type,
    issuer: issuerDid,
    subject: subjectDid,
    claims,
    issuedAt: now,
    expiresAt,
  };
  const proof = _credentialProof(issuer.private_key, payload);
  db.prepare(
    `INSERT INTO agent_credentials
       (id, issuer_did, subject_did, type, claims, proof, status, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    issuerDid,
    subjectDid,
    type,
    JSON.stringify(claims),
    proof,
    CRED_STATUS.ACTIVE,
    now,
    expiresAt,
  );
  return { ...payload, proof, status: CRED_STATUS.ACTIVE };
}

export function getCredential(db, id) {
  const row = db
    .prepare(`SELECT * FROM agent_credentials WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    issuer: row.issuer_did,
    subject: row.subject_did,
    type: row.type,
    claims: _parse(row.claims, {}),
    proof: row.proof,
    status: row.status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}

export function verifyCredential(db, id) {
  const c = getCredential(db, id);
  if (!c) return { valid: false, reason: "not-found" };
  if (c.status === CRED_STATUS.REVOKED)
    return { valid: false, reason: "revoked" };
  const now = _now();
  if (c.expiresAt && now > c.expiresAt)
    return { valid: false, reason: "expired" };
  const payload = {
    id: c.id,
    type: c.type,
    issuer: c.issuer,
    subject: c.subject,
    claims: c.claims,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
  };
  const issuer = db
    .prepare(`SELECT public_key FROM agent_dids WHERE did = ?`)
    .get(c.issuer);
  if (!issuer) return { valid: false, reason: "issuer-unknown" };
  const ok = _verifyEd25519(
    issuer.public_key,
    JSON.stringify(payload),
    c.proof,
  );
  return ok
    ? { valid: true, credential: c }
    : { valid: false, reason: "signature-invalid" };
}

export function revokeCredential(db, id) {
  const row = db
    .prepare(`SELECT status FROM agent_credentials WHERE id = ?`)
    .get(id);
  if (!row) return { changed: false };
  if (row.status === CRED_STATUS.REVOKED) return { changed: false };
  db.prepare(`UPDATE agent_credentials SET status = ? WHERE id = ?`).run(
    CRED_STATUS.REVOKED,
    id,
  );
  return { changed: true };
}

export function listCredentials(
  db,
  { subjectDid, issuerDid, status, type, limit = 50 } = {},
) {
  const params = [];
  let sql = `SELECT * FROM agent_credentials`;
  const wheres = [];
  if (subjectDid) {
    wheres.push(`subject_did = ?`);
    params.push(subjectDid);
  }
  if (issuerDid) {
    wheres.push(`issuer_did = ?`);
    params.push(issuerDid);
  }
  if (status) {
    wheres.push(`status = ?`);
    params.push(status);
  }
  if (type) {
    wheres.push(`type = ?`);
    params.push(type);
  }
  if (wheres.length) sql += ` WHERE ` + wheres.join(` AND `);
  sql += ` ORDER BY issued_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    id: r.id,
    issuer: r.issuer_did,
    subject: r.subject_did,
    type: r.type,
    claims: _parse(r.claims, {}),
    status: r.status,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
  }));
}

/* ── Cross-org task routing ──────────────────────────────── */

function _scoreAgent(agent, reputation) {
  const base = reputation ? reputation.total : 2.5;
  const load = 0; // CLI has no live task load tracker — future work
  return base - load;
}

export function routeTask(
  db,
  {
    sourceOrg,
    targetOrg = null,
    taskType,
    requirements = {},
    payload = null,
  } = {},
) {
  if (!sourceOrg) throw new Error("sourceOrg is required");
  if (!taskType) throw new Error("taskType is required");
  const now = _now();
  const taskId = `task:${_uuid()}`;
  const candidates = discoverAgents(db, {
    capability: requirements.capability,
    orgId: targetOrg,
    status: REG_STATUS.ONLINE,
    limit: 100,
  });
  if (candidates.length === 0) {
    db.prepare(
      `INSERT INTO federated_task_log
         (task_id, source_org, target_org, agent_did, task_type, payload, requirements, status, result, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      taskId,
      sourceOrg,
      targetOrg,
      null,
      taskType,
      _json(payload),
      _json(requirements),
      TASK_STATUS.PENDING,
      null,
      now,
      null,
    );
    return { taskId, status: TASK_STATUS.PENDING, agentDid: null };
  }
  const scored = candidates
    .map((c) => ({
      ...c,
      reputation: getReputation(db, c.agentDid),
    }))
    .map((c) => ({ ...c, _score: _scoreAgent(c, c.reputation) }))
    .sort((a, b) => b._score - a._score);
  const picked = scored[0];
  db.prepare(
    `INSERT INTO federated_task_log
       (task_id, source_org, target_org, agent_did, task_type, payload, requirements, status, result, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    taskId,
    sourceOrg,
    targetOrg || picked.orgId,
    picked.agentDid,
    taskType,
    _json(payload),
    _json(requirements),
    TASK_STATUS.ROUTED,
    null,
    now,
    null,
  );
  return {
    taskId,
    status: TASK_STATUS.ROUTED,
    agentDid: picked.agentDid,
    orgId: picked.orgId,
    score: picked._score,
  };
}

export function getTask(db, taskId) {
  const row = db
    .prepare(`SELECT * FROM federated_task_log WHERE task_id = ?`)
    .get(taskId);
  if (!row) return null;
  return {
    taskId: row.task_id,
    sourceOrg: row.source_org,
    targetOrg: row.target_org,
    agentDid: row.agent_did,
    taskType: row.task_type,
    payload: _parse(row.payload),
    requirements: _parse(row.requirements, {}),
    status: row.status,
    result: _parse(row.result),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function updateTaskStatus(db, taskId, status, result = null) {
  const row = db
    .prepare(`SELECT status FROM federated_task_log WHERE task_id = ?`)
    .get(taskId);
  if (!row) return { changed: false };
  const now = _now();
  const terminal =
    status === TASK_STATUS.COMPLETED ||
    status === TASK_STATUS.FAILED ||
    status === TASK_STATUS.CANCELLED;
  db.prepare(
    `UPDATE federated_task_log
       SET status = ?, result = ?, completed_at = ?
       WHERE task_id = ?`,
  ).run(status, _json(result), terminal ? now : null, taskId);
  return { changed: true, taskId, status };
}

export function cancelTask(db, taskId, reason = null) {
  return updateTaskStatus(db, taskId, TASK_STATUS.CANCELLED, {
    reason: reason || "cancelled",
  });
}

export function listTasks(db, { orgId, agentDid, status, limit = 50 } = {}) {
  const params = [];
  let sql = `SELECT * FROM federated_task_log`;
  const wheres = [];
  if (orgId) {
    wheres.push(`source_org = ?`);
    params.push(orgId);
  }
  if (agentDid) {
    wheres.push(`agent_did = ?`);
    params.push(agentDid);
  }
  if (status) {
    wheres.push(`status = ?`);
    params.push(status);
  }
  if (wheres.length) sql += ` WHERE ` + wheres.join(` AND `);
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    taskId: r.task_id,
    sourceOrg: r.source_org,
    targetOrg: r.target_org,
    agentDid: r.agent_did,
    taskType: r.task_type,
    status: r.status,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
}

/* ── Reputation ──────────────────────────────────────────── */

export function updateReputation(
  db,
  { agentDid, dimension, score, evidence = null } = {},
) {
  if (!agentDid) throw new Error("agentDid is required");
  if (!REPUTATION_DIMENSIONS.includes(dimension))
    throw new Error(
      `Invalid dimension: ${dimension}. Expected one of ${REPUTATION_DIMENSIONS.join(",")}`,
    );
  const s = Math.max(MIN_REPUTATION, Math.min(MAX_REPUTATION, Number(score)));
  const id = `rep:${_uuid()}`;
  const now = _now();
  db.prepare(
    `INSERT INTO agent_reputation
       (id, agent_did, dimension, score, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, agentDid, dimension, s, evidence, now);
  return { id, agentDid, dimension, score: s, createdAt: now };
}

export function getReputation(db, agentDid) {
  const rows = db
    .prepare(
      `SELECT dimension, score, created_at FROM agent_reputation WHERE agent_did = ?`,
    )
    .all(agentDid);
  if (rows.length === 0) {
    return {
      agentDid,
      dimensions: {},
      total: 2.5,
      samples: 0,
    };
  }
  const dims = {};
  for (const r of rows) {
    if (!dims[r.dimension]) dims[r.dimension] = { sum: 0, n: 0, latest: 0 };
    dims[r.dimension].sum += r.score;
    dims[r.dimension].n += 1;
    if (r.created_at > dims[r.dimension].latest)
      dims[r.dimension].latest = r.created_at;
  }
  const dimensions = {};
  let weightedSum = 0;
  let weightTotal = 0;
  for (const d of REPUTATION_DIMENSIONS) {
    if (dims[d]) {
      const avg = dims[d].sum / dims[d].n;
      dimensions[d] = {
        score: avg,
        samples: dims[d].n,
        latest: dims[d].latest,
      };
      const w = REPUTATION_WEIGHTS[d] || 1;
      weightedSum += avg * w;
      weightTotal += w;
    }
  }
  const total = weightTotal > 0 ? weightedSum / weightTotal : 2.5;
  return {
    agentDid,
    dimensions,
    total,
    samples: rows.length,
  };
}

export function getReputationHistory(db, agentDid, limit = 50) {
  const rows = db
    .prepare(
      `SELECT * FROM agent_reputation WHERE agent_did = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(agentDid, limit);
  return rows.map((r) => ({
    id: r.id,
    agentDid: r.agent_did,
    dimension: r.dimension,
    score: r.score,
    evidence: r.evidence,
    createdAt: r.created_at,
  }));
}

export function getTopAgents(db, { dimension, limit = 10 } = {}) {
  const reg = db
    .prepare(`SELECT agent_did FROM federated_agent_registry`)
    .all();
  const dids = new Set(reg.map((r) => r.agent_did));
  const repRows = db.prepare(`SELECT agent_did FROM agent_reputation`).all();
  for (const r of repRows) dids.add(r.agent_did);
  const scored = [];
  for (const d of dids) {
    const rep = getReputation(db, d);
    if (dimension) {
      const dim = rep.dimensions[dimension];
      if (!dim) continue;
      scored.push({ agentDid: d, score: dim.score, samples: dim.samples });
    } else {
      scored.push({ agentDid: d, score: rep.total, samples: rep.samples });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* ── Network-level stats & config ────────────────────────── */

export function getNetworkStats(db) {
  const dids = db
    .prepare(`SELECT status, COUNT(*) as cnt FROM agent_dids GROUP BY status`)
    .all();
  const reg = db
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM federated_agent_registry GROUP BY status`,
    )
    .all();
  const tasks = db
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM federated_task_log GROUP BY status`,
    )
    .all();
  const creds = db
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM agent_credentials GROUP BY status`,
    )
    .all();
  const peers = db
    .prepare(`SELECT COUNT(*) as cnt FROM federated_registry_peers`)
    .get();
  const sessions = db
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM agent_auth_sessions GROUP BY status`,
    )
    .all();
  const _sum = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.cnt]));
  return {
    dids: _sum(dids),
    registry: _sum(reg),
    tasks: _sum(tasks),
    credentials: _sum(creds),
    sessions: _sum(sessions),
    peers: peers?.cnt ?? 0,
  };
}

export function getNetworkConfig() {
  return {
    kademliaBits: KADEMLIA_BITS,
    kademliaK: KADEMLIA_K,
    sessionTtlMs: SESSION_TTL_MS,
    heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    reputationDimensions: [...REPUTATION_DIMENSIONS],
    reputationWeights: { ...REPUTATION_WEIGHTS },
    reputationRange: [MIN_REPUTATION, MAX_REPUTATION],
    reputationDecayWeekly: REPUTATION_DECAY_WEEKLY,
    taskStatuses: Object.values(TASK_STATUS),
    regStatuses: Object.values(REG_STATUS),
    didStatuses: Object.values(DID_STATUS),
    authStatuses: Object.values(AUTH_STATUS),
    credStatuses: Object.values(CRED_STATUS),
  };
}

/* ─────────────────────────────────────────────────────────────────
 * V2 Governance Layer (in-memory, independent of SQLite tables)
 *
 *   Agent maturity: pending → active → suspended → revoked
 *     - revoked terminal
 *     - suspended → active recovery (cap-exempt)
 *
 *   Task lifecycle: queued → running → completed | failed | cancelled
 *     - 3 terminals
 *     - per-agent pending-task cap counts queued+running
 *
 *   Per-network active-agent cap on pending→active only (recovery exempt).
 *   Per-agent pending-task cap enforced at createTaskV2.
 *
 *   Auto-flip:
 *     - autoSuspendIdleAgentsV2  active w/ lastSeenAt past idle threshold → suspended
 *     - autoFailStuckTasksV2     running w/ startedAt past stuck threshold → failed
 * ───────────────────────────────────────────────────────────────── */

export const AGENT_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
});

export const TASK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _AGENT_TRANSITIONS_V2 = new Map([
  [
    AGENT_MATURITY_V2.PENDING,
    new Set([AGENT_MATURITY_V2.ACTIVE, AGENT_MATURITY_V2.REVOKED]),
  ],
  [
    AGENT_MATURITY_V2.ACTIVE,
    new Set([AGENT_MATURITY_V2.SUSPENDED, AGENT_MATURITY_V2.REVOKED]),
  ],
  [
    AGENT_MATURITY_V2.SUSPENDED,
    new Set([AGENT_MATURITY_V2.ACTIVE, AGENT_MATURITY_V2.REVOKED]),
  ],
  [AGENT_MATURITY_V2.REVOKED, new Set()],
]);
const _AGENT_TERMINALS_V2 = new Set([AGENT_MATURITY_V2.REVOKED]);

const _TASK_TRANSITIONS_V2 = new Map([
  [
    TASK_LIFECYCLE_V2.QUEUED,
    new Set([TASK_LIFECYCLE_V2.RUNNING, TASK_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    TASK_LIFECYCLE_V2.RUNNING,
    new Set([
      TASK_LIFECYCLE_V2.COMPLETED,
      TASK_LIFECYCLE_V2.FAILED,
      TASK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TASK_LIFECYCLE_V2.COMPLETED, new Set()],
  [TASK_LIFECYCLE_V2.FAILED, new Set()],
  [TASK_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _TASK_TERMINALS_V2 = new Set([
  TASK_LIFECYCLE_V2.COMPLETED,
  TASK_LIFECYCLE_V2.FAILED,
  TASK_LIFECYCLE_V2.CANCELLED,
]);

export const AGENT_DEFAULT_MAX_ACTIVE_PER_NETWORK = 50;
export const AGENT_DEFAULT_MAX_PENDING_TASKS_PER_AGENT = 10;
export const AGENT_DEFAULT_AGENT_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const AGENT_DEFAULT_TASK_STUCK_MS = 30 * 60 * 1000; // 30 min

const _stateAnetV2 = {
  agents: new Map(),
  tasks: new Map(),
  maxActiveAgentsPerNetwork: AGENT_DEFAULT_MAX_ACTIVE_PER_NETWORK,
  maxPendingTasksPerAgent: AGENT_DEFAULT_MAX_PENDING_TASKS_PER_AGENT,
  agentIdleMs: AGENT_DEFAULT_AGENT_IDLE_MS,
  taskStuckMs: AGENT_DEFAULT_TASK_STUCK_MS,
};

function _posIntAnetV2(n, label) {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return v;
}

function _copyAgentV2(a) {
  return { ...a, metadata: { ...a.metadata } };
}

function _copyTaskV2(t) {
  return { ...t, metadata: { ...t.metadata } };
}

export function getMaxActiveAgentsPerNetworkV2() {
  return _stateAnetV2.maxActiveAgentsPerNetwork;
}

export function setMaxActiveAgentsPerNetworkV2(n) {
  _stateAnetV2.maxActiveAgentsPerNetwork = _posIntAnetV2(
    n,
    "maxActiveAgentsPerNetwork",
  );
}

export function getMaxPendingTasksPerAgentV2() {
  return _stateAnetV2.maxPendingTasksPerAgent;
}

export function setMaxPendingTasksPerAgentV2(n) {
  _stateAnetV2.maxPendingTasksPerAgent = _posIntAnetV2(
    n,
    "maxPendingTasksPerAgent",
  );
}

export function getAgentIdleMsV2() {
  return _stateAnetV2.agentIdleMs;
}

export function setAgentIdleMsV2(ms) {
  _stateAnetV2.agentIdleMs = _posIntAnetV2(ms, "agentIdleMs");
}

export function getTaskStuckMsV2() {
  return _stateAnetV2.taskStuckMs;
}

export function setTaskStuckMsV2(ms) {
  _stateAnetV2.taskStuckMs = _posIntAnetV2(ms, "taskStuckMs");
}

export function getActiveAgentCountV2(networkId) {
  let count = 0;
  for (const a of _stateAnetV2.agents.values()) {
    if (a.networkId === networkId && a.status === AGENT_MATURITY_V2.ACTIVE) {
      count++;
    }
  }
  return count;
}

export function getPendingTaskCountV2(agentId) {
  let count = 0;
  for (const t of _stateAnetV2.tasks.values()) {
    if (
      t.agentId === agentId &&
      (t.status === TASK_LIFECYCLE_V2.QUEUED ||
        t.status === TASK_LIFECYCLE_V2.RUNNING)
    ) {
      count++;
    }
  }
  return count;
}

export function registerAgentV2(
  id,
  { networkId, did, displayName, metadata } = {},
) {
  if (!id) throw new Error("agent id is required");
  if (!networkId) throw new Error("networkId is required");
  if (!did) throw new Error("did is required");
  if (_stateAnetV2.agents.has(id))
    throw new Error(`agent ${id} already exists`);
  const now = Date.now();
  const agent = {
    id,
    networkId,
    did,
    displayName: displayName || id,
    status: AGENT_MATURITY_V2.PENDING,
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    revokedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateAnetV2.agents.set(id, agent);
  return _copyAgentV2(agent);
}

export function getAgentV2(id) {
  const a = _stateAnetV2.agents.get(id);
  return a ? _copyAgentV2(a) : null;
}

export function listAgentsV2({ networkId, status } = {}) {
  const out = [];
  for (const a of _stateAnetV2.agents.values()) {
    if (networkId && a.networkId !== networkId) continue;
    if (status && a.status !== status) continue;
    out.push(_copyAgentV2(a));
  }
  return out;
}

export function setAgentStatusV2(id, next) {
  const a = _stateAnetV2.agents.get(id);
  if (!a) throw new Error(`agent ${id} not found`);
  const allowed = _AGENT_TRANSITIONS_V2.get(a.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid agent transition: ${a.status} → ${next}`);
  }
  if (
    a.status === AGENT_MATURITY_V2.PENDING &&
    next === AGENT_MATURITY_V2.ACTIVE
  ) {
    const count = getActiveAgentCountV2(a.networkId);
    if (count >= _stateAnetV2.maxActiveAgentsPerNetwork) {
      throw new Error(
        `network ${a.networkId} active-agent cap reached (${count}/${_stateAnetV2.maxActiveAgentsPerNetwork})`,
      );
    }
  }
  const now = Date.now();
  a.status = next;
  a.lastSeenAt = now;
  if (next === AGENT_MATURITY_V2.ACTIVE && !a.activatedAt) a.activatedAt = now;
  if (_AGENT_TERMINALS_V2.has(next) && !a.revokedAt) a.revokedAt = now;
  return _copyAgentV2(a);
}

export function activateAgentV2(id) {
  return setAgentStatusV2(id, AGENT_MATURITY_V2.ACTIVE);
}

export function suspendAgentV2(id) {
  return setAgentStatusV2(id, AGENT_MATURITY_V2.SUSPENDED);
}

export function revokeAgentV2(id) {
  return setAgentStatusV2(id, AGENT_MATURITY_V2.REVOKED);
}

export function touchAgentV2(id) {
  const a = _stateAnetV2.agents.get(id);
  if (!a) throw new Error(`agent ${id} not found`);
  a.lastSeenAt = Date.now();
  return _copyAgentV2(a);
}

export function createTaskV2(id, { agentId, kind, metadata } = {}) {
  if (!id) throw new Error("task id is required");
  if (!agentId) throw new Error("agentId is required");
  if (_stateAnetV2.tasks.has(id)) throw new Error(`task ${id} already exists`);
  const agent = _stateAnetV2.agents.get(agentId);
  if (!agent) throw new Error(`agent ${agentId} not found`);
  const pending = getPendingTaskCountV2(agentId);
  if (pending >= _stateAnetV2.maxPendingTasksPerAgent) {
    throw new Error(
      `agent ${agentId} pending-task cap reached (${pending}/${_stateAnetV2.maxPendingTasksPerAgent})`,
    );
  }
  const now = Date.now();
  const task = {
    id,
    agentId,
    kind: kind || "invoke",
    status: TASK_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateAnetV2.tasks.set(id, task);
  return _copyTaskV2(task);
}

export function getTaskV2(id) {
  const t = _stateAnetV2.tasks.get(id);
  return t ? _copyTaskV2(t) : null;
}

export function listTasksV2({ agentId, status } = {}) {
  const out = [];
  for (const t of _stateAnetV2.tasks.values()) {
    if (agentId && t.agentId !== agentId) continue;
    if (status && t.status !== status) continue;
    out.push(_copyTaskV2(t));
  }
  return out;
}

export function setTaskStatusV2(id, next) {
  const t = _stateAnetV2.tasks.get(id);
  if (!t) throw new Error(`task ${id} not found`);
  const allowed = _TASK_TRANSITIONS_V2.get(t.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid task transition: ${t.status} → ${next}`);
  }
  const now = Date.now();
  t.status = next;
  t.lastSeenAt = now;
  if (next === TASK_LIFECYCLE_V2.RUNNING && !t.startedAt) t.startedAt = now;
  if (_TASK_TERMINALS_V2.has(next) && !t.settledAt) t.settledAt = now;
  return _copyTaskV2(t);
}

export function startTaskV2(id) {
  return setTaskStatusV2(id, TASK_LIFECYCLE_V2.RUNNING);
}

export function completeTaskV2(id) {
  return setTaskStatusV2(id, TASK_LIFECYCLE_V2.COMPLETED);
}

export function failTaskV2(id) {
  return setTaskStatusV2(id, TASK_LIFECYCLE_V2.FAILED);
}

export function cancelTaskV2(id) {
  return setTaskStatusV2(id, TASK_LIFECYCLE_V2.CANCELLED);
}

export function autoSuspendIdleAgentsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const a of _stateAnetV2.agents.values()) {
    if (
      a.status === AGENT_MATURITY_V2.ACTIVE &&
      now - a.lastSeenAt >= _stateAnetV2.agentIdleMs
    ) {
      a.status = AGENT_MATURITY_V2.SUSPENDED;
      a.lastSeenAt = now;
      flipped.push(a.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckTasksV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const t of _stateAnetV2.tasks.values()) {
    if (
      t.status === TASK_LIFECYCLE_V2.RUNNING &&
      t.startedAt &&
      now - t.startedAt >= _stateAnetV2.taskStuckMs
    ) {
      t.status = TASK_LIFECYCLE_V2.FAILED;
      t.lastSeenAt = now;
      if (!t.settledAt) t.settledAt = now;
      flipped.push(t.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function getAgentNetworkStatsV2() {
  const agentsByStatus = {};
  for (const s of Object.values(AGENT_MATURITY_V2)) agentsByStatus[s] = 0;
  for (const a of _stateAnetV2.agents.values()) agentsByStatus[a.status]++;
  const tasksByStatus = {};
  for (const s of Object.values(TASK_LIFECYCLE_V2)) tasksByStatus[s] = 0;
  for (const t of _stateAnetV2.tasks.values()) tasksByStatus[t.status]++;
  return {
    totalAgentsV2: _stateAnetV2.agents.size,
    totalTasksV2: _stateAnetV2.tasks.size,
    maxActiveAgentsPerNetwork: _stateAnetV2.maxActiveAgentsPerNetwork,
    maxPendingTasksPerAgent: _stateAnetV2.maxPendingTasksPerAgent,
    agentIdleMs: _stateAnetV2.agentIdleMs,
    taskStuckMs: _stateAnetV2.taskStuckMs,
    agentsByStatus,
    tasksByStatus,
  };
}

export function _resetStateAgentNetworkV2() {
  _stateAnetV2.agents.clear();
  _stateAnetV2.tasks.clear();
  _stateAnetV2.maxActiveAgentsPerNetwork = AGENT_DEFAULT_MAX_ACTIVE_PER_NETWORK;
  _stateAnetV2.maxPendingTasksPerAgent =
    AGENT_DEFAULT_MAX_PENDING_TASKS_PER_AGENT;
  _stateAnetV2.agentIdleMs = AGENT_DEFAULT_AGENT_IDLE_MS;
  _stateAnetV2.taskStuckMs = AGENT_DEFAULT_TASK_STUCK_MS;
}

// =====================================================================
// agent-network V2 governance overlay (iter20)
// =====================================================================
export const ANETGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const ANETGOV_DISPATCH_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  DISPATCHED: "dispatched",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _anetgovPTrans = new Map([
  [
    ANETGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      ANETGOV_PROFILE_MATURITY_V2.ACTIVE,
      ANETGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    ANETGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      ANETGOV_PROFILE_MATURITY_V2.SUSPENDED,
      ANETGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    ANETGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      ANETGOV_PROFILE_MATURITY_V2.ACTIVE,
      ANETGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [ANETGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _anetgovPTerminal = new Set([ANETGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _anetgovJTrans = new Map([
  [
    ANETGOV_DISPATCH_LIFECYCLE_V2.QUEUED,
    new Set([
      ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHING,
      ANETGOV_DISPATCH_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHING,
    new Set([
      ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHED,
      ANETGOV_DISPATCH_LIFECYCLE_V2.FAILED,
      ANETGOV_DISPATCH_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHED, new Set()],
  [ANETGOV_DISPATCH_LIFECYCLE_V2.FAILED, new Set()],
  [ANETGOV_DISPATCH_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _anetgovPsV2 = new Map();
const _anetgovJsV2 = new Map();
let _anetgovMaxActive = 10,
  _anetgovMaxPending = 25,
  _anetgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _anetgovStuckMs = 60 * 1000;
function _anetgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _anetgovCheckP(from, to) {
  const a = _anetgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid anetgov profile transition ${from} → ${to}`);
}
function _anetgovCheckJ(from, to) {
  const a = _anetgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid anetgov dispatch transition ${from} → ${to}`);
}
function _anetgovCountActive(owner) {
  let c = 0;
  for (const p of _anetgovPsV2.values())
    if (p.owner === owner && p.status === ANETGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _anetgovCountPending(profileId) {
  let c = 0;
  for (const j of _anetgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === ANETGOV_DISPATCH_LIFECYCLE_V2.QUEUED ||
        j.status === ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHING)
    )
      c++;
  return c;
}
export function setMaxActiveAnetgovProfilesPerOwnerV2(n) {
  _anetgovMaxActive = _anetgovPos(n, "maxActiveAnetgovProfilesPerOwner");
}
export function getMaxActiveAnetgovProfilesPerOwnerV2() {
  return _anetgovMaxActive;
}
export function setMaxPendingAnetgovDispatchsPerProfileV2(n) {
  _anetgovMaxPending = _anetgovPos(n, "maxPendingAnetgovDispatchsPerProfile");
}
export function getMaxPendingAnetgovDispatchsPerProfileV2() {
  return _anetgovMaxPending;
}
export function setAnetgovProfileIdleMsV2(n) {
  _anetgovIdleMs = _anetgovPos(n, "anetgovProfileIdleMs");
}
export function getAnetgovProfileIdleMsV2() {
  return _anetgovIdleMs;
}
export function setAnetgovDispatchStuckMsV2(n) {
  _anetgovStuckMs = _anetgovPos(n, "anetgovDispatchStuckMs");
}
export function getAnetgovDispatchStuckMsV2() {
  return _anetgovStuckMs;
}
export function _resetStateAgentNetworkGovV2() {
  _anetgovPsV2.clear();
  _anetgovJsV2.clear();
  _anetgovMaxActive = 10;
  _anetgovMaxPending = 25;
  _anetgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _anetgovStuckMs = 60 * 1000;
}
export function registerAnetgovProfileV2({ id, owner, role, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_anetgovPsV2.has(id))
    throw new Error(`anetgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    role: role || "worker",
    status: ANETGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _anetgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateAnetgovProfileV2(id) {
  const p = _anetgovPsV2.get(id);
  if (!p) throw new Error(`anetgov profile ${id} not found`);
  const isInitial = p.status === ANETGOV_PROFILE_MATURITY_V2.PENDING;
  _anetgovCheckP(p.status, ANETGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _anetgovCountActive(p.owner) >= _anetgovMaxActive)
    throw new Error(`max active anetgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = ANETGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendAnetgovProfileV2(id) {
  const p = _anetgovPsV2.get(id);
  if (!p) throw new Error(`anetgov profile ${id} not found`);
  _anetgovCheckP(p.status, ANETGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = ANETGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveAnetgovProfileV2(id) {
  const p = _anetgovPsV2.get(id);
  if (!p) throw new Error(`anetgov profile ${id} not found`);
  _anetgovCheckP(p.status, ANETGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = ANETGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchAnetgovProfileV2(id) {
  const p = _anetgovPsV2.get(id);
  if (!p) throw new Error(`anetgov profile ${id} not found`);
  if (_anetgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal anetgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getAnetgovProfileV2(id) {
  const p = _anetgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listAnetgovProfilesV2() {
  return [..._anetgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createAnetgovDispatchV2({
  id,
  profileId,
  target,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_anetgovJsV2.has(id))
    throw new Error(`anetgov dispatch ${id} already exists`);
  if (!_anetgovPsV2.has(profileId))
    throw new Error(`anetgov profile ${profileId} not found`);
  if (_anetgovCountPending(profileId) >= _anetgovMaxPending)
    throw new Error(
      `max pending anetgov dispatchs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    target: target || "",
    status: ANETGOV_DISPATCH_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _anetgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function dispatchingAnetgovDispatchV2(id) {
  const j = _anetgovJsV2.get(id);
  if (!j) throw new Error(`anetgov dispatch ${id} not found`);
  _anetgovCheckJ(j.status, ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHING);
  const now = Date.now();
  j.status = ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeDispatchAnetgovV2(id) {
  const j = _anetgovJsV2.get(id);
  if (!j) throw new Error(`anetgov dispatch ${id} not found`);
  _anetgovCheckJ(j.status, ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHED);
  const now = Date.now();
  j.status = ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failAnetgovDispatchV2(id, reason) {
  const j = _anetgovJsV2.get(id);
  if (!j) throw new Error(`anetgov dispatch ${id} not found`);
  _anetgovCheckJ(j.status, ANETGOV_DISPATCH_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = ANETGOV_DISPATCH_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelAnetgovDispatchV2(id, reason) {
  const j = _anetgovJsV2.get(id);
  if (!j) throw new Error(`anetgov dispatch ${id} not found`);
  _anetgovCheckJ(j.status, ANETGOV_DISPATCH_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = ANETGOV_DISPATCH_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getAnetgovDispatchV2(id) {
  const j = _anetgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listAnetgovDispatchsV2() {
  return [..._anetgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleAnetgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _anetgovPsV2.values())
    if (
      p.status === ANETGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _anetgovIdleMs
    ) {
      p.status = ANETGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckAnetgovDispatchsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _anetgovJsV2.values())
    if (
      j.status === ANETGOV_DISPATCH_LIFECYCLE_V2.DISPATCHING &&
      j.startedAt != null &&
      t - j.startedAt >= _anetgovStuckMs
    ) {
      j.status = ANETGOV_DISPATCH_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getAgentNetworkGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(ANETGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _anetgovPsV2.values()) profilesByStatus[p.status]++;
  const dispatchsByStatus = {};
  for (const v of Object.values(ANETGOV_DISPATCH_LIFECYCLE_V2))
    dispatchsByStatus[v] = 0;
  for (const j of _anetgovJsV2.values()) dispatchsByStatus[j.status]++;
  return {
    totalAnetgovProfilesV2: _anetgovPsV2.size,
    totalAnetgovDispatchsV2: _anetgovJsV2.size,
    maxActiveAnetgovProfilesPerOwner: _anetgovMaxActive,
    maxPendingAnetgovDispatchsPerProfile: _anetgovMaxPending,
    anetgovProfileIdleMs: _anetgovIdleMs,
    anetgovDispatchStuckMs: _anetgovStuckMs,
    profilesByStatus,
    dispatchsByStatus,
  };
}
