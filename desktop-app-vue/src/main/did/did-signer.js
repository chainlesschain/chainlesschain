/**
 * did-signer — pure-crypto Ed25519 sign/verify helpers for DID-bound payloads.
 *
 * B4a v1: factored out of DIDManager so callers (channel-manager, future
 * governance / proposal signing) can sign without holding a DIDManager
 * reference and so unit tests don't have to bootstrap a full SQLite identity.
 *
 * Wire conventions used by channel-manager:
 *   - sender_pubkey: base64 of the 32-byte Ed25519 public key
 *   - signature:     base64 of the 64-byte Ed25519 detached signature
 *   - sender_did:    "did:chainlesschain:" + first 20 bytes of sha256(pubkey)
 *                    encoded as lowercase hex (matches DIDManager.generateDID)
 *
 * Canonical signing input is JCS-canonicalized JSON bytes of the immutable
 * subset of a message (id / channel_id / sender_did / content / message_type /
 * reply_to / created_at). NEVER include is_pinned, reactions, updated_at —
 * those mutate after creation.
 *
 * @module did-signer
 */

const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

const DID_METHOD = "chainlesschain";
const DID_HASH_PREFIX_BYTES = 20; // matches did-manager.js generateDID()

/**
 * Compute the canonical did:chainlesschain DID for a public key.
 * Mirror of DIDManager.generateDID — kept duplicated here so this module
 * is testable without DIDManager + so a circular dep can't form.
 *
 * @param {Uint8Array | Buffer} publicKey - 32-byte Ed25519 public key
 * @param {string} [method] - DID method, default "chainlesschain"
 * @returns {string} did:chainlesschain:<hex>
 */
function computeDIDFromPublicKey(publicKey, method = DID_METHOD) {
  if (!publicKey || (publicKey.length !== 32 && publicKey.byteLength !== 32)) {
    throw new TypeError("computeDIDFromPublicKey: publicKey must be 32 bytes");
  }
  const buf = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
  const hash = crypto.createHash("sha256").update(buf).digest();
  const identifier = hash.slice(0, DID_HASH_PREFIX_BYTES).toString("hex");
  return `did:${method}:${identifier}`;
}

/**
 * Minimal deterministic JSON serialization — sufficient for the flat
 * immutable channel-message subset we sign (no nested objects, no
 * Number/Date edge cases). NOT full RFC 8785 (JCS) compliance.
 *
 * Why not the `canonicalize` npm package: it's only a transitive dep via
 * @chainlesschain/core-mtc; desktop-app-vue's standalone node_modules
 * doesn't re-resolve it. Pulling it in directly would add an install line
 * for a function we can match in 15 LoC for our limited surface.
 *
 * Rules (subset of JCS):
 *   - Keys sorted by Unicode code-point order (Array.sort default)
 *   - Strings double-quoted with JSON.stringify (handles UTF-8 + escapes)
 *   - Numbers: integers → as-is via String(); finite floats → JSON.stringify
 *   - null → "null", true/false → as-is
 *   - undefined keys: skipped (matches JSON.stringify behavior)
 *   - No trailing whitespace
 *
 * Throws on nested objects/arrays — pin the contract to flat shapes so
 * callers don't get surprises.
 *
 * @param {object} obj
 * @returns {Uint8Array} UTF-8 bytes
 */
function canonicalize(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("canonicalize: input must be a plain object");
  }
  const keys = Object.keys(obj).sort();
  const parts = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) {
      continue;
    }
    if (v !== null && typeof v === "object") {
      throw new TypeError(
        "canonicalize: nested objects/arrays not supported (key=" + k + ")",
      );
    }
    let serialized;
    if (v === null) {
      serialized = "null";
    } else if (typeof v === "boolean") {
      serialized = v ? "true" : "false";
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        throw new TypeError("canonicalize: non-finite number (key=" + k + ")");
      }
      serialized = JSON.stringify(v);
    } else if (typeof v === "string") {
      serialized = JSON.stringify(v);
    } else {
      throw new TypeError(
        "canonicalize: unsupported type " + typeof v + " (key=" + k + ")",
      );
    }
    parts.push(JSON.stringify(k) + ":" + serialized);
  }
  return naclUtil.decodeUTF8("{" + parts.join(",") + "}");
}

/**
 * Sign canonical bytes with an Ed25519 secret key.
 *
 * @param {Uint8Array} bytes - the canonical input to sign
 * @param {Uint8Array | Buffer} secretKey - 64-byte Ed25519 secret key (nacl format)
 * @returns {string} base64-encoded 64-byte detached signature
 */
function signBytes(bytes, secretKey) {
  if (!bytes || bytes.length === 0) {
    throw new TypeError("signBytes: bytes must be non-empty");
  }
  if (!secretKey || (secretKey.length !== 64 && secretKey.byteLength !== 64)) {
    throw new TypeError("signBytes: secretKey must be 64 bytes (nacl Ed25519)");
  }
  const sk =
    secretKey instanceof Uint8Array ? secretKey : new Uint8Array(secretKey);
  const sig = nacl.sign.detached(bytes, sk);
  return naclUtil.encodeBase64(sig);
}

