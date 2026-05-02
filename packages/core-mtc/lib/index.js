"use strict";

const constants = require("./constants.js");
const hash = require("./hash.js");
const merkle = require("./merkle.js");
const jcsModule = require("./jcs.js");
const verifier = require("./verifier.js");
const landmarkCacheModule = require("./landmark-cache.js");
const ed25519Signer = require("./signers/ed25519.js");
const slhDsaSigner = require("./signers/slh-dsa.js");
const batchModule = require("./batch.js");
const federationModule = require("./federation.js");
const federationGovernanceModule = require("./federation-governance.js");

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

  // Ed25519 signer (Phase 1 default — small signatures, classical security)
  ed25519: ed25519Signer,

  // SLH-DSA-SHA2-128F signer (Phase 1.6 — FIPS 205 post-quantum, opt-in)
  slhDsa: slhDsaSigner,

  // Batch assembly (pure: leaves + keys + meta -> landmark + envelopes)
  assembleBatch: batchModule.assembleBatch,
  // Federated M-of-N multi-signature variant (Phase 3 federation MTCA)
  assembleBatchFederated: batchModule.assembleBatchFederated,

  // Federation member discovery (Phase 3.3 — service discovery announces)
  createMemberAnnounce: federationModule.createMemberAnnounce,
  verifyMemberAnnounce: federationModule.verifyMemberAnnounce,
  FederationAnnounceCache: federationModule.FederationAnnounceCache,
  SCHEMA_FEDERATION_ANNOUNCE: federationModule.SCHEMA_ANNOUNCE,
  FEDERATION_ANNOUNCE_TTL_DEFAULT: federationModule.DEFAULT_TTL_SECONDS,

  // Federation governance log (MTC_联邦治理_v1.md §9.1)
  SCHEMA_FEDERATION_GOVERNANCE: federationGovernanceModule.SCHEMA_GOVERNANCE,
  FEDERATION_GOVERNANCE_EVENT_TYPES: federationGovernanceModule.EVENT_TYPES,
  createGovernanceEvent: federationGovernanceModule.createGovernanceEvent,
  verifyGovernanceEvent: federationGovernanceModule.verifyGovernanceEvent,
  replayGovernanceLog: federationGovernanceModule.replayGovernanceLog,
  isValidGovernanceEventType: federationGovernanceModule.isValidEventType,
  // v0.8 sync helpers
  dedupeGovernanceEventsByEventId:
    federationGovernanceModule.dedupeEventsByEventId,
  sortGovernanceEventsChronologically:
    federationGovernanceModule.sortEventsChronologically,
  verifyGovernanceLog: federationGovernanceModule.verifyGovernanceLog,
  // v0.3 cross-federation + offline auditor
  SCHEMA_CROSS_FED_TRUST_ANCHOR:
    federationGovernanceModule.SCHEMA_CROSS_FED_TRUST_ANCHOR,
  createCrossFederationTrustAnchor:
    federationGovernanceModule.createCrossFederationTrustAnchor,
  validateCrossFederationTrustAnchor:
    federationGovernanceModule.validateCrossFederationTrustAnchor,
  auditGovernanceLog: federationGovernanceModule.auditGovernanceLog,
};
