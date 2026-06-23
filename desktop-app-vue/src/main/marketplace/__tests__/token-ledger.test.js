import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { TokenLedger } from "../token-ledger.js";

// Minimal better-sqlite3-shaped mock. `transaction(fn)` returns a function that
// runs fn (and propagates throws), matching the real API closely enough.
function makeDb({ failInsert = false, rewardRow = null } = {}) {
  const runs = [];
  const db = {
    _runs: runs,
    exec: vi.fn(),
    prepare: vi.fn((sql) => ({
      run: (...args) => {
        if (failInsert && sql.includes("INSERT INTO")) {
          throw new Error("DB write failed");
        }
        runs.push({ sql, args });
        return { changes: 1 };
      },
      get: () =>
        sql.includes("SUM(amount)")
          ? rewardRow || { total: 0, cnt: 0 }
          : undefined,
      all: () => [],
    })),
    transaction: (fn) => () => fn(),
  };
  return { db };
}

describe("TokenLedger", () => {
  it("submitContribution (no DB) updates balance and emits", async () => {
    const l = new TokenLedger(null);
    const onEv = vi.fn();
    l.on("contribution-submitted", onEv);
    const c = await l.submitContribution({ type: "skill", qualityScore: 1.0 });
    expect(c.tokens_earned).toBe(10); // 1.0 * multiplier(1) * 10
    expect((await l.getBalance()).balance).toBe(10);
    expect(onEv).toHaveBeenCalledTimes(1);
  });

  it("requires a contribution type", async () => {
    const l = new TokenLedger(null);
    await expect(l.submitContribution({})).rejects.toThrow(/type is required/);
  });

  it("treats an explicit qualityScore of 0 as zero reward (not the 0.5 default)", async () => {
    const l = new TokenLedger(null);
    // 旧实现 `qualityScore || 0.5` 把合法的 0（最差质量）当成默认 0.5 → 误奖 5 CCT。
    const c = await l.submitContribution({ type: "skill", qualityScore: 0 });
    expect(c.tokens_earned).toBe(0);
    expect(c.quality_score).toBe(0);
    expect((await l.getBalance()).balance).toBe(0);
  });

  it("still defaults a missing qualityScore to 0.5", async () => {
    const l = new TokenLedger(null);
    const c = await l.submitContribution({ type: "skill" });
    expect(c.tokens_earned).toBe(5); // 0.5 * 1 * 10
    expect(c.quality_score).toBe(0.5);
  });

  it("submitContribution (with DB) persists both rows then advances balance", async () => {
    const database = makeDb();
    const l = new TokenLedger(database);
    await l.submitContribution({ type: "skill", qualityScore: 0.5 }); // 0.5*1*10=5
    const inserts = database.db._runs.filter((r) =>
      r.sql.includes("INSERT INTO"),
    );
    expect(inserts).toHaveLength(2); // contributions + token_transactions
    expect((await l.getBalance()).balance).toBe(5);
  });

  it("does NOT advance the in-memory balance when the DB write fails (atomicity regression)", async () => {
    const database = makeDb({ failInsert: true });
    const l = new TokenLedger(database);
    await expect(
      l.submitContribution({ type: "skill", qualityScore: 1.0 }),
    ).rejects.toThrow(/DB write failed/);
    expect((await l.getBalance()).balance).toBe(0); // balance not corrupted
    expect(l._transactions).toHaveLength(0); // no phantom tx
  });

  it("getRewardsSummary aggregates the full persisted ledger, not the in-memory window", async () => {
    const database = makeDb({ rewardRow: { total: 1234.5, cnt: 150 } });
    const l = new TokenLedger(database);
    const s = await l.getRewardsSummary();
    expect(s.totalRewards).toBe(1234.5);
    expect(s.rewardCount).toBe(150); // > 100, would be capped by the old in-memory reduce
  });

  it("getRewardsSummary falls back to the in-memory cache without a DB", async () => {
    const l = new TokenLedger(null);
    await l.submitContribution({ type: "skill", qualityScore: 1.0 }); // +10 reward
    const s = await l.getRewardsSummary();
    expect(s.rewardCount).toBe(1);
    expect(s.totalRewards).toBe(10);
  });

  it("getPricing applies a reputation discount capped at 0.5", async () => {
    const l = new TokenLedger(null);
    expect(
      (await l.getPricing({ callerReputation: 2 })).finalPrice,
    ).toBeCloseTo(0.8);
    expect(
      (await l.getPricing({ callerReputation: 100 })).finalPrice,
    ).toBeCloseTo(0.5);
    expect((await l.getPricing({})).finalPrice).toBe(1.0);
  });
});