/**
 * Verify a base64 signature against canonical bytes + public key.
 *
 * @param {Uint8Array} bytes - canonical input that was signed
 * @param {string} signatureB64 - base64-encoded signature
 * @param {Uint8Array | Buffer} publicKey - 32-byte Ed25519 public key
 * @returns {boolean} true iff signature valid; false on any error
 */
function verifyBytes(bytes, signatureB64, publicKey) {
  if (!bytes || !signatureB64 || !publicKey) {
    return false;
  }
  try {
    const sig = naclUtil.decodeBase64(signatureB64);
    if (sig.length !== 64) {
      return false;
    }
    const pk =
      publicKey instanceof Uint8Array ? publicKey : new Uint8Array(publicKey);
    if (pk.length !== 32) {
      return false;
    }
    return nacl.sign.detached.verify(bytes, sig, pk);
  } catch (_err) {
    return false;
  }
}

/**
 * High-level helper used by channel-manager.sendMessage:
 * given the message payload object + the sender's identity (must contain
 * `public_key_sign` base64 and `private_key_ref` JSON-string with `.sign`
 * base64 secret key), produce { sender_pubkey, signature } strings ready
 * to embed in the message envelope.
 *
 * @param {object} payload - object to canonicalize + sign
 * @param {{public_key_sign: string, private_key_ref: string}} identity
 * @returns {{ sender_pubkey: string, signature: string }}
 */
function signPayloadWithIdentity(payload, identity) {
  if (!identity || typeof identity !== "object") {
    throw new TypeError("signPayloadWithIdentity: identity required");
  }
  if (!identity.public_key_sign || !identity.private_key_ref) {
    throw new Error(
      "signPayloadWithIdentity: identity missing public_key_sign / private_key_ref",
    );
  }
  let secretB64;
  try {
    const ref = JSON.parse(identity.private_key_ref);
    secretB64 = ref && ref.sign;
  } catch (err) {
    throw new Error(
      "signPayloadWithIdentity: private_key_ref not parseable JSON: " +
        err.message,
    );
  }
  if (!secretB64) {
    throw new Error("signPayloadWithIdentity: private_key_ref.sign missing");
  }
  const secretKey = naclUtil.decodeBase64(secretB64);
  const canonical = canonicalize(payload);
  const signature = signBytes(canonical, secretKey);
  return {
    sender_pubkey: identity.public_key_sign,
    signature,
  };
}

/**
 * High-level helper used by channel-manager.handleMessageReceived:
 * verifies a received message envelope. Performs THREE checks:
 *   1. sender_pubkey, when hashed, matches sender_did (anti-impersonation:
 *      prevents pubkey/DID mismatch attacks where attacker claims a DID but
 *      ships their own pubkey)
 *   2. canonical bytes of the *immutable* payload subset (the same fields
 *      the sender canonicalized) verify against signature + pubkey
 *   3. signature shape valid (length etc — handled by verifyBytes)
 *
 * @param {object} payload - the immutable subset that was signed
 * @param {string} senderDid - claimed sender DID (e.g. "did:chainlesschain:abc...")
 * @param {string} senderPubkeyB64 - base64 of pubkey embedded in message
 * @param {string} signatureB64 - base64 detached signature
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyPayloadAgainstDid(
  payload,
  senderDid,
  senderPubkeyB64,
  signatureB64,
) {
  if (!senderDid) {
    return { ok: false, reason: "sender_did missing" };
  }
  if (!senderPubkeyB64) {
    return { ok: false, reason: "sender_pubkey missing" };
  }
  if (!signatureB64) {
    return { ok: false, reason: "signature missing" };
  }

  let pubkey;
  try {
    pubkey = naclUtil.decodeBase64(senderPubkeyB64);
  } catch (err) {
    return {
      ok: false,
      reason: "sender_pubkey not valid base64: " + err.message,
    };
  }
  if (pubkey.length !== 32) {
    return {
      ok: false,
      reason: "sender_pubkey wrong length (" + pubkey.length + ")",
    };
  }

  const expectedDid = computeDIDFromPublicKey(pubkey);
  if (expectedDid !== senderDid) {
    return {
      ok: false,
      reason:
        "sender_did mismatch: claimed " +
        senderDid +
        " but pubkey hashes to " +
        expectedDid,
    };
  }

  const canonical = canonicalize(payload);
  if (!verifyBytes(canonical, signatureB64, pubkey)) {
    return { ok: false, reason: "Ed25519 signature verification failed" };
  }
  return { ok: true };
}

module.exports = {
  computeDIDFromPublicKey,
  canonicalize,
  signBytes,
  verifyBytes,
  signPayloadWithIdentity,
  verifyPayloadAgainstDid,
  DID_METHOD,
  DID_HASH_PREFIX_BYTES,
};
