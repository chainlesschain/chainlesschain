import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureDAOv2Tables,
  propose,
  vote,
  delegate,
  execute,
  getTreasury,
  allocate,
  depositToTreasury,
  getStats,
  configure,
  _resetState,
  // Phase 92 canonical surface
  PROPOSAL_STATUS,
  VOTE_TYPE,
  DELEGATION_STATUS,
  TREASURY_TX_TYPE,
  createProposalV2,
  activateProposal,
  castVote,
  delegateVotingPower,
  revokeDelegation,
  getActiveDelegations,
  queueProposal,
  executeProposalV2,
  cancelProposal,
  allocateFundsV2,
  getTreasuryState,
  getGovernanceStatsV2,
  configureV2,
  getConfigV2,
  depositToTreasuryV2,
} from "../../src/lib/dao-governance.js";

describe("dao-governance", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureDAOv2Tables(db);
  });

  // ─── ensureDAOv2Tables ──────────────────────────────────────

  describe("ensureDAOv2Tables", () => {
    it("creates all four DAO tables", () => {
      expect(db.tables.has("dao_v2_proposals")).toBe(true);
      expect(db.tables.has("dao_v2_votes")).toBe(true);
      expect(db.tables.has("dao_v2_treasury")).toBe(true);
      expect(db.tables.has("dao_v2_delegations")).toBe(true);
    });

    it("is idempotent", () => {
      ensureDAOv2Tables(db);
      ensureDAOv2Tables(db);
      expect(db.tables.has("dao_v2_proposals")).toBe(true);
    });
  });

  // ─── propose ────────────────────────────────────────────────

  describe("propose", () => {
    it("creates an active proposal", () => {
      const p = propose(db, "Fund development", "Details", "alice");
      expect(p.id).toMatch(/^prop-/);
      expect(p.title).toBe("Fund development");
      expect(p.status).toBe("active");
      expect(p.votingType).toBe("simple");
      expect(p.endsAt).toBeDefined();
    });

    it("supports quadratic voting type", () => {
      const p = propose(db, "Test", "", "alice", { votingType: "quadratic" });
      expect(p.votingType).toBe("quadratic");
    });

    it("throws on missing title", () => {
      expect(() => propose(db, "", "desc", "alice")).toThrow(
        "Title is required",
      );
    });

    it("throws on missing proposer", () => {
      expect(() => propose(db, "Test", "desc", "")).toThrow(
        "Proposer is required",
      );
    });

    it("persists to database", () => {
      propose(db, "Test", "", "alice");
      const rows = db.data.get("dao_v2_proposals") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique IDs", () => {
      const p1 = propose(db, "A", "", "alice");
      const p2 = propose(db, "B", "", "bob");
      expect(p1.id).not.toBe(p2.id);
    });
  });

  // ─── vote ───────────────────────────────────────────────────

  describe("vote", () => {
    it("records a for vote with simple voting", () => {
      const p = propose(db, "Test", "", "alice");
      const result = vote(db, p.id, "bob", "for", 2);
      expect(result.weight).toBe(2);
      expect(result.direction).toBe("for");
    });

    it("applies quadratic voting (sqrt of weight)", () => {
      const p = propose(db, "Test", "", "alice", { votingType: "quadratic" });
      const result = vote(db, p.id, "bob", "for", 9);
      expect(result.weight).toBe(3); // sqrt(9)
    });

    it("throws on unknown proposal", () => {
      expect(() => vote(db, "nonexistent", "bob", "for")).toThrow(
        "Proposal not found",
      );
    });

    it("throws on invalid direction", () => {
      const p = propose(db, "Test", "", "alice");
      expect(() => vote(db, p.id, "bob", "abstain")).toThrow(
        'Direction must be "for" or "against"',
      );
    });

    it("persists vote to database", () => {
      const p = propose(db, "Test", "", "alice");
      vote(db, p.id, "bob", "for");
      const rows = db.data.get("dao_v2_votes") || [];
      expect(rows.length).toBe(1);
    });

    it("accumulates votes on proposal", () => {
      const p = propose(db, "Test", "", "alice");
      vote(db, p.id, "bob", "for", 3);
      vote(db, p.id, "carol", "against", 1);
      // Check proposal state via execute (votesFor > votesAgainst)
      const result = execute(db, p.id);
      expect(result.status).toBe("executed");
    });
  });

  // ─── delegate ───────────────────────────────────────────────

  describe("delegate", () => {
    it("sets delegation", () => {
      const result = delegate(db, "alice", "bob", 2);
      expect(result.delegator).toBe("alice");
      expect(result.delegate).toBe("bob");
      expect(result.weight).toBe(2);
    });

    it("throws on missing delegator", () => {
      expect(() => delegate(db, "", "bob")).toThrow("Delegator is required");
    });

    it("throws on missing delegate", () => {
      expect(() => delegate(db, "alice", "")).toThrow("Delegate is required");
    });

    it("persists to database", () => {
      delegate(db, "alice", "bob");
      const rows = db.data.get("dao_v2_delegations") || [];
      expect(rows.length).toBe(1);
    });
  });

  // ─── execute ────────────────────────────────────────────────

  describe("execute", () => {
    it("executes a passed proposal", () => {
      const p = propose(db, "Test", "", "alice");
      vote(db, p.id, "bob", "for", 5);
      const result = execute(db, p.id);
      expect(result.status).toBe("executed");
    });

    it("throws on unknown proposal", () => {
      expect(() => execute(db, "nonexistent")).toThrow("Proposal not found");
    });

    it("throws when votes are not in favor", () => {
      const p = propose(db, "Test", "", "alice");
      vote(db, p.id, "bob", "against", 5);
      expect(() => execute(db, p.id)).toThrow("Proposal has not passed");
    });

    it("throws when votes are tied", () => {
      const p = propose(db, "Test", "", "alice");
      vote(db, p.id, "bob", "for", 5);
      vote(db, p.id, "carol", "against", 5);
      expect(() => execute(db, p.id)).toThrow("Proposal has not passed");
    });
  });

  // ─── treasury ───────────────────────────────────────────────

  describe("getTreasury / allocate / deposit", () => {
    it("starts with zero balance", () => {
      const t = getTreasury();
      expect(t.balance).toBe(0);
      expect(t.allocations).toEqual([]);
    });

    it("deposits increase balance", () => {
      const result = depositToTreasury(db, 1000, "Initial funding");
      expect(result.balance).toBe(1000);
    });

    it("allocates from treasury", () => {
      depositToTreasury(db, 1000, "Seed");
      const alloc = allocate(db, "prop-1", 300, "Dev grant");
      expect(alloc.amount).toBe(300);
      expect(alloc.proposalId).toBe("prop-1");
      expect(getTreasury().balance).toBe(700);
    });

    it("throws on insufficient funds", () => {
      expect(() => allocate(db, "prop-1", 100, "")).toThrow(
        "Insufficient treasury balance",
      );
    });

    it("throws on non-positive deposit", () => {
      expect(() => depositToTreasury(db, 0, "")).toThrow(
        "Amount must be positive",
      );
    });

    it("throws on non-positive allocation", () => {
      expect(() => allocate(db, "prop-1", 0, "")).toThrow(
        "Amount must be positive",
      );
    });
  });

  // ─── getStats ───────────────────────────────────────────────

  describe("getStats", () => {
    it("returns zeros initially", () => {
      const stats = getStats();
      expect(stats.totalProposals).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.delegations).toBe(0);
      expect(stats.treasury).toBe(0);
    });

    it("reflects proposals and delegations", () => {
      propose(db, "A", "", "alice");
      propose(db, "B", "", "bob");
      delegate(db, "alice", "bob");
      depositToTreasury(db, 500, "");
      const stats = getStats();
      expect(stats.totalProposals).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.delegations).toBe(1);
      expect(stats.treasury).toBe(500);
    });
  });

  // ─── configure ──────────────────────────────────────────────

  describe("configure", () => {
    it("updates voting period", () => {
      const cfg = configure({ votingPeriod: 1000 });
      expect(cfg.votingPeriod).toBe(1000);
    });

    it("updates quorum", () => {
      const cfg = configure({ quorum: 0.5 });
      expect(cfg.quorum).toBe(0.5);
    });

    it("preserves unspecified values", () => {
      const cfg = configure({ quorum: 0.2 });
      expect(cfg.votingPeriod).toBe(604800000);
      expect(cfg.executionDelay).toBe(86400000);
    });
  });

  // ══════════════════════════════════════════════════════════
  // Phase 92 (DAO 2.0) canonical surface
  // ══════════════════════════════════════════════════════════

  describe("Phase 92 enums", () => {
    it("PROPOSAL_STATUS has all 7 spec values", () => {
      expect(PROPOSAL_STATUS.DRAFT).toBe("draft");
      expect(PROPOSAL_STATUS.ACTIVE).toBe("active");
      expect(PROPOSAL_STATUS.QUEUE).toBe("queue");
      expect(PROPOSAL_STATUS.EXECUTE).toBe("execute");
      expect(PROPOSAL_STATUS.PASSED).toBe("passed");
      expect(PROPOSAL_STATUS.REJECTED).toBe("rejected");
      expect(PROPOSAL_STATUS.CANCELLED).toBe("cancelled");
      expect(Object.isFrozen(PROPOSAL_STATUS)).toBe(true);
    });

    it("VOTE_TYPE has FOR/AGAINST/ABSTAIN", () => {
      expect(VOTE_TYPE.FOR).toBe("for");
      expect(VOTE_TYPE.AGAINST).toBe("against");
      expect(VOTE_TYPE.ABSTAIN).toBe("abstain");
      expect(Object.isFrozen(VOTE_TYPE)).toBe(true);
    });

    it("DELEGATION_STATUS has ACTIVE/REVOKED/EXPIRED", () => {
      expect(DELEGATION_STATUS.ACTIVE).toBe("active");
      expect(DELEGATION_STATUS.REVOKED).toBe("revoked");
      expect(DELEGATION_STATUS.EXPIRED).toBe("expired");
      expect(Object.isFrozen(DELEGATION_STATUS)).toBe(true);
    });

    it("TREASURY_TX_TYPE covers ALLOCATION/WITHDRAWAL/REFUND/REWARD/DEPOSIT", () => {
      expect(TREASURY_TX_TYPE.ALLOCATION).toBe("allocation");
      expect(TREASURY_TX_TYPE.WITHDRAWAL).toBe("withdrawal");
      expect(TREASURY_TX_TYPE.REFUND).toBe("refund");
      expect(TREASURY_TX_TYPE.REWARD).toBe("reward");
      expect(TREASURY_TX_TYPE.DEPOSIT).toBe("deposit");
      expect(Object.isFrozen(TREASURY_TX_TYPE)).toBe(true);
    });
  });

  describe("createProposalV2 + activateProposal", () => {
    it("creates proposal with DRAFT status (not auto-active)", () => {
      const p = createProposalV2(db, {
        title: "Fund R&D",
        description: "Details",
        proposerDid: "did:example:alice",
      });
      expect(p.status).toBe(PROPOSAL_STATUS.DRAFT);
      expect(p.proposerDid).toBe("did:example:alice");
      expect(p.actions).toEqual([]);
      expect(p.votingStart).toBeNull();
      expect(p.votingEnd).toBeNull();
    });

    it("stores actions array", () => {
      const p = createProposalV2(db, {
        title: "x",
        proposerDid: "did:example:a",
        actions: [{ kind: "transfer", to: "bob", amount: 100 }],
      });
      expect(p.actions).toHaveLength(1);
      expect(p.actions[0].kind).toBe("transfer");
    });

    it("requires title and proposerDid", () => {
      expect(() => createProposalV2(db, { proposerDid: "a" })).toThrow(/Title/);
      expect(() => createProposalV2(db, { title: "x" })).toThrow(/proposerDid/);
    });

    it("activateProposal moves DRAFT → ACTIVE and sets voting window", () => {
      const p = createProposalV2(db, {
        title: "x",
        proposerDid: "did:a",
      });
      const active = activateProposal(db, p.id);
      expect(active.status).toBe(PROPOSAL_STATUS.ACTIVE);
      expect(active.votingStart).toBeTruthy();
      expect(active.votingEnd).toBeTruthy();
    });

    it("activateProposal rejects non-DRAFT", () => {
      const p = createProposalV2(db, { title: "x", proposerDid: "did:a" });
      activateProposal(db, p.id);
      expect(() => activateProposal(db, p.id)).toThrow(/DRAFT/);
    });

    it("activateProposal throws for unknown id", () => {
      expect(() => activateProposal(db, "nope")).toThrow(/not found/);
    });
  });

  describe("castVote (quadratic cost n²)", () => {
    let proposalId;
    beforeEach(() => {
      const p = createProposalV2(db, {
        title: "x",
        proposerDid: "did:a",
      });
      activateProposal(db, p.id);
      proposalId = p.id;
    });

    it("charges n² tokens for n votes", () => {
      const v = castVote(db, {
        proposalId,
        voterDid: "did:b",
        voteType: VOTE_TYPE.FOR,
        voteCount: 5,
        balance: 100,
      });
      expect(v.quadraticCost).toBe(25);
      expect(v.voteCount).toBe(5);
    });

    it("rejects when balance < n²", () => {
      expect(() =>
        castVote(db, {
          proposalId,
          voterDid: "did:b",
          voteType: VOTE_TYPE.FOR,
          voteCount: 10,
          balance: 50,
        }),
      ).toThrow(/Insufficient balance/);
    });

    it("rejects duplicate voter (anti-sybil)", () => {
      castVote(db, {
        proposalId,
        voterDid: "did:b",
        voteType: VOTE_TYPE.FOR,
        voteCount: 1,
        balance: 100,
      });
      expect(() =>
        castVote(db, {
          proposalId,
          voterDid: "did:b",
          voteType: VOTE_TYPE.AGAINST,
          voteCount: 1,
          balance: 100,
        }),
      ).toThrow(/already voted/);
    });

    it("rejects invalid voteType", () => {
      expect(() =>
        castVote(db, {
          proposalId,
          voterDid: "did:b",
          voteType: "maybe",
          voteCount: 1,
          balance: 100,
        }),
      ).toThrow(/Invalid voteType/);
    });

    it("rejects when proposal is not ACTIVE", () => {
      const p = createProposalV2(db, {
        title: "y",
        proposerDid: "did:a",
      });
      expect(() =>
        castVote(db, {
          proposalId: p.id,
          voterDid: "did:b",
          voteType: VOTE_TYPE.FOR,
          voteCount: 1,
          balance: 100,
        }),
      ).toThrow(/not ACTIVE/);
    });

    it("supports ABSTAIN vote", () => {
      const v = castVote(db, {
        proposalId,
        voterDid: "did:b",
        voteType: VOTE_TYPE.ABSTAIN,
        voteCount: 3,
        balance: 100,
      });
      expect(v.voteType).toBe(VOTE_TYPE.ABSTAIN);
      expect(v.quadraticCost).toBe(9);
    });
  });

  describe("delegateVotingPower / revokeDelegation", () => {
    it("creates an ACTIVE delegation", () => {
      const d = delegateVotingPower(db, {
        fromDid: "did:a",
        toDid: "did:b",
      });
      expect(d.status).toBe(DELEGATION_STATUS.ACTIVE);
      expect(d.fromDid).toBe("did:a");
      expect(d.toDid).toBe("did:b");
    });

    it("rejects self-delegation", () => {
      expect(() =>
        delegateVotingPower(db, { fromDid: "did:a", toDid: "did:a" }),
      ).toThrow(/self/);
    });

    it("detects cyclic delegation", () => {
      delegateVotingPower(db, { fromDid: "did:b", toDid: "did:a" });
      expect(() =>
        delegateVotingPower(db, { fromDid: "did:a", toDid: "did:b" }),
      ).toThrow(/[Cc]ycl/);
    });

    it("enforces max delegation depth", () => {
      configureV2({ maxDelegationDepth: 2 });
      delegateVotingPower(db, { fromDid: "did:c", toDid: "did:d" });
      delegateVotingPower(db, { fromDid: "did:b", toDid: "did:c" });
      expect(() =>
        delegateVotingPower(db, { fromDid: "did:a", toDid: "did:b" }),
      ).toThrow(/depth/);
    });

    it("revokeDelegation flips status to REVOKED", () => {
      delegateVotingPower(db, { fromDid: "did:a", toDid: "did:b" });
      const r = revokeDelegation(db, "did:a");
      expect(r.status).toBe(DELEGATION_STATUS.REVOKED);
      expect(r.revokedAt).toBeTruthy();
    });

    it("revokeDelegation throws when no active delegation", () => {
      expect(() => revokeDelegation(db, "did:nobody")).toThrow(/active/);
    });

    it("getActiveDelegations filters ACTIVE only", () => {
      delegateVotingPower(db, { fromDid: "did:a", toDid: "did:b" });
      delegateVotingPower(db, { fromDid: "did:c", toDid: "did:d" });
      revokeDelegation(db, "did:a");
      const active = getActiveDelegations();
      expect(active).toHaveLength(1);
      expect(active[0].fromDid).toBe("did:c");
    });

    it("getActiveDelegations auto-expires past expiresAt", () => {
      delegateVotingPower(db, {
        fromDid: "did:a",
        toDid: "did:b",
        expiresAt: "2000-01-01T00:00:00.000Z",
      });
      const active = getActiveDelegations();
      expect(active).toHaveLength(0);
    });
  });

  describe("queueProposal + executeProposalV2 (timelock)", () => {
    let pid;
    beforeEach(() => {
      const p = createProposalV2(db, { title: "x", proposerDid: "did:a" });
      activateProposal(db, p.id);
      pid = p.id;
      configureV2({ timelockMs: 0, quorumPercentage: 10 });
    });

    it("queueProposal moves ACTIVE → QUEUE when passed + quorum", () => {
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.FOR,
        voteCount: 5,
        balance: 100,
      });
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v2",
        voteType: VOTE_TYPE.FOR,
        voteCount: 3,
        balance: 100,
      });
      const q = queueProposal(db, pid);
      expect(q.status).toBe(PROPOSAL_STATUS.QUEUE);
      expect(q.quorumReached).toBe(true);
      expect(q.queueEnd).toBeTruthy();
    });

    it("rejects queueing without majority", () => {
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.AGAINST,
        voteCount: 5,
        balance: 100,
      });
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v2",
        voteType: VOTE_TYPE.FOR,
        voteCount: 1,
        balance: 100,
      });
      expect(() => queueProposal(db, pid)).toThrow(/majority/);
    });

    it("executeProposalV2 moves QUEUE → EXECUTE after timelock", () => {
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.FOR,
        voteCount: 5,
        balance: 100,
      });
      queueProposal(db, pid);
      const e = executeProposalV2(db, pid);
      expect(e.status).toBe(PROPOSAL_STATUS.EXECUTE);
      expect(e.executedAt).toBeTruthy();
    });

    it("executeProposalV2 rejects before timelock elapsed", () => {
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.FOR,
        voteCount: 5,
        balance: 100,
      });
      configureV2({ timelockMs: 1000000 });
      queueProposal(db, pid);
      expect(() => executeProposalV2(db, pid)).toThrow(/Timelock/);
    });

    it("executeProposalV2 rejects non-QUEUE proposal", () => {
      expect(() => executeProposalV2(db, pid)).toThrow(/QUEUED/);
    });

    it("cancelProposal flips to CANCELLED", () => {
      const c = cancelProposal(db, pid);
      expect(c.status).toBe(PROPOSAL_STATUS.CANCELLED);
      expect(c.cancelledAt).toBeTruthy();
    });

    it("cancelProposal rejects already-executed", () => {
      castVote(db, {
        proposalId: pid,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.FOR,
        voteCount: 5,
        balance: 100,
      });
      queueProposal(db, pid);
      executeProposalV2(db, pid);
      expect(() => cancelProposal(db, pid)).toThrow(/Cannot cancel/);
    });
  });

  describe("allocateFundsV2 (proposal-linked, balance_after)", () => {
    let pid;
    beforeEach(() => {
      depositToTreasuryV2(db, { amount: 10000 });
      const p = createProposalV2(db, { title: "x", proposerDid: "did:a" });
      activateProposal(db, p.id);
      castVote(db, {
        proposalId: p.id,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.FOR,
        voteCount: 5,
        balance: 100,
      });
      configureV2({ timelockMs: 0 });
      queueProposal(db, p.id);
      executeProposalV2(db, p.id);
      pid = p.id;
    });

    it("records balance_after on allocation", () => {
      const tx = allocateFundsV2(db, {
        proposalId: pid,
        recipient: "did:recipient",
        amount: 1000,
      });
      expect(tx.balanceAfter).toBe(9000);
      expect(tx.txType).toBe(TREASURY_TX_TYPE.ALLOCATION);
    });

    it("rejects allocation for non-EXECUTED proposal", () => {
      const p2 = createProposalV2(db, {
        title: "y",
        proposerDid: "did:a",
      });
      expect(() =>
        allocateFundsV2(db, {
          proposalId: p2.id,
          recipient: "r",
          amount: 100,
        }),
      ).toThrow(/EXECUTED/);
    });

    it("rejects when amount exceeds maxSingleAllocation", () => {
      configureV2({ maxSingleAllocation: 500 });
      expect(() =>
        allocateFundsV2(db, {
          proposalId: pid,
          recipient: "r",
          amount: 1000,
        }),
      ).toThrow(/maxSingleAllocation/);
    });

    it("rejects on insufficient treasury", () => {
      expect(() =>
        allocateFundsV2(db, {
          proposalId: pid,
          recipient: "r",
          amount: 999999,
        }),
      ).toThrow(/maxSingleAllocation|Insufficient/);
    });
  });

  describe("getTreasuryState + depositToTreasuryV2", () => {
    it("returns balance + totalAllocated + recentTxs", () => {
      depositToTreasuryV2(db, { amount: 5000, memo: "seed" });
      const s = getTreasuryState();
      expect(s.balance).toBe(5000);
      expect(s.transactions).toHaveLength(1);
      expect(s.transactions[0].txType).toBe(TREASURY_TX_TYPE.DEPOSIT);
      expect(s.transactions[0].balanceAfter).toBe(5000);
    });
  });

  describe("getGovernanceStatsV2", () => {
    it("computes participation rate against member count", () => {
      const p = createProposalV2(db, { title: "x", proposerDid: "did:a" });
      activateProposal(db, p.id);
      castVote(db, {
        proposalId: p.id,
        voterDid: "did:v1",
        voteType: VOTE_TYPE.FOR,
        voteCount: 1,
        balance: 100,
      });
      castVote(db, {
        proposalId: p.id,
        voterDid: "did:v2",
        voteType: VOTE_TYPE.AGAINST,
        voteCount: 1,
        balance: 100,
      });
      const s = getGovernanceStatsV2(10);
      expect(s.uniqueVoters).toBe(2);
      expect(s.participationRate).toBeCloseTo(0.2, 5);
      expect(s.byStatus[PROPOSAL_STATUS.ACTIVE]).toBe(1);
    });

    it("computes delegation coverage", () => {
      delegateVotingPower(db, { fromDid: "did:a", toDid: "did:b" });
      delegateVotingPower(db, { fromDid: "did:c", toDid: "did:d" });
      const s = getGovernanceStatsV2(10);
      expect(s.activeDelegations).toBe(2);
      expect(s.delegationCoverage).toBeCloseTo(0.2, 5);
    });

    it("zero-member safe", () => {
      const s = getGovernanceStatsV2();
      expect(s.participationRate).toBe(0);
      expect(s.delegationCoverage).toBe(0);
    });
  });

  describe("configureV2 / getConfigV2", () => {
    it("updates only allowed keys", () => {
      const cfg = configureV2({
        quorumPercentage: 25,
        timelockMs: 100,
        nonsense: "ignored",
      });
      expect(cfg.quorumPercentage).toBe(25);
      expect(cfg.timelockMs).toBe(100);
      expect(cfg.nonsense).toBeUndefined();
    });

    it("getConfigV2 returns a copy", () => {
      const a = getConfigV2();
      const b = getConfigV2();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
