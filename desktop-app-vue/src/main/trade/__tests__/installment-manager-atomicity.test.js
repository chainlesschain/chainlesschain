/**
 * InstallmentManager money/state writes must be atomic.
 *
 * createPlan inserts the plan row AND the full N-installment payment schedule;
 * a partial failure leaves a plan whose `installments` field disagrees with the
 * number of payment rows, breaking makePayment / completion logic.
 *
 * makePayment marks the current installment 'paid' AND updates the plan's
 * paid_count / paid_amount / status; a partial failure marks the installment
 * paid while the plan accounting is stale — the next payment skips ahead,
 * paid_count under-counts forever, and a fully-paid plan never completes.
 *
 * Runs on a real in-memory better-sqlite3 (a mock db can't model rollback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { InstallmentManager } = require("../installment-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const manager = new InstallmentManager({ db: sqlite }, null, null);
  return { sqlite, manager };
}

describe("InstallmentManager — money/state atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
  });

  it("createPlan rolls back the plan row if the payment schedule fails", async () => {
    // Fail the payment-schedule INSERT, after the plan row would be inserted.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO installment_payments/.test(sql)) {
        throw new Error("simulated schedule write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      manager.createPlan({
        orderId: "o1",
        buyerId: "buyer",
        sellerId: "seller",
        totalAmount: 100,
        installments: 4,
      }),
    ).rejects.toThrow(/schedule/);
    sqlite.prepare = realPrepare;

    // Atomic: no orphan plan without its schedule.
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM installment_plans").get().c,
    ).toBe(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM installment_payments").get().c,
    ).toBe(0);
  });

  it("makePayment rolls back the installment mark if the plan update fails", async () => {
    const plan = await manager.createPlan({
      orderId: "o1",
      buyerId: "buyer",
      sellerId: "seller",
      totalAmount: 100,
      installments: 2,
    });
    // Activate the plan so makePayment is allowed.
    sqlite
      .prepare("UPDATE installment_plans SET status = 'active' WHERE id = ?")
      .run(plan.id);

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE installment_plans SET paid_count/.test(sql)) {
        throw new Error("simulated plan-accounting write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.makePayment(plan.id, 50)).rejects.toThrow(
      /plan-accounting/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: installment still pending, plan accounting untouched.
    const paidCount = sqlite
      .prepare(
        "SELECT COUNT(*) c FROM installment_payments WHERE plan_id = ? AND status = 'paid'",
      )
      .get(plan.id).c;
    expect(paidCount).toBe(0);
    const row = sqlite
      .prepare(
        "SELECT paid_count, paid_amount FROM installment_plans WHERE id = ?",
      )
      .get(plan.id);
    expect(row.paid_count).toBe(0);
    expect(row.paid_amount).toBe(0);
  });

  it("a successful makePayment advances the plan accounting once", async () => {
    const plan = await manager.createPlan({
      orderId: "o1",
      buyerId: "buyer",
      sellerId: "seller",
      totalAmount: 100,
      installments: 2,
    });
    sqlite
      .prepare("UPDATE installment_plans SET status = 'active' WHERE id = ?")
      .run(plan.id);

    await manager.makePayment(plan.id, 50);
    const row = sqlite
      .prepare(
        "SELECT paid_count, paid_amount, status FROM installment_plans WHERE id = ?",
      )
      .get(plan.id);
    expect(row.paid_count).toBe(1);
    expect(row.paid_amount).toBe(50);
    expect(row.status).toBe("active");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) c FROM installment_payments WHERE plan_id = ? AND status = 'paid'",
        )
        .get(plan.id).c,
    ).toBe(1);
  });
});
