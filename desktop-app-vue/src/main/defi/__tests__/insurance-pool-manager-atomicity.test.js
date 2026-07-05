/**
 * InsurancePoolManager money operations must be atomic. Each of joinPool,
 * leavePool and resolveClaim mutates BOTH a per-user/claim row AND the pool
 * accounting (total_staked / claims_paid) across separate tables. Without an
 * enclosing transaction, a mid-way failure breaks the pool's money-conservation
 * invariant — e.g. a stake row exists but the pool never counted it, or a claim
 * is marked approved/paid but the pool liquidity was never debited.
 *
 * The existing insurance-pool-manager test uses a mock db that can't model
 * transactions, so these run on a real in-memory better-sqlite3.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const Database = require("better-sqlite3");
const { InsurancePoolManager } = require("../insurance-pool-manager");

function makeManager() {
  const sqlite = new Database(":memory:");
  const database = { db: sqlite };
  const manager = new InsurancePoolManager(database, null);
  return { sqlite, manager };
}

// Move a member past the 30-day withdrawal lock so leavePool can run.
function unlockStake(sqlite, poolId, userId) {
  sqlite
    .prepare(
      "UPDATE insurance_stakes SET lock_until = 0 WHERE pool_id = ? AND user_id = ?",
    )
    .run(poolId, userId);
}

describe("InsurancePoolManager — money-operation atomicity (real better-sqlite3)", () => {
  let sqlite;
  let manager;

  beforeEach(async () => {
    ({ sqlite, manager } = makeManager());
    await manager.initialize();
  });

  it("joinPool rolls back the stake insert if the pool accounting update fails", async () => {
    const pool = await manager.createPool({
      name: "P",
      coverageType: "device",
      premiumRate: 0.1,
      maxCoverage: 1000,
    });

    // Fail ONLY the pool-accounting UPDATE, after the stake INSERT would run.
    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (
        /UPDATE insurance_pools SET total_staked = total_staked \+/.test(sql)
      ) {
        throw new Error("simulated pool-accounting write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.joinPool(pool.id, "alice", 100)).rejects.toThrow(
      /pool-accounting/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: no orphan stake row, pool accounting untouched.
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM insurance_stakes").get().c,
    ).toBe(0);
    expect(manager.getPool(pool.id).total_staked).toBe(0);
    expect(manager.getPool(pool.id).participant_count).toBe(0);
  });

  it("leavePool rolls back the withdrawal if the pool accounting update fails", async () => {
    const pool = await manager.createPool({
      name: "P",
      coverageType: "device",
      premiumRate: 0.1,
      maxCoverage: 1000,
    });
    await manager.joinPool(pool.id, "alice", 100);
    unlockStake(sqlite, pool.id, "alice");

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE insurance_pools SET total_staked = MAX/.test(sql)) {
        throw new Error("simulated pool-accounting write failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.leavePool(pool.id, "alice")).rejects.toThrow(
      /pool-accounting/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: stake still active, pool still counts the stake.
    const stake = sqlite
      .prepare(
        "SELECT status FROM insurance_stakes WHERE pool_id = ? AND user_id = ?",
      )
      .get(pool.id, "alice");
    expect(stake.status).toBe("active");
    expect(manager.getPool(pool.id).total_staked).toBe(100);
    expect(manager.getPool(pool.id).participant_count).toBe(1);
  });

  it("voteClaim rolls back the vote if the tally update fails", async () => {
    const pool = await manager.createPool({
      name: "P",
      coverageType: "device",
      premiumRate: 0.1,
      maxCoverage: 1000,
    });
    await manager.joinPool(pool.id, "alice", 500);
    await manager.joinPool(pool.id, "bob", 500);
    const claim = await manager.submitClaim({
      poolId: pool.id,
      claimant: "alice",
      amount: 200,
    });

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE insurance_claims SET votes_for/.test(sql)) {
        throw new Error("simulated tally update failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.voteClaim(claim.id, "bob", true)).rejects.toThrow(
      /tally/,
    );
    sqlite.prepare = realPrepare;

    // Atomic: no vote row, tally still zero (so bob can retry his vote).
    expect(
      sqlite.prepare("SELECT COUNT(*) c FROM insurance_votes").get().c,
    ).toBe(0);
    const row = sqlite
      .prepare("SELECT votes_for FROM insurance_claims WHERE id = ?")
      .get(claim.id);
    expect(row.votes_for).toBe(0);
  });

  it("resolveClaim rolls back the approval if the pool payout debit fails", async () => {
    const pool = await manager.createPool({
      name: "P",
      coverageType: "device",
      premiumRate: 0.1,
      maxCoverage: 1000,
    });
    await manager.joinPool(pool.id, "alice", 500);
    await manager.joinPool(pool.id, "bob", 500);
    const claim = await manager.submitClaim({
      poolId: pool.id,
      claimant: "alice",
      amount: 200,
    });
    // Two approving votes → resolveClaim will take the approved (payout) path.
    await manager.voteClaim(claim.id, "bob", true);

    const realPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (sql) => {
      if (/UPDATE insurance_pools SET total_staked = MAX/.test(sql)) {
        throw new Error("simulated pool-payout debit failure");
      }
      return realPrepare(sql);
    };

    await expect(manager.resolveClaim(claim.id)).rejects.toThrow(/pool-payout/);
    sqlite.prepare = realPrepare;

    // Atomic: claim NOT approved/paid, pool liquidity untouched.
    const row = sqlite
      .prepare("SELECT status FROM insurance_claims WHERE id = ?")
      .get(claim.id);
    expect(row.status).toBe("voting");
    expect(manager.getPool(pool.id).total_staked).toBe(1000);
    expect(manager.getPool(pool.id).claims_paid).toBe(0);
  });

  it("a successful approved resolveClaim debits the pool exactly once", async () => {
    const pool = await manager.createPool({
      name: "P",
      coverageType: "device",
      premiumRate: 0.1,
      maxCoverage: 1000,
    });
    await manager.joinPool(pool.id, "alice", 500);
    await manager.joinPool(pool.id, "bob", 500);
    const claim = await manager.submitClaim({
      poolId: pool.id,
      claimant: "alice",
      amount: 200,
    });
    await manager.voteClaim(claim.id, "bob", true);

    const result = await manager.resolveClaim(claim.id);
    expect(result.status).toBe("paid");
    expect(manager.getPool(pool.id).total_staked).toBe(800);
    expect(manager.getPool(pool.id).claims_paid).toBe(200);
    expect(
      sqlite
        .prepare("SELECT status FROM insurance_claims WHERE id = ?")
        .get(claim.id).status,
    ).toBe("paid");
  });
});
