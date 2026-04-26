"use strict";

const {
  SCHEMA_LANDMARK,
  SCHEMA_TREE_HEAD,
  NAMESPACE_RE,
  TREE_HEAD_SIG_PREFIX,
} = require("./constants.js");
const { sha256, encodeHashStr } = require("./hash.js");
const { jcs } = require("./jcs.js");

/**
 * Stub signature verifier — accepts ANY signature.
 *
 * Use ONLY for tests / local dev. Production callers must inject a real
 * verifier wired to PQC SLH-DSA (or Ed25519 fallback).
 */
function alwaysAcceptSignatureVerifier() {
  return true;
}

/**
 * In-memory cache of verified tree_heads, keyed by (namespace, tree_head_id).
 *
 * Responsibilities:
 *   - Verify each snapshot's tree_head signature on ingest (via injected verifier)
 *   - Recompute tree_head_id and check it matches the claimed value
 *   - Enforce split-view defense: same namespace + tree_size must yield same root_hash
 *   - Provide O(1) lookup for the verifier
 *
 * NOT responsible for:
 *   - PQC algorithm details (delegated to signatureVerifier)
 *   - landmark.publisher_signature (caller verifies before calling ingest)
 *   - IPFS / network fetch (caller hands in already-fetched landmark JSON)
 *   - Persistence to disk (Phase 1 Week 3)
 */
class LandmarkCache {
  /**
   * @param {object} [options]
   * @param {(signingInput: Buffer, signature: object) => boolean} [options.signatureVerifier]
   *   Verifies the tree_head's PQC/Ed25519 signature. Defaults to throw-on-call.
   */
  constructor(options) {
    const opts = options || {};
    this._signatureVerifier =
      opts.signatureVerifier ||
      function rejectByDefault() {
        const e = new Error(
          "LandmarkCache: signatureVerifier not configured — refusing to accept landmarks",
        );
        e.code = "NO_SIGNATURE_VERIFIER";
        throw e;
      };
    this._byNamespace = new Map();
  }

  /**
   * Ingest a landmark. Verifies each snapshot and stores its tree_head.
   *
   * @param {object} landmark
   * @returns {{ accepted: number, total: number }}
   * @throws Error with code: BAD_LANDMARK_SCHEMA / BAD_TREE_HEAD_SCHEMA /
   *   BAD_NAMESPACE / BAD_TREE_HEAD_ID / BAD_TREE_HEAD_SIG / MTCA_DOUBLE_SIGNED
   */
  ingest(landmark) {
    if (!landmark || typeof landmark !== "object") {
      const e = new Error("BAD_LANDMARK_SCHEMA");
      e.code = "BAD_LANDMARK_SCHEMA";
      throw e;
    }
    if (landmark.schema !== SCHEMA_LANDMARK) {
      const e = new Error("BAD_LANDMARK_SCHEMA");
      e.code = "BAD_LANDMARK_SCHEMA";
      throw e;
    }
    if (!Array.isArray(landmark.snapshots) || landmark.snapshots.length === 0) {
      const e = new Error("BAD_LANDMARK_SCHEMA");
      e.code = "BAD_LANDMARK_SCHEMA";
      throw e;
    }

    let accepted = 0;
    for (const snap of landmark.snapshots) {
      if (!snap || typeof snap !== "object") {
        const e = new Error("BAD_TREE_HEAD_SCHEMA");
        e.code = "BAD_TREE_HEAD_SCHEMA";
        throw e;
      }
      const th = snap.tree_head;
      if (!th || th.schema !== SCHEMA_TREE_HEAD) {
        const e = new Error("BAD_TREE_HEAD_SCHEMA");
        e.code = "BAD_TREE_HEAD_SCHEMA";
        throw e;
      }
      if (typeof th.namespace !== "string" || !NAMESPACE_RE.test(th.namespace)) {
        const e = new Error("BAD_NAMESPACE");
        e.code = "BAD_NAMESPACE";
        throw e;
      }
      if (
        !Number.isInteger(th.tree_size) ||
        th.tree_size < 1 ||
        typeof th.root_hash !== "string" ||
        typeof th.expires_at !== "string" ||
        typeof th.issued_at !== "string" ||
        typeof th.issuer !== "string"
      ) {
        const e = new Error("BAD_TREE_HEAD_SCHEMA");
        e.code = "BAD_TREE_HEAD_SCHEMA";
        throw e;
      }

      const canonical = jcs(th);
      const expectedId = encodeHashStr(sha256(canonical));
      if (snap.tree_head_id !== expectedId) {
        const e = new Error("BAD_TREE_HEAD_ID");
        e.code = "BAD_TREE_HEAD_ID";
        e.expected = expectedId;
        e.actual = snap.tree_head_id;
        throw e;
      }

      const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);
      const sigOk = this._signatureVerifier(signingInput, snap.signature);
      if (!sigOk) {
        const e = new Error("BAD_TREE_HEAD_SIG");
        e.code = "BAD_TREE_HEAD_SIG";
        throw e;
      }

      // Split-view defense: same namespace + tree_size must yield same root_hash
      const existing = this._byNamespace.get(th.namespace);
      if (existing) {
        for (const knownTh of existing.values()) {
          if (
            knownTh.tree_size === th.tree_size &&
            knownTh.root_hash !== th.root_hash
          ) {
            const e = new Error("MTCA_DOUBLE_SIGNED");
            e.code = "MTCA_DOUBLE_SIGNED";
            e.namespace = th.namespace;
            e.tree_size = th.tree_size;
            e.knownRoot = knownTh.root_hash;
            e.newRoot = th.root_hash;
            throw e;
          }
        }
      }

      let nsMap = this._byNamespace.get(th.namespace);
      if (!nsMap) {
        nsMap = new Map();
        this._byNamespace.set(th.namespace, nsMap);
      }
      // Idempotent: same id + same tree_head → no-op (already passed split-view above)
      if (!nsMap.has(snap.tree_head_id)) {
        nsMap.set(snap.tree_head_id, th);
        accepted++;
      }
    }

    return { accepted, total: landmark.snapshots.length };
  }

  lookup(namespace, treeHeadId) {
    const nsMap = this._byNamespace.get(namespace);
    if (!nsMap) return null;
    return nsMap.get(treeHeadId) || null;
  }

  lookupLatest(namespace) {
    const nsMap = this._byNamespace.get(namespace);
    if (!nsMap || nsMap.size === 0) return null;
    let latest = null;
    for (const th of nsMap.values()) {
      if (!latest || th.tree_size > latest.tree_size) latest = th;
    }
    return latest;
  }

  size() {
    let total = 0;
    for (const nsMap of this._byNamespace.values()) total += nsMap.size;
    return total;
  }

  namespaces() {
    return [...this._byNamespace.keys()];
  }

  clear() {
    this._byNamespace.clear();
  }
}

module.exports = { LandmarkCache, alwaysAcceptSignatureVerifier };
