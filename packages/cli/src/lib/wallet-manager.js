/**
 * Wallet Manager — Digital wallet and asset management for CLI.
 * Uses Node.js crypto for key generation. Blockchain operations
 * are local-only (no real chain interaction without bridge).
 */

import crypto from "crypto";

/**
 * Ensure wallet tables exist.
 */
export function ensureWalletTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      name TEXT,
      wallet_type TEXT DEFAULT 'standard',
      public_key TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      balance TEXT DEFAULT '0',
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS digital_assets (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      amount TEXT DEFAULT '1',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      from_address TEXT,
      to_address TEXT,
      asset_id TEXT,
      amount TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Generate a wallet address from public key.
 */
export function generateAddress(publicKeyHex) {
  const hash = crypto
    .createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest();
  return `0x${hash.toString("hex").slice(0, 40)}`;
}

/**
 * Create a new wallet.
 */
export function createWallet(db, name, password) {
  ensureWalletTables(db);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const publicKeyHex = publicKey.toString("hex");
  const address = generateAddress(publicKeyHex);

  // Encrypt private key with password
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(
    password || "default",
    salt,
    100000,
    32,
    "sha256",
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  const encryptedKey = JSON.stringify({
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: tag.toString("hex"),
  });

  // First wallet is default
  const count = db.prepare("SELECT COUNT(*) as c FROM wallets").get().c;
  const isDefault = count === 0 ? 1 : 0;

  db.prepare(
    `INSERT INTO wallets (address, name, wallet_type, public_key, encrypted_key, balance, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    address,
    name || null,
    "standard",
    publicKeyHex,
    encryptedKey,
    "0",
    isDefault,
  );

  return {
    address,
    name,
    walletType: "standard",
    publicKey: publicKeyHex,
    balance: "0",
    isDefault: isDefault === 1,
  };
}

/**
 * Get a wallet by address.
 */
export function getWallet(db, address) {
  ensureWalletTables(db);
  return db.prepare("SELECT * FROM wallets WHERE address = ?").get(address);
}

/**
 * Get the default wallet.
 */
export function getDefaultWallet(db) {
  ensureWalletTables(db);
  return db.prepare("SELECT * FROM wallets WHERE is_default = 1").get();
}

/**
 * Get all wallets.
 */
export function getAllWallets(db) {
  ensureWalletTables(db);
  return db
    .prepare("SELECT * FROM wallets ORDER BY is_default DESC, created_at DESC")
    .all();
}

/**
 * Set a wallet as default.
 */
export function setDefaultWallet(db, address) {
  ensureWalletTables(db);
  const wallet = getWallet(db, address);
  if (!wallet) return false;

  db.prepare("UPDATE wallets SET is_default = 0 WHERE address LIKE ?").run("%");
  db.prepare("UPDATE wallets SET is_default = 1 WHERE address = ?").run(
    address,
  );
  return true;
}

/**
 * Delete a wallet.
 */
export function deleteWallet(db, address) {
  ensureWalletTables(db);
  const result = db
    .prepare("DELETE FROM wallets WHERE address = ?")
    .run(address);
  if (result.changes > 0) {
    // Promote next wallet to default
    const next = db
      .prepare("SELECT address FROM wallets ORDER BY created_at ASC LIMIT 1")
      .get();
    if (next) {
      db.prepare("UPDATE wallets SET is_default = 1 WHERE address = ?").run(
        next.address,
      );
    }
  }
  return result.changes > 0;
}

/**
 * Get wallet balance.
 */
export function getBalance(db, address) {
  ensureWalletTables(db);
  const wallet = getWallet(db, address);
  if (!wallet) return null;
  return { address, balance: wallet.balance, name: wallet.name };
}

/**
 * Create a digital asset.
 */
export function createAsset(
  db,
  walletAddress,
  assetType,
  name,
  description,
  metadata,
) {
  ensureWalletTables(db);
  const wallet = getWallet(db, walletAddress);
  if (!wallet) throw new Error(`Wallet not found: ${walletAddress}`);

  const id = `asset-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO digital_assets (id, wallet_address, asset_type, name, description, metadata, amount, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    walletAddress,
    assetType,
    name,
    description || null,
    metadata ? JSON.stringify(metadata) : null,
    "1",
    "active",
  );

  return {
    id,
    walletAddress,
    assetType,
    name,
    description,
    amount: "1",
    status: "active",
  };
}

/**
 * Get assets for a wallet.
 */
export function getAssets(db, walletAddress) {
  ensureWalletTables(db);
  return db
    .prepare(
      "SELECT * FROM digital_assets WHERE wallet_address = ? ORDER BY created_at DESC",
    )
    .all(walletAddress);
}

/**
 * Get all assets across all wallets.
 */
export function getAllAssets(db) {
  ensureWalletTables(db);
  return db
    .prepare("SELECT * FROM digital_assets ORDER BY created_at DESC")
    .all();
}

/**
 * Get asset by ID.
 */
export function getAsset(db, assetId) {
  ensureWalletTables(db);
  return db.prepare("SELECT * FROM digital_assets WHERE id = ?").get(assetId);
}

/**
 * Transfer an asset to another wallet.
 */
export function transferAsset(db, assetId, toAddress, amount) {
  ensureWalletTables(db);
  const asset = getAsset(db, assetId);
  if (!asset) throw new Error(`Asset not found: ${assetId}`);

  const txId = `tx-${crypto.randomBytes(8).toString("hex")}`;
  const fromAddress = asset.wallet_address;
  const txAmount = amount || asset.amount;

  db.prepare(
    `INSERT INTO transactions (id, from_address, to_address, asset_id, amount, tx_type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    txId,
    fromAddress,
    toAddress,
    assetId,
    txAmount,
    "transfer",
    "confirmed",
  );

  // Update asset ownership
  db.prepare("UPDATE digital_assets SET wallet_address = ? WHERE id = ?").run(
    toAddress,
    assetId,
  );

  return {
    txId,
    from: fromAddress,
    to: toAddress,
    assetId,
    amount: txAmount,
    status: "confirmed",
  };
}

/**
 * Get transaction history.
 */
export function getTransactions(db, options = {}) {
  ensureWalletTables(db);
  const { address, limit = 50 } = options;

  if (address) {
    return db
      .prepare(
        "SELECT * FROM transactions WHERE from_address = ? OR to_address = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(address, address, limit);
  }

  return db
    .prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

/**
 * Get wallet summary.
 */
export function getWalletSummary(db) {
  ensureWalletTables(db);
  const wallets = db.prepare("SELECT COUNT(*) as c FROM wallets").get();
  const assets = db.prepare("SELECT COUNT(*) as c FROM digital_assets").get();
  const txns = db.prepare("SELECT COUNT(*) as c FROM transactions").get();

  return {
    walletCount: wallets?.c || 0,
    assetCount: assets?.c || 0,
    transactionCount: txns?.c || 0,
  };
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — In-memory wallet-maturity + transaction-lifecycle
 * layer. Independent of the SQLite tables; tracks wallet
 * provisioning + tx submission/settlement with caps and auto-flip.
 * ═══════════════════════════════════════════════════════════════ */

export const WALLET_MATURITY_V2 = Object.freeze({
  PROVISIONAL: "provisional",
  ACTIVE: "active",
  FROZEN: "frozen",
  RETIRED: "retired",
});

export const TX_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  SUBMITTED: "submitted",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  REJECTED: "rejected",
});

const WALLET_TRANSITIONS_V2 = new Map([
  ["provisional", new Set(["active", "retired"])],
  ["active", new Set(["frozen", "retired"])],
  ["frozen", new Set(["active", "retired"])],
  ["retired", new Set()],
]);
const WALLET_TERMINALS_V2 = new Set(["retired"]);

const TX_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["submitted", "rejected"])],
  ["submitted", new Set(["confirmed", "failed"])],
  ["confirmed", new Set()],
  ["failed", new Set()],
  ["rejected", new Set()],
]);
const TX_TERMINALS_V2 = new Set(["confirmed", "failed", "rejected"]);

export const WALLET_DEFAULT_MAX_ACTIVE_WALLETS_PER_OWNER = 10;
export const WALLET_DEFAULT_MAX_PENDING_TX_PER_WALLET = 25;
export const WALLET_DEFAULT_WALLET_IDLE_MS = 1000 * 60 * 60 * 24 * 180; // 180 days
export const WALLET_DEFAULT_TX_STUCK_MS = 1000 * 60 * 60 * 24; // 1 day

const _walletsV2 = new Map();
const _txsV2 = new Map();
let _maxActiveWalletsPerOwnerV2 = WALLET_DEFAULT_MAX_ACTIVE_WALLETS_PER_OWNER;
let _maxPendingTxPerWalletV2 = WALLET_DEFAULT_MAX_PENDING_TX_PER_WALLET;
let _walletIdleMsV2 = WALLET_DEFAULT_WALLET_IDLE_MS;
let _txStuckMsV2 = WALLET_DEFAULT_TX_STUCK_MS;

function _posIntWalletV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveWalletsPerOwnerV2() {
  return _maxActiveWalletsPerOwnerV2;
}
export function setMaxActiveWalletsPerOwnerV2(n) {
  _maxActiveWalletsPerOwnerV2 = _posIntWalletV2(n, "maxActiveWalletsPerOwner");
}
export function getMaxPendingTxPerWalletV2() {
  return _maxPendingTxPerWalletV2;
}
export function setMaxPendingTxPerWalletV2(n) {
  _maxPendingTxPerWalletV2 = _posIntWalletV2(n, "maxPendingTxPerWallet");
}
export function getWalletIdleMsV2() {
  return _walletIdleMsV2;
}
export function setWalletIdleMsV2(n) {
  _walletIdleMsV2 = _posIntWalletV2(n, "walletIdleMs");
}
export function getTxStuckMsV2() {
  return _txStuckMsV2;
}
export function setTxStuckMsV2(n) {
  _txStuckMsV2 = _posIntWalletV2(n, "txStuckMs");
}

export function getActiveWalletCountV2(owner) {
  let n = 0;
  for (const w of _walletsV2.values()) {
    if (w.owner === owner && w.maturity === "active") n += 1;
  }
  return n;
}

export function getPendingTxCountV2(walletId) {
  let n = 0;
  for (const t of _txsV2.values()) {
    if (
      t.walletId === walletId &&
      (t.status === "pending" || t.status === "submitted")
    )
      n += 1;
  }
  return n;
}

function _copyWalletV2(w) {
  return { ...w, metadata: { ...w.metadata } };
}
function _copyTxV2(t) {
  return { ...t, metadata: { ...t.metadata } };
}

export function registerWalletV2(
  id,
  { owner, address, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!owner || typeof owner !== "string")
    throw new Error("owner must be a string");
  if (!address || typeof address !== "string")
    throw new Error("address must be a string");
  if (_walletsV2.has(id)) throw new Error(`wallet ${id} already exists`);
  const w = {
    id,
    owner,
    address,
    maturity: "provisional",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    metadata: { ...metadata },
  };
  _walletsV2.set(id, w);
  return _copyWalletV2(w);
}

export function getWalletV2(id) {
  const w = _walletsV2.get(id);
  return w ? _copyWalletV2(w) : null;
}

export function listWalletsV2({ owner, maturity } = {}) {
  const out = [];
  for (const w of _walletsV2.values()) {
    if (owner && w.owner !== owner) continue;
    if (maturity && w.maturity !== maturity) continue;
    out.push(_copyWalletV2(w));
  }
  return out;
}

export function setWalletMaturityV2(id, next, { now = Date.now() } = {}) {
  const w = _walletsV2.get(id);
  if (!w) throw new Error(`wallet ${id} not found`);
  if (!WALLET_TRANSITIONS_V2.has(next))
    throw new Error(`unknown wallet maturity: ${next}`);
  if (WALLET_TERMINALS_V2.has(w.maturity))
    throw new Error(`wallet ${id} is in terminal state ${w.maturity}`);
  const allowed = WALLET_TRANSITIONS_V2.get(w.maturity);
  if (!allowed.has(next))
    throw new Error(`cannot transition wallet from ${w.maturity} to ${next}`);
  if (next === "active") {
    if (w.maturity === "provisional") {
      const count = getActiveWalletCountV2(w.owner);
      if (count >= _maxActiveWalletsPerOwnerV2)
        throw new Error(
          `owner ${w.owner} already at active-wallet cap (${_maxActiveWalletsPerOwnerV2})`,
        );
    }
    if (!w.activatedAt) w.activatedAt = now;
  }
  w.maturity = next;
  w.lastSeenAt = now;
  return _copyWalletV2(w);
}

export function activateWalletV2(id, opts) {
  return setWalletMaturityV2(id, "active", opts);
}
export function freezeWalletV2(id, opts) {
  return setWalletMaturityV2(id, "frozen", opts);
}
export function retireWalletV2(id, opts) {
  return setWalletMaturityV2(id, "retired", opts);
}

export function touchWalletV2(id, { now = Date.now() } = {}) {
  const w = _walletsV2.get(id);
  if (!w) throw new Error(`wallet ${id} not found`);
  w.lastSeenAt = now;
  return _copyWalletV2(w);
}

export function createTxV2(
  id,
  { walletId, kind, amount, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!walletId || typeof walletId !== "string")
    throw new Error("walletId must be a string");
  if (!kind || typeof kind !== "string")
    throw new Error("kind must be a string");
  if (!_walletsV2.has(walletId))
    throw new Error(`wallet ${walletId} not found`);
  if (_txsV2.has(id)) throw new Error(`tx ${id} already exists`);
  const count = getPendingTxCountV2(walletId);
  if (count >= _maxPendingTxPerWalletV2)
    throw new Error(
      `wallet ${walletId} already at pending-tx cap (${_maxPendingTxPerWalletV2})`,
    );
  const t = {
    id,
    walletId,
    kind,
    amount: amount ?? null,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    submittedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _txsV2.set(id, t);
  return _copyTxV2(t);
}

export function getTxV2(id) {
  const t = _txsV2.get(id);
  return t ? _copyTxV2(t) : null;
}

export function listTxsV2({ walletId, status } = {}) {
  const out = [];
  for (const t of _txsV2.values()) {
    if (walletId && t.walletId !== walletId) continue;
    if (status && t.status !== status) continue;
    out.push(_copyTxV2(t));
  }
  return out;
}

export function setTxStatusV2(id, next, { now = Date.now() } = {}) {
  const t = _txsV2.get(id);
  if (!t) throw new Error(`tx ${id} not found`);
  if (!TX_TRANSITIONS_V2.has(next))
    throw new Error(`unknown tx status: ${next}`);
  if (TX_TERMINALS_V2.has(t.status))
    throw new Error(`tx ${id} is in terminal state ${t.status}`);
  const allowed = TX_TRANSITIONS_V2.get(t.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition tx from ${t.status} to ${next}`);
  if (next === "submitted" && !t.submittedAt) t.submittedAt = now;
  if (TX_TERMINALS_V2.has(next) && !t.settledAt) t.settledAt = now;
  t.status = next;
  t.lastSeenAt = now;
  return _copyTxV2(t);
}

export function submitTxV2(id, opts) {
  return setTxStatusV2(id, "submitted", opts);
}
export function confirmTxV2(id, opts) {
  return setTxStatusV2(id, "confirmed", opts);
}
export function failTxV2(id, opts) {
  return setTxStatusV2(id, "failed", opts);
}
export function rejectTxV2(id, opts) {
  return setTxStatusV2(id, "rejected", opts);
}

export function autoRetireIdleWalletsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const w of _walletsV2.values()) {
    if (w.maturity === "retired" || w.maturity === "provisional") continue;
    if (now - w.lastSeenAt > _walletIdleMsV2) {
      w.maturity = "retired";
      w.lastSeenAt = now;
      flipped.push(_copyWalletV2(w));
    }
  }
  return flipped;
}

export function autoFailStuckTxV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const t of _txsV2.values()) {
    if (t.status !== "submitted") continue;
    const ref = t.submittedAt ?? t.lastSeenAt;
    if (now - ref > _txStuckMsV2) {
      t.status = "failed";
      t.lastSeenAt = now;
      if (!t.settledAt) t.settledAt = now;
      flipped.push(_copyTxV2(t));
    }
  }
  return flipped;
}

