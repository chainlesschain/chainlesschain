/**
 * Cross-Chain Bridge MTC integration (v0.1 — design doc 跨链桥设计 v1).
 *
 * Wraps core-mtc assembleBatch / verify with bridge-specific:
 *   - namespace formatting: `mtc/v1/bridge/<chain-pair>/<batch-seq>` (lex-ordered)
 *   - trust-anchor store per source chain (Independent mode, design §6.1)
 *   - bridge envelope verification (namespace prefix + bridge_op enum check)
 *
 * Layout under <configDir>/cross-chain-mtc/:
 *   config.json                  enabled, batch_interval_seconds, alg, mode (independent|federated|light-client)
 *   trust-anchors.json           { chain_id → [{ pubkey_id, alg, issuer, pubkey_jwk, added_at }] }
 *   batches/<batch-id>/          one closed batch (landmark + envelopes)
 *
 * Per design doc §3.1: opt-in. Default config.enabled = false. Existing
 * `cc crosschain bridge|swap|send` paths keep working unchanged when
 * MTC integration is disabled.
 */

import fs from "node:fs";
import path from "node:path";
import mtcLib from "@chainlesschain/core-mtc";

const {
  assembleBatch,
  verify,
  NAMESPACE_RE,
  SCHEMA_ENVELOPE,
  ed25519,
  slhDsa,
} = mtcLib;

const SUPPORTED_BRIDGE_CHAINS = Object.freeze([
  "ethereum",
  "polygon",
  "bsc",
  "arbitrum",
  "solana",
]);

const VALID_BRIDGE_OPS = Object.freeze([
  "lock",
  "mint",
  "refund",
  "swap-init",
  "swap-claim",
  "swap-refund",
  "msg-send",
]);

const CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  // 60s default per design doc §3.5 — short-window batch suitable for
  // cross-chain latency expectations. Operators may bump for low-traffic pairs.
  batch_interval_seconds: 60,
  alg: "ed25519", // or "slh-dsa-128f" (PQC opt-in)
  mode: "independent", // or "federated" | "light-client"
  issuer: "mtca:cc:bridge-local",
});

const BRIDGE_NAMESPACE_PREFIX = "mtc/v1/bridge/";
const BRIDGE_NAMESPACE_RE = /^mtc\/v1\/bridge\/[a-z0-9]+-[a-z0-9]+\/[0-9]{6,}$/;

// ─────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────

export function getCrossChainMtcDir(configDir) {
  if (!configDir) throw new Error("getCrossChainMtcDir: configDir required");
  return path.join(configDir, "cross-chain-mtc");
}

function configPath(dir) {
  return path.join(dir, "config.json");
}

function trustAnchorsPath(dir) {
  return path.join(dir, "trust-anchors.json");
}

function batchesDir(dir) {
  return path.join(dir, "batches");
}

function stagingDir(dir) {
  return path.join(dir, "staging");
}

function batchSeqPath(dir) {
  return path.join(dir, "batch-seq.json");
}

