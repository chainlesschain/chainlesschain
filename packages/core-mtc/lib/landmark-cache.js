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

function alwaysAcceptSignatureVerifier() {
  return true;
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
    this._byNamespace = new Map();
    this._persistDir = opts.persistDir || null;
  }

  ingest(landmark) {
    if (!landmark || typeof landmark !== "object") throw this._err("BAD_LANDMARK_SCHEMA");
    if (landmark.schema !== SCHEMA_LANDMARK) throw this._err("BAD_LANDMARK_SCHEMA");
    if (!Array.isArray(landmark.snapshots) || landmark.snapshots.length === 0) {
      throw this._err("BAD_LANDMARK_SCHEMA");
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

    // Reconstruct producer's signing input: JCS over a copy with sig="".
    // Spread is shallow but JCS recurses on the rest, so unchanged sub-trees
    // canonicalize to the same bytes the producer fed into the signer.
    const stripped = {
      ...landmark,
      publisher_signature: { ...ps, sig: "" },
    };
    const signingInput = Buffer.concat([LANDMARK_SIG_PREFIX, jcs(stripped)]);

    const sigObj = {
      alg: ps.alg,
      sig: ps.sig,
      pubkey_id: anchor.pubkey_id,
    };

    if (!this._signatureVerifier(signingInput, sigObj)) {
      throw this._err("BAD_LANDMARK_SIG");
    }
  }

  _validateAndStoreSnapshot(snap) {
    if (!snap || typeof snap !== "object") throw this._err("BAD_TREE_HEAD_SCHEMA");
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

module.exports = { LandmarkCache, alwaysAcceptSignatureVerifier, encodeIdForFs };
