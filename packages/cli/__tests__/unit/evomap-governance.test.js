import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureEvoMapGovernanceTables,
  registerOwnership,
  traceOwnership,
  createGovernanceProposal,
  voteOnGovernanceProposal,
  getGovernanceDashboard,
  _resetState,
  // V2
  PROPOSAL_STATUS_V2,
  PROPOSAL_TYPE,
  VOTE_DIRECTION,
  createGovernanceProposalV2,
  castVoteV2,
  setProposalStatus,
  executeProposal,
  cancelProposal,
  expireProposalsV2,
  listProposalsV2,
  traceContributions,
  getGovernanceStatsV2,
} from "../../src/lib/evomap-governance.js";

describe("evomap-governance", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureEvoMapGovernanceTables(db);
  });

  // ─── ensureEvoMapGovernanceTables ───────────────────────────

  describe("ensureEvoMapGovernanceTables", () => {
    it("creates gene_ownership and evomap_governance_proposals tables", () => {
      expect(db.tables.has("gene_ownership")).toBe(true);
      expect(db.tables.has("evomap_governance_proposals")).toBe(true);
    });

    it("is idempotent", () => {
      ensureEvoMapGovernanceTables(db);
      ensureEvoMapGovernanceTables(db);
      expect(db.tables.has("gene_ownership")).toBe(true);
    });
  });

  // ─── registerOwnership ─────────────────────────────────────

  describe("registerOwnership", () => {
    it("registers ownership with defaults", () => {
      const o = registerOwnership(db, "gene-1", "did:example:alice");
      expect(o.id).toBeDefined();
      expect(o.geneId).toBe("gene-1");
      expect(o.ownerDid).toBe("did:example:alice");
      expect(o.verified).toBe(1);
      expect(o.plagiarismScore).toBe(0.0);
      expect(o.revenueSplit).toEqual({ "did:example:alice": 100 });
    });

    it("accepts custom revenue split", () => {
      const o = registerOwnership(db, "gene-1", "did:alice", {
        revenueSplit: { "did:alice": 70, "did:bob": 30 },
      });
      expect(o.revenueSplit).toEqual({ "did:alice": 70, "did:bob": 30 });
    });

    it("throws on missing gene ID", () => {
      expect(() => registerOwnership(db, "", "did:alice")).toThrow(
        "Gene ID is required",
      );
    });

    it("throws on missing owner DID", () => {
      expect(() => registerOwnership(db, "gene-1", "")).toThrow(
        "Owner DID is required",
      );
    });

    it("persists to database", () => {
      registerOwnership(db, "gene-1", "did:alice");
      const rows = db.data.get("gene_ownership") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique IDs", () => {
      const o1 = registerOwnership(db, "gene-1", "did:alice");
      const o2 = registerOwnership(db, "gene-2", "did:bob");
      expect(o1.id).not.toBe(o2.id);
    });

    it("sets default originality proof", () => {
      const o = registerOwnership(db, "gene-1", "did:alice");
      expect(o.originalityProof.method).toBe("did-vc");
      expect(o.originalityProof.timestamp).toBeDefined();
    });
  });

  // ─── traceOwnership ────────────────────────────────────────

  describe("traceOwnership", () => {
    it("returns empty trace for unknown gene", () => {
      const trace = traceOwnership("unknown");
      expect(trace.owner).toBeNull();
      expect(trace.contributors).toEqual([]);
    });

    it("throws on missing gene ID", () => {
      expect(() => traceOwnership("")).toThrow("Gene ID is required");
    });

    it("traces ownership after registration", () => {
      registerOwnership(db, "gene-1", "did:alice");
      const trace = traceOwnership("gene-1");
      expect(trace.owner).toBe("did:alice");
      expect(trace.contributors).toContain("did:alice");
    });

    it("shows multiple contributors from revenue split", () => {
      registerOwnership(db, "gene-1", "did:alice", {
        revenueSplit: { "did:alice": 60, "did:bob": 40 },
      });
      const trace = traceOwnership("gene-1");
      expect(trace.contributors.length).toBe(2);
    });
  });

  // ─── createGovernanceProposal ───────────────────────────────

  describe("createGovernanceProposal", () => {
    it("creates an active proposal", () => {
      const p = createGovernanceProposal(
        db,
        "Upgrade protocol",
        "Details",
        "did:alice",
      );
      expect(p.id).toBeDefined();
      expect(p.title).toBe("Upgrade protocol");
      expect(p.status).toBe("active");
      expect(p.votesFor).toBe(0);
      expect(p.votesAgainst).toBe(0);
      expect(p.votingDeadline).toBeDefined();
    });

    it("throws on missing title", () => {
      expect(() =>
        createGovernanceProposal(db, "", "desc", "did:alice"),
      ).toThrow("Title is required");
    });

    it("persists to database", () => {
      createGovernanceProposal(db, "Test", "Desc", "did:alice");
      const rows = db.data.get("evomap_governance_proposals") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique IDs", () => {
      const p1 = createGovernanceProposal(db, "A", "", "did:alice");
      const p2 = createGovernanceProposal(db, "B", "", "did:bob");
      expect(p1.id).not.toBe(p2.id);
    });
  });

  // ─── voteOnGovernanceProposal ───────────────────────────────

  describe("voteOnGovernanceProposal", () => {
    it("records a for vote", () => {
      const p = createGovernanceProposal(db, "Test", "", "did:alice");
      const result = voteOnGovernanceProposal(db, p.id, "did:bob", "for");
      expect(result.vote).toBe("for");
      expect(result.totalVotes).toBe(1);
    });

    it("records an against vote", () => {
      const p = createGovernanceProposal(db, "Test", "", "did:alice");
      const result = voteOnGovernanceProposal(db, p.id, "did:bob", "against");
      expect(result.vote).toBe("against");
    });

    it("throws on unknown proposal", () => {
      expect(() =>
        voteOnGovernanceProposal(db, "nonexistent", "did:bob", "for"),
      ).toThrow("Proposal not found");
    });

    it("throws on invalid vote direction", () => {
      const p = createGovernanceProposal(db, "Test", "", "did:alice");
      expect(() =>
        voteOnGovernanceProposal(db, p.id, "did:bob", "maybe"),
      ).toThrow('Vote must be "for" or "against"');
    });

    it("auto-passes proposal on quorum (3 votes, majority for)", () => {
      const p = createGovernanceProposal(db, "Test", "", "did:alice");
      voteOnGovernanceProposal(db, p.id, "did:a", "for");
      voteOnGovernanceProposal(db, p.id, "did:b", "for");
      const result = voteOnGovernanceProposal(db, p.id, "did:c", "against");
      expect(result.status).toBe("passed");
    });

    it("auto-rejects proposal on quorum (majority against)", () => {
      const p = createGovernanceProposal(db, "Test", "", "did:alice");
      voteOnGovernanceProposal(db, p.id, "did:a", "against");
      voteOnGovernanceProposal(db, p.id, "did:b", "against");
      const result = voteOnGovernanceProposal(db, p.id, "did:c", "for");
      expect(result.status).toBe("rejected");
    });

    it("throws on voting on non-active proposal", () => {
      const p = createGovernanceProposal(db, "Test", "", "did:alice");
      voteOnGovernanceProposal(db, p.id, "did:a", "for");
      voteOnGovernanceProposal(db, p.id, "did:b", "for");
      voteOnGovernanceProposal(db, p.id, "did:c", "for"); // triggers quorum → passed
      expect(() => voteOnGovernanceProposal(db, p.id, "did:d", "for")).toThrow(
        "Proposal is not active",
      );
    });
  });

  // ─── getGovernanceDashboard ─────────────────────────────────

  describe("getGovernanceDashboard", () => {
    it("returns zeros initially", () => {
      const dash = getGovernanceDashboard();
      expect(dash.totalProposals).toBe(0);
      expect(dash.active).toBe(0);
      expect(dash.passed).toBe(0);
    });

    it("counts proposals by status", () => {
      createGovernanceProposal(db, "Active 1", "", "did:alice");
      const p2 = createGovernanceProposal(db, "Will Pass", "", "did:alice");
      voteOnGovernanceProposal(db, p2.id, "did:a", "for");
      voteOnGovernanceProposal(db, p2.id, "did:b", "for");
      voteOnGovernanceProposal(db, p2.id, "did:c", "for");

      const dash = getGovernanceDashboard();
      expect(dash.totalProposals).toBe(2);
      expect(dash.active).toBe(1);
      expect(dash.passed).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // V2 Canonical Surface (Phase 42)
  // ═══════════════════════════════════════════════════════════════

  describe("V2 frozen enums", () => {
    it("PROPOSAL_STATUS_V2 is frozen with 7 values", () => {
      expect(Object.isFrozen(PROPOSAL_STATUS_V2)).toBe(true);
      expect(Object.values(PROPOSAL_STATUS_V2).length).toBe(7);
      expect(PROPOSAL_STATUS_V2.EXECUTED).toBe("executed");
      expect(PROPOSAL_STATUS_V2.EXPIRED).toBe("expired");
    });

    it("PROPOSAL_TYPE is frozen with 5 values", () => {
      expect(Object.isFrozen(PROPOSAL_TYPE)).toBe(true);
      expect(Object.values(PROPOSAL_TYPE).length).toBe(5);
      expect(PROPOSAL_TYPE.DISPUTE).toBe("dispute");
    });

    it("VOTE_DIRECTION includes abstain", () => {
      expect(Object.isFrozen(VOTE_DIRECTION)).toBe(true);
      expect(VOTE_DIRECTION.ABSTAIN).toBe("abstain");
    });
  });

  describe("createGovernanceProposalV2", () => {
    it("creates active proposal with defaults", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        description: "D",
        proposerDid: "did:alice",
      });
      expect(p.status).toBe(PROPOSAL_STATUS_V2.ACTIVE);
      expect(p.type).toBe(PROPOSAL_TYPE.STANDARD);
      expect(p.quorum).toBe(3);
      expect(p.threshold).toBe(0.5);
    });

    it("accepts custom type, quorum, threshold", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        type: PROPOSAL_TYPE.FUNDING,
        quorum: 10,
        threshold: 0.67,
      });
      expect(p.type).toBe("funding");
      expect(p.quorum).toBe(10);
      expect(p.threshold).toBe(0.67);
    });

    it("rejects missing title", () => {
      expect(() => createGovernanceProposalV2(db, {})).toThrow(
        "Title is required",
      );
    });

    it("rejects unknown type", () => {
      expect(() =>
        createGovernanceProposalV2(db, { title: "T", type: "bogus" }),
      ).toThrow(/Unknown proposal type/);
    });

    it("rejects invalid quorum/threshold", () => {
      expect(() =>
        createGovernanceProposalV2(db, { title: "T", quorum: 0 }),
      ).toThrow(/Quorum must be/);
      expect(() =>
        createGovernanceProposalV2(db, { title: "T", threshold: 0 }),
      ).toThrow(/Threshold must be/);
      expect(() =>
        createGovernanceProposalV2(db, { title: "T", threshold: 1.5 }),
      ).toThrow(/Threshold must be/);
    });
  });

  describe("castVoteV2", () => {
    it("applies weighted vote", () => {
      const p = createGovernanceProposalV2(db, { title: "T", quorum: 5 });
      const r = castVoteV2(db, {
        proposalId: p.id,
        voterDid: "did:a",
        direction: VOTE_DIRECTION.FOR,
        weight: 3,
      });
      expect(r.direction).toBe("for");
      expect(r.weight).toBe(3);
      expect(r.status).toBe(PROPOSAL_STATUS_V2.ACTIVE);
    });

    it("passes when threshold met", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        quorum: 3,
        threshold: 0.6,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "a",
        direction: VOTE_DIRECTION.FOR,
        weight: 2,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "b",
        direction: VOTE_DIRECTION.FOR,
      });
      const r = castVoteV2(db, {
        proposalId: p.id,
        voterDid: "c",
        direction: VOTE_DIRECTION.AGAINST,
      });
      expect(r.status).toBe(PROPOSAL_STATUS_V2.PASSED);
    });

    it("rejects when threshold not met", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        quorum: 3,
        threshold: 0.6,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "a",
        direction: VOTE_DIRECTION.FOR,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "b",
        direction: VOTE_DIRECTION.AGAINST,
      });
      const r = castVoteV2(db, {
        proposalId: p.id,
        voterDid: "c",
        direction: VOTE_DIRECTION.AGAINST,
      });
      expect(r.status).toBe(PROPOSAL_STATUS_V2.REJECTED);
    });

    it("counts abstain but does not apply to threshold ratio", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        quorum: 3,
        threshold: 0.5,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "a",
        direction: VOTE_DIRECTION.FOR,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "b",
        direction: VOTE_DIRECTION.AGAINST,
      });
      const r = castVoteV2(db, {
        proposalId: p.id,
        voterDid: "c",
        direction: VOTE_DIRECTION.ABSTAIN,
      });
      // for=1, against=1, ratio 0.5, meets threshold
      expect(r.status).toBe(PROPOSAL_STATUS_V2.PASSED);
    });

    it("rejects unknown direction", () => {
      const p = createGovernanceProposalV2(db, { title: "T" });
      expect(() =>
        castVoteV2(db, { proposalId: p.id, voterDid: "a", direction: "maybe" }),
      ).toThrow(/Unknown vote direction/);
    });

    it("rejects non-positive weight", () => {
      const p = createGovernanceProposalV2(db, { title: "T" });
      expect(() =>
        castVoteV2(db, {
          proposalId: p.id,
          voterDid: "a",
          direction: VOTE_DIRECTION.FOR,
          weight: 0,
        }),
      ).toThrow(/Vote weight must be positive/);
    });
  });

  describe("setProposalStatus / execute / cancel", () => {
    it("transitions passed → executed", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        quorum: 1,
        threshold: 0.5,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "a",
        direction: VOTE_DIRECTION.FOR,
      });
      // After quorum-of-1 vote, proposal is passed
      const r = executeProposal(db, p.id);
      expect(r.status).toBe(PROPOSAL_STATUS_V2.EXECUTED);
    });

    it("rejects rejected → executed", () => {
      const p = createGovernanceProposalV2(db, {
        title: "T",
        quorum: 1,
        threshold: 0.6,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "a",
        direction: VOTE_DIRECTION.AGAINST,
      });
      expect(() => executeProposal(db, p.id)).toThrow(
        /Invalid proposal status transition/,
      );
    });

    it("cancels draft via status machine", () => {
      const p = createGovernanceProposalV2(db, { title: "T" });
      // active → cancelled allowed
      const r = cancelProposal(db, p.id);
      expect(r.status).toBe(PROPOSAL_STATUS_V2.CANCELLED);
    });

    it("rejects unknown status", () => {
      const p = createGovernanceProposalV2(db, { title: "T" });
      expect(() => setProposalStatus(db, p.id, "bogus")).toThrow(
        /Unknown proposal status/,
      );
    });
  });

  describe("expireProposalsV2", () => {
    it("expires only past-deadline active proposals", () => {
      const p1 = createGovernanceProposalV2(db, {
        title: "Old",
        votingDurationMs: 1,
      });
      const p2 = createGovernanceProposalV2(db, {
        title: "New",
        votingDurationMs: 1000 * 60 * 60 * 24,
      });
      // allow p1's deadline to pass
      const farFuture = Date.now() + 1000 * 60;
      const r = expireProposalsV2(db, farFuture);
      expect(r.expiredCount).toBe(1);
      expect(r.expiredIds).toContain(p1.id);
      const after = listProposalsV2(db, { status: PROPOSAL_STATUS_V2.EXPIRED });
      expect(after.length).toBe(1);
      void p2;
    });

    it("is a no-op when nothing is past-deadline", () => {
      createGovernanceProposalV2(db, {
        title: "Fresh",
        votingDurationMs: 1000 * 60 * 60 * 24,
      });
      const r = expireProposalsV2(db, Date.now());
      expect(r.expiredCount).toBe(0);
    });
  });

  describe("listProposalsV2", () => {
    it("filters by status/type/proposer", () => {
      const p1 = createGovernanceProposalV2(db, {
        title: "T1",
        proposerDid: "did:a",
        type: PROPOSAL_TYPE.STANDARD,
      });
      const p2 = createGovernanceProposalV2(db, {
        title: "T2",
        proposerDid: "did:b",
        type: PROPOSAL_TYPE.FUNDING,
      });
      expect(listProposalsV2(db, { type: PROPOSAL_TYPE.FUNDING })).toHaveLength(
        1,
      );
      expect(listProposalsV2(db, { proposerDid: "did:a" })[0].id).toBe(p1.id);
      expect(
        listProposalsV2(db, { status: PROPOSAL_STATUS_V2.ACTIVE }),
      ).toHaveLength(2);
      void p2;
    });
  });

  describe("traceContributions / getGovernanceStatsV2", () => {
    it("traceContributions mirrors traceOwnership", () => {
      registerOwnership(db, "g1", "did:alice");
      const t = traceContributions("g1");
      expect(t.owner).toBe("did:alice");
    });

    it("computes stats with byStatus/byType and totals", () => {
      registerOwnership(db, "g1", "did:alice");
      const p = createGovernanceProposalV2(db, {
        title: "T",
        type: PROPOSAL_TYPE.STANDARD,
        quorum: 3,
      });
      castVoteV2(db, {
        proposalId: p.id,
        voterDid: "a",
        direction: VOTE_DIRECTION.FOR,
        weight: 2,
      });
      const stats = getGovernanceStatsV2();
      expect(stats.totalProposals).toBe(1);
      expect(stats.totalOwnerships).toBe(1);
      expect(stats.byStatus.active).toBe(1);
      expect(stats.byType.standard).toBe(1);
      expect(stats.totalVotes).toBe(1);
      expect(stats.totalWeight).toBe(2);
    });
  });
});
