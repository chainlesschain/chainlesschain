"use strict";

/**
 * High-level batch assembly: raw leaves + keys + meta -> { landmark, envelopes,
 * treeHeadId }. Pure (no filesystem, no key generation), so any caller can
 * compose its own queue / persistence / transport on top.
 *
 * Lifted from packages/cli/src/commands/mtc.js so cc mtc and cc audit mtc share
 * one canonical assembly path.
 */

const {
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
  TREE_HEAD_SIG_PREFIX,
} = require("./constants.js");
const { sha256, leafHash, encodeHashStr } = require("./hash.js");
const { jcs } = require("./jcs.js");
const { MerkleTree } = require("./merkle.js");
const ed25519 = require("./signers/ed25519.js");

/**
 * @param {Array<object>} rawLeaves - raw JSON leaves (will be JCS-canonicalized + leafHash'd)
 * @param {{ secretKey: Buffer, publicKey: Buffer, pubkeyId?: string }} keys
 * @param {{ namespace: string, issuer: string, issuedAt?: string, expiresAt?: string }} meta
 * @param {object} [signer] - signer module (ed25519 default; pass slhDsa for FIPS 205 post-quantum)
 * @returns {{ landmark: object, envelopes: object[], treeHeadId: string, root: Buffer }}
 */
function assembleBatch(rawLeaves, keys, meta, signer) {
  if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
    throw new RangeError("assembleBatch: rawLeaves must be a non-empty array");
  }
  if (!keys || !Buffer.isBuffer(keys.secretKey) || !Buffer.isBuffer(keys.publicKey)) {
    throw new TypeError("assembleBatch: keys must include secretKey + publicKey buffers");
  }
  if (!meta || typeof meta.namespace !== "string" || typeof meta.issuer !== "string") {
    throw new TypeError("assembleBatch: meta.namespace and meta.issuer required");
  }
  // Default signer = ed25519 (kept as classical baseline; pass mtcLib.slhDsa
  // to opt into FIPS 205 SLH-DSA-128f tree-head signatures).
  const signImpl = signer || ed25519;
  if (
    typeof signImpl.signTreeHead !== "function" ||
    typeof signImpl.trustAnchorEntry !== "function"
  ) {
    throw new TypeError(
      "assembleBatch: signer must export signTreeHead + trustAnchorEntry",
    );
  }

  const issuedAt = meta.issuedAt || new Date().toISOString();
  const expiresAt =
    meta.expiresAt || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const leafHashes = rawLeaves.map((l) => leafHash(jcs(l)));
  const tree = new MerkleTree(leafHashes);
  const root = tree.root();

  const treeHead = {
    schema: SCHEMA_TREE_HEAD,
    namespace: meta.namespace,
    tree_size: leafHashes.length,
    root_hash: encodeHashStr(root),
    issued_at: issuedAt,
    expires_at: expiresAt,
    issuer: meta.issuer,
  };
  const canonical = jcs(treeHead);
  const treeHeadId = encodeHashStr(sha256(canonical));
  const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);
  const signature = signImpl.signTreeHead(signingInput, {
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    issuer: meta.issuer,
  });

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: meta.namespace.split("/").slice(0, -1).join("/"),
    snapshots: [{ tree_head: treeHead, tree_head_id: treeHeadId, signature }],
    trust_anchors: [signImpl.trustAnchorEntry(keys.publicKey, meta.issuer)],
    published_at: issuedAt,
    publisher_signature: {
      alg: signImpl.ALG || "Ed25519",
      key_id: meta.issuer + "#key-1",
      sig: "TODO-PUBLISHER-SIG",
    },
  };

  const envelopes = rawLeaves.map((leaf, i) => ({
    schema: SCHEMA_ENVELOPE,
    namespace: meta.namespace,
    tree_head_id: treeHeadId,
    leaf,
    inclusion_proof: {
      leaf_index: i,
      tree_size: leafHashes.length,
      audit_path: tree.prove(i).map((b) => encodeHashStr(b)),
    },
  }));

  return { landmark, envelopes, treeHeadId, root };
}

