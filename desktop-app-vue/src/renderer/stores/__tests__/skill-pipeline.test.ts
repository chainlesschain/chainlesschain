/**
 * useSkillPipelineStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activePipelines (!isTemplate) / completedPipelines
 *    (executionCount > 0) / pipelinesByCategory (group + 'custom' default)
 *  - IPC actions (window.electronAPI.invoke mocked): loadPipelines (populate /
 *    error), createPipeline (id + reload / throw), executePipeline (status +
 *    reload), loadTemplates, deletePipeline (reload)
 *
 * NB: setup-style store calling window.electronAPI?.invoke directly; the
 * Pipeline interfaces are not exported, so fixtures are loosely typed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useSkillPipelineStore } from "../skill-pipeline";

const mockInvoke = vi.fn();

function pipe(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    name: `P ${id}`,
    description: "",
    category: "custom",
    tags: [],
    steps: [],
    variables: {},
    isTemplate: false,
    stepCount: 0,
    executionCount: 0,
    lastExecutedAt: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe("useSkillPipelineStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true, data: [] });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useSkillPipelineStore();
      expect(store.pipelines).toEqual([]);
      expect(store.currentPipeline).toBeNull();
      expect(store.executionStatus).toBeNull();
      expect(store.templates).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activePipelines excludes templates", () => {
      const store = useSkillPipelineStore();
      store.pipelines = [pipe("a"), pipe("b", { isTemplate: true }), pipe("c")];
      expect(store.activePipelines.map((p) => p.id)).toEqual(["a", "c"]);
    });

    it("completedPipelines keeps executionCount > 0", () => {
      const store = useSkillPipelineStore();
      store.pipelines = [
        pipe("a", { executionCount: 0 }),
        pipe("b", { executionCount: 3 }),
        pipe("c", { executionCount: 1 }),
      ];
      expect(store.completedPipelines.map((p) => p.id)).toEqual(["b", "c"]);
    });

    it("pipelinesByCategory groups, defaulting empty category to 'custom'", () => {
      const store = useSkillPipelineStore();
      store.pipelines = [
        pipe("a", { category: "data" }),
        pipe("b", { category: "" }),
        pipe("c", { category: "data" }),
      ];
      const groups = store.pipelinesByCategory;
      expect(groups.data.map((p) => p.id)).toEqual(["a", "c"]);
      expect(groups.custom.map((p) => p.id)).toEqual(["b"]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadPipelines populates on success", async () => {
      const store = useSkillPipelineStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [pipe("a"), pipe("b")],
      });
      await store.loadPipelines();
      expect(mockInvoke).toHaveBeenCalledWith("pipeline:list");
      expect(store.pipelines.map((p) => p.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("loadPipelines records the error on failure", async () => {
      const store = useSkillPipelineStore();
      mockInvoke.mockResolvedValue({ success: false, error: "boom" });
      await store.loadPipelines();
      expect(store.error).toBe("boom");
    });

    it("createPipeline returns the new id and reloads", async () => {
      const store = useSkillPipelineStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { id: "new" } })
        .mockResolvedValueOnce({ success: true, data: [pipe("new")] });
      const id = await store.createPipeline({ name: "x" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "pipeline:create", {
        name: "x",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "pipeline:list");
      expect(id).toBe("new");
    });

    it("createPipeline throws and records the error on failure", async () => {
      const store = useSkillPipelineStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await expect(store.createPipeline({ name: "x" })).rejects.toThrow(
        "denied",
      );
      expect(store.error).toBe("denied");
    });

    it("executePipeline stores the execution status and reloads", async () => {
      const store = useSkillPipelineStore();
      const status = { executionId: "e1", state: "running" };
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: status })
        .mockResolvedValueOnce({ success: true, data: [] });
      const result = await store.executePipeline("p1", { foo: 1 });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "pipeline:execute", {
        pipelineId: "p1",
        context: { foo: 1 },
      });
      expect(store.executionStatus).toEqual(status);
      expect(result).toEqual(status);
      expect(store.loading).toBe(false);
    });

    it("loadTemplates populates templates on success", async () => {
      const store = useSkillPipelineStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [pipe("t", { isTemplate: true })],
      });
      await store.loadTemplates();
      expect(mockInvoke).toHaveBeenCalledWith("pipeline:get-templates");
      expect(store.templates.map((p) => p.id)).toEqual(["t"]);
    });

    it("deletePipeline reloads the list on success", async () => {
      const store = useSkillPipelineStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: [] });
      await store.deletePipeline("p1");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "pipeline:delete", "p1");
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "pipeline:list");
    });
  });
});
