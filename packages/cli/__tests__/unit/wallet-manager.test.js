import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureWalletTables,
  generateAddress,
  createWallet,
  getWallet,
  getDefaultWallet,
  getAllWallets,
  setDefaultWallet,
  deleteWallet,
  getBalance,
  createAsset,
  getAssets,
  getAllAssets,
  getAsset,
  transferAsset,
  getTransactions,
  getWalletSummary,
} from "../../src/lib/wallet-manager.js";

describe("Wallet Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureWalletTables ───────────────────────────────

  describe("ensureWalletTables", () => {
    it("should create wallet tables", () => {
      ensureWalletTables(db);
      expect(db.tables.has("wallets")).toBe(true);
      expect(db.tables.has("digital_assets")).toBe(true);
      expect(db.tables.has("transactions")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureWalletTables(db);
      ensureWalletTables(db);
      expect(db.tables.has("wallets")).toBe(true);
    });
  });

  // ─── generateAddress ──────────────────────────────────

  describe("generateAddress", () => {
    it("should generate an address starting with 0x", () => {
      const addr = generateAddress("abcdef1234567890");
      expect(addr).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should be consistent for same input", () => {
      expect(generateAddress("abc")).toBe(generateAddress("abc"));
    });

    it("should be different for different input", () => {
      expect(generateAddress("aaa")).not.toBe(generateAddress("bbb"));
    });
  });

  // ─── createWallet ─────────────────────────────────────

  describe("createWallet", () => {
    it("should create a wallet", () => {
      const w = createWallet(db, "My Wallet", "password123");
      expect(w.address).toMatch(/^0x/);
      expect(w.name).toBe("My Wallet");
      expect(w.balance).toBe("0");
      expect(w.walletType).toBe("standard");
    });

    it("should set first wallet as default", () => {
      const w = createWallet(db, "First");
      expect(w.isDefault).toBe(true);
    });

    it("should not set subsequent wallets as default", () => {
      createWallet(db, "First");
      const second = createWallet(db, "Second");
      expect(second.isDefault).toBe(false);
    });

    it("should create wallet without name", () => {
      const w = createWallet(db);
      expect(w.address).toMatch(/^0x/);
    });
  });

  // ─── getWallet ────────────────────────────────────────

  describe("getWallet", () => {
    it("should find a wallet by address", () => {
      const w = createWallet(db, "Test");
      const found = getWallet(db, w.address);
      expect(found).toBeDefined();
      expect(found.address).toBe(w.address);
    });

    it("should return null for non-existent wallet", () => {
      ensureWalletTables(db);
      expect(getWallet(db, "0xnonexistent")).toBeNull();
    });
  });

  // ─── getAllWallets ────────────────────────────────────

  describe("getAllWallets", () => {
    it("should return all wallets", () => {
      createWallet(db, "W1");
      createWallet(db, "W2");
      expect(getAllWallets(db)).toHaveLength(2);
    });

    it("should return empty when no wallets", () => {
      ensureWalletTables(db);
      expect(getAllWallets(db)).toHaveLength(0);
    });
  });

  // ─── setDefaultWallet ─────────────────────────────────

  describe("setDefaultWallet", () => {
    it("should set a wallet as default", () => {
      createWallet(db, "W1");
      const w2 = createWallet(db, "W2");
      const ok = setDefaultWallet(db, w2.address);
      expect(ok).toBe(true);
    });

    it("should return false for non-existent wallet", () => {
      ensureWalletTables(db);
      expect(setDefaultWallet(db, "0xnope")).toBe(false);
    });
  });

  // ─── deleteWallet ─────────────────────────────────────

  describe("deleteWallet", () => {
    it("should delete a wallet", () => {
      const w = createWallet(db, "Test");
      const ok = deleteWallet(db, w.address);
      expect(ok).toBe(true);
      expect(getWallet(db, w.address)).toBeNull();
    });

    it("should return false for non-existent wallet", () => {
      ensureWalletTables(db);
      expect(deleteWallet(db, "0xnope")).toBe(false);
    });
  });

  // ─── getBalance ───────────────────────────────────────

  describe("getBalance", () => {
    it("should return wallet balance", () => {
      const w = createWallet(db, "Test");
      const bal = getBalance(db, w.address);
      expect(bal.balance).toBe("0");
      expect(bal.address).toBe(w.address);
    });

    it("should return null for non-existent wallet", () => {
      ensureWalletTables(db);
      expect(getBalance(db, "0xnope")).toBeNull();
    });
  });

  // ─── createAsset ──────────────────────────────────────

  describe("createAsset", () => {
    it("should create a digital asset", () => {
      const w = createWallet(db, "Test");
      const asset = createAsset(
        db,
        w.address,
        "token",
        "MyToken",
        "A test token",
      );
      expect(asset.id).toMatch(/^asset-/);
      expect(asset.name).toBe("MyToken");
      expect(asset.assetType).toBe("token");
    });

    it("should throw for non-existent wallet", () => {
      ensureWalletTables(db);
      expect(() => createAsset(db, "0xnope", "token", "Test")).toThrow(
        "Wallet not found",
      );
    });
  });

  // ─── getAssets / getAllAssets ──────────────────────────

  describe("getAssets", () => {
    it("should get assets for a wallet", () => {
      const w = createWallet(db, "Test");
      createAsset(db, w.address, "token", "T1");
      createAsset(db, w.address, "nft", "N1");
      const assets = getAssets(db, w.address);
      expect(assets).toHaveLength(2);
    });
  });

  describe("getAllAssets", () => {
    it("should get all assets", () => {
      const w1 = createWallet(db, "W1");
      const w2 = createWallet(db, "W2");
      createAsset(db, w1.address, "token", "T1");
      createAsset(db, w2.address, "nft", "N1");
      expect(getAllAssets(db)).toHaveLength(2);
    });
  });

  // ─── transferAsset ────────────────────────────────────

  describe("transferAsset", () => {
    it("should transfer an asset", () => {
      const w1 = createWallet(db, "W1");
      const w2 = createWallet(db, "W2");
      const asset = createAsset(db, w1.address, "token", "T1");
      const tx = transferAsset(db, asset.id, w2.address);

      expect(tx.txId).toMatch(/^tx-/);
      expect(tx.from).toBe(w1.address);
      expect(tx.to).toBe(w2.address);
      expect(tx.status).toBe("confirmed");
    });

    it("should throw for non-existent asset", () => {
      ensureWalletTables(db);
      expect(() => transferAsset(db, "asset-nope", "0xabc")).toThrow(
        "Asset not found",
      );
    });
  });

  // ─── getTransactions ──────────────────────────────────

  describe("getTransactions", () => {
    it("should return transactions", () => {
      const w1 = createWallet(db, "W1");
      const w2 = createWallet(db, "W2");
      const asset = createAsset(db, w1.address, "token", "T1");
      transferAsset(db, asset.id, w2.address);
      const txns = getTransactions(db);
      expect(txns).toHaveLength(1);
    });

    it("should return empty when no transactions", () => {
      ensureWalletTables(db);
      expect(getTransactions(db)).toHaveLength(0);
    });
  });

  // ─── getWalletSummary ─────────────────────────────────

  describe("getWalletSummary", () => {
    it("should return summary statistics", () => {
      const w = createWallet(db, "Test");
      createAsset(db, w.address, "token", "T1");
      const summary = getWalletSummary(db);
      expect(summary.walletCount).toBe(1);
      expect(summary.assetCount).toBe(1);
      expect(summary.transactionCount).toBe(0);
    });

    it("should return zeroes when empty", () => {
      ensureWalletTables(db);
      const summary = getWalletSummary(db);
      expect(summary.walletCount).toBe(0);
      expect(summary.assetCount).toBe(0);
    });
  });
});
