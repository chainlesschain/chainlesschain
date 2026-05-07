/**
 * channel-event-batch — Merkle-batch persistence for community channel events.
 *
 * B4-merkle v1: builds on Phase B v1 dual-track sync + B4a per-message
 * Ed25519 signatures. This module batches signed channel_message events
 * into MTC envelopes (using core-mtc's assembleBatch), persisted on disk
 * for offline-verifiable audit history. v1 is local-only — batches are
 * NOT broadcast over the federation; that's a follow-up sub-phase.
 *
 * Filesystem layout (per-community under <userData>/channel-mtc/<communityId>/):
 *   staging/<message-id>.json       one signed channel_message subset per file
 *   batches/<batch-id>/             one closed batch
 *     manifest.json                   schema=channel-batch-manifest/v1
 *     landmark.json                   MTC landmark with tree_head + signatures
 *     envelope-<message-id>.json     per-event inclusion proof
 *
 * Trigger model: callers (community-ipc dual-publish path) call enqueueEvent
 * after each successful send. closeBatch() runs on either:
 *   - threshold (default 100 events queued for the same community)
 *   - timer (default every 1h)
 *   - explicit force (test / shutdown / "close now" admin action)
 *
 * Verification: any node holding the batch dir can verify a message's
 * inclusion via findEnvelope(messageId) → loadEnvelope() + landmark — no
 * network access required.
 *
 * Issuer keys: reuses the user's DID Ed25519 sign key from currentIdentity
 * (see did-signer's identity contract). No separate issuer key file.
 *
 * @module channel-event-batch
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");
const { logger } = require("../utils/logger.js");

const SCHEMA_MANIFEST = "channel-batch-manifest/v1";

// ─────────────────────────────────────────────────────────────────────
// tweetnacl-based MTC signer — works around the @noble/curves version
// mismatch trap. core-mtc's bundled Ed25519 signer requires
// @noble/curves@^1.9.7 with the './ed25519' subpath export, but
// desktop-app-vue's standalone node_modules has v2.2.0 which removed
// that subpath. tweetnacl is already a desktop-app-vue dep (used by
// did-signer / did-manager) so we ship a parallel signer here matching
// core-mtc's {ALG, signTreeHead, trustAnchorEntry} interface.
//
// pubkey_id / JWK shape mirror core-mtc/lib/signers/ed25519.js so the
// landmarks we produce remain interop-compatible with `cc mtc verify`
// and federation tooling that expects Ed25519 anchors.
// ─────────────────────────────────────────────────────────────────────

const MTC_ALG = "Ed25519";

function _jcsBytesForJwk(jwk) {
  // RFC 8785 minimal — sorted keys, no whitespace. Sufficient for the
  // 4-key flat JWK shape we produce.
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
  const jwkBytes = _jcsBytesForJwk(_makeJwk(publicKeyBuf));
  return (
    "sha256:" + crypto.createHash("sha256").update(jwkBytes).digest("base64url")
  );
}

const _tweetnaclSigner = {
  ALG: MTC_ALG,

  // assembleBatch's keys arg must include {secretKey, publicKey} as Buffers.
  // tweetnacl secretKey is 64 bytes (seed||public), nacl.sign.detached accepts
  // it directly. core-mtc passes secretKey through unchanged to this fn.
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
const NAMESPACE_PREFIX = "mtc/v1/channel";
const DEFAULT_THRESHOLD = 100;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h

// Load core-mtc PRIMITIVES via subpath exports — this dodges
// `@chainlesschain/core-mtc/index.js`'s top-level require of
// `signers/ed25519.js`, which transitively imports `@noble/curves/ed25519`
// and explodes against desktop-app-vue's @noble/curves@2.2.0 (subpath
// removed in v2). Using `/hash`, `/jcs`, `/merkle`, `/constants` directly
// keeps us off the @noble/curves load path entirely.
let _mtcPrimitivesCache = null;
function loadMtcPrimitives() {
  if (_mtcPrimitivesCache) {
    return _mtcPrimitivesCache;
  }
  // eslint-disable-next-line global-require
  const constants = require("@chainlesschain/core-mtc/constants");
  // eslint-disable-next-line global-require
  const {
    sha256,
    leafHash,
    encodeHashStr,
  } = require("@chainlesschain/core-mtc/hash");
  // eslint-disable-next-line global-require
  const { jcs } = require("@chainlesschain/core-mtc/jcs");
  // eslint-disable-next-line global-require
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

/**
 * Local assembleBatch using core-mtc primitives + our tweetnacl signer.
 * Mirrors core-mtc/lib/batch.js exactly EXCEPT the signer is injected
 * (see _tweetnaclSigner above for why we can't use core-mtc's bundled one).
 *
 * Output landmarks/envelopes are wire-compatible with core-mtc verifier.
 */
