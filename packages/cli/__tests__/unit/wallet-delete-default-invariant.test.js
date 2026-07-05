/**
 * deleteWallet() must preserve the "exactly one default wallet" invariant.
 *
 * It promoted the oldest remaining wallet to default after EVERY delete,
 * without clearing the existing default. So deleting a NON-default wallet left
 * two defaults: the untouched current default plus the newly-promoted oldest.
 * getDefaultWallet() then returns whichever the query happens to pick — the
 * wrong wallet could sign/send.
 *
 * The promote should only happen when the deleted wallet WAS the default (so
 * that zero defaults would otherwise remain).
 *
 * MockDatabase orders inserts loosely; this uses real better-sqlite3 with
 * explicit created_at so "oldest" is deterministic.
 */

import { describe, it, expect } from "vitest";

async function seed() {
  const { default: Database } = await import("better-sqlite3");
  const mod = await import("../../src/lib/wallet-manager.js");
  const db = new Database(":memory:");
  mod.ensureWalletTables(db);
  const ins = db.prepare(
    `INSERT INTO wallets (address, name, public_key, encrypted_key, balance, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // A oldest (non-default), B middle (non-default), C newest (DEFAULT).
  ins.run("addrA", "A", "pkA", "ekA", "0", 0, "2026-01-01 00:00:00");
  ins.run("addrB", "B", "pkB", "ekB", "0", 0, "2026-01-02 00:00:00");
  ins.run("addrC", "C", "pkC", "ekC", "0", 1, "2026-01-03 00:00:00");
  return { db, mod };
}

const defaultCount = (db) =>
  db.prepare("SELECT COUNT(*) c FROM wallets WHERE is_default = 1").get().c;
const theDefault = (db) =>
  db.prepare("SELECT address FROM wallets WHERE is_default = 1").get()?.address;

describe("deleteWallet — exactly-one-default invariant (real better-sqlite3)", () => {
  it("deleting a non-default wallet does not create a second default", async () => {
    const { db, mod } = await seed();
    try {
      mod.deleteWallet(db, "addrB"); // delete a NON-default wallet
      // Invariant: still exactly one default (C), not two.
      expect(defaultCount(db)).toBe(1);
      expect(theDefault(db)).toBe("addrC");
    } finally {
      db.close();
    }
  });

  it("deleting the default wallet promotes exactly one new default (oldest)", async () => {
    const { db, mod } = await seed();
    try {
      mod.deleteWallet(db, "addrC"); // delete THE default
      expect(defaultCount(db)).toBe(1);
      expect(theDefault(db)).toBe("addrA"); // oldest remaining
    } finally {
      db.close();
    }
  });
});
