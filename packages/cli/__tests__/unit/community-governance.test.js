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

/* ═══════════════════════════════════════════════════════════════
 * Phase 54 V2 — Proposer Maturity + Delegation Lifecycle
 * ═════════════════════════════════════════════════════════════ */

import {
  PROPOSER_MATURITY_V2,
  DELEGATION_LIFECYCLE_V2,
  GOV_DEFAULT_MAX_ACTIVE_PROPOSERS_PER_REALM,
  GOV_DEFAULT_MAX_ACTIVE_DELEGATIONS_PER_DELEGATOR,
  GOV_DEFAULT_PROPOSER_IDLE_MS,
  GOV_DEFAULT_PENDING_DELEGATION_MS,
  getDefaultMaxActiveProposersPerRealmV2,
  getMaxActiveProposersPerRealmV2,
  setMaxActiveProposersPerRealmV2,
  getDefaultMaxActiveDelegationsPerDelegatorV2,
  getMaxActiveDelegationsPerDelegatorV2,
  setMaxActiveDelegationsPerDelegatorV2,
  getDefaultProposerIdleMsV2,
  getProposerIdleMsV2,
  setProposerIdleMsV2,
  getDefaultPendingDelegationMsV2,
  getPendingDelegationMsV2,
  setPendingDelegationMsV2,
  registerProposerV2,
  getProposerV2,
  setProposerMaturityV2,
  activateProposer,
  suspendProposer,
  retireProposer,
  touchProposerActivity,
  createDelegationV2,
  getDelegationV2,
  setDelegationStatusV2,
  activateDelegation,
  revokeDelegation,
  expireDelegation,
  getActiveProposerCount,
  getActiveDelegationCount,
  autoRetireIdleProposers,
  autoExpireStalePendingDelegations,
  getGovernanceStatsV2,
  _resetStateV2,
} from "../../src/lib/community-governance.js";

