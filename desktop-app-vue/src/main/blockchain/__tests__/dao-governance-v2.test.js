/**
 * DAOGovernanceV2 unit tests — Phase 92
 *
 * Covers: initialize, createProposal, vote (simple + quadratic), delegate,
 *         execute (pass/fail), getTreasury, allocateFunds, getGovernanceStats, configure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { DAOGovernanceV2 } = require("../dao-governance-v2");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("DAOGovernanceV2", () => {
  let dao;
  let db;

  beforeEach(() => {
    dao = new DAOGovernanceV2();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(dao.initialized).toBe(false);
    expect(dao._proposals.size).toBe(0);
    expect(dao._treasury.balance).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await dao.initialize(db);
    expect(dao.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await dao.initialize(db);
    await dao.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── _loadState restore (snake_case → camelCase) ──────────────────────────
  function dbReturningProposals(rows) {
    return {
      exec: vi.fn(),
      prepare: vi.fn((sql) => ({
        all: () => (sql.includes("dao_v2_proposals") ? rows : []),
        get: () => null,
        run: vi.fn(),
      })),
    };
  }

  it("restores snake_case rows as numeric camelCase tallies; execute guard intact", async () => {
    // 模拟重启：DB 中存在一个 0 票提案（snake_case 列）
    const restoreDb = dbReturningProposals([
      {
        id: "p-restored",
        title: "T",
        description: "D",
        proposer: "alice",
        status: "active",
        votes_for: 0,
        votes_against: 0,
        voting_type: "simple",
        ends_at: new Date(Date.now() + 1e6).toISOString(),
      },
    ]);
    await dao.initialize(restoreDb);

    const restored = dao._proposals.get("p-restored");
    expect(restored.votesFor).toBe(0); // 数值而非 undefined
    expect(restored.votesAgainst).toBe(0);
    expect(restored.votingType).toBe("simple");
    // 0-0 提案不得执行：旧实现 undefined<=undefined=false 会跳过「未通过」闸而误执行
    expect(() => dao.execute("p-restored")).toThrow("did not pass");
  });

  it("restores a passed proposal's persisted tallies so execute succeeds", async () => {
    const restoreDb = dbReturningProposals([
      {
        id: "p-passed",
        title: "T",
        description: "D",
        proposer: "alice",
        status: "active",
        votes_for: 10,
        votes_against: 2,
        voting_type: "simple",
        ends_at: new Date(Date.now() + 1e6).toISOString(),
      },
    ]);
    await dao.initialize(restoreDb);

    const restored = dao._proposals.get("p-passed");
    expect(restored.votesFor).toBe(10);
    expect(restored.votesAgainst).toBe(2);
    expect(dao.execute("p-passed").status).toBe("executed");
  });

  // ── createProposal ──────────────────────────────────────────────────────
  it("should create a proposal", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal(
      "Fund project",
      "Allocate funds for X",
      "alice",
    );
    expect(proposal.id).toMatch(/^prop-/);
    expect(proposal.title).toBe("Fund project");
    expect(proposal.proposer).toBe("alice");
    expect(proposal.status).toBe("active");
    expect(proposal.votesFor).toBe(0);
    expect(proposal.votesAgainst).toBe(0);
  });

  it("should emit dao:proposal-created event", async () => {
    await dao.initialize(db);
    const listener = vi.fn();
    dao.on("dao:proposal-created", listener);
    dao.createProposal("Test", "Desc", "bob");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Test" }),
    );
  });

  it("should create proposal with quadratic voting type", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("QV Test", "Desc", "alice", {
      votingType: "quadratic",
    });
    expect(proposal.votingType).toBe("quadratic");
  });

  // ── vote ─────────────────────────────────────────────────────────────────
  it("should cast a simple vote for", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    const vote = dao.vote(proposal.id, "bob", "for", 5);
    expect(vote.direction).toBe("for");
    expect(vote.weight).toBe(5);
    expect(dao._proposals.get(proposal.id).votesFor).toBe(5);
  });

  it("should cast a simple vote against", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    dao.vote(proposal.id, "bob", "against", 3);
    expect(dao._proposals.get(proposal.id).votesAgainst).toBe(3);
  });

  it("should apply quadratic voting (sqrt weight)", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("QV", "Desc", "alice", {
      votingType: "quadratic",
    });
    const vote = dao.vote(proposal.id, "bob", "for", 9);
    expect(vote.weight).toBeCloseTo(3); // sqrt(9) = 3
  });

  it("should throw when voting on nonexistent proposal", async () => {
    await dao.initialize(db);
    expect(() => dao.vote("bad-id", "bob", "for")).toThrow("not found");
  });

  it("should emit dao:voted event", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    const listener = vi.fn();
    dao.on("dao:voted", listener);
    dao.vote(proposal.id, "bob", "for", 1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ voter: "bob" }),
    );
  });

  it("should reject a second vote from the same voter on a proposal", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    dao.vote(proposal.id, "bob", "for", 5);
    // 同一投票人再次投票必须被拒，票数不得被刷高（防治理操纵 / 国库被提走）
    expect(() => dao.vote(proposal.id, "bob", "for", 3)).toThrow(
      "already voted",
    );
    expect(dao._proposals.get(proposal.id).votesFor).toBe(5); // 仍为 5，而非 8
  });

  it("should dedupe per (proposal, voter), not block other voters/proposals", async () => {
    await dao.initialize(db);
    const p1 = dao.createProposal("P1", "Desc", "alice");
    const p2 = dao.createProposal("P2", "Desc", "alice");
    dao.vote(p1.id, "bob", "for", 2);
    dao.vote(p1.id, "carol", "for", 3); // 不同投票人 → 允许
    dao.vote(p2.id, "bob", "for", 4); // 同投票人但不同提案 → 允许
    expect(dao._proposals.get(p1.id).votesFor).toBe(5); // 2 + 3
    expect(dao._proposals.get(p2.id).votesFor).toBe(4);
    // 已投过的人不得换方向再投
    expect(() => dao.vote(p1.id, "carol", "against", 1)).toThrow(
      "already voted",
    );
  });

  // ── delegate ─────────────────────────────────────────────────────────────
  it("should delegate voting power", async () => {
    await dao.initialize(db);
    const result = dao.delegate("alice", "bob", 5);
    expect(result.delegator).toBe("alice");
    expect(result.delegate).toBe("bob");
    expect(result.weight).toBe(5);
  });

  it("should emit dao:delegated event", async () => {
    await dao.initialize(db);
    const listener = vi.fn();
    dao.on("dao:delegated", listener);
    dao.delegate("alice", "bob");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ delegator: "alice" }),
    );
  });

  // ── execute ──────────────────────────────────────────────────────────────
  it("should execute a passing proposal", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    dao.vote(proposal.id, "bob", "for", 10);
    const result = dao.execute(proposal.id);
    expect(result.status).toBe("executed");
  });

  it("should NOT allow double-execution (treasury double-drain guard)", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    dao.vote(proposal.id, "bob", "for", 10);
    expect(dao.execute(proposal.id).status).toBe("executed");
    // Second call must be rejected — vote totals are immutable, so without the
    // status guard this would execute again and re-drain the treasury.
    expect(() => dao.execute(proposal.id)).toThrow("not active");
  });

  it("should reject a NaN vote weight (votesFor poisoning guard)", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    expect(() => dao.vote(proposal.id, "bob", "for", NaN)).toThrow(
      "Invalid vote weight",
    );
    // votesFor stays a clean number — a NaN total would slip past execute()'s
    // "did not pass" guard (NaN <= x is false).
    expect(Number.isNaN(proposal.votesFor)).toBe(false);
  });

  it("should throw when executing failing proposal", async () => {
    await dao.initialize(db);
    const proposal = dao.createProposal("Test", "Desc", "alice");
    dao.vote(proposal.id, "bob", "against", 10);
    expect(() => dao.execute(proposal.id)).toThrow("did not pass");
  });

  it("should throw when executing unknown proposal", async () => {
    await dao.initialize(db);
    expect(() => dao.execute("nonexistent")).toThrow("not found");
  });

  // ── getTreasury ──────────────────────────────────────────────────────────
  it("should return treasury state", async () => {
    await dao.initialize(db);
    const treasury = dao.getTreasury();
    expect(treasury.balance).toBe(0);
    expect(treasury.allocations).toEqual([]);
  });

  // ── allocateFunds ────────────────────────────────────────────────────────
  it("should allocate funds when balance is sufficient", async () => {
    await dao.initialize(db);
    dao._treasury.balance = 1000;
    const alloc = dao.allocateFunds("prop-1", 500, "Development grant");
    expect(alloc.amount).toBe(500);
    expect(dao._treasury.balance).toBe(500);
  });

  it("should throw when treasury has insufficient funds", async () => {
    await dao.initialize(db);
    dao._treasury.balance = 100;
    expect(() => dao.allocateFunds("prop-1", 500, "Too much")).toThrow(
      "Insufficient",
    );
  });

  // ── getGovernanceStats ───────────────────────────────────────────────────
  it("should return governance stats", async () => {
    await dao.initialize(db);
    dao.createProposal("A", "Desc", "alice");
    dao.createProposal("B", "Desc", "bob");
    dao.delegate("charlie", "alice");
    const stats = dao.getGovernanceStats();
    expect(stats.totalProposals).toBe(2);
    expect(stats.active).toBe(2);
    expect(stats.delegations).toBe(1);
  });

  // ── configure ────────────────────────────────────────────────────────────
  it("should update configuration", async () => {
    await dao.initialize(db);
    const config = dao.configure({ quorum: 0.2 });
    expect(config.quorum).toBe(0.2);
    expect(config.votingPeriod).toBe(604800000); // unchanged
  });
});
