/**
 * GovernanceEngine Unit Tests
 *
 * Covers:
 * - initialize() / initializeTables() table creation
 * - createProposal() happy path, validation, member check
 * - castVote() happy path, invalid vote, proposal state checks, deduplication
 * - getProposals() filtering by status
 * - getProposalById() with votes_summary and my_vote
 * - getVotes() returns all votes for a proposal
 * - tallyVotes() weight arithmetic and PASS_THRESHOLD boundary checks
 * - closeVoting() delegates to tallyVotes
 * - executeProposal() status guard
 * - Event emissions: proposal:created, proposal:vote-cast, proposal:tallied, proposal:executed
 * - Error propagation from database
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Import module under test ─────────────────────────────────────────────────
const {
  GovernanceEngine,
  ProposalStatus,
  VoteOption,
  VOTE_WEIGHT,
  PASS_THRESHOLD,
} = require("../governance-engine");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    db: {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    },
    saveToFile: vi.fn(),
  };
}

function createMockDIDManager(did = "did:test:alice") {
  return {
    getCurrentIdentity: vi.fn().mockReturnValue({ did }),
  };
}

function createMockCommunityManager() {
  return {
    getCommunityById: vi.fn().mockResolvedValue({ id: "community-001" }),
  };
}

function makeProposalRow(overrides = {}) {
  const now = Date.now();
  return {
    id: "proposal-001",
    community_id: "community-001",
    proposer_did: "did:test:alice",
    title: "Change the rules",
    description: "We should update rule #3",
    proposal_type: "rule_change",
    status: "voting",
    discussion_end: now - 1000, // already past discussion
    voting_end: now + 48 * 60 * 60 * 1000,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeMemberRow(overrides = {}) {
  return {
    id: "member-001",
    community_id: "community-001",
    member_did: "did:test:alice",
    role: "member",
    status: "active",
    ...overrides,
  };
}

function makeVoteRow(overrides = {}) {
  return {
    id: "vote-001",
    proposal_id: "proposal-001",
    voter_did: "did:test:alice",
    vote: "approve",
    weight: 1,
    created_at: 1700000000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GovernanceEngine", () => {
  let engine;
  let mockDatabase;
  let mockDIDManager;
  let mockCommunityManager;

  beforeEach(() => {
    uuidCounter = 0;
    mockDatabase = createMockDatabase();
    mockDIDManager = createMockDIDManager();
    mockCommunityManager = createMockCommunityManager();
    engine = new GovernanceEngine(mockDatabase, mockDIDManager, mockCommunityManager);
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize()
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should create governance_proposals and governance_votes tables", async () => {
      await engine.initialize();

      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const allSql = execCalls.join("\n");

      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS governance_proposals");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS governance_votes");
      expect(engine.initialized).toBe(true);
    });

    it("should create indexes for proposals and votes", async () => {
      await engine.initialize();

      const execCalls = mockDatabase.db.exec.mock.calls.map((c) => c[0]);
      const allSql = execCalls.join("\n");

      expect(allSql).toContain("idx_proposals_community");
      expect(allSql).toContain("idx_votes_proposal");
    });

    it("should set initialized = true", async () => {
      expect(engine.initialized).toBe(false);
      await engine.initialize();
      expect(engine.initialized).toBe(true);
    });

    it("should throw when db.exec throws", async () => {
      mockDatabase.db.exec.mockImplementation(() => {
        throw new Error("DB exec failure");
      });
      await expect(engine.initialize()).rejects.toThrow("DB exec failure");
      expect(engine.initialized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createProposal()
  // ─────────────────────────────────────────────────────────────────────────
  describe("createProposal()", () => {
    beforeEach(async () => {
      await engine.initialize();
      // User is a member of the community
      mockDatabase.db._prep.get.mockReturnValue(makeMemberRow());
    });

    it("should create a proposal in discussion status and return proposal object", async () => {
      const proposal = await engine.createProposal({
        communityId: "community-001",
        title: "Ban spam bots",
        description: "We have too many bots",
        proposalType: "ban",
      });

      expect(proposal).toMatchObject({
        community_id: "community-001",
        proposer_did: "did:test:alice",
        title: "Ban spam bots",
        status: ProposalStatus.DISCUSSION,
      });
      expect(proposal.id).toBeTruthy();
      expect(proposal.discussion_end).toBeGreaterThan(Date.now() - 1000);
      expect(proposal.voting_end).toBeGreaterThan(proposal.discussion_end);
    });

    it("should emit proposal:created event", async () => {
      const listener = vi.fn();
      engine.on("proposal:created", listener);

      const proposal = await engine.createProposal({
        communityId: "community-001",
        title: "Test Proposal",
      });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ proposal });
    });

    it("should insert into governance_proposals table", async () => {
      await engine.createProposal({
        communityId: "community-001",
        title: "Test Proposal",
      });

      const insertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO governance_proposals"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should throw if title is empty", async () => {
      await expect(
        engine.createProposal({ communityId: "community-001", title: "" }),
      ).rejects.toThrow("Proposal title cannot be empty");
    });

    it("should throw if title is only whitespace", async () => {
      await expect(
        engine.createProposal({ communityId: "community-001", title: "   " }),
      ).rejects.toThrow("Proposal title cannot be empty");
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(
        engine.createProposal({ communityId: "community-001", title: "Test" }),
      ).rejects.toThrow("User not logged in");
    });

    it("should throw if user is not a member of the community", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null); // not a member
      await expect(
        engine.createProposal({ communityId: "community-001", title: "Test" }),
      ).rejects.toThrow("You are not a member of this community");
    });

    it("should use custom discussion and voting durations", async () => {
      const customDiscussion = 2 * 60 * 60 * 1000; // 2 hours
      const customVoting = 4 * 60 * 60 * 1000; // 4 hours

      const proposal = await engine.createProposal({
        communityId: "community-001",
        title: "Custom Duration",
        discussionDuration: customDiscussion,
        votingDuration: customVoting,
      });

      const expectedDiscussionEnd = proposal.created_at + customDiscussion;
      expect(proposal.discussion_end).toBeCloseTo(expectedDiscussionEnd, -2);
      expect(proposal.voting_end).toBeCloseTo(expectedDiscussionEnd + customVoting, -2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // castVote()
  // ─────────────────────────────────────────────────────────────────────────
  describe("castVote()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should cast an approve vote and emit proposal:vote-cast", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "member" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)  // proposal lookup
        .mockReturnValueOnce(member)    // member lookup
        .mockReturnValueOnce(null);     // no existing vote

      const listener = vi.fn();
      engine.on("proposal:vote-cast", listener);

      const result = await engine.castVote("proposal-001", VoteOption.APPROVE);
      expect(result.success).toBe(true);
      expect(result.weight).toBe(VOTE_WEIGHT.member);
      expect(listener).toHaveBeenCalledWith({
        proposalId: "proposal-001",
        voterDid: "did:test:alice",
        vote: "approve",
        weight: VOTE_WEIGHT.member,
      });
    });

    it("should insert into governance_votes when no previous vote", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "owner" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(member)
        .mockReturnValueOnce(null); // no existing vote

      await engine.castVote("proposal-001", VoteOption.APPROVE);

      const insertCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("INSERT INTO governance_votes"),
      );
      expect(insertCall).toBeTruthy();
    });

    it("should update existing vote instead of inserting a duplicate", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "member" });
      const existingVote = makeVoteRow({ vote: "reject" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(member)
        .mockReturnValueOnce(existingVote);

      await engine.castVote("proposal-001", VoteOption.APPROVE);

      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE governance_votes"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should apply owner vote weight of 3", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "owner" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(member)
        .mockReturnValueOnce(null);

      const result = await engine.castVote("proposal-001", VoteOption.APPROVE);
      expect(result.weight).toBe(3);
    });

    it("should apply admin vote weight of 2", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "admin" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(member)
        .mockReturnValueOnce(null);

      const result = await engine.castVote("proposal-001", VoteOption.APPROVE);
      expect(result.weight).toBe(2);
    });

    it("should auto-transition proposal from discussion to voting when discussion period has ended", async () => {
      const pastDiscussion = makeProposalRow({
        status: "discussion",
        discussion_end: Date.now() - 1000, // discussion already ended
      });
      const member = makeMemberRow({ role: "member" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(pastDiscussion)
        .mockReturnValueOnce(member)
        .mockReturnValueOnce(null);

      // Should not throw — it auto-transitions to voting
      const result = await engine.castVote("proposal-001", VoteOption.APPROVE);
      expect(result.success).toBe(true);

      // Should have issued an UPDATE to set status = 'voting'
      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE governance_proposals SET status = ?"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should throw for an invalid vote option", async () => {
      await expect(engine.castVote("proposal-001", "maybe")).rejects.toThrow(
        "Invalid vote option",
      );
    });

    it("should throw if proposal is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(engine.castVote("nonexistent", VoteOption.APPROVE)).rejects.toThrow(
        "Proposal not found",
      );
    });

    it("should throw if proposal is still in discussion phase", async () => {
      const discussionProposal = makeProposalRow({
        status: "discussion",
        discussion_end: Date.now() + 1000000, // discussion not over yet
      });
      mockDatabase.db._prep.get.mockReturnValueOnce(discussionProposal);

      await expect(engine.castVote("proposal-001", VoteOption.APPROVE)).rejects.toThrow(
        "Proposal is not in voting phase",
      );
    });

    it("should throw if voting period has ended", async () => {
      const expiredProposal = makeProposalRow({
        status: "voting",
        voting_end: Date.now() - 1000, // voting already closed
      });
      const member = makeMemberRow();
      mockDatabase.db._prep.get
        .mockReturnValueOnce(expiredProposal)
        .mockReturnValueOnce(member);

      await expect(engine.castVote("proposal-001", VoteOption.APPROVE)).rejects.toThrow(
        "Voting period has ended",
      );
    });

    it("should throw if user is not a member of the community", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(null); // not a member

      await expect(engine.castVote("proposal-001", VoteOption.APPROVE)).rejects.toThrow(
        "You are not a member of this community",
      );
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(engine.castVote("proposal-001", VoteOption.APPROVE)).rejects.toThrow(
        "User not logged in",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getProposals()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getProposals()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should return proposals for a community", async () => {
      const rows = [
        makeProposalRow(),
        makeProposalRow({ id: "proposal-002", title: "Second Proposal", status: "discussion" }),
      ];
      mockDatabase.db._prep.all.mockReturnValue(rows);
      // tallyVotes calls from auto-update will need proposal lookups + vote lookups
      mockDatabase.db._prep.get.mockReturnValue(makeProposalRow());

      const result = await engine.getProposals("community-001");
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no proposals", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await engine.getProposals("community-001");
      expect(result).toEqual([]);
    });

    it("should pass status filter to query when provided", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      await engine.getProposals("community-001", { status: "passed" });

      // The prepared query should include a status filter
      const prepCalls = mockDatabase.db.prepare.mock.calls.map((c) => c[0]);
      const statusQuery = prepCalls.find((q) => q.includes("gp.status = ?"));
      expect(statusQuery).toBeTruthy();
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await engine.getProposals("community-001");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getProposalById()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getProposalById()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should return proposal with votes_summary when found", async () => {
      const proposal = makeProposalRow();
      const voteSummaryRows = [
        { vote: "approve", total_weight: 5, count: 3 },
        { vote: "reject", total_weight: 2, count: 1 },
      ];
      // my_vote lookup
      const myVoteRow = makeVoteRow({ vote: "approve" });

      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)  // proposal row
        .mockReturnValueOnce(myVoteRow); // my_vote lookup

      mockDatabase.db._prep.all.mockReturnValueOnce(voteSummaryRows);

      const result = await engine.getProposalById("proposal-001");
      expect(result).not.toBeNull();
      expect(result.votes_summary.approve.count).toBe(3);
      expect(result.votes_summary.approve.weight).toBe(5);
      expect(result.votes_summary.reject.count).toBe(1);
      expect(result.my_vote).toBe("approve");
    });

    it("should return null when proposal is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValue(null);
      const result = await engine.getProposalById("nonexistent");
      expect(result).toBeNull();
    });

    it("should return null on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await engine.getProposalById("proposal-001");
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getVotes()
  // ─────────────────────────────────────────────────────────────────────────
  describe("getVotes()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should return all votes for a proposal", async () => {
      const votes = [
        makeVoteRow(),
        makeVoteRow({ id: "vote-002", voter_did: "did:test:bob", vote: "reject" }),
      ];
      mockDatabase.db._prep.all.mockReturnValue(votes);

      const result = await engine.getVotes("proposal-001");
      expect(result).toHaveLength(2);
      expect(result[0].vote).toBe("approve");
      expect(result[1].vote).toBe("reject");
    });

    it("should return empty array when no votes", async () => {
      mockDatabase.db._prep.all.mockReturnValue([]);
      const result = await engine.getVotes("proposal-001");
      expect(result).toEqual([]);
    });

    it("should return empty array on database error", async () => {
      mockDatabase.db.prepare.mockImplementation(() => {
        throw new Error("DB error");
      });
      const result = await engine.getVotes("proposal-001");
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // tallyVotes()
  // ─────────────────────────────────────────────────────────────────────────
  describe("tallyVotes()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should compute weighted approve/reject/abstain totals", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [
        makeVoteRow({ vote: "approve", weight: 3 }), // owner
        makeVoteRow({ id: "vote-002", vote: "approve", weight: 2, voter_did: "did:test:admin" }), // admin
        makeVoteRow({ id: "vote-003", vote: "reject", weight: 1, voter_did: "did:test:bob" }),
        makeVoteRow({ id: "vote-004", vote: "abstain", weight: 1, voter_did: "did:test:carol" }),
      ];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const result = await engine.tallyVotes("proposal-001");
      expect(result.approveWeight).toBe(5); // 3 + 2
      expect(result.rejectWeight).toBe(1);
      expect(result.abstainWeight).toBe(1);
      expect(result.totalWeight).toBe(7);
    });

    it("should pass when approve weight >= PASS_THRESHOLD of effective weight (66.7%)", async () => {
      // 200 approve vs 100 reject → 200/300 = 66.67% > 66%
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [
        makeVoteRow({ vote: "approve", weight: 200 }),
        makeVoteRow({ id: "vote-002", vote: "reject", weight: 100, voter_did: "did:test:bob" }),
      ];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const result = await engine.tallyVotes("proposal-001");
      expect(result.passed).toBe(true);
      expect(result.status).toBe(ProposalStatus.PASSED);
    });

    it("should reject when approve weight is exactly 50% (below threshold)", async () => {
      // 150 approve vs 150 reject → 50% < 66%
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [
        makeVoteRow({ vote: "approve", weight: 150 }),
        makeVoteRow({ id: "vote-002", vote: "reject", weight: 150, voter_did: "did:test:bob" }),
      ];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const result = await engine.tallyVotes("proposal-001");
      expect(result.passed).toBe(false);
      expect(result.status).toBe(ProposalStatus.REJECTED);
    });

    it("should reject when there are no votes (passRatio = 0)", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce([]);

      const result = await engine.tallyVotes("proposal-001");
      expect(result.passed).toBe(false);
      expect(result.status).toBe(ProposalStatus.REJECTED);
      expect(result.voterCount).toBe(0);
    });

    it("should exclude abstentions from the pass ratio calculation", async () => {
      // 2 approve, 0 reject, 100 abstain — should still pass
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [
        makeVoteRow({ vote: "approve", weight: 2 }),
        ...Array.from({ length: 10 }, (_, i) =>
          makeVoteRow({ id: `vote-abs-${i}`, vote: "abstain", weight: 1, voter_did: `did:test:user${i}` }),
        ),
      ];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const result = await engine.tallyVotes("proposal-001");
      // effective weight = 2 (approve) + 0 (reject) = 2, passRatio = 1.0 → passed
      expect(result.passed).toBe(true);
    });

    it("should emit proposal:tallied event", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [makeVoteRow({ vote: "approve", weight: 2 })];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const listener = vi.fn();
      engine.on("proposal:tallied", listener);

      await engine.tallyVotes("proposal-001");
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "proposal-001" }));
    });

    it("should update proposal status in database after tally", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [makeVoteRow({ vote: "approve", weight: 2 })];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      await engine.tallyVotes("proposal-001");

      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE governance_proposals SET status = ?"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should throw if proposal is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(engine.tallyVotes("nonexistent")).rejects.toThrow("Proposal not found");
    });

    it("should return the passRatio rounded to 2 decimal places", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const votes = [
        makeVoteRow({ vote: "approve", weight: 1 }),
        makeVoteRow({ id: "vote-002", vote: "reject", weight: 2, voter_did: "did:test:bob" }),
      ];

      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);
      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const result = await engine.tallyVotes("proposal-001");
      expect(result.passRatio).toBe(0.33); // 1/3 rounded to 2dp
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // closeVoting()
  // ─────────────────────────────────────────────────────────────────────────
  describe("closeVoting()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should close voting and delegate to tallyVotes, returning tally result", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "owner" });
      const votes = [makeVoteRow({ vote: "approve", weight: 3 })];

      // closeVoting does: get proposal, get member, then tallyVotes does: get proposal again, get votes
      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal) // closeVoting: proposal lookup
        .mockReturnValueOnce(member)   // closeVoting: member permission check
        .mockReturnValueOnce(proposal); // tallyVotes: proposal lookup

      mockDatabase.db._prep.all.mockReturnValueOnce(votes);

      const result = await engine.closeVoting("proposal-001");
      expect(result).toHaveProperty("proposalId", "proposal-001");
      expect(result).toHaveProperty("passed");
    });

    it("should throw if proposal is not in voting phase", async () => {
      const proposal = makeProposalRow({ status: "discussion" });
      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);

      await expect(engine.closeVoting("proposal-001")).rejects.toThrow(
        "Proposal is not in voting phase",
      );
    });

    it("should throw if proposal is not found", async () => {
      mockDatabase.db._prep.get.mockReturnValueOnce(null);
      await expect(engine.closeVoting("nonexistent")).rejects.toThrow("Proposal not found");
    });

    it("should throw if user lacks admin/owner permissions", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      const member = makeMemberRow({ role: "member" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(member);

      await expect(engine.closeVoting("proposal-001")).rejects.toThrow(
        "Insufficient permissions to close voting",
      );
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(engine.closeVoting("proposal-001")).rejects.toThrow("User not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // executeProposal()
  // ─────────────────────────────────────────────────────────────────────────
  describe("executeProposal()", () => {
    beforeEach(async () => {
      await engine.initialize();
    });

    it("should execute a passed proposal and emit proposal:executed", async () => {
      const proposal = makeProposalRow({ status: "passed" });
      const member = makeMemberRow({ role: "owner" });
      mockDatabase.db._prep.get
        .mockReturnValueOnce(proposal)
        .mockReturnValueOnce(member);

      const listener = vi.fn();
      engine.on("proposal:executed", listener);

      const result = await engine.executeProposal("proposal-001");
      expect(result).toEqual({ success: true });
      expect(listener).toHaveBeenCalledWith({
        proposalId: "proposal-001",
        executedBy: "did:test:alice",
      });

      const updateCall = mockDatabase.db.prepare.mock.calls.find((c) =>
        c[0].includes("UPDATE governance_proposals SET status = ?"),
      );
      expect(updateCall).toBeTruthy();
    });

    it("should throw if proposal is not in passed status", async () => {
      const proposal = makeProposalRow({ status: "voting" });
      mockDatabase.db._prep.get.mockReturnValueOnce(proposal);

      await expect(engine.executeProposal("proposal-001")).rejects.toThrow(
        "Only passed proposals can be executed",
      );
    });

    it("should throw if user is not logged in", async () => {
      mockDIDManager.getCurrentIdentity.mockReturnValue(null);
      await expect(engine.executeProposal("proposal-001")).rejects.toThrow("User not logged in");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Exported Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("exported constants", () => {
    it("should export ProposalStatus with expected values", () => {
      expect(ProposalStatus.DISCUSSION).toBe("discussion");
      expect(ProposalStatus.VOTING).toBe("voting");
      expect(ProposalStatus.PASSED).toBe("passed");
      expect(ProposalStatus.REJECTED).toBe("rejected");
      expect(ProposalStatus.EXECUTED).toBe("executed");
    });

    it("should export VoteOption with expected values", () => {
      expect(VoteOption.APPROVE).toBe("approve");
      expect(VoteOption.REJECT).toBe("reject");
      expect(VoteOption.ABSTAIN).toBe("abstain");
    });

    it("should export VOTE_WEIGHT with correct role weights", () => {
      expect(VOTE_WEIGHT.owner).toBe(3);
      expect(VOTE_WEIGHT.admin).toBe(2);
      expect(VOTE_WEIGHT.moderator).toBe(1);
      expect(VOTE_WEIGHT.member).toBe(1);
    });

    it("should export PASS_THRESHOLD as 0.66", () => {
      expect(PASS_THRESHOLD).toBe(0.66);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor / EventEmitter
  // ─────────────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should be an EventEmitter", () => {
      expect(typeof engine.on).toBe("function");
      expect(typeof engine.emit).toBe("function");
    });

    it("should store injected dependencies", () => {
      expect(engine.database).toBe(mockDatabase);
      expect(engine.didManager).toBe(mockDIDManager);
      expect(engine.communityManager).toBe(mockCommunityManager);
    });

    it("should start with initialized = false", () => {
      const fresh = new GovernanceEngine(mockDatabase, mockDIDManager, mockCommunityManager);
      expect(fresh.initialized).toBe(false);
    });
  });
});
