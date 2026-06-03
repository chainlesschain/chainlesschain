/**
 * Cowork Share — export/import signed packets for templates and task results.
 *
 * Produces a verifiable JSON packet that can be transferred by any channel
 * (P2P, email, file drop). The packet contains:
 *   - `kind`: "template" or "result"
 *   - `payload`: the shareable object (template JSON or history record)
 *   - `meta`: { author, createdAt, cliVersion }
 *   - `checksum`: sha256 hex over the canonicalized payload+meta
 *
 * Import validates the checksum before returning the payload. This is not an
 * identity signature — anyone can produce a packet — but it protects against
 * accidental corruption during transfer.
 *
 * @module cowork-share
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import crypto, { createHash } from "node:crypto";
import {
  toShareableTemplate,
  saveUserTemplate,
} from "./cowork-template-marketplace.js";
import { generateDID } from "./did-manager.js";

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  now: () => new Date().toISOString(),
};

const SUPPORTED_SIG_ALG = "Ed25519";

const PACKET_VERSION = 1;
const PACKET_KINDS = ["template", "result"];

// ─── Canonical JSON (stable key ordering for checksum) ───────────────────────

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]))
      .join(",") +
    "}"
  );
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

// ─── Packet builders ─────────────────────────────────────────────────────────

/**
 * Build a share packet. `kind` and `payload` are validated; `meta` gets
 * filled with createdAt/cliVersion defaults; checksum is computed over the
 * canonical form of `{ kind, version, payload, meta }`.
 */
export function buildPacket({
  kind,
  payload,
  author,
  cliVersion,
  signer,
} = {}) {
  if (!PACKET_KINDS.includes(kind)) {
    throw new Error(`kind must be one of ${PACKET_KINDS.join(", ")}`);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("payload must be an object");
  }
  const meta = {
    author: author || "anonymous",
    createdAt: _deps.now(),
    cliVersion: cliVersion || "unknown",
  };
  const body = { kind, version: PACKET_VERSION, payload, meta };
  const checksum = sha256Hex(canonicalize(body));
  const packet = { ...body, checksum };
  if (signer) {
    packet.signature = _signBody(body, signer);
  }
  return packet;
}

// ─── Signatures (Ed25519) ────────────────────────────────────────────────────