/**
 * Federated batch assembly — M-of-N multi-signature variant.
 *
 * Each entry in `signers` represents one federation member with their own
 * keypair + signer module. All members sign the same canonical tree_head;
 * the resulting landmark embeds {signatures[]} (vs single {signature}) and
 * a {threshold} number. Verifier accepts the snapshot when ≥threshold
 * signatures verify against members listed in trust_anchors[].
 *
 * Single-signer assembleBatch() above is the {threshold:1} degenerate case
 * with cleaner output (no array wrapping). Both paths produce verifier-
 * compatible landmarks; LandmarkCache._validateAndStoreSnapshot dispatches
 * on which field is present.
 *
 * @param {Array<object>} rawLeaves
 * @param {Array<{secretKey: Buffer, publicKey: Buffer, issuer: string, signer?: object}>} signers
 *   one entry per federation member; `signer` defaults to ed25519 if omitted
 * @param {{ namespace: string, issuer: string, threshold?: number, issuedAt?: string, expiresAt?: string }} meta
 *   meta.issuer is the federation-level issuer string written into tree_head;
 *   each member's own issuer is stored in their trust_anchor entry
 * @returns {{ landmark: object, envelopes: object[], treeHeadId: string, root: Buffer }}
 */
function assembleBatchFederated(rawLeaves, signers, meta) {
  if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
    throw new RangeError(
      "assembleBatchFederated: rawLeaves must be a non-empty array",
    );
  }
  if (!Array.isArray(signers) || signers.length === 0) {
    throw new RangeError(
      "assembleBatchFederated: signers must be a non-empty array",
    );
  }
  if (!meta || typeof meta.namespace !== "string" || typeof meta.issuer !== "string") {
    throw new TypeError(
      "assembleBatchFederated: meta.namespace and meta.issuer required",
    );
  }
  const threshold = Number.isInteger(meta.threshold) ? meta.threshold : signers.length;
  if (threshold < 1 || threshold > signers.length) {
    throw new RangeError(
      `assembleBatchFederated: threshold must be in [1, ${signers.length}] (got ${threshold})`,
    );
  }
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i];
    if (!s || !Buffer.isBuffer(s.secretKey) || !Buffer.isBuffer(s.publicKey)) {
      throw new TypeError(
        `assembleBatchFederated: signers[${i}] must have secretKey + publicKey buffers`,
      );
    }
    if (typeof s.issuer !== "string" || !s.issuer) {
      throw new TypeError(
        `assembleBatchFederated: signers[${i}].issuer required (member-level issuer string)`,
      );
    }
    const sig = s.signer || ed25519;
    if (typeof sig.signTreeHead !== "function" || typeof sig.trustAnchorEntry !== "function") {
      throw new TypeError(
        `assembleBatchFederated: signers[${i}].signer must export signTreeHead + trustAnchorEntry`,
      );
    }
  }

  const issuedAt = meta.issuedAt || new Date().toISOString();
  const expiresAt =
    meta.expiresAt || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const leafHashes = rawLeaves.map((l) => leafHash(jcs(l)));
  const tree = new MerkleTree(leafHashes);
  const root = tree.root();

  const treeHead = {
    schema: SCHEMA_TREE_HEAD,
    namespace: meta.namespace,
    tree_size: leafHashes.length,
    root_hash: encodeHashStr(root),
    issued_at: issuedAt,
    expires_at: expiresAt,
    issuer: meta.issuer,
  };
  const canonical = jcs(treeHead);
  const treeHeadId = encodeHashStr(sha256(canonical));
  const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);

  const signatures = signers.map((s) => {
    const sig = s.signer || ed25519;
    return sig.signTreeHead(signingInput, {
      secretKey: s.secretKey,
      publicKey: s.publicKey,
      issuer: s.issuer,
    });
  });

  const trustAnchors = signers.map((s) => {
    const sig = s.signer || ed25519;
    return sig.trustAnchorEntry(s.publicKey, s.issuer);
  });

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: meta.namespace.split("/").slice(0, -1).join("/"),
    snapshots: [
      {
        tree_head: treeHead,
        tree_head_id: treeHeadId,
        signatures,
        threshold,
      },
    ],
    trust_anchors: trustAnchors,
    published_at: issuedAt,
    publisher_signature: {
      alg: (signers[0].signer || ed25519).ALG || "Ed25519",
      key_id: meta.issuer + "#federation",
      sig: "TODO-PUBLISHER-SIG",
    },
  };

  const envelopes = rawLeaves.map((leaf, i) => ({
    schema: SCHEMA_ENVELOPE,
    namespace: meta.namespace,
    tree_head_id: treeHeadId,
    leaf,
    inclusion_proof: {
      leaf_index: i,
      tree_size: leafHashes.length,
      audit_path: tree.prove(i).map((b) => encodeHashStr(b)),
    },
  }));

  return { landmark, envelopes, treeHeadId, root };
}

module.exports = { assembleBatch, assembleBatchFederated };
