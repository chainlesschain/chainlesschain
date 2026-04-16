/**
 * Unit tests for collaboration-governance (Phase 64 CLI port).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureGovernanceTables,
  listDecisionTypes,
  listConflictStrategies,
  listQualityMetrics,
  listPriorityLevels,
  listPermissionTiers,
  createDecision,
  getDecision,
  listDecisions,
  vote,
  tallyDecision,
  markExecuted,
  setAutonomyLevel,
  getAutonomyLevel,
  listAutonomyAgents,
  calculateSkillMatch,
  balanceLoad,
  calculatePriority,
  optimizeTaskAssignment,
  DECISION_TYPES,
  DECISION_STATUS,
  PRIORITY_LEVELS,
  PERMISSION_TIERS,
  _resetState,
} from "../../src/lib/collaboration-governance.js";

describe("collaboration-governance", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureGovernanceTables(db);
  });

  /* ── Schema / constants ────────────────────────────────────── */

  describe("ensureGovernanceTables", () => {
    it("creates governance_decisions + autonomy_levels tables", () => {
      expect(db.tables.has("governance_decisions")).toBe(true);
      expect(db.tables.has("autonomy_levels")).toBe(true);
    });

    it("is idempotent", () => {
      ensureGovernanceTables(db);
      ensureGovernanceTables(db);
      expect(db.tables.has("governance_decisions")).toBe(true);
    });

    it("no-ops when db is null", () => {
      expect(() => ensureGovernanceTables(null)).not.toThrow();
    });
  });

  describe("Constants", () => {
    it("exposes 5 decision types", () => {
      expect(listDecisionTypes()).toHaveLength(5);
      expect(listDecisionTypes()).toContain("task_assignment");
      expect(listDecisionTypes()).toContain("autonomy_level");
    });

    it("exposes 4 conflict strategies", () => {
      const strategies = listConflictStrategies();
      expect(strategies).toHaveLength(4);
      expect(strategies.map((s) => s.name)).toEqual([
        "voting",
        "arbitration",
        "consensus",
        "auto_merge",
      ]);
    });

    it("consensus strategy lists raft/pbft/paxos", () => {
      const consensus = listConflictStrategies().find(
        (s) => s.name === "consensus",
      );
      expect(consensus.algorithms).toEqual(["raft", "pbft", "paxos"]);
    });

    it("exposes 5 quality metrics", () => {
      expect(listQualityMetrics()).toHaveLength(5);
      expect(listQualityMetrics()).toContain("code_quality");
    });

    it("exposes 5 priority levels with numeric values", () => {
      const priorities = listPriorityLevels();
      expect(priorities).toHaveLength(5);
      expect(PRIORITY_LEVELS.CRITICAL).toBe(5);
      expect(PRIORITY_LEVELS.TRIVIAL).toBe(1);
    });

    it("exposes 5 permission tiers L0..L4", () => {
      const tiers = listPermissionTiers();
      expect(tiers).toHaveLength(5);
      expect(tiers[0].tier).toBe("L0");
      expect(tiers[0].permissions).toEqual(["read", "suggest"]);
      expect(tiers[4].permissions).toEqual(["all"]);
    });

    it("L2 permissions include write/refactor/test", () => {
      expect(PERMISSION_TIERS.L2).toContain("write");
      expect(PERMISSION_TIERS.L2).toContain("refactor");
      expect(PERMISSION_TIERS.L2).toContain("test");
    });
  });

  /* ── Decisions ─────────────────────────────────────────────── */

  describe("createDecision", () => {
    it("creates a pending decision with id", () => {
      const d = createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "Assign P1 to agent-42",
      });
      expect(d.decisionId).toBeDefined();
      expect(d.status).toBe(DECISION_STATUS.PENDING);
      expect(d.votes).toEqual({});
      expect(d.type).toBe("task_assignment");
    });

    it("rejects unknown type", () => {
      expect(() =>
        createDecision(db, { type: "bogus", proposal: "x" }),
      ).toThrow(/Unknown decision type/);
    });

    it("rejects empty proposal", () => {
      expect(() =>
        createDecision(db, {
          type: DECISION_TYPES.TASK_ASSIGNMENT,
          proposal: "",
        }),
      ).toThrow(/proposal is required/);
    });

    it("persists to DB", () => {
      const d = createDecision(db, {
        type: DECISION_TYPES.POLICY_UPDATE,
        proposal: "Enable strict review",
      });
      const row = db
        .prepare("SELECT * FROM governance_decisions WHERE decision_id = ?")
        .get(d.decisionId);
      expect(row).toBeTruthy();
      expect(row.type).toBe("policy_update");
      expect(row.status).toBe("pending");
    });

    it("strips internal _seq from result", () => {
      const d = createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "test",
      });
      expect(d).not.toHaveProperty("_seq");
    });
  });

  describe("getDecision / listDecisions", () => {
    beforeEach(() => {
      createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "A",
      });
      createDecision(db, {
        type: DECISION_TYPES.POLICY_UPDATE,
        proposal: "B",
      });
      createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "C",
      });
    });

    it("getDecision returns null for unknown id", () => {
      expect(getDecision("nope")).toBeNull();
    });

    it("listDecisions returns most-recent first", () => {
      const rows = listDecisions();
      expect(rows).toHaveLength(3);
      expect(rows[0].proposal).toBe("C");
      expect(rows[2].proposal).toBe("A");
    });

    it("filters by type", () => {
      const rows = listDecisions({ type: "task_assignment" });
      expect(rows).toHaveLength(2);
      expect(rows.every((d) => d.type === "task_assignment")).toBe(true);
    });

    it("rejects unknown status filter", () => {
      expect(() => listDecisions({ status: "weird" })).toThrow(
        /Unknown status/,
      );
    });

    it("respects limit", () => {
      expect(listDecisions({ limit: 1 })).toHaveLength(1);
    });
  });

  describe("vote", () => {
    let decisionId;

    beforeEach(() => {
      const d = createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "test",
      });
      decisionId = d.decisionId;
    });

    it("records approve vote and moves to voting", () => {
      const d = vote(db, decisionId, "agent-1", "approve", "looks good");
      expect(d.status).toBe(DECISION_STATUS.VOTING);
      expect(d.votes["agent-1"].vote).toBe("approve");
      expect(d.votes["agent-1"].reason).toBe("looks good");
    });

    it("accepts reject and abstain", () => {
      vote(db, decisionId, "a1", "reject");
      vote(db, decisionId, "a2", "abstain");
      const d = getDecision(decisionId);
      expect(d.votes.a1.vote).toBe("reject");
      expect(d.votes.a2.vote).toBe("abstain");
    });

    it("rejects invalid vote value", () => {
      expect(() => vote(db, decisionId, "a1", "maybe")).toThrow(/Invalid vote/);
    });

    it("rejects empty agentId", () => {
      expect(() => vote(db, decisionId, "", "approve")).toThrow(
        /agentId is required/,
      );
    });

    it("rejects vote on unknown decision", () => {
      expect(() => vote(db, "nope", "a1", "approve")).toThrow(/not found/);
    });

    it("rejects voting on executed decision", () => {
      // Cast votes, tally, execute, then try to vote again
      vote(db, decisionId, "a1", "approve");
      tallyDecision(db, decisionId, { quorum: 0, threshold: 0.5 });
      markExecuted(db, decisionId);
      expect(() => vote(db, decisionId, "a2", "approve")).toThrow(
        /Cannot vote/,
      );
    });

    it("overwrites repeat vote from same agent", () => {
      vote(db, decisionId, "a1", "approve");
      vote(db, decisionId, "a1", "reject", "changed my mind");
      const d = getDecision(decisionId);
      expect(Object.keys(d.votes)).toHaveLength(1);
      expect(d.votes.a1.vote).toBe("reject");
      expect(d.votes.a1.reason).toBe("changed my mind");
    });
  });

  describe("tallyDecision", () => {
    let decisionId;

    beforeEach(() => {
      const d = createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "test",
      });
      decisionId = d.decisionId;
    });

    it("approves when approvalRate >= threshold and quorum met", () => {
      vote(db, decisionId, "a1", "approve");
      vote(db, decisionId, "a2", "approve");
      vote(db, decisionId, "a3", "reject");
      const d = tallyDecision(db, decisionId, { quorum: 0.5, threshold: 0.6 });
      expect(d.status).toBe(DECISION_STATUS.APPROVED);
      expect(d.resolution.tally).toEqual({ approve: 2, reject: 1, abstain: 0 });
      expect(d.resolution.approvalRate).toBeCloseTo(0.667, 2);
    });

    it("rejects when approvalRate below threshold", () => {
      vote(db, decisionId, "a1", "approve");
      vote(db, decisionId, "a2", "reject");
      vote(db, decisionId, "a3", "reject");
      const d = tallyDecision(db, decisionId, { threshold: 0.6 });
      expect(d.status).toBe(DECISION_STATUS.REJECTED);
      expect(d.resolution.outcome).toMatch(/rejected/);
    });

    it("rejects when quorum not met", () => {
      vote(db, decisionId, "a1", "approve");
      // Force totalVoters=10 so participation is only 10%
      const d = tallyDecision(db, decisionId, {
        quorum: 0.5,
        threshold: 0.5,
        totalVoters: 10,
      });
      expect(d.status).toBe(DECISION_STATUS.REJECTED);
      expect(d.resolution.outcome).toMatch(/quorum not met/);
    });

    it("abstains don't count toward approval rate", () => {
      vote(db, decisionId, "a1", "approve");
      vote(db, decisionId, "a2", "abstain");
      vote(db, decisionId, "a3", "abstain");
      const d = tallyDecision(db, decisionId, { quorum: 0.5, threshold: 0.5 });
      expect(d.resolution.approvalRate).toBe(1); // 1 approve out of 1 effective
      expect(d.status).toBe(DECISION_STATUS.APPROVED);
    });

    it("rejects tally on already-executed decision", () => {
      vote(db, decisionId, "a1", "approve");
      tallyDecision(db, decisionId, { quorum: 0, threshold: 0.5 });
      markExecuted(db, decisionId);
      expect(() => tallyDecision(db, decisionId)).toThrow(/Cannot tally/);
    });
  });

  describe("markExecuted", () => {
    it("marks approved decision as executed", () => {
      const d = createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "test",
      });
      vote(db, d.decisionId, "a1", "approve");
      tallyDecision(db, d.decisionId, { quorum: 0, threshold: 0.5 });
      const executed = markExecuted(db, d.decisionId);
      expect(executed.status).toBe(DECISION_STATUS.EXECUTED);
      expect(executed.executedAt).toBeGreaterThan(0);
    });

    it("rejects non-approved decisions", () => {
      const d = createDecision(db, {
        type: DECISION_TYPES.TASK_ASSIGNMENT,
        proposal: "test",
      });
      expect(() => markExecuted(db, d.decisionId)).toThrow(
        /Can only execute approved/,
      );
    });
  });

  /* ── Autonomy levels ───────────────────────────────────────── */

  describe("setAutonomyLevel", () => {
    it("sets initial level with L2 permissions", () => {
      const r = setAutonomyLevel(db, "agent-1", 2, { reason: "initial" });
      expect(r.currentLevel).toBe(2);
      expect(r.permissions).toEqual(PERMISSION_TIERS.L2);
      expect(r.adjustmentHistory).toHaveLength(1);
      expect(r.adjustmentHistory[0].reason).toBe("initial");
    });

    it("appends to adjustment history on re-set", () => {
      setAutonomyLevel(db, "agent-1", 0);
      setAutonomyLevel(db, "agent-1", 1);
      const r = setAutonomyLevel(db, "agent-1", 2, { reason: "promoted" });
      expect(r.currentLevel).toBe(2);
      expect(r.adjustmentHistory).toHaveLength(3);
      expect(r.adjustmentHistory[2].reason).toBe("promoted");
    });

    it("preserves level 0 (falsy guard)", () => {
      const r = setAutonomyLevel(db, "agent-1", 0);
      expect(r.currentLevel).toBe(0);
      expect(r.permissions).toEqual(PERMISSION_TIERS.L0);
    });

    it("rejects invalid level", () => {
      expect(() => setAutonomyLevel(db, "agent-1", 5)).toThrow(
        /Invalid autonomy level/,
      );
    });

    it("rejects empty agentId", () => {
      expect(() => setAutonomyLevel(db, "", 2)).toThrow(/agentId is required/);
    });

    it("persists to DB", () => {
      setAutonomyLevel(db, "agent-1", 3);
      const row = db
        .prepare("SELECT * FROM autonomy_levels WHERE agent_id = ?")
        .get("agent-1");
      expect(row.current_level).toBe(3);
    });

    it("updates DB row on re-set (not insert)", () => {
      setAutonomyLevel(db, "agent-1", 1);
      setAutonomyLevel(db, "agent-1", 3);
      const rows = db
        .prepare("SELECT * FROM autonomy_levels WHERE agent_id = ?")
        .all("agent-1");
      expect(rows).toHaveLength(1);
      expect(rows[0].current_level).toBe(3);
    });
  });

  describe("getAutonomyLevel / listAutonomyAgents", () => {
    beforeEach(() => {
      setAutonomyLevel(db, "agent-a", 1);
      setAutonomyLevel(db, "agent-b", 2);
      setAutonomyLevel(db, "agent-c", 2);
    });

    it("getAutonomyLevel returns null for unknown", () => {
      expect(getAutonomyLevel("unknown")).toBeNull();
    });

    it("lists all agents", () => {
      expect(listAutonomyAgents()).toHaveLength(3);
    });

    it("filters by level", () => {
      const l2 = listAutonomyAgents({ level: 2 });
      expect(l2).toHaveLength(2);
      expect(l2.every((r) => r.currentLevel === 2)).toBe(true);
    });

    it("filters by level 0 (falsy guard)", () => {
      setAutonomyLevel(db, "agent-d", 0);
      const l0 = listAutonomyAgents({ level: 0 });
      expect(l0).toHaveLength(1);
      expect(l0[0].agentId).toBe("agent-d");
    });
  });

  /* ── Task assignment helpers ───────────────────────────────── */

  describe("calculateSkillMatch", () => {
    it("returns 0 for empty required skills", () => {
      expect(calculateSkillMatch([], { js: 5 })).toBe(0);
    });

    it("returns 1.0 when agent exceeds all required levels", () => {
      const required = [
        { name: "js", requiredLevel: 3, weight: 1 },
        { name: "py", requiredLevel: 2, weight: 1 },
      ];
      const agent = { js: 5, py: 4 };
      expect(calculateSkillMatch(required, agent)).toBe(1);
    });

    it("caps per-skill match at 1.0", () => {
      const required = [{ name: "js", requiredLevel: 3, weight: 1 }];
      // agent 100× over — still caps at 1.0
      expect(calculateSkillMatch(required, { js: 300 })).toBe(1);
    });

    it("weighted average across skills", () => {
      const required = [
        { name: "js", requiredLevel: 4, weight: 3 },
        { name: "py", requiredLevel: 4, weight: 1 },
      ];
      const agent = { js: 2, py: 4 }; // js half-match weight 3, py full weight 1
      // score = (0.5*3 + 1*1) / (3+1) = 2.5 / 4 = 0.625
      expect(calculateSkillMatch(required, agent)).toBeCloseTo(0.625, 3);
    });

    it("returns 0 when agent lacks skill", () => {
      const required = [{ name: "rust", requiredLevel: 2, weight: 1 }];
      expect(calculateSkillMatch(required, {})).toBe(0);
    });
  });

  describe("balanceLoad", () => {
    it("returns agent with lowest load ratio", () => {
      const agents = [
        { id: "a", currentLoad: 3, maxCapacity: 5 }, // 0.6
        { id: "b", currentLoad: 1, maxCapacity: 5 }, // 0.2
        { id: "c", currentLoad: 4, maxCapacity: 5 }, // 0.8
      ];
      expect(balanceLoad(agents).id).toBe("b");
    });

    it("returns null for empty agent list", () => {
      expect(balanceLoad([])).toBeNull();
      expect(balanceLoad()).toBeNull();
    });
  });

  describe("calculatePriority", () => {
    it("weighted composite 0.4/0.3/0.2/0.1", () => {
      const p = calculatePriority({
        urgency: 10,
        importance: 10,
        complexity: 10,
        dependencies: 10,
      });
      expect(p).toBeCloseTo(10, 5);
    });

    it("zero task returns 0", () => {
      expect(calculatePriority({})).toBe(0);
    });

    it("urgency dominates (weight 0.4)", () => {
      const a = calculatePriority({ urgency: 10 });
      const b = calculatePriority({ dependencies: 10 });
      expect(a).toBeGreaterThan(b);
    });
  });

  describe("optimizeTaskAssignment", () => {
    it("assigns high-priority task first, to best skill match", () => {
      const tasks = [
        {
          id: "t-low",
          urgency: 1,
          importance: 1,
          complexity: 1,
          dependencies: 0,
          requiredSkills: [{ name: "js", requiredLevel: 2, weight: 1 }],
        },
        {
          id: "t-high",
          urgency: 10,
          importance: 10,
          complexity: 5,
          dependencies: 5,
          requiredSkills: [{ name: "js", requiredLevel: 2, weight: 1 }],
        },
      ];
      const agents = [
        { id: "a1", skills: { js: 5 }, currentLoad: 0, maxCapacity: 1 },
        { id: "a2", skills: { js: 3 }, currentLoad: 0, maxCapacity: 1 },
      ];
      const result = optimizeTaskAssignment(tasks, agents);
      expect(result.totalTasks).toBe(2);
      expect(result.assigned).toBe(2);
      // High priority task assigned first; both agents can match, both saturated
      const highAssignment = result.assignments.find(
        (a) => a.taskId === "t-high",
      );
      expect(highAssignment).toBeDefined();
      // First assignment is the high-priority one
      expect(result.assignments[0].taskId).toBe("t-high");
    });

    it("marks unassigned when no agent has capacity", () => {
      const tasks = [
        { id: "t1", urgency: 5, requiredSkills: [] },
        { id: "t2", urgency: 5, requiredSkills: [] },
      ];
      const agents = [{ id: "a1", skills: {}, currentLoad: 0, maxCapacity: 1 }];
      const result = optimizeTaskAssignment(tasks, agents);
      expect(result.assigned).toBe(1);
      expect(result.unassignedCount).toBe(1);
      expect(result.unassigned[0].reason).toBe("no capacity");
    });

    it("marks unassigned when no agent has skills", () => {
      const tasks = [
        {
          id: "t1",
          urgency: 5,
          requiredSkills: [{ name: "rust", requiredLevel: 3, weight: 1 }],
        },
      ];
      const agents = [
        { id: "a1", skills: { js: 5 }, currentLoad: 0, maxCapacity: 5 },
      ];
      const result = optimizeTaskAssignment(tasks, agents);
      expect(result.unassignedCount).toBe(1);
      expect(result.unassigned[0].reason).toBe("no skill match");
    });

    it("rejects non-array inputs", () => {
      expect(() => optimizeTaskAssignment(null, [])).toThrow(/must be arrays/);
      expect(() => optimizeTaskAssignment([], "nope")).toThrow(
        /must be arrays/,
      );
    });

    it("handles no-skill-requirement tasks", () => {
      const tasks = [{ id: "t1", urgency: 1, requiredSkills: [] }];
      const agents = [{ id: "a1", skills: {}, currentLoad: 0, maxCapacity: 1 }];
      const result = optimizeTaskAssignment(tasks, agents);
      expect(result.assigned).toBe(1);
      expect(result.assignments[0].skillScore).toBe(0);
    });

    it("distributes across multiple capable agents", () => {
      const tasks = [
        { id: "t1", urgency: 5, requiredSkills: [] },
        { id: "t2", urgency: 5, requiredSkills: [] },
        { id: "t3", urgency: 5, requiredSkills: [] },
      ];
      const agents = [
        { id: "a1", skills: {}, currentLoad: 0, maxCapacity: 2 },
        { id: "a2", skills: {}, currentLoad: 0, maxCapacity: 2 },
      ];
      const result = optimizeTaskAssignment(tasks, agents);
      expect(result.assigned).toBe(3);
      // Each agent should get at least one task (lowest-load-ratio picked each round)
      const assignedAgents = new Set(result.assignments.map((a) => a.agentId));
      expect(assignedAgents.size).toBe(2);
    });
  });
});
