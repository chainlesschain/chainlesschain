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
});
