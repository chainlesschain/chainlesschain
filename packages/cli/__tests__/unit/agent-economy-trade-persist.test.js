/**
 * tradeResource() must persist the money movement and the listing depletion.
 *
 * The function originally took no `db` at all and mutated only the in-memory
 * Maps (buyer/seller balances, listing availability). Because the CLI
 * re-hydrates its Maps from the tables every process, `cc economy trade`
 * reported success but the trade never survived: the buyer was never charged,
 * the seller never paid, and the listing never depleted — so the same resource
 * could be "bought" unlimited times for free. Sibling listResource()/pay()
 * already persist; this path was the outlier.
 *
 * MockDatabase can't model cross-process re-hydration faithfully, so this runs
 * on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

describe("tradeResource — persistence across processes (real better-sqlite3)", () => {
  it("persists the debit, credit and listing depletion so they survive re-hydration", async () => {
    const { default: Database } = await import("better-sqlite3");
    const mod = await import("../../src/lib/agent-economy.js");
    mod._resetState();
    const db = new Database(":memory:");
    try {
      mod.ensureEconomyTables(db);
      db.prepare(
        `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at) VALUES (?,?,?,?)`,
      ).run("alice", 100, 0, "t0");
      // price 10, available 5.
      const listing = mod.listResource(db, "compute", "seller", 10, 5, "hour");
      mod.loadFromDb(db);

      const result = mod.tradeResource(db, listing.id, "alice", 3); // cost 30
      expect(result.cost).toBe(30);
      expect(result.remaining).toBe(2);

      // Simulate a fresh CLI process: drop the Maps and re-read the tables.
      mod._resetState();
      mod.loadFromDb(db);

      expect(mod.getBalance("alice").balance).toBe(70);
      expect(mod.getBalance("seller").balance).toBe(30);
      const row = db
        .prepare("SELECT available, status FROM economy_market WHERE id=?")
        .get(listing.id);
      expect(row.available).toBe(2);
    } finally {
      db.close();
    }
  });
});
