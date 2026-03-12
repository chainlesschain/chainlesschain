import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  AGENT_TYPE_KEYWORDS,
  decomposeTask,
  selectAgent,
  assignSubtask,
  aggregateResults,
  getAgentTypes,
  estimateComplexity,
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
});
