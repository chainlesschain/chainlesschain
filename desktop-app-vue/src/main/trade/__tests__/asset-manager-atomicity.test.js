/**
 * AssetManager.transferAsset must move value atomically. The local-transfer
 * path debits the sender's holding, credits the receiver's holding, and writes
 * the asset_transfers ledger row as three separate cross-row/cross-table
 * writes. Without an enclosing transaction, a failure on the receiver credit
 * leaves the sender debited but the receiver never credited — value simply
 * vanishes (balances are read straight back from asset_holdings, so the loss
 * persists across processes).
 *
 * These run on a real in-memory better-sqlite3 because a mock db can't model
 * transaction rollback.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { AssetManager } = require("../asset-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const database = { db: sqlite };
  // currentDid only needs to be truthy; the sender is passed explicitly.
  const didManager = { getCurrentIdentity: () => ({ did: "system" }) };
  const manager = new AssetManager(database, didManager, null);
  return { sqlite, manager };
}

function seedHolding(sqlite, { assetId, owner, amount }) {
  const now = Date.now();
  sqlite
    .prepare(
      "INSERT INTO assets (id, asset_type, name, symbol, creator_did, total_supply, decimals, created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(assetId, "token", "T", "T", owner, amount, 0, now);
  sqlite
    .prepare(
      "INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(assetId, owner, amount, now, now);
}

describe("AssetManager.transferAsset — atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
    seedHolding(sqlite, { assetId: "a1", owner: "alice", amount: 100 });
  });

  it("rolls back the sender debit if the receiver credit fails", async () => {
    // Fail ONLY the receiver-credit INSERT; the sender-debit UPDATE would run first.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO asset_holdings/.test(sql)) {
        throw new Error("simulated receiver-credit write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      manager.transferAsset("a1", "bob", 60, "", {}, "alice"),
    ).rejects.toThrow(/receiver-credit/);
    sqlite.prepare = realPrepare;

    // Atomic: alice keeps her full balance, bob got nothing, no ledger row.
    expect(await manager.getBalance("alice", "a1")).toBe(100);
    expect(await manager.getBalance("bob", "a1")).toBe(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM asset_transfers").get().c,
    ).toBe(0);
  });

  it("rolls back the debit + credit if the ledger insert fails", async () => {
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/INSERT INTO\s+asset_transfers/.test(sql)) {
        throw new Error("simulated ledger write failure");
      }
      return realPrepare(sql);
    };

    await expect(
      manager.transferAsset("a1", "bob", 60, "", {}, "alice"),
    ).rejects.toThrow(/ledger/);
    sqlite.prepare = realPrepare;

    // Atomic: no value moved at all.
    expect(await manager.getBalance("alice", "a1")).toBe(100);
    expect(await manager.getBalance("bob", "a1")).toBe(0);
  });

  it("a successful transfer conserves value and records the ledger", async () => {
    await manager.transferAsset("a1", "bob", 60, "", {}, "alice");

    expect(await manager.getBalance("alice", "a1")).toBe(40);
    expect(await manager.getBalance("bob", "a1")).toBe(60);
    const ledger = sqlite
      .prepare("SELECT from_did, to_did, amount FROM asset_transfers")
      .all();
    expect(ledger).toEqual([{ from_did: "alice", to_did: "bob", amount: 60 }]);
  });
});
