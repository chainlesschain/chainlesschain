/**
 * InsurancePoolManager 单元测试
 *
 * 覆盖：initialize、createPool、joinPool、leavePool、submitClaim、
 *       voteClaim、resolveClaim、getPool、listPools、listClaims、getPoolYield
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { InsurancePoolManager } = require("../insurance-pool-manager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    _prep: prepResult,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InsurancePoolManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    manager = new InsurancePoolManager(mockDb, null);
  });

  // ── Constructor ──────────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("creates instance with dependencies", () => {
      expect(manager).toBeDefined();
    });
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("creates 4 DB tables (pools, stakes, claims, votes)", async () => {
      await manager.initialize();
      expect(mockDb.db.exec).toHaveBeenCalledTimes(4);
      const sqls = mockDb.db.exec.mock.calls.map((c) => c[0]);
      expect(sqls.some((s) => s.includes("insurance_pools"))).toBe(true);
      expect(sqls.some((s) => s.includes("insurance_stakes"))).toBe(true);
      expect(sqls.some((s) => s.includes("insurance_claims"))).toBe(true);
      expect(sqls.some((s) => s.includes("insurance_votes"))).toBe(true);
    });

    it("sets initialized flag", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });
  });

  // ── createPool ────────────────────────────────────────────────────────────────

  describe("createPool()", () => {
    const validParams = {
      name: "Trade Insurance Pool",
      coverageType: "trade_default",
      premiumRate: 0.02,
      maxCoverage: 100000,
    };

    it("creates insurance pool and returns pool object", async () => {
      // getPool() makes 2 .get() calls: pool row + participants count
      const poolRow = {
        id: "pool-1",
        name: "Trade Insurance Pool",
        coverage_type: "trade_default",
        premium_rate: 0.02,
        max_coverage: 100000,
        total_staked: 0,
        status: "active",
      };
      mockDb._prep.get
        .mockReturnValueOnce(poolRow) // getPool(): pool query
        .mockReturnValueOnce({ count: 0 }); // getPool(): participants count
      await manager.initialize();
      const pool = await manager.createPool(validParams);
      expect(pool).toBeDefined();
      expect(pool.name).toBe("Trade Insurance Pool");
    });

    it("throws when premiumRate < 0", async () => {
      await manager.initialize();
      await expect(
        manager.createPool({ ...validParams, premiumRate: -0.01 }),
      ).rejects.toThrow("Premium rate must be between 0 and 1");
    });

    it("throws when premiumRate > 1", async () => {
      await manager.initialize();
      await expect(
        manager.createPool({ ...validParams, premiumRate: 1.5 }),
      ).rejects.toThrow("Premium rate must be between 0 and 1");
    });

    it("throws when maxCoverage <= 0", async () => {
      await manager.initialize();
      await expect(
        manager.createPool({ ...validParams, maxCoverage: 0 }),
      ).rejects.toThrow();
    });

    it("throws when name is empty", async () => {
      await manager.initialize();
      await expect(
        manager.createPool({ ...validParams, name: "" }),
      ).rejects.toThrow("Missing required fields");
    });
  });

  // ── joinPool ──────────────────────────────────────────────────────────────────

  describe("joinPool()", () => {
    const activePool = {
      id: "pool-1",
      name: "Test Pool",
      premium_rate: 0.02,
      max_coverage: 100000,
      total_staked: 5000,
      participant_count: 3,
      status: "active",
    };

    it("joins pool with contribution and returns stake info", async () => {
      // getPool(): pool row + participants count; existing stake check: null
      mockDb._prep.get
        .mockReturnValueOnce(activePool) // getPool(): pool row
        .mockReturnValueOnce({ count: 3 }) // getPool(): participants count
        .mockReturnValueOnce(null); // existing stake check (not staked)
      await manager.initialize();
      const result = await manager.joinPool("pool-1", "user-1", 1000);
      expect(result).toBeDefined();
      expect(result.poolId).toBe("pool-1");
      expect(result.userId).toBe("user-1");
      expect(result.amount).toBe(1000);
    });

    it("throws when pool not found", async () => {
      mockDb._prep.get.mockReturnValueOnce(null); // getPool(): pool not found
      await manager.initialize();
      await expect(
        manager.joinPool("nonexistent", "user-1", 1000),
      ).rejects.toThrow("Insurance pool not found");
    });

    it("throws when contribution <= 0", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(activePool)
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce(null); // not staked
      await manager.initialize();
      await expect(manager.joinPool("pool-1", "user-1", 0)).rejects.toThrow(
        "Contribution must be positive",
      );
    });

    it("throws when already staked in pool", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(activePool)
        .mockReturnValueOnce({ count: 3 })
        .mockReturnValueOnce({ id: "existing-stake" }); // already staked
      await manager.initialize();
      await expect(manager.joinPool("pool-1", "user-1", 1000)).rejects.toThrow(
        "Already staked in this pool",
      );
    });
  });

  // ── leavePool ─────────────────────────────────────────────────────────────────

  describe("leavePool()", () => {
    it("leaves pool after lock period expires and returns result", async () => {
      const now = Math.floor(Date.now() / 1000);
      // leavePool() directly queries stake (no getPool call first)
      mockDb._prep.get.mockReturnValue({
        id: "stake-1",
        pool_id: "pool-1",
        user_id: "user-1",
        amount: 1000,
        lock_until: now - 1000, // lock expired
        status: "active",
      });
      await manager.initialize();
      const result = await manager.leavePool("pool-1", "user-1");
      expect(result).toBeDefined();
      expect(result.status).toBe("withdrawn");
      expect(result.amount).toBe(1000);
    });

    it("throws when stake is still locked", async () => {
      const now = Math.floor(Date.now() / 1000);
      mockDb._prep.get.mockReturnValue({
        id: "stake-1",
        amount: 1000,
        lock_until: now + 86400, // still locked
        status: "active",
      });
      await manager.initialize();
      await expect(manager.leavePool("pool-1", "user-1")).rejects.toThrow(
        "Stake is still locked",
      );
    });

    it("throws when not a pool member", async () => {
      mockDb._prep.get.mockReturnValue(null); // no active stake
      await manager.initialize();
      await expect(manager.leavePool("pool-1", "user-1")).rejects.toThrow(
        "No active stake found",
      );
    });
  });

  // ── submitClaim ───────────────────────────────────────────────────────────────

  describe("submitClaim()", () => {
    const activePool = {
      id: "pool-1",
      max_coverage: 100000,
      total_staked: 50000,
      status: "active",
      actual_participants: 5,
    };

    it("submits a claim and returns claim in voting status", async () => {
      // getPool(): pool row + count; membership check: stake found
      mockDb._prep.get
        .mockReturnValueOnce(activePool) // getPool(): pool row
        .mockReturnValueOnce({ count: 5 }) // getPool(): participants count
        .mockReturnValueOnce({ id: "stake-1" }); // membership check
      await manager.initialize();
      const claim = await manager.submitClaim({
        poolId: "pool-1",
        claimant: "user-1",
        amount: 5000,
        evidence: "Transaction hash: 0xabc123",
      });
      expect(claim).toBeDefined();
      expect(claim.status).toBe("voting");
      expect(claim.poolId).toBe("pool-1");
    });

    it("throws when amount exceeds max coverage", async () => {
      mockDb._prep.get
        .mockReturnValueOnce({ ...activePool, max_coverage: 1000 })
        .mockReturnValueOnce({ count: 5 });
      await manager.initialize();
      await expect(
        manager.submitClaim({
          poolId: "pool-1",
          claimant: "user-1",
          amount: 2000, // exceeds max_coverage of 1000
          evidence: "proof",
        }),
      ).rejects.toThrow("Claim exceeds maximum coverage");
    });

    it("throws when claimant is not a pool member", async () => {
      // getPool(): pool row + count; membership check: null (not member)
      mockDb._prep.get
        .mockReturnValueOnce(activePool)
        .mockReturnValueOnce({ count: 5 })
        .mockReturnValueOnce(null); // not a member
      await manager.initialize();
      await expect(
        manager.submitClaim({
          poolId: "pool-1",
          claimant: "user-1",
          amount: 1000,
          evidence: "proof",
        }),
      ).rejects.toThrow("Only pool members can submit claims");
    });
  });

  // ── voteClaim ─────────────────────────────────────────────────────────────────

  describe("voteClaim()", () => {
    // Note: InsurancePoolManager uses status "voting" (not "pending") for votable claims
    const votingClaim = {
      id: "claim-1",
      pool_id: "pool-1",
      claimant: "user-1",
      amount: 5000,
      votes_for: 0,
      votes_against: 0,
      status: "voting",
    };

    it("records a vote for the claim", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(votingClaim) // claim lookup
        .mockReturnValueOnce({ id: "stake-1" }) // voter is pool member
        .mockReturnValueOnce(null); // hasn't voted yet
      await manager.initialize();
      const result = await manager.voteClaim("claim-1", "voter-1", true);
      expect(result).toBeDefined();
      expect(result.claimId).toBe("claim-1");
      expect(result.approve).toBe(true);
    });

    it("throws when already voted", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(votingClaim)
        .mockReturnValueOnce({ id: "stake-1" }) // is member
        .mockReturnValueOnce({ id: "vote-1" }); // already voted
      await manager.initialize();
      await expect(
        manager.voteClaim("claim-1", "voter-1", true),
      ).rejects.toThrow("Already voted on this claim");
    });

    it("throws when claimant votes on own claim", async () => {
      mockDb._prep.get.mockReturnValue(votingClaim);
      await manager.initialize();
      await expect(
        manager.voteClaim("claim-1", "user-1", true), // user-1 is the claimant
      ).rejects.toThrow("Claimant cannot vote on own claim");
    });

    it("throws when claim is not in voting phase", async () => {
      mockDb._prep.get.mockReturnValue({ ...votingClaim, status: "resolved" });
      await manager.initialize();
      await expect(
        manager.voteClaim("claim-1", "voter-1", true),
      ).rejects.toThrow("not in voting phase");
    });

    it("throws when voter is not a pool member", async () => {
      mockDb._prep.get
        .mockReturnValueOnce(votingClaim)
        .mockReturnValueOnce(null); // not a member
      await manager.initialize();
      await expect(
        manager.voteClaim("claim-1", "outsider", true),
      ).rejects.toThrow("Only pool participants can vote");
    });
  });

  // ── resolveClaim ──────────────────────────────────────────────────────────────

  describe("resolveClaim()", () => {
    it("approves claim when votes_for > votes_against", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "claim-1",
        pool_id: "pool-1",
        claimant: "user-1",
        amount: 5000,
        votes_for: 7,
        votes_against: 3,
        status: "voting",
      });
      await manager.initialize();
      const result = await manager.resolveClaim("claim-1");
      expect(result).toBeDefined();
      expect(result.claimId).toBe("claim-1");
      // With 7 for vs 3 against, should be PAID
      expect(result.status).toBe("paid");
    });

    it("rejects claim when votes_against >= votes_for", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "claim-1",
        pool_id: "pool-1",
        claimant: "user-1",
        amount: 5000,
        votes_for: 2,
        votes_against: 8,
        status: "voting",
      });
      await manager.initialize();
      const result = await manager.resolveClaim("claim-1");
      expect(result).toBeDefined();
      expect(result.status).toBe("rejected");
    });

    it("throws when claim not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      await expect(manager.resolveClaim("nonexistent")).rejects.toThrow(
        "Claim not found",
      );
    });

    it("throws when claim is not in voting phase", async () => {
      mockDb._prep.get.mockReturnValue({
        id: "claim-1",
        status: "paid",
        votes_for: 5,
        votes_against: 0,
      });
      await manager.initialize();
      await expect(manager.resolveClaim("claim-1")).rejects.toThrow(
        "not in voting phase",
      );
    });
  });

  // ── getPool ───────────────────────────────────────────────────────────────────

  describe("getPool()", () => {
    it("returns pool with actual_participants count", () => {
      // getPool() calls .get() twice: pool row + participants count
      mockDb._prep.get
        .mockReturnValueOnce({
          id: "pool-1",
          name: "Test Pool",
          status: "active",
        })
        .mockReturnValueOnce({ count: 5 });
      const pool = manager.getPool("pool-1");
      expect(pool).toBeDefined();
      expect(pool.id).toBe("pool-1");
      expect(pool.actual_participants).toBe(5);
    });

    it("returns null when not found", () => {
      mockDb._prep.get.mockReturnValue(null);
      expect(manager.getPool("nonexistent")).toBeNull();
    });
  });

  // ── listPools ─────────────────────────────────────────────────────────────────

  describe("listPools()", () => {
    it("returns pools and total", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "pool-1", status: "active" },
        { id: "pool-2", status: "active" },
      ]);
      mockDb._prep.get.mockReturnValue({ total: 2 });
      await manager.initialize();
      const result = await manager.listPools({});
      expect(result.pools).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by status", async () => {
      mockDb._prep.all.mockReturnValue([]);
      mockDb._prep.get.mockReturnValue({ total: 0 });
      await manager.initialize();
      const result = await manager.listPools({ status: "active" });
      expect(result.pools).toHaveLength(0);
    });
  });

  // ── listClaims ────────────────────────────────────────────────────────────────

  describe("listClaims()", () => {
    it("returns claims and total for a pool", async () => {
      mockDb._prep.all.mockReturnValue([
        { id: "claim-1", pool_id: "pool-1", status: "voting" },
      ]);
      mockDb._prep.get.mockReturnValue({ total: 1 });
      await manager.initialize();
      const result = await manager.listClaims("pool-1", {});
      expect(result.claims).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  // ── getPoolYield ──────────────────────────────────────────────────────────────

  describe("getPoolYield()", () => {
    it("returns yield metrics including annualizedReturn", async () => {
      // getPool(): pool row + participants count
      mockDb._prep.get
        .mockReturnValueOnce({
          id: "pool-1",
          total_staked: 10000,
          premium_rate: 0.02,
          claims_paid: 500,
          participant_count: 5,
        })
        .mockReturnValueOnce({ count: 5 });
      await manager.initialize();
      const poolYield = await manager.getPoolYield("pool-1");
      expect(poolYield).toBeDefined();
      expect(typeof poolYield.annualizedReturn).toBe("number");
      expect(typeof poolYield.yieldRate).toBe("number");
      expect(poolYield.totalStaked).toBe(10000);
    });

    it("returns null when pool not found", async () => {
      mockDb._prep.get.mockReturnValue(null);
      await manager.initialize();
      const result = await manager.getPoolYield("nonexistent");
      expect(result).toBeNull();
    });
  });
});
