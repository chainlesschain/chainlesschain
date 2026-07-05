/**
 * transfer() must be atomic at the DB level: the debit, the credit, and the
 * ledger row all land together or not at all.
 *
 * The original code issued three separate mutations with no enclosing
 * transaction — `_persistAccount(from)`, `_persistAccount(to)`,
 * `_recordTransaction()`. A failure on the 2nd/3rd write left the persisted
 * state inconsistent (e.g. `from` debited but `to` never credited → tokens
 * vanish; or balances moved but the ledger row missing). Since the CLI
 * re-hydrates from these tables every process, that corruption survives.
 *
 * MockDatabase can't model transactions, so this runs on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

describe("transfer — DB atomicity (real better-sqlite3)", () => {
  async function setup() {
    const { default: Database } = await import("better-sqlite3");
    const mod = await import("../../src/lib/token-incentive.js");
    mod._resetState();
    const db = new Database(":memory:");
    mod.ensureTokenTables(db);
    const insAcct = db.prepare(
      `INSERT INTO token_accounts (id, account_id, balance, total_earned, total_spent, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    );
    insAcct.run("id-alice", "alice", 100, 100, 0, 1, 1);
    insAcct.run("id-bob", "bob", 0, 0, 0, 1, 1);
    mod.loadFromDb(db);
    return { db, mod };
  }

  it("rolls back the debit/credit when the ledger write fails", async () => {
    const { db, mod } = await setup();
    try {
      // Fail ONLY the ledger INSERT, after the two account writes would run.
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        if (/INTO token_transactions/.test(sql)) {
          throw new Error("simulated ledger write failure");
        }
        return realPrepare(sql);
      };

      expect(() =>
        mod.transfer(db, { from: "alice", to: "bob", amount: 30 }),
      ).toThrow(/ledger/);

      db.prepare = realPrepare;
      const bal = (acct) =>
        db
          .prepare("SELECT balance FROM token_accounts WHERE account_id=?")
          .get(acct).balance;

      // Atomic: a failed ledger write must not have moved any money.
      expect(bal("alice")).toBe(100);
      expect(bal("bob")).toBe(0);
      // No half-written ledger row.
      expect(
        db.prepare("SELECT COUNT(*) c FROM token_transactions").get().c,
      ).toBe(0);
      // In-memory view stays consistent with the rolled-back DB.
      expect(mod.getBalance("alice").balance).toBe(100);
      expect(mod.getBalance("bob").balance).toBe(0);
    } finally {
      db.close();
    }
  });

  it("a successful transfer moves money and records exactly one ledger row", async () => {
    const { db, mod } = await setup();
    try {
      mod.transfer(db, { from: "alice", to: "bob", amount: 30 });
      const bal = (acct) =>
        db
          .prepare("SELECT balance FROM token_accounts WHERE account_id=?")
          .get(acct).balance;
      expect(bal("alice")).toBe(70);
      expect(bal("bob")).toBe(30);
      expect(
        db.prepare("SELECT COUNT(*) c FROM token_transactions").get().c,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("rewardContribution — DB atomicity (real better-sqlite3)", () => {
  it("rolls back the credit when marking the contribution rewarded fails (no double-reward)", async () => {
    const { default: Database } = await import("better-sqlite3");
    const mod = await import("../../src/lib/token-incentive.js");
    mod._resetState();
    const db = new Database(":memory:");
    try {
      mod.ensureTokenTables(db);
      // bug_report baseReward=2, value=1 → a single reward credits 2.
      mod.recordContribution(db, {
        id: "c1",
        userId: "alice",
        type: "bug_report",
        value: 1,
      });

      // Fail ONLY the final "mark rewarded (with tx_id)" UPDATE — after the
      // account credit and the ledger insert would have run.
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        if (
          /UPDATE contributions SET rewarded = \?, reward_amount = \?, tx_id/.test(
            sql,
          )
        ) {
          throw new Error("simulated mark-rewarded failure");
        }
        return realPrepare(sql);
      };

      expect(() => mod.rewardContribution(db, "c1")).toThrow(/mark-rewarded/);
      db.prepare = realPrepare;

      // Atomic: the credit + ledger must have rolled back with the failed mark.
      const acct = db
        .prepare("SELECT balance FROM token_accounts WHERE account_id=?")
        .get("alice");
      expect(acct ? acct.balance : 0).toBe(0);
      expect(
        db.prepare("SELECT COUNT(*) c FROM token_transactions").get().c,
      ).toBe(0);
      expect(
        db.prepare("SELECT rewarded FROM contributions WHERE id=?").get("c1")
          .rewarded,
      ).toBe(0);

      // Re-hydrate (fresh process) and reward again: it must credit exactly
      // once. Under the bug the first attempt already credited without marking
      // rewarded, so this second call would double-credit to 4.
      mod.loadFromDb(db);
      mod.rewardContribution(db, "c1");
      expect(
        db
          .prepare("SELECT balance FROM token_accounts WHERE account_id=?")
          .get("alice").balance,
      ).toBe(2);
    } finally {
      db.close();
    }
  });
});
