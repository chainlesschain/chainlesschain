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
