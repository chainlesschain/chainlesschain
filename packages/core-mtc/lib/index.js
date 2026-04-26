"use strict";

const constants = require("./constants.js");
const hash = require("./hash.js");
const merkle = require("./merkle.js");
const jcsModule = require("./jcs.js");
const verifier = require("./verifier.js");
const landmarkCacheModule = require("./landmark-cache.js");
const ed25519Signer = require("./signers/ed25519.js");

module.exports = {
  // constants
  LEAF_PREFIX: constants.LEAF_PREFIX,
  NODE_PREFIX: constants.NODE_PREFIX,
  TREE_HEAD_SIG_PREFIX: constants.TREE_HEAD_SIG_PREFIX,
  LANDMARK_SIG_PREFIX: constants.LANDMARK_SIG_PREFIX,
  SCHEMA_ENVELOPE: constants.SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD: constants.SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK: constants.SCHEMA_LANDMARK,
  NAMESPACE_RE: constants.NAMESPACE_RE,
  HASH_PREFIX: constants.HASH_PREFIX,

  // hash
  sha256: hash.sha256,
  leafHash: hash.leafHash,
  nodeHash: hash.nodeHash,
  encodeHashStr: hash.encodeHashStr,
  decodeHashStr: hash.decodeHashStr,

  // merkle
  largestPow2LessThan: merkle.largestPow2LessThan,
  MerkleTree: merkle.MerkleTree,
  mth: merkle.mth,
  mthFromLeafHashes: merkle.mthFromLeafHashes,
  generateAuditPath: merkle.generateAuditPath,
  computeRootFromPath: merkle.computeRootFromPath,

  // jcs
  jcs: jcsModule.jcs,

  // verifier + cache
  verify: verifier.verify,
  LandmarkCache: landmarkCacheModule.LandmarkCache,
  alwaysAcceptSignatureVerifier:
    landmarkCacheModule.alwaysAcceptSignatureVerifier,
  encodeIdForFs: landmarkCacheModule.encodeIdForFs,

  // Ed25519 signer (stopgap until @noble/post-quantum SLH-DSA lands)
  ed25519: ed25519Signer,
};
