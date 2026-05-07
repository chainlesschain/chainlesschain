/**
 * governance-multisig — M-of-N signature collection for governance-critical
 * community events (proposals / votes / role changes), wrapping
 * core-mtc's federated batch primitive.
 *
 * v1 scope:
 *   - createProposal({communityId, proposalId, payload, members[], threshold})
 *   - addSignature(communityId, proposalId, signerKeys, issuer) — collect
 *     one member's contribution. Renderer / CLI calls this with the
 *     calling user's own DID Ed25519 keys (we never accept other people's
 *     private keys; cross-machine signature gathering is a follow-up
 *     sub-phase that wires this onto the federation gossipsub channel)
 *   - getStatus(communityId, proposalId) — { proposal, threshold,
 *     signaturesCollected: [{did, addedAt}], finalized, landmarkPath? }
 *   - finalize(communityId, proposalId) — when collected >= threshold,
 *     calls a local federated assembler (mirrors core-mtc/lib/batch.js
 *     assembleBatchFederated using tweetnacl, dodging the @noble/curves
 *     hoisting trap), writes landmark.json + flips finalized flag
 *
 * Storage layout under <userData>/governance-mofn/<communityId>/<proposalId>/:
 *   proposal.json
 *   signatures/<signerDID>.json   (one per member contribution)
 *   landmark.json                 (only after finalize)
 *
 * @module governance-multisig
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");
const { logger } = require("../utils/logger.js");

const SCHEMA_PROPOSAL = "governance-multisig-proposal/v1";

// ─────────────────────────────────────────────────────────────────────
// tweetnacl-based MTC signer interface (mirrors channel-event-batch's
// _tweetnaclSigner — kept duplicated so the two modules don't share state).
// ─────────────────────────────────────────────────────────────────────

const MTC_ALG = "Ed25519";

function _jcsForJwk(jwk) {
  const keys = Object.keys(jwk).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + JSON.stringify(jwk[k]),
  );
  return Buffer.from("{" + parts.join(",") + "}", "utf-8");
}

function _makeJwk(publicKeyBuf) {
  return {
    kty: "OKP",
    crv: "Ed25519",
    alg: MTC_ALG,
    x: publicKeyBuf.toString("base64url"),
  };
}

function _pubkeyId(publicKeyBuf) {
  if (!Buffer.isBuffer(publicKeyBuf) || publicKeyBuf.length !== 32) {
    throw new TypeError("_pubkeyId: publicKey must be 32-byte Buffer");
  }
  const jwkBytes = _jcsForJwk(_makeJwk(publicKeyBuf));
  return (
    "sha256:" + crypto.createHash("sha256").update(jwkBytes).digest("base64url")
  );
}

const _tweetnaclSigner = {
  ALG: MTC_ALG,
  signTreeHead(signingInput, keyInfo) {
    if (!Buffer.isBuffer(signingInput)) {
      throw new TypeError("signTreeHead: signingInput must be Buffer");
    }
    if (
      !Buffer.isBuffer(keyInfo.secretKey) ||
      keyInfo.secretKey.length !== 64
    ) {
      throw new TypeError(
        "signTreeHead: secretKey must be 64-byte tweetnacl Ed25519 secret",
      );
    }
    const sig = nacl.sign.detached(
      new Uint8Array(signingInput),
      new Uint8Array(keyInfo.secretKey),
    );
    return {
      alg: MTC_ALG,
      issuer: keyInfo.issuer,
      sig: Buffer.from(sig).toString("base64url"),
      pubkey_id: _pubkeyId(keyInfo.publicKey),
    };
  },
  trustAnchorEntry(publicKey, issuer) {
    return {
      issuer,
      alg: MTC_ALG,
      pubkey_id: _pubkeyId(publicKey),
      pubkey_jwk: _makeJwk(publicKey),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Filesystem helpers
// ─────────────────────────────────────────────────────────────────────

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function safeId(id, fieldName) {
  if (typeof id !== "string" || !id) {
    throw new TypeError(fieldName + " required");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(fieldName + " unsafe: " + id);
  }
  return id;
}

function safeDID(did) {
  if (typeof did !== "string" || !did) {
    throw new TypeError("DID required");
  }
  // Accept did:method:identifier shape; sanitize for filesystem (replace ':' → '_')
  if (!/^did:[A-Za-z0-9]+:[A-Za-z0-9_-]+$/.test(did)) {
    throw new Error("DID format unsafe: " + did);
  }
  return did;
}

function didToFsName(did) {
  return did.replace(/:/g, "_");
}

function proposalDir(rootDir, communityId, proposalId) {
  return path.join(
    rootDir,
    safeId(communityId, "communityId"),
    safeId(proposalId, "proposalId"),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Federated batch assembly (LOCAL — bypasses core-mtc index to avoid the
// @noble/curves hoisting trap, mirrors core-mtc/lib/batch.js behavior)
// ─────────────────────────────────────────────────────────────────────

let _mtcPrimitivesCache = null;
function loadMtcPrimitives() {
  if (_mtcPrimitivesCache) {
    return _mtcPrimitivesCache;
  }
  const constants = require("@chainlesschain/core-mtc/constants");
  const {
    sha256,
    leafHash,
    encodeHashStr,
  } = require("@chainlesschain/core-mtc/hash");
  const { jcs } = require("@chainlesschain/core-mtc/jcs");
  const { MerkleTree } = require("@chainlesschain/core-mtc/merkle");
  _mtcPrimitivesCache = {
    constants,
    sha256,
    leafHash,
    encodeHashStr,
    jcs,
    MerkleTree,
  };
  return _mtcPrimitivesCache;
}

function _assembleBatchFederatedLocal(rawLeaves, signers, meta) {
  const {
    constants: {
      SCHEMA_TREE_HEAD,
      SCHEMA_LANDMARK,
      SCHEMA_ENVELOPE,
      TREE_HEAD_SIG_PREFIX,
      LANDMARK_SIG_PREFIX,
    },
    sha256,
    leafHash,
    encodeHashStr,
    jcs,
    MerkleTree,
  } = loadMtcPrimitives();

  if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
    throw new RangeError("rawLeaves must be a non-empty array");
  }
  if (!Array.isArray(signers) || signers.length === 0) {
    throw new RangeError("signers must be a non-empty array");
  }
  const threshold = Number.isInteger(meta.threshold)
    ? meta.threshold
    : signers.length;
  if (threshold < 1 || threshold > signers.length) {
    throw new RangeError(
      "threshold must be in [1, " +
        signers.length +
        "] (got " +
        threshold +
        ")",
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

  const signatures = signers.map((s) =>
    _tweetnaclSigner.signTreeHead(signingInput, {
      secretKey: s.secretKey,
      publicKey: s.publicKey,
      issuer: s.issuer,
    }),
  );
  const trustAnchors = signers.map((s) =>
    _tweetnaclSigner.trustAnchorEntry(s.publicKey, s.issuer),
  );

  const publisherSigner = signers[0];
  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: meta.namespace.split("/").slice(0, -1).join("/"),
    snapshots: [
      {
        tree_head: treeHead,
        tree_head_id: treeHeadId,
        signatures, // M-of-N: array (vs single signature in non-federated path)
        threshold,
      },
    ],
    trust_anchors: trustAnchors,
    published_at: issuedAt,
    publisher_signature: {
      alg: MTC_ALG,
      key_id: meta.issuer + "#federation",
      sig: "",
    },
  };
  // Federated path: sign with first signer's key (deterministic). The
  // snapshot already carries M-of-N signatures[]; publisher_signature
  // identifies which member packaged + published the landmark.
  const landmarkSigInput = Buffer.concat([LANDMARK_SIG_PREFIX, jcs(landmark)]);
  const publisherSig = _tweetnaclSigner.signTreeHead(landmarkSigInput, {
    secretKey: publisherSigner.secretKey,
    publicKey: publisherSigner.publicKey,
    issuer: publisherSigner.issuer,
  });
  landmark.publisher_signature.sig = publisherSig.sig;

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

  return { landmark, envelopes, treeHeadId, threshold };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

class GovernanceMultiSig {
  /**
   * @param {object} opts
   * @param {string} opts.rootDir - <userData>/governance-mofn
   */
  constructor(opts = {}) {
    if (!opts.rootDir) {
      throw new Error("GovernanceMultiSig: rootDir required");
    }
    this._rootDir = opts.rootDir;
  }

  initialize() {
    ensureDir(this._rootDir);
    logger.info("[GovernanceMultiSig] initialized rootDir=" + this._rootDir);
  }

  /**
   * Create a multi-sig proposal record.
   * @param {object} args
   * @param {string} args.communityId
   * @param {string} args.proposalId
   * @param {object} args.payload - JSON-serializable proposal body
   * @param {string[]} args.members - DID list of expected signatories
   * @param {number} args.threshold - M in M-of-N (must be 1..members.length)
   * @returns {object} the created proposal record
   */
  createProposal({ communityId, proposalId, payload, members, threshold }) {
    safeId(communityId, "communityId");
    safeId(proposalId, "proposalId");
    if (!payload || typeof payload !== "object") {
      throw new TypeError("payload required (object)");
    }
    if (!Array.isArray(members) || members.length === 0) {
      throw new TypeError("members must be non-empty DID array");
    }
    members.forEach((m) => safeDID(m));
    if (
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      threshold > members.length
    ) {
      throw new RangeError(
        "threshold must be integer in [1, " + members.length + "]",
      );
    }
    if (new Set(members).size !== members.length) {
      throw new Error("members list contains duplicates");
    }

    const dir = proposalDir(this._rootDir, communityId, proposalId);
    if (fs.existsSync(dir)) {
      throw new Error("proposal already exists: " + proposalId);
    }
    ensureDir(dir);
    ensureDir(path.join(dir, "signatures"));

    const proposal = {
      schema: SCHEMA_PROPOSAL,
      communityId,
      proposalId,
      payload,
      members,
      threshold,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(dir, "proposal.json"),
      JSON.stringify(proposal, null, 2),
      "utf-8",
    );
    logger.info(
      "[GovernanceMultiSig] proposal created: " +
        proposalId +
        " (M=" +
        threshold +
        " of N=" +
        members.length +
        ")",
    );
    return proposal;
  }

  /**
   * Record a member's signature for the proposal. The caller must be the
   * member (we validate the DID against the proposal members list and
   * derive the DID from the public key to make sure pubkey + DID match).
   *
   * @param {string} communityId
   * @param {string} proposalId
   * @param {object} signerKeys - { secretKey: 64B Buffer, publicKey: 32B Buffer, did }
   * @returns {object} { collected, threshold, members, complete }
   */
  addSignature(communityId, proposalId, signerKeys) {
    const proposal = this._readProposal(communityId, proposalId);
    if (proposal._finalized) {
      throw new Error("proposal already finalized: " + proposalId);
    }
    if (
      !signerKeys ||
      !Buffer.isBuffer(signerKeys.secretKey) ||
      !Buffer.isBuffer(signerKeys.publicKey)
    ) {
      throw new TypeError(
        "signerKeys must include 64B secretKey + 32B publicKey Buffers",
      );
    }
    if (
      signerKeys.secretKey.length !== 64 ||
      signerKeys.publicKey.length !== 32
    ) {
      throw new TypeError(
        "signerKeys: nacl Ed25519 secretKey/publicKey shape required",
      );
    }
    const did = safeDID(signerKeys.did);
    if (!proposal.members.includes(did)) {
      throw new Error("DID is not a member: " + did);
    }
    // Verify pubkey matches DID — refuse "I'm DID X but my pubkey is Y" mismatch.
    const expectedDID = _computeDIDFromPubkey(signerKeys.publicKey);
    if (expectedDID !== did) {
      throw new Error(
        "DID/pubkey mismatch: claimed " +
          did +
          " but pubkey hashes to " +
          expectedDID,
      );
    }

    const dir = proposalDir(this._rootDir, communityId, proposalId);
    const sigFile = path.join(dir, "signatures", didToFsName(did) + ".json");
    if (fs.existsSync(sigFile)) {
      // Idempotent — same DID adding twice is a no-op
      return this._summarize(proposal, communityId, proposalId);
    }

    const record = {
      schema: "governance-multisig-signature/v1",
      did,
      // We persist key MATERIAL only because v1 finalize runs locally on
      // the same machine (single-host demo). For cross-machine M-of-N this
      // would store just the (proposal, signerDID, treeHeadSig) and the
      // assembler would NOT need the secret key at finalize time. v2.
      secretKey: Buffer.from(signerKeys.secretKey).toString("base64"),
      publicKey: Buffer.from(signerKeys.publicKey).toString("base64"),
      addedAt: new Date().toISOString(),
    };
    fs.writeFileSync(sigFile, JSON.stringify(record, null, 2), "utf-8");
    logger.info(
      "[GovernanceMultiSig] signature added: " + proposalId + " by " + did,
    );
    return this._summarize(proposal, communityId, proposalId);
  }

  /**
   * @param {string} communityId
   * @param {string} proposalId
   * @returns {object} { proposal, threshold, signaturesCollected, complete, finalized }
   */
  getStatus(communityId, proposalId) {
    const proposal = this._readProposal(communityId, proposalId);
    return this._summarize(proposal, communityId, proposalId);
  }

  /**
   * Finalize: when collected ≥ threshold, run assembleBatchFederated with
   * accumulated signers and write the landmark.json. Idempotent on
   * already-finalized proposals.
   *
   * @returns {object} { ok, treeHeadId, threshold, signers: [did], landmarkPath }
   */
  finalize(communityId, proposalId) {
    const proposal = this._readProposal(communityId, proposalId);
    if (proposal._finalized) {
      const dir = proposalDir(this._rootDir, communityId, proposalId);
      return {
        ok: true,
        alreadyFinalized: true,
        treeHeadId: proposal._treeHeadId,
        threshold: proposal.threshold,
        signers: proposal._signers || [],
        landmarkPath: path.join(dir, "landmark.json"),
      };
    }

    const sigs = this._loadSignatures(communityId, proposalId);
    if (sigs.length < proposal.threshold) {
      throw new Error(
        "insufficient signatures: have " +
          sigs.length +
          ", need " +
          proposal.threshold,
      );
    }

    const signers = sigs.slice(0, proposal.threshold).map((s) => ({
      secretKey: Buffer.from(s.secretKey, "base64"),
      publicKey: Buffer.from(s.publicKey, "base64"),
      issuer: "did-bound:" + s.did,
    }));

    const namespace = "mtc/v1/governance/" + communityId + "/" + proposalId;
    const issuer = "governance:" + communityId;

    const { landmark, treeHeadId } = _assembleBatchFederatedLocal(
      [
        {
          kind: "governance-proposal",
          communityId,
          proposalId,
          payload: proposal.payload,
        },
      ],
      signers,
      { namespace, issuer, threshold: proposal.threshold },
    );

    const dir = proposalDir(this._rootDir, communityId, proposalId);
    fs.writeFileSync(
      path.join(dir, "landmark.json"),
      JSON.stringify(landmark, null, 2),
      "utf-8",
    );

    // Mark proposal finalized
    const finalProposal = {
      ...proposal,
      _finalized: true,
      _treeHeadId: treeHeadId,
      _signers: signers.map((s) => s.issuer.replace(/^did-bound:/, "")),
      _finalizedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(dir, "proposal.json"),
      JSON.stringify(finalProposal, null, 2),
      "utf-8",
    );

    logger.info(
      "[GovernanceMultiSig] finalized: " +
        proposalId +
        " (" +
        proposal.threshold +
        " sigs, treeHeadId=" +
        treeHeadId +
        ")",
    );
    return {
      ok: true,
      treeHeadId,
      threshold: proposal.threshold,
      signers: finalProposal._signers,
      landmarkPath: path.join(dir, "landmark.json"),
    };
  }

  /**
   * List all proposals for a community.
   * @returns {Array<{proposalId, threshold, members, finalized, collected}>}
   */
  listProposals(communityId) {
    safeId(communityId, "communityId");
    const dir = path.join(this._rootDir, communityId);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        try {
          const proposal = this._readProposal(communityId, d.name);
          const collected = this._loadSignatures(communityId, d.name).length;
          return {
            proposalId: d.name,
            threshold: proposal.threshold,
            members: proposal.members,
            finalized: !!proposal._finalized,
            collected,
            createdAt: proposal.createdAt,
          };
        } catch (_err) {
          return null;
        }
      })
      .filter(Boolean);
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  _readProposal(communityId, proposalId) {
    const file = path.join(
      proposalDir(this._rootDir, communityId, proposalId),
      "proposal.json",
    );
    if (!fs.existsSync(file)) {
      throw new Error("proposal not found: " + proposalId);
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  _loadSignatures(communityId, proposalId) {
    const dir = path.join(
      proposalDir(this._rootDir, communityId, proposalId),
      "signatures",
    );
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf-8")));
  }

  _summarize(proposal, communityId, proposalId) {
    const sigs = this._loadSignatures(communityId, proposalId);
    return {
      proposal,
      threshold: proposal.threshold,
      members: proposal.members,
      signaturesCollected: sigs.map((s) => ({
        did: s.did,
        addedAt: s.addedAt,
      })),
      collected: sigs.length,
      complete: sigs.length >= proposal.threshold,
      finalized: !!proposal._finalized,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────

function _computeDIDFromPubkey(publicKeyBuf) {
  // Mirror of did-signer.computeDIDFromPublicKey — kept duplicated to
  // avoid a circular dep with did/did-signer.js
  const buf = Buffer.isBuffer(publicKeyBuf)
    ? publicKeyBuf
    : Buffer.from(publicKeyBuf);
  const hash = crypto.createHash("sha256").update(buf).digest();
  const identifier = hash.slice(0, 20).toString("hex");
  return "did:chainlesschain:" + identifier;
}

module.exports = {
  GovernanceMultiSig,
  SCHEMA_PROPOSAL,
};
