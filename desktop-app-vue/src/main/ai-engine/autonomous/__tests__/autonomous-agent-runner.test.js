/**
 * AutonomousAgentRunner Unit Tests
 *
 * Covers: initialize, submitGoal, pauseGoal, resumeGoal, cancelGoal,
 *         provideUserInput, getActiveGoals, getGoalHistory, getGoalSteps,
 *         getGoalStatus, getStats, updateConfig
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "goal-uuid-1234"),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock prepared-statement that responds to .get(), .all(), .run().
 */
function makePrepStmt(overrides = {}) {
  return {
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
    ...overrides,
  };
}

/**
 * Build a mock database whose .prepare() returns a shared stub.
 * Individual tests may override .get / .all / .run via .mockReturnValueOnce.
 */
function createMockDb() {
  const prepStmt = makePrepStmt();
  return {
    exec: vi.fn(),
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
    prepare: vi.fn(() => prepStmt),
    saveToFile: vi.fn(),
    _stmt: prepStmt,
  };
}

/**
 * Build a minimal goalState object that can be placed into runner.activeGoals.
 */
function makeGoalState(overrides = {}) {
  return {
    id: "goal-1",
    description: "Test goal",
    priority: 5,
    status: "running",
    toolPermissions: ["skills", "file-ops"],
    context: {},
    plan: { steps: [], strategy: "sequential" },
    result: null,
    stepCount: 0,
    tokensUsed: 0,
    stepHistory: [],
    paused: false,
    waitingForInput: false,
    inputRequest: null,
    lastUserInput: null,
    replanAttempts: 0,
    createdBy: "user",
    createdAt: new Date().toISOString(),
    _abortController: new AbortController(),
    _resumeResolve: null,
    _inputResolve: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AutonomousAgentRunner", () => {
  let AutonomousAgentRunner;
  let GOAL_STATUS;
  let DEFAULT_CONFIG;
  let runner;
  let mockDb;
  let mockLlm;
  let mockSkillExecutor;
  let mockTaskQueue;

  beforeEach(async () => {
    const mod = await import("../autonomous-agent-runner.js");
    AutonomousAgentRunner = mod.AutonomousAgentRunner;
    GOAL_STATUS = mod.GOAL_STATUS;
    DEFAULT_CONFIG = mod.DEFAULT_CONFIG;

    mockDb = createMockDb();

    mockLlm = {
      query: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          thought: "I should execute a skill",
          action: { type: "skill", name: "code-review", params: {} },
          complete: false,
        }),
      }),
    };

    mockSkillExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, output: "Skill executed" }),
    };

    mockTaskQueue = {
      enqueue: vi
        .fn()
        .mockResolvedValue({ id: "q-1", goalId: "goal-uuid-1234" }),
      dequeue: vi.fn().mockResolvedValue(null),
      getQueueStatus: vi
        .fn()
        .mockResolvedValue({ pending: 0, active: 0, total: 0 }),
      markComplete: vi.fn().mockResolvedValue(undefined),
    };

    runner = new AutonomousAgentRunner();
    runner.initialize({
      database: mockDb,
      llmManager: mockLlm,
      skillExecutor: mockSkillExecutor,
      toolRegistry: null,
      taskQueue: mockTaskQueue,
    });
  });

  afterEach(() => {
    // Cancel any active goals to prevent lingering async loops
    for (const [goalId, goal] of runner.activeGoals) {
      if (goal._abortController) {
        goal._abortController.abort();
      }
      runner.activeGoals.delete(goalId);
    }
    vi.clearAllMocks();
  });

  // ─── initialize ─────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("should set initialized=true", () => {
      expect(runner.initialized).toBe(true);
    });

    it("should attach the database", () => {
      expect(runner.database).toBe(mockDb);
    });

    it("should attach the llmManager", () => {
      expect(runner.llmManager).toBe(mockLlm);
    });

    it("should attach the skillExecutor", () => {
      expect(runner.skillExecutor).toBe(mockSkillExecutor);
    });

    it("should be idempotent — a second call is a no-op", () => {
      const secondDb = createMockDb();
      runner.initialize({ database: secondDb });
      expect(runner.database).toBe(mockDb); // unchanged
    });

    it("should call db.exec() to create tables", () => {
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it("should start with an empty activeGoals map", () => {
      const freshRunner = new AutonomousAgentRunner();
      freshRunner.initialize({ database: mockDb });
      expect(freshRunner.activeGoals.size).toBe(0);
    });
  });

  // ─── submitGoal ──────────────────────────────────────────────────────────────

  describe("submitGoal()", () => {
    it("should return an object with success=true and a goalId", async () => {
      // Make decompose return quickly
      mockLlm.query.mockResolvedValueOnce({
        text: JSON.stringify({
          steps: [{ description: "Step 1", estimatedComplexity: "low" }],
          strategy: "sequential",
        }),
      });
      // After decomposeGoal the runner starts _executeGoal asynchronously.
      // Abort so it does not run indefinitely.
      const result = await runner.submitGoal({
        description: "Review the codebase",
        priority: 3,
        toolPermissions: ["skills"],
        context: "",
      });

      // Abort the execution loop immediately to avoid test leaks
      for (const [, g] of runner.activeGoals) {
        g._abortController.abort();
      }

      expect(result).toHaveProperty("success", true);
      expect(result.data).toHaveProperty("goalId");
    });

    it("should return a string goalId", async () => {
      mockLlm.query.mockResolvedValue({
        text: JSON.stringify({ steps: [], strategy: "sequential" }),
      });

      const result = await runner.submitGoal({
        description: "Simple task",
        priority: 5,
      });

      for (const [, g] of runner.activeGoals) {
        g._abortController.abort();
      }

      expect(typeof result.data.goalId).toBe("string");
      expect(result.data.goalId.length).toBeGreaterThan(0);
    });

    it("should return success=false when description is empty", async () => {
      const result = await runner.submitGoal({
        description: "   ",
        priority: 5,
      });
      expect(result).toHaveProperty("success", false);
      expect(result.error).toBeDefined();
    });

    it("should return success=false when runner is not initialized", async () => {
      const uninitialized = new AutonomousAgentRunner();
      const result = await uninitialized.submitGoal({
        description: "Task",
        priority: 5,
      });
      expect(result.success).toBe(false);
    });

    it("should persist the goal via db.run()", async () => {
      mockLlm.query.mockResolvedValue({
        text: JSON.stringify({ steps: [], strategy: "sequential" }),
      });

      await runner.submitGoal({ description: "Persist me", priority: 5 });
      for (const [, g] of runner.activeGoals) {
        g._abortController.abort();
      }

      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should enqueue the goal in the taskQueue", async () => {
      mockLlm.query.mockResolvedValue({
        text: JSON.stringify({ steps: [], strategy: "sequential" }),
      });

      await runner.submitGoal({ description: "Queue this", priority: 2 });
      for (const [, g] of runner.activeGoals) {
        g._abortController.abort();
      }

      expect(mockTaskQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ goalId: expect.any(String), priority: 2 }),
      );
    });

    it('should emit the "goal-submitted" event', async () => {
      mockLlm.query.mockResolvedValue({
        text: JSON.stringify({ steps: [], strategy: "sequential" }),
      });

      const handler = vi.fn();
      runner.on("goal-submitted", handler);

      await runner.submitGoal({ description: "Emit test", priority: 5 });
      for (const [, g] of runner.activeGoals) {
        g._abortController.abort();
      }

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ goalId: expect.any(String) }),
      );
    });

    it("should clamp priority to the range [1, 10]", async () => {
      mockLlm.query.mockResolvedValue({
        text: JSON.stringify({ steps: [], strategy: "sequential" }),
      });

      const result = await runner.submitGoal({
        description: "Priority clamp",
        priority: 99,
      });
      for (const [, g] of runner.activeGoals) {
        g._abortController.abort();
      }

      expect(result.data.priority).toBe(10);
    });
  });

  // ─── pauseGoal ───────────────────────────────────────────────────────────────

  describe("pauseGoal()", () => {
    it("should set goal.paused=true", async () => {
      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.pauseGoal("goal-1");

      expect(goal.paused).toBe(true);
    });

    it('should set goal.status to "paused"', async () => {
      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.pauseGoal("goal-1");

      expect(goal.status).toBe(GOAL_STATUS.PAUSED);
    });

    it("should persist the status change to the database", async () => {
      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.pauseGoal("goal-1");

      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should emit "goal-paused" with the goalId', async () => {
      const handler = vi.fn();
      runner.on("goal-paused", handler);

      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.pauseGoal("goal-1");

      expect(handler).toHaveBeenCalledWith({ goalId: "goal-1" });
    });

    it("should return success=false for a non-existent goal", async () => {
      const result = await runner.pauseGoal("no-such-goal");
      expect(result.success).toBe(false);
    });

    it("should return success=false when goal is already paused", async () => {
      const goal = makeGoalState({ id: "goal-1", status: "paused" });
      runner.activeGoals.set("goal-1", goal);

      const result = await runner.pauseGoal("goal-1");
      expect(result.success).toBe(false);
    });
  });

  // ─── resumeGoal ──────────────────────────────────────────────────────────────

  describe("resumeGoal()", () => {
    it("should set goal.paused=false", async () => {
      const goal = makeGoalState({
        id: "goal-1",
        status: "paused",
        paused: true,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.resumeGoal("goal-1");

      expect(goal.paused).toBe(false);
    });

    it('should set goal.status back to "running"', async () => {
      const goal = makeGoalState({
        id: "goal-1",
        status: "paused",
        paused: true,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.resumeGoal("goal-1");

      expect(goal.status).toBe(GOAL_STATUS.RUNNING);
    });

    it("should call _resumeResolve() if set, allowing the loop to continue", async () => {
      const resolve = vi.fn();
      const goal = makeGoalState({
        id: "goal-1",
        status: "paused",
        paused: true,
        _resumeResolve: resolve,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.resumeGoal("goal-1");

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(goal._resumeResolve).toBeNull();
    });

    it('should emit "goal-resumed" with the goalId', async () => {
      const handler = vi.fn();
      runner.on("goal-resumed", handler);

      const goal = makeGoalState({
        id: "goal-1",
        status: "paused",
        paused: true,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.resumeGoal("goal-1");

      expect(handler).toHaveBeenCalledWith({ goalId: "goal-1" });
    });

    it("should return success=false for a non-existent goal", async () => {
      const result = await runner.resumeGoal("no-such-goal");
      expect(result.success).toBe(false);
    });

    it("should return success=false when goal is not paused", async () => {
      const goal = makeGoalState({
        id: "goal-1",
        status: "running",
        paused: false,
      });
      runner.activeGoals.set("goal-1", goal);

      const result = await runner.resumeGoal("goal-1");
      expect(result.success).toBe(false);
    });
  });

  // ─── cancelGoal ──────────────────────────────────────────────────────────────

  describe("cancelGoal()", () => {
    it('should set goal.status to "cancelled" before removal', async () => {
      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.cancelGoal("goal-1");

      // goal object was mutated before deletion
      expect(goal.status).toBe(GOAL_STATUS.CANCELLED);
    });

    it("should remove the goal from activeGoals", async () => {
      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.cancelGoal("goal-1");

      expect(runner.activeGoals.has("goal-1")).toBe(false);
    });

    it("should call abort() on the AbortController", async () => {
      const abort = vi.fn();
      const goal = makeGoalState({
        id: "goal-1",
        status: "running",
        _abortController: { abort },
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.cancelGoal("goal-1");

      expect(abort).toHaveBeenCalledTimes(1);
    });

    it('should emit "goal-cancelled" with the goalId', async () => {
      const handler = vi.fn();
      runner.on("goal-cancelled", handler);

      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      await runner.cancelGoal("goal-1");

      expect(handler).toHaveBeenCalledWith({ goalId: "goal-1" });
    });

    it("should resolve pending _resumeResolve to unblock the loop", async () => {
      const resume = vi.fn();
      const goal = makeGoalState({
        id: "goal-1",
        status: "paused",
        _resumeResolve: resume,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.cancelGoal("goal-1");

      expect(resume).toHaveBeenCalled();
    });

    it("should return success=false for a non-existent goal", async () => {
      const result = await runner.cancelGoal("no-such-goal");
      expect(result.success).toBe(false);
    });
  });

  // ─── provideUserInput ────────────────────────────────────────────────────────

  describe("provideUserInput()", () => {
    it("should set goal.waitingForInput=false", async () => {
      const inputResolve = vi.fn();
      const goal = makeGoalState({
        id: "goal-1",
        status: "waiting_input",
        waitingForInput: true,
        _inputResolve: inputResolve,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.provideUserInput("goal-1", "user answer");

      expect(goal.waitingForInput).toBe(false);
    });

    it("should store the input in goal.lastUserInput", async () => {
      const inputResolve = vi.fn();
      const goal = makeGoalState({
        id: "goal-1",
        status: "waiting_input",
        waitingForInput: true,
        _inputResolve: inputResolve,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.provideUserInput("goal-1", "my answer");

      expect(goal.lastUserInput).toBe("my answer");
    });

    it("should call _inputResolve with the input string", async () => {
      const inputResolve = vi.fn();
      const goal = makeGoalState({
        id: "goal-1",
        waitingForInput: true,
        _inputResolve: inputResolve,
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.provideUserInput("goal-1", "user answer");

      expect(inputResolve).toHaveBeenCalledWith("user answer");
      expect(goal._inputResolve).toBeNull();
    });

    it('should set goal.status back to "running"', async () => {
      const goal = makeGoalState({
        id: "goal-1",
        status: "waiting_input",
        waitingForInput: true,
        _inputResolve: vi.fn(),
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.provideUserInput("goal-1", "answer");

      expect(goal.status).toBe(GOAL_STATUS.RUNNING);
    });

    it("should return success=false for a non-existent goal", async () => {
      const result = await runner.provideUserInput("no-such-goal", "answer");
      expect(result.success).toBe(false);
    });

    it("should return success=false when goal is not waiting for input", async () => {
      const goal = makeGoalState({
        id: "goal-1",
        status: "running",
        waitingForInput: false,
      });
      runner.activeGoals.set("goal-1", goal);

      const result = await runner.provideUserInput("goal-1", "answer");
      expect(result.success).toBe(false);
    });

    it('should emit "input-provided" with goalId and input', async () => {
      const handler = vi.fn();
      runner.on("input-provided", handler);

      const goal = makeGoalState({
        id: "goal-1",
        waitingForInput: true,
        _inputResolve: vi.fn(),
      });
      runner.activeGoals.set("goal-1", goal);

      await runner.provideUserInput("goal-1", "test input");

      expect(handler).toHaveBeenCalledWith({
        goalId: "goal-1",
        input: "test input",
      });
    });
  });

  // ─── getActiveGoals ──────────────────────────────────────────────────────────

  describe("getActiveGoals()", () => {
    it("should return an object with success=true and a data array", async () => {
      runner.activeGoals.set("g1", makeGoalState({ id: "g1" }));
      runner.activeGoals.set("g2", makeGoalState({ id: "g2" }));

      const result = await runner.getActiveGoals();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("should list every goal in activeGoals", async () => {
      runner.activeGoals.set("g1", makeGoalState({ id: "g1" }));
      runner.activeGoals.set("g2", makeGoalState({ id: "g2" }));

      const result = await runner.getActiveGoals();
      const ids = result.data.map((g) => g.id);
      expect(ids).toContain("g1");
      expect(ids).toContain("g2");
    });

    it("should return an empty data array when no goals are active", async () => {
      const result = await runner.getActiveGoals();
      expect(result.data).toHaveLength(0);
    });

    it("should not expose internal fields like _abortController", async () => {
      runner.activeGoals.set("g1", makeGoalState({ id: "g1" }));
      const result = await runner.getActiveGoals();
      expect(result.data[0]).not.toHaveProperty("_abortController");
    });
  });

  // ─── getGoalHistory ──────────────────────────────────────────────────────────

  describe("getGoalHistory()", () => {
    it("should query the database with ORDER BY created_at DESC", async () => {
      await runner.getGoalHistory(10, 0);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY created_at DESC"),
      );
    });

    it("should pass limit and offset to the DB statement", async () => {
      await runner.getGoalHistory(10, 0);
      expect(mockDb._stmt.all).toHaveBeenCalledWith(10, 0);
    });

    it("should return an array of goals in the data field", async () => {
      mockDb._stmt.all.mockReturnValueOnce([
        {
          id: "g1",
          description: "Old goal",
          status: "completed",
          priority: 5,
          tool_permissions: "[]",
          context: "{}",
          plan: "{}",
          result: null,
          step_count: 3,
          tokens_used: 500,
          error_message: null,
          created_by: "user",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
          completed_at: "2026-01-01",
        },
      ]);
      // The second .get() call is for COUNT(*)
      mockDb._stmt.get.mockReturnValueOnce({ count: 1 });

      const result = await runner.getGoalHistory(50, 0);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.goals)).toBe(true);
      expect(result.data.goals).toHaveLength(1);
    });

    it("should return success=true with empty array when DB is absent", async () => {
      runner.database = null;
      const result = await runner.getGoalHistory(10, 0);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ─── getGoalSteps ────────────────────────────────────────────────────────────

  describe("getGoalSteps()", () => {
    it("should return in-memory stepHistory when goal is active", async () => {
      const steps = [{ id: "s1", stepNumber: 1, phase: "react" }];
      runner.activeGoals.set(
        "goal-1",
        makeGoalState({ id: "goal-1", stepHistory: steps }),
      );

      const result = await runner.getGoalSteps("goal-1");
      expect(result.success).toBe(true);
      expect(result.data).toBe(steps);
    });

    it("should fall back to DB for completed goals", async () => {
      mockDb._stmt.all.mockReturnValueOnce([
        {
          id: "s1",
          goal_id: "goal-1",
          step_number: 1,
          phase: "react",
          thought: "thinking",
          action_type: "skill",
          action_params: "{}",
          result: "ok",
          success: 1,
          tokens_used: 100,
          duration_ms: 500,
          created_at: "2026-01-01",
        },
      ]);

      const result = await runner.getGoalSteps("goal-1");
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("should return empty data when goal not found and DB is absent", async () => {
      runner.database = null;
      const result = await runner.getGoalSteps("no-such-goal");
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ─── getGoalStatus ──────────────────────────────────────────────────────────

  describe("getGoalStatus()", () => {
    it("should return the in-memory goal when active", async () => {
      const goal = makeGoalState({ id: "goal-1", status: "running" });
      runner.activeGoals.set("goal-1", goal);

      const result = await runner.getGoalStatus("goal-1");
      expect(result.success).toBe(true);
      expect(result.data.status).toBe("running");
    });

    it("should fall back to DB when goal is not active", async () => {
      mockDb._stmt.get.mockReturnValueOnce({
        id: "goal-1",
        description: "From DB",
        status: "completed",
        priority: 5,
        tool_permissions: "[]",
        context: "{}",
        plan: "{}",
        result: "done",
        step_count: 10,
        tokens_used: 1000,
        error_message: null,
        created_by: "user",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        completed_at: "2026-01-01",
      });

      const result = await runner.getGoalStatus("goal-1");
      expect(result.success).toBe(true);
      expect(result.data.status).toBe("completed");
    });

    it("should return success=false when goal not found anywhere", async () => {
      const result = await runner.getGoalStatus("no-such-goal");
      expect(result.success).toBe(false);
    });
  });

  // ─── getStats ────────────────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("should return an object with success=true", async () => {
      const result = await runner.getStats();
      expect(result.success).toBe(true);
    });

    it("should include activeGoals count", async () => {
      runner.activeGoals.set(
        "g1",
        makeGoalState({ id: "g1", status: "running" }),
      );
      const result = await runner.getStats();
      expect(result.data.activeGoals).toBe(1);
    });

    it("should count running and paused goals separately", async () => {
      runner.activeGoals.set(
        "g1",
        makeGoalState({ id: "g1", status: "running" }),
      );
      runner.activeGoals.set(
        "g2",
        makeGoalState({ id: "g2", status: "paused" }),
      );

      const result = await runner.getStats();
      expect(result.data.runningGoals).toBe(1);
      expect(result.data.pausedGoals).toBe(1);
    });

    it("should query the database for historical totals", async () => {
      // COUNT(*) calls — total, completed, failed, cancelled, steps, tokens
      mockDb._stmt.get
        .mockReturnValueOnce({ count: 10 }) // total goals
        .mockReturnValueOnce({ count: 7 }) // completed
        .mockReturnValueOnce({ count: 2 }) // failed
        .mockReturnValueOnce({ count: 1 }) // cancelled
        .mockReturnValueOnce({ count: 50 }) // steps
        .mockReturnValueOnce({ total: 9999 }); // tokens

      const result = await runner.getStats();
      expect(result.data.totalGoals).toBe(10);
      expect(result.data.completedGoals).toBe(7);
      expect(result.data.failedGoals).toBe(2);
    });

    it("should calculate successRate from completed / (completed + failed)", async () => {
      mockDb._stmt.get
        .mockReturnValueOnce({ count: 9 }) // total
        .mockReturnValueOnce({ count: 6 }) // completed
        .mockReturnValueOnce({ count: 3 }) // failed
        .mockReturnValueOnce({ count: 0 }) // cancelled
        .mockReturnValueOnce({ count: 30 }) // steps
        .mockReturnValueOnce({ total: 5000 }); // tokens

      const result = await runner.getStats();
      // successRate = round(6 / (6+3) * 100) = 67
      expect(result.data.successRate).toBe(67);
    });
  });

  // ─── updateConfig ────────────────────────────────────────────────────────────

  describe("updateConfig()", () => {
    it("should update maxStepsPerGoal", () => {
      runner.updateConfig({ maxStepsPerGoal: 50 });
      expect(runner.config.maxStepsPerGoal).toBe(50);
    });

    it("should clamp maxStepsPerGoal to the range [1, 500]", () => {
      runner.updateConfig({ maxStepsPerGoal: 10000 });
      expect(runner.config.maxStepsPerGoal).toBe(500);

      runner.updateConfig({ maxStepsPerGoal: -5 });
      expect(runner.config.maxStepsPerGoal).toBe(1);
    });

    it("should update maxConcurrentGoals", () => {
      runner.updateConfig({ maxConcurrentGoals: 2 });
      expect(runner.config.maxConcurrentGoals).toBe(2);
    });

    it("should clamp maxConcurrentGoals to the range [1, 10]", () => {
      runner.updateConfig({ maxConcurrentGoals: 99 });
      expect(runner.config.maxConcurrentGoals).toBe(10);
    });

    it("should update stepTimeoutMs", () => {
      runner.updateConfig({ stepTimeoutMs: 30000 });
      expect(runner.config.stepTimeoutMs).toBe(30000);
    });

    it("should clamp stepTimeoutMs to [5000, 600000]", () => {
      runner.updateConfig({ stepTimeoutMs: 1 });
      expect(runner.config.stepTimeoutMs).toBe(5000);

      runner.updateConfig({ stepTimeoutMs: 9999999 });
      expect(runner.config.stepTimeoutMs).toBe(600000);
    });

    it("should update tokenBudgetPerGoal", () => {
      runner.updateConfig({ tokenBudgetPerGoal: 20000 });
      expect(runner.config.tokenBudgetPerGoal).toBe(20000);
    });

    it("should update maxReplanAttempts", () => {
      runner.updateConfig({ maxReplanAttempts: 5 });
      expect(runner.config.maxReplanAttempts).toBe(5);
    });

    it("should return an object with success=true and the current config", () => {
      const result = runner.updateConfig({ maxStepsPerGoal: 25 });
      expect(result.success).toBe(true);
      expect(result.data.maxStepsPerGoal).toBe(25);
    });

    it("should leave unchanged keys at their previous values", () => {
      const prevTimeout = runner.config.stepTimeoutMs;
      runner.updateConfig({ maxStepsPerGoal: 30 });
      expect(runner.config.stepTimeoutMs).toBe(prevTimeout);
    });
  });

  // ─── _parseJSON ──────────────────────────────────────────────────────────────

  describe("_parseJSON()", () => {
    it("should parse a plain JSON string", () => {
      const result = runner._parseJSON('{"a":1}');
      expect(result).toEqual({ a: 1 });
    });

    it("should extract JSON from a markdown code block", () => {
      const md = '```json\n{"b":2}\n```';
      expect(runner._parseJSON(md)).toEqual({ b: 2 });
    });

    it("should extract JSON object from surrounding text", () => {
      const text = 'Here is the result: {"c":3} end';
      expect(runner._parseJSON(text)).toEqual({ c: 3 });
    });

    it("should throw when no valid JSON is found", () => {
      expect(() => runner._parseJSON("no json here")).toThrow();
    });

    it("should throw for empty input", () => {
      expect(() => runner._parseJSON("")).toThrow();
    });
  });
});
