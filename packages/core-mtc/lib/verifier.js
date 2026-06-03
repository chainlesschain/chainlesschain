"use strict";

const { computeRootFromPath } = require("./merkle.js");
const { leafHash, decodeHashStr } = require("./hash.js");
const { jcs } = require("./jcs.js");
const { SCHEMA_ENVELOPE, NAMESPACE_RE } = require("./constants.js");

/**
 * Verify an MTC envelope against a LandmarkCache.
 *
 * Returns one of:
 *   { ok: true, leaf, treeHead }
 *   { ok: false, code, recoverable }
 *
 * Codes (per data format §11):
 *   UNKNOWN_SCHEMA, BAD_NAMESPACE, LANDMARK_MISS, LANDMARK_EXPIRED,
 *   BAD_PROOF_INDEX, BAD_PROOF_LENGTH, PROOF_TREE_SIZE_MISMATCH,
 *   ROOT_MISMATCH, BAD_LEAF, BAD_TREE_HEAD
 *
 * Pure function (modulo cache lookup): no network, no signature verification.
 * Tree-head signature is verified by LandmarkCache.ingest, NOT here.
 *
 * @param {object} envelope - MTC envelope JSON
 * @param {{ lookup: (ns: string, id: string) => object|null }} cache
 * @param {{ now?: number }} [options]
 * @returns {{ok: boolean, code?: string, recoverable?: boolean, leaf?: object, treeHead?: object}}
 */
function verify(envelope, cache, options) {
  const now = (options && options.now) || Date.now();

  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.schema !== SCHEMA_ENVELOPE
  ) {
    return { ok: false, code: "UNKNOWN_SCHEMA", recoverable: false };
  }

  if (typeof envelope.namespace !== "string" ||
      !NAMESPACE_RE.test(envelope.namespace)) {
    return { ok: false, code: "BAD_NAMESPACE", recoverable: false };
  }

  if (typeof envelope.tree_head_id !== "string") {
    return { ok: false, code: "BAD_TREE_HEAD", recoverable: false };
  }

  if (!cache || typeof cache.lookup !== "function") {
    throw new TypeError("verify: cache must implement .lookup(namespace, id)");
  }

  const treeHead = cache.lookup(envelope.namespace, envelope.tree_head_id);
  if (!treeHead) {
    return { ok: false, code: "LANDMARK_MISS", recoverable: true };
  }

  const expiresAt = Date.parse(treeHead.expires_at);
  if (Number.isNaN(expiresAt) || expiresAt < now) {
    return { ok: false, code: "LANDMARK_EXPIRED", recoverable: false };
  }

  const p = envelope.inclusion_proof;
  if (
    !p ||
    typeof p !== "object" ||
    !Number.isInteger(p.leaf_index) ||
    !Number.isInteger(p.tree_size) ||
    !Array.isArray(p.audit_path)
  ) {
    return { ok: false, code: "BAD_PROOF_INDEX", recoverable: false };
  }

  if (p.tree_size !== treeHead.tree_size) {
    return { ok: false, code: "PROOF_TREE_SIZE_MISMATCH", recoverable: true };
  }

  if (p.leaf_index < 0 || p.leaf_index >= p.tree_size) {
    return { ok: false, code: "BAD_PROOF_INDEX", recoverable: false };
  }

  if (!envelope.leaf || typeof envelope.leaf !== "object") {
    return { ok: false, code: "BAD_LEAF", recoverable: false };
  }

  let computedLeafHash;
  try {
    computedLeafHash = leafHash(jcs(envelope.leaf));
  } catch (_err) {
    return { ok: false, code: "BAD_LEAF", recoverable: false };
  }

  let auditPathBufs;
  try {
    auditPathBufs = p.audit_path.map((s) => decodeHashStr(s));
  } catch (_err) {
    return { ok: false, code: "BAD_PROOF_LENGTH", recoverable: false };
  }

  let computed;
  try {
    computed = computeRootFromPath(
      computedLeafHash,
      p.leaf_index,
      p.tree_size,
      auditPathBufs,
    );
  } catch (err) {
    return {
      ok: false,
      code: err.code || "BAD_PROOF_LENGTH",
      recoverable: false,
    };
  }

  let expectedRoot;
  try {
    expectedRoot = decodeHashStr(treeHead.root_hash);
  } catch (_err) {
    return { ok: false, code: "BAD_TREE_HEAD", recoverable: false };
  }

  if (!computed.equals(expectedRoot)) {
    return { ok: false, code: "ROOT_MISMATCH", recoverable: false };
  }

  return { ok: true, leaf: envelope.leaf, treeHead };
}

module.exports = { verify };
