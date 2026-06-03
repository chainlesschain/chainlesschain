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

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface Tests — wallet maturity + tx lifecycle
 * ═══════════════════════════════════════════════════════════════ */

import {
  WALLET_MATURITY_V2,
  TX_LIFECYCLE_V2,
  WALLET_DEFAULT_MAX_ACTIVE_WALLETS_PER_OWNER,
  WALLET_DEFAULT_MAX_PENDING_TX_PER_WALLET,
  WALLET_DEFAULT_WALLET_IDLE_MS,
  WALLET_DEFAULT_TX_STUCK_MS,
  getMaxActiveWalletsPerOwnerV2,
  setMaxActiveWalletsPerOwnerV2,
  getMaxPendingTxPerWalletV2,
  setMaxPendingTxPerWalletV2,
  getWalletIdleMsV2,
  setWalletIdleMsV2,
  getTxStuckMsV2,
  setTxStuckMsV2,
  getActiveWalletCountV2,
  getPendingTxCountV2,
  registerWalletV2,
  getWalletV2,
  listWalletsV2,
  setWalletMaturityV2,
  activateWalletV2,
  freezeWalletV2,
  retireWalletV2,
  touchWalletV2,
  createTxV2,
  getTxV2,
  listTxsV2,
  setTxStatusV2,
  submitTxV2,
  confirmTxV2,
  failTxV2,
  rejectTxV2,
  autoRetireIdleWalletsV2,
  autoFailStuckTxV2,
  getWalletManagerStatsV2,
  _resetStateWalletManagerV2,
} from "../../src/lib/wallet-manager.js";

