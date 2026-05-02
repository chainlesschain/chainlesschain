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

const { assembleBatch, verify, NAMESPACE_RE, SCHEMA_ENVELOPE } = mtcLib;

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

function ensureDirs(dir) {
  for (const p of [dir, batchesDir(dir)]) {
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
