import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLIAutonomousAgent,
  GoalStatus,
  StepStatus,
  _deps,
} from "../../src/lib/autonomous-agent.js";

describe("CLIAutonomousAgent", () => {
  let agent;
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
    agent = new CLIAutonomousAgent();
  });

  afterEach(() => {
    agent.removeAllListeners();
    Object.assign(_deps, originalDeps);
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("creates uninitialized agent", () => {
      expect(agent._initialized).toBe(false);
      expect(agent._goals.size).toBe(0);
    });
  });

  // ── Initialize ──

  describe("initialize", () => {
    it("sets initialized flag", () => {
      agent.initialize({});
      expect(agent._initialized).toBe(true);
    });

    it("stores dependencies", () => {
      const llmChat = vi.fn();
      const toolExecutor = vi.fn();
      agent.initialize({ llmChat, toolExecutor, maxIterations: 5 });
      expect(agent._llmChat).toBe(llmChat);
      expect(agent._toolExecutor).toBe(toolExecutor);
      expect(agent._maxIterations).toBe(5);
    });
  });

  // ── submitGoal ──

  describe("submitGoal", () => {
    it("throws when not initialized", async () => {
      await expect(agent.submitGoal("test")).rejects.toThrow("not initialized");
    });

    it("throws on empty description", async () => {
      agent.initialize({});
      await expect(agent.submitGoal("")).rejects.toThrow(
        "description required",
      );
    });

    it("creates goal and returns goalId", async () => {
      agent.initialize({
        llmChat: null,
        toolExecutor: vi.fn(() => ({ success: true })),
        maxIterations: 2,
      });

      const { goalId } = await agent.submitGoal("test goal");
      expect(goalId).toMatch(/^goal-/);
      expect(agent._goals.has(goalId)).toBe(true);
    });

    it("emits goal:submitted event", async () => {
      agent.initialize({
        llmChat: null,
        toolExecutor: null,
        maxIterations: 1,
      });

      const events = [];
      agent.on("goal:submitted", (e) => events.push(e));

      await agent.submitGoal("test");

      expect(events.length).toBe(1);
      expect(events[0].description).toBe("test");
    });
  });

  // ── pauseGoal / resumeGoal / cancelGoal ──

  describe("goal lifecycle", () => {
    it("pauses a running goal", async () => {
      agent.initialize({ maxIterations: 1 });
      const { goalId } = await agent.submitGoal("test");

      // Wait a tick for loop to start
      await new Promise((r) => setTimeout(r, 10));

      // Force running state for test
      const goal = agent._goals.get(goalId);
      goal.status = GoalStatus.RUNNING;

      const result = agent.pauseGoal(goalId);
      expect(result.success).toBe(true);
      expect(goal.status).toBe(GoalStatus.PAUSED);
    });

    it("returns error for non-existent goal", () => {
      const result = agent.pauseGoal("nonexistent");
      expect(result.error).toBe("Goal not found");
    });

    it("cancels a goal", async () => {
      agent.initialize({ maxIterations: 1 });
      const { goalId } = await agent.submitGoal("test");

      await new Promise((r) => setTimeout(r, 10));
      const goal = agent._goals.get(goalId);
      goal.status = GoalStatus.RUNNING;

      const result = agent.cancelGoal(goalId);
      expect(result.success).toBe(true);
      expect(goal.status).toBe(GoalStatus.CANCELLED);
    });

    it("resumeGoal returns error if not paused", () => {
      agent.initialize({});
      const result = agent.resumeGoal("nonexistent");
      expect(result.error).toBe("Goal not found");
    });
  });

  // ── getGoalStatus ──

  describe("getGoalStatus", () => {
    it("returns null for unknown goal", () => {
      expect(agent.getGoalStatus("unknown")).toBeNull();
    });

    it("returns goal details", async () => {
      agent.initialize({ maxIterations: 1 });
      const { goalId } = await agent.submitGoal("test goal");

      await new Promise((r) => setTimeout(r, 50));
      const status = agent.getGoalStatus(goalId);

      expect(status).not.toBeNull();
      expect(status.description).toBe("test goal");
      expect(status.id).toBe(goalId);
    });
  });

  // ── listGoals ──

  describe("listGoals", () => {
    it("returns empty list initially", () => {
      expect(agent.listGoals()).toEqual([]);
    });

    it("lists submitted goals", async () => {
      agent.initialize({ maxIterations: 1 });
      await agent.submitGoal("goal 1");
      await agent.submitGoal("goal 2");

      await new Promise((r) => setTimeout(r, 50));
      const goals = agent.listGoals();
      expect(goals.length).toBe(2);
    });
  });

  // ── _decomposeGoal ──

  describe("_decomposeGoal", () => {
    it("returns single step without LLM", async () => {
      agent.initialize({});
      const goal = { description: "test", steps: [] };
      const steps = await agent._decomposeGoal(goal);

      expect(steps.length).toBe(1);
      expect(steps[0].description).toBe("test");
      expect(steps[0].status).toBe(StepStatus.PENDING);
    });

    it("parses LLM response into steps", async () => {
      const mockLlm = vi.fn(() =>
        JSON.stringify([
          {
            description: "Read file",
            tool: "read_file",
            params: { path: "config.js" },
          },
          {
            description: "Edit file",
            tool: "edit_file",
            params: { path: "config.js", old_string: "a", new_string: "b" },
          },
        ]),
      );

      agent.initialize({ llmChat: mockLlm });
      const goal = { description: "refactor config", steps: [] };
      const steps = await agent._decomposeGoal(goal);

      expect(steps.length).toBe(2);
      expect(steps[0].tool).toBe("read_file");
      expect(steps[1].tool).toBe("edit_file");
    });

    it("handles LLM error gracefully", async () => {
      const mockLlm = vi.fn(() => {
        throw new Error("LLM error");
      });
      agent.initialize({ llmChat: mockLlm });

      const steps = await agent._decomposeGoal({ description: "test" });
      expect(steps.length).toBe(1);
    });
  });

  // ── _executeStep ──

  describe("_executeStep", () => {
    it("skips step without tool", async () => {
      agent.initialize({});
      const result = await agent._executeStep({ tool: null, params: {} });
      expect(result).toBe("No tool action required");
    });

    it("calls tool executor", async () => {
      const mockExecutor = vi.fn(() => ({ success: true }));
      agent.initialize({ toolExecutor: mockExecutor });

      const result = await agent._executeStep({
        tool: "read_file",
        params: { path: "test.js" },
      });
      expect(mockExecutor).toHaveBeenCalledWith("read_file", {
        path: "test.js",
      });
      expect(result.success).toBe(true);
    });
  });

  // ── _selfCorrect ──

  describe("_selfCorrect", () => {
    it("returns false without LLM", async () => {
      agent.initialize({});
      const result = await agent._selfCorrect({}, new Error("test"));
      expect(result).toBe(false);
    });

    it("handles skip action", async () => {
      const mockLlm = vi.fn(() => JSON.stringify({ action: "skip" }));
      agent.initialize({ llmChat: mockLlm });

      const goal = {
        description: "test",
        steps: [{ description: "step 1", status: StepStatus.RUNNING }],
      };
      const result = await agent._selfCorrect(goal, new Error("failed"));
      expect(result).toBe(true);
      expect(goal.steps[0].status).toBe(StepStatus.SKIPPED);
    });

    it("handles add_step action", async () => {
      const mockLlm = vi.fn(() =>
        JSON.stringify({
          action: "add_step",
          newStep: {
            description: "Install deps",
            tool: "run_shell",
            params: { command: "npm install" },
          },
        }),
      );
      agent.initialize({ llmChat: mockLlm });

      const goal = {
        description: "test",
        steps: [{ description: "failing step", status: StepStatus.RUNNING }],
      };
      const result = await agent._selfCorrect(
        goal,
        new Error("missing module"),
      );
      expect(result).toBe(true);
      expect(goal.steps.length).toBe(2);
      expect(goal.steps[0].description).toBe("Install deps");
    });
  });

  // ── _parseSteps / _parseJSON ──

  describe("parsing helpers", () => {
    it("_parseSteps extracts JSON array", () => {
      const text =
        'Here are the steps:\n[{"description":"Read","tool":"read_file"}]';
      const steps = agent._parseSteps(text);
      expect(steps).toEqual([{ description: "Read", tool: "read_file" }]);
    });

    it("_parseSteps returns fallback on invalid JSON", () => {
      const steps = agent._parseSteps("not json");
      expect(steps.length).toBe(1);
    });

    it("_parseJSON extracts JSON object", () => {
      const result = agent._parseJSON('Response: {"action":"skip"}');
      expect(result).toEqual({ action: "skip" });
    });

    it("_parseJSON returns null on invalid", () => {
      expect(agent._parseJSON("not json")).toBeNull();
    });
  });

  // ── ReAct loop ──

  describe("_runReActLoop", () => {
    it("completes goal with simple steps", async () => {
      const mockExecutor = vi.fn(() => ({ success: true }));
      agent.initialize({ toolExecutor: mockExecutor, maxIterations: 10 });

      const goal = {
        id: "test-goal",
        description: "test",
        status: GoalStatus.PENDING,
        steps: [
          {
            description: "step1",
            tool: "read_file",
            params: { path: "a.js" },
            status: StepStatus.PENDING,
            retries: 0,
            critical: true,
            result: null,
            error: null,
          },
        ],
        iterations: 0,
        errors: [],
        result: null,
        tokenBudget: 50000,
        tokensUsed: 0,
      };
      agent._goals.set(goal.id, goal);

      await agent._runReActLoop(goal);

      expect(goal.status).toBe(GoalStatus.COMPLETED);
      expect(goal.steps[0].status).toBe(StepStatus.COMPLETED);
    });

    it("fails goal when critical step fails", async () => {
      const mockExecutor = vi.fn(() => {
        throw new Error("exec failed");
      });
      agent.initialize({ toolExecutor: mockExecutor, maxIterations: 5 });

      const goal = {
        id: "test-goal-fail",
        description: "test",
        status: GoalStatus.PENDING,
        steps: [
          {
            description: "step1",
            tool: "run_shell",
            params: {},
            status: StepStatus.PENDING,
            retries: 0,
            critical: true,
            result: null,
            error: null,
          },
        ],
        iterations: 0,
        errors: [],
        result: null,
        tokenBudget: 50000,
        tokensUsed: 0,
      };
      agent._goals.set(goal.id, goal);

      await agent._runReActLoop(goal);

      expect(goal.status).toBe(GoalStatus.FAILED);
      expect(goal.errors.length).toBeGreaterThan(0);
    });
  });
});
