/**
 * GroupBuyingManager member operations must be atomic. joinGroupBuy inserts a
 * member row AND increments group_buys.current_members; leaveGroupBuy marks the
 * member 'left' AND decrements current_members. Without a transaction, a failure
 * on the count update diverges current_members from the real active-member count
 * — and current_members gates both the "group is full" check and finalize's
 * target test, so drift makes a group finalize prematurely or never at all.
 *
 * Runs on a real in-memory better-sqlite3 (a mock db can't model rollback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { GroupBuyingManager } = require("../group-buying-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const manager = new GroupBuyingManager({ db: sqlite }, null, null);
  return { sqlite, manager };
}

// Seed an active group buy directly (createGroupBuy would start a deadline timer).
function seedGroup(sqlite, { id, members = 0 }) {
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO group_buys (id, creator_id, item_id, original_price, target_price, min_members, max_members, current_members, deadline, status, created_at, updated_at)
       VALUES (?, 'creator', 'item', 100, 80, 2, NULL, ?, ?, 'active', ?, ?)`,
    )
    .run(id, members, now + 3600, now, now);
}

describe("GroupBuyingManager — member-count atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
  });

  it("joinGroupBuy rolls back the member insert if the count update fails", async () => {
    seedGroup(sqlite, { id: "g1", members: 0 });

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (
        /UPDATE group_buys SET current_members = current_members \+/.test(sql)
      ) {
        throw new Error("simulated count-increment failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.joinGroupBuy("g1", "alice")).rejects.toThrow(
      /count-increment/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: no orphan member row, count still 0.
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM group_buy_members").get().c,
    ).toBe(0);
    expect(
      sqlite
        .prepare("SELECT current_members m FROM group_buys WHERE id = 'g1'")
        .get().m,
    ).toBe(0);
  });

  it("leaveGroupBuy rolls back the member withdrawal if the count update fails", async () => {
    seedGroup(sqlite, { id: "g1", members: 1 });
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        "INSERT INTO group_buy_members (id, group_id, user_id, quantity, joined_at, status) VALUES ('m1', 'g1', 'alice', 1, ?, 'active')",
      )
      .run(now);

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE group_buys SET current_members = MAX/.test(sql)) {
        throw new Error("simulated count-decrement failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.leaveGroupBuy("g1", "alice")).rejects.toThrow(
      /count-decrement/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: member still active, count still 1.
    expect(
      sqlite
        .prepare("SELECT status FROM group_buy_members WHERE id = 'm1'")
        .get().status,
    ).toBe("active");
    expect(
      sqlite
        .prepare("SELECT current_members m FROM group_buys WHERE id = 'g1'")
        .get().m,
    ).toBe(1);
  });

  it("a successful join then leave keeps count consistent with membership", async () => {
    seedGroup(sqlite, { id: "g1", members: 0 });

    await manager.joinGroupBuy("g1", "alice");
    await manager.joinGroupBuy("g1", "bob");
    expect(
      sqlite
        .prepare("SELECT current_members m FROM group_buys WHERE id = 'g1'")
        .get().m,
    ).toBe(2);

    await manager.leaveGroupBuy("g1", "alice");
    const count = sqlite
      .prepare("SELECT current_members m FROM group_buys WHERE id = 'g1'")
      .get().m;
    const active = sqlite
      .prepare(
        "SELECT COUNT(*) c FROM group_buy_members WHERE group_id = 'g1' AND status = 'active'",
      )
      .get().c;
    expect(count).toBe(1);
    expect(active).toBe(1);
  });
});
