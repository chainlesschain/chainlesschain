/**
 * UnifiedKeyManager.setPrimaryKey must keep the exactly-one-primary-per-purpose
 * invariant atomically. It clears is_primary for every key of the purpose, then
 * sets is_primary=1 on the chosen key — two writes with no transaction. If the
 * set fails after the clear, NO key of that purpose is primary anymore, and
 * getPrimaryKey(purpose) (which filters `WHERE is_primary = 1`) returns null —
 * the purpose's primary key is silently lost.
 *
 * Runs on a real in-memory better-sqlite3 (a mock db can't model rollback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { UnifiedKeyManager } = require("../unified-key-manager");

async function makeManager() {
  const sqlite = new Database(":memory:");
  const database = { db: sqlite, saveToFile: vi.fn() };
  const manager = new UnifiedKeyManager(database);
  await manager.initialize();
  return { sqlite, manager };
}

function seedKey(sqlite, { id, purpose, primary }) {
  sqlite
    .prepare(
      `INSERT INTO unified_keys (id, purpose, source, public_key, key_hash, is_primary, created_at, updated_at)
       VALUES (?, ?, 'derived', 'pk', 'kh', ?, 1, 1)`,
    )
    .run(id, purpose, primary ? 1 : 0);
}

describe("UnifiedKeyManager.setPrimaryKey — exactly-one-primary atomicity", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = await makeManager());
    seedKey(sqlite, { id: "k1", purpose: "signing", primary: true });
    seedKey(sqlite, { id: "k2", purpose: "signing", primary: false });
  });

  it("rolls back the clear if setting the new primary fails", async () => {
    // Fail ONLY the set-primary write, after the clear would run.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE unified_keys SET is_primary = 1/.test(sql)) {
        throw new Error("simulated set-primary write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.setPrimaryKey("k2")).rejects.toThrow(/set-primary/);
    sqlite.prepare = realPrepare;

    // Atomic: k1 is still the sole primary; the purpose still has a primary key.
    const primary = await manager.getPrimaryKey("signing");
    expect(primary).not.toBeNull();
    expect(primary.id).toBe("k1");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) c FROM unified_keys WHERE purpose = 'signing' AND is_primary = 1",
        )
        .get().c,
    ).toBe(1);
  });

  it("a successful setPrimaryKey moves the primary flag exactly once", async () => {
    await manager.setPrimaryKey("k2");
    const primary = await manager.getPrimaryKey("signing");
    expect(primary.id).toBe("k2");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) c FROM unified_keys WHERE purpose = 'signing' AND is_primary = 1",
        )
        .get().c,
    ).toBe(1);
  });
});
