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
});
