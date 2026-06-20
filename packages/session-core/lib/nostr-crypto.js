/**
 * Nostr cryptography — BIP-340 schnorr signatures + NIP-19 bech32 encoding.
 *
 * Shared between CLI (packages/cli) and Desktop (desktop-app-vue/src/main/social).
 * Pure JS — no native bindings, no Electron-specific APIs — works in Node 18+
 * and Electron main process.
 *
 * References:
 *   NIP-01  — event id + sig           https://github.com/nostr-protocol/nips/blob/master/01.md
 *   NIP-19  — bech32 key/note encoding https://github.com/nostr-protocol/nips/blob/master/19.md
 *   BIP-340 — schnorr over secp256k1   https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
 */

const { schnorr } = require("@noble/curves/secp256k1");
const { sha256 } = require("@noble/hashes/sha2.js");
const { bech32 } = require("@scure/base");

const NPUB_PREFIX = "npub";
const NSEC_PREFIX = "nsec";
const NOTE_PREFIX = "note";
const BECH32_LIMIT = 1000;

/* ── Hex helpers ───────────────────────────────────────────── */

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  // Reject non-hex characters. Without this, parseInt("zz", 16) → NaN, and
  // assigning NaN to a Uint8Array element silently coerces to 0 — so a garbage
  // string like "zzzz" would parse into zero-bytes instead of throwing. In a
  // crypto path (keys / sigs / event ids) that silent coercion is dangerous;
  // fail loudly on malformed input instead.
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("Invalid hex string: contains non-hex characters");
  }
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/* ── Keys ──────────────────────────────────────────────────── */

function generatePrivateKey() {
  return bytesToHex(schnorr.utils.randomPrivateKey());
}

function getPublicKey(privateKeyHex) {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex)));
}

/* ── NIP-01 event id + signature ───────────────────────────── */

function serializeEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("Event is required");
  }
  const { pubkey, created_at, kind, tags, content } = event;
  if (typeof pubkey !== "string") throw new Error("event.pubkey required (hex)");
  if (typeof created_at !== "number")
    throw new Error("event.created_at required (seconds, unix time)");
  if (typeof kind !== "number") throw new Error("event.kind required");
  if (!Array.isArray(tags)) throw new Error("event.tags must be array");
  if (typeof content !== "string") throw new Error("event.content must be string");
  return JSON.stringify([0, pubkey, created_at, kind, tags, content]);
}

function getEventHash(event) {
  return bytesToHex(sha256(new TextEncoder().encode(serializeEvent(event))));
}

function signEvent(event, privateKeyHex) {
  const id = getEventHash(event);
  const sig = bytesToHex(
    schnorr.sign(hexToBytes(id), hexToBytes(privateKeyHex)),
  );
  return { ...event, id, sig };
}

function verifyEvent(event) {
  if (!event || typeof event !== "object") return false;
  if (typeof event.id !== "string" || typeof event.sig !== "string") return false;
  if (typeof event.pubkey !== "string") return false;
  let expectedId;
  try {
    expectedId = getEventHash(event);
  } catch {
    return false;
  }
  if (expectedId !== event.id) return false;
  try {
    return schnorr.verify(
      hexToBytes(event.sig),
      hexToBytes(event.id),
      hexToBytes(event.pubkey),
    );
  } catch {
    return false;
  }
}

/* ── NIP-19 bech32 ─────────────────────────────────────────── */

function encodeBech32(prefix, hex) {
  const bytes = hexToBytes(hex);
  const words = bech32.toWords(bytes);
  return bech32.encode(prefix, words, BECH32_LIMIT);
}

function decodeBech32(expectedPrefix, str) {
  const { prefix, words } = bech32.decode(str, BECH32_LIMIT);
  if (prefix !== expectedPrefix) {
    throw new Error(
      `Invalid bech32 prefix: expected "${expectedPrefix}", got "${prefix}"`,
    );
  }
  return bytesToHex(new Uint8Array(bech32.fromWords(words)));
}

function npubEncode(pubKeyHex) {
  return encodeBech32(NPUB_PREFIX, pubKeyHex);
}

function npubDecode(npub) {
  return decodeBech32(NPUB_PREFIX, npub);
}

function nsecEncode(privKeyHex) {
  return encodeBech32(NSEC_PREFIX, privKeyHex);
}

function nsecDecode(nsec) {
  return decodeBech32(NSEC_PREFIX, nsec);
}

function noteEncode(eventIdHex) {
  return encodeBech32(NOTE_PREFIX, eventIdHex);
}

function noteDecode(note) {
  return decodeBech32(NOTE_PREFIX, note);
}

module.exports = {
  generatePrivateKey,
  getPublicKey,
  serializeEvent,
  getEventHash,
  signEvent,
  verifyEvent,
  npubEncode,
  npubDecode,
  nsecEncode,
  nsecDecode,
  noteEncode,
  noteDecode,
  // Internal helpers exposed for tests / advanced consumers
  _internal: { hexToBytes, bytesToHex },
};
