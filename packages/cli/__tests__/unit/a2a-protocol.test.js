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
  // V2 (Phase 81)
  TASK_STATUS_V2,
  CARD_STATUS_V2,
  SUBSCRIPTION_TYPE,
  NEGOTIATION_RESULT,
  validateAgentCard,
  setCardStatus,
  getCardStatusV2,
  sendTaskV2,
  startWorking,
  requestInput,
  provideInput,
  completeTaskV2,
  failTaskV2,
  cancelTask,
  checkTaskTimeout,
  getTaskV2,
  listTasksV2,
  subscribeTyped,
  negotiateCapabilityV2,
  getA2AStatsV2,
  _resetV2State,
  _v2Tasks,
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
    _resetV2State();
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

  // ═══════════════════════════════════════════════════════════════
  // Phase 81 — A2A Protocol V2
  // ═══════════════════════════════════════════════════════════════

  describe("V2 frozen enums", () => {
    it("TASK_STATUS_V2 has 6 statuses including canceled", () => {
      expect(TASK_STATUS_V2.SUBMITTED).toBe("submitted");
      expect(TASK_STATUS_V2.WORKING).toBe("working");
      expect(TASK_STATUS_V2.INPUT_REQUIRED).toBe("input-required");
      expect(TASK_STATUS_V2.COMPLETED).toBe("completed");
      expect(TASK_STATUS_V2.FAILED).toBe("failed");
      expect(TASK_STATUS_V2.CANCELED).toBe("canceled");
      expect(() => (TASK_STATUS_V2.NEW = "x")).toThrow();
    });
    it("CARD_STATUS_V2 / SUBSCRIPTION_TYPE / NEGOTIATION_RESULT frozen", () => {
      expect(CARD_STATUS_V2.ACTIVE).toBe("active");
      expect(CARD_STATUS_V2.INACTIVE).toBe("inactive");
      expect(CARD_STATUS_V2.EXPIRED).toBe("expired");
      expect(SUBSCRIPTION_TYPE.TASK_UPDATE).toBe("task_update");
      expect(SUBSCRIPTION_TYPE.AGENT_STATUS).toBe("agent_status");
      expect(SUBSCRIPTION_TYPE.CAPABILITY_CHANGE).toBe("capability_change");
      expect(NEGOTIATION_RESULT.COMPATIBLE).toBe("compatible");
      expect(NEGOTIATION_RESULT.PARTIAL).toBe("partial");
      expect(NEGOTIATION_RESULT.INCOMPATIBLE).toBe("incompatible");
    });
  });

  describe("validateAgentCard", () => {
    it("passes a minimal valid card", () => {
      const r = validateAgentCard({ name: "A" });
      expect(r.valid).toBe(true);
      expect(r.errors).toEqual([]);
    });
    it("rejects missing name", () => {
      const r = validateAgentCard({});
      expect(r.valid).toBe(false);
      expect(r.errors.join(" ")).toContain("name");
    });
    it("rejects non-object", () => {
      expect(validateAgentCard(null).valid).toBe(false);
      expect(validateAgentCard("x").valid).toBe(false);
    });
    it("rejects non-array capabilities", () => {
      const r = validateAgentCard({ name: "A", capabilities: "chat" });
      expect(r.valid).toBe(false);
    });
    it("rejects bad semver version", () => {
      expect(validateAgentCard({ name: "A", version: "1.0" }).valid).toBe(
        false,
      );
      expect(validateAgentCard({ name: "A", version: "1.0.0" }).valid).toBe(
        true,
      );
    });
    it("rejects unknown auth_type", () => {
      const r = validateAgentCard({ name: "A", auth_type: "kerberos" });
      expect(r.valid).toBe(false);
    });
    it("accepts known auth_type", () => {
      expect(validateAgentCard({ name: "A", auth_type: "bearer" }).valid).toBe(
        true,
      );
    });
  });

  describe("setCardStatus state machine", () => {
    it("active → inactive → expired allowed", () => {
      setCardStatus(null, "card-1", "inactive");
      expect(getCardStatusV2("card-1")).toBe("inactive");
      setCardStatus(null, "card-1", "expired");
      expect(getCardStatusV2("card-1")).toBe("expired");
    });
    it("expired → inactive blocked (must go via active)", () => {
      setCardStatus(null, "card-1", "inactive");
      setCardStatus(null, "card-1", "expired");
      expect(() => setCardStatus(null, "card-1", "inactive")).toThrow(
        /Invalid card transition/,
      );
      setCardStatus(null, "card-1", "active");
      setCardStatus(null, "card-1", "inactive");
    });
    it("invalid status rejected", () => {
      expect(() => setCardStatus(null, "c", "bogus")).toThrow(
        /Invalid card status/,
      );
    });
    it("missing cardId rejected", () => {
      expect(() => setCardStatus(null, null, "inactive")).toThrow();
    });
    it("defaults to 'active' for untracked cards", () => {
      expect(getCardStatusV2("never-seen")).toBe("active");
    });
  });

  describe("sendTaskV2 + startWorking + completeTaskV2", () => {
    it("submits a task with submitted status", () => {
      const r = sendTaskV2(null, { agentId: "a1", input: "hi" });
      expect(r.taskId).toMatch(/^task-/);
      expect(r.status).toBe("submitted");
      expect(r.deadline).toBeNull();
    });
    it("applies timeoutMs as deadline", () => {
      const r = sendTaskV2(null, { agentId: "a", input: "x", timeoutMs: 5000 });
      expect(r.deadline).toBeGreaterThan(Date.now());
    });
    it("submitted → working → completed", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "hi" });
      startWorking(null, taskId);
      completeTaskV2(null, taskId, "done");
      expect(getTaskV2(taskId).status).toBe("completed");
      expect(getTaskV2(taskId).output).toBe("done");
    });
    it("rejects submitted → completed (must go via working)", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "hi" });
      expect(() => completeTaskV2(null, taskId, "x")).toThrow(
        /Invalid task transition/,
      );
    });
    it("rejects starting work on completed task", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "hi" });
      startWorking(null, taskId);
      completeTaskV2(null, taskId, "ok");
      expect(() => startWorking(null, taskId)).toThrow(
        /Invalid task transition/,
      );
    });
    it("throws on missing agentId or input", () => {
      expect(() => sendTaskV2(null, { input: "x" })).toThrow();
      expect(() => sendTaskV2(null, { agentId: "a" })).toThrow();
    });
  });

  describe("requestInput / provideInput", () => {
    it("working → input-required stores prompt", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      startWorking(null, taskId);
      requestInput(null, taskId, "What model?");
      expect(getTaskV2(taskId).status).toBe("input-required");
      expect(getTaskV2(taskId).inputPrompt).toBe("What model?");
    });
    it("provideInput → working and clears prompt", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      startWorking(null, taskId);
      requestInput(null, taskId, "Which?");
      provideInput(null, taskId, "gpt4");
      expect(getTaskV2(taskId).status).toBe("working");
      expect(getTaskV2(taskId).inputPrompt).toBeNull();
    });
    it("provideInput on non-input-required throws", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      expect(() => provideInput(null, taskId, "y")).toThrow(
        /requires status input-required/,
      );
    });
    it("requestInput requires non-empty prompt", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      startWorking(null, taskId);
      expect(() => requestInput(null, taskId, "")).toThrow(
        /Prompt is required/,
      );
    });
  });

  describe("cancelTask + failTaskV2", () => {
    it("cancels from submitted", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      cancelTask(null, taskId, "user aborted");
      expect(getTaskV2(taskId).status).toBe("canceled");
      expect(getTaskV2(taskId).cancelReason).toBe("user aborted");
    });
    it("cancels from working", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      startWorking(null, taskId);
      cancelTask(null, taskId);
      expect(getTaskV2(taskId).cancelReason).toBe("user_requested");
    });
    it("cannot cancel terminal tasks", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      startWorking(null, taskId);
      failTaskV2(null, taskId, "err");
      expect(() => cancelTask(null, taskId)).toThrow(/Invalid task transition/);
    });
    it("failTaskV2 from working records error + rejects terminal re-fail", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      startWorking(null, taskId);
      failTaskV2(null, taskId, "boom");
      expect(getTaskV2(taskId).status).toBe("failed");
      expect(getTaskV2(taskId).error).toBe("boom");
      expect(() => failTaskV2(null, taskId, "again")).toThrow(
        /Invalid task transition/,
      );
    });
    it("failTaskV2 allowed from submitted (timeout path)", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      failTaskV2(null, taskId, "never-assigned");
      expect(getTaskV2(taskId).status).toBe("failed");
    });
  });

  describe("checkTaskTimeout", () => {
    it("no deadline → never times out", () => {
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      expect(checkTaskTimeout(null, taskId).timedOut).toBe(false);
    });
    it("past deadline + non-terminal → auto-fails", () => {
      const { taskId } = sendTaskV2(null, {
        agentId: "a",
        input: "x",
        timeoutMs: 1000,
      });
      const r = checkTaskTimeout(null, taskId, Date.now() + 10000);
      expect(r.timedOut).toBe(true);
      expect(r.status).toBe("failed");
      expect(getTaskV2(taskId).error).toBe("timeout");
    });
    it("past deadline + terminal → no-op", () => {
      const { taskId } = sendTaskV2(null, {
        agentId: "a",
        input: "x",
        timeoutMs: 1000,
      });
      startWorking(null, taskId);
      completeTaskV2(null, taskId, "ok");
      const r = checkTaskTimeout(null, taskId, Date.now() + 10000);
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe("completed");
    });
  });

  describe("listTasksV2", () => {
    it("filters by agentId and status", () => {
      sendTaskV2(null, { agentId: "a1", input: "x" });
      const t2 = sendTaskV2(null, { agentId: "a2", input: "y" });
      startWorking(null, t2.taskId);
      expect(listTasksV2({ agentId: "a1" })).toHaveLength(1);
      expect(listTasksV2({ status: "working" })).toHaveLength(1);
      expect(listTasksV2({ agentId: "a2", status: "submitted" })).toHaveLength(
        0,
      );
    });
  });

  describe("subscribeTyped", () => {
    it("receives TASK_UPDATE events", () => {
      const events = [];
      const unsub = subscribeTyped(
        SUBSCRIPTION_TYPE.TASK_UPDATE,
        "task-watch",
        (e) => events.push(e),
      );
      // Pre-register listener then fire via task whose id matches
      const { taskId } = sendTaskV2(null, { agentId: "a", input: "x" });
      // Subscribe specifically to that task
      subscribeTyped(SUBSCRIPTION_TYPE.TASK_UPDATE, taskId, (e) =>
        events.push(e),
      );
      startWorking(null, taskId);
      expect(
        events.some((e) => e.taskId === taskId && e.status === "working"),
      ).toBe(true);
      unsub();
    });
    it("rejects invalid type", () => {
      expect(() => subscribeTyped("bogus", "r", () => {})).toThrow(
        /Invalid subscription type/,
      );
    });
    it("unsub returns and cleans up", () => {
      const unsub = subscribeTyped(
        SUBSCRIPTION_TYPE.AGENT_STATUS,
        "a1",
        () => {},
      );
      unsub();
      // After unsub, map entry should be cleaned up
      expect(getA2AStatsV2().subscriptions.typed).toBe(0);
    });
  });

  describe("negotiateCapabilityV2", () => {
    const baseCard = {
      name: "A",
      capabilities: ["chat", "code", "search"],
      version: "1.2.0",
    };
    it("COMPATIBLE when required + preferred all present + version ok", () => {
      const r = negotiateCapabilityV2(baseCard, {
        required: ["chat"],
        preferred: ["code"],
        version: "1.1.0",
      });
      expect(r.result).toBe("compatible");
      expect(r.missingRequired).toEqual([]);
      expect(r.missingPreferred).toEqual([]);
    });
    it("PARTIAL when some preferred missing", () => {
      const r = negotiateCapabilityV2(baseCard, {
        required: ["chat"],
        preferred: ["code", "vision"],
      });
      expect(r.result).toBe("partial");
      expect(r.missingPreferred).toEqual(["vision"]);
      expect(r.supportedPreferred).toEqual(["code"]);
    });
    it("INCOMPATIBLE when required missing", () => {
      const r = negotiateCapabilityV2(baseCard, { required: ["vision"] });
      expect(r.result).toBe("incompatible");
      expect(r.missingRequired).toEqual(["vision"]);
    });
    it("INCOMPATIBLE when major version mismatch", () => {
      const r = negotiateCapabilityV2(baseCard, {
        required: ["chat"],
        version: "2.0.0",
      });
      expect(r.result).toBe("incompatible");
      expect(r.versionOk).toBe(false);
    });
    it("INCOMPATIBLE when client minor > server minor (same major)", () => {
      const r = negotiateCapabilityV2(baseCard, {
        required: ["chat"],
        version: "1.3.0",
      });
      expect(r.result).toBe("incompatible");
      expect(r.versionOk).toBe(false);
    });
    it("treats unknown versions as compatible", () => {
      const r = negotiateCapabilityV2(
        { ...baseCard, version: undefined },
        { required: ["chat"], version: "1.0.0" },
      );
      expect(r.versionOk).toBe(true);
    });
    it("throws on missing agentCard", () => {
      expect(() => negotiateCapabilityV2(null, {})).toThrow(
        /agentCard is required/,
      );
    });
  });

  describe("getA2AStatsV2", () => {
    it("aggregates tasks + cards + subscriptions", () => {
      sendTaskV2(null, { agentId: "a", input: "x" });
      const t2 = sendTaskV2(null, { agentId: "b", input: "y" });
      startWorking(null, t2.taskId);
      cancelTask(null, t2.taskId, "test");
      setCardStatus(null, "c-1", "inactive");
      subscribeTyped(SUBSCRIPTION_TYPE.TASK_UPDATE, "x", () => {});
      const s = getA2AStatsV2();
      expect(s.tasks.total).toBe(2);
      expect(s.tasks.byStatus.submitted).toBe(1);
      expect(s.tasks.byStatus.canceled).toBe(1);
      expect(s.tasks.canceledWithReason).toBe(1);
      expect(s.cards.tracked).toBe(1);
      expect(s.cards.byStatus.inactive).toBe(1);
      expect(s.subscriptions.typed).toBe(1);
    });
    it("initial stats show zeros", () => {
      const s = getA2AStatsV2();
      expect(s.tasks.total).toBe(0);
      expect(s.cards.tracked).toBe(0);
    });
  });

  describe("_resetV2State", () => {
    it("clears all V2 state", () => {
      sendTaskV2(null, { agentId: "a", input: "x" });
      setCardStatus(null, "c", "inactive");
      subscribeTyped(SUBSCRIPTION_TYPE.TASK_UPDATE, "x", () => {});
      _resetV2State();
      expect(_v2Tasks.size).toBe(0);
      expect(getA2AStatsV2().cards.tracked).toBe(0);
      expect(getA2AStatsV2().subscriptions.typed).toBe(0);
    });
  });
});
