"use strict";

/**
 * Ed25519 signer + verifier for MTC tree heads.
 *
 * STOP-GAP: This is the practical signing path until @noble/post-quantum
 * lands. The protocol direction is SLH-DSA-128f for tree heads; Ed25519
 * here keeps the data-format end-to-end real (vs the alwaysAccept stub)
 * so we can flip to PQC by swapping this module without touching CLI / cache.
 */

const { ed25519 } = require("@noble/curves/ed25519");
const { sha256 } = require("../hash.js");
const { jcs } = require("../jcs.js");

const ALG = "Ed25519";

/**
 * Compute the canonical pubkey_id for an Ed25519 public key.
 * pubkey_id = "sha256:" + base64url(SHA-256(JCS(JWK)))
 */
function pubkeyId(publicKey) {
  if (!Buffer.isBuffer(publicKey) || publicKey.length !== 32) {
    throw new TypeError("pubkeyId: publicKey must be 32-byte Buffer");
  }
  const jwk = makeJwk(publicKey);
  return "sha256:" + sha256(jcs(jwk)).toString("base64url");
}

function makeJwk(publicKey) {
  return {
    kty: "OKP",
    crv: "Ed25519",
    alg: ALG,
    x: publicKey.toString("base64url"),
  };
}

function jwkToPublicKey(jwk) {
  if (!jwk || jwk.alg !== ALG || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    return null;
  }
  const buf = Buffer.from(jwk.x, "base64url");
  if (buf.length !== 32) return null;
  return buf;
}

/**
 * Generate a fresh Ed25519 keypair.
 * @returns {{ secretKey: Buffer, publicKey: Buffer, pubkeyId: string }}
 */
function generateKeyPair() {
  const secretKey = Buffer.from(ed25519.utils.randomPrivateKey());
  const publicKey = Buffer.from(ed25519.getPublicKey(secretKey));
  return {
    secretKey,
    publicKey,
    pubkeyId: pubkeyId(publicKey),
  };
}

/**
 * Sign canonicalized tree-head bytes with domain-separation prefix.
 * Caller passes the signing input directly (already prefixed).
 *
 * @param {Buffer} signingInput - TREE_HEAD_SIG_PREFIX || JCS(tree_head)
 * @param {Buffer} secretKey - 32-byte Ed25519 secret key
 * @returns {Buffer} 64-byte signature
 */
function signRaw(signingInput, secretKey) {
  if (!Buffer.isBuffer(signingInput)) {
    throw new TypeError("signRaw: signingInput must be Buffer");
  }
  if (!Buffer.isBuffer(secretKey) || secretKey.length !== 32) {
    throw new TypeError("signRaw: secretKey must be 32-byte Buffer");
  }
  return Buffer.from(ed25519.sign(signingInput, secretKey));
}

/**
 * Build a tree_head signature object (as it appears in landmark.snapshots[i].signature).
 *
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
 * Make a signatureVerifier for LandmarkCache that verifies Ed25519 signatures
 * against a {pubkey_id → publicKey} trusted-key map.
 */
function makeVerifier(trustedKeys) {
  if (!(trustedKeys instanceof Map)) {
    throw new TypeError("makeVerifier: trustedKeys must be a Map");
  }
  return function ed25519SignatureVerifier(signingInput, signatureObj) {
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
    if (sig.length !== 64) return false;

    try {
      return ed25519.verify(sig, signingInput, publicKey);
    } catch (_err) {
      return false;
    }
  };
}

/**
 * Convenience: build a signatureVerifier from a landmark's trust_anchors[].
 * Useful for `cc mtc verify` where the landmark IS the trust scope.
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
  generateKeyPair,
  pubkeyId,
  signRaw,
  signTreeHead,
  trustAnchorEntry,
  makeJwk,
  jwkToPublicKey,
  makeVerifier,
  makeVerifierFromLandmark,
};
