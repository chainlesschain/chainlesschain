/**
 * AtomicSwapManager 单元测试
 *
 * 覆盖：initialize、initiateSwap、acceptSwap、claimSwap、refundSwap、
 *       getSwap、listSwaps、matchSwapOrder、getSwapRates、_generateHTLC
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { AtomicSwapManager } = require("../atomic-swap-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    _prep: prepResult,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AtomicSwapManager", () => {
  let manager;
  let mockDb;

  // Helpers for timelock values in seconds (matching code expectation)
  const nowSec = () => Math.floor(Date.now() / 1000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    manager = new AtomicSwapManager(mockDb, null);
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with dependencies", () => {
      expect(manager).toBeDefined();
    });

    it("creates instance without bridge manager", () => {
      const m = new AtomicSwapManager(mockDb, null);
      expect(m).toBeDefined();
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates atomic_swaps DB table", async () => {
      await manager.initialize();
      expect(mockDb.db.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.db.exec.mock.calls[0][0];
      expect(sql).toContain("atomic_swaps");
    });

    it("sets initialized flag", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  // ── initiateSwap ──────────────────────────────────────────────────────────────

  describe("initiateSwap()", () => {
    const validParams = {
      initiator: "alice",
      counterparty: "bob",
      sendAsset: "BTC",
      sendAmount: 1.0,
      receiveAsset: "ETH",
      receiveAmount: 15.0,
    };

    it("initiates a swap with HTLC and does not expose secret", async () => {
      await manager.initialize();
      const swap = await manager.initiateSwap(validParams);
      expect(swap).toBeDefined();
      expect(swap.id).toBeDefined();
      expect(swap.status).toBe("initiated");
      expect(swap.hashLock).toBeDefined();
      expect(swap.secret).toBeUndefined(); // secret must not be in return value
    });

    it("throws when initiator equals counterparty", async () => {
      await manager.initialize();
      await expect(
        manager.initiateSwap({ ...validParams, counterparty: "alice" }),
      ).rejects.toThrow("Cannot swap with self");
    });

    it("throws when sendAmount <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.initiateSwap({ ...validParams, sendAmount: 0 }),
      ).rejects.toThrow("Missing required fields");
    });

    it("throws when receiveAmount <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.initiateSwap({ ...validParams, receiveAmount: 0 }),
      ).rejects.toThrow("Missing required fields");
    });

    it("throws when sendAsset equals receiveAsset", async () => {
      await manager.initialize();
      await expect(
        manager.initiateSwap({ ...validParams, receiveAsset: "BTC" }),
      ).rejects.toThrow("Cannot swap same assets");
    });

    it("throws when required fields are missing", async () => {
      await manager.initialize();
      await expect(
        manager.initiateSwap({ initiator: "alice" }),
      ).rejects.toThrow("Missing required fields");
    });
  });

  // ── acceptSwap ────────────────────────────────────────────────────────────────

  describe("acceptSwap()", () => {
    // timelock must be in seconds (Unix timestamp), not milliseconds
    const initiatedSwap = {
      id: "swap-1",
      initiator: "alice",
      counterparty: "bob",
      send_asset: "BTC",
      send_amount: 1.0,
      receive_asset: "ETH",
      receive_amount: 15.0,
      hash_lock: "abc123hashlock",
      timelock: nowSec() + 86400, // 24 hours from now (in seconds)
      status: "initiated",
    };

    it("counterparty accepts swap and returns swap object", async () => {
      // getSwap() is called at the end of acceptSwap
      const acceptedSwap = { ...initiatedSwap, status: "accepted" };
      mockDb._prep.get
        .mockReturnValueOnce(initiatedSwap) // first .get() in acceptSwap
        .mockReturnValueOnce(acceptedSwap); // getSwap() at end
      await manager.initialize();
      const result = await manager.acceptSwap("swap-1", "bob");
      expect(result).toBeDefined();
      expect(result.status).toBe("accepted");
    });

    it("throws when swap not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.acceptSwap("nonexistent", "bob")).rejects.toThrow(
        "Swap not found",
      );
    });

    it("throws when wrong counterparty tries to accept", async () => {
      mockDb._prep.get.mockReturnValue(initiatedSwap);
      await manager.initialize();
      await expect(manager.acceptSwap("swap-1", "charlie")).rejects.toThrow(
        "Only designated counterparty can accept",
      );
    });

    it("throws when swap is already accepted", async () => {
      mockDb._prep.get.mockReturnValue({
        ...initiatedSwap,
        status: "accepted",
      });
      await manager.initialize();
      await expect(manager.acceptSwap("swap-1", "bob")).rejects.toThrow(
        "not in initiated state",
      );
    });

    it("throws when swap timelock has expired", async () => {
      mockDb._prep.get.mockReturnValue({
        ...initiatedSwap,
        timelock: nowSec() - 1000, // expired (in seconds)
      });
      await manager.initialize();
      await expect(manager.acceptSwap("swap-1", "bob")).rejects.toThrow(
        "expired",
      );
    });
  });

  // ── claimSwap ─────────────────────────────────────────────────────────────────

  describe("claimSwap()", () => {
    it("claims swap with correct secret and returns swap object", async () => {
      const crypto = require("crypto");
      const secret = "my-secret-key-123";
      // Implementation uses .update(secret) without encoding
      const hashLock = crypto.createHash("sha256").update(secret).digest("hex");

      const acceptedSwap = {
        id: "swap-1",
        initiator: "alice",
        counterparty: "bob",
        hash_lock: hashLock,
        secret: null,
        timelock: nowSec() + 86400,
        status: "accepted",
      };
      const claimedSwap = { ...acceptedSwap, status: "claimed" };
      // claimSwap: first .get() for swap; getSwap() at end: another .get()
      mockDb._prep.get
        .mockReturnValueOnce(acceptedSwap) // initial swap fetch
        .mockReturnValueOnce(claimedSwap); // getSwap() at end
      await manager.initialize();
      const result = await manager.claimSwap("swap-1", secret);
      expect(result).toBeDefined();
      expect(result.status).toBe("claimed");
    });

    it("throws when secret does not match hash lock", async () => {
      const crypto = require("crypto");
      const hashLock = crypto
        .createHash("sha256")
        .update("real-secret")
        .digest("hex");

      mockDb._prep.get.mockReturnValue({
        id: "swap-1",
        hash_lock: hashLock,
        timelock: nowSec() + 86400,
        status: "accepted",
      });
      await manager.initialize();
      await expect(manager.claimSwap("swap-1", "wrong-secret")).rejects.toThrow(
        "Invalid secret",
      );
    });

    it("throws when swap is not in accepted status", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "swap-1",
        hash_lock: "somehash",
        timelock: nowSec() + 86400,
        status: "initiated",
      });
      await manager.initialize();
      await expect(manager.claimSwap("swap-1", "any-secret")).rejects.toThrow(
        "not accepted",
      );
    });
  });

  // ── refundSwap ────────────────────────────────────────────────────────────────

  describe("refundSwap()", () => {
    it("refunds swap after timelock expires and returns swap object", async () => {
      const expiredSwap = {
        id: "swap-1",
        initiator: "alice",
        timelock: nowSec() - 1000, // expired (in seconds)
        status: "initiated",
      };
      const refundedSwap = { ...expiredSwap, status: "refunded" };
      // refundSwap: first .get() for swap; getSwap() at end: another .get()
      mockDb._prep.get
        .mockReturnValueOnce(expiredSwap) // initial swap fetch
        .mockReturnValueOnce(refundedSwap); // getSwap() at end
      await manager.initialize();
      const result = await manager.refundSwap("swap-1");
      expect(result).toBeDefined();
      expect(result.status).toBe("refunded");
    });

    it("throws when timelock has not expired yet", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "swap-1",
        initiator: "alice",
        timelock: nowSec() + 86400, // still valid (in seconds)
        status: "initiated",
      });
      await manager.initialize();
      await expect(manager.refundSwap("swap-1")).rejects.toThrow(
        "not expired yet",
      );
    });

    it("throws when swap is already claimed", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "swap-1",
        timelock: nowSec() - 1000,
        status: "claimed",
      });
      await manager.initialize();
      await expect(manager.refundSwap("swap-1")).rejects.toThrow(
        "already claimed",
      );
    });

    it("throws when swap is already refunded", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "swap-1",
        timelock: nowSec() - 1000,
        status: "refunded",
      });
      await manager.initialize();
      await expect(manager.refundSwap("swap-1")).rejects.toThrow(
        "already refunded",
      );
    });

    it("throws when swap not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.refundSwap("nonexistent")).rejects.toThrow(
        "Swap not found",
      );
    });
  });

  // ── getSwap ───────────────────────────────────────────────────────────────────

  describe("getSwap()", () => {
    it("returns swap without secret field", () => {
      mockDb._prep.get.mockReturnValue({
        id: "swap-1",
        initiator: "alice",
        counterparty: "bob",
        secret: "hidden-secret-value",
        status: "accepted",
      });
      const swap = manager.getSwap("swap-1");
      expect(swap).toBeDefined();
      expect(swap.id).toBe("swap-1");
      expect(swap.secret).toBeUndefined(); // secret stripped
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getSwap("nonexistent")).toBeNull();
    });
  });

  // ── listSwaps ─────────────────────────────────────────────────────────────────

  describe("listSwaps()", () => {
    it("returns swaps with secrets stripped and total count", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "swap-1", initiator: "user-1", status: "claimed", secret: "s1" },
        {
          id: "swap-2",
          counterparty: "user-1",
          status: "initiated",
          secret: "s2",
        },
      ]);
      mockDb._prep.get.mockReturnValue({ total: 2 });
      await manager.initialize();
      const result = await manager.listSwaps("user-1", {});
      expect(result.swaps).toHaveLength(2);
      expect(result.total).toBe(2);
      result.swaps.forEach((s) => expect(s.secret).toBeUndefined());
    });

    it("filters by status", async () => {
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.get.mockReturnValue({ total: 0 });
      await manager.initialize();
      const result = await manager.listSwaps("user-1", { status: "initiated" });
      expect(result.swaps).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ── matchSwapOrder ────────────────────────────────────────────────────────────

  describe("matchSwapOrder()", () => {
    it("finds matching counter orders", async () => {
      mockDb._prep.all.mockReturnValue([
        {
          id: "swap-match",
          initiator: "charlie",
          send_asset: "ETH",
          send_amount: 15.0,
          receive_asset: "BTC",
          receive_amount: 1.0,
          status: "initiated",
        },
      ]);
      await manager.initialize();
      const matches = await manager.matchSwapOrder({
        sendAsset: "BTC",
        sendAmount: 1.0,
        receiveAsset: "ETH",
        receiveAmount: 15.0,
      });
      expect(matches).toBeInstanceOf(Array);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].sendAsset).toBe("ETH");
    });

    it("returns empty array when no matches found", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const matches = await manager.matchSwapOrder({
        sendAsset: "DOGE",
        sendAmount: 1000,
        receiveAsset: "BTC",
        receiveAmount: 0.001,
      });
      expect(matches).toHaveLength(0);
    });
  });

  // ── getSwapRates ──────────────────────────────────────────────────────────────

  describe("getSwapRates()", () => {
    it("returns rates object from completed swaps", async () => {
      mockDb._prep.all.mockReturnValue([
        {
          send_asset: "BTC",
          receive_asset: "ETH",
          send_amount: 1.0,
          receive_amount: 15.0,
        },
      ]);
      await manager.initialize();
      const rates = await manager.getSwapRates();
      expect(rates).toBeDefined();
      expect(typeof rates).toBe("object");
      expect(rates["BTC/ETH"]).toBeDefined();
      expect(rates["BTC/ETH"].rate).toBe(15.0);
    });

    it("returns empty object when no completed swaps", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const rates = await manager.getSwapRates();
      expect(Object.keys(rates)).toHaveLength(0);
    });
  });

  // ── _generateHTLC ─────────────────────────────────────────────────────────────

  describe("_generateHTLC()", () => {
    it("generates SHA-256 hash lock from secret", () => {
      const crypto = require("crypto");
      const secret = "test-secret";
      // Implementation uses .update(secret) treating as UTF-8 string
      const expected = crypto.createHash("sha256").update(secret).digest("hex");
      const result = manager._generateHTLC(secret);
      expect(result).toBe(expected);
    });

    it("produces different hashes for different secrets", () => {
      const hash1 = manager._generateHTLC("secret-one");
      const hash2 = manager._generateHTLC("secret-two");
      expect(hash1).not.toBe(hash2);
    });
  });
});
