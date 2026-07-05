/**
 * setDefaultWallet() must keep the "exactly one default wallet" invariant.
 *
 * It ran two UPDATEs with no transaction: first clearing every current default,
 * then setting the new one. If the second UPDATE failed after the first
 * committed, EVERY wallet was left non-default — the default wallet (the one
 * that signs/sends by default) silently disappears until manually re-set.
 *
 * SQL-level transaction behavior, so this runs on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

describe("setDefaultWallet — atomic default switch (real better-sqlite3)", () => {
  async function seed() {
    const { default: Database } = await import("better-sqlite3");
    const mod = await import("../../src/lib/wallet-manager.js");
    const db = new Database(":memory:");
    mod.ensureWalletTables(db);
    const ins = db.prepare(
      `INSERT INTO wallets (address, name, public_key, encrypted_key, balance, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run("addrA", "A", "pkA", "ekA", "0", 1, "2026-01-01 00:00:00"); // default
    ins.run("addrB", "B", "pkB", "ekB", "0", 0, "2026-01-02 00:00:00");
    return { db, mod };
  }

  const defaultCount = (db) =>
    db.prepare("SELECT COUNT(*) c FROM wallets WHERE is_default = 1").get().c;

  it("keeps the old default when setting the new one fails (no zero-default state)", async () => {
    const { db, mod } = await seed();
    try {
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        if (/SET is_default = 1 WHERE address = \?/.test(sql)) {
          throw new Error("simulated set-default write failure");
        }
        return realPrepare(sql);
      };

      expect(() => mod.setDefaultWallet(db, "addrB")).toThrow(/set-default/);
      db.prepare = realPrepare;

      // Invariant: exactly one default, still the original — not zero.
      expect(defaultCount(db)).toBe(1);
      expect(
        db.prepare("SELECT address FROM wallets WHERE is_default = 1").get()
          .address,
      ).toBe("addrA");
    } finally {
      db.close();
    }
  });

  it("a normal default switch moves the flag to the new wallet", async () => {
    const { db, mod } = await seed();
    try {
      expect(mod.setDefaultWallet(db, "addrB")).toBe(true);
      expect(defaultCount(db)).toBe(1);
      expect(
        db.prepare("SELECT address FROM wallets WHERE is_default = 1").get()
          .address,
      ).toBe("addrB");
    } finally {
      db.close();
    }
  });
});
