/**
 * usePlanningStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isPlanning / isAwaitingConfirmation / isExecuting /
 *    isCompleted / isFailed / progressPercentage
 *  - Session actions (mocked window.ipc.invoke): startPlanSession (success /
 *    failure / throw) / respondToPlan (no-session / confirm / adjust / cancel) /
 *    submitFeedback / getSession
 *  - Dialog actions (openPlanDialog / closePlanDialog) + reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { usePlanningStore } from "../planning";

describe("usePlanningStore", () => {
  const mockInvoke = vi.fn();
  const mockOn = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    mockOn.mockReset();
    (window as any).ipc = { invoke: mockInvoke, on: mockOn };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts with no session and empty recommendations", () => {
      const store = usePlanningStore();
      expect(store.currentSession).toBeNull();
      expect(store.sessionStatus).toBeNull();
      expect(store.taskPlan).toBeNull();
      expect(store.recommendedTemplates).toEqual([]);
      expect(store.recommendedSkills).toEqual([]);
      expect(store.recommendedTools).toEqual([]);
      expect(store.executionProgress).toEqual({
        currentStep: 0,
        totalSteps: 0,
        status: "",
        logs: [],
      });
      expect(store.loading).toBe(false);
      expect(store.dialogVisible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("status getters", () => {
    it("each status flag is true only for its matching sessionStatus", () => {
      const store = usePlanningStore();
      const cases: Array<[string, keyof ReturnType<typeof usePlanningStore>]> =
        [
          ["planning", "isPlanning"],
          ["awaiting_confirmation", "isAwaitingConfirmation"],
          ["executing", "isExecuting"],
          ["completed", "isCompleted"],
          ["failed", "isFailed"],
        ];
      for (const [status, flag] of cases) {
        store.sessionStatus = status as any;
        expect(store[flag]).toBe(true);
        // all other flags false
        for (const [, otherFlag] of cases.filter(([, f]) => f !== flag)) {
          expect(store[otherFlag]).toBe(false);
        }
      }
    });

    it("all flags false when sessionStatus is null", () => {
      const store = usePlanningStore();
      store.sessionStatus = null;
      expect(store.isPlanning).toBe(false);
      expect(store.isAwaitingConfirmation).toBe(false);
      expect(store.isExecuting).toBe(false);
      expect(store.isCompleted).toBe(false);
      expect(store.isFailed).toBe(false);
    });
  });

  describe("getter: progressPercentage", () => {
    it("is 0 when totalSteps is 0", () => {
      const store = usePlanningStore();
      store.executionProgress = {
        currentStep: 0,
        totalSteps: 0,
        status: "",
        logs: [],
      };
      expect(store.progressPercentage).toBe(0);
    });

    it("rounds the step ratio to a percentage", () => {
      const store = usePlanningStore();
      store.executionProgress = {
        currentStep: 3,
        totalSteps: 10,
        status: "",
        logs: [],
      };
      expect(store.progressPercentage).toBe(30);
      store.executionProgress = {
        currentStep: 1,
        totalSteps: 3,
        status: "",
        logs: [],
      };
      expect(store.progressPercentage).toBe(33); // Math.round(33.33)
    });
  });

  // -------------------------------------------------------------------------
  // startPlanSession
  // -------------------------------------------------------------------------

  describe("startPlanSession", () => {
    it("populates session + plan + recommendations on success", async () => {
      const store = usePlanningStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        sessionId: "s1",
        status: "awaiting_confirmation",
        plan: { id: "p1" },
        recommendedTemplates: [{ id: "t1" }],
        recommendedSkills: [{ id: "sk1" }],
        recommendedTools: [{ id: "tl1" }],
      });
      const result = await store.startPlanSession("build a thing", {
        projectId: "proj",
      });
      expect(mockInvoke).toHaveBeenCalledWith(
        "interactive-planning:start-session",
        {
          userRequest: "build a thing",
          projectContext: { projectId: "proj" },
        },
      );
      expect(result?.success).toBe(true);
      expect(store.currentSession?.sessionId).toBe("s1");
      expect(store.sessionStatus).toBe("awaiting_confirmation");
      expect(store.taskPlan).toEqual({ id: "p1" });
      expect(store.recommendedTemplates).toEqual([{ id: "t1" }]);
      expect(store.loading).toBe(false);
    });

    it("sets status=failed and returns null on result.success=false", async () => {
      const store = usePlanningStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: "nope" });
      const result = await store.startPlanSession("x");
      expect(result).toBeNull();
      expect(store.sessionStatus).toBe("failed");
      expect(store.loading).toBe(false);
    });

    it("sets status=failed and returns null when IPC throws", async () => {
      const store = usePlanningStore();
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      const result = await store.startPlanSession("x");
      expect(result).toBeNull();
      expect(store.sessionStatus).toBe("failed");
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // respondToPlan
  // -------------------------------------------------------------------------

  describe("respondToPlan", () => {
    function withSession(store: ReturnType<typeof usePlanningStore>) {
      store.currentSession = {
        sessionId: "s1",
        userRequest: "x",
        projectContext: {},
      } as any;
    }

    it("returns null when there is no active session", async () => {
      const store = usePlanningStore();
      const result = await store.respondToPlan("confirm");
      expect(result).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("confirm → initializes executionProgress with totalSteps", async () => {
      const store = usePlanningStore();
      withSession(store);
      mockInvoke.mockResolvedValueOnce({
        success: true,
        status: "executing",
        totalSteps: 5,
      });
      await store.respondToPlan("confirm");
      expect(store.sessionStatus).toBe("executing");
      expect(store.executionProgress).toEqual({
        currentStep: 0,
        totalSteps: 5,
        status: "准备执行...",
        logs: [],
      });
    });

    it("adjust → replaces taskPlan + recommendations", async () => {
      const store = usePlanningStore();
      withSession(store);
      mockInvoke.mockResolvedValueOnce({
        success: true,
        status: "awaiting_confirmation",
        plan: { id: "p2" },
        recommendedSkills: [{ id: "sk2" }],
      });
      await store.respondToPlan("adjust", { adjustment: "more" });
      expect(store.taskPlan).toEqual({ id: "p2" });
      expect(store.recommendedSkills).toEqual([{ id: "sk2" }]);
    });

    it("cancel → resets the store", async () => {
      const store = usePlanningStore();
      withSession(store);
      store.taskPlan = { id: "p1" } as any;
      store.sessionStatus = "awaiting_confirmation";
      mockInvoke.mockResolvedValueOnce({ success: true, status: "cancelled" });
      await store.respondToPlan("cancel");
      expect(store.currentSession).toBeNull();
      expect(store.taskPlan).toBeNull();
      expect(store.sessionStatus).toBeNull();
    });

    it("returns null on failure", async () => {
      const store = usePlanningStore();
      withSession(store);
      mockInvoke.mockResolvedValueOnce({ success: false, error: "x" });
      expect(await store.respondToPlan("confirm")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // submitFeedback / getSession
  // -------------------------------------------------------------------------

  describe("submitFeedback", () => {
    it("returns false with no active session", async () => {
      const store = usePlanningStore();
      expect(await store.submitFeedback({ rating: 5 } as any)).toBe(false);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("returns true on success, false on failure", async () => {
      const store = usePlanningStore();
      store.currentSession = {
        sessionId: "s1",
        userRequest: "x",
        projectContext: {},
      } as any;
      mockInvoke.mockResolvedValueOnce({ success: true });
      expect(await store.submitFeedback({ rating: 5 } as any)).toBe(true);
      mockInvoke.mockResolvedValueOnce({ success: false, error: "x" });
      expect(await store.submitFeedback({ rating: 1 } as any)).toBe(false);
    });
  });

  describe("getSession", () => {
    it("returns the session on success, null on failure", async () => {
      const store = usePlanningStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        session: { sessionId: "s1" },
      });
      expect(await store.getSession("s1")).toEqual({ sessionId: "s1" });
      mockInvoke.mockResolvedValueOnce({ success: false, error: "x" });
      expect(await store.getSession("s2")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Dialog actions + reset
  // -------------------------------------------------------------------------

  describe("dialog actions + reset", () => {
    it("openPlanDialog shows the dialog and starts a session", async () => {
      const store = usePlanningStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        sessionId: "s1",
        status: "planning",
      });
      await store.openPlanDialog("do it");
      expect(store.dialogVisible).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith(
        "interactive-planning:start-session",
        expect.objectContaining({ userRequest: "do it" }),
      );
    });

    it("closePlanDialog hides the dialog", () => {
      const store = usePlanningStore();
      store.dialogVisible = true;
      store.closePlanDialog();
      expect(store.dialogVisible).toBe(false);
    });

    it("reset clears session, plan, recommendations and flags", () => {
      const store = usePlanningStore();
      store.currentSession = {
        sessionId: "s1",
        userRequest: "x",
        projectContext: {},
      } as any;
      store.sessionStatus = "executing";
      store.taskPlan = { id: "p1" } as any;
      store.recommendedTemplates = [{ id: "t1" }] as any;
      store.loading = true;
      store.dialogVisible = true;
      store.reset();
      expect(store.currentSession).toBeNull();
      expect(store.sessionStatus).toBeNull();
      expect(store.taskPlan).toBeNull();
      expect(store.recommendedTemplates).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.dialogVisible).toBe(false);
    });
  });
});
