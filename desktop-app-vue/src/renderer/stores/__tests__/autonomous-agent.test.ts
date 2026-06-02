/**
 * useAutonomousAgentStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: runningGoals / pausedGoals / waitingGoals / activeGoalCount /
 *    hasInputRequests (Map-based) / selectedGoal (active + history fallback) /
 *    successRate
 *  - selectGoal: null clears step/log arrays (pure); id fetches via IPC
 *  - reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useAutonomousAgentStore } from "../autonomous-agent";
import type { AutonomousGoal, GoalStatus } from "../autonomous-agent";

function goal(
  id: string,
  status: GoalStatus,
  overrides: Partial<AutonomousGoal> = {},
): AutonomousGoal {
  return {
    id,
    description: `goal ${id}`,
    priority: 1,
    status,
    toolPermissions: [],
    context: {},
    plan: {} as any,
    result: null,
    stepCount: 0,
    tokensUsed: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useAutonomousAgentStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true, data: [] });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts with no goals and an empty input-request map", () => {
      const store = useAutonomousAgentStore();
      expect(store.activeGoals).toEqual([]);
      expect(store.goalHistory).toEqual([]);
      expect(store.selectedGoalId).toBeNull();
      expect(store.inputRequests instanceof Map).toBe(true);
      expect(store.inputRequests.size).toBe(0);
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Status-filter getters
  // -------------------------------------------------------------------------

  describe("status getters", () => {
    it("running / paused / waiting split activeGoals by status", () => {
      const store = useAutonomousAgentStore();
      store.activeGoals = [
        goal("a", "running"),
        goal("b", "paused"),
        goal("c", "waiting_input"),
        goal("d", "running"),
      ];
      expect(store.runningGoals.map((g) => g.id)).toEqual(["a", "d"]);
      expect(store.pausedGoals.map((g) => g.id)).toEqual(["b"]);
      expect(store.waitingGoals.map((g) => g.id)).toEqual(["c"]);
      expect(store.activeGoalCount).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Other getters
  // -------------------------------------------------------------------------

  describe("hasInputRequests", () => {
    it("reflects the inputRequests Map size", () => {
      const store = useAutonomousAgentStore();
      expect(store.hasInputRequests).toBe(false);
      store.inputRequests.set("a", { goalId: "a" } as any);
      expect(store.hasInputRequests).toBe(true);
    });
  });

  describe("selectedGoal", () => {
    it("is null when no goal selected", () => {
      expect(useAutonomousAgentStore().selectedGoal).toBeNull();
    });

    it("resolves from activeGoals, then goalHistory", () => {
      const store = useAutonomousAgentStore();
      store.activeGoals = [goal("a", "running")];
      store.goalHistory = [goal("h", "completed")];
      store.selectedGoalId = "a";
      expect(store.selectedGoal?.id).toBe("a");
      store.selectedGoalId = "h"; // only in history
      expect(store.selectedGoal?.id).toBe("h");
      store.selectedGoalId = "missing";
      expect(store.selectedGoal).toBeNull();
    });
  });

  describe("successRate", () => {
    it("reads stats.successRate, defaulting to 0", () => {
      const store = useAutonomousAgentStore();
      expect(store.successRate).toBe(0);
      store.stats = { successRate: 88 } as any;
      expect(store.successRate).toBe(88);
    });
  });

  // -------------------------------------------------------------------------
  // selectGoal
  // -------------------------------------------------------------------------

  describe("selectGoal", () => {
    it("null clears step/log arrays without IPC", () => {
      const store = useAutonomousAgentStore();
      store.currentGoalSteps = [{ id: "s1" } as any];
      store.currentGoalLogs = [{ id: "l1" } as any];
      store.selectGoal(null);
      expect(store.selectedGoalId).toBeNull();
      expect(store.currentGoalSteps).toEqual([]);
      expect(store.currentGoalLogs).toEqual([]);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("a goal id sets selectedGoalId and fetches steps + logs", () => {
      const store = useAutonomousAgentStore();
      store.selectGoal("g1");
      expect(store.selectedGoalId).toBe("g1");
      expect(mockInvoke).toHaveBeenCalledWith("agent:get-goal-steps", "g1");
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("restores initial state", () => {
      const store = useAutonomousAgentStore();
      store.activeGoals = [goal("a", "running")];
      store.selectedGoalId = "a";
      store.loading = true;
      store.reset();
      expect(store.activeGoals).toEqual([]);
      expect(store.selectedGoalId).toBeNull();
      expect(store.loading).toBe(false);
    });
  });
});
