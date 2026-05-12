"use strict";

/**
 * @chainlesschain/core-multisig — public API surface.
 *
 * Phase 1 v1.2 — see docs/design/MofN_多签_应用扩展_v1.md。
 */

const policy = require("./policy.js");
const schema = require("./schema.js");
const signing = require("./signing.js");
const store = require("./store.js");
const proposals = require("./proposals.js");
const governanceLog = require("./governance-log.js");

module.exports = {
  // Policy
  validatePolicy: policy.validatePolicy,
  normalizePolicy: policy.normalizePolicy,
  SUPPORTED_ALGS: policy.SUPPORTED_ALGS,
  DEFAULT_EXPIRY_MS: policy.DEFAULT_EXPIRY_MS,

  // Schema
  applySchema: schema.applySchema,
  DDL: schema.DDL,

  // Signing
  canonicalizeForSigning: signing.canonicalizeForSigning,
  computePayloadHash: signing.computePayloadHash,
  signRaw: signing.signRaw,
  verifyOne: signing.verifyOne,
  verifyThreshold: signing.verifyThreshold,
  DOMAIN_PREFIX: signing.DOMAIN_PREFIX,

  // Store
  createStore: store.createStore,

  // Proposals
  createProposalsManager: proposals.createProposalsManager,
  TERMINAL_STATES: proposals.TERMINAL_STATES,

  // Governance log
  appendGovernanceEvent: governanceLog.appendEvent,
  readGovernanceLog: governanceLog.readLog,
};
