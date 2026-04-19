/**
 * Cross-Chain Interoperability — CLI port of Phase 89 跨链互操作协议
 * (docs/design/modules/54_跨链互操作协议.md).
 *
 * Desktop drives cross-chain with ChainAdapterLayer (real RPC calls),
 * CrossChainBridgePage.vue, and Pinia store. CLI port ships:
 *
 *   - Chain catalog (5 supported chains + config)
 *   - Asset bridge lifecycle (pending → locked → minted → completed)
 *   - HTLC atomic swap lifecycle (initiated → hash_locked → claimed/refunded)
 *   - Cross-chain message tracking
 *   - Heuristic fee estimation
 *   - Bridge/swap/message stats
 *
 * What does NOT port: real RPC chain adapters, actual on-chain transactions,
 * CrossChainBridgePage.vue, Pinia store.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const SUPPORTED_CHAINS = Object.freeze({
  ETHEREUM: Object.freeze({
    id: "ethereum",
    name: "Ethereum",
    symbol: "ETH",
    chainId: 1,
  }),
  POLYGON: Object.freeze({
    id: "polygon",
    name: "Polygon",
    symbol: "MATIC",
    chainId: 137,
  }),
  BSC: Object.freeze({
    id: "bsc",
    name: "BNB Smart Chain",
    symbol: "BNB",
    chainId: 56,
  }),
  ARBITRUM: Object.freeze({
    id: "arbitrum",
    name: "Arbitrum One",
    symbol: "ETH",
    chainId: 42161,
  }),
  SOLANA: Object.freeze({
    id: "solana",
    name: "Solana",
    symbol: "SOL",
    chainId: 0,
  }),
});

const CHAIN_IDS = new Set(Object.values(SUPPORTED_CHAINS).map((c) => c.id));

export const BRIDGE_STATUS = Object.freeze({
  PENDING: "pending",
  LOCKED: "locked",
  MINTED: "minted",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  FAILED: "failed",
});

export const SWAP_STATUS = Object.freeze({
  INITIATED: "initiated",
  HASH_LOCKED: "hash_locked",
  CLAIMED: "claimed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
});

export const MESSAGE_STATUS = Object.freeze({
  PENDING: "pending",
  SENT: "sent",
  DELIVERED: "delivered",
  FAILED: "failed",
});

export const DEFAULT_CONFIG = Object.freeze({
  defaultTimeoutBlocks: 100,
  maxBridgeAmount: 1000000,
  feePercentage: 0.3,
  htlcTimeoutMs: 3600000,
  messageRetryLimit: 3,
});

/* ── State ─────────────────────────────────────────────── */

let _bridges = new Map();
let _swaps = new Map();
let _messages = new Map();
let _chainConfigs = new Map();