function ensureDirs(dir) {
  for (const p of [dir, batchesDir(dir), stagingDir(dir)]) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Namespace
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a cross-chain bridge namespace. Per design doc §5.2 chain-pair
 * MUST be lexicographic (so A↔B always maps to one tree, never two).
 *
 * @param {string} srcChain
 * @param {string} dstChain
 * @param {number|string} batchSeq - integer ≥ 1 (zero-padded to 6 digits)
 * @returns {string} namespace like "mtc/v1/bridge/ethereum-polygon/000142"
 */
export function bridgeNamespace(srcChain, dstChain, batchSeq) {
  if (!SUPPORTED_BRIDGE_CHAINS.includes(srcChain)) {
    throw new RangeError(
      `bridgeNamespace: unsupported src chain "${srcChain}"`,
    );
  }
  if (!SUPPORTED_BRIDGE_CHAINS.includes(dstChain)) {
    throw new RangeError(
      `bridgeNamespace: unsupported dst chain "${dstChain}"`,
    );
  }
  if (srcChain === dstChain) {
    throw new RangeError("bridgeNamespace: src and dst chain must differ");
  }
  const seqInt = Number(batchSeq);
  if (!Number.isInteger(seqInt) || seqInt < 1) {
    throw new RangeError("bridgeNamespace: batchSeq must be positive integer");
  }
  const pair = [srcChain, dstChain].sort().join("-");
  const seq = String(seqInt).padStart(6, "0");
  return `${BRIDGE_NAMESPACE_PREFIX}${pair}/${seq}`;
}

export function isBridgeNamespace(ns) {
  return typeof ns === "string" && BRIDGE_NAMESPACE_RE.test(ns);
}

// ─────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────

export function loadCrossChainMtcConfig(dir) {
  ensureDirs(dir);
  const p = configPath(dir);
  if (!fs.existsSync(p)) return { ...CONFIG_DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { ...CONFIG_DEFAULTS, ...raw };
  } catch (err) {
    throw new Error(`cross-chain-mtc config malformed at ${p}: ${err.message}`);
  }
}

export function saveCrossChainMtcConfig(dir, patch) {
  ensureDirs(dir);
  const merged = { ...loadCrossChainMtcConfig(dir), ...patch };
  if (typeof merged.enabled !== "boolean") {
    throw new TypeError("config.enabled must be boolean");
  }
  if (
    !Number.isInteger(merged.batch_interval_seconds) ||
    merged.batch_interval_seconds < 1
  ) {
    throw new RangeError(
      "config.batch_interval_seconds must be positive integer",
    );
  }
  if (!["ed25519", "slh-dsa-128f"].includes(merged.alg)) {
    throw new RangeError("config.alg must be ed25519 or slh-dsa-128f");
  }
  if (!["independent", "federated", "light-client"].includes(merged.mode)) {
    throw new RangeError(
      "config.mode must be independent, federated, or light-client",
    );
  }
  fs.writeFileSync(configPath(dir), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

// ─────────────────────────────────────────────────────────────────────
// Trust anchor store (Independent mode — design doc §6.1)
// ─────────────────────────────────────────────────────────────────────

function emptyTrustAnchorStore() {
  return { schema: "mtc-bridge-trust-anchors/v1", anchors: {} };
}

export function loadTrustAnchors(dir) {
  ensureDirs(dir);
  const p = trustAnchorsPath(dir);
  if (!fs.existsSync(p)) return emptyTrustAnchorStore();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (raw.schema !== "mtc-bridge-trust-anchors/v1" || !raw.anchors) {
      throw new Error("schema mismatch");
    }
    return raw;
  } catch (err) {
    throw new Error(`trust-anchors store malformed at ${p}: ${err.message}`);
  }
}

function saveTrustAnchorStore(dir, store) {
  fs.writeFileSync(
    trustAnchorsPath(dir),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

/**
 * Register a trust anchor for a source chain.
 *
 * @param {string} dir
 * @param {string} chain - one of SUPPORTED_BRIDGE_CHAINS
 * @param {{ pubkey_id: string, alg: string, issuer: string, pubkey_jwk?: object }} anchor
 * @returns {{ added: boolean, total_for_chain: number }}
 */
export function addTrustAnchor(dir, chain, anchor) {
  if (!SUPPORTED_BRIDGE_CHAINS.includes(chain)) {
    throw new RangeError(`addTrustAnchor: unsupported chain "${chain}"`);
  }
  if (!anchor || typeof anchor !== "object") {
    throw new TypeError("addTrustAnchor: anchor object required");
  }
  if (typeof anchor.pubkey_id !== "string" || !anchor.pubkey_id) {
    throw new TypeError("addTrustAnchor: anchor.pubkey_id required");
  }
  if (!["ed25519", "slh-dsa-128f"].includes(anchor.alg)) {
    throw new RangeError(
      "addTrustAnchor: anchor.alg must be ed25519 or slh-dsa-128f",
    );
  }
  if (typeof anchor.issuer !== "string" || !anchor.issuer) {
    throw new TypeError("addTrustAnchor: anchor.issuer required");
  }

  const store = loadTrustAnchors(dir);
  store.anchors[chain] ||= [];
  const existing = store.anchors[chain].find(
    (a) => a.pubkey_id === anchor.pubkey_id,
  );
  if (existing) {
    return { added: false, total_for_chain: store.anchors[chain].length };
  }
  store.anchors[chain].push({
    pubkey_id: anchor.pubkey_id,
    alg: anchor.alg,
    issuer: anchor.issuer,
    pubkey_jwk: anchor.pubkey_jwk || null,
    added_at: new Date().toISOString(),
  });
  saveTrustAnchorStore(dir, store);
  return { added: true, total_for_chain: store.anchors[chain].length };
}

export function listTrustAnchors(dir, chain) {
  const store = loadTrustAnchors(dir);
  if (chain) {
    if (!SUPPORTED_BRIDGE_CHAINS.includes(chain)) {
      throw new RangeError(`listTrustAnchors: unsupported chain "${chain}"`);
    }
    return store.anchors[chain] || [];
  }
  return store.anchors;
}

export function removeTrustAnchor(dir, chain, pubkeyId) {
  if (!SUPPORTED_BRIDGE_CHAINS.includes(chain)) {
    throw new RangeError(`removeTrustAnchor: unsupported chain "${chain}"`);
  }
  const store = loadTrustAnchors(dir);
  const list = store.anchors[chain] || [];
  const before = list.length;
  store.anchors[chain] = list.filter((a) => a.pubkey_id !== pubkeyId);
  const removed = before > store.anchors[chain].length;
  if (removed) saveTrustAnchorStore(dir, store);
  return { removed, total_for_chain: store.anchors[chain].length };
}

// ─────────────────────────────────────────────────────────────────────
// Bridge op leaf shape — matches design doc §5.1 payload
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate one bridge op (raw leaf) before batching. Throws on bad shape.
 * @param {object} op
 */
export function validateBridgeOp(op) {
  if (!op || typeof op !== "object") {
    throw new TypeError("validateBridgeOp: op object required");
  }
  if (!VALID_BRIDGE_OPS.includes(op.bridge_op)) {
    throw new RangeError(
      `validateBridgeOp: bridge_op must be one of ${VALID_BRIDGE_OPS.join(", ")}`,
    );
  }
  if (!SUPPORTED_BRIDGE_CHAINS.includes(op.src_chain)) {
    throw new RangeError(
      `validateBridgeOp: unsupported src_chain "${op.src_chain}"`,
    );
  }
  if (!SUPPORTED_BRIDGE_CHAINS.includes(op.dst_chain)) {
    throw new RangeError(
      `validateBridgeOp: unsupported dst_chain "${op.dst_chain}"`,
    );
  }
  if (op.src_chain === op.dst_chain) {
    throw new RangeError("validateBridgeOp: src and dst chain must differ");
  }
  if (typeof op.issued_at !== "string" || !op.issued_at) {
    throw new TypeError("validateBridgeOp: issued_at (RFC 3339) required");
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Batch assembly — wraps core-mtc assembleBatch with bridge namespace
// ─────────────────────────────────────────────────────────────────────

/**
 * Assemble a bridge batch. Pure (no fs).
 *
 * @param {Array<object>} bridgeOps - validated bridge ops
 * @param {{ secretKey: Buffer, publicKey: Buffer }} keys
 * @param {{ src_chain: string, dst_chain: string, batch_seq: number,
 *           issuer: string, alg?: string, signer?: object }} opts
 * @returns {{ landmark, envelopes, treeHeadId, root, namespace }}
 */
export function assembleBridgeBatch(bridgeOps, keys, opts) {
  if (!Array.isArray(bridgeOps) || bridgeOps.length === 0) {
    throw new RangeError("assembleBridgeBatch: bridgeOps must be non-empty");
  }
  if (!opts || typeof opts !== "object") {
    throw new TypeError("assembleBridgeBatch: opts required");
  }
  for (const op of bridgeOps) validateBridgeOp(op);

  const namespace = bridgeNamespace(
    opts.src_chain,
    opts.dst_chain,
    opts.batch_seq,
  );
  const result = assembleBatch(
    bridgeOps,
    keys,
    {
      namespace,
      issuer: opts.issuer,
      issuedAt: opts.issuedAt,
      expiresAt: opts.expiresAt,
    },
    opts.signer,
  );
  return { ...result, namespace };
}

// ─────────────────────────────────────────────────────────────────────
// Envelope verification — wraps core-mtc verify with bridge-specific checks
// ─────────────────────────────────────────────────────────────────────

/**
 * Verify a bridge envelope. Layered checks:
 *   1. namespace conforms to bridge pattern (BRIDGE_NAMESPACE_RE)
 *   2. envelope.leaf has valid bridge_op + src/dst_chain
 *   3. core-mtc verify passes (inclusion proof + landmark lookup)
 *
 * @param {object} envelope - MTC envelope JSON
 * @param {{ lookup: Function }} cache - LandmarkCache
 * @param {{ now?: number }} [options]
 * @returns {{ ok: boolean, code?: string, recoverable?: boolean,
 *             leaf?: object, treeHead?: object, bridge_op?: string }}
 */
export function verifyBridgeEnvelope(envelope, cache, options) {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, code: "BAD_ENVELOPE", recoverable: false };
  }
  if (envelope.schema !== SCHEMA_ENVELOPE) {
    return { ok: false, code: "UNKNOWN_SCHEMA", recoverable: false };
  }
  if (!isBridgeNamespace(envelope.namespace)) {
    return { ok: false, code: "BAD_BRIDGE_NAMESPACE", recoverable: false };
  }
  // Check leaf shape before paying merkle-proof cost
  if (!envelope.leaf || typeof envelope.leaf !== "object") {
    return { ok: false, code: "BAD_BRIDGE_LEAF", recoverable: false };
  }
  try {
    validateBridgeOp(envelope.leaf);
  } catch (_err) {
    return { ok: false, code: "BAD_BRIDGE_LEAF", recoverable: false };
  }

  const result = verify(envelope, cache, options);
  if (!result.ok) return result;

  return { ...result, bridge_op: envelope.leaf.bridge_op };
}

// ─────────────────────────────────────────────────────────────────────
// Staging — `--mtc` opt-in writes one op per file; mtc-batch closes them
// ─────────────────────────────────────────────────────────────────────

function stagedFileName(op) {
  // Time-prefixed so listdir = chronological. Pair-prefix groups visually.
  const ts = new Date(op.issued_at)
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 17);
  const pair = [op.src_chain, op.dst_chain].sort().join("-");
  // Use a content-derived 8-char tail to dedupe accidental double-stage of same op.
  const sigSource = `${op.bridge_op}|${op.src_tx_hash || ""}|${op.swap_id || ""}|${op.amount || ""}|${ts}`;
  let h = 0;
  for (let i = 0; i < sigSource.length; i++)
    h = ((h << 5) - h + sigSource.charCodeAt(i)) | 0;
  const tail = (h >>> 0).toString(16).padStart(8, "0");
  return `${ts}-${pair}-${tail}.json`;
}

/**
 * Stage one bridge op for inclusion in the next batch close.
 * Idempotent: same op written twice -> single staging file.
 *
 * #21 B.5 Layer 2 PR4 — when `op.multisig_provenance` is present, validate
 * its structure via `verifyMultisigProvenance` before writing. Invalid
 * provenance is rejected (`INVALID_MULTISIG_PROVENANCE`) instead of being
 * silently persisted so downstream `closeBatch` / wrapper attachment
 * cannot pick up malformed data.
 *
 * @param {string} dir
 * @param {object} op
 * @param {{ requireEnabled?: boolean }} [opts]
 * @returns {{ staged: boolean, path: string, reason?: string }}
 */
export function stageBridgeOp(dir, op, opts = {}) {
  ensureDirs(dir);
  const cfg = loadCrossChainMtcConfig(dir);
  const requireEnabled = opts.requireEnabled !== false;
  if (requireEnabled && !cfg.enabled) {
    return { staged: false, path: null, reason: "DISABLED" };
  }
  validateBridgeOp(op);
  if (op.multisig_provenance) {
    const pv = verifyMultisigProvenance({
      multisig_provenance: op.multisig_provenance,
    });
    if (!pv.ok) {
      return {
        staged: false,
        path: null,
        reason: `INVALID_MULTISIG_PROVENANCE:${pv.code}${pv.detail ? `:${pv.detail}` : ""}`,
      };
    }
  }
  const file = path.join(stagingDir(dir), stagedFileName(op));
  if (fs.existsSync(file)) {
    return { staged: false, path: file, reason: "ALREADY_STAGED" };
  }
  fs.writeFileSync(file, JSON.stringify(op, null, 2), "utf-8");
  return { staged: true, path: file };
}

/**
 * Read all staged ops grouped by chain-pair.
 * @returns {{ [pair: string]: Array<{ file: string, op: object }> }}
 */
export function listStagedOps(dir) {
  ensureDirs(dir);
  const sd = stagingDir(dir);
  if (!fs.existsSync(sd)) return {};
  const out = {};
  for (const name of fs.readdirSync(sd).sort()) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(sd, name);
    let op;
    try {
      op = JSON.parse(fs.readFileSync(file, "utf-8"));
      validateBridgeOp(op);
    } catch (_err) {
      continue;
    }
    const pair = [op.src_chain, op.dst_chain].sort().join("-");
    out[pair] ||= [];
    out[pair].push({ file, op });
  }
  return out;
}

function nextBatchSeq(dir, pair) {
  const p = batchSeqPath(dir);
  let map = {};
  if (fs.existsSync(p)) {
    try {
      map = JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (_err) {
      map = {};
    }
  }
  const next = (map[pair] || 0) + 1;
  map[pair] = next;
  fs.writeFileSync(p, JSON.stringify(map, null, 2), "utf-8");
  return next;
}

/**
 * Close all currently-staged ops into one batch per chain-pair.
 * Writes batches/<pair>-<seq>/{landmark.json, envelope-NN.json,...} and
 * removes the staged files atomically per pair (best-effort).
 *
 * @param {string} dir
 * @param {{ alg?: string, signer?: object, issuer?: string,
 *           keys?: { secretKey: Buffer, publicKey: Buffer } }} [opts]
 * @returns {{ batches: Array<{ pair, seq, namespace, treeHeadId, count, dir }>,
 *             skipped: { reason: string } | null }}
 */
export function closeBatch(dir, opts = {}) {
  ensureDirs(dir);
  const cfg = loadCrossChainMtcConfig(dir);
  const grouped = listStagedOps(dir);
  const pairs = Object.keys(grouped);
  if (pairs.length === 0) {
    return { batches: [], skipped: { reason: "NO_STAGED_OPS" } };
  }

  const alg = opts.alg || cfg.alg;
  const signer = opts.signer || (alg === "slh-dsa-128f" ? slhDsa : ed25519);
  const keys = opts.keys || signer.generateKeyPair();
  const issuer = opts.issuer || cfg.issuer;

  const batches = [];
  for (const pair of pairs) {
    const entries = grouped[pair];
    const ops = entries.map((e) => e.op);
    const [src, dst] = pair.split("-");
    const seq = nextBatchSeq(dir, pair);
    const result = assembleBridgeBatch(ops, keys, {
      src_chain: src,
      dst_chain: dst,
      batch_seq: seq,
      issuer,
      signer,
    });

    const outDir = path.join(
      batchesDir(dir),
      `${pair}-${String(seq).padStart(6, "0")}`,
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "landmark.json"),
      JSON.stringify(result.landmark, null, 2),
      "utf-8",
    );
    result.envelopes.forEach((env, i) => {
      fs.writeFileSync(
        path.join(outDir, `envelope-${String(i).padStart(4, "0")}.json`),
        JSON.stringify(env, null, 2),
        "utf-8",
      );
    });

    // Remove staging files only after on-disk artifacts persisted.
    for (const e of entries) {
      try {
        fs.unlinkSync(e.file);
      } catch (_err) {
        /* best-effort cleanup */
      }
    }

    batches.push({
      pair,
      seq,
      namespace: result.namespace,
      treeHeadId: result.treeHeadId,
      count: ops.length,
      dir: outDir,
    });
  }
  return { batches, skipped: null };
}

// ─────────────────────────────────────────────────────────────────────
// v0.2 — Multi-hop envelope (envelope-of-envelope)
// v0.3 — #21 B.5 Layer 2 PR2: m-of-n multisig provenance on the wrapper
// ─────────────────────────────────────────────────────────────────────

const SCHEMA_MULTI_HOP_BRIDGE = "mtc-bridge-multihop/v1";

const MULTISIG_PROVENANCE_REQUIRED_FIELDS = Object.freeze([
  "proposal_id",
  "threshold_m",
  "member_count_n",
  "signers",
  "partial_sigs",
]);

const MULTISIG_SUPPORTED_ALGS = Object.freeze(["Ed25519", "SLH-DSA-128F"]);

/**
 * Attach m-of-n multisig provenance to a bridge envelope (single-hop or
 * multi-hop wrapper). Returns a new envelope object — does not mutate.
 *
 * Provenance carries the proposal id, the m/n policy at consume time, the
 * sorted-ASC signer DID list, and per-signer {did, alg, sig:hex} entries.
 * Mirrors the cc_bridges columns introduced in #21 B.5 Layer 2 PR1.
 *
 * Layer 3 onchain broadcasters read this field to construct the m-of-n
 * proof bundle expected by destination-chain verifier contracts.
 *
 * @param {object} envelope    - mtc-envelope/v1 or mtc-bridge-multihop/v1
 * @param {{
 *   proposalId: string,
 *   thresholdM: number,
 *   memberCountN: number,
 *   signers: string[],
 *   partialSigs: Array<{did: string, alg: string, sig: string}>,
 * }} provenance
 * @returns {object} new envelope with `multisig_provenance` field
 */
export function attachMultisigProvenance(envelope, provenance) {
  if (!envelope || typeof envelope !== "object") {
    throw new TypeError("attachMultisigProvenance: envelope required");
  }
  if (!provenance || typeof provenance !== "object") {
    throw new TypeError("attachMultisigProvenance: provenance required");
  }
  return {
    ...envelope,
    multisig_provenance: {
      proposal_id: provenance.proposalId,
      threshold_m: provenance.thresholdM,
      member_count_n: provenance.memberCountN,
      signers: Array.isArray(provenance.signers) ? [...provenance.signers] : [],
      partial_sigs: Array.isArray(provenance.partialSigs)
        ? provenance.partialSigs.map((s) => ({
            did: s.did,
            alg: s.alg,
            sig: s.sig,
          }))
        : [],
    },
  };
}

/**
 * Strip-all-sigs canonical form for a bridge envelope carrying
 * `multisig_provenance`. Returns a clone with every `partial_sigs[*].sig`
 * replaced by `""` so producer and verifier can feed an identical byte
 * sequence into JCS for m-of-n threshold tolerance.
 *
 * Mirrors `@chainlesschain/core-mtc/lib/publisher-signing.js
 * _stripSigsForPublisher` (memory `mtc_publisher_sig_threshold.md`) — both
 * the publisher_signature on a landmark and a wrapper-level m-of-n proof
 * need the same canonical-skeleton-without-sigs invariant.
 *
 * Reused by PR3 verifier when checking each partial sig against the
 * canonical wrapper bytes.
 *
 * @param {object} envelope - envelope with `multisig_provenance`
 * @returns {object} clone with sigs zeroed; same envelope returned when no
 *                   provenance is attached
 */
export function stripMultisigSigsForCanonical(envelope) {
  if (!envelope || !envelope.multisig_provenance) return envelope;
  return {
    ...envelope,
    multisig_provenance: {
      ...envelope.multisig_provenance,
      partial_sigs: (envelope.multisig_provenance.partial_sigs || []).map(
        (s) => ({ ...s, sig: "" }),
      ),
    },
  };
}

/**
 * Structural validation of multisig_provenance on a bridge envelope.
 * Does NOT verify cryptographic signatures (deferred to PR3 — would need
 * the proposal's payload JCS + member pubkey lookup). Confirms:
 *   - provenance is present and well-formed
 *   - partial_sigs.length >= threshold_m
 *   - every signer DID is in the policy.members allow-list (when supplied)
 *   - every partial_sig has a supported alg + non-empty hex sig
 *   - signer list is sorted ASC (canonical form invariant)
 *
 * @param {object} envelope - envelope with `multisig_provenance` to check
 * @param {{ m: number, members?: Array<{did:string}> }} [policy] - optional
 *   policy spec; when present, signer-membership and threshold are checked
 *   against it instead of provenance's own `threshold_m` field
 * @returns {{ ok: boolean, code?: string, detail?: string }}
 */
export function verifyMultisigProvenance(envelope, policy) {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, code: "BAD_ENVELOPE" };
  }
  const prov = envelope.multisig_provenance;
  if (!prov || typeof prov !== "object") {
    return { ok: false, code: "MISSING_PROVENANCE" };
  }
  for (const f of MULTISIG_PROVENANCE_REQUIRED_FIELDS) {
    if (prov[f] === undefined || prov[f] === null) {
      return { ok: false, code: "INCOMPLETE_PROVENANCE", detail: f };
    }
  }
  if (typeof prov.proposal_id !== "string" || !prov.proposal_id) {
    return { ok: false, code: "BAD_PROPOSAL_ID" };
  }
  if (
    !Number.isInteger(prov.threshold_m) ||
    prov.threshold_m < 1 ||
    !Number.isInteger(prov.member_count_n) ||
    prov.member_count_n < prov.threshold_m
  ) {
    return { ok: false, code: "BAD_THRESHOLD" };
  }
  if (!Array.isArray(prov.signers) || !Array.isArray(prov.partial_sigs)) {
    return { ok: false, code: "BAD_PROVENANCE_SHAPE" };
  }
  if (prov.signers.length !== prov.partial_sigs.length) {
    return { ok: false, code: "SIGNERS_SIGS_LENGTH_MISMATCH" };
  }
  const requiredM =
    policy && Number.isInteger(policy.m) ? policy.m : prov.threshold_m;
  if (prov.partial_sigs.length < requiredM) {
    return {
      ok: false,
      code: "BELOW_THRESHOLD",
      detail: `${prov.partial_sigs.length} < ${requiredM}`,
    };
  }
  const sorted = [...prov.signers].sort();
  for (let i = 0; i < prov.signers.length; i++) {
    if (prov.signers[i] !== sorted[i]) {
      return { ok: false, code: "SIGNERS_NOT_SORTED" };
    }
  }
  const allowed =
    policy && Array.isArray(policy.members)
      ? new Set(policy.members.map((m) => m.did))
      : null;
  for (let i = 0; i < prov.partial_sigs.length; i++) {
    const s = prov.partial_sigs[i];
    if (!s || typeof s !== "object") {
      return { ok: false, code: "BAD_PARTIAL_SIG", detail: `index ${i}` };
    }
    if (typeof s.did !== "string" || !s.did) {
      return { ok: false, code: "BAD_PARTIAL_SIG_DID", detail: `index ${i}` };
    }
    if (s.did !== prov.signers[i]) {
      return {
        ok: false,
        code: "SIGNER_DID_MISMATCH",
        detail: `signers[${i}]=${prov.signers[i]} vs partial_sigs[${i}].did=${s.did}`,
      };
    }
    if (!MULTISIG_SUPPORTED_ALGS.includes(s.alg)) {
      return {
        ok: false,
        code: "UNSUPPORTED_ALG",
        detail: `index ${i} alg=${s.alg}`,
      };
    }
    if (typeof s.sig !== "string" || !/^[0-9a-fA-F]+$/.test(s.sig) || !s.sig) {
      return {
        ok: false,
        code: "BAD_PARTIAL_SIG_HEX",
        detail: `index ${i}`,
      };
    }
    if (allowed && !allowed.has(s.did)) {
      return {
        ok: false,
        code: "SIGNER_NOT_IN_POLICY",
        detail: s.did,
      };
    }
  }
  return { ok: true };
}

