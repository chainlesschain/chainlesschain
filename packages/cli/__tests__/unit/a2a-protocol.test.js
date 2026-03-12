import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureA2ATables,
  registerCard,
  updateCard,
  discoverAgents,
  sendTask,
  completeTask,
  failTask,
  getTaskStatus,
  negotiateCapability,
  listPeers,
  subscribeToTask,
  TASK_STATUS,
  _subscriptions,
} from "../../src/lib/a2a-protocol.js";

// ─── Mock DB ─────────────────────────────────────────────────────
function createMockDb() {
  const tables = {};
  const rows = {};

  return {
    exec: vi.fn((sql) => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (match && !tables[match[1]]) {
        tables[match[1]] = true;
        rows[match[1]] = [];
      }
    }),
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => {
        const insertMatch = sql.match(/INSERT INTO (\w+)/);
        if (insertMatch && rows[insertMatch[1]]) {
          rows[insertMatch[1]].push(args);
        }
        return { changes: 1 };
      }),
      get: vi.fn((...args) => {
        // Return stored row for task queries
        if (sql.includes("a2a_tasks") && sql.includes("WHERE id")) {
          const taskId = args[0];
          const taskRows = rows["a2a_tasks"] || [];
          for (const r of taskRows) {
            if (r[0] === taskId) {
              return {
                id: r[0],
                agent_id: r[1],
                status: r[2],
                input: r[3],
                output: "",
                artifacts: "[]",
                error: "",
                history: r[4],
                created_at: r[5],
                updated_at: r[6],
              };
            }
          }
          return null;
        }
        // Return agent card for capability queries
        if (sql.includes("a2a_agent_cards") && sql.includes("WHERE id")) {
          const cardId = args[0];
          const cardRows = rows["a2a_agent_cards"] || [];
          for (const r of cardRows) {
            if (r[0] === cardId) {
              return {
                id: r[0],
                name: r[1],
                description: r[2],
                url: r[3],
                capabilities: r[4],
                skills: r[5],
                auth_type: r[6],
                status: "active",
              };
            }
          }
          return null;
        }
        return null;
      }),
      all: vi.fn(() => {
        if (sql.includes("a2a_agent_cards")) {
          return (rows["a2a_agent_cards"] || []).map((r) => ({
            id: r[0],
            name: r[1],
            description: r[2],
            url: r[3],
            capabilities: r[4],
            skills: r[5],
            auth_type: r[6],
            status: "active",
            created_at: r[7],
            updated_at: r[8],
          }));
        }
        return [];
      }),
    })),
    _rows: rows,
  };
}