function _id() {
  return crypto.randomUUID();
}
function _now() {
  return Date.now();
}
function _hashLock() {
  const secret = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(secret).digest("hex");
  return { secret, hashLock: hash };
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

/* ── Schema ────────────────────────────────────────────── */

export function ensureCrossChainTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cc_bridges (
    id TEXT PRIMARY KEY,
    from_chain TEXT NOT NULL,
    to_chain TEXT NOT NULL,
    asset TEXT NOT NULL,
    amount REAL NOT NULL,
    sender_address TEXT,
    recipient_address TEXT,
    lock_tx_hash TEXT,
    mint_tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    fee_amount REAL DEFAULT 0,
    fee_chain TEXT,
    error_message TEXT,
    created_at INTEGER,
    completed_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ccb_status ON cc_bridges(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ccb_from ON cc_bridges(from_chain)");

  db.exec(`CREATE TABLE IF NOT EXISTS cc_swaps (
    id TEXT PRIMARY KEY,
    from_chain TEXT NOT NULL,
    to_chain TEXT NOT NULL,
    from_asset TEXT NOT NULL,
    to_asset TEXT NOT NULL,
    amount REAL NOT NULL,
    counterparty_address TEXT,
    hash_lock TEXT,
    time_lock INTEGER,
    secret TEXT,
    status TEXT DEFAULT 'initiated',
    claim_tx_hash TEXT,
    refund_tx_hash TEXT,
    created_at INTEGER,
    expires_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ccs_status ON cc_swaps(status)");

  db.exec(`CREATE TABLE IF NOT EXISTS cc_messages (
    id TEXT PRIMARY KEY,
    from_chain TEXT NOT NULL,
    to_chain TEXT NOT NULL,
    payload TEXT,
    target_contract TEXT,
    source_tx_hash TEXT,
    destination_tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    retries INTEGER DEFAULT 0,
    created_at INTEGER,
    delivered_at INTEGER
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ccm_status ON cc_messages(status)");

  _loadAll(db);
}

function _loadAll(db) {
  _bridges.clear();
  _swaps.clear();
  _messages.clear();

  try {
    for (const row of db.prepare("SELECT * FROM cc_bridges").all()) {
      const b = _strip(row);
      _bridges.set(b.id, b);
    }
  } catch (_e) {
    /* table may not exist */
  }
  try {
    for (const row of db.prepare("SELECT * FROM cc_swaps").all()) {
      const s = _strip(row);
      _swaps.set(s.id, s);
    }
  } catch (_e) {
    /* table may not exist */
  }
  try {
    for (const row of db.prepare("SELECT * FROM cc_messages").all()) {
      const m = _strip(row);
      _messages.set(m.id, m);
    }
  } catch (_e) {
    /* table may not exist */
  }
}

/* ── Chain validation ──────────────────────────────────── */

function _validateChain(chainId) {
  return CHAIN_IDS.has(chainId);
}

/* ── Asset Bridge ──────────────────────────────────────── */

export function bridgeAsset(
  db,
  { fromChain, toChain, asset, amount, senderAddress, recipientAddress },
) {
  if (!_validateChain(fromChain))
    return { bridgeId: null, reason: "unsupported_chain", chain: fromChain };
  if (!_validateChain(toChain))
    return { bridgeId: null, reason: "unsupported_chain", chain: toChain };
  if (fromChain === toChain) return { bridgeId: null, reason: "same_chain" };
  if (!amount || amount <= 0)
    return { bridgeId: null, reason: "invalid_amount" };
  if (amount > DEFAULT_CONFIG.maxBridgeAmount)
    return { bridgeId: null, reason: "exceeds_max_amount" };

  const id = _id();
  const now = _now();
  const fee = Math.round(amount * DEFAULT_CONFIG.feePercentage * 10) / 1000;

  const bridge = {
    id,
    from_chain: fromChain,
    to_chain: toChain,
    asset: asset || "native",
    amount,
    sender_address: senderAddress || null,
    recipient_address: recipientAddress || null,
    lock_tx_hash: null,
    mint_tx_hash: null,
    status: "pending",
    fee_amount: fee,
    fee_chain: fromChain,
    error_message: null,
    created_at: now,
    completed_at: null,
  };

  db.prepare(
    `INSERT INTO cc_bridges (id, from_chain, to_chain, asset, amount, sender_address, recipient_address,
     lock_tx_hash, mint_tx_hash, status, fee_amount, fee_chain, error_message, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    fromChain,
    toChain,
    bridge.asset,
    amount,
    bridge.sender_address,
    bridge.recipient_address,
    null,
    null,
    "pending",
    fee,
    fromChain,
    null,
    now,
    null,
  );

  _bridges.set(id, bridge);
  return { bridgeId: id, fee };
}

export function updateBridgeStatus(
  db,
  bridgeId,
  status,
  { txHash, errorMessage } = {},
) {
  const b = _bridges.get(bridgeId);
  if (!b) return { updated: false, reason: "not_found" };

  const validTransitions = {
    pending: ["locked", "failed"],
    locked: ["minted", "refunded", "failed"],
    minted: ["completed", "failed"],
  };
  const allowed = validTransitions[b.status];
  if (!allowed || !allowed.includes(status))
    return {
      updated: false,
      reason: "invalid_transition",
      from: b.status,
      to: status,
    };

  b.status = status;
  if (status === "locked" && txHash) b.lock_tx_hash = txHash;
  if (status === "minted" && txHash) b.mint_tx_hash = txHash;
  if (status === "completed") b.completed_at = _now();
  if (errorMessage) b.error_message = errorMessage;

  db.prepare(
    `UPDATE cc_bridges SET status = ?, lock_tx_hash = ?, mint_tx_hash = ?,
     completed_at = ?, error_message = ? WHERE id = ?`,
  ).run(
    b.status,
    b.lock_tx_hash,
    b.mint_tx_hash,
    b.completed_at,
    b.error_message,
    bridgeId,
  );

  return { updated: true };
}

export function getBridge(db, bridgeId) {
  const b = _bridges.get(bridgeId);
  return b ? { ...b } : null;
}

export function listBridges(
  db,
  { fromChain, toChain, status, limit = 50 } = {},
) {
  let bridges = [..._bridges.values()];
  if (fromChain) bridges = bridges.filter((b) => b.from_chain === fromChain);
  if (toChain) bridges = bridges.filter((b) => b.to_chain === toChain);
  if (status) bridges = bridges.filter((b) => b.status === status);
  return bridges
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((b) => ({ ...b }));
}

/* ── HTLC Atomic Swap ──────────────────────────────────── */

export function initiateSwap(
  db,
  {
    fromChain,
    toChain,
    fromAsset,
    toAsset,
    amount,
    counterpartyAddress,
    timeoutMs,
  },
) {
  if (!_validateChain(fromChain))
    return { swapId: null, reason: "unsupported_chain", chain: fromChain };
  if (!_validateChain(toChain))
    return { swapId: null, reason: "unsupported_chain", chain: toChain };
  if (fromChain === toChain) return { swapId: null, reason: "same_chain" };
  if (!amount || amount <= 0) return { swapId: null, reason: "invalid_amount" };

  const id = _id();
  const now = _now();
  const { secret, hashLock } = _hashLock();
  const expiresAt = now + (timeoutMs || DEFAULT_CONFIG.htlcTimeoutMs);

  const swap = {
    id,
    from_chain: fromChain,
    to_chain: toChain,
    from_asset: fromAsset || "native",
    to_asset: toAsset || "native",
    amount,
    counterparty_address: counterpartyAddress || null,
    hash_lock: hashLock,
    time_lock: expiresAt,
    secret,
    status: "initiated",
    claim_tx_hash: null,
    refund_tx_hash: null,
    created_at: now,
    expires_at: expiresAt,
  };

  db.prepare(
    `INSERT INTO cc_swaps (id, from_chain, to_chain, from_asset, to_asset, amount,
     counterparty_address, hash_lock, time_lock, secret, status, claim_tx_hash,
     refund_tx_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    fromChain,
    toChain,
    swap.from_asset,
    swap.to_asset,
    amount,
    swap.counterparty_address,
    hashLock,
    expiresAt,
    secret,
    "initiated",
    null,
    null,
    now,
    expiresAt,
  );

  _swaps.set(id, swap);
  return { swapId: id, hashLock, expiresAt };
}

export function claimSwap(db, swapId, { secret, txHash } = {}) {
  const s = _swaps.get(swapId);
  if (!s) return { claimed: false, reason: "not_found" };
  if (s.status !== "initiated" && s.status !== "hash_locked")
    return { claimed: false, reason: "invalid_status", status: s.status };

  // Verify secret matches hash lock
  if (secret) {
    const hash = crypto.createHash("sha256").update(secret).digest("hex");
    if (hash !== s.hash_lock)
      return { claimed: false, reason: "invalid_secret" };
  }

  if (_now() > s.expires_at) return { claimed: false, reason: "expired" };

  s.status = "claimed";
  if (txHash) s.claim_tx_hash = txHash;

  db.prepare(
    "UPDATE cc_swaps SET status = ?, claim_tx_hash = ? WHERE id = ?",
  ).run("claimed", s.claim_tx_hash, swapId);

  return { claimed: true };
}

export function refundSwap(db, swapId, { txHash } = {}) {
  const s = _swaps.get(swapId);
  if (!s) return { refunded: false, reason: "not_found" };
  if (s.status === "claimed" || s.status === "refunded")
    return { refunded: false, reason: "invalid_status", status: s.status };

  s.status = "refunded";
  if (txHash) s.refund_tx_hash = txHash;

  db.prepare(
    "UPDATE cc_swaps SET status = ?, refund_tx_hash = ? WHERE id = ?",
  ).run("refunded", s.refund_tx_hash, swapId);

  return { refunded: true };
}

export function getSwap(db, swapId) {
  const s = _swaps.get(swapId);
  if (!s) return null;
  // Don't leak secret in show — only expose hashLock
  const out = { ...s };
  delete out.secret;
  return out;
}

export function revealSecret(db, swapId) {
  const s = _swaps.get(swapId);
  if (!s) return null;
  if (s.status !== "claimed") return null;
  return { secret: s.secret, hashLock: s.hash_lock };
}

export function listSwaps(db, { fromChain, status, limit = 50 } = {}) {
  let swaps = [..._swaps.values()];
  if (fromChain) swaps = swaps.filter((s) => s.from_chain === fromChain);
  if (status) swaps = swaps.filter((s) => s.status === status);
  return swaps
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((s) => {
      const out = { ...s };
      delete out.secret;
      return out;
    });
}

/* ── Cross-Chain Message ───────────────────────────────── */

export function sendMessage(
  db,
  { fromChain, toChain, payload, targetContract },
) {
  if (!_validateChain(fromChain))
    return { messageId: null, reason: "unsupported_chain", chain: fromChain };
  if (!_validateChain(toChain))
    return { messageId: null, reason: "unsupported_chain", chain: toChain };

  const id = _id();
  const now = _now();

  const msg = {
    id,
    from_chain: fromChain,
    to_chain: toChain,
    payload: payload || "",
    target_contract: targetContract || null,
    source_tx_hash: null,
    destination_tx_hash: null,
    status: "pending",
    retries: 0,
    created_at: now,
    delivered_at: null,
  };

  db.prepare(
    `INSERT INTO cc_messages (id, from_chain, to_chain, payload, target_contract,
     source_tx_hash, destination_tx_hash, status, retries, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    fromChain,
    toChain,
    msg.payload,
    msg.target_contract,
    null,
    null,
    "pending",
    0,
    now,
    null,
  );

  _messages.set(id, msg);
  return { messageId: id };
}

export function updateMessageStatus(db, messageId, status, { txHash } = {}) {
  const m = _messages.get(messageId);
  if (!m) return { updated: false, reason: "not_found" };

  const validTransitions = {
    pending: ["sent", "failed"],
    sent: ["delivered", "failed"],
    failed: ["pending"], // retry
  };
  const allowed = validTransitions[m.status];
  if (!allowed || !allowed.includes(status))
    return {
      updated: false,
      reason: "invalid_transition",
      from: m.status,
      to: status,
    };

  m.status = status;
  if (status === "sent" && txHash) m.source_tx_hash = txHash;
  if (status === "delivered") {
    m.delivered_at = _now();
    if (txHash) m.destination_tx_hash = txHash;
  }
  if (status === "pending") m.retries += 1; // retry

  db.prepare(
    `UPDATE cc_messages SET status = ?, source_tx_hash = ?, destination_tx_hash = ?,
     delivered_at = ?, retries = ? WHERE id = ?`,
  ).run(
    m.status,
    m.source_tx_hash,
    m.destination_tx_hash,
    m.delivered_at,
    m.retries,
    messageId,
  );

  return { updated: true };
}

export function getMessage(db, messageId) {
  const m = _messages.get(messageId);
  return m ? { ...m } : null;
}

export function listMessages(
  db,
  { fromChain, toChain, status, limit = 50 } = {},
) {
  let msgs = [..._messages.values()];
  if (fromChain) msgs = msgs.filter((m) => m.from_chain === fromChain);
  if (toChain) msgs = msgs.filter((m) => m.to_chain === toChain);
  if (status) msgs = msgs.filter((m) => m.status === status);
  return msgs
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((m) => ({ ...m }));
}

/* ── Fee Estimation ────────────────────────────────────── */

// Heuristic base fees per chain (in USD equivalent)
const BASE_FEE = {
  ethereum: 5.0,
  polygon: 0.01,
  bsc: 0.1,
  arbitrum: 0.3,
  solana: 0.005,
};

export function estimateFee({ fromChain, toChain, amount }) {
  if (!_validateChain(fromChain) || !_validateChain(toChain))
    return { fee: null, reason: "unsupported_chain" };

  const baseFee = (BASE_FEE[fromChain] || 1.0) + (BASE_FEE[toChain] || 1.0);
  const percentageFee = amount * (DEFAULT_CONFIG.feePercentage / 100);
  const totalFee = Math.round((baseFee + percentageFee) * 1000) / 1000;

  return {
    fee: totalFee,
    breakdown: {
      sourceFee: BASE_FEE[fromChain] || 1.0,
      destFee: BASE_FEE[toChain] || 1.0,
      bridgeFee: Math.round(percentageFee * 1000) / 1000,
    },
    currency: "USD",
  };
}

/* ── Stats ─────────────────────────────────────────────── */

export function getCrossChainStats(db) {
  const bridges = [..._bridges.values()];
  const swaps = [..._swaps.values()];
  const msgs = [..._messages.values()];

  const bridgesByStatus = {};
  for (const b of bridges)
    bridgesByStatus[b.status] = (bridgesByStatus[b.status] || 0) + 1;

  const swapsByStatus = {};
  for (const s of swaps)
    swapsByStatus[s.status] = (swapsByStatus[s.status] || 0) + 1;

  const msgsByStatus = {};
  for (const m of msgs)
    msgsByStatus[m.status] = (msgsByStatus[m.status] || 0) + 1;

  let totalBridgeVolume = 0;
  let totalFees = 0;
  for (const b of bridges) {
    totalBridgeVolume += b.amount;
    totalFees += b.fee_amount;
  }

  return {
    bridges: {
      total: bridges.length,
      byStatus: bridgesByStatus,
      totalVolume: totalBridgeVolume,
      totalFees,
    },
    swaps: { total: swaps.length, byStatus: swapsByStatus },
    messages: { total: msgs.length, byStatus: msgsByStatus },
  };
}

/* ── Reset (tests) ─────────────────────────────────────── */

export function _resetState() {
  _bridges.clear();
  _swaps.clear();
  _messages.clear();
  _chainConfigs.clear();
  _maxActiveBridgesPerAddress = DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS;
}

/* ══════════════════════════════════════════════════════════
 * Phase 89 — Cross-Chain V2 surface (strictly additive)
 *
 * Adds canonical enums, per-address bridge concurrency cap,
 * chain config CRUD, patch-merged state-machine setters,
 * auto-expire swaps, and all-enum-key stats V2.
 * ══════════════════════════════════════════════════════════ */

/* ── V2 Frozen Enums ────────────────────────────────────── */

export const BRIDGE_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  LOCKED: "locked",
  MINTED: "minted",
  COMPLETED: "completed",
  REFUNDED: "refunded",
  FAILED: "failed",
});

export const SWAP_STATUS_V2 = Object.freeze({
  INITIATED: "initiated",
  HASH_LOCKED: "hash_locked",
  CLAIMED: "claimed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
});

export const MESSAGE_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  SENT: "sent",
  DELIVERED: "delivered",
  FAILED: "failed",
});

export const CHAIN_ID_V2 = Object.freeze({
  ETHEREUM: "ethereum",
  POLYGON: "polygon",
  BSC: "bsc",
  ARBITRUM: "arbitrum",
  SOLANA: "solana",
});

const DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS = 3;
export const CROSSCHAIN_DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS =
  DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS;

let _maxActiveBridgesPerAddress = DEFAULT_MAX_ACTIVE_BRIDGES_PER_ADDRESS;

/* ── State Machine Definitions ──────────────────────────── */

const BRIDGE_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["locked", "failed"])],
  ["locked", new Set(["minted", "refunded", "failed"])],
  ["minted", new Set(["completed", "failed"])],
]);
const BRIDGE_TERMINALS_V2 = new Set(["completed", "refunded", "failed"]);

const SWAP_TRANSITIONS_V2 = new Map([
  ["initiated", new Set(["hash_locked", "claimed", "refunded", "expired"])],
  ["hash_locked", new Set(["claimed", "refunded", "expired"])],
]);
const SWAP_TERMINALS_V2 = new Set(["claimed", "refunded", "expired"]);

const MESSAGE_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["sent", "failed"])],
  ["sent", new Set(["delivered", "failed"])],
  ["failed", new Set(["pending"])],
]);
const MESSAGE_TERMINALS_V2 = new Set(["delivered"]);

/* ── Concurrency Cap ───────────────────────────────────── */

export function setMaxActiveBridgesPerAddress(n) {
  if (typeof n !== "number" || Number.isNaN(n) || n < 1) {
    throw new Error("Max active bridges must be a positive integer");
  }
  _maxActiveBridgesPerAddress = Math.floor(n);
}

export function getMaxActiveBridgesPerAddress() {
  return _maxActiveBridgesPerAddress;
}

export function getActiveBridgeCount(address) {
  let count = 0;
  for (const b of _bridges.values()) {
    if (BRIDGE_TERMINALS_V2.has(b.status)) continue;
    if (address == null || b.sender_address === address) count += 1;
  }
  return count;
}

/* ── Chain Config V2 ───────────────────────────────────── */

export function configureChainV2({
  chainId,
  rpcUrl,
  contractAddress,
  enabled = true,
}) {
  if (!_validateChain(chainId)) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  const cfg = {
    chainId,
    rpcUrl: rpcUrl || null,
    contractAddress: contractAddress || null,
    enabled: enabled !== false,
    updatedAt: _now(),
  };
  _chainConfigs.set(chainId, cfg);
  return { ...cfg };
}

export function getChainConfigV2(chainId) {
  const cfg = _chainConfigs.get(chainId);
  return cfg ? { ...cfg } : null;
}

export function listChainsV2() {
  return Object.values(SUPPORTED_CHAINS).map((chain) => {
    const cfg = _chainConfigs.get(chain.id);
    return {
      ...chain,
      enabled: cfg ? cfg.enabled : false,
      rpcUrl: cfg ? cfg.rpcUrl : null,
      contractAddress: cfg ? cfg.contractAddress : null,
    };
  });
}

/* ── Bridge V2 (throws + cap enforcement) ──────────────── */

export function bridgeAssetV2(
  db,
  { fromChain, toChain, asset, amount, senderAddress, recipientAddress },
) {
  if (!_validateChain(fromChain)) {
    throw new Error(`Unsupported source chain: ${fromChain}`);
  }
  if (!_validateChain(toChain)) {
    throw new Error(`Unsupported destination chain: ${toChain}`);
  }
  if (fromChain === toChain) {
    throw new Error("Source and destination chains must differ");
  }
  if (!amount || amount <= 0) {
    throw new Error("Amount must be positive");
  }
  if (amount > DEFAULT_CONFIG.maxBridgeAmount) {
    throw new Error(
      `Amount ${amount} exceeds max ${DEFAULT_CONFIG.maxBridgeAmount}`,
    );
  }
  if (senderAddress) {
    const active = getActiveBridgeCount(senderAddress);
    if (active >= _maxActiveBridgesPerAddress) {
      throw new Error(
        `Max active bridges per address reached (${active}/${_maxActiveBridgesPerAddress})`,
      );
    }
  }

  const result = bridgeAsset(db, {
    fromChain,
    toChain,
    asset,
    amount,
    senderAddress,
    recipientAddress,
  });
  return result;
}

/* ── Generic patch-merged state setters ────────────────── */

export function setBridgeStatusV2(db, bridgeId, newStatus, patch = {}) {
  const b = _bridges.get(bridgeId);
  if (!b) throw new Error(`Bridge not found: ${bridgeId}`);

  const allowed = BRIDGE_TRANSITIONS_V2.get(b.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid bridge transition: ${b.status} → ${newStatus}`);
  }
  if (!Object.values(BRIDGE_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown bridge status: ${newStatus}`);
  }

  b.status = newStatus;
  if (patch.lockTxHash !== undefined) b.lock_tx_hash = patch.lockTxHash;
  if (patch.mintTxHash !== undefined) b.mint_tx_hash = patch.mintTxHash;
  if (patch.errorMessage !== undefined) b.error_message = patch.errorMessage;
  if (BRIDGE_TERMINALS_V2.has(newStatus) && !b.completed_at) {
    b.completed_at = _now();
  }

  db.prepare(
    `UPDATE cc_bridges SET status = ?, lock_tx_hash = ?, mint_tx_hash = ?,
     completed_at = ?, error_message = ? WHERE id = ?`,
  ).run(
    b.status,
    b.lock_tx_hash,
    b.mint_tx_hash,
    b.completed_at,
    b.error_message,
    bridgeId,
  );

  return { ...b };
}

export function setSwapStatusV2(db, swapId, newStatus, patch = {}) {
  const s = _swaps.get(swapId);
  if (!s) throw new Error(`Swap not found: ${swapId}`);

  const allowed = SWAP_TRANSITIONS_V2.get(s.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid swap transition: ${s.status} → ${newStatus}`);
  }
  if (!Object.values(SWAP_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown swap status: ${newStatus}`);
  }

  s.status = newStatus;
  if (patch.claimTxHash !== undefined) s.claim_tx_hash = patch.claimTxHash;
  if (patch.refundTxHash !== undefined) s.refund_tx_hash = patch.refundTxHash;

  db.prepare(
    `UPDATE cc_swaps SET status = ?, claim_tx_hash = ?, refund_tx_hash = ?
     WHERE id = ?`,
  ).run(s.status, s.claim_tx_hash, s.refund_tx_hash, swapId);

  const out = { ...s };
  delete out.secret;
  return out;
}

export function setMessageStatusV2(db, messageId, newStatus, patch = {}) {
  const m = _messages.get(messageId);
  if (!m) throw new Error(`Message not found: ${messageId}`);

  const allowed = MESSAGE_TRANSITIONS_V2.get(m.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid message transition: ${m.status} → ${newStatus}`);
  }
  if (!Object.values(MESSAGE_STATUS_V2).includes(newStatus)) {
    throw new Error(`Unknown message status: ${newStatus}`);
  }

  m.status = newStatus;
  if (patch.sourceTxHash !== undefined) m.source_tx_hash = patch.sourceTxHash;
  if (patch.destinationTxHash !== undefined)
    m.destination_tx_hash = patch.destinationTxHash;
  if (newStatus === "delivered" && !m.delivered_at) m.delivered_at = _now();
  if (newStatus === "pending") m.retries += 1;

  db.prepare(
    `UPDATE cc_messages SET status = ?, source_tx_hash = ?, destination_tx_hash = ?,
     delivered_at = ?, retries = ? WHERE id = ?`,
  ).run(
    m.status,
    m.source_tx_hash,
    m.destination_tx_hash,
    m.delivered_at,
    m.retries,
    messageId,
  );

  return { ...m };
}

/* ── Auto-expire swaps ─────────────────────────────────── */

export function autoExpireSwapsV2(db) {
  const now = _now();
  const expired = [];
  for (const s of _swaps.values()) {
    if (s.status !== "initiated" && s.status !== "hash_locked") continue;
    if (s.expires_at > now) continue;

    s.status = "expired";
    db.prepare("UPDATE cc_swaps SET status = ? WHERE id = ?").run(
      "expired",
      s.id,
    );
    const out = { ...s };
    delete out.secret;
    expired.push(out);
  }
  return expired;
}

/* ── Stats V2 ──────────────────────────────────────────── */

export function getCrossChainStatsV2() {
  const bridgesByStatus = {};
  for (const v of Object.values(BRIDGE_STATUS_V2)) bridgesByStatus[v] = 0;
  const swapsByStatus = {};
  for (const v of Object.values(SWAP_STATUS_V2)) swapsByStatus[v] = 0;
  const messagesByStatus = {};
  for (const v of Object.values(MESSAGE_STATUS_V2)) messagesByStatus[v] = 0;
  const chainUsage = {};
  for (const v of Object.values(CHAIN_ID_V2)) chainUsage[v] = 0;

  let totalBridgeVolume = 0;
  let totalFees = 0;
  let activeBridges = 0;
  for (const b of _bridges.values()) {
    bridgesByStatus[b.status] = (bridgesByStatus[b.status] || 0) + 1;
    chainUsage[b.from_chain] = (chainUsage[b.from_chain] || 0) + 1;
    chainUsage[b.to_chain] = (chainUsage[b.to_chain] || 0) + 1;
    totalBridgeVolume += b.amount;
    totalFees += b.fee_amount;
    if (!BRIDGE_TERMINALS_V2.has(b.status)) activeBridges += 1;
  }

  for (const s of _swaps.values()) {
    swapsByStatus[s.status] = (swapsByStatus[s.status] || 0) + 1;
    chainUsage[s.from_chain] = (chainUsage[s.from_chain] || 0) + 1;
    chainUsage[s.to_chain] = (chainUsage[s.to_chain] || 0) + 1;
  }

  for (const m of _messages.values()) {
    messagesByStatus[m.status] = (messagesByStatus[m.status] || 0) + 1;
    chainUsage[m.from_chain] = (chainUsage[m.from_chain] || 0) + 1;
    chainUsage[m.to_chain] = (chainUsage[m.to_chain] || 0) + 1;
  }

  return {
    totalBridges: _bridges.size,
    totalSwaps: _swaps.size,
    totalMessages: _messages.size,
    activeBridges,
    maxActiveBridgesPerAddress: _maxActiveBridgesPerAddress,
    bridgesByStatus,
    swapsByStatus,
    messagesByStatus,
    chainUsage,
    totalBridgeVolume,
    totalFees: Math.round(totalFees * 1000) / 1000,
    configuredChains: _chainConfigs.size,
  };
}

// ===== V2 Surface: Cross-Chain governance overlay (CLI v0.136.0) =====
export const XCHAIN_CHANNEL_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  DECOMMISSIONED: "decommissioned",
});
export const XCHAIN_TRANSFER_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RELAYING: "relaying",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _xcChanTrans = new Map([
  [
    XCHAIN_CHANNEL_MATURITY_V2.PENDING,
    new Set([
      XCHAIN_CHANNEL_MATURITY_V2.ACTIVE,
      XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED,
    ]),
  ],
  [
    XCHAIN_CHANNEL_MATURITY_V2.ACTIVE,
    new Set([
      XCHAIN_CHANNEL_MATURITY_V2.PAUSED,
      XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED,
    ]),
  ],
  [
    XCHAIN_CHANNEL_MATURITY_V2.PAUSED,
    new Set([
      XCHAIN_CHANNEL_MATURITY_V2.ACTIVE,
      XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED,
    ]),
  ],
  [XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED, new Set()],
]);
const _xcChanTerminal = new Set([XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED]);
const _xcTxTrans = new Map([
  [
    XCHAIN_TRANSFER_LIFECYCLE_V2.QUEUED,
    new Set([
      XCHAIN_TRANSFER_LIFECYCLE_V2.RELAYING,
      XCHAIN_TRANSFER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    XCHAIN_TRANSFER_LIFECYCLE_V2.RELAYING,
    new Set([
      XCHAIN_TRANSFER_LIFECYCLE_V2.CONFIRMED,
      XCHAIN_TRANSFER_LIFECYCLE_V2.FAILED,
      XCHAIN_TRANSFER_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [XCHAIN_TRANSFER_LIFECYCLE_V2.CONFIRMED, new Set()],
  [XCHAIN_TRANSFER_LIFECYCLE_V2.FAILED, new Set()],
  [XCHAIN_TRANSFER_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _xcChans = new Map();
const _xcTxs = new Map();
let _xcMaxActivePerOwner = 10;
let _xcMaxPendingPerChan = 20;
let _xcChanIdleMs = 24 * 60 * 60 * 1000;
let _xcTxStuckMs = 15 * 60 * 1000;

function _xcPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveXchainChannelsPerOwnerV2(n) {
  _xcMaxActivePerOwner = _xcPos(n, "maxActiveXchainChannelsPerOwner");
}
export function getMaxActiveXchainChannelsPerOwnerV2() {
  return _xcMaxActivePerOwner;
}
export function setMaxPendingXchainTransfersPerChannelV2(n) {
  _xcMaxPendingPerChan = _xcPos(n, "maxPendingXchainTransfersPerChannel");
}
export function getMaxPendingXchainTransfersPerChannelV2() {
  return _xcMaxPendingPerChan;
}
export function setXchainChannelIdleMsV2(n) {
  _xcChanIdleMs = _xcPos(n, "xchainChannelIdleMs");
}
export function getXchainChannelIdleMsV2() {
  return _xcChanIdleMs;
}
export function setXchainTransferStuckMsV2(n) {
  _xcTxStuckMs = _xcPos(n, "xchainTransferStuckMs");
}
export function getXchainTransferStuckMsV2() {
  return _xcTxStuckMs;
}

export function _resetStateCrossChainV2() {
  _xcChans.clear();
  _xcTxs.clear();
  _xcMaxActivePerOwner = 10;
  _xcMaxPendingPerChan = 20;
  _xcChanIdleMs = 24 * 60 * 60 * 1000;
  _xcTxStuckMs = 15 * 60 * 1000;
}

export function registerXchainChannelV2({
  id,
  owner,
  fromChain,
  toChain,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_xcChans.has(id))
    throw new Error(`xchain channel ${id} already registered`);
  const now = Date.now();
  const c = {
    id,
    owner,
    fromChain: fromChain || "",
    toChain: toChain || "",
    status: XCHAIN_CHANNEL_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    decommissionedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _xcChans.set(id, c);
  return { ...c, metadata: { ...c.metadata } };
}
function _xcCheckC(from, to) {
  const a = _xcChanTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid xchain channel transition ${from} → ${to}`);
}
function _xcCountActive(owner) {
  let n = 0;
  for (const c of _xcChans.values())
    if (c.owner === owner && c.status === XCHAIN_CHANNEL_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateXchainChannelV2(id) {
  const c = _xcChans.get(id);
  if (!c) throw new Error(`xchain channel ${id} not found`);
  _xcCheckC(c.status, XCHAIN_CHANNEL_MATURITY_V2.ACTIVE);
  const recovery = c.status === XCHAIN_CHANNEL_MATURITY_V2.PAUSED;
  if (!recovery) {
    const a = _xcCountActive(c.owner);
    if (a >= _xcMaxActivePerOwner)
      throw new Error(
        `max active xchain channels per owner (${_xcMaxActivePerOwner}) reached for ${c.owner}`,
      );
  }
  const now = Date.now();
  c.status = XCHAIN_CHANNEL_MATURITY_V2.ACTIVE;
  c.updatedAt = now;
  c.lastTouchedAt = now;
  if (!c.activatedAt) c.activatedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function pauseXchainChannelV2(id) {
  const c = _xcChans.get(id);
  if (!c) throw new Error(`xchain channel ${id} not found`);
  _xcCheckC(c.status, XCHAIN_CHANNEL_MATURITY_V2.PAUSED);
  c.status = XCHAIN_CHANNEL_MATURITY_V2.PAUSED;
  c.updatedAt = Date.now();
  return { ...c, metadata: { ...c.metadata } };
}
export function decommissionXchainChannelV2(id) {
  const c = _xcChans.get(id);
  if (!c) throw new Error(`xchain channel ${id} not found`);
  _xcCheckC(c.status, XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED);
  const now = Date.now();
  c.status = XCHAIN_CHANNEL_MATURITY_V2.DECOMMISSIONED;
  c.updatedAt = now;
  if (!c.decommissionedAt) c.decommissionedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function touchXchainChannelV2(id) {
  const c = _xcChans.get(id);
  if (!c) throw new Error(`xchain channel ${id} not found`);
  if (_xcChanTerminal.has(c.status))
    throw new Error(`cannot touch terminal xchain channel ${id}`);
  const now = Date.now();
  c.lastTouchedAt = now;
  c.updatedAt = now;
  return { ...c, metadata: { ...c.metadata } };
}
export function getXchainChannelV2(id) {
  const c = _xcChans.get(id);
  if (!c) return null;
  return { ...c, metadata: { ...c.metadata } };
}
export function listXchainChannelsV2() {
  return [..._xcChans.values()].map((c) => ({
    ...c,
    metadata: { ...c.metadata },
  }));
}

function _xcCountPending(cid) {
  let n = 0;
  for (const t of _xcTxs.values())
    if (
      t.channelId === cid &&
      (t.status === XCHAIN_TRANSFER_LIFECYCLE_V2.QUEUED ||
        t.status === XCHAIN_TRANSFER_LIFECYCLE_V2.RELAYING)
    )
      n++;
  return n;
}

export function createXchainTransferV2({
  id,
  channelId,
  amount,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!channelId || typeof channelId !== "string")
    throw new Error("channelId is required");
  if (_xcTxs.has(id)) throw new Error(`xchain transfer ${id} already exists`);
  if (!_xcChans.has(channelId))
    throw new Error(`xchain channel ${channelId} not found`);
  const pending = _xcCountPending(channelId);
  if (pending >= _xcMaxPendingPerChan)
    throw new Error(
      `max pending xchain transfers per channel (${_xcMaxPendingPerChan}) reached for ${channelId}`,
    );
  const now = Date.now();
  const t = {
    id,
    channelId,
    amount: amount || "0",
    status: XCHAIN_TRANSFER_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _xcTxs.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
function _xcCheckT(from, to) {
  const a = _xcTxTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid xchain transfer transition ${from} → ${to}`);
}
export function startXchainTransferV2(id) {
  const t = _xcTxs.get(id);
  if (!t) throw new Error(`xchain transfer ${id} not found`);
  _xcCheckT(t.status, XCHAIN_TRANSFER_LIFECYCLE_V2.RELAYING);
  const now = Date.now();
  t.status = XCHAIN_TRANSFER_LIFECYCLE_V2.RELAYING;
  t.updatedAt = now;
  if (!t.startedAt) t.startedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function confirmXchainTransferV2(id) {
  const t = _xcTxs.get(id);
  if (!t) throw new Error(`xchain transfer ${id} not found`);
  _xcCheckT(t.status, XCHAIN_TRANSFER_LIFECYCLE_V2.CONFIRMED);
  const now = Date.now();
  t.status = XCHAIN_TRANSFER_LIFECYCLE_V2.CONFIRMED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function failXchainTransferV2(id, reason) {
  const t = _xcTxs.get(id);
  if (!t) throw new Error(`xchain transfer ${id} not found`);
  _xcCheckT(t.status, XCHAIN_TRANSFER_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  t.status = XCHAIN_TRANSFER_LIFECYCLE_V2.FAILED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.failReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function cancelXchainTransferV2(id, reason) {
  const t = _xcTxs.get(id);
  if (!t) throw new Error(`xchain transfer ${id} not found`);
  _xcCheckT(t.status, XCHAIN_TRANSFER_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  t.status = XCHAIN_TRANSFER_LIFECYCLE_V2.CANCELLED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.cancelReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function getXchainTransferV2(id) {
  const t = _xcTxs.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listXchainTransfersV2() {
  return [..._xcTxs.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}

export function autoPauseIdleXchainChannelsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const c of _xcChans.values())
    if (
      c.status === XCHAIN_CHANNEL_MATURITY_V2.ACTIVE &&
      t - c.lastTouchedAt >= _xcChanIdleMs
    ) {
      c.status = XCHAIN_CHANNEL_MATURITY_V2.PAUSED;
      c.updatedAt = t;
      flipped.push(c.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckXchainTransfersV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const tx of _xcTxs.values())
    if (
      tx.status === XCHAIN_TRANSFER_LIFECYCLE_V2.RELAYING &&
      tx.startedAt != null &&
      t - tx.startedAt >= _xcTxStuckMs
    ) {
      tx.status = XCHAIN_TRANSFER_LIFECYCLE_V2.FAILED;
      tx.updatedAt = t;
      if (!tx.settledAt) tx.settledAt = t;
      tx.metadata.failReason = "auto-fail-stuck";
      flipped.push(tx.id);
    }
  return { flipped, count: flipped.length };
}

export function getCrossChainGovStatsV2() {
  const channelsByStatus = {};
  for (const s of Object.values(XCHAIN_CHANNEL_MATURITY_V2))
    channelsByStatus[s] = 0;
  for (const c of _xcChans.values()) channelsByStatus[c.status]++;
  const transfersByStatus = {};
  for (const s of Object.values(XCHAIN_TRANSFER_LIFECYCLE_V2))
    transfersByStatus[s] = 0;
  for (const t of _xcTxs.values()) transfersByStatus[t.status]++;
  return {
    totalChannelsV2: _xcChans.size,
    totalTransfersV2: _xcTxs.size,
    maxActiveXchainChannelsPerOwner: _xcMaxActivePerOwner,
    maxPendingXchainTransfersPerChannel: _xcMaxPendingPerChan,
    xchainChannelIdleMs: _xcChanIdleMs,
    xchainTransferStuckMs: _xcTxStuckMs,
    channelsByStatus,
    transfersByStatus,
  };
}