export function getWalletManagerStatsV2() {
  const walletsByMaturity = {};
  for (const v of Object.values(WALLET_MATURITY_V2)) walletsByMaturity[v] = 0;
  for (const w of _walletsV2.values()) walletsByMaturity[w.maturity] += 1;

  const txsByStatus = {};
  for (const v of Object.values(TX_LIFECYCLE_V2)) txsByStatus[v] = 0;
  for (const t of _txsV2.values()) txsByStatus[t.status] += 1;

  return {
    totalWalletsV2: _walletsV2.size,
    totalTxsV2: _txsV2.size,
    maxActiveWalletsPerOwner: _maxActiveWalletsPerOwnerV2,
    maxPendingTxPerWallet: _maxPendingTxPerWalletV2,
    walletIdleMs: _walletIdleMsV2,
    txStuckMs: _txStuckMsV2,
    walletsByMaturity,
    txsByStatus,
  };
}

export function _resetStateWalletManagerV2() {
  _walletsV2.clear();
  _txsV2.clear();
  _maxActiveWalletsPerOwnerV2 = WALLET_DEFAULT_MAX_ACTIVE_WALLETS_PER_OWNER;
  _maxPendingTxPerWalletV2 = WALLET_DEFAULT_MAX_PENDING_TX_PER_WALLET;
  _walletIdleMsV2 = WALLET_DEFAULT_WALLET_IDLE_MS;
  _txStuckMsV2 = WALLET_DEFAULT_TX_STUCK_MS;
}
