/**
 * useFederatedLearningStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeTasks (training/recruiting/aggregating) / completedTasks
 *  - IPC actions (electronAPI.invoke mocked): loadTasks (populate / error),
 *    createTask (chains loadTasks + returns data / throws), joinTask (returns
 *    data), startTraining (chains loadTasks), loadStats (set stats), clearError
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useFederatedLearningStore } from "../federatedLearning";
import type { FLTask } from "../federatedLearning";

function task(id: string, status: string): FLTask {
  return {
    id,
    name: `T ${id}`,
    modelType: "cnn",
    globalModelVersion: 1,
    aggregationStrategy: "fedavg",
    minParticipants: 2,
    maxRounds: 10,
    currentRound: 0,
    status,
    privacyBudget: 1,
    noiseMultiplier: 1,
    clipNorm: 1,
    config: {},
    createdBy: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

describe("useFederatedLearningStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useFederatedLearningStore();
      expect(store.tasks).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeTasks keeps training/recruiting/aggregating", () => {
      const store = useFederatedLearningStore();
      store.tasks = [
        task("a", "training"),
        task("b", "recruiting"),
        task("c", "aggregating"),
        task("d", "completed"),
        task("e", "draft"),
      ];
      expect(store.activeTasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("completedTasks keeps status === 'completed'", () => {
      const store = useFederatedLearningStore();
      store.tasks = [task("a", "training"), task("b", "completed")];
      expect(store.completedTasks.map((t) => t.id)).toEqual(["b"]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadTasks populates on success", async () => {
      const store = useFederatedLearningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [task("a", "training"), task("b", "completed")],
      });
      await store.loadTasks({ status: "training" });
      expect(mockInvoke).toHaveBeenCalledWith("fl:list-tasks", {
        filter: { status: "training" },
      });
      expect(store.tasks.map((t) => t.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("loadTasks records the error on failure", async () => {
      const store = useFederatedLearningStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.loadTasks();
      expect(store.error).toBe("no svc");
    });

    it("createTask chains loadTasks and returns the new task data", async () => {
      const store = useFederatedLearningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: task("n", "recruiting") }) // create
        .mockResolvedValueOnce({
          success: true,
          data: [task("n", "recruiting")],
        }); // list
      const created = await store.createTask({ name: "n", modelType: "cnn" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "fl:create-task", {
        options: { name: "n", modelType: "cnn" },
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "fl:list-tasks", {
        filter: {},
      });
      expect((created as FLTask).id).toBe("n");
      expect(store.tasks.map((t) => t.id)).toEqual(["n"]);
    });

    it("createTask throws and records the error on failure", async () => {
      const store = useFederatedLearningStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await expect(
        store.createTask({ name: "x", modelType: "cnn" }),
      ).rejects.toThrow("denied");
      expect(store.error).toBe("denied");
    });

    it("joinTask returns the result data", async () => {
      const store = useFederatedLearningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { participantId: "p1" },
      });
      const result = await store.joinTask("t1", "did:agent");
      expect(mockInvoke).toHaveBeenCalledWith("fl:join-task", {
        taskId: "t1",
        agentDid: "did:agent",
        options: {},
      });
      expect(result).toEqual({ participantId: "p1" });
    });

    it("startTraining chains loadTasks on success", async () => {
      const store = useFederatedLearningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { started: true } }) // start
        .mockResolvedValueOnce({ success: true, data: [] }); // list
      await store.startTraining("t1");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "fl:start-training", {
        taskId: "t1",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "fl:list-tasks", {
        filter: {},
      });
    });

    it("loadStats stores stats on success", async () => {
      const store = useFederatedLearningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { totalTasks: 3, activeTasks: 1 },
      });
      await store.loadStats();
      expect(mockInvoke).toHaveBeenCalledWith("fl:get-stats", {});
      expect(store.stats?.totalTasks).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  describe("clearError", () => {
    it("resets the error", () => {
      const store = useFederatedLearningStore();
      store.error = "x";
      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});
