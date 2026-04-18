import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  AGENT_TYPE_KEYWORDS,
  ROLE_TOOL_WHITELIST,
  decomposeTask,
  selectAgent,
  assignSubtask,
  aggregateResults,
  getAgentTypes,
  estimateComplexity,
  executeDecomposedTask,
} from "../../src/lib/agent-coordinator.js";

describe("agent-coordinator", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_assignments (
        id TEXT PRIMARY KEY,
        subtask_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        assigned_at TEXT
      )
    `);
  });

  // ─── AGENT_TYPE_KEYWORDS ─────────────────────────────

  describe("AGENT_TYPE_KEYWORDS", () => {
    it("has 5 agent types", () => {
      expect(Object.keys(AGENT_TYPE_KEYWORDS)).toHaveLength(5);
    });

    it("contains code-generation keywords", () => {
      expect(AGENT_TYPE_KEYWORDS["code-generation"]).toContain("code");
      expect(AGENT_TYPE_KEYWORDS["code-generation"]).toContain("implement");
    });

    it("contains code-review keywords", () => {
      expect(AGENT_TYPE_KEYWORDS["code-review"]).toContain("review");
      expect(AGENT_TYPE_KEYWORDS["code-review"]).toContain("audit");
    });

    it("contains data-analysis keywords", () => {
      expect(AGENT_TYPE_KEYWORDS["data-analysis"]).toContain("data");
      expect(AGENT_TYPE_KEYWORDS["data-analysis"]).toContain("chart");
    });

    it("contains document keywords", () => {
      expect(AGENT_TYPE_KEYWORDS["document"]).toContain("document");
      expect(AGENT_TYPE_KEYWORDS["document"]).toContain("readme");
    });

    it("contains testing keywords", () => {
      expect(AGENT_TYPE_KEYWORDS["testing"]).toContain("test");
      expect(AGENT_TYPE_KEYWORDS["testing"]).toContain("vitest");
    });
  });

  // ─── decomposeTask ───────────────────────────────────

  describe("decomposeTask", () => {
    it("returns empty subtasks for null input", () => {
      const result = decomposeTask(null);
      expect(result.taskId).toBeTruthy();
      expect(result.subtasks).toEqual([]);
    });

    it("returns empty subtasks for empty string", () => {
      const result = decomposeTask("");
      expect(result.subtasks).toEqual([]);
    });

    it("decomposes task with code-generation keywords", () => {
      const result = decomposeTask("Generate a new function to build modules");
      expect(result.subtasks.length).toBeGreaterThanOrEqual(1);
      const types = result.subtasks.map((s) => s.agentType);
      expect(types).toContain("code-generation");
    });

    it("decomposes task with multiple agent types", () => {
      const result = decomposeTask(
        "Review code and write documentation with test coverage",
      );
      const types = result.subtasks.map((s) => s.agentType);
      expect(types).toContain("code-review");
      expect(types).toContain("document");
      expect(types).toContain("testing");
    });

    it("creates generic subtask when no keywords match", () => {
      const result = decomposeTask("something completely unrelated xyz");
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0].agentType).toBe("general");
    });

    it("sets all subtask statuses to pending", () => {
      const result = decomposeTask("Generate code and review it");
      for (const subtask of result.subtasks) {
        expect(subtask.status).toBe("pending");
      }
    });

    it("assigns unique ids to each subtask", () => {
      const result = decomposeTask(
        "Generate code, write tests, create documentation",
      );
      const ids = result.subtasks.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── selectAgent ─────────────────────────────────────

  describe("selectAgent", () => {
    const agents = [
      { id: "agent-1", capabilities: ["code-generation", "code-review"] },
      { id: "agent-2", capabilities: ["testing", "code-review"] },
      { id: "agent-3", capabilities: ["document"] },
    ];

    it("returns null for empty agents list", () => {
      expect(selectAgent({ agentType: "testing" }, [])).toBeNull();
    });

    it("returns null for null subtask", () => {
      expect(selectAgent(null, agents)).toBeNull();
    });

    it("matches agent by direct capability", () => {
      const result = selectAgent({ agentType: "document" }, agents);
      expect(result.id).toBe("agent-3");
    });

    it("matches first agent with matching capability", () => {
      const result = selectAgent({ agentType: "code-review" }, agents);
      expect(result.id).toBe("agent-1");
    });

    it("returns null when no capability matches", () => {
      const result = selectAgent({ agentType: "unknown-type" }, [
        { id: "a1", capabilities: ["other"] },
      ]);
      expect(result).toBeNull();
    });
  });

  // ─── assignSubtask ───────────────────────────────────

  describe("assignSubtask", () => {
    it("returns assignment object", () => {
      const result = assignSubtask(db, "sub-1", "agent-1");
      expect(result).toEqual({
        subtaskId: "sub-1",
        agentId: "agent-1",
        status: "assigned",
      });
    });

    it("records assignment in database", () => {
      assignSubtask(db, "sub-2", "agent-2");
      const rows = db.data.get("agent_assignments") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].subtask_id).toBe("sub-2");
      expect(rows[0].agent_id).toBe("agent-2");
    });

    it("works without database", () => {
      const result = assignSubtask(null, "sub-3", "agent-3");
      expect(result.status).toBe("assigned");
    });
  });

  // ─── aggregateResults ────────────────────────────────

  describe("aggregateResults", () => {
    it("returns empty status for no subtasks", () => {
      const result = aggregateResults([]);
      expect(result.status).toBe("empty");
      expect(result.results).toEqual([]);
    });

    it("returns completed when all done", () => {
      const result = aggregateResults([
        { id: "1", agentType: "testing", status: "completed", result: "ok" },
        { id: "2", agentType: "document", status: "completed", result: "ok" },
      ]);
      expect(result.status).toBe("completed");
      expect(result.results).toHaveLength(2);
    });

    it("returns partial when some failed", () => {
      const result = aggregateResults([
        { id: "1", agentType: "testing", status: "completed", result: "ok" },
        { id: "2", agentType: "document", status: "failed" },
      ]);
      expect(result.status).toBe("partial");
    });

    it("returns failed when all failed", () => {
      const result = aggregateResults([
        { id: "1", agentType: "testing", status: "failed" },
        { id: "2", agentType: "document", status: "failed" },
      ]);
      expect(result.status).toBe("failed");
    });

    it("returns in-progress when none completed and none failed", () => {
      const result = aggregateResults([
        { id: "1", agentType: "testing", status: "pending" },
      ]);
      expect(result.status).toBe("in-progress");
    });

    it("builds summary string", () => {
      const result = aggregateResults([
        { id: "1", agentType: "testing", status: "completed" },
        { id: "2", agentType: "document", status: "failed" },
      ]);
      expect(result.summary).toContain("1/2");
      expect(result.summary).toContain("1 failed");
    });
  });

  // ─── getAgentTypes ───────────────────────────────────

  describe("getAgentTypes", () => {
    it("returns all 5 agent types", () => {
      const types = getAgentTypes();
      expect(types).toHaveLength(5);
      expect(types).toContain("code-generation");
      expect(types).toContain("code-review");
      expect(types).toContain("data-analysis");
      expect(types).toContain("document");
      expect(types).toContain("testing");
    });
  });

  // ─── estimateComplexity ─────────────────────────────────

  describe("estimateComplexity", () => {
    it("returns low for null input", () => {
      const result = estimateComplexity(null);
      expect(result.complexity).toBe("low");
      expect(result.estimatedSubtasks).toBe(0);
    });

    it("returns low for simple task", () => {
      const result = estimateComplexity("hello world");
      expect(result.complexity).toBe("low");
    });

    it("returns medium for moderate task", () => {
      const result = estimateComplexity("review code and check quality");
      expect(["medium", "high"]).toContain(result.complexity);
      expect(result.estimatedSubtasks).toBeGreaterThanOrEqual(1);
    });

    it("returns high for complex multi-type task", () => {
      const result = estimateComplexity(
        "Generate code, write tests with coverage and mock, review audit quality, analyze data statistics chart, create documentation readme guide tutorial article",
      );
      expect(result.complexity).toBe("high");
      expect(result.estimatedSubtasks).toBeGreaterThanOrEqual(3);
    });

    it("considers description length", () => {
      const short = estimateComplexity("test");
      const long = estimateComplexity(
        "test ".repeat(50) + " coverage mock spec integration e2e",
      );
      expect(long.estimatedSubtasks).toBeGreaterThanOrEqual(
        short.estimatedSubtasks,
      );
    });
  });

  // ─── ROLE_TOOL_WHITELIST ──────────────────────────────

  describe("ROLE_TOOL_WHITELIST", () => {
    it("code-review has read-only tools", () => {
      expect(ROLE_TOOL_WHITELIST["code-review"]).toEqual([
        "read_file",
        "search_files",
        "list_dir",
      ]);
      expect(ROLE_TOOL_WHITELIST["code-review"]).not.toContain("write_file");
      expect(ROLE_TOOL_WHITELIST["code-review"]).not.toContain("run_shell");
    });

    it("code-generation has write tools", () => {
      expect(ROLE_TOOL_WHITELIST["code-generation"]).toContain("write_file");
      expect(ROLE_TOOL_WHITELIST["code-generation"]).toContain("edit_file");
      expect(ROLE_TOOL_WHITELIST["code-generation"]).toContain("run_shell");
    });

    it("testing has run_code", () => {
      expect(ROLE_TOOL_WHITELIST["testing"]).toContain("run_code");
      expect(ROLE_TOOL_WHITELIST["testing"]).toContain("run_shell");
    });

    it("document role cannot run code or shell", () => {
      expect(ROLE_TOOL_WHITELIST["document"]).not.toContain("run_code");
      expect(ROLE_TOOL_WHITELIST["document"]).not.toContain("run_shell");
    });

    it("general role has null (all tools)", () => {
      expect(ROLE_TOOL_WHITELIST["general"]).toBeNull();
    });
  });

  // ─── executeDecomposedTask ────────────────────────────

  describe("executeDecomposedTask", () => {
    it("returns empty status for no subtasks", async () => {
      const result = await executeDecomposedTask({
        taskId: "t-1",
        subtasks: [],
      });
      expect(result.status).toBe("empty");
      expect(result.results).toEqual([]);
    });

    it("returns empty status for null subtasks", async () => {
      const result = await executeDecomposedTask({
        taskId: "t-2",
        subtasks: null,
      });
      expect(result.status).toBe("empty");
    });

    it("accepts maxConcurrency option", async () => {
      // With empty subtasks, maxConcurrency doesn't matter but option should be accepted
      const result = await executeDecomposedTask(
        { taskId: "t-3", subtasks: [] },
        { maxConcurrency: 5 },
      );
      expect(result.status).toBe("empty");
    });
  });
});

// ===== V2 Surface Tests (cli 0.131.0) =====
import {
  describe as describeV2,
  it as itV2,
  expect as expectV2,
  beforeEach as beforeEachV2,
} from "vitest";
import {
  COORD_AGENT_MATURITY_V2,
  COORD_ASSIGNMENT_LIFECYCLE_V2,
  registerCoordAgentV2,
  activateCoordAgentV2,
  idleCoordAgentV2,
  retireCoordAgentV2,
  touchCoordAgentV2,
  getCoordAgentV2,
  listCoordAgentsV2,
  createAssignmentV2,
  dispatchAssignmentV2,
  completeAssignmentV2,
  failAssignmentV2,
  cancelAssignmentV2,
  getAssignmentV2,
  listAssignmentsV2,
  autoIdleCoordAgentsV2,
  autoFailStuckAssignmentsV2,
  getAgentCoordinatorStatsV2,
  setMaxActiveAgentsPerOwnerCoordV2,
  setMaxPendingAssignmentsPerAgentV2,
  setAgentIdleMsCoordV2,
  setAssignmentStuckMsV2,
  getMaxActiveAgentsPerOwnerCoordV2,
  getMaxPendingAssignmentsPerAgentV2,
  getAgentIdleMsCoordV2,
  getAssignmentStuckMsV2,
  _resetStateAgentCoordinatorV2,
} from "../../src/lib/agent-coordinator.js";

describeV2("Agent Coordinator V2", () => {
  beforeEachV2(() => _resetStateAgentCoordinatorV2());

  describeV2("enums", () => {
    itV2("agent maturity has 4 states", () => {
      expectV2(Object.keys(COORD_AGENT_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "IDLE",
        "PENDING",
        "RETIRED",
      ]);
    });
    itV2("assignment lifecycle has 5 states", () => {
      expectV2(Object.keys(COORD_ASSIGNMENT_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
        "DISPATCHED",
        "FAILED",
        "QUEUED",
      ]);
    });
    itV2("enums are frozen", () => {
      expectV2(Object.isFrozen(COORD_AGENT_MATURITY_V2)).toBe(true);
      expectV2(Object.isFrozen(COORD_ASSIGNMENT_LIFECYCLE_V2)).toBe(true);
    });
  });

  describeV2("agent lifecycle", () => {
    itV2("registers in pending", () => {
      const a = registerCoordAgentV2({
        id: "a1",
        owner: "alice",
        role: "planner",
      });
      expectV2(a.status).toBe("pending");
    });
    itV2("rejects duplicate id", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      expectV2(() =>
        registerCoordAgentV2({ id: "a1", owner: "bob", role: "coder" }),
      ).toThrow();
    });
    itV2("rejects missing required fields", () => {
      expectV2(() => registerCoordAgentV2({})).toThrow();
      expectV2(() => registerCoordAgentV2({ id: "a1" })).toThrow();
      expectV2(() => registerCoordAgentV2({ id: "a1", owner: "x" })).toThrow();
    });
    itV2("activates pending → active", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      const a = activateCoordAgentV2("a1");
      expectV2(a.status).toBe("active");
      expectV2(a.activatedAt).toBeGreaterThan(0);
    });
    itV2("idles active → idle", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      activateCoordAgentV2("a1");
      expectV2(idleCoordAgentV2("a1").status).toBe("idle");
    });
    itV2("recovers idle → active (preserves activatedAt)", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      const first = activateCoordAgentV2("a1").activatedAt;
      idleCoordAgentV2("a1");
      expectV2(activateCoordAgentV2("a1").activatedAt).toBe(first);
    });
    itV2("retires (terminal)", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      retireCoordAgentV2("a1");
      expectV2(() => activateCoordAgentV2("a1")).toThrow();
    });
    itV2("rejects invalid transition", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      expectV2(() => idleCoordAgentV2("a1")).toThrow();
    });
    itV2("touches lastSeenAt", async () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      const before = getCoordAgentV2("a1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      expectV2(touchCoordAgentV2("a1").lastSeenAt).toBeGreaterThan(before);
    });
  });

  describeV2("active-agent cap", () => {
    itV2("enforces per-owner cap on pending → active", () => {
      setMaxActiveAgentsPerOwnerCoordV2(2);
      ["a", "b", "c"].forEach((id) =>
        registerCoordAgentV2({ id, owner: "alice", role: "planner" }),
      );
      activateCoordAgentV2("a");
      activateCoordAgentV2("b");
      expectV2(() => activateCoordAgentV2("c")).toThrow(/cap reached/);
    });
    itV2("does not apply to other owners", () => {
      setMaxActiveAgentsPerOwnerCoordV2(1);
      registerCoordAgentV2({ id: "a", owner: "alice", role: "planner" });
      registerCoordAgentV2({ id: "b", owner: "bob", role: "coder" });
      activateCoordAgentV2("a");
      expectV2(activateCoordAgentV2("b").status).toBe("active");
    });
    itV2("recovery exempt", () => {
      setMaxActiveAgentsPerOwnerCoordV2(1);
      registerCoordAgentV2({ id: "a", owner: "alice", role: "planner" });
      activateCoordAgentV2("a");
      idleCoordAgentV2("a");
      registerCoordAgentV2({ id: "b", owner: "alice", role: "planner" });
      activateCoordAgentV2("b");
      expectV2(activateCoordAgentV2("a").status).toBe("active");
    });
  });

  describeV2("assignment lifecycle", () => {
    beforeEachV2(() => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      activateCoordAgentV2("a1");
    });
    itV2("creates queued", () => {
      const x = createAssignmentV2({
        id: "X1",
        agentId: "a1",
        subtask: "build",
      });
      expectV2(x.status).toBe("queued");
      expectV2(x.subtask).toBe("build");
    });
    itV2("rejects on retired agent", () => {
      retireCoordAgentV2("a1");
      expectV2(() => createAssignmentV2({ id: "X1", agentId: "a1" })).toThrow(
        /retired/,
      );
    });
    itV2("dispatches queued → dispatched", () => {
      createAssignmentV2({ id: "X1", agentId: "a1" });
      const x = dispatchAssignmentV2("X1");
      expectV2(x.status).toBe("dispatched");
      expectV2(x.startedAt).toBeGreaterThan(0);
    });
    itV2("completes (terminal)", () => {
      createAssignmentV2({ id: "X1", agentId: "a1" });
      dispatchAssignmentV2("X1");
      const x = completeAssignmentV2("X1");
      expectV2(x.status).toBe("completed");
      expectV2(() => failAssignmentV2("X1", "x")).toThrow();
    });
    itV2("fails (terminal) with error", () => {
      createAssignmentV2({ id: "X1", agentId: "a1" });
      dispatchAssignmentV2("X1");
      expectV2(failAssignmentV2("X1", "broken").metadata.error).toBe("broken");
    });
    itV2("cancels from queued", () => {
      createAssignmentV2({ id: "X1", agentId: "a1" });
      expectV2(cancelAssignmentV2("X1").status).toBe("cancelled");
    });
  });

  describeV2("pending-assignment cap", () => {
    beforeEachV2(() => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      activateCoordAgentV2("a1");
    });
    itV2("enforces at create time", () => {
      setMaxPendingAssignmentsPerAgentV2(2);
      createAssignmentV2({ id: "X1", agentId: "a1" });
      createAssignmentV2({ id: "X2", agentId: "a1" });
      expectV2(() => createAssignmentV2({ id: "X3", agentId: "a1" })).toThrow(
        /cap reached/,
      );
    });
    itV2("frees up after terminal", () => {
      setMaxPendingAssignmentsPerAgentV2(2);
      createAssignmentV2({ id: "X1", agentId: "a1" });
      createAssignmentV2({ id: "X2", agentId: "a1" });
      dispatchAssignmentV2("X1");
      completeAssignmentV2("X1");
      expectV2(createAssignmentV2({ id: "X3", agentId: "a1" }).status).toBe(
        "queued",
      );
    });
  });

  describeV2("auto-flip", () => {
    itV2("auto-idle agents", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      activateCoordAgentV2("a1");
      const flipped = autoIdleCoordAgentsV2({
        now: Date.now() + 2 * 60 * 60 * 1000,
      });
      expectV2(flipped.length).toBe(1);
      expectV2(flipped[0].status).toBe("idle");
    });
    itV2("auto-fail stuck assignments", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      activateCoordAgentV2("a1");
      createAssignmentV2({ id: "X1", agentId: "a1" });
      dispatchAssignmentV2("X1");
      const flipped = autoFailStuckAssignmentsV2({
        now: Date.now() + 10 * 60 * 1000,
      });
      expectV2(flipped.length).toBe(1);
      expectV2(flipped[0].metadata.error).toBe("stuck-timeout");
    });
  });

  describeV2("config setters", () => {
    itV2("rejects bad inputs", () => {
      expectV2(() => setMaxActiveAgentsPerOwnerCoordV2(0)).toThrow();
      expectV2(() => setMaxPendingAssignmentsPerAgentV2(-1)).toThrow();
      expectV2(() => setAgentIdleMsCoordV2(NaN)).toThrow();
      expectV2(() => setAssignmentStuckMsV2("x")).toThrow();
    });
    itV2("floors floats", () => {
      setMaxActiveAgentsPerOwnerCoordV2(7.6);
      expectV2(getMaxActiveAgentsPerOwnerCoordV2()).toBe(7);
    });
    itV2("setters update config", () => {
      setMaxPendingAssignmentsPerAgentV2(50);
      setAgentIdleMsCoordV2(11111);
      setAssignmentStuckMsV2(22222);
      expectV2(getMaxPendingAssignmentsPerAgentV2()).toBe(50);
      expectV2(getAgentIdleMsCoordV2()).toBe(11111);
      expectV2(getAssignmentStuckMsV2()).toBe(22222);
    });
  });

  describeV2("listing & defensive copy", () => {
    itV2("filters work", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      registerCoordAgentV2({ id: "a2", owner: "bob", role: "coder" });
      activateCoordAgentV2("a1");
      expectV2(listCoordAgentsV2({ owner: "alice" }).length).toBe(1);
      expectV2(listCoordAgentsV2({ status: "active" }).length).toBe(1);
      expectV2(listCoordAgentsV2({ role: "coder" }).length).toBe(1);
    });
    itV2("deep copy on read", () => {
      registerCoordAgentV2({
        id: "a1",
        owner: "alice",
        role: "planner",
        metadata: { tag: "x" },
      });
      const a = getCoordAgentV2("a1");
      a.metadata.tag = "MUT";
      expectV2(getCoordAgentV2("a1").metadata.tag).toBe("x");
    });
  });

  describeV2("stats", () => {
    itV2("zero-initializes all enum keys", () => {
      const s = getAgentCoordinatorStatsV2();
      expectV2(s.agentsByStatus.pending).toBe(0);
      expectV2(s.agentsByStatus.idle).toBe(0);
      expectV2(s.assignmentsByStatus.dispatched).toBe(0);
    });
    itV2("counts match state", () => {
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      activateCoordAgentV2("a1");
      createAssignmentV2({ id: "X1", agentId: "a1" });
      const s = getAgentCoordinatorStatsV2();
      expectV2(s.totalAgentsV2).toBe(1);
      expectV2(s.agentsByStatus.active).toBe(1);
      expectV2(s.assignmentsByStatus.queued).toBe(1);
    });
  });

  describeV2("reset", () => {
    itV2("clears + restores defaults", () => {
      setMaxActiveAgentsPerOwnerCoordV2(99);
      registerCoordAgentV2({ id: "a1", owner: "alice", role: "planner" });
      _resetStateAgentCoordinatorV2();
      expectV2(getMaxActiveAgentsPerOwnerCoordV2()).toBe(8);
      expectV2(listCoordAgentsV2({}).length).toBe(0);
    });
  });
});
