/**
 * transferAsset() must be atomic: the transactions ledger row and the asset
 * ownership UPDATE all land or none of them.
 *
 * The original code INSERTed a transactions row marked "confirmed" and THEN
 * UPDATEd digital_assets.wallet_address, with no transaction. If the ownership
 * UPDATE failed after the INSERT committed, the ledger recorded a confirmed
 * transfer that never happened — the asset was still owned by the sender, yet
 * the history shows it moved.
 *
 * MockDatabase can't model transactions, so this runs on real better-sqlite3.
 */

import { describe, it, expect } from "vitest";

async function setup() {
  const { default: Database } = await import("better-sqlite3");
  const mod = await import("../../src/lib/wallet-manager.js");
  const db = new Database(":memory:");
  mod.ensureWalletTables(db);
  const insWallet = db.prepare(
    `INSERT INTO wallets (address, name, public_key, encrypted_key, balance, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insWallet.run("addrA", "A", "pkA", "ekA", "0", 1, "2026-01-01 00:00:00");
  insWallet.run("addrB", "B", "pkB", "ekB", "0", 0, "2026-01-02 00:00:00");
  db.prepare(
    `INSERT INTO digital_assets (id, wallet_address, asset_type, name, amount)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("asset1", "addrA", "nft", "Art", "1");
  return { db, mod };
}

const ownerOf = (db, assetId) =>
  db
    .prepare("SELECT wallet_address FROM digital_assets WHERE id = ?")
    .get(assetId).wallet_address;
const txCount = (db) =>
  db.prepare("SELECT COUNT(*) c FROM transactions").get().c;

describe("transferAsset — DB atomicity (real better-sqlite3)", () => {
  it("rolls back the ledger row when the ownership update fails", async () => {
    const { db, mod } = await setup();
    try {
      // Fail ONLY the ownership UPDATE, after the ledger INSERT would run.
      const realPrepare = db.prepare.bind(db);
      db.prepare = (sql) => {
        if (/UPDATE digital_assets SET wallet_address/.test(sql)) {
          throw new Error("simulated ownership update failure");
        }
        return realPrepare(sql);
      };

      expect(() => mod.transferAsset(db, "asset1", "addrB", null)).toThrow(
        /ownership/,
      );

      db.prepare = realPrepare;
      // Atomic: no orphan ledger row, asset still owned by the sender.
      expect(txCount(db)).toBe(0);
      expect(ownerOf(db, "asset1")).toBe("addrA");
    } finally {
      db.close();
    }
  });

  it("a successful transfer moves ownership and records exactly one ledger row", async () => {
    const { db, mod } = await setup();
    try {
      mod.transferAsset(db, "asset1", "addrB", null);
      expect(ownerOf(db, "asset1")).toBe("addrB");
      expect(txCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});
