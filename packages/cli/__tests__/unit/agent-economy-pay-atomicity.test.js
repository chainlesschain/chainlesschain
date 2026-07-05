/**
 * agent-economy pay() must be atomic: the ledger row, the debit and the credit
 * all land together or not at all.
 *
 * The original code issued the ledger INSERT and the two balance writes as
 * three separate statements with no transaction. If the credit (2nd balance
 * write) failed after the debit committed, the sender was debited but the
 * receiver never credited — tokens vanish — and the CLI re-hydrates from these
 * tables, so the loss persists.
 *
 * MockDatabase can't model transactions, so this runs on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

describe("pay — DB atomicity (real better-sqlite3)", () => {
  async function setup() {
    const { default: Database } = await import("better-sqlite3");
    const mod = await import("../../src/lib/agent-economy.js");
    mod._resetState();
    const db = new Database(":memory:");
    mod.ensureEconomyTables(db);
    const insBal = db.prepare(
      `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at) VALUES (?,?,?,?)`,
    );
    insBal.run("alice", 100, 0, "t0");
    insBal.run("bob", 0, 0, "t0");
    mod.loadFromDb(db);
    return { db, mod };
  }

  it("rolls back the debit when the credit write fails", async () => {
    const { db, mod } = await setup();
    try {
      // Fail ONLY the credit — the economy_balances write whose agent is "bob".
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        const stmt = realPrepare(sql);
        if (/INTO economy_balances/.test(sql)) {
          const realRun = stmt.run.bind(stmt);
          stmt.run = (...args) => {
            if (args[0] === "bob") {
              throw new Error("simulated credit write failure");
            }
            return realRun(...args);
          };
        }
        return stmt;
      };

      expect(() => mod.pay(db, "alice", "bob", 30, "test")).toThrow(/credit/);

      db.prepare = realPrepare;
      const bal = (agent) =>
        db
          .prepare("SELECT balance FROM economy_balances WHERE agent_id=?")
          .get(agent).balance;

      // Atomic: a failed credit must not have debited the sender.
      expect(bal("alice")).toBe(100);
      expect(bal("bob")).toBe(0);
      // No orphan ledger row claiming a transfer that never happened.
      expect(
        db.prepare("SELECT COUNT(*) c FROM economy_transactions").get().c,
      ).toBe(0);
      // In-memory view stays consistent with the rolled-back DB.
      expect(mod.getBalance("alice").balance).toBe(100);
      expect(mod.getBalance("bob").balance).toBe(0);
    } finally {
      db.close();
    }
  });

  it("a successful pay moves money and records exactly one ledger row", async () => {
    const { db, mod } = await setup();
    try {
      mod.pay(db, "alice", "bob", 30, "test");
      const bal = (agent) =>
        db
          .prepare("SELECT balance FROM economy_balances WHERE agent_id=?")
          .get(agent).balance;
      expect(bal("alice")).toBe(70);
      expect(bal("bob")).toBe(30);
      expect(
        db.prepare("SELECT COUNT(*) c FROM economy_transactions").get().c,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