/**
 * Build a multi-hop bridge envelope by chaining single-hop envelopes.
 * For a route A → B → C, the caller supplies the leg envelopes
 * [A→B, B→C] and gets back a wrapper envelope referencing both legs.
 *
 * Verification (verifyMultiHopBridgeEnvelope below) checks each leg's
 * inclusion proof against its respective landmark + asserts that the
 * intermediate chain is consistent (leg[i].dst_chain == leg[i+1].src_chain).
 *
 * @param {Array<object>} legEnvelopes - ≥ 2 single-hop bridge envelopes
 * @param {{ route_id?: string, total_amount?: string, asset?: string }} [meta]
 * @param {{
 *   proposalId: string,
 *   thresholdM: number,
 *   memberCountN: number,
 *   signers: string[],
 *   partialSigs: Array<{did:string,alg:string,sig:string}>,
 * }} [multisigProvenance] - #21 B.5 Layer 2 PR2: optional m-of-n provenance
 *   carried over from a multisig-gated bridge consume. Attached via
 *   `attachMultisigProvenance` so canonical form (strip-all-sigs JCS) and
 *   verifier path (`verifyMultisigProvenance`) work uniformly.
 * @returns {object} multi-hop wrapper envelope
 */
export function buildMultiHopBridgeEnvelope(
  legEnvelopes,
  meta = {},
  multisigProvenance = null,
) {
  if (!Array.isArray(legEnvelopes) || legEnvelopes.length < 2) {
    throw new RangeError(
      "buildMultiHopBridgeEnvelope: need at least 2 leg envelopes",
    );
  }
  for (let i = 0; i < legEnvelopes.length; i++) {
    const env = legEnvelopes[i];
    if (!env || env.schema !== SCHEMA_ENVELOPE) {
      throw new TypeError(`leg ${i}: not a valid mtc-envelope/v1 envelope`);
    }
    if (!isBridgeNamespace(env.namespace)) {
      throw new TypeError(`leg ${i}: not a bridge namespace`);
    }
    validateBridgeOp(env.leaf);
    if (i > 0) {
      const prev = legEnvelopes[i - 1];
      if (prev.leaf.dst_chain !== env.leaf.src_chain) {
        throw new RangeError(
          `route discontinuity: leg ${i - 1} dst_chain=${prev.leaf.dst_chain} but leg ${i} src_chain=${env.leaf.src_chain}`,
        );
      }
    }
  }
  const route = legEnvelopes.map((env) => ({
    src_chain: env.leaf.src_chain,
    dst_chain: env.leaf.dst_chain,
    leaf_hash: env.leaf_hash || null,
    namespace: env.namespace,
    tree_head_id: env.tree_head_id,
  }));
  const chainPath = [
    legEnvelopes[0].leaf.src_chain,
    ...legEnvelopes.map((e) => e.leaf.dst_chain),
  ];
  const wrapper = {
    schema: SCHEMA_MULTI_HOP_BRIDGE,
    route_id:
      meta.route_id ||
      `mh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    chain_path: chainPath,
    leg_count: legEnvelopes.length,
    legs: legEnvelopes,
    route_summary: route,
    total_amount: meta.total_amount || null,
    asset: meta.asset || null,
    issued_at: new Date().toISOString(),
  };
  if (multisigProvenance) {
    return attachMultisigProvenance(wrapper, multisigProvenance);
  }
  return wrapper;
}

/**
 * Verify a multi-hop wrapper envelope. Each leg must verify against its
 * own landmark + the chain path must be continuous + at least one leg
 * must be the "lock" op (the trigger).
 *
 * #21 B.5 Layer 2 PR3 — when `wrapper.multisig_provenance` is present OR
 * `options.requireMultisig === true`, also runs `verifyMultisigProvenance`
 * (structural). Result includes nested `multisig_result`. Cryptographic
 * verification of each partial sig against canonical wrapper bytes is
 * deferred (would require per-signer pubkey lookup; see Layer 3).
 *
 * @param {object} wrapper - multi-hop envelope from buildMultiHopBridgeEnvelope
 * @param {Array<{landmark: object}>} legCacheEntries - one per leg, in order
 * @param {{
 *   expectedMultisigPolicy?: { m: number, members?: Array<{did:string}> },
 *   requireMultisig?: boolean,
 * }} [options]
 * @returns {{
 *   ok: boolean,
 *   code?: string,
 *   leg_results?: Array<{ok, code?}>,
 *   multisig_result?: { ok: boolean, code?: string, detail?: string },
 * }}
 */
export function verifyMultiHopBridgeEnvelope(
  wrapper,
  legCacheEntries,
  options = {},
) {
  if (!wrapper || wrapper.schema !== SCHEMA_MULTI_HOP_BRIDGE) {
    return { ok: false, code: "BAD_MULTIHOP_SCHEMA" };
  }
  if (!Array.isArray(wrapper.legs) || wrapper.legs.length < 2) {
    return { ok: false, code: "BAD_LEG_COUNT" };
  }
  if (
    !Array.isArray(legCacheEntries) ||
    legCacheEntries.length !== wrapper.legs.length
  ) {
    return { ok: false, code: "LEG_CACHE_COUNT_MISMATCH" };
  }
  const lib = mtcLib;
  const results = [];
  for (let i = 0; i < wrapper.legs.length; i++) {
    const leg = wrapper.legs[i];
    const cache = new lib.LandmarkCache({
      signatureVerifier: lib.alwaysAcceptSignatureVerifier,
    });
    try {
      cache.ingest(legCacheEntries[i].landmark);
    } catch (err) {
      results.push({ ok: false, code: err.code || "LANDMARK_REJECT" });
      continue;
    }
    const r = verifyBridgeEnvelope(leg, cache);
    results.push(r);
    if (i > 0) {
      const prev = wrapper.legs[i - 1];
      if (prev.leaf.dst_chain !== leg.leaf.src_chain) {
        return {
          ok: false,
          code: "ROUTE_DISCONTINUITY",
          leg_results: results,
        };
      }
    }
  }
  const legsOk = results.every((r) => r.ok);
  const hasProvenance = !!wrapper.multisig_provenance;
  const requireMultisig = !!options.requireMultisig;
  if (hasProvenance || requireMultisig) {
    const multisigResult = verifyMultisigProvenance(
      wrapper,
      options.expectedMultisigPolicy,
    );
    if (!multisigResult.ok) {
      return {
        ok: false,
        code: "MULTISIG_PROVENANCE_INVALID",
        leg_results: results,
        multisig_result: multisigResult,
      };
    }
    return {
      ok: legsOk,
      leg_results: results,
      multisig_result: multisigResult,
    };
  }
  return { ok: legsOk, leg_results: results };
}

// ─────────────────────────────────────────────────────────────────────
// v0.2 — Gas-aware batch trigger
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_GAS_PROFILE = Object.freeze({
  // gas-cost units per chain, normalized to USD per tx (heuristic)
  // Aligns with the existing fee estimator in cross-chain.js
  ethereum: 5.0,
  polygon: 0.01,
  bsc: 0.1,
  arbitrum: 0.3,
  solana: 0.005,
});

/**
 * Decide whether to close the batch now or defer to the next interval
 * based on a target chain's current gas price (USD-equivalent).
 *
 * Heuristic: defer when current gas > 1.5x the chain's baseline AND
 * the staged-ops count is below the "hard close" floor. Otherwise close.
 *
 * @param {{
 *   target_chain: string,
 *   current_gas_usd?: number,        // observed; if absent uses baseline
 *   staged_count: number,
 *   hard_close_floor?: number,        // always close at or above this count
 *   defer_multiplier?: number,        // gas-multiplier triggering defer
 * }} args
 * @returns {{ close: boolean, reason: string, baseline_usd: number, current_usd: number, staged_count: number }}
 */
export function shouldCloseBatchGasAware(args = {}) {
  if (!args.target_chain || typeof args.target_chain !== "string") {
    throw new TypeError("shouldCloseBatchGasAware: target_chain required");
  }
  const baseline = DEFAULT_GAS_PROFILE[args.target_chain];
  if (baseline === undefined) {
    throw new RangeError(
      `shouldCloseBatchGasAware: unknown target_chain "${args.target_chain}"`,
    );
  }
  const current =
    typeof args.current_gas_usd === "number" ? args.current_gas_usd : baseline;
  const staged = Number.isInteger(args.staged_count) ? args.staged_count : 0;
  const hardFloor = Number.isInteger(args.hard_close_floor)
    ? args.hard_close_floor
    : 50;
  const deferMult =
    typeof args.defer_multiplier === "number" ? args.defer_multiplier : 1.5;

  if (staged >= hardFloor) {
    return {
      close: true,
      reason: "STAGED_COUNT_AT_HARD_FLOOR",
      baseline_usd: baseline,
      current_usd: current,
      staged_count: staged,
    };
  }
  if (current > baseline * deferMult) {
    return {
      close: false,
      reason: "GAS_HIGH_DEFERRED",
      baseline_usd: baseline,
      current_usd: current,
      staged_count: staged,
    };
  }
  return {
    close: true,
    reason: "GAS_NORMAL_OR_LOW",
    baseline_usd: baseline,
    current_usd: current,
    staged_count: staged,
  };
}

// ─────────────────────────────────────────────────────────────────────
// v0.2 — SLA integration (cc sla compatible export)
// ─────────────────────────────────────────────────────────────────────

/**
 * Export bridge MTC operational metrics in cc sla compatible shape.
 * Reads on-disk staging + batches + sync-stats and synthesizes:
 *   - latest_publish_age_seconds (newer than threshold = healthy)
 *   - staged_pending_count (low = healthy)
 *   - batches_per_hour (heuristic from batch dir mtimes)
 *   - sla_status: ok | degraded | down
 *
 * @param {string} dir - cross-chain-mtc dir
 * @param {{ now?: number }} [opts]
 */
export function getBridgeMtcSlaMetrics(dir, opts = {}) {
  ensureDirs(dir);
  const now = opts.now || Date.now();
  const status = getBridgeMtcStatus(dir);

  // Compute batches_per_hour from batches/ mtimes (last hour only)
  let batchesLastHour = 0;
  let latestBatchMtime = null;
  const bDir = batchesDir(dir);
  if (fs.existsSync(bDir)) {
    for (const name of fs.readdirSync(bDir)) {
      try {
        const stat = fs.statSync(path.join(bDir, name));
        if (now - stat.mtimeMs <= 3600 * 1000) batchesLastHour++;
        if (!latestBatchMtime || stat.mtimeMs > latestBatchMtime) {
          latestBatchMtime = stat.mtimeMs;
        }
      } catch (_err) {
        /* skip stat failures */
      }
    }
  }

  const stagedAge = latestBatchMtime
    ? Math.round((now - latestBatchMtime) / 1000)
    : null;

  // Status:
  //   - down: enabled but no batches in 24h AND staging > 0
  //   - degraded: staging > 100 OR no batch in 30 min while enabled
  //   - ok: otherwise
  let slaStatus = "ok";
  if (status.enabled) {
    if (status.staging.pending > 100) slaStatus = "degraded";
    else if (
      stagedAge !== null &&
      stagedAge > 30 * 60 &&
      status.staging.pending > 0
    ) {
      slaStatus = "degraded";
    }
    if (
      stagedAge !== null &&
      stagedAge > 24 * 3600 &&
      status.staging.pending > 0
    ) {
      slaStatus = "down";
    }
  }

  return {
    sla_status: slaStatus,
    enabled: status.enabled,
    mode: status.mode,
    staged_pending_count: status.staging.pending,
    batches_total: status.batches.total,
    batches_last_hour: batchesLastHour,
    seconds_since_last_batch: stagedAge,
    measured_at: new Date(now).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Status snapshot (for `cc crosschain mtc-status`)
// ─────────────────────────────────────────────────────────────────────

/**
 * Read filesystem state and return a status summary suitable for CLI / IPC.
 * No DB access — pure fs/json reads.
 */
export function getBridgeMtcStatus(dir) {
  ensureDirs(dir);
  const cfg = loadCrossChainMtcConfig(dir);
  const taStore = loadTrustAnchors(dir);
  const taChains = Object.keys(taStore.anchors);
  const taTotal = taChains.reduce(
    (sum, c) => sum + (taStore.anchors[c]?.length || 0),
    0,
  );

  let batchCount = 0;
  let latestBatch = null;
  const bDir = batchesDir(dir);
  if (fs.existsSync(bDir)) {
    const entries = fs.readdirSync(bDir).sort();
    batchCount = entries.length;
    if (batchCount > 0) latestBatch = entries[batchCount - 1];
  }

  let stagedCount = 0;
  const sDir = stagingDir(dir);
  if (fs.existsSync(sDir)) {
    stagedCount = fs
      .readdirSync(sDir)
      .filter((n) => n.endsWith(".json")).length;
  }

  return {
    enabled: cfg.enabled,
    mode: cfg.mode,
    alg: cfg.alg,
    batch_interval_seconds: cfg.batch_interval_seconds,
    issuer: cfg.issuer,
    trust_anchors: {
      chain_count: taChains.length,
      total: taTotal,
      by_chain: Object.fromEntries(
        taChains.map((c) => [c, taStore.anchors[c].length]),
      ),
    },
    staging: {
      pending: stagedCount,
    },
    batches: {
      total: batchCount,
      latest: latestBatch,
    },
  };
}

// Internal exports for tests
export const _internal = {
  CONFIG_DEFAULTS,
  SUPPORTED_BRIDGE_CHAINS,
  VALID_BRIDGE_OPS,
  BRIDGE_NAMESPACE_PREFIX,
  BRIDGE_NAMESPACE_RE,
};