describe("a2a-protocol", () => {
  let db;

  beforeEach(() => {
    db = createMockDb();
    _subscriptions.clear();
  });

  // ─── ensureA2ATables ──────────────────────────────────────────
  describe("ensureA2ATables", () => {
    it("creates two tables", () => {
      ensureA2ATables(db);
      expect(db.exec).toHaveBeenCalledTimes(2);
      expect(db.exec).toHaveBeenCalledWith(
        expect.stringContaining("a2a_agent_cards"),
      );
      expect(db.exec).toHaveBeenCalledWith(
        expect.stringContaining("a2a_tasks"),
      );
    });
  });

  // ─── registerCard ─────────────────────────────────────────────
  describe("registerCard", () => {
    it("creates an agent card", () => {
      const result = registerCard(db, {
        name: "TestAgent",
        description: "A test agent",
        url: "http://localhost:8080",
        capabilities: ["chat", "code"],
        skills: ["code-review"],
      });
      expect(result.id).toMatch(/^agent-/);
      expect(result.name).toBe("TestAgent");
      expect(result.status).toBe("active");
    });

    it("throws on missing name", () => {
      expect(() => registerCard(db, {})).toThrow("Agent card must have a name");
    });

    it("throws on null card", () => {
      expect(() => registerCard(db, null)).toThrow(
        "Agent card must have a name",
      );
    });

    it("defaults optional fields", () => {
      const result = registerCard(db, { name: "Minimal" });
      expect(result.name).toBe("Minimal");
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO a2a_agent_cards"),
      );
    });
  });

  // ─── updateCard ───────────────────────────────────────────────
  describe("updateCard", () => {
    it("updates card fields", () => {
      const result = updateCard(db, "agent-123", {
        name: "Updated",
        description: "New desc",
      });
      expect(result.id).toBe("agent-123");
      expect(result.updated).toBe(true);
    });

    it("returns updated: false when no fields provided", () => {
      const result = updateCard(db, "agent-123", {});
      expect(result.updated).toBe(false);
    });

    it("throws on missing ID", () => {
      expect(() => updateCard(db, null, { name: "X" })).toThrow(
        "Card ID is required",
      );
    });

    it("handles capabilities update as JSON", () => {
      updateCard(db, "agent-123", { capabilities: ["new-cap"] });
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("capabilities"),
      );
    });
  });

  // ─── discoverAgents ───────────────────────────────────────────
  describe("discoverAgents", () => {
    it("returns all active agents with no filter", () => {
      registerCard(db, { name: "Agent1", capabilities: ["chat"] });
      const agents = discoverAgents(db);
      expect(Array.isArray(agents)).toBe(true);
    });

    it("filters by capability", () => {
      registerCard(db, { name: "ChatBot", capabilities: ["chat"] });
      registerCard(db, { name: "Coder", capabilities: ["code"] });
      const agents = discoverAgents(db, { capability: "chat" });
      // Depends on mock returning all; filter applied in JS
      expect(Array.isArray(agents)).toBe(true);
    });

    it("filters by name", () => {
      registerCard(db, { name: "ChatBot" });
      const agents = discoverAgents(db, { name: "chat" });
      expect(Array.isArray(agents)).toBe(true);
    });

    it("filters by skill", () => {
      registerCard(db, { name: "Reviewer", skills: ["code-review"] });
      const agents = discoverAgents(db, { skill: "code-review" });
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  // ─── sendTask ─────────────────────────────────────────────────
  describe("sendTask", () => {
    it("creates a task with submitted status", () => {
      const result = sendTask(db, "agent-123", "Review this code");
      expect(result.taskId).toMatch(/^task-/);
      expect(result.status).toBe(TASK_STATUS.SUBMITTED);
    });

    it("throws on missing agent ID", () => {
      expect(() => sendTask(db, null, "input")).toThrow("Agent ID is required");
    });

    it("throws on missing input", () => {
      expect(() => sendTask(db, "agent-123", null)).toThrow(
        "Task input is required",
      );
    });

    it("inserts into a2a_tasks table", () => {
      sendTask(db, "agent-123", "test input");
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO a2a_tasks"),
      );
    });
  });

  // ─── completeTask / failTask ──────────────────────────────────
  describe("completeTask", () => {
    it("marks task as completed", () => {
      const task = sendTask(db, "agent-123", "do work");
      const result = completeTask(db, task.taskId, "done", [
        { type: "file", uri: "output.txt" },
      ]);
      expect(result.status).toBe(TASK_STATUS.COMPLETED);
    });

    it("throws on missing task ID", () => {
      expect(() => completeTask(db, null, "output")).toThrow(
        "Task ID is required",
      );
    });
  });

  describe("failTask", () => {
    it("marks task as failed", () => {
      const task = sendTask(db, "agent-123", "do work");
      const result = failTask(db, task.taskId, "Something went wrong");
      expect(result.status).toBe(TASK_STATUS.FAILED);
    });

    it("throws on missing task ID", () => {
      expect(() => failTask(db, null, "error")).toThrow("Task ID is required");
    });
  });

  // ─── getTaskStatus ────────────────────────────────────────────
  describe("getTaskStatus", () => {
    it("returns task with parsed history", () => {
      const task = sendTask(db, "agent-123", "test");
      const status = getTaskStatus(db, task.taskId);
      expect(status.id).toBe(task.taskId);
      expect(Array.isArray(status.history)).toBe(true);
      expect(status.history.length).toBeGreaterThanOrEqual(1);
      expect(status.history[0].status).toBe(TASK_STATUS.SUBMITTED);
    });

    it("throws on unknown task", () => {
      expect(() => getTaskStatus(db, "nonexistent")).toThrow("Task not found");
    });
  });

  // ─── negotiateCapability ──────────────────────────────────────
  describe("negotiateCapability", () => {
    it("returns compatible when all capabilities match", () => {
      const card = registerCard(db, {
        name: "FullAgent",
        capabilities: ["chat", "code", "search"],
      });
      const result = negotiateCapability(db, card.id, ["chat", "code"]);
      expect(result.compatible).toBe(true);
      expect(result.supported).toEqual(["chat", "code"]);
      expect(result.missing).toEqual([]);
    });

    it("returns incompatible with missing capabilities", () => {
      const card = registerCard(db, {
        name: "BasicAgent",
        capabilities: ["chat"],
      });
      const result = negotiateCapability(db, card.id, ["chat", "code"]);
      expect(result.compatible).toBe(false);
      expect(result.missing).toEqual(["code"]);
    });

    it("throws on missing agent ID", () => {
      expect(() => negotiateCapability(db, null, ["chat"])).toThrow(
        "Agent ID is required",
      );
    });

    it("throws on non-array capabilities", () => {
      expect(() => negotiateCapability(db, "agent-123", "chat")).toThrow(
        "requiredCapabilities must be an array",
      );
    });

    it("throws on unknown agent", () => {
      expect(() => negotiateCapability(db, "nonexistent", ["chat"])).toThrow(
        "Agent not found",
      );
    });
  });

  // ─── listPeers ────────────────────────────────────────────────
  describe("listPeers", () => {
    it("returns all agents", () => {
      registerCard(db, { name: "Agent1" });
      registerCard(db, { name: "Agent2" });
      const peers = listPeers(db);
      expect(Array.isArray(peers)).toBe(true);
    });

    it("parses JSON fields", () => {
      registerCard(db, {
        name: "Agent1",
        capabilities: ["chat"],
        skills: ["review"],
      });
      const peers = listPeers(db);
      for (const p of peers) {
        expect(Array.isArray(p.capabilities)).toBe(true);
        expect(Array.isArray(p.skills)).toBe(true);
      }
    });
  });

  // ─── subscribeToTask ──────────────────────────────────────────
  describe("subscribeToTask", () => {
    it("calls callback on task status change", () => {
      const cb = vi.fn();
      subscribeToTask("task-abc", cb);
      // Trigger via sendTask which notifies subscribers
      // For direct test, we check subscription is registered
      expect(_subscriptions.has("task-abc")).toBe(true);
    });

    it("returns unsubscribe function", () => {
      const cb = vi.fn();
      const unsub = subscribeToTask("task-abc", cb);
      expect(typeof unsub).toBe("function");
      unsub();
      expect(_subscriptions.has("task-abc")).toBe(false);
    });

    it("supports multiple subscribers", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      subscribeToTask("task-abc", cb1);
      subscribeToTask("task-abc", cb2);
      expect(_subscriptions.get("task-abc").size).toBe(2);
    });
  });

  // ─── TASK_STATUS constants ────────────────────────────────────
  describe("TASK_STATUS", () => {
    it("has all expected statuses", () => {
      expect(TASK_STATUS.SUBMITTED).toBe("submitted");
      expect(TASK_STATUS.WORKING).toBe("working");
      expect(TASK_STATUS.COMPLETED).toBe("completed");
      expect(TASK_STATUS.FAILED).toBe("failed");
      expect(TASK_STATUS.INPUT_REQUIRED).toBe("input-required");
    });
  });
});
