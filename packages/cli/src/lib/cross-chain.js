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
}