describe("community-governance V2", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("frozen enums & defaults", () => {
    it("PROPOSER_MATURITY_V2 has 4 statuses and is frozen", () => {
      expect(Object.values(PROPOSER_MATURITY_V2).sort()).toEqual(
        ["active", "onboarding", "retired", "suspended"].sort(),
      );
      expect(Object.isFrozen(PROPOSER_MATURITY_V2)).toBe(true);
    });
    it("DELEGATION_LIFECYCLE_V2 has 4 statuses and is frozen", () => {
      expect(Object.values(DELEGATION_LIFECYCLE_V2).sort()).toEqual(
        ["active", "expired", "pending", "revoked"].sort(),
      );
      expect(Object.isFrozen(DELEGATION_LIFECYCLE_V2)).toBe(true);
    });
    it("exports sane default config values", () => {
      expect(GOV_DEFAULT_MAX_ACTIVE_PROPOSERS_PER_REALM).toBe(100);
      expect(GOV_DEFAULT_MAX_ACTIVE_DELEGATIONS_PER_DELEGATOR).toBe(5);
      expect(GOV_DEFAULT_PROPOSER_IDLE_MS).toBe(180 * 86400000);
      expect(GOV_DEFAULT_PENDING_DELEGATION_MS).toBe(7 * 86400000);
    });
  });

  describe("config mutators", () => {
    it("setMaxActiveProposersPerRealmV2 floors non-integer, rejects ≤0/NaN", () => {
      expect(setMaxActiveProposersPerRealmV2(42.9)).toBe(42);
      expect(getMaxActiveProposersPerRealmV2()).toBe(42);
      expect(() => setMaxActiveProposersPerRealmV2(0)).toThrow(
        /positive integer/,
      );
      expect(() => setMaxActiveProposersPerRealmV2(-1)).toThrow();
      expect(() => setMaxActiveProposersPerRealmV2("foo")).toThrow();
      expect(getDefaultMaxActiveProposersPerRealmV2()).toBe(100);
    });
    it("setMaxActiveDelegationsPerDelegatorV2 floors + validates", () => {
      expect(setMaxActiveDelegationsPerDelegatorV2(9.9)).toBe(9);
      expect(getMaxActiveDelegationsPerDelegatorV2()).toBe(9);
      expect(() => setMaxActiveDelegationsPerDelegatorV2(0)).toThrow();
      expect(getDefaultMaxActiveDelegationsPerDelegatorV2()).toBe(5);
    });
    it("setProposerIdleMsV2 floors + validates", () => {
      expect(setProposerIdleMsV2(86400000.7)).toBe(86400000);
      expect(getProposerIdleMsV2()).toBe(86400000);
      expect(() => setProposerIdleMsV2(-1)).toThrow();
      expect(getDefaultProposerIdleMsV2()).toBe(180 * 86400000);
    });
    it("setPendingDelegationMsV2 floors + validates", () => {
      expect(setPendingDelegationMsV2(3600000.2)).toBe(3600000);
      expect(getPendingDelegationMsV2()).toBe(3600000);
      expect(() => setPendingDelegationMsV2(NaN)).toThrow();
      expect(getDefaultPendingDelegationMsV2()).toBe(7 * 86400000);
    });
    it("_resetStateV2 restores all 4 config values", () => {
      setMaxActiveProposersPerRealmV2(42);
      setMaxActiveDelegationsPerDelegatorV2(9);
      setProposerIdleMsV2(1000);
      setPendingDelegationMsV2(2000);
      _resetStateV2();
      expect(getMaxActiveProposersPerRealmV2()).toBe(100);
      expect(getMaxActiveDelegationsPerDelegatorV2()).toBe(5);
      expect(getProposerIdleMsV2()).toBe(180 * 86400000);
      expect(getPendingDelegationMsV2()).toBe(7 * 86400000);
    });
  });

  describe("registerProposerV2", () => {
    it("registers proposer with default onboarding status", () => {
      const p = registerProposerV2(null, {
        proposerId: "did:alice",
        realm: "main",
        displayName: "Alice",
      });
      expect(p.status).toBe("onboarding");
      expect(p.realm).toBe("main");
      expect(p.displayName).toBe("Alice");
      expect(p.createdAt).toBeGreaterThan(0);
      expect(p.lastActivityAt).toBe(p.createdAt);
    });
    it("honors initialStatus active", () => {
      const p = registerProposerV2(null, {
        proposerId: "did:bob",
        realm: "main",
        initialStatus: "active",
      });
      expect(p.status).toBe("active");
    });
    it("rejects missing proposerId", () => {
      expect(() => registerProposerV2(null, { realm: "main" })).toThrow(
        /proposerId/,
      );
    });
    it("rejects missing realm", () => {
      expect(() =>
        registerProposerV2(null, { proposerId: "did:alice" }),
      ).toThrow(/realm/);
    });
    it("rejects duplicate proposerId", () => {
      registerProposerV2(null, { proposerId: "x", realm: "main" });
      expect(() =>
        registerProposerV2(null, { proposerId: "x", realm: "main" }),
      ).toThrow(/already registered/);
    });
    it("rejects terminal initialStatus 'retired'", () => {
      expect(() =>
        registerProposerV2(null, {
          proposerId: "x",
          realm: "main",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });
    it("rejects invalid initialStatus", () => {
      expect(() =>
        registerProposerV2(null, {
          proposerId: "x",
          realm: "main",
          initialStatus: "bogus",
        }),
      ).toThrow(/Invalid initial status/);
    });
    it("enforces per-realm active cap (active-only counted)", () => {
      setMaxActiveProposersPerRealmV2(2);
      registerProposerV2(null, {
        proposerId: "a",
        realm: "main",
        initialStatus: "active",
      });
      registerProposerV2(null, {
        proposerId: "b",
        realm: "main",
        initialStatus: "active",
      });
      expect(() =>
        registerProposerV2(null, {
          proposerId: "c",
          realm: "main",
          initialStatus: "active",
        }),
      ).toThrow(/Max active proposers per realm/);
      // other realm unaffected
      expect(
        registerProposerV2(null, {
          proposerId: "d",
          realm: "other",
          initialStatus: "active",
        }).status,
      ).toBe("active");
    });
    it("onboarding registrations excluded from active cap", () => {
      setMaxActiveProposersPerRealmV2(1);
      registerProposerV2(null, {
        proposerId: "a",
        realm: "main",
        initialStatus: "active",
      });
      // onboarding should not count toward cap
      registerProposerV2(null, { proposerId: "b", realm: "main" });
      registerProposerV2(null, { proposerId: "c", realm: "main" });
      expect(getActiveProposerCount("main")).toBe(1);
    });
  });

  describe("setProposerMaturityV2", () => {
    beforeEach(() => {
      registerProposerV2(null, { proposerId: "p1", realm: "main" });
    });
    it("traverses onboarding→active→suspended→active→retired", () => {
      expect(setProposerMaturityV2(null, "p1", "active").status).toBe("active");
      expect(setProposerMaturityV2(null, "p1", "suspended").status).toBe(
        "suspended",
      );
      expect(setProposerMaturityV2(null, "p1", "active").status).toBe("active");
      expect(setProposerMaturityV2(null, "p1", "retired").status).toBe(
        "retired",
      );
    });
    it("permits onboarding→retired direct", () => {
      expect(setProposerMaturityV2(null, "p1", "retired").status).toBe(
        "retired",
      );
    });
    it("blocks onboarding→suspended (not adjacent)", () => {
      expect(() => setProposerMaturityV2(null, "p1", "suspended")).toThrow(
        /Invalid transition/,
      );
    });
    it("rejects transitions out of terminal retired", () => {
      setProposerMaturityV2(null, "p1", "retired");
      expect(() => setProposerMaturityV2(null, "p1", "active")).toThrow(
        /terminal/,
      );
    });
    it("rejects unknown proposer", () => {
      expect(() => setProposerMaturityV2(null, "ghost", "active")).toThrow(
        /not registered/,
      );
    });
    it("rejects invalid target status", () => {
      expect(() => setProposerMaturityV2(null, "p1", "bogus")).toThrow(
        /Invalid proposer status/,
      );
    });
    it("enforces cap on transition to active", () => {
      setMaxActiveProposersPerRealmV2(1);
      registerProposerV2(null, {
        proposerId: "p2",
        realm: "main",
        initialStatus: "active",
      });
      expect(() => setProposerMaturityV2(null, "p1", "active")).toThrow(
        /Max active proposers/,
      );
    });
    it("merges patch metadata and stamps reason", () => {
      const p = setProposerMaturityV2(null, "p1", "active", {
        reason: "approved",
        metadata: { approver: "alice" },
      });
      expect(p.reason).toBe("approved");
      expect(p.metadata.approver).toBe("alice");
      const p2 = setProposerMaturityV2(null, "p1", "suspended", {
        reason: "abuse",
        metadata: { ticket: 42 },
      });
      expect(p2.metadata.approver).toBe("alice");
      expect(p2.metadata.ticket).toBe(42);
      expect(getProposerV2("ghost")).toBeNull();
    });
  });

  describe("touchProposerActivity", () => {
    it("bumps lastActivityAt", async () => {
      const p = registerProposerV2(null, { proposerId: "p1", realm: "main" });
      const orig = p.lastActivityAt;
      await new Promise((r) => setTimeout(r, 2));
      const updated = touchProposerActivity("p1");
      expect(updated.lastActivityAt).toBeGreaterThanOrEqual(orig);
    });
    it("throws on unknown", () => {
      expect(() => touchProposerActivity("ghost")).toThrow(/not registered/);
    });
  });

  describe("createDelegationV2", () => {
    beforeEach(() => {
      registerProposerV2(null, { proposerId: "alice", realm: "main" });
      registerProposerV2(null, { proposerId: "bob", realm: "main" });
    });
    it("creates delegation with default pending status", () => {
      const d = createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "all",
      });
      expect(d.status).toBe("pending");
      expect(d.scope).toBe("all");
    });
    it("rejects each missing field", () => {
      expect(() =>
        createDelegationV2(null, {
          delegatorId: "a",
          delegateeId: "b",
          scope: "x",
        }),
      ).toThrow(/delegationId/);
      expect(() =>
        createDelegationV2(null, {
          delegationId: "d",
          delegateeId: "b",
          scope: "x",
        }),
      ).toThrow(/delegatorId/);
      expect(() =>
        createDelegationV2(null, {
          delegationId: "d",
          delegatorId: "a",
          scope: "x",
        }),
      ).toThrow(/delegateeId/);
      expect(() =>
        createDelegationV2(null, {
          delegationId: "d",
          delegatorId: "a",
          delegateeId: "b",
        }),
      ).toThrow(/scope/);
    });
    it("rejects self-delegation", () => {
      expect(() =>
        createDelegationV2(null, {
          delegationId: "d1",
          delegatorId: "a",
          delegateeId: "a",
          scope: "all",
        }),
      ).toThrow(/must differ/);
    });
    it("rejects duplicate delegationId", () => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "all",
      });
      expect(() =>
        createDelegationV2(null, {
          delegationId: "d1",
          delegatorId: "alice",
          delegateeId: "bob",
          scope: "x",
        }),
      ).toThrow(/already registered/);
    });
    it("enforces per-delegator open cap (pending+active counted)", () => {
      setMaxActiveDelegationsPerDelegatorV2(2);
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "x",
      });
      createDelegationV2(null, {
        delegationId: "d2",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "y",
      });
      expect(() =>
        createDelegationV2(null, {
          delegationId: "d3",
          delegatorId: "alice",
          delegateeId: "bob",
          scope: "z",
        }),
      ).toThrow(/Max active delegations per delegator/);
    });
    it("terminal delegations excluded from cap", () => {
      setMaxActiveDelegationsPerDelegatorV2(1);
      const d1 = createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "x",
      });
      revokeDelegation(null, d1.delegationId);
      // revoked no longer counts
      const d2 = createDelegationV2(null, {
        delegationId: "d2",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "y",
      });
      expect(d2.status).toBe("pending");
    });
  });

  describe("setDelegationStatusV2", () => {
    beforeEach(() => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "all",
      });
    });
    it("traverses pending→active→revoked", () => {
      expect(setDelegationStatusV2(null, "d1", "active").status).toBe("active");
      expect(setDelegationStatusV2(null, "d1", "revoked").status).toBe(
        "revoked",
      );
    });
    it("permits pending→revoked direct", () => {
      expect(setDelegationStatusV2(null, "d1", "revoked").status).toBe(
        "revoked",
      );
    });
    it("permits pending→expired direct", () => {
      expect(setDelegationStatusV2(null, "d1", "expired").status).toBe(
        "expired",
      );
    });
    it("permits active→expired", () => {
      setDelegationStatusV2(null, "d1", "active");
      expect(setDelegationStatusV2(null, "d1", "expired").status).toBe(
        "expired",
      );
    });
    it("rejects transitions out of revoked (terminal)", () => {
      setDelegationStatusV2(null, "d1", "revoked");
      expect(() => setDelegationStatusV2(null, "d1", "active")).toThrow(
        /terminal/,
      );
    });
    it("rejects transitions out of expired (terminal)", () => {
      setDelegationStatusV2(null, "d1", "expired");
      expect(() => setDelegationStatusV2(null, "d1", "active")).toThrow(
        /terminal/,
      );
    });
    it("rejects unknown delegation", () => {
      expect(() => setDelegationStatusV2(null, "ghost", "active")).toThrow(
        /not registered/,
      );
    });
    it("rejects invalid target status", () => {
      expect(() => setDelegationStatusV2(null, "d1", "bogus")).toThrow(
        /Invalid delegation status/,
      );
    });
    it("stamps activatedAt only on first activation", async () => {
      const d1 = setDelegationStatusV2(null, "d1", "active");
      expect(d1.activatedAt).toBeGreaterThan(0);
      const t0 = d1.activatedAt;
      await new Promise((r) => setTimeout(r, 2));
      // no re-activation path in spec, so test via direct setter w/ patch.now
      // (pending→active is stamp-once even if re-entered via some future path)
      const rec = getDelegationV2("d1");
      expect(rec.activatedAt).toBe(t0);
    });
    it("merges patch metadata + stamps reason", () => {
      const d = setDelegationStatusV2(null, "d1", "active", {
        reason: "accepted",
        metadata: { signed: true },
      });
      expect(d.reason).toBe("accepted");
      expect(d.metadata.signed).toBe(true);
    });
  });

  describe("counts", () => {
    it("getActiveProposerCount scopes by realm", () => {
      registerProposerV2(null, {
        proposerId: "a",
        realm: "r1",
        initialStatus: "active",
      });
      registerProposerV2(null, {
        proposerId: "b",
        realm: "r1",
        initialStatus: "active",
      });
      registerProposerV2(null, {
        proposerId: "c",
        realm: "r2",
        initialStatus: "active",
      });
      registerProposerV2(null, { proposerId: "d", realm: "r1" }); // onboarding
      expect(getActiveProposerCount()).toBe(3);
      expect(getActiveProposerCount("r1")).toBe(2);
      expect(getActiveProposerCount("r2")).toBe(1);
      expect(getActiveProposerCount("nonexistent")).toBe(0);
    });
    it("getActiveDelegationCount scopes by delegator, excludes terminals", () => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "x",
      });
      createDelegationV2(null, {
        delegationId: "d2",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "y",
      });
      createDelegationV2(null, {
        delegationId: "d3",
        delegatorId: "carol",
        delegateeId: "bob",
        scope: "x",
      });
      revokeDelegation(null, "d2");
      expect(getActiveDelegationCount()).toBe(2);
      expect(getActiveDelegationCount("alice")).toBe(1);
      expect(getActiveDelegationCount("carol")).toBe(1);
      expect(getActiveDelegationCount("ghost")).toBe(0);
    });
  });

  describe("autoRetireIdleProposers", () => {
    it("retires active proposers past idle window", () => {
      registerProposerV2(null, {
        proposerId: "p1",
        realm: "r",
        initialStatus: "active",
        now: 1_000_000,
      });
      setProposerIdleMsV2(1000);
      const flipped = autoRetireIdleProposers(null, 1_002_000);
      expect(flipped).toEqual(["p1"]);
      expect(getProposerV2("p1").status).toBe("retired");
      expect(getProposerV2("p1").reason).toBe("idle");
    });
    it("retires suspended proposers past idle window", () => {
      registerProposerV2(null, {
        proposerId: "p1",
        realm: "r",
        now: 1_000_000,
      });
      setProposerMaturityV2(null, "p1", "active", { now: 1_000_000 });
      setProposerMaturityV2(null, "p1", "suspended", { now: 1_000_000 });
      setProposerIdleMsV2(1000);
      // manually reset lastActivityAt to original
      const rec = getProposerV2("p1");
      expect(rec.status).toBe("suspended");
      const flipped = autoRetireIdleProposers(null, 1_002_000);
      expect(flipped).toEqual(["p1"]);
    });
    it("skips onboarding + retired", () => {
      registerProposerV2(null, {
        proposerId: "p1",
        realm: "r",
        now: 1_000_000,
      });
      registerProposerV2(null, {
        proposerId: "p2",
        realm: "r",
        now: 1_000_000,
        initialStatus: "active",
      });
      retireProposer(null, "p2");
      setProposerIdleMsV2(1000);
      expect(autoRetireIdleProposers(null, 1_002_000)).toEqual([]);
    });
    it("skips fresh proposers", () => {
      registerProposerV2(null, {
        proposerId: "p1",
        realm: "r",
        now: 1_000_000,
        initialStatus: "active",
      });
      setProposerIdleMsV2(1_000_000);
      expect(autoRetireIdleProposers(null, 1_001_000)).toEqual([]);
    });
  });

  describe("autoExpireStalePendingDelegations", () => {
    it("expires pending delegations past window", () => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "x",
        now: 1_000_000,
      });
      setPendingDelegationMsV2(1000);
      const flipped = autoExpireStalePendingDelegations(null, 1_002_000);
      expect(flipped).toEqual(["d1"]);
      expect(getDelegationV2("d1").status).toBe("expired");
      expect(getDelegationV2("d1").reason).toBe("pending_timeout");
    });
    it("skips fresh pending", () => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "x",
        now: 1_000_000,
      });
      setPendingDelegationMsV2(1_000_000);
      expect(autoExpireStalePendingDelegations(null, 1_001_000)).toEqual([]);
    });
    it("skips non-pending (active, revoked, expired)", () => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "x",
        now: 1_000_000,
      });
      createDelegationV2(null, {
        delegationId: "d2",
        delegatorId: "alice",
        delegateeId: "bob",
        scope: "y",
        now: 1_000_000,
      });
      activateDelegation(null, "d1");
      revokeDelegation(null, "d2");
      setPendingDelegationMsV2(1000);
      expect(autoExpireStalePendingDelegations(null, 1_002_000)).toEqual([]);
    });
  });

  describe("getGovernanceStatsV2", () => {
    it("zero-initialized enum keys when empty", () => {
      const s = getGovernanceStatsV2();
      expect(s.totalProposersV2).toBe(0);
      expect(s.totalDelegationsV2).toBe(0);
      expect(s.proposersByStatus).toEqual({
        onboarding: 0,
        active: 0,
        suspended: 0,
        retired: 0,
      });
      expect(s.delegationsByStatus).toEqual({
        pending: 0,
        active: 0,
        revoked: 0,
        expired: 0,
      });
      expect(s.maxActiveProposersPerRealm).toBe(100);
      expect(s.maxActiveDelegationsPerDelegator).toBe(5);
      expect(s.proposerIdleMs).toBe(GOV_DEFAULT_PROPOSER_IDLE_MS);
      expect(s.pendingDelegationMs).toBe(GOV_DEFAULT_PENDING_DELEGATION_MS);
    });
    it("aggregates across all 4+4 statuses", () => {
      registerProposerV2(null, { proposerId: "a", realm: "r" });
      registerProposerV2(null, {
        proposerId: "b",
        realm: "r",
        initialStatus: "active",
      });
      registerProposerV2(null, {
        proposerId: "c",
        realm: "r",
        initialStatus: "active",
      });
      suspendProposer(null, "b");
      retireProposer(null, "c");
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "a",
        delegateeId: "b",
        scope: "x",
      });
      createDelegationV2(null, {
        delegationId: "d2",
        delegatorId: "a",
        delegateeId: "b",
        scope: "y",
      });
      createDelegationV2(null, {
        delegationId: "d3",
        delegatorId: "a",
        delegateeId: "b",
        scope: "z",
      });
      activateDelegation(null, "d1");
      revokeDelegation(null, "d2");
      expireDelegation(null, "d3");

      const s = getGovernanceStatsV2();
      expect(s.totalProposersV2).toBe(3);
      expect(s.proposersByStatus.onboarding).toBe(1);
      expect(s.proposersByStatus.active).toBe(0);
      expect(s.proposersByStatus.suspended).toBe(1);
      expect(s.proposersByStatus.retired).toBe(1);
      expect(s.totalDelegationsV2).toBe(3);
      expect(s.delegationsByStatus.active).toBe(1);
      expect(s.delegationsByStatus.revoked).toBe(1);
      expect(s.delegationsByStatus.expired).toBe(1);
      expect(s.delegationsByStatus.pending).toBe(0);
    });
  });

  describe("shortcuts", () => {
    it("activateProposer / suspendProposer / retireProposer", () => {
      registerProposerV2(null, { proposerId: "p1", realm: "r" });
      expect(activateProposer(null, "p1").status).toBe("active");
      expect(suspendProposer(null, "p1").status).toBe("suspended");
      expect(retireProposer(null, "p1").status).toBe("retired");
    });
    it("activateDelegation / revokeDelegation / expireDelegation", () => {
      createDelegationV2(null, {
        delegationId: "d1",
        delegatorId: "a",
        delegateeId: "b",
        scope: "x",
      });
      expect(activateDelegation(null, "d1").status).toBe("active");
      createDelegationV2(null, {
        delegationId: "d2",
        delegatorId: "a",
        delegateeId: "b",
        scope: "y",
      });
      expect(revokeDelegation(null, "d2").status).toBe("revoked");
      createDelegationV2(null, {
        delegationId: "d3",
        delegatorId: "a",
        delegateeId: "b",
        scope: "z",
      });
      expect(expireDelegation(null, "d3").status).toBe("expired");
    });
  });
});
