/**
 * LendingManager 单元测试
 *
 * 覆盖：initialize、createLendingPool、requestLoan、approveLoan、
 *       rejectLoan、repayLoan、liquidateLoan、getPool、getLoan、
 *       listPools、listLoans、calculateInterest、checkLoanHealth
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { LendingManager } = require("../lending-manager");

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

function createMockCreditScoreManager() {
  return {
    getScore: vi.fn().mockResolvedValue({ level: 3 }),
    recordEvent: vi.fn().mockResolvedValue({ success: true }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LendingManager", () => {
  let manager;
  let mockDb;
  let mockCreditScore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    mockCreditScore = createMockCreditScoreManager();
    manager = new LendingManager(mockDb, mockCreditScore, null);
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with dependencies", () => {
      expect(manager).toBeDefined();
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates 3 DB tables (pools, loans, payments)", async () => {
      await manager.initialize();
      expect(mockDb.db.exec).toHaveBeenCalledTimes(3);
      const sqls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(sqls.some((s) => s.includes("lending_pools"))).toBe(true);
      expect(sqls.some((s) => s.includes("loans"))).toBe(true);
      expect(sqls.some((s) => s.includes("loan_payments"))).toBe(true);
    });

    it("sets initialized flag", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  // ── createLendingPool ─────────────────────────────────────────────────────────

  describe("createLendingPool()", () => {
    const validParams = {
      lenderId: "lender-1",
      totalAmount: 10000,
      interestRate: 0.08,
      termDays: 30,
      minCreditLevel: 2,
    };

    it("creates lending pool and returns pool row", async () => {
      const poolRow = {
        id: "pool-1",
        lender_id: "lender-1",
        total_amount: 10000,
        available_amount: 10000,
        interest_rate: 0.08,
        status: "active",
      };
      mockDb._prep.get.mockReturnValue(poolRow);
      await manager.initialize();
      const pool = await manager.createLendingPool(validParams);
      expect(pool).toBeDefined();
      expect(pool.lender_id).toBe("lender-1");
      expect(pool.total_amount).toBe(10000);
    });

    it("throws when totalAmount <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.createLendingPool({ ...validParams, totalAmount: 0 }),
      ).rejects.toThrow("Total amount must be positive");
    });

    it("throws when interestRate > 1", async () => {
      await manager.initialize();
      await expect(
        manager.createLendingPool({ ...validParams, interestRate: 2.0 }),
      ).rejects.toThrow("Interest rate must be between 0 and 1");
    });

    it("throws when termDays <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.createLendingPool({ ...validParams, termDays: 0 }),
      ).rejects.toThrow("Term must be at least 1 day");
    });

    it("throws when required fields are missing", async () => {
      await manager.initialize();
      await expect(
        manager.createLendingPool({ lenderId: "l1" }),
      ).rejects.toThrow("Missing required fields");
    });
  });

  // ── requestLoan ───────────────────────────────────────────────────────────────

  describe("requestLoan()", () => {
    const lendingPool = {
      id: "pool-1",
      lender_id: "lender-1",
      total_amount: 10000,
      available_amount: 10000,
      interest_rate: 0.08,
      term_days: 30,
      min_credit_level: 2,
      status: "active",
    };

    it("requests a loan using collateral object and returns loan", async () => {
      const loanRow = {
        id: "loan-1",
        pool_id: "pool-1",
        borrower_id: "borrower-1",
        amount: 1000,
        status: "pending",
        repaid_amount: 0,
      };
      // getPool() → pool row; getLoan() → loan row + payments
      mockDb._prep.get
        .mockReturnValueOnce(lendingPool) // getPool()
        .mockReturnValueOnce(loanRow); // getLoan() loan row
      mockDb._prep.all.mockReturnValue([]); // getLoan() payments
      await manager.initialize();
      const loan = await manager.requestLoan({
        poolId: "pool-1",
        borrowerId: "borrower-1",
        amount: 1000,
        collateral: { amount: 1500, asset: "BTC" },
      });
      expect(loan).toBeDefined();
      expect(loan.status).toBe("pending");
    });

    it("throws when pool not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(
        manager.requestLoan({
          poolId: "nonexistent",
          borrowerId: "b1",
          amount: 1000,
        }),
      ).rejects.toThrow("Lending pool not found");
    });

    it("throws when amount exceeds available liquidity", async () => {
      mockDb._prep.get.mockReturnValue({
        ...lendingPool,
        available_amount: 500,
      });
      await manager.initialize();
      await expect(
        manager.requestLoan({
          poolId: "pool-1",
          borrowerId: "b1",
          amount: 1000,
        }),
      ).rejects.toThrow("Insufficient pool liquidity");
    });

    it("throws when lender tries to borrow from own pool", async () => {
      mockDb._prep.get.mockReturnValue(lendingPool);
      await manager.initialize();
      await expect(
        manager.requestLoan({
          poolId: "pool-1",
          borrowerId: "lender-1",
          amount: 500,
        }),
      ).rejects.toThrow("Lender cannot borrow from own pool");
    });

    it("throws when required fields are missing", async () => {
      await manager.initialize();
      await expect(
        manager.requestLoan({ poolId: "pool-1" }), // missing borrowerId and amount
      ).rejects.toThrow("Missing required fields");
    });
  });

  // ── approveLoan ───────────────────────────────────────────────────────────────

  describe("approveLoan()", () => {
    const pendingLoan = {
      id: "loan-1",
      pool_id: "pool-1",
      borrower_id: "borrower-1",
      amount: 1000,
      status: "pending",
    };
    const activePool = {
      id: "pool-1",
      lender_id: "lender-1",
      available_amount: 5000,
      min_credit_level: 2,
    };
    const approvedLoan = { ...pendingLoan, status: "active" };

    it("approves loan with sufficient credit and returns loan", async () => {
      // getLoan (pending check): get+all; getPool: get; credit check;
      // run×2 (update pool + loan); final getLoan: get+all
      mockDb._prep.get
        .mockReturnValueOnce(pendingLoan) // getLoan loan row
        .mockReturnValueOnce(activePool) // getPool
        .mockReturnValueOnce(approvedLoan); // final getLoan
      mockDb._prep.all.mockReturnValue([]); // payments for both getLoan calls
      mockCreditScore.getScore.mockResolvedValue({ level: 3 });
      await manager.initialize();
      const result = await manager.approveLoan("loan-1");
      expect(result).toBeDefined();
      expect(result.status).toBe("active");
    });

    it("rejects loan when credit level is insufficient", async () => {
      // approveLoan: getLoan+getPool → insufficient credit → calls rejectLoan
      // rejectLoan: getLoan (pending check); run; getLoan (return)
      mockDb._prep.get
        .mockReturnValueOnce(pendingLoan) // getLoan in approveLoan
        .mockReturnValueOnce(activePool) // getPool in approveLoan
        .mockReturnValueOnce(pendingLoan) // getLoan in rejectLoan (pending check)
        .mockReturnValueOnce({ ...pendingLoan, status: "rejected" }); // getLoan in rejectLoan (return)
      mockDb._prep.all.mockReturnValue([]);
      mockCreditScore.getScore.mockResolvedValue({ level: 1 }); // below min_credit_level 2
      await manager.initialize();
      const result = await manager.approveLoan("loan-1");
      expect(result).toBeDefined();
      expect(result.status).toBe("rejected");
    });

    it("throws when loan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.approveLoan("nonexistent")).rejects.toThrow(
        "Loan not found",
      );
    });

    it("throws when loan is not pending", async () => {
      mockDb._prep.get.mockReturnValue({ ...pendingLoan, status: "active" });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.approveLoan("loan-1")).rejects.toThrow(
        "not pending",
      );
    });
  });

  // ── rejectLoan ────────────────────────────────────────────────────────────────

  describe("rejectLoan()", () => {
    it("rejects pending loan and returns updated loan", async () => {
      const pendingLoan = { id: "loan-1", status: "pending" };
      const rejectedLoan = { id: "loan-1", status: "rejected" };
      mockDb._prep.get
        .mockReturnValueOnce(pendingLoan) // getLoan (pending check)
        .mockReturnValueOnce(rejectedLoan); // getLoan (return)
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.rejectLoan(
        "loan-1",
        "Insufficient collateral",
      );
      expect(result).toBeDefined();
      expect(result.status).toBe("rejected");
    });

    it("throws when loan is not pending", async () => {
      mockDb._prep.get.mockReturnValue({ id: "loan-1", status: "active" });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.rejectLoan("loan-1", "reason")).rejects.toThrow(
        "not pending",
      );
    });

    it("throws when loan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.rejectLoan("nonexistent")).rejects.toThrow(
        "Loan not found",
      );
    });
  });

  // ── repayLoan ─────────────────────────────────────────────────────────────────

  describe("repayLoan()", () => {
    const activeLoan = {
      id: "loan-1",
      pool_id: "pool-1",
      borrower_id: "borrower-1",
      amount: 1000,
      repaid_amount: 0,
      interest_rate: 0.08,
      status: "active",
    };

    it("makes partial repayment and returns loan", async () => {
      const updatedLoan = { ...activeLoan, repaid_amount: 500 };
      mockDb._prep.get
        .mockReturnValueOnce(activeLoan) // getLoan check
        .mockReturnValueOnce(updatedLoan); // final getLoan
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.repayLoan("loan-1", 500);
      expect(result).toBeDefined();
      expect(result.repaid_amount).toBe(500);
    });

    it("throws when loan is not active", async () => {
      mockDb._prep.get.mockReturnValue({ ...activeLoan, status: "repaid" });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.repayLoan("loan-1", 100)).rejects.toThrow(
        "not active",
      );
    });

    it("throws when repayment amount <= 0", async () => {
      mockDb._prep.get.mockReturnValue(activeLoan);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.repayLoan("loan-1", 0)).rejects.toThrow(
        "Payment amount must be positive",
      );
    });

    it("throws when loan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.repayLoan("nonexistent", 100)).rejects.toThrow(
        "Loan not found",
      );
    });
  });

  // ── liquidateLoan ─────────────────────────────────────────────────────────────

  describe("liquidateLoan()", () => {
    it("liquidates active loan and returns updated loan", async () => {
      const activeLoan = {
        id: "loan-1",
        pool_id: "pool-1",
        amount: 1000,
        collateral_amount: 1500,
        status: "active",
      };
      const liquidatedLoan = { ...activeLoan, status: "liquidated" };
      mockDb._prep.get
        .mockReturnValueOnce(activeLoan) // getLoan check
        .mockReturnValueOnce(liquidatedLoan); // final getLoan
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.liquidateLoan("loan-1");
      expect(result).toBeDefined();
      expect(result.status).toBe("liquidated");
    });

    it("throws when loan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.liquidateLoan("nonexistent")).rejects.toThrow(
        "Loan not found",
      );
    });

    it("throws when loan is not active", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "loan-1",
        pool_id: "p1",
        status: "repaid",
      });
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      await expect(manager.liquidateLoan("loan-1")).rejects.toThrow(
        "not active",
      );
    });
  });

  // ── getPool & getLoan (sync) ──────────────────────────────────────────────────

  describe("getPool()", () => {
    it("returns pool by id (sync)", () => {
      mockDb._prep.get.mockReturnValue({
        id: "pool-1",
        lender_id: "l1",
        status: "active",
      });
      const pool = manager.getPool("pool-1");
      expect(pool).toBeDefined();
      expect(pool.id).toBe("pool-1");
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getPool("nonexistent")).toBeNull();
    });
  });

  describe("getLoan()", () => {
    it("returns loan with payment history (sync)", () => {
      const loanRow = { id: "loan-1", borrower_id: "b1", status: "active" };
      const payments = [{ id: "pay-1", amount: 100 }];
      mockDb._prep.get.mockReturnValue(loanRow);
      mockDb._prep.all.mockReturnValue(payments);
      const loan = manager.getLoan("loan-1");
      expect(loan).toBeDefined();
      expect(loan.payments).toHaveLength(1);
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getLoan("nonexistent")).toBeNull();
    });
  });

  // ── listPools ─────────────────────────────────────────────────────────────────

  describe("listPools()", () => {
    it("returns pools and total", async () => {
      mockDb._prep.all.mockReturnValue([{ id: "pool-1" }, { id: "pool-2" }]);
      mockDb._prep.get.mockReturnValue({ total: 2 });
      await manager.initialize();
      const result = await manager.listPools({});
      expect(result.pools).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.get.mockReturnValue({ total: 0 });
      await manager.initialize();
      const result = await manager.listPools({ status: "active" });
      expect(result.pools).toHaveLength(0);
    });
  });

  // ── listLoans ─────────────────────────────────────────────────────────────────

  describe("listLoans()", () => {
    it("returns loans and total for borrower role", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "loan-1", borrower_id: "user-1" },
      ]);
      mockDb._prep.get.mockReturnValue({ total: 1 });
      await manager.initialize();
      const result = await manager.listLoans("user-1", {});
      expect(result.loans).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("returns loans for lender role", async () => {
      mockDb._prep.all.mockReturnValue([{ id: "loan-1" }]);
      mockDb._prep.get.mockReturnValue({ total: 1 });
      await manager.initialize();
      const result = await manager.listLoans("lender-1", { role: "lender" });
      expect(result.loans).toHaveLength(1);
    });
  });

  // ── calculateInterest ─────────────────────────────────────────────────────────

  describe("calculateInterest()", () => {
    it("returns interest breakdown for loan", async () => {
      const loanRow = {
        id: "loan-1",
        amount: 1000,
        interest_rate: 0.12,
        repaid_amount: 0,
        status: "active",
      };
      // getLoan: get+all
      mockDb._prep.get.mockReturnValue(loanRow);
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const interest = await manager.calculateInterest("loan-1");
      expect(interest).toBeDefined();
      expect(interest.principal).toBe(1000);
      expect(interest.totalInterest).toBeCloseTo(120, 5);
      expect(typeof interest.remaining).toBe("number");
      expect(interest.remaining).toBeGreaterThan(0);
    });

    it("returns null when loan not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      const result = await manager.calculateInterest("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ── checkLoanHealth ───────────────────────────────────────────────────────────

  describe("checkLoanHealth()", () => {
    it("identifies overdue loans and high-LTV loans", async () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb._prep.all.mockReturnValue([
        { id: "loan-1", due_date: now - 1000, ltv_ratio: null }, // overdue
        { id: "loan-2", due_date: now + 86400, ltv_ratio: 0.95 }, // high LTV
      ]);
      await manager.initialize();
      const result = await manager.checkLoanHealth();
      expect(result.checked).toBe(2);
      expect(result.unhealthy).toBe(2);
    });

    it("returns zero counts when no active loans", async () => {
      mockDb._prep.all.mockReturnValue([]);
      await manager.initialize();
      const result = await manager.checkLoanHealth();
      expect(result.checked).toBe(0);
      expect(result.unhealthy).toBe(0);
    });
  });
});
