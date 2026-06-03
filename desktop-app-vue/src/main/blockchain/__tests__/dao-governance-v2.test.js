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
