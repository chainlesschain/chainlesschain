/**
 * InstallmentManager 单元测试
 *
 * 覆盖：initialize、createPlan、approvePlan、makePayment、getPlan、
 *       listPlans、checkOverdue、handleDefault、getSchedule
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { InstallmentManager } = require("../installment-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrepResult(overrides = {}) {
  return {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
    ...overrides,
  };
}

function createMockDatabase() {
  const prepResult = makePrepResult();
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

function createMockEscrowManager() {
  return {
    createEscrow: vi.fn().mockResolvedValue({ id: "escrow-1" }),
    releaseEscrow: vi.fn().mockResolvedValue({ success: true }),
    refundEscrow: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockCreditScoreManager() {
  return {
    getScore: vi.fn().mockResolvedValue({ level: 3, score: 700 }),
    updateScore: vi.fn().mockResolvedValue({ success: true }),
    recordEvent: vi.fn().mockResolvedValue({ success: true }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InstallmentManager", () => {
  let manager;
  let mockDb;
  let mockEscrow;
  let mockCreditScore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    mockEscrow = createMockEscrowManager();
    mockCreditScore = createMockCreditScoreManager();
    manager = new InstallmentManager(mockDb, mockEscrow, mockCreditScore);
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with dependencies", () => {
      expect(manager).toBeDefined();
      expect(manager.database).toBe(mockDb);
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates installment_plans and installment_payments tables (2 exec calls)", async () => {
      await manager.initialize();
      expect(mockDb.db.exec).toHaveBeenCalledTimes(2);
      const sqls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(sqls.some((s) => s.includes("installment_plans"))).toBe(true);
      expect(sqls.some((s) => s.includes("installment_payments"))).toBe(true);
    });

    it("sets initialized flag", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  // ── createPlan ────────────────────────────────────────────────────────────────

  describe("createPlan()", () => {
    const validParams = {
      orderId: "order-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      totalAmount: 1000,
      installments: 3,
      interestRate: 0.05,
    };

    it("creates installment plan and returns plan object", async () => {
      // getPlan() is sync and calls db.prepare().get() then .all()
      const planRow = {
        id: "test-uuid-1234",
        buyer_id: "buyer-1",
        total_amount: 1000,
        installments: 3,
        status: "pending",
        paid_count: 0,
        paid_amount: 0,
        credit_check_result: null,
      };
      mockDb._prep.get.mockReturnValue(planRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const plan = await manager.createPlan(validParams);
      expect(plan).toBeDefined();
      expect(plan.buyer_id).toBe("buyer-1");
    });

    it("throws when required fields are missing", async () => {
      await manager.initialize();
      await expect(
        manager.createPlan({ orderId: "o1", buyerId: "b1" }), // missing sellerId, totalAmount
      ).rejects.toThrow("Missing required fields");
    });

    it("throws when installments < 2", async () => {
      await manager.initialize();
      await expect(
        manager.createPlan({ ...validParams, installments: 1 }),
      ).rejects.toThrow("Installments must be between 2 and 24");
    });

    it("throws when installments > 24", async () => {
      await manager.initialize();
      await expect(
        manager.createPlan({ ...validParams, installments: 25 }),
      ).rejects.toThrow("Installments must be between 2 and 24");
    });

    it("throws when interest rate is negative", async () => {
      await manager.initialize();
      await expect(
        manager.createPlan({ ...validParams, interestRate: -0.01 }),
      ).rejects.toThrow("Interest rate cannot be negative");
    });
  });

  // ── approvePlan ───────────────────────────────────────────────────────────────

  describe("approvePlan()", () => {
    const pendingPlanRow = {
      id: "plan-1",
      buyer_id: "buyer-1",
      total_amount: 1000,
      installments: 3,
      status: "pending",
      paid_count: 0,
      paid_amount: 0,
      credit_check_result: null,
    };

    it("approves plan (updates status to active) when credit score is sufficient", async () => {
      mockDb._prep.get.mockReturnValue(pendingPlanRow);
      mockDb._prep.all.mockReturnValue([]);
      mockCreditScore.getScore.mockResolvedValue({ level: 3 });
      await manager.initialize();
      const result = await manager.approvePlan("plan-1");
      // result is the plan object from getPlan()
      expect(result).toBeDefined();
      // run() should have been called to update status
      expect(mockDb._prep.run).toHaveBeenCalled();
    });

    it("rejects plan (updates status to rejected) when credit level is too low", async () => {
      mockDb._prep.get.mockReturnValue(pendingPlanRow);
      mockDb._prep.all.mockReturnValue([]);
      mockCreditScore.getScore.mockResolvedValue({ level: 1 }); // below minimum
      await manager.initialize();
      await manager.approvePlan("plan-1");
      // Check that run was called with 'rejected' status
      const runCalls = mockDb._prep.run.mock.calls;
      expect(runCalls.some((args) => args.includes("rejected"))).toBe(true);
    });

    it("throws when plan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.approvePlan("nonexistent")).rejects.toThrow(
        "Plan not found",
      );
    });

    it("throws when plan is not pending", async () => {
      mockDb._prep.get.mockReturnValue({
        ...pendingPlanRow,
        status: "active",
        credit_check_result: null,
      });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.approvePlan("plan-1")).rejects.toThrow(
        "not pending",
      );
    });
  });

  // ── makePayment ───────────────────────────────────────────────────────────────

  describe("makePayment()", () => {
    const activePlanRow = {
      id: "plan-1",
      buyer_id: "buyer-1",
      total_amount: 1000,
      installments: 3,
      paid_count: 0,
      paid_amount: 0,
      status: "active",
      credit_check_result: null,
    };
    const nextPaymentRow = {
      id: "pay-1",
      plan_id: "plan-1",
      installment_number: 1,
      amount: 350,
      status: "pending",
    };

    it("makes a payment and returns updated plan", async () => {
      // getPlan() calls .get() then .all()
      mockDb._prep.get
        .mockReturnValueOnce(activePlanRow) // getPlan() plan lookup
        .mockReturnValueOnce(nextPaymentRow) // nextPayment lookup
        .mockReturnValueOnce(null) // nextDue after payment
        .mockReturnValueOnce(activePlanRow); // final getPlan() call
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.makePayment("plan-1", 350);
      expect(result).toBeDefined();
      expect(mockDb._prep.run).toHaveBeenCalled();
    });

    it("throws when plan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.makePayment("nonexistent", 100)).rejects.toThrow(
        "Plan not found",
      );
    });

    it("throws when plan status is not active or overdue", async () => {
      mockDb._prep.get.mockReturnValue({
        ...activePlanRow,
        status: "completed",
        credit_check_result: null,
      });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.makePayment("plan-1", 100)).rejects.toThrow(
        "Plan is not active",
      );
    });

    it("throws when no pending payments remain", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(activePlanRow)
        .mockReturnValueOnce(null); // no next payment
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.makePayment("plan-1", 100)).rejects.toThrow(
        "No pending payments",
      );
    });
  });

  // ── getPlan ───────────────────────────────────────────────────────────────────

  describe("getPlan()", () => {
    it("returns plan with payments array", () => {
      const planRow = {
        id: "plan-1",
        buyer_id: "b1",
        status: "active",
        credit_check_result: null,
      };
      const payments = [{ id: "pay-1", installment_number: 1 }];
      mockDb._prep.get.mockReturnValue(planRow);
      mockDb._prep.all.mockReturnValue(payments);
      const plan = manager.getPlan("plan-1");
      expect(plan).toBeDefined();
      expect(plan.id).toBe("plan-1");
      expect(plan.payments).toHaveLength(1);
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getPlan("nonexistent")).toBeNull();
    });
  });

  // ── listPlans ─────────────────────────────────────────────────────────────────

  describe("listPlans()", () => {
    it("returns plans and total", async () => {
      mockDb._prep.all.mockReturnValue([{ id: "p1" }, { id: "p2" }]);
      mockDb._prep.get.mockReturnValue({ total: 2 });
      await manager.initialize();
      const result = await manager.listPlans("user-1", {});
      expect(result.plans).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("returns empty result when no plans", async () => {
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.get.mockReturnValue({ total: 0 });
      await manager.initialize();
      const result = await manager.listPlans("user-1", {});
      expect(result.plans).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ── checkOverdue ──────────────────────────────────────────────────────────────

  describe("checkOverdue()", () => {
    it("returns checked and overdue count", async () => {
      mockDb._prep.all.mockReturnValue([
        { plan_id: "plan-1" },
        { plan_id: "plan-2" },
      ]);
      await manager.initialize();
      const result = await manager.checkOverdue();
      expect(result).toBeDefined();
      expect(result.checked).toBe(2);
      expect(result.overdue).toBe(2);
    });

    it("returns 0 when no overdue plans", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.checkOverdue();
      expect(result.checked).toBe(0);
    });
  });

  // ── handleDefault ─────────────────────────────────────────────────────────────

  describe("handleDefault()", () => {
    it("marks plan as defaulted and calls creditScoreManager.recordEvent", async () => {
      const planRow = {
        id: "plan-1",
        buyer_id: "buyer-1",
        total_amount: 1000,
        paid_amount: 300,
        credit_check_result: null,
      };
      mockDb._prep.get.mockReturnValue(planRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await manager.handleDefault("plan-1");
      expect(mockDb._prep.run).toHaveBeenCalledWith(
        expect.anything(),
        "plan-1",
      );
      expect(mockCreditScore.recordEvent).toHaveBeenCalledWith(
        "buyer-1",
        "default",
        expect.any(Object),
      );
    });
  });

  // ── getSchedule ───────────────────────────────────────────────────────────────

  describe("getSchedule()", () => {
    it("returns payments array for a plan", () => {
      const payments = [
        { id: "pay-1", installment_number: 1 },
        { id: "pay-2", installment_number: 2 },
      ];
      const planRow = {
        id: "plan-1",
        status: "active",
        credit_check_result: null,
      };
      mockDb._prep.get.mockReturnValue(planRow);
      mockDb._prep.all.mockReturnValue(payments);
      const schedule = manager.getSchedule("plan-1");
      expect(schedule).toBeInstanceOf(Array);
      expect(schedule).toHaveLength(2);
    });

    it("returns null when plan not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getSchedule("nonexistent")).toBeNull();
    });
  });

  // ── _calculateSchedule ────────────────────────────────────────────────────────

  describe("_calculateSchedule()", () => {
    it("generates correct number of payments", () => {
      const schedule = manager._calculateSchedule(1200, 4, 0.1);
      expect(schedule).toHaveLength(4);
    });

    it("payments have number, amount, and dueDate", () => {
      const schedule = manager._calculateSchedule(1000, 3, 0);
      expect(schedule[0]).toHaveProperty("number", 1);
      expect(schedule[0]).toHaveProperty("amount");
      expect(schedule[0]).toHaveProperty("dueDate");
    });

    it("last payment rounds to correct total", () => {
      const schedule = manager._calculateSchedule(100, 3, 0);
      const total = schedule.reduce((sum, p) => sum + p.amount, 0);
      expect(Math.round(total * 100) / 100).toBe(100);
    });
  });
});
