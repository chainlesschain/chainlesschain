/**
 * LightningPaymentManager 单元测试
 *
 * 覆盖：initialize、createChannel、closeChannel、sendPayment、
 *       createInvoice、payInvoice、getChannel、getChannelBalance、
 *       listChannels、listPayments、routePayment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { LightningPaymentManager } = require("../lightning-payment");

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

describe("LightningPaymentManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    manager = new LightningPaymentManager(mockDb, null);
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance", () => {
      expect(manager).toBeDefined();
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates 3 DB tables (channels, payments, invoices)", async () => {
      await manager.initialize();
      expect(mockDb.db.exec).toHaveBeenCalledTimes(3);
      const sqls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(sqls.some((s) => s.includes("lightning_channels"))).toBe(true);
      expect(sqls.some((s) => s.includes("lightning_payments"))).toBe(true);
      expect(sqls.some((s) => s.includes("lightning_invoices"))).toBe(true);
    });
  });

  // ── createChannel ─────────────────────────────────────────────────────────────

  describe("createChannel()", () => {
    const channelRow = {
      id: "ch-1",
      user_a: "alice",
      user_b: "bob",
      capacity: 1000,
      balance_a: 900,
      balance_b: 100,
      status: "open",
    };

    it("creates a payment channel", async () => {
      mockDb._prep.get.mockReturnValue(channelRow);
      await manager.initialize();
      const result = await manager.createChannel({
        userId: "alice",
        peerId: "bob",
        capacity: 1000,
        pushAmount: 100,
      });
      expect(result).toBeDefined();
      expect(result.status).toBe("open");
    });

    it("throws when capacity <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.createChannel({ userId: "alice", peerId: "bob", capacity: 0 }),
      ).rejects.toThrow("Capacity must be positive");
    });

    it("throws when pushAmount >= capacity", async () => {
      await manager.initialize();
      await expect(
        manager.createChannel({
          userId: "alice",
          peerId: "bob",
          capacity: 100,
          pushAmount: 100,
        }),
      ).rejects.toThrow("Push amount must be less than capacity");
    });

    it("throws when userId equals peerId", async () => {
      await manager.initialize();
      await expect(
        manager.createChannel({
          userId: "alice",
          peerId: "alice",
          capacity: 1000,
        }),
      ).rejects.toThrow("Cannot open channel with yourself");
    });

    it("throws when required fields missing", async () => {
      await manager.initialize();
      await expect(
        manager.createChannel({ userId: "alice" }), // missing peerId and capacity
      ).rejects.toThrow();
    });
  });

  // ── closeChannel ──────────────────────────────────────────────────────────────

  describe("closeChannel()", () => {
    const openChannel = {
      id: "ch-1",
      user_a: "alice",
      user_b: "bob",
      balance_a: 600,
      balance_b: 400,
      status: "open",
    };

    it("closes an open channel and returns updated channel", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(openChannel) // getChannel() in closeChannel
        .mockReturnValueOnce({ ...openChannel, status: "closed" }); // final getChannel()
      await manager.initialize();
      const result = await manager.closeChannel("ch-1");
      expect(result).toBeDefined();
      expect(mockDb._prep.run).toHaveBeenCalled();
    });

    it("throws when channel not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.closeChannel("nonexistent")).rejects.toThrow(
        "Channel not found",
      );
    });

    it("throws when channel is already closed", async () => {
      mockDb._prep.get.mockReturnValue({ ...openChannel, status: "closed" });
      await manager.initialize();
      await expect(manager.closeChannel("ch-1")).rejects.toThrow("not open");
    });
  });

  // ── sendPayment ───────────────────────────────────────────────────────────────

  describe("sendPayment()", () => {
    const openChannel = {
      id: "ch-1",
      user_a: "alice",
      user_b: "bob",
      balance_a: 600,
      balance_b: 400,
      capacity: 1000,
      status: "open",
    };

    it("sends payment from user_a to user_b", async () => {
      mockDb._prep.get.mockReturnValue(openChannel);
      await manager.initialize();
      const result = await manager.sendPayment({
        channelId: "ch-1",
        senderId: "alice",
        amount: 100,
        memo: "test payment",
      });
      expect(result).toBeDefined();
      expect(result.senderId).toBe("alice");
      expect(result.receiver).toBe("bob");
      expect(result.amount).toBe(100);
      expect(result.status).toBe("completed");
    });

    it("sends payment from user_b to user_a", async () => {
      mockDb._prep.get.mockReturnValue(openChannel);
      await manager.initialize();
      const result = await manager.sendPayment({
        channelId: "ch-1",
        senderId: "bob",
        amount: 50,
      });
      expect(result.receiver).toBe("alice");
    });

    it("throws when insufficient balance", async () => {
      mockDb._prep.get.mockReturnValue({ ...openChannel, balance_a: 50 });
      await manager.initialize();
      await expect(
        manager.sendPayment({
          channelId: "ch-1",
          senderId: "alice",
          amount: 100,
        }),
      ).rejects.toThrow("Insufficient channel balance");
    });

    it("throws when channel is closed", async () => {
      mockDb._prep.get.mockReturnValue({ ...openChannel, status: "closed" });
      await manager.initialize();
      await expect(
        manager.sendPayment({
          channelId: "ch-1",
          senderId: "alice",
          amount: 50,
        }),
      ).rejects.toThrow("not open");
    });

    it("throws when sender is not a channel participant", async () => {
      mockDb._prep.get.mockReturnValue(openChannel);
      await manager.initialize();
      await expect(
        manager.sendPayment({
          channelId: "ch-1",
          senderId: "charlie",
          amount: 50,
        }),
      ).rejects.toThrow("not a participant");
    });
  });

  // ── createInvoice ─────────────────────────────────────────────────────────────

  describe("createInvoice()", () => {
    it("creates an invoice with default expiry", async () => {
      await manager.initialize();
      const invoice = await manager.createInvoice({
        creatorId: "alice",
        amount: 500,
        description: "Payment for service",
      });
      expect(invoice).toBeDefined();
      expect(invoice.amount).toBe(500);
      expect(invoice.status).toBe("pending");
      expect(invoice.creatorId).toBe("alice");
    });

    it("throws when creatorId is missing", async () => {
      await manager.initialize();
      await expect(manager.createInvoice({ amount: 100 })).rejects.toThrow();
    });

    it("throws when amount is falsy", async () => {
      await manager.initialize();
      await expect(
        manager.createInvoice({ creatorId: "alice", amount: 0 }),
      ).rejects.toThrow();
    });
  });

  // ── payInvoice ────────────────────────────────────────────────────────────────

  describe("payInvoice()", () => {
    const validInvoice = {
      id: "inv-1",
      creator: "alice",
      amount: 100,
      description: "test",
      status: "pending",
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };
    const openChannel = {
      id: "ch-1",
      user_a: "bob",
      user_b: "alice",
      balance_a: 500,
      balance_b: 200,
      status: "open",
    };

    it("pays invoice via a channel", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(validInvoice) // invoice lookup
        .mockReturnValueOnce(openChannel); // channel lookup in sendPayment
      await manager.initialize();
      const result = await manager.payInvoice("inv-1", "bob", "ch-1");
      expect(result).toBeDefined();
      expect(result.invoiceId).toBe("inv-1");
    });

    it("throws when invoice not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(
        manager.payInvoice("nonexistent", "bob", "ch-1"),
      ).rejects.toThrow("Invoice not found");
    });

    it("throws when invoice is already paid", async () => {
      mockDb._prep.get.mockReturnValue({ ...validInvoice, status: "paid" });
      await manager.initialize();
      await expect(manager.payInvoice("inv-1", "bob", "ch-1")).rejects.toThrow(
        "already processed",
      );
    });

    it("throws when invoice is expired", async () => {
      mockDb._prep.get.mockReturnValue({
        ...validInvoice,
        expiry: Math.floor(Date.now() / 1000) - 1, // expired
      });
      await manager.initialize();
      await expect(manager.payInvoice("inv-1", "bob", "ch-1")).rejects.toThrow(
        "expired",
      );
    });
  });

  // ── getChannel ────────────────────────────────────────────────────────────────

  describe("getChannel()", () => {
    it("returns channel by id", () => {
      const ch = { id: "ch-1", user_a: "alice", user_b: "bob", status: "open" };
      mockDb._prep.get.mockReturnValue(ch);
      const result = manager.getChannel("ch-1");
      expect(result).toEqual(ch);
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getChannel("nonexistent")).toBeNull();
    });
  });

  // ── getChannelBalance ─────────────────────────────────────────────────────────

  describe("getChannelBalance()", () => {
    it("returns capacity, balanceA and balanceB", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "ch-1",
        capacity: 1000,
        balance_a: 700,
        balance_b: 300,
        status: "open",
      });
      await manager.initialize();
      const balance = await manager.getChannelBalance("ch-1");
      expect(balance).toBeDefined();
      expect(balance.capacity).toBe(1000);
      expect(balance.balanceA).toBe(700);
      expect(balance.balanceB).toBe(300);
    });

    it("returns null when channel not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      expect(await manager.getChannelBalance("nonexistent")).toBeNull();
    });
  });

  // ── listChannels ──────────────────────────────────────────────────────────────

  describe("listChannels()", () => {
    it("returns channels and total", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "ch-1", user_a: "alice", user_b: "bob", status: "open" },
      ]);
      mockDb._prep.get.mockReturnValue({ total: 1 });
      await manager.initialize();
      const result = await manager.listChannels("alice");
      expect(result.channels).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  // ── listPayments ──────────────────────────────────────────────────────────────

  describe("listPayments()", () => {
    it("returns payments and total", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "pay-1", sender: "alice", amount: 100 },
      ]);
      mockDb._prep.get.mockReturnValue({ total: 1 });
      await manager.initialize();
      const result = await manager.listPayments("alice", {});
      expect(result.payments).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  // ── routePayment ──────────────────────────────────────────────────────────────

  describe("routePayment()", () => {
    it("routes via direct channel when found", async () => {
      const directChannel = {
        id: "ch-1",
        user_a: "alice",
        user_b: "bob",
        balance_a: 500,
        balance_b: 200,
        status: "open",
      };
      // First call: direct channel lookup; second: sendPayment channel lookup
      mockDb._prep.get
        .mockReturnValueOnce(directChannel)
        .mockReturnValueOnce(directChannel);
      await manager.initialize();
      const result = await manager.routePayment({
        senderId: "alice",
        receiverId: "bob",
        amount: 50,
      });
      expect(result).toBeDefined();
      expect(result.senderId).toBe("alice");
    });

    it("returns null route when no direct channel", async () => {
      mockDb._prep.get.mockReturnValue(null); // no direct channel
      await manager.initialize();
      const result = await manager.routePayment({
        senderId: "alice",
        receiverId: "charlie",
        amount: 50,
      });
      expect(result.route).toBeNull();
    });
  });
});
