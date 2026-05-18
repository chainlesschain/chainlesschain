"use strict";

/**
 * SLH-DSA-SHA2-128F signer + verifier for MTC tree heads (FIPS 205).
 *
 * Mirrors lib/signers/ed25519.js — same surface, post-quantum primitive.
 * MTC's compression value comes from amortizing one big tree-head signature
 * across N envelopes; SLH-DSA-128f produces ~17 KB signatures (vs 64 B for
 * Ed25519), so this is the *target* algorithm — Ed25519 was a stop-gap until
 * @noble/post-quantum landed on npm.
 *
 * JWK encoding follows draft-ietf-cose-pqc (kty: PQK).
 */

const { slh_dsa_sha2_128f } = require("@noble/post-quantum/slh-dsa.js");
const { sha256 } = require("../hash.js");
const { jcs } = require("../jcs.js");

const ALG = "SLH-DSA-SHA2-128F";
const PUBKEY_LEN = 32;
const SECRETKEY_LEN = 64;
const SIGNATURE_LEN = 17088;

function pubkeyId(publicKey) {
  if (!Buffer.isBuffer(publicKey) || publicKey.length !== PUBKEY_LEN) {
    throw new TypeError(
      `pubkeyId: publicKey must be ${PUBKEY_LEN}-byte Buffer (got ${publicKey && publicKey.length})`,
    );
  }
  const jwk = makeJwk(publicKey);
  return "sha256:" + sha256(jcs(jwk)).toString("base64url");
}

function makeJwk(publicKey) {
  return {
    kty: "PQK",
    alg: ALG,
    pub: publicKey.toString("base64url"),
  };
}

function jwkToPublicKey(jwk) {
  if (!jwk || jwk.alg !== ALG || jwk.kty !== "PQK" || typeof jwk.pub !== "string") {
    return null;
  }
  const buf = Buffer.from(jwk.pub, "base64url");
  if (buf.length !== PUBKEY_LEN) return null;
  return buf;
}

/**
 * Generate a fresh SLH-DSA-128f keypair.
 * @returns {{ secretKey: Buffer, publicKey: Buffer, pubkeyId: string }}
 */
function generateKeyPair() {
  const kp = slh_dsa_sha2_128f.keygen();
  const secretKey = Buffer.from(kp.secretKey);
  const publicKey = Buffer.from(kp.publicKey);
  return { secretKey, publicKey, pubkeyId: pubkeyId(publicKey) };
}

/**
 * Derive the public key from a 64-byte SLH-DSA secret key.
 * Used by audit-mtc / mtc commands when a secret key is read back from disk.
 */
function getPublicKey(secretKey) {
  if (!Buffer.isBuffer(secretKey) || secretKey.length !== SECRETKEY_LEN) {
    throw new TypeError(
      `getPublicKey: secretKey must be ${SECRETKEY_LEN}-byte Buffer`,
    );
  }
  return Buffer.from(slh_dsa_sha2_128f.getPublicKey(secretKey));
}

/**
 * Sign canonicalized tree-head bytes (caller passes signing input including
 * domain-separation prefix).
 */
function signRaw(signingInput, secretKey) {
  if (!Buffer.isBuffer(signingInput)) {
    throw new TypeError("signRaw: signingInput must be Buffer");
  }
  if (!Buffer.isBuffer(secretKey) || secretKey.length !== SECRETKEY_LEN) {
    throw new TypeError(
      `signRaw: secretKey must be ${SECRETKEY_LEN}-byte Buffer`,
    );
  }
  return Buffer.from(slh_dsa_sha2_128f.sign(signingInput, secretKey));
}

/**
 * Build a tree_head signature object.
 * @param {Buffer} signingInput
 * @param {{ secretKey: Buffer, publicKey: Buffer, issuer: string }} keyInfo
 * @returns {{ alg: string, issuer: string, sig: string, pubkey_id: string }}
 */
function signTreeHead(signingInput, keyInfo) {
  const sig = signRaw(signingInput, keyInfo.secretKey);
  return {
    alg: ALG,
    issuer: keyInfo.issuer,
    sig: sig.toString("base64url"),
    pubkey_id: pubkeyId(keyInfo.publicKey),
  };
}

/**
 * Build a trust_anchor entry suitable for landmark.trust_anchors[].
 */
function trustAnchorEntry(publicKey, issuer) {
  return {
    issuer,
    alg: ALG,
    pubkey_id: pubkeyId(publicKey),
    pubkey_jwk: makeJwk(publicKey),
  };
}

/**
 * Make a signatureVerifier for LandmarkCache that verifies SLH-DSA-128f
 * signatures against a {pubkey_id → publicKey} trusted-key map.
 */
function makeVerifier(trustedKeys) {
  if (!(trustedKeys instanceof Map)) {
    throw new TypeError("makeVerifier: trustedKeys must be a Map");
  }
  return function slhDsaSignatureVerifier(signingInput, signatureObj) {
    if (!signatureObj || typeof signatureObj !== "object") return false;
    if (signatureObj.alg !== ALG) return false;
    if (typeof signatureObj.pubkey_id !== "string") return false;
    if (typeof signatureObj.sig !== "string") return false;

    const publicKey = trustedKeys.get(signatureObj.pubkey_id);
    if (!publicKey) return false;

    let sig;
    try {
      sig = Buffer.from(signatureObj.sig, "base64url");
    } catch (_err) {
      return false;
    }
    if (sig.length !== SIGNATURE_LEN) return false;

    try {
      return slh_dsa_sha2_128f.verify(sig, signingInput, publicKey);
    } catch (_err) {
      return false;
    }
  };
}

/**
 * Convenience: build a signatureVerifier from a landmark's trust_anchors[].
 */
function makeVerifierFromLandmark(landmark) {
  const trustedKeys = new Map();
  if (landmark && Array.isArray(landmark.trust_anchors)) {
    for (const anchor of landmark.trust_anchors) {
      if (!anchor || anchor.alg !== ALG) continue;
      const pk = jwkToPublicKey(anchor.pubkey_jwk);
      if (pk && typeof anchor.pubkey_id === "string") {
        trustedKeys.set(anchor.pubkey_id, pk);
      }
    }
  }
  return makeVerifier(trustedKeys);
}

module.exports = {
  ALG,
  PUBKEY_LEN,
  SECRETKEY_LEN,
  SIGNATURE_LEN,
  generateKeyPair,
  getPublicKey,
  pubkeyId,
  signRaw,
  signTreeHead,
  trustAnchorEntry,
  makeJwk,
  jwkToPublicKey,
  makeVerifier,
  makeVerifierFromLandmark,
};
