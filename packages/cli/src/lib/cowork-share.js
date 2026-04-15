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
