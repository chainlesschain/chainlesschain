/**
 * setDefaultIdentity() must keep the "exactly one default identity" invariant.
 *
 * It ran two UPDATEs with no transaction: first clearing every current default
 * (`is_default = 0 WHERE is_default = 1`), then setting the new one. If the
 * second UPDATE failed after the first committed, EVERY identity was left
 * non-default — the user's default (the DID that signs by default) silently
 * disappears until manually re-set.
 *
 * The ESCAPE/transaction behavior is SQL-level, so this runs on real
 * better-sqlite3.
 */

import { describe, it, expect } from "vitest";

describe("setDefaultIdentity — atomic default switch (real better-sqlite3)", () => {
  it("keeps the old default when setting the new one fails (no zero-default state)", async () => {
    const { default: Database } = await import("better-sqlite3");
    const {
      ensureDIDTables,
      createIdentity,
      setDefaultIdentity,
      getDefaultIdentity,
    } = await import("../../src/lib/did-manager.js");
    const db = new Database(":memory:");
    try {
      ensureDIDTables(db);
      const id1 = createIdentity(db, "first"); // first → default
      const id2 = createIdentity(db, "second");
      expect(getDefaultIdentity(db).did).toBe(id1.did);

      // Fail ONLY the "set new default" UPDATE, after the clear-all committed.
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        if (/SET is_default = \? WHERE did = \?/.test(sql)) {
          throw new Error("simulated set-default write failure");
        }
        return realPrepare(sql);
      };

      expect(() => setDefaultIdentity(db, id2.did)).toThrow(/set-default/);
      db.prepare = realPrepare;

      // Invariant: exactly one default, still the original — not zero.
      const def = getDefaultIdentity(db);
      expect(def).toBeTruthy();
      expect(def.did).toBe(id1.did);
      expect(
        db
          .prepare("SELECT COUNT(*) c FROM did_identities WHERE is_default = 1")
          .get().c,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it("a normal default switch still moves the flag to the new identity", async () => {
    const { default: Database } = await import("better-sqlite3");
    const {
      ensureDIDTables,
      createIdentity,
      setDefaultIdentity,
      getDefaultIdentity,
    } = await import("../../src/lib/did-manager.js");
    const db = new Database(":memory:");
    try {
      ensureDIDTables(db);
      const id1 = createIdentity(db, "first");
      const id2 = createIdentity(db, "second");
      expect(setDefaultIdentity(db, id2.did)).toBe(true);
      expect(getDefaultIdentity(db).did).toBe(id2.did);
      expect(
        db
          .prepare("SELECT COUNT(*) c FROM did_identities WHERE is_default = 1")
          .get().c,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