function _assembleBatchLocal(rawLeaves, keys, meta) {
  const { constants, sha256, leafHash, encodeHashStr, jcs, MerkleTree } =
    loadMtcPrimitives();
  const {
    SCHEMA_TREE_HEAD,
    SCHEMA_LANDMARK,
    SCHEMA_ENVELOPE,
    TREE_HEAD_SIG_PREFIX,
  } = constants;

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
  const signature = _tweetnaclSigner.signTreeHead(signingInput, {
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    issuer: meta.issuer,
  });

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: meta.namespace.split("/").slice(0, -1).join("/"),
    snapshots: [{ tree_head: treeHead, tree_head_id: treeHeadId, signature }],
    trust_anchors: [
      _tweetnaclSigner.trustAnchorEntry(keys.publicKey, meta.issuer),
    ],
    published_at: issuedAt,
    publisher_signature: {
      alg: _tweetnaclSigner.ALG,
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

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function communityRoot(rootDir, communityId) {
  if (!communityId || typeof communityId !== "string") {
    throw new TypeError("communityId required (non-empty string)");
  }
  // sanitize — communityId comes from user-controlled DB but we need it
  // safe as a filesystem path component
  if (!/^[A-Za-z0-9_.-]+$/.test(communityId)) {
    throw new Error(
      "communityId must be alphanumeric+_.- (was: " + communityId + ")",
    );
  }
  return path.join(rootDir, communityId);
}

function stagingPath(rootDir, communityId, messageId) {
  if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
    throw new Error("messageId unsafe for filesystem: " + messageId);
  }
  return path.join(
    communityRoot(rootDir, communityId),
    "staging",
    messageId + ".json",
  );
}

function nextBatchId(communityDir) {
  const batchesDir = path.join(communityDir, "batches");
  ensureDir(batchesDir);
  const existing = fs
    .readdirSync(batchesDir)
    .filter((n) => /^\d+$/.test(n))
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);
  const next = existing.length === 0 ? 1 : existing[existing.length - 1] + 1;
  return String(next).padStart(6, "0");
}

class ChannelEventBatcher {
  /**
   * @param {object} opts
   * @param {string} opts.rootDir - <userData>/channel-mtc directory
   * @param {() => object} opts.getCurrentIdentity - returns DIDManager identity
   *   row (must include public_key_sign + private_key_ref)
   * @param {number} [opts.threshold=100] - close batch after this many events
   * @param {number} [opts.intervalMs=3600000] - close batch every N ms
   * @param {boolean} [opts.autoTimer=false] - start timer on initialize() (off in tests)
   */
  constructor(opts = {}) {
    if (!opts.rootDir) {
      throw new Error("ChannelEventBatcher: rootDir required");
    }
    if (typeof opts.getCurrentIdentity !== "function") {
      throw new Error("ChannelEventBatcher: getCurrentIdentity required");
    }
    this._rootDir = opts.rootDir;
    this._getCurrentIdentity = opts.getCurrentIdentity;
    this._threshold = opts.threshold || DEFAULT_THRESHOLD;
    this._intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
    this._autoTimer = !!opts.autoTimer;
    this._timer = null;
    this._initialized = false;
    // B4-cross v1: callback fires on every successful closeBatch — used by
    // ChannelEnvelopeDistribution to publish the new landmark to the
    // federation gossipsub channel.
    this._onBatchClosedHandlers = [];
  }

