/**
 * State-channel open/close must persist the balance movements, not just the
 * channel row. The CLI re-hydrates its Maps from the tables every process, so a
 * balance change that lives only in memory is lost on the next command.
 *
 * openChannel() debited `balA.balance`/`locked` in memory and INSERTed the
 * channel row (balance_a = deposit) but never wrote economy_balances. After a
 * fresh process re-hydrates, the deposit is still fully available in the
 * balance table AND locked in the channel — double-counted (a party can lock a
 * deposit then still spend the same funds via pay()).
 *
 * closeChannel() credited the deposit back in memory and UPDATEd the channel
 * status but likewise never persisted the balance — so closing a channel loses
 * the returned funds on the next process.
 *
 * MockDatabase can't model this cross-process re-hydration faithfully, so this
 * runs on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

async function freshDb() {
  const { default: Database } = await import("better-sqlite3");
  const mod = await import("../../src/lib/agent-economy.js");
  mod._resetState();
  const db = new Database(":memory:");
  mod.ensureEconomyTables(db);
  db.prepare(
    `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at) VALUES (?,?,?,?)`,
  ).run("alice", 100, 0, "t0");
  mod.loadFromDb(db);
  return { db, mod };
}

// Simulate a fresh CLI process: drop the Maps and re-read them from the tables.
function rehydrate(mod, db) {
  mod._resetState();
  mod.loadFromDb(db);
}

describe("agent-economy state channels — balance persistence (real better-sqlite3)", () => {
  it("openChannel persists the deposit debit so it survives re-hydration", async () => {
    const { db, mod } = await freshDb();
    try {
      mod.openChannel(db, "alice", "bob", 40);
      rehydrate(mod, db);

      const bal = mod.getBalance("alice");
      // 100 − 40 deposit, with 40 moved into `locked`.
      expect(bal.balance).toBe(60);
      expect(bal.locked).toBe(40);
    } finally {
      db.close();
    }
  });

  it("closeChannel persists the returned deposit so it survives re-hydration", async () => {
    const { db, mod } = await freshDb();
    try {
      const channel = mod.openChannel(db, "alice", "bob", 40);
      // A fresh process re-hydrates before closing.
      rehydrate(mod, db);
      mod.closeChannel(db, channel.id);
      rehydrate(mod, db);

      const bal = mod.getBalance("alice");
      // Deposit fully returned: balance back to 100, nothing left locked.
      expect(bal.balance).toBe(100);
      expect(bal.locked).toBe(0);
    } finally {
      db.close();
    }
  });
});
