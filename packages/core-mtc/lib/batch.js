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
 * @returns {{ landmark: object, envelopes: object[], treeHeadId: string, root: Buffer }}
 */
function assembleBatch(rawLeaves, keys, meta) {
  if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
    throw new RangeError("assembleBatch: rawLeaves must be a non-empty array");
  }
  if (!keys || !Buffer.isBuffer(keys.secretKey) || !Buffer.isBuffer(keys.publicKey)) {
    throw new TypeError("assembleBatch: keys must include 32-byte secretKey + publicKey buffers");
  }
  if (!meta || typeof meta.namespace !== "string" || typeof meta.issuer !== "string") {
    throw new TypeError("assembleBatch: meta.namespace and meta.issuer required");
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
  const signature = ed25519.signTreeHead(signingInput, {
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    issuer: meta.issuer,
  });

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: meta.namespace.split("/").slice(0, -1).join("/"),
    snapshots: [{ tree_head: treeHead, tree_head_id: treeHeadId, signature }],
    trust_anchors: [ed25519.trustAnchorEntry(keys.publicKey, meta.issuer)],
    published_at: issuedAt,
    publisher_signature: {
      alg: "Ed25519",
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

module.exports = { assembleBatch };
