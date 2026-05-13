"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  SCHEMA_LANDMARK,
  SCHEMA_TREE_HEAD,
  NAMESPACE_RE,
  TREE_HEAD_SIG_PREFIX,
  LANDMARK_SIG_PREFIX,
} = require("./constants.js");
const { sha256, encodeHashStr } = require("./hash.js");
const { jcs } = require("./jcs.js");
const { _stripSigsForPublisher } = require("./publisher-signing.js");

function alwaysAcceptSignatureVerifier() {
  return true;
}

// Strict PQ mode: classical algorithms that strict mode refuses to accept.
// Add future classical algs here as they're added (e.g. ECDSA P-256).
// Anything NOT in this list is treated as PQ-acceptable.
const CLASSICAL_ALGS = ["Ed25519"];

function isClassicalAlg(alg) {
  return typeof alg === "string" && CLASSICAL_ALGS.includes(alg);
}

function encodeIdForFs(treeHeadId) {
  return treeHeadId.replace(/:/g, "_");
}

class LandmarkCache {
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
    // Opt-in: when true, ingest() also verifies landmark.publisher_signature
    // (in addition to per-snapshot tree_head signatures). Default off for
    // back-compat with on-disk landmarks predating real publisher signing
    // (see batch.js producer change a634a00f3) and with hand-built test
    // fixtures that use placeholder sig values.
    this._verifyPublisherSig = opts.verifyPublisherSignature === true;
    // Opt-in strict PQ mode (#21 B.6): reject any landmark whose
    // publisher_signature OR per-snapshot signatures contain classical
    // (non-PQ) algs. Useful for NIST-regulated deployments requiring
    // post-quantum posture across all signers. Default off — mixed
    // heterogeneous Ed25519+SLH-DSA federations remain valid.
    this._strictPqMode = opts.strictPqMode === true;
    this._byNamespace = new Map();
    this._persistDir = opts.persistDir || null;
  }

  ingest(landmark) {
    if (!landmark || typeof landmark !== "object") throw this._err("BAD_LANDMARK_SCHEMA");
    if (landmark.schema !== SCHEMA_LANDMARK) throw this._err("BAD_LANDMARK_SCHEMA");
    if (!Array.isArray(landmark.snapshots) || landmark.snapshots.length === 0) {
      throw this._err("BAD_LANDMARK_SCHEMA");
    }

    if (this._strictPqMode) {
      this._assertStrictPqMode(landmark);
    }

    if (this._verifyPublisherSig) {
      this._verifyPublisherSignature(landmark);
    }

    let accepted = 0;
    for (const snap of landmark.snapshots) {
      const result = this._validateAndStoreSnapshot(snap);
      if (result === "accepted") {
        accepted++;
        if (this._persistDir) this._writeSnapshotToDisk(snap);
      }
    }
    return { accepted, total: landmark.snapshots.length };
  }

  /**
   * Verify landmark.publisher_signature.
   *
   * Producer (batch.js assembleBatch / assembleBatchFederated) signs
   * `LANDMARK_SIG_PREFIX || JCS(landmark with publisher_signature.sig = "")`
   * using the same key as the tree_head signer (single-sig path) or
   * signers[0] (federated path). Both choices land that key as
   * `trust_anchors[0]`, so this is the canonical verifier anchor.
   *
   * Reuses the configured _signatureVerifier with a synthesized sig-shaped
   * object whose pubkey_id is taken from the anchor (publisher_signature
   * itself stores key_id, not pubkey_id).
   */
  _verifyPublisherSignature(landmark) {
    const ps = landmark.publisher_signature;
    if (!ps || typeof ps !== "object") {
      throw this._err("BAD_LANDMARK_SIG");
    }
    if (typeof ps.alg !== "string" || typeof ps.sig !== "string" || !ps.sig) {
      throw this._err("BAD_LANDMARK_SIG");
    }
    const anchors = landmark.trust_anchors;
    if (!Array.isArray(anchors) || anchors.length === 0) {
      throw this._err("BAD_LANDMARK_SIG");
    }
    const anchor = anchors[0];
    if (
      !anchor ||
      typeof anchor.pubkey_id !== "string" ||
      anchor.alg !== ps.alg
    ) {
      throw this._err("BAD_LANDMARK_SIG");
    }

    // Reconstruct producer's signing input: JCS over a copy with publisher_
    // signature.sig="" AND each snapshot's per-member sig bytes placeholder-d.
    // Stripping per-member sigs is required for M-of-N threshold tolerance —
    // see publisher-signing.js for the full rationale.
    const signingInput = Buffer.concat([
      LANDMARK_SIG_PREFIX,
      jcs(_stripSigsForPublisher(landmark)),
    ]);

    const sigObj = {
      alg: ps.alg,
      sig: ps.sig,
      pubkey_id: anchor.pubkey_id,
    };

    if (!this._signatureVerifier(signingInput, sigObj)) {
      throw this._err("BAD_LANDMARK_SIG");
    }
  }

  /**
   * Strict PQ mode gate (#21 B.6).
   *
   * Refuses landmarks whose publisher_signature OR any snapshot signature
   * uses a classical (non-PQ) algorithm — per [CLASSICAL_ALGS] above. Today
   * that means rejecting Ed25519; SLH-DSA-SHA2-128F (and future PQ algs)
   * pass through.
   *
   * Semantics: every member's partial signature in `snap.signatures[]` must
   * be PQ. The threshold logic itself isn't relaxed — strict mode is a
   * separate gate at landmark intake, before threshold counting starts.
   *
   * Note: this is **Reading A** of the B.6 spec ("strict mode requires all
   * members to use SLH-DSA, no hybrid pair per member"). The alternative
   * Reading B (each member produces both Ed25519+SLH-DSA pair) would
   * require a data-format change adding e.g. `sig_pq` to each member sig;
   * deferred until/if there's a concrete regulatory ask for that shape.
   * @see docs/design/Android_重新定位_设计文档.md §10 v1.3+ B.6
   */
  _assertStrictPqMode(landmark) {
    // Landmark-level: publisher_signature. Per-snap checks happen inside
    // _validateAndStoreSnapshot (called by both ingest's loop and
    // loadFromDisk), so we don't duplicate the snap iteration here.
    const ps = landmark.publisher_signature;
    if (ps && isClassicalAlg(ps.alg)) {
      const e = this._err("STRICT_PQ_MODE_VIOLATION");
      e.violation = "publisher_signature";
      e.alg = ps.alg;
      throw e;
    }
  }

  /**
   * Per-snapshot strict-mode gate — runs from both [ingest] (via
   * [_assertStrictPqMode]) and [loadFromDisk] (so disk-cached snapshots
   * can't sneak Ed25519 sigs past a strict-mode cache).
   *
   * publisher_signature is intentionally NOT checked here — it lives at
   * landmark level (not persisted on disk per snapshot), so the only thing
   * this helper can sanely verify is per-snapshot signature alg(s).
   */
  _assertStrictPqModeForSnapshot(snap, snapshotIndex) {
    if (!snap || typeof snap !== "object") return;
    // Federated path: snap.signatures[] — every member sig must be PQ
    if (Array.isArray(snap.signatures)) {
      for (let j = 0; j < snap.signatures.length; j++) {
        const sig = snap.signatures[j];
        if (sig && isClassicalAlg(sig.alg)) {
          const e = this._err("STRICT_PQ_MODE_VIOLATION");
          e.violation = "snapshot_signature";
          e.snapshotIndex = snapshotIndex;
          e.signatureIndex = j;
          e.alg = sig.alg;
          throw e;
        }
      }
    }
    // Single-signer path: snap.signature
    if (snap.signature && isClassicalAlg(snap.signature.alg)) {
      const e = this._err("STRICT_PQ_MODE_VIOLATION");
      e.violation = "snapshot_signature";
      e.snapshotIndex = snapshotIndex;
      e.alg = snap.signature.alg;
      throw e;
    }
  }

  _validateAndStoreSnapshot(snap) {
    if (!snap || typeof snap !== "object") throw this._err("BAD_TREE_HEAD_SCHEMA");
    // Strict PQ mode applies here too (called from both ingest + loadFromDisk).
    // ingest's _assertStrictPqMode already covers landmark-level fields and
    // delegates here per-snapshot; loadFromDisk goes straight here without an
    // outer landmark wrapper, so the per-snapshot gate must be local.
    if (this._strictPqMode) {
      this._assertStrictPqModeForSnapshot(snap, 0);
    }
    const th = snap.tree_head;
    if (!th || th.schema !== SCHEMA_TREE_HEAD) throw this._err("BAD_TREE_HEAD_SCHEMA");
    if (typeof th.namespace !== "string" || !NAMESPACE_RE.test(th.namespace)) {
      throw this._err("BAD_NAMESPACE");
    }
    if (
      !Number.isInteger(th.tree_size) ||
      th.tree_size < 1 ||
      typeof th.root_hash !== "string" ||
      typeof th.expires_at !== "string" ||
      typeof th.issued_at !== "string" ||
      typeof th.issuer !== "string"
    ) {
      throw this._err("BAD_TREE_HEAD_SCHEMA");
    }

    const canonical = jcs(th);
    const expectedId = encodeHashStr(sha256(canonical));
    if (snap.tree_head_id !== expectedId) {
      const e = this._err("BAD_TREE_HEAD_ID");
      e.expected = expectedId;
      e.actual = snap.tree_head_id;
      throw e;
    }

    const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);
    if (Array.isArray(snap.signatures) && snap.signatures.length > 0) {
      // Federated multi-sig path: count valid sigs against trust_anchors,
      // require ≥ threshold. threshold defaults to signatures.length when
      // omitted (everyone-signs strict mode).
      const threshold = Number.isInteger(snap.threshold)
        ? snap.threshold
        : snap.signatures.length;
      if (threshold < 1) {
        throw this._err("BAD_FEDERATION_THRESHOLD");
      }
      // Track which pubkey_ids have already counted, so a duplicate signature
      // (same key signing twice) doesn't artificially boost the count.
      const seen = new Set();
      let validCount = 0;
      for (const sig of snap.signatures) {
        if (!sig || typeof sig !== "object") continue;
        const pubkeyId = typeof sig.pubkey_id === "string" ? sig.pubkey_id : null;
        if (pubkeyId && seen.has(pubkeyId)) continue;
        if (this._signatureVerifier(signingInput, sig)) {
          if (pubkeyId) seen.add(pubkeyId);
          validCount++;
          if (validCount >= threshold) break;
        }
      }
      if (validCount < threshold) {
        const e = this._err("FEDERATION_THRESHOLD_NOT_MET");
        e.threshold = threshold;
        e.valid = validCount;
        e.signatures = snap.signatures.length;
        throw e;
      }
    } else {
      // Single-signer (classical) path
      const sigOk = this._signatureVerifier(signingInput, snap.signature);
      if (!sigOk) throw this._err("BAD_TREE_HEAD_SIG");
    }

    const existing = this._byNamespace.get(th.namespace);
    if (existing) {
      for (const knownTh of existing.values()) {
        if (knownTh.tree_size === th.tree_size && knownTh.root_hash !== th.root_hash) {
          const e = this._err("MTCA_DOUBLE_SIGNED");
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
    if (nsMap.has(snap.tree_head_id)) return "duplicate";
    nsMap.set(snap.tree_head_id, th);
    return "accepted";
  }

  _err(code) {
    const e = new Error(code);
    e.code = code;
    return e;
  }

  _snapshotFilePath(snap) {
    const nsParts = snap.tree_head.namespace.split("/");
    const dir = path.join(this._persistDir, ...nsParts);
    return path.join(dir, `${encodeIdForFs(snap.tree_head_id)}.json`);
  }

  _writeSnapshotToDisk(snap) {
    const file = this._snapshotFilePath(snap);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snap, null, 2), "utf-8");
  }

  loadFromDisk() {
    if (!this._persistDir) throw this._err("NO_PERSIST_DIR");
    if (!fs.existsSync(this._persistDir)) return { loaded: 0, failed: [] };

    const files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
      }
    }
    walk(this._persistDir);

    let loaded = 0;
    const failed = [];
    for (const file of files) {
      try {
        const snap = JSON.parse(fs.readFileSync(file, "utf-8"));
        const result = this._validateAndStoreSnapshot(snap);
        if (result === "accepted") loaded++;
      } catch (err) {
        failed.push({ path: file, code: err.code || "PARSE_ERROR" });
      }
    }
    return { loaded, failed };
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

module.exports = {
  LandmarkCache,
  alwaysAcceptSignatureVerifier,
  encodeIdForFs,
  CLASSICAL_ALGS,
  isClassicalAlg,
};
