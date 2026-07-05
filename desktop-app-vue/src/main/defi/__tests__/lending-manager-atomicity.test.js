/**
 * LendingManager money operations must be atomic: each debits/credits pool
 * liquidity AND flips loan state across multiple tables. Without a transaction,
 * a mid-way failure leaves the pool and the loan inconsistent — e.g. pool
 * liquidity debited but the loan never activated (funds effectively stranded),
 * or a loan marked repaid but the pool never credited back.
 *
 * The existing lending-manager test uses a mock db that can't model
 * transactions, so these run on a real in-memory better-sqlite3.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { LendingManager } = require("../lending-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const database = { db: sqlite };
  const creditScore = {
    getScore: vi.fn().mockResolvedValue({ level: 5 }),
    recordEvent: vi.fn().mockResolvedValue({ success: true }),
  };
  const manager = new LendingManager(database, creditScore, null);
  return { sqlite, manager };
}

describe("LendingManager — money-operation atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
  });

  it("approveLoan rolls back the pool debit if the loan-status update fails", async () => {
    const pool = await manager.createLendingPool({
      lenderId: "lender",
      totalAmount: 1000,
      interestRate: 0.1,
    });
    const loan = await manager.requestLoan({
      poolId: pool.id,
      borrowerId: "borrower",
      amount: 100,
    });

    // Fail ONLY the loan-status UPDATE, after the pool debit would run.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE loans SET status = 'active'/.test(sql)) {
        throw new Error("simulated loan-status write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.approveLoan(loan.id)).rejects.toThrow(/loan-status/);
    sqlite.prepare = realPrepare;

    // Atomic: pool liquidity untouched, loan still pending.
    expect(manager.getPool(pool.id).available_amount).toBe(1000);
    expect(manager.getPool(pool.id).active_loans).toBe(0);
    expect(manager.getLoan(loan.id).status).toBe("pending");
  });

  it("repayLoan rolls back the payment + loan update if the pool credit fails", async () => {
    const pool = await manager.createLendingPool({
      lenderId: "lender",
      totalAmount: 1000,
      interestRate: 0.1,
    });
    const loan = await manager.requestLoan({
      poolId: pool.id,
      borrowerId: "borrower",
      amount: 100,
    });
    await manager.approveLoan(loan.id); // pool now 900, loan active

    // Full repayment triggers the pool-credit UPDATE; make it fail.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (
        /UPDATE lending_pools SET available_amount = available_amount \+/.test(
          sql,
        )
      ) {
        throw new Error("simulated pool-credit write failure");
      }
      return realPrepare(sql);
    };

    const fullOwed = 100 * 1.1;
    await expect(manager.repayLoan(loan.id, fullOwed)).rejects.toThrow(
      /pool-credit/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: no payment row, loan still active with 0 repaid, pool still 900.
    expect(sqlite.prepare("SELECT COUNT(*) c FROM loan_payments").get().c).toBe(
      0,
    );
    expect(manager.getLoan(loan.id).status).toBe("active");
    expect(manager.getLoan(loan.id).repaid_amount).toBe(0);
    expect(manager.getPool(pool.id).available_amount).toBe(900);
  });

  it("a successful approve+repay moves liquidity correctly", async () => {
    const pool = await manager.createLendingPool({
      lenderId: "lender",
      totalAmount: 1000,
      interestRate: 0.1,
    });
    const loan = await manager.requestLoan({
      poolId: pool.id,
      borrowerId: "borrower",
      amount: 100,
    });
    await manager.approveLoan(loan.id);
    expect(manager.getPool(pool.id).available_amount).toBe(900);

    await manager.repayLoan(loan.id, 110);
    expect(manager.getLoan(loan.id).status).toBe("repaid");
    // Pool credited back the principal on full repayment.
    expect(manager.getPool(pool.id).available_amount).toBe(1000);
    expect(manager.getPool(pool.id).active_loans).toBe(0);
  });
});