function _signBody(body, signer) {
  if (!signer.did || typeof signer.did !== "string") {
    throw new Error("signer.did required");
  }
  if (!signer.privateKey || !signer.publicKey) {
    throw new Error("signer.privateKey and signer.publicKey required (hex)");
  }
  if (signer.alg && signer.alg !== SUPPORTED_SIG_ALG) {
    throw new Error(`unsupported signature alg: ${signer.alg}`);
  }
  // Verify did matches publicKey (prevents accidental DID spoofing in signer)
  const expectedDid = generateDID(signer.publicKey);
  if (signer.did !== expectedDid) {
    throw new Error(
      `signer.did does not match publicKey (expected ${expectedDid})`,
    );
  }
  const privKey = crypto.createPrivateKey({
    key: Buffer.from(signer.privateKey, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const bytes = Buffer.from(canonicalize(body), "utf-8");
  const sig = crypto.sign(null, bytes, privKey);
  return {
    alg: SUPPORTED_SIG_ALG,
    did: signer.did,
    publicKey: signer.publicKey,
    sig: sig.toString("base64url").replace(/=+$/, ""),
  };
}

function _verifySignature(body, signature) {
  if (!signature || typeof signature !== "object") {
    return { valid: false, error: "signature missing" };
  }
  if (signature.alg !== SUPPORTED_SIG_ALG) {
    return { valid: false, error: `unsupported alg '${signature.alg}'` };
  }
  if (!signature.did || !signature.publicKey || !signature.sig) {
    return { valid: false, error: "signature fields incomplete" };
  }
  const expectedDid = generateDID(signature.publicKey);
  if (signature.did !== expectedDid) {
    return { valid: false, error: "did does not match embedded publicKey" };
  }
  try {
    const pubKey = crypto.createPublicKey({
      key: Buffer.from(signature.publicKey, "hex"),
      format: "der",
      type: "spki",
    });
    const bytes = Buffer.from(canonicalize(body), "utf-8");
    const sigBytes = Buffer.from(signature.sig, "base64url");
    const ok = crypto.verify(null, bytes, pubKey, sigBytes);
    return { valid: ok, error: ok ? null : "signature invalid" };
  } catch (err) {
    return { valid: false, error: `signature verify error: ${err.message}` };
  }
}

/**
 * Verify a packet: checks shape, version, kind, recomputes checksum.
 * Returns `{ valid, errors }`.
 */
export function verifyPacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== "object") {
    return { valid: false, errors: ["packet must be an object"] };
  }
  if (packet.version !== PACKET_VERSION) {
    errors.push(`unsupported packet version ${packet.version}`);
  }
  if (!PACKET_KINDS.includes(packet.kind)) {
    errors.push(`unknown kind '${packet.kind}'`);
  }
  if (!packet.payload || typeof packet.payload !== "object") {
    errors.push("payload missing or not an object");
  }
  if (!packet.meta || typeof packet.meta !== "object") {
    errors.push("meta missing");
  }
  if (!packet.checksum) errors.push("checksum missing");
  if (errors.length > 0) return { valid: false, errors };

  const { checksum, signature, ...body } = packet;
  const expected = sha256Hex(canonicalize(body));
  if (expected !== checksum) {
    errors.push("checksum mismatch (packet may be corrupted or tampered with)");
  }
  if (signature !== undefined) {
    const sigRes = _verifySignature(body, signature);
    if (!sigRes.valid) {
      errors.push(sigRes.error);
    }
  }
  return { valid: errors.length === 0, errors, signed: !!signature };
}

// ─── Higher-level helpers ────────────────────────────────────────────────────

/**
 * Build a packet from a full Cowork template object. The template is reduced
 * to its shareable fields first.
 */
export function exportTemplatePacket(
  template,
  { author, cliVersion, signer } = {},
) {
  const payload = toShareableTemplate(template);
  return buildPacket({ kind: "template", payload, author, cliVersion, signer });
}

/**
 * Build a packet from a history record (one line of history.jsonl).
 * Irrelevant internal fields are dropped.
 */
export function exportResultPacket(
  historyRecord,
  { author, cliVersion, signer } = {},
) {
  if (!historyRecord || typeof historyRecord !== "object") {
    throw new Error("historyRecord required");
  }
  const payload = {
    taskId: historyRecord.taskId,
    status: historyRecord.status,
    templateId: historyRecord.templateId,
    templateName: historyRecord.templateName,
    userMessage: historyRecord.userMessage,
    timestamp: historyRecord.timestamp,
    result: historyRecord.result,
  };
  return buildPacket({ kind: "result", payload, author, cliVersion, signer });
}

/**
 * Find a history record by taskId in `.chainlesschain/cowork/history.jsonl`.
 * Returns null if missing. The last matching line wins.
 */
export function findHistoryRecord(cwd, taskId) {
  const file = join(cwd, ".chainlesschain", "cowork", "history.jsonl");
  if (!_deps.existsSync(file)) return null;
  const raw = _deps.readFileSync(file, "utf-8");
  let match = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec.taskId === taskId) match = rec;
    } catch (_e) {
      // skip malformed
    }
  }
  return match;
}

/**
 * Write a packet to disk as pretty-printed JSON.
 */
export function writePacket(filePath, packet) {
  _deps.writeFileSync(filePath, JSON.stringify(packet, null, 2), "utf-8");
  return filePath;
}

/**
 * Read + verify a packet from disk. Throws on verification failure.
 */
export function readPacket(filePath, opts = {}) {
  const { requireSigned = false, trustedDids = null } = opts;
  if (!_deps.existsSync(filePath)) {
    throw new Error(`Packet not found: ${filePath}`);
  }
  const body = _deps.readFileSync(filePath, "utf-8");
  let packet;
  try {
    packet = JSON.parse(body);
  } catch (err) {
    throw new Error(`Packet is not valid JSON: ${err.message}`);
  }
  const { valid, errors } = verifyPacket(packet);
  if (!valid) throw new Error(`Invalid packet: ${errors.join("; ")}`);
  if (requireSigned && !packet.signature) {
    throw new Error(
      "Invalid packet: signature required but packet is unsigned",
    );
  }
  if (
    Array.isArray(trustedDids) &&
    trustedDids.length > 0 &&
    packet.signature &&
    !trustedDids.includes(packet.signature.did)
  ) {
    throw new Error(
      `Invalid packet: signer ${packet.signature.did} not in trusted list`,
    );
  }
  return packet;
}

