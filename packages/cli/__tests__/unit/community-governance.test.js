/**
 * Unit tests for community-governance (Phase 54 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureGovernanceTables,
  listProposalTypes,
  listProposalStatuses,
  listImpactLevels,
  createProposal,
  getProposal,
  listProposals,
  activateProposal,
  closeProposal,
  expireProposal,
  castVote,
  listVotes,
  tallyVotes,
  analyzeImpact,
  predictVote,
  getGovernanceStats,
  PROPOSAL_TYPES,
  PROPOSAL_STATUS,
  IMPACT_LEVELS,
  VOTE_VALUES,
  _resetState,
} from "../../src/lib/community-governance.js";

describe("community-governance", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureGovernanceTables(db);
  });

  /* ── Schema / catalogs ─────────────────────────────────────── */

  describe("ensureGovernanceTables", () => {
    it("creates governance_proposals + governance_votes tables", () => {
      expect(db.tables.has("governance_proposals")).toBe(true);
      expect(db.tables.has("governance_votes")).toBe(true);
    });

    it("is idempotent", () => {
      ensureGovernanceTables(db);
      ensureGovernanceTables(db);
      expect(db.tables.has("governance_proposals")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureGovernanceTables(null)).not.toThrow();
    });
  });

  describe("Catalogs", () => {
    it("lists 4 proposal types", () => {
      const types = listProposalTypes();
      expect(types).toHaveLength(4);
      expect(types.map((t) => t.id)).toEqual([
        "parameter_change",
        "feature_request",
        "policy_update",
        "budget_allocation",
      ]);
    });

    it("lists 5 proposal statuses", () => {
      const statuses = listProposalStatuses();
      expect(statuses).toHaveLength(5);
      expect(statuses).toContain("draft");
      expect(statuses).toContain("active");
      expect(statuses).toContain("passed");
    });

    it("lists 4 impact levels", () => {
      const levels = listImpactLevels();
      expect(levels).toHaveLength(4);
      expect(levels.map((l) => l.id)).toEqual([
        "low",
        "medium",
        "high",
        "critical",
      ]);
    });

    it("constants are frozen", () => {
      expect(Object.isFrozen(PROPOSAL_TYPES)).toBe(true);
      expect(Object.isFrozen(PROPOSAL_STATUS)).toBe(true);
      expect(Object.isFrozen(IMPACT_LEVELS)).toBe(true);
      expect(Object.isFrozen(VOTE_VALUES)).toBe(true);
    });
  });

  /* ── createProposal ───────────────────────────────────────── */

  describe("createProposal", () => {
    it("creates a draft proposal with defaults", () => {
      const p = createProposal(db, { title: "Add dark mode" });
      expect(p.id).toBeTruthy();
      expect(p.title).toBe("Add dark mode");
      expect(p.type).toBe("feature_request");
      expect(p.status).toBe(PROPOSAL_STATUS.DRAFT);
      expect(p.voteYes).toBe(0);
      expect(p.voteNo).toBe(0);
      expect(p.voteAbstain).toBe(0);
    });

    it("accepts a specific type", () => {
      const p = createProposal(db, {
        title: "Increase timeout",
        type: "parameter_change",
      });
      expect(p.type).toBe("parameter_change");
    });

    it("persists to database", () => {
      createProposal(db, { title: "Test" });
      const rows = db.data.get("governance_proposals");
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe("Test");
    });

    it("stores proposerDid and description", () => {
      const p = createProposal(db, {
        title: "Test",
        description: "Details here",
        proposerDid: "did:key:abc",
      });
      expect(p.description).toBe("Details here");
      expect(p.proposerDid).toBe("did:key:abc");
    });

    it("rejects blank title", () => {
      expect(() => createProposal(db, { title: "" })).toThrow(
        /title is required/,
      );
    });

    it("rejects unknown type", () => {
      expect(() =>
        createProposal(db, { title: "T", type: "unknown_type" }),
      ).toThrow(/Unknown proposal type/);
    });

    it("rejects duplicate id", () => {
      createProposal(db, { title: "A", id: "p1" });
      expect(() => createProposal(db, { title: "B", id: "p1" })).toThrow(
        /already exists/,
      );
    });
  });

  /* ── getProposal / listProposals ──────────────────────────── */

  describe("getProposal / listProposals", () => {
    it("returns null for missing proposal", () => {
      expect(getProposal("nope")).toBeNull();
    });

    it("retrieves a proposal by id", () => {
      const p = createProposal(db, { title: "Test" });
      expect(getProposal(p.id).title).toBe("Test");
    });

    it("lists proposals sorted newest first", () => {
      createProposal(db, { title: "Old", now: 100 });
      createProposal(db, { title: "New", now: 200 });
      const list = listProposals();
      expect(list[0].title).toBe("New");
      expect(list[1].title).toBe("Old");
    });

    it("filters by status", () => {
      const p = createProposal(db, { title: "Draft" });
      createProposal(db, { title: "Another" });
      activateProposal(db, p.id);
      const active = listProposals({ status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe("Draft");
    });

    it("filters by type", () => {
      createProposal(db, { title: "A", type: "policy_update" });
      createProposal(db, { title: "B", type: "feature_request" });
      const policies = listProposals({ type: "policy_update" });
      expect(policies).toHaveLength(1);
      expect(policies[0].title).toBe("A");
    });

    it("honors limit", () => {
      for (let i = 0; i < 5; i++) {
        createProposal(db, { title: `P${i}` });
      }
      expect(listProposals({ limit: 2 })).toHaveLength(2);
    });
  });

  /* ── activateProposal ─────────────────────────────────────── */

  describe("activateProposal", () => {
    it("transitions draft → active with voting window", () => {
      const p = createProposal(db, { title: "Test" });
      const activated = activateProposal(db, p.id);
      expect(activated.status).toBe(PROPOSAL_STATUS.ACTIVE);
      expect(activated.votingStartsAt).toBeTruthy();
      expect(activated.votingEndsAt).toBeGreaterThan(activated.votingStartsAt);
    });

    it("sets custom duration", () => {
      const p = createProposal(db, { title: "Test" });
      const activated = activateProposal(db, p.id, {
        durationMs: 3600000,
        now: 1000,
      });
      expect(activated.votingStartsAt).toBe(1000);
      expect(activated.votingEndsAt).toBe(3601000);
    });

    it("rejects non-draft proposals", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      expect(() => activateProposal(db, p.id)).toThrow(/Only draft/);
    });

    it("rejects unknown proposal", () => {
      expect(() => activateProposal(db, "nope")).toThrow(/not found/);
    });
  });

  /* ── castVote ──────────────────────────────────────────────── */

  describe("castVote", () => {
    it("records a vote on an active proposal", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      const v = castVote(db, p.id, "did:voter:alice", "yes");
      expect(v.vote).toBe("yes");
      expect(v.voterDid).toBe("did:voter:alice");
      expect(v.weight).toBe(1.0);
      // Proposal vote counts updated
      expect(getProposal(p.id).voteYes).toBe(1);
    });

    it("supports weighted votes", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:voter:alice", "yes", { weight: 2.5 });
      expect(getProposal(p.id).voteYes).toBe(2.5);
    });

    it("replaces previous vote by same voter", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:voter:alice", "yes");
      castVote(db, p.id, "did:voter:alice", "no");
      expect(getProposal(p.id).voteYes).toBe(0);
      expect(getProposal(p.id).voteNo).toBe(1);
      expect(listVotes(p.id)).toHaveLength(1);
    });

    it("rejects voting on non-active proposals", () => {
      const p = createProposal(db, { title: "Test" });
      expect(() => castVote(db, p.id, "did:voter:alice", "yes")).toThrow(
        /active/,
      );
    });

    it("rejects invalid vote value", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      expect(() => castVote(db, p.id, "did:voter:alice", "maybe")).toThrow(
        /Invalid vote/,
      );
    });

    it("rejects blank voter DID", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      expect(() => castVote(db, p.id, "", "yes")).toThrow(/voter DID/);
    });

    it("rejects negative weight", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      expect(() =>
        castVote(db, p.id, "did:voter:alice", "yes", { weight: -1 }),
      ).toThrow(/non-negative/);
    });

    it("rejects unknown proposal", () => {
      expect(() => castVote(db, "nope", "did:voter:alice", "yes")).toThrow(
        /not found/,
      );
    });
  });

  /* ── listVotes ─────────────────────────────────────────────── */

  describe("listVotes", () => {
    it("lists votes for a proposal newest first", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes", { now: 100 });
      castVote(db, p.id, "did:b", "no", { now: 200 });
      const votes = listVotes(p.id);
      expect(votes).toHaveLength(2);
      expect(votes[0].voterDid).toBe("did:b");
    });

    it("returns empty array for no votes", () => {
      const p = createProposal(db, { title: "Test" });
      expect(listVotes(p.id)).toHaveLength(0);
    });

    it("honors limit", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      for (let i = 0; i < 5; i++) {
        castVote(db, p.id, `did:voter:${i}`, "yes");
      }
      expect(listVotes(p.id, { limit: 3 })).toHaveLength(3);
    });
  });

  /* ── tallyVotes ────────────────────────────────────────────── */

  describe("tallyVotes", () => {
    it("tallies with default thresholds", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      castVote(db, p.id, "did:b", "yes");
      castVote(db, p.id, "did:c", "no");
      const tally = tallyVotes(p.id);
      expect(tally.voteCount).toBe(3);
      expect(tally.yesWeight).toBe(2);
      expect(tally.noWeight).toBe(1);
      expect(tally.yesRatio).toBeCloseTo(0.6667, 3);
      expect(tally.passed).toBe(true);
    });

    it("fails when yes ratio below threshold", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      castVote(db, p.id, "did:b", "no");
      castVote(db, p.id, "did:c", "no");
      const tally = tallyVotes(p.id);
      expect(tally.yesRatio).toBeCloseTo(0.3333, 3);
      expect(tally.passed).toBe(false);
    });

    it("applies quorum check when totalVoters is given", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      // 1 / 10 voters = 10% < 50% quorum
      const tally = tallyVotes(p.id, { totalVoters: 10, quorum: 0.5 });
      expect(tally.quorumMet).toBe(false);
      expect(tally.passed).toBe(false);
    });

    it("passes with custom threshold", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      castVote(db, p.id, "did:b", "no");
      const tally = tallyVotes(p.id, { threshold: 0.5 });
      expect(tally.passed).toBe(true); // 50% exactly meets threshold
    });

    it("handles weighted votes in tally", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes", { weight: 3 });
      castVote(db, p.id, "did:b", "no", { weight: 1 });
      const tally = tallyVotes(p.id);
      expect(tally.yesWeight).toBe(3);
      expect(tally.noWeight).toBe(1);
      expect(tally.yesRatio).toBe(0.75);
      expect(tally.passed).toBe(true);
    });

    it("handles no votes (empty tally)", () => {
      const p = createProposal(db, { title: "Test" });
      const tally = tallyVotes(p.id);
      expect(tally.voteCount).toBe(0);
      expect(tally.yesRatio).toBe(0);
      expect(tally.passed).toBe(false);
    });

    it("excludes abstain from yes/no ratio", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      castVote(db, p.id, "did:b", "abstain");
      castVote(db, p.id, "did:c", "abstain");
      const tally = tallyVotes(p.id);
      expect(tally.yesRatio).toBe(1.0); // 1 yes / (1 yes + 0 no)
      expect(tally.passed).toBe(true);
    });
  });

  /* ── closeProposal / expireProposal ────────────────────────── */

  describe("closeProposal", () => {
    it("transitions active → passed when votes pass", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      castVote(db, p.id, "did:b", "yes");
      castVote(db, p.id, "did:c", "no");
      const { proposal, tally } = closeProposal(db, p.id);
      expect(proposal.status).toBe(PROPOSAL_STATUS.PASSED);
      expect(tally.passed).toBe(true);
    });

    it("transitions active → rejected when votes fail", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "no");
      castVote(db, p.id, "did:b", "no");
      const { proposal, tally } = closeProposal(db, p.id);
      expect(proposal.status).toBe(PROPOSAL_STATUS.REJECTED);
      expect(tally.passed).toBe(false);
    });

    it("rejects closing non-active proposals", () => {
      const p = createProposal(db, { title: "Test" });
      expect(() => closeProposal(db, p.id)).toThrow(/Only active/);
    });
  });

  describe("expireProposal", () => {
    it("transitions draft → expired", () => {
      const p = createProposal(db, { title: "Test" });
      const expired = expireProposal(db, p.id);
      expect(expired.status).toBe(PROPOSAL_STATUS.EXPIRED);
    });

    it("transitions active → expired", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      const expired = expireProposal(db, p.id);
      expect(expired.status).toBe(PROPOSAL_STATUS.EXPIRED);
    });

    it("rejects expiring passed/rejected proposals", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      closeProposal(db, p.id);
      expect(() => expireProposal(db, p.id)).toThrow(/Cannot expire/);
    });
  });

  /* ── analyzeImpact ─────────────────────────────────────────── */

  describe("analyzeImpact", () => {
    it("returns heuristic analysis for a feature request", () => {
      const p = createProposal(db, {
        title: "Add export button",
        description: "Adds a new export UI component for CSV",
      });
      const analysis = analyzeImpact(p.id);
      expect(analysis.impactLevel).toBeTruthy();
      expect(analysis.riskScore).toBeGreaterThanOrEqual(0);
      expect(analysis.riskScore).toBeLessThanOrEqual(1);
      expect(analysis.benefitScore).toBeGreaterThanOrEqual(0);
      expect(analysis.affectedComponents).toBeInstanceOf(Array);
      expect(analysis.affectedComponents.length).toBeGreaterThan(0);
      expect(analysis.estimatedEffort).toBeTruthy();
      expect(analysis.recommendations).toBeInstanceOf(Array);
      expect(analysis.analyzedAt).toBeTruthy();
    });

    it("boosts risk for security-related proposals", () => {
      const safe = createProposal(db, { title: "Change color scheme" });
      const risky = createProposal(db, {
        title: "Update auth encryption and permission system",
      });
      const safeAnalysis = analyzeImpact(safe.id);
      const riskyAnalysis = analyzeImpact(risky.id);
      expect(riskyAnalysis.riskScore).toBeGreaterThan(safeAnalysis.riskScore);
      expect(riskyAnalysis.affectedComponents).toContain("security");
    });

    it("detects database component from keywords", () => {
      const p = createProposal(db, {
        title: "Database migration for schema v2",
      });
      const analysis = analyzeImpact(p.id);
      expect(analysis.affectedComponents).toContain("database");
      expect(
        analysis.recommendations.some((r) => r.includes("migration")),
      ).toBe(true);
    });

    it("assigns higher effort for budget allocation", () => {
      const p = createProposal(db, {
        title: "Allocate Q2 funds",
        type: "budget_allocation",
      });
      const analysis = analyzeImpact(p.id);
      expect(analysis.estimatedEffort).toBe("large");
    });

    it("stores analysis on proposal", () => {
      const p = createProposal(db, { title: "Test" });
      analyzeImpact(p.id);
      const reloaded = getProposal(p.id);
      expect(reloaded.impactLevel).toBeTruthy();
      expect(reloaded.impactAnalysis).toBeTruthy();
    });

    it("rejects unknown proposal", () => {
      expect(() => analyzeImpact("nope")).toThrow(/not found/);
    });
  });

  /* ── predictVote ───────────────────────────────────────────── */

  describe("predictVote", () => {
    it("predicts from heuristic when no votes exist", () => {
      const p = createProposal(db, { title: "Test" });
      const pred = predictVote(p.id);
      expect(pred.basedOn).toBe("heuristic");
      expect(pred.sampleSize).toBe(0);
      expect(pred.confidence).toBe(0.3);
      expect(pred.yesProb).toBeGreaterThan(0);
      expect(pred.noProb).toBeGreaterThan(0);
    });

    it("uses impact analysis for better heuristic", () => {
      const p = createProposal(db, {
        title: "Security overhaul with encryption changes",
      });
      analyzeImpact(p.id);
      const pred = predictVote(p.id);
      expect(pred.basedOn).toBe("heuristic");
      // Higher risk → lower yesProb
      expect(pred.yesProb).toBeLessThan(0.7);
    });

    it("predicts from votes when available", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:a", "yes");
      castVote(db, p.id, "did:b", "yes");
      castVote(db, p.id, "did:c", "no");
      const pred = predictVote(p.id);
      expect(pred.basedOn).toBe("votes");
      expect(pred.sampleSize).toBe(3);
      expect(pred.predictedOutcome).toBe("pass");
      expect(pred.confidence).toBeGreaterThan(0.3);
    });

    it("increases confidence with more votes", () => {
      const p = createProposal(db, { title: "Test" });
      activateProposal(db, p.id);
      castVote(db, p.id, "did:1", "yes");
      const lowConf = predictVote(p.id).confidence;
      for (let i = 2; i <= 10; i++) {
        castVote(db, p.id, `did:${i}`, "yes");
      }
      const highConf = predictVote(p.id).confidence;
      expect(highConf).toBeGreaterThan(lowConf);
    });

    it("rejects unknown proposal", () => {
      expect(() => predictVote("nope")).toThrow(/not found/);
    });
  });

  /* ── stats ─────────────────────────────────────────────────── */

  describe("getGovernanceStats", () => {
    it("summarizes empty store", () => {
      const stats = getGovernanceStats();
      expect(stats.proposalCount).toBe(0);
      expect(stats.voteCount).toBe(0);
      expect(stats.byStatus.draft).toBe(0);
    });

    it("counts proposals by status and type", () => {
      const a = createProposal(db, { title: "A", type: "feature_request" });
      createProposal(db, { title: "B", type: "policy_update" });
      activateProposal(db, a.id);
      castVote(db, a.id, "did:a", "yes");
      castVote(db, a.id, "did:b", "no");
      const stats = getGovernanceStats();
      expect(stats.proposalCount).toBe(2);
      expect(stats.voteCount).toBe(2);
      expect(stats.byStatus.active).toBe(1);
      expect(stats.byStatus.draft).toBe(1);
      expect(stats.byType.feature_request).toBe(1);
      expect(stats.byType.policy_update).toBe(1);
    });
  });
});