  /**
   * Register a callback fired after every successful closeBatch().
   * Handler signature: ({ communityId, batchId, treeHeadId, namespace,
   *   batchDir, landmark, manifest }) => void
   * Errors thrown by handler are swallowed (each handler is independent).
   */
  onBatchClosed(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("onBatchClosed: handler must be function");
    }
    this._onBatchClosedHandlers.push(handler);
    return () => {
      const idx = this._onBatchClosedHandlers.indexOf(handler);
      if (idx >= 0) {
        this._onBatchClosedHandlers.splice(idx, 1);
      }
    };
  }

  initialize() {
    if (this._initialized) {
      return;
    }
    ensureDir(this._rootDir);
    if (this._autoTimer) {
      this._timer = setInterval(() => {
        this.closeAllPending().catch((err) =>
          logger.warn("[ChannelEventBatcher] auto-close failed:", err.message),
        );
      }, this._intervalMs);
      // Don't keep the event loop alive just for batch closing
      if (typeof this._timer.unref === "function") {
        this._timer.unref();
      }
    }
    this._initialized = true;
    logger.info(
      "[ChannelEventBatcher] initialized rootDir=" +
        this._rootDir +
        " threshold=" +
        this._threshold,
    );
  }

  close() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._initialized = false;
  }

  /**
   * Append a signed channel_message to the community's staging directory.
   * Idempotent on (communityId, messageId).
   *
   * @param {string} communityId
   * @param {object} signedMessage - the channel_message row, must already
   *   include sender_pubkey + signature (B4a output) so the staging file
   *   itself is verifiable
   * @returns {{queued: boolean, stagedCount: number, batchClosed?: object}}
   */
  enqueueEvent(communityId, signedMessage) {
    if (!signedMessage || typeof signedMessage !== "object") {
      throw new TypeError("enqueueEvent: signedMessage required");
    }
    if (!signedMessage.id) {
      throw new Error("enqueueEvent: signedMessage.id required");
    }
    // Don't enqueue unsigned messages — they have no place in an
    // audit-grade batch (defeats the whole point)
    if (!signedMessage.sender_pubkey || !signedMessage.signature) {
      logger.warn(
        "[ChannelEventBatcher] skipping unsigned message " +
          signedMessage.id +
          " (legacy compat — won't be batched)",
      );
      return { queued: false, stagedCount: this.countStaged(communityId) };
    }
    const root = communityRoot(this._rootDir, communityId);
    ensureDir(path.join(root, "staging"));
    const stagedFile = stagingPath(
      this._rootDir,
      communityId,
      signedMessage.id,
    );
    if (fs.existsSync(stagedFile)) {
      // already staged — idempotent no-op
      return { queued: true, stagedCount: this.countStaged(communityId) };
    }
    fs.writeFileSync(
      stagedFile,
      JSON.stringify(signedMessage, null, 2),
      "utf-8",
    );
    const stagedCount = this.countStaged(communityId);
    let batchClosed;
    if (stagedCount >= this._threshold) {
      try {
        batchClosed = this.closeBatch(communityId);
      } catch (err) {
        logger.warn(
          "[ChannelEventBatcher] threshold close failed (will retry on next event):",
          err.message,
        );
      }
    }
    return { queued: true, stagedCount, batchClosed };
  }

  countStaged(communityId) {
    const dir = path.join(communityRoot(this._rootDir, communityId), "staging");
    if (!fs.existsSync(dir)) {
      return 0;
    }
    return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).length;
  }

  /**
   * Close the current pending staging set into a new batch directory.
   * Atomic-ish: writes to a tmp dir then renames, so a crash mid-write
   * leaves the previous staging files intact.
   *
   * @param {string} communityId
   * @returns {{ skipped:true, reason:string } |
   *           { skipped:false, batchId, namespace, treeHeadId, treeSize, batchDir }}
   */
  closeBatch(communityId) {
    const root = communityRoot(this._rootDir, communityId);
    ensureDir(root);
    const stagingFiles = fs.existsSync(path.join(root, "staging"))
      ? fs
          .readdirSync(path.join(root, "staging"))
          .filter((n) => n.endsWith(".json"))
          .map((n) => path.join(root, "staging", n))
      : [];

    if (stagingFiles.length === 0) {
      return { skipped: true, reason: "no staged events" };
    }

    const events = [];
    const malformed = [];
    for (const file of stagingFiles) {
      try {
        const record = JSON.parse(fs.readFileSync(file, "utf-8"));
        events.push({ file, record });
      } catch (err) {
        malformed.push({ file, error: err.message });
      }
    }
    if (events.length === 0) {
      return {
        skipped: true,
        reason: "all staged events malformed",
        malformed,
      };
    }

    // Build raw leaves — use the channel_message's signature as the leaf
    // payload anchor. This means the inclusion proof simultaneously proves
    // (a) the message was queued for this batch and (b) its B4a signature
    // existed at queueing time.
    const rawLeaves = events.map(({ record }) => ({
      kind: "channel-message",
      message_id: record.id,
      channel_id: record.channel_id,
      sender_did: record.sender_did,
      sender_pubkey: record.sender_pubkey,
      signature: record.signature,
      created_at: record.created_at,
    }));

    const identity = this._getCurrentIdentity();
    if (!identity || !identity.public_key_sign || !identity.private_key_ref) {
      throw new Error(
        "closeBatch: current identity missing keys (cannot sign tree-head)",
      );
    }
    const refRaw = JSON.parse(identity.private_key_ref);
    if (!refRaw.sign) {
      throw new Error("closeBatch: identity.private_key_ref.sign missing");
    }
    const secretKey = Buffer.from(naclUtil.decodeBase64(refRaw.sign));
    const publicKey = Buffer.from(
      naclUtil.decodeBase64(identity.public_key_sign),
    );
    if (publicKey.length !== 32 || secretKey.length !== 64) {
      throw new Error(
        "closeBatch: nacl Ed25519 key shape unexpected (pub=" +
          publicKey.length +
          " sec=" +
          secretKey.length +
          ")",
      );
    }

    const batchId = nextBatchId(root);
    const namespace = `${NAMESPACE_PREFIX}/${communityId}/${batchId}`;
    const issuer = `did-bound:${identity.did || "unknown"}`;

    // Use _assembleBatchLocal (core-mtc primitives + tweetnacl signer) to
    // dodge the @noble/curves hoisting trap. Output is wire-compatible with
    // core-mtc's verifier.
    const { landmark, envelopes, treeHeadId } = _assembleBatchLocal(
      rawLeaves,
      { secretKey, publicKey },
      { namespace, issuer },
    );

    // Atomic write — stage to tmp, then rename
    const finalDir = path.join(root, "batches", batchId);
    if (fs.existsSync(finalDir)) {
      fs.rmSync(finalDir, { recursive: true, force: true });
    }
    const tmpDir = path.join(root, "batches", "." + batchId + ".tmp");
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "landmark.json"),
      JSON.stringify(landmark, null, 2),
      "utf-8",
    );
    for (let i = 0; i < envelopes.length; i++) {
      fs.writeFileSync(
        path.join(tmpDir, "envelope-" + events[i].record.id + ".json"),
        JSON.stringify(envelopes[i], null, 2),
        "utf-8",
      );
    }

    const manifest = {
      schema: SCHEMA_MANIFEST,
      batch_id: batchId,
      community_id: communityId,
      namespace,
      issuer,
      tree_head_id: treeHeadId,
      tree_size: events.length,
      closed_at: new Date().toISOString(),
      message_ids: events.map((e) => e.record.id),
      envelope_files: events.map((e) => "envelope-" + e.record.id + ".json"),
      malformed_skipped: malformed,
    };
    fs.writeFileSync(
      path.join(tmpDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    fs.renameSync(tmpDir, finalDir);

    // Remove staging files only after successful rename
    for (const e of events) {
      try {
        fs.unlinkSync(e.file);
      } catch (_err) {
        /* concurrent removal — non-fatal */
      }
    }

    logger.info(
      "[ChannelEventBatcher] closed batch " +
        batchId +
        " for " +
        communityId +
        " (" +
        events.length +
        " events, treeHeadId=" +
        treeHeadId +
        ")",
    );

    const result = {
      skipped: false,
      batchId,
      namespace,
      treeHeadId,
      treeSize: events.length,
      batchDir: finalDir,
      malformed,
    };

    // B4-cross v1: notify subscribers (e.g. distribution publisher) so they
    // can broadcast the landmark to the federation. Each handler is
    // independent — exceptions don't break subsequent handlers nor the
    // closeBatch return value.
    if (this._onBatchClosedHandlers.length > 0) {
      const event = {
        ...result,
        communityId,
        landmark,
        manifest,
      };
      for (const h of this._onBatchClosedHandlers) {
        try {
          h(event);
        } catch (handlerErr) {
          logger.warn(
            "[ChannelEventBatcher] onBatchClosed handler threw:",
            handlerErr.message,
          );
        }
      }
    }

    return result;
  }

  /**
   * Close every community that has pending staged events. Used by the
   * timer + at app shutdown to ensure no events linger in staging.
   */
  async closeAllPending() {
    const results = [];
    if (!fs.existsSync(this._rootDir)) {
      return results;
    }
    const communities = fs
      .readdirSync(this._rootDir)
      .filter((n) => fs.statSync(path.join(this._rootDir, n)).isDirectory());
    for (const cid of communities) {
      try {
        const result = this.closeBatch(cid);
        results.push({ communityId: cid, ...result });
      } catch (err) {
        results.push({ communityId: cid, error: err.message });
      }
    }
    return results;
  }

  /**
   * Find which closed batch contains a given message id.
   * Returns staging:true when message is still in staging (not yet closed).
   * Returns found:false when message is unknown to this batcher.
   *
   * @param {string} communityId
   * @param {string} messageId
   * @returns {{ found: false } |
   *           { found: true, staging: true, file: string } |
   *           { found: true, batchId: string, treeHeadId: string,
   *              namespace: string, envelopePath: string, leafIndex: number }}
   */
  findEnvelope(communityId, messageId) {
    const root = communityRoot(this._rootDir, communityId);
    if (!fs.existsSync(root)) {
      return { found: false };
    }

    const stagedFile = stagingPath(this._rootDir, communityId, messageId);
    if (fs.existsSync(stagedFile)) {
      return { found: true, staging: true, file: stagedFile };
    }

    // 1. Local closed batches (we authored these)
    const batchesDir = path.join(root, "batches");
    if (fs.existsSync(batchesDir)) {
      const batchIds = fs
        .readdirSync(batchesDir)
        .filter((n) => /^\d+$/.test(n))
        .sort()
        .reverse(); // most recent first

      for (const batchId of batchIds) {
        const manifestPath = path.join(batchesDir, batchId, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
          continue;
        }
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const leafIndex = (manifest.message_ids || []).indexOf(messageId);
          if (leafIndex < 0) {
            continue;
          }
          const envelopePath = path.join(
            batchesDir,
            batchId,
            "envelope-" + messageId + ".json",
          );
          if (!fs.existsSync(envelopePath)) {
            logger.warn(
              "[ChannelEventBatcher] manifest references missing envelope " +
                envelopePath,
            );
            continue;
          }
          return {
            found: true,
            origin: "local",
            batchId,
            treeHeadId: manifest.tree_head_id,
            namespace: manifest.namespace,
            envelopePath,
            leafIndex,
          };
        } catch (err) {
          logger.warn(
            "[ChannelEventBatcher] manifest parse failed at " +
              manifestPath +
              ": " +
              err.message,
          );
        }
      }
    }

    // 2. B4-cross v1: remote envelope cache (fetched from peer in response
    // to a verify request). Indexed by messageId.json — landmark lookup is
    // separate (see findRemoteLandmark).
    const remoteEnv = path.join(root, "remote-envelopes", messageId + ".json");
    if (fs.existsSync(remoteEnv)) {
      try {
        const env = JSON.parse(fs.readFileSync(remoteEnv, "utf-8"));
        return {
          found: true,
          origin: "remote",
          envelopePath: remoteEnv,
          treeHeadId: env.tree_head_id,
          namespace: env.namespace,
          // leafIndex sourced from the envelope itself
          leafIndex:
            (env.inclusion_proof && env.inclusion_proof.leaf_index) >= 0
              ? env.inclusion_proof.leaf_index
              : -1,
        };
      } catch (err) {
        logger.warn(
          "[ChannelEventBatcher] remote envelope corrupted at " +
            remoteEnv +
            ": " +
            err.message,
        );
      }
    }

    return { found: false };
  }

  /**
   * B4-cross v1: cache a landmark received from another federation member
   * via gossipsub. Indexed by treeHeadId so we can look it up when an
   * envelope referencing that tree-head arrives later.
   *
   * @param {string} communityId
   * @param {string} treeHeadId
   * @param {object} landmark - the MTC landmark JSON from the wire
   * @returns {{ stored: boolean, path: string, alreadyExists?: boolean }}
   */
  storeRemoteLandmark(communityId, treeHeadId, landmark) {
    if (!treeHeadId || typeof treeHeadId !== "string") {
      throw new TypeError("storeRemoteLandmark: treeHeadId required");
    }
    if (!landmark || typeof landmark !== "object") {
      throw new TypeError("storeRemoteLandmark: landmark required");
    }
    // Filesystem safety on treeHeadId — it's "sha256:<base64url>" from
    // core-mtc; replace ':' with '__' to avoid Windows path issues.
    const safeName = treeHeadId.replace(/[:/\\]/g, "_");
    const root = communityRoot(this._rootDir, communityId);
    const dir = path.join(root, "remote-landmarks");
    ensureDir(dir);
    const target = path.join(dir, safeName + ".json");
    if (fs.existsSync(target)) {
      return { stored: true, path: target, alreadyExists: true };
    }
    fs.writeFileSync(target, JSON.stringify(landmark, null, 2), "utf-8");
    return { stored: true, path: target };
  }

  /**
   * B4-cross v1: look up a previously-cached remote landmark by treeHeadId.
   * @returns {object|null} parsed landmark or null
   */
  findRemoteLandmark(communityId, treeHeadId) {
    if (!treeHeadId) {
      return null;
    }
    const safeName = treeHeadId.replace(/[:/\\]/g, "_");
    const target = path.join(
      communityRoot(this._rootDir, communityId),
      "remote-landmarks",
      safeName + ".json",
    );
    if (!fs.existsSync(target)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(target, "utf-8"));
    } catch (err) {
      logger.warn(
        "[ChannelEventBatcher] remote landmark corrupted at " +
          target +
          ": " +
          err.message,
      );
      return null;
    }
  }

  /**
   * B4-cross v1: cache an envelope received from another federation member
   * in response to a request. Indexed by messageId so findEnvelope picks
   * it up automatically.
   *
   * @param {string} communityId
   * @param {string} messageId
   * @param {object} envelope - the MTC envelope JSON from the wire
   * @returns {{ stored: boolean, path: string, alreadyExists?: boolean }}
   */
  storeRemoteEnvelope(communityId, messageId, envelope) {
    if (!messageId || !/^[A-Za-z0-9_-]+$/.test(messageId)) {
      throw new Error("storeRemoteEnvelope: messageId unsafe");
    }
    if (!envelope || typeof envelope !== "object") {
      throw new TypeError("storeRemoteEnvelope: envelope required");
    }
    const root = communityRoot(this._rootDir, communityId);
    const dir = path.join(root, "remote-envelopes");
    ensureDir(dir);
    const target = path.join(dir, messageId + ".json");
    if (fs.existsSync(target)) {
      return { stored: true, path: target, alreadyExists: true };
    }
    fs.writeFileSync(target, JSON.stringify(envelope, null, 2), "utf-8");
    return { stored: true, path: target };
  }

  /**
   * Load envelope + landmark for a message — convenience for IPC handlers
   * that want to deliver an inclusion proof to renderer / external clients.
   */
  loadEnvelopeAndLandmark(communityId, messageId) {
    const found = this.findEnvelope(communityId, messageId);
    if (!found.found || found.staging) {
      return found;
    }
    const envelope = JSON.parse(fs.readFileSync(found.envelopePath, "utf-8"));
    let landmark = null;
    if (found.origin === "local") {
      // Local batch: landmark sits next to the envelope
      const landmarkPath = path.join(
        path.dirname(found.envelopePath),
        "landmark.json",
      );
      if (fs.existsSync(landmarkPath)) {
        landmark = JSON.parse(fs.readFileSync(landmarkPath, "utf-8"));
      }
    } else if (found.origin === "remote") {
      // Remote envelope: landmark is in remote-landmarks/, indexed by tree
      // head id. May be missing if we received the envelope without a
      // matching landmark broadcast (e.g. the publisher closed a batch but
      // the gossipsub message hasn't reached us yet).
      landmark = this.findRemoteLandmark(communityId, found.treeHeadId);
    }
    return { ...found, envelope, landmark };
  }
}

module.exports = {
  ChannelEventBatcher,
  SCHEMA_MANIFEST,
  NAMESPACE_PREFIX,
  DEFAULT_THRESHOLD,
  DEFAULT_INTERVAL_MS,
};