/**
 * Import a template packet into the local marketplace.
 * Returns the installed template.
 */
export function importTemplatePacket(cwd, packet) {
  if (packet.kind !== "template") {
    throw new Error(`Expected template packet, got '${packet.kind}'`);
  }
  return saveUserTemplate(cwd, packet.payload);
}

/**
 * Import a result packet into a local `.chainlesschain/cowork/shared-results/`
 * directory. Produces one JSON file per result, keyed by taskId.
 */
export function importResultPacket(cwd, packet) {
  if (packet.kind !== "result") {
    throw new Error(`Expected result packet, got '${packet.kind}'`);
  }
  const dir = join(cwd, ".chainlesschain", "cowork", "shared-results");
  _deps.mkdirSync(dir, { recursive: true });
  const file = join(dir, `${packet.payload.taskId}.json`);
  _deps.writeFileSync(file, JSON.stringify(packet, null, 2), "utf-8");
  return { file, taskId: packet.payload.taskId };
}

// =====================================================================
// cowork-share V2 governance overlay (iter22)
// =====================================================================
export const SHGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const SHGOV_SHARE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SHARING: "sharing",
  SHARED: "shared",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _shgovPTrans = new Map([
  [
    SHGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      SHGOV_PROFILE_MATURITY_V2.ACTIVE,
      SHGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SHGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      SHGOV_PROFILE_MATURITY_V2.PAUSED,
      SHGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    SHGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      SHGOV_PROFILE_MATURITY_V2.ACTIVE,
      SHGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [SHGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _shgovPTerminal = new Set([SHGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _shgovJTrans = new Map([
  [
    SHGOV_SHARE_LIFECYCLE_V2.QUEUED,
    new Set([
      SHGOV_SHARE_LIFECYCLE_V2.SHARING,
      SHGOV_SHARE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    SHGOV_SHARE_LIFECYCLE_V2.SHARING,
    new Set([
      SHGOV_SHARE_LIFECYCLE_V2.SHARED,
      SHGOV_SHARE_LIFECYCLE_V2.FAILED,
      SHGOV_SHARE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [SHGOV_SHARE_LIFECYCLE_V2.SHARED, new Set()],
  [SHGOV_SHARE_LIFECYCLE_V2.FAILED, new Set()],
  [SHGOV_SHARE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _shgovPsV2 = new Map();
const _shgovJsV2 = new Map();
let _shgovMaxActive = 8,
  _shgovMaxPending = 20,
  _shgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _shgovStuckMs = 60 * 1000;
function _shgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _shgovCheckP(from, to) {
  const a = _shgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid shgov profile transition ${from} → ${to}`);
}
function _shgovCheckJ(from, to) {
  const a = _shgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid shgov share transition ${from} → ${to}`);
}
function _shgovCountActive(owner) {
  let c = 0;
  for (const p of _shgovPsV2.values())
    if (p.owner === owner && p.status === SHGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _shgovCountPending(profileId) {
  let c = 0;
  for (const j of _shgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === SHGOV_SHARE_LIFECYCLE_V2.QUEUED ||
        j.status === SHGOV_SHARE_LIFECYCLE_V2.SHARING)
    )
      c++;
  return c;
}
export function setMaxActiveShgovProfilesPerOwnerV2(n) {
  _shgovMaxActive = _shgovPos(n, "maxActiveShgovProfilesPerOwner");
}
export function getMaxActiveShgovProfilesPerOwnerV2() {
  return _shgovMaxActive;
}
export function setMaxPendingShgovSharesPerProfileV2(n) {
  _shgovMaxPending = _shgovPos(n, "maxPendingShgovSharesPerProfile");
}
export function getMaxPendingShgovSharesPerProfileV2() {
  return _shgovMaxPending;
}
export function setShgovProfileIdleMsV2(n) {
  _shgovIdleMs = _shgovPos(n, "shgovProfileIdleMs");
}
export function getShgovProfileIdleMsV2() {
  return _shgovIdleMs;
}
export function setShgovShareStuckMsV2(n) {
  _shgovStuckMs = _shgovPos(n, "shgovShareStuckMs");
}
export function getShgovShareStuckMsV2() {
  return _shgovStuckMs;
}
export function _resetStateCoworkShareGovV2() {
  _shgovPsV2.clear();
  _shgovJsV2.clear();
  _shgovMaxActive = 8;
  _shgovMaxPending = 20;
  _shgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _shgovStuckMs = 60 * 1000;
}
export function registerShgovProfileV2({
  id,
  owner,
  visibility,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_shgovPsV2.has(id)) throw new Error(`shgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    visibility: visibility || "private",
    status: SHGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _shgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateShgovProfileV2(id) {
  const p = _shgovPsV2.get(id);
  if (!p) throw new Error(`shgov profile ${id} not found`);
  const isInitial = p.status === SHGOV_PROFILE_MATURITY_V2.PENDING;
  _shgovCheckP(p.status, SHGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _shgovCountActive(p.owner) >= _shgovMaxActive)
    throw new Error(`max active shgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = SHGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseShgovProfileV2(id) {
  const p = _shgovPsV2.get(id);
  if (!p) throw new Error(`shgov profile ${id} not found`);
  _shgovCheckP(p.status, SHGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = SHGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveShgovProfileV2(id) {
  const p = _shgovPsV2.get(id);
  if (!p) throw new Error(`shgov profile ${id} not found`);
  _shgovCheckP(p.status, SHGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = SHGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchShgovProfileV2(id) {
  const p = _shgovPsV2.get(id);
  if (!p) throw new Error(`shgov profile ${id} not found`);
  if (_shgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal shgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getShgovProfileV2(id) {
  const p = _shgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listShgovProfilesV2() {
  return [..._shgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createShgovShareV2({ id, profileId, target, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_shgovJsV2.has(id)) throw new Error(`shgov share ${id} already exists`);
  if (!_shgovPsV2.has(profileId))
    throw new Error(`shgov profile ${profileId} not found`);
  if (_shgovCountPending(profileId) >= _shgovMaxPending)
    throw new Error(
      `max pending shgov shares for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    target: target || "",
    status: SHGOV_SHARE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _shgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function sharingShgovShareV2(id) {
  const j = _shgovJsV2.get(id);
  if (!j) throw new Error(`shgov share ${id} not found`);
  _shgovCheckJ(j.status, SHGOV_SHARE_LIFECYCLE_V2.SHARING);
  const now = Date.now();
  j.status = SHGOV_SHARE_LIFECYCLE_V2.SHARING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeShareShgovV2(id) {
  const j = _shgovJsV2.get(id);
  if (!j) throw new Error(`shgov share ${id} not found`);
  _shgovCheckJ(j.status, SHGOV_SHARE_LIFECYCLE_V2.SHARED);
  const now = Date.now();
  j.status = SHGOV_SHARE_LIFECYCLE_V2.SHARED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failShgovShareV2(id, reason) {
  const j = _shgovJsV2.get(id);
  if (!j) throw new Error(`shgov share ${id} not found`);
  _shgovCheckJ(j.status, SHGOV_SHARE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = SHGOV_SHARE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelShgovShareV2(id, reason) {
  const j = _shgovJsV2.get(id);
  if (!j) throw new Error(`shgov share ${id} not found`);
  _shgovCheckJ(j.status, SHGOV_SHARE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = SHGOV_SHARE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getShgovShareV2(id) {
  const j = _shgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listShgovSharesV2() {
  return [..._shgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleShgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _shgovPsV2.values())
    if (
      p.status === SHGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _shgovIdleMs
    ) {
      p.status = SHGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckShgovSharesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _shgovJsV2.values())
    if (
      j.status === SHGOV_SHARE_LIFECYCLE_V2.SHARING &&
      j.startedAt != null &&
      t - j.startedAt >= _shgovStuckMs
    ) {
      j.status = SHGOV_SHARE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkShareGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(SHGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _shgovPsV2.values()) profilesByStatus[p.status]++;
  const sharesByStatus = {};
  for (const v of Object.values(SHGOV_SHARE_LIFECYCLE_V2))
    sharesByStatus[v] = 0;
  for (const j of _shgovJsV2.values()) sharesByStatus[j.status]++;
  return {
    totalShgovProfilesV2: _shgovPsV2.size,
    totalShgovSharesV2: _shgovJsV2.size,
    maxActiveShgovProfilesPerOwner: _shgovMaxActive,
    maxPendingShgovSharesPerProfile: _shgovMaxPending,
    shgovProfileIdleMs: _shgovIdleMs,
    shgovShareStuckMs: _shgovStuckMs,
    profilesByStatus,
    sharesByStatus,
  };
}