describe("wallet-manager V2", () => {
  beforeEach(() => {
    _resetStateWalletManagerV2();
  });

  describe("enums + defaults", () => {
    it("exposes 4 wallet maturities + 5 tx statuses", () => {
      expect(Object.values(WALLET_MATURITY_V2)).toHaveLength(4);
      expect(Object.values(TX_LIFECYCLE_V2)).toHaveLength(5);
    });

    it("defaults match exported constants", () => {
      expect(getMaxActiveWalletsPerOwnerV2()).toBe(
        WALLET_DEFAULT_MAX_ACTIVE_WALLETS_PER_OWNER,
      );
      expect(getMaxPendingTxPerWalletV2()).toBe(
        WALLET_DEFAULT_MAX_PENDING_TX_PER_WALLET,
      );
      expect(getWalletIdleMsV2()).toBe(WALLET_DEFAULT_WALLET_IDLE_MS);
      expect(getTxStuckMsV2()).toBe(WALLET_DEFAULT_TX_STUCK_MS);
    });
  });

  describe("config setters", () => {
    it("accepts positive integers + floors floats", () => {
      setMaxActiveWalletsPerOwnerV2(7.9);
      setMaxPendingTxPerWalletV2(40.4);
      setWalletIdleMsV2(1000.7);
      setTxStuckMsV2(2000.9);
      expect(getMaxActiveWalletsPerOwnerV2()).toBe(7);
      expect(getMaxPendingTxPerWalletV2()).toBe(40);
      expect(getWalletIdleMsV2()).toBe(1000);
      expect(getTxStuckMsV2()).toBe(2000);
    });

    it("rejects ≤0 / NaN", () => {
      expect(() => setMaxActiveWalletsPerOwnerV2(0)).toThrow(/positive/);
      expect(() => setMaxPendingTxPerWalletV2(NaN)).toThrow(/positive/);
      expect(() => setWalletIdleMsV2(-1)).toThrow(/positive/);
      expect(() => setTxStuckMsV2("nope")).toThrow(/positive/);
    });
  });

  describe("registerWalletV2", () => {
    it("creates a provisional wallet with metadata copy", () => {
      const w = registerWalletV2("w1", {
        owner: "alice",
        address: "0xabc",
        metadata: { kind: "hot" },
      });
      expect(w.maturity).toBe("provisional");
      expect(w.activatedAt).toBeNull();
      expect(w.metadata).toEqual({ kind: "hot" });
    });

    it("rejects bad inputs + duplicates", () => {
      expect(() =>
        registerWalletV2("", { owner: "a", address: "x" }),
      ).toThrow();
      expect(() =>
        registerWalletV2("w", { owner: "", address: "x" }),
      ).toThrow();
      expect(() =>
        registerWalletV2("w", { owner: "a", address: "" }),
      ).toThrow();
      registerWalletV2("dup", { owner: "a", address: "x" });
      expect(() =>
        registerWalletV2("dup", { owner: "a", address: "x" }),
      ).toThrow(/already exists/);
    });

    it("returns defensive copies", () => {
      registerWalletV2("w", {
        owner: "a",
        address: "x",
        metadata: { x: 1 },
      });
      const got = getWalletV2("w");
      got.metadata.x = 999;
      expect(getWalletV2("w").metadata.x).toBe(1);
    });
  });

  describe("wallet maturity transitions", () => {
    beforeEach(() => {
      registerWalletV2("w1", { owner: "alice", address: "0x1" });
    });

    it("provisional → active stamps activatedAt once", () => {
      const a1 = activateWalletV2("w1", { now: 1000 });
      expect(a1.activatedAt).toBe(1000);
      freezeWalletV2("w1");
      const a2 = activateWalletV2("w1", { now: 3000 });
      expect(a2.activatedAt).toBe(1000);
    });

    it("active ↔ frozen recovery works", () => {
      activateWalletV2("w1");
      freezeWalletV2("w1");
      expect(getWalletV2("w1").maturity).toBe("frozen");
      activateWalletV2("w1");
      expect(getWalletV2("w1").maturity).toBe("active");
    });

    it("retired is terminal", () => {
      activateWalletV2("w1");
      retireWalletV2("w1");
      expect(() => activateWalletV2("w1")).toThrow(/terminal/);
    });

    it("rejects unknown next state", () => {
      expect(() => setWalletMaturityV2("w1", "bogus")).toThrow(/unknown/);
    });

    it("rejects illegal transitions", () => {
      expect(() => freezeWalletV2("w1")).toThrow(/cannot transition/);
    });

    it("throws on unknown id", () => {
      expect(() => activateWalletV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-owner active-wallet cap", () => {
    it("enforces cap on provisional → active", () => {
      setMaxActiveWalletsPerOwnerV2(2);
      registerWalletV2("a", { owner: "x", address: "1" });
      registerWalletV2("b", { owner: "x", address: "2" });
      registerWalletV2("c", { owner: "x", address: "3" });
      activateWalletV2("a");
      activateWalletV2("b");
      expect(() => activateWalletV2("c")).toThrow(/cap/);
    });

    it("does not enforce cap on frozen → active recovery", () => {
      setMaxActiveWalletsPerOwnerV2(1);
      registerWalletV2("a", { owner: "x", address: "1" });
      activateWalletV2("a");
      freezeWalletV2("a");
      expect(() => activateWalletV2("a")).not.toThrow();
    });

    it("getActiveWalletCountV2 counts only active", () => {
      registerWalletV2("a", { owner: "x", address: "1" });
      registerWalletV2("b", { owner: "x", address: "2" });
      activateWalletV2("a");
      activateWalletV2("b");
      freezeWalletV2("b");
      expect(getActiveWalletCountV2("x")).toBe(1);
    });
  });

  describe("touchWalletV2", () => {
    it("updates lastSeenAt", () => {
      registerWalletV2("w", { owner: "a", address: "x" });
      const t = touchWalletV2("w", { now: 5000 });
      expect(t.lastSeenAt).toBe(5000);
    });

    it("throws on unknown id", () => {
      expect(() => touchWalletV2("nope")).toThrow(/not found/);
    });
  });

  describe("createTxV2", () => {
    beforeEach(() => {
      registerWalletV2("w1", { owner: "a", address: "0x1" });
    });

    it("creates pending tx under existing wallet", () => {
      const t = createTxV2("t1", {
        walletId: "w1",
        kind: "transfer",
        amount: 100,
      });
      expect(t.status).toBe("pending");
      expect(t.amount).toBe(100);
    });

    it("rejects unknown wallet", () => {
      expect(() =>
        createTxV2("t", { walletId: "ghost", kind: "transfer" }),
      ).toThrow(/not found/);
    });

    it("rejects duplicate id", () => {
      createTxV2("t", { walletId: "w1", kind: "transfer" });
      expect(() =>
        createTxV2("t", { walletId: "w1", kind: "transfer" }),
      ).toThrow(/already exists/);
    });

    it("rejects bad inputs", () => {
      expect(() => createTxV2("", { walletId: "w1", kind: "x" })).toThrow();
      expect(() => createTxV2("z", { walletId: "", kind: "x" })).toThrow();
      expect(() => createTxV2("z", { walletId: "w1", kind: "" })).toThrow();
    });

    it("enforces per-wallet pending-tx cap at create time", () => {
      setMaxPendingTxPerWalletV2(2);
      createTxV2("a", { walletId: "w1", kind: "transfer" });
      createTxV2("b", { walletId: "w1", kind: "transfer" });
      expect(() =>
        createTxV2("c", { walletId: "w1", kind: "transfer" }),
      ).toThrow(/cap/);
    });
  });

  describe("tx lifecycle transitions", () => {
    beforeEach(() => {
      registerWalletV2("w1", { owner: "a", address: "0x1" });
      createTxV2("t1", { walletId: "w1", kind: "transfer" });
    });

    it("pending → submitted stamps submittedAt once", () => {
      const r = submitTxV2("t1", { now: 100 });
      expect(r.submittedAt).toBe(100);
    });

    it("submitted → confirmed stamps settledAt", () => {
      submitTxV2("t1");
      const r = confirmTxV2("t1", { now: 500 });
      expect(r.status).toBe("confirmed");
      expect(r.settledAt).toBe(500);
    });

    it("submitted → failed stamps settledAt", () => {
      submitTxV2("t1");
      const r = failTxV2("t1", { now: 600 });
      expect(r.status).toBe("failed");
      expect(r.settledAt).toBe(600);
    });

    it("pending → rejected stamps settledAt", () => {
      const r = rejectTxV2("t1", { now: 50 });
      expect(r.status).toBe("rejected");
      expect(r.settledAt).toBe(50);
    });

    it("terminals are sticky", () => {
      submitTxV2("t1");
      confirmTxV2("t1");
      expect(() => submitTxV2("t1")).toThrow(/terminal/);
    });

    it("pending → confirmed forbidden (must submit first)", () => {
      expect(() => confirmTxV2("t1")).toThrow(/cannot transition/);
    });

    it("rejects unknown next state", () => {
      expect(() => setTxStatusV2("t1", "bogus")).toThrow(/unknown/);
    });

    it("throws on unknown id", () => {
      expect(() => submitTxV2("ghost")).toThrow(/not found/);
    });
  });

  describe("getPendingTxCountV2", () => {
    it("counts pending + submitted", () => {
      registerWalletV2("w", { owner: "a", address: "x" });
      createTxV2("a", { walletId: "w", kind: "transfer" });
      createTxV2("b", { walletId: "w", kind: "transfer" });
      createTxV2("c", { walletId: "w", kind: "transfer" });
      submitTxV2("b");
      confirmTxV2("b");
      // a=pending, b=confirmed, c=pending → pending count = 2
      expect(getPendingTxCountV2("w")).toBe(2);
      submitTxV2("a");
      // a=submitted, c=pending → still 2
      expect(getPendingTxCountV2("w")).toBe(2);
    });
  });

  describe("listWalletsV2 / listTxsV2", () => {
    it("filters wallets by owner + maturity", () => {
      registerWalletV2("a", { owner: "x", address: "1" });
      registerWalletV2("b", { owner: "x", address: "2" });
      registerWalletV2("c", { owner: "y", address: "3" });
      activateWalletV2("a");
      expect(listWalletsV2({ owner: "x" })).toHaveLength(2);
      expect(listWalletsV2({ maturity: "active" })).toHaveLength(1);
    });

    it("filters txs by wallet + status", () => {
      registerWalletV2("w1", { owner: "a", address: "x" });
      createTxV2("t1", { walletId: "w1", kind: "transfer" });
      createTxV2("t2", { walletId: "w1", kind: "transfer" });
      submitTxV2("t1");
      expect(listTxsV2({ walletId: "w1" })).toHaveLength(2);
      expect(listTxsV2({ status: "submitted" })).toHaveLength(1);
      expect(listTxsV2({ status: "pending" })).toHaveLength(1);
    });
  });

  describe("autoRetireIdleWalletsV2", () => {
    it("retires non-provisional wallets whose lastSeenAt exceeds idle window", () => {
      setWalletIdleMsV2(1000);
      registerWalletV2("a", { owner: "x", address: "1", now: 0 });
      registerWalletV2("b", { owner: "x", address: "2", now: 0 });
      activateWalletV2("a", { now: 0 });
      activateWalletV2("b", { now: 5000 });
      const flipped = autoRetireIdleWalletsV2({ now: 2000 });
      expect(flipped.map((w) => w.id)).toEqual(["a"]);
      expect(getWalletV2("a").maturity).toBe("retired");
      expect(getWalletV2("b").maturity).toBe("active");
    });

    it("ignores provisional wallets", () => {
      setWalletIdleMsV2(1);
      registerWalletV2("p", { owner: "x", address: "1", now: 0 });
      const flipped = autoRetireIdleWalletsV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("autoFailStuckTxV2", () => {
    it("fails submitted txs whose submittedAt exceeds stuck window", () => {
      setTxStuckMsV2(1000);
      registerWalletV2("w", { owner: "a", address: "x", now: 0 });
      createTxV2("t1", { walletId: "w", kind: "transfer", now: 0 });
      createTxV2("t2", { walletId: "w", kind: "transfer", now: 0 });
      submitTxV2("t1", { now: 0 });
      submitTxV2("t2", { now: 5000 });
      const flipped = autoFailStuckTxV2({ now: 2000 });
      expect(flipped.map((t) => t.id)).toEqual(["t1"]);
      expect(getTxV2("t1").status).toBe("failed");
      expect(getTxV2("t1").settledAt).toBe(2000);
      expect(getTxV2("t2").status).toBe("submitted");
    });

    it("ignores pending or terminal txs", () => {
      setTxStuckMsV2(1);
      registerWalletV2("w", { owner: "a", address: "x", now: 0 });
      createTxV2("p", { walletId: "w", kind: "transfer", now: 0 });
      const flipped = autoFailStuckTxV2({ now: 1_000_000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getWalletManagerStatsV2", () => {
    it("zero-init all enum buckets", () => {
      const s = getWalletManagerStatsV2();
      expect(s.totalWalletsV2).toBe(0);
      expect(s.totalTxsV2).toBe(0);
      expect(s.walletsByMaturity).toEqual({
        provisional: 0,
        active: 0,
        frozen: 0,
        retired: 0,
      });
      expect(s.txsByStatus).toEqual({
        pending: 0,
        submitted: 0,
        confirmed: 0,
        failed: 0,
        rejected: 0,
      });
    });

    it("reflects live state", () => {
      registerWalletV2("w", { owner: "a", address: "x" });
      activateWalletV2("w");
      createTxV2("t1", { walletId: "w", kind: "transfer" });
      createTxV2("t2", { walletId: "w", kind: "transfer" });
      submitTxV2("t1");
      confirmTxV2("t1");
      rejectTxV2("t2");
      const s = getWalletManagerStatsV2();
      expect(s.totalWalletsV2).toBe(1);
      expect(s.totalTxsV2).toBe(2);
      expect(s.walletsByMaturity.active).toBe(1);
      expect(s.txsByStatus.confirmed).toBe(1);
      expect(s.txsByStatus.rejected).toBe(1);
    });
  });

  describe("_resetStateWalletManagerV2", () => {
    it("clears Maps + restores default config", () => {
      registerWalletV2("w", { owner: "a", address: "x" });
      setMaxActiveWalletsPerOwnerV2(99);
      _resetStateWalletManagerV2();
      expect(getWalletManagerStatsV2().totalWalletsV2).toBe(0);
      expect(getMaxActiveWalletsPerOwnerV2()).toBe(
        WALLET_DEFAULT_MAX_ACTIVE_WALLETS_PER_OWNER,
      );
    });
  });
});
