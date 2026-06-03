/**
 * useDeploymentStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activePipelines (running/paused) / pendingGates (nested
 *    gate_pending scan) / pipelineById (parametric)
 *  - IPC actions (window.electronAPI.invoke mocked): createPipeline (chains
 *    getAllPipelines), getAllPipelines (populate), getStatus (set current +
 *    in-place update), startPipeline (chains getStatus), approveGate (chains
 *    getStatus), getMetrics / getTemplates (populate)
 *  - Pure action: reset
 *
 * NB: store calls (window as any).electronAPI.invoke directly, so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useDeploymentStore } from "../deployment";
import type { Pipeline, PipelineStage } from "../deployment";

const mockInvoke = vi.fn();

function stage(id: string, status: PipelineStage["status"]): PipelineStage {
  return { id, name: `S ${id}`, type: "build", status };
}

function pipeline(
  id: string,
  status: Pipeline["status"],
  stages: PipelineStage[] = [],
): Pipeline {
  return {
    id,
    name: `P ${id}`,
    status,
    stages,
    config: {},
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

describe("useDeploymentStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
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
      const store = useDeploymentStore();
      expect(store.currentPipeline).toBeNull();
      expect(store.pipelines).toEqual([]);
      expect(store.templates).toEqual([]);
      expect(store.metrics).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activePipelines keeps running + paused", () => {
      const store = useDeploymentStore();
      store.pipelines = [
        pipeline("a", "running"),
        pipeline("b", "success"),
        pipeline("c", "paused"),
        pipeline("d", "failed"),
      ];
      expect(store.activePipelines.map((p) => p.id)).toEqual(["a", "c"]);
    });

    it("pendingGates collects every gate_pending stage with its pipeline", () => {
      const store = useDeploymentStore();
      store.pipelines = [
        pipeline("a", "running", [
          stage("s1", "success"),
          stage("s2", "gate_pending"),
        ]),
        pipeline("b", "running", [stage("s3", "gate_pending")]),
      ];
      const gates = store.pendingGates;
      expect(gates).toHaveLength(2);
      expect(gates.map((g) => `${g.pipeline.id}:${g.stage.id}`)).toEqual([
        "a:s2",
        "b:s3",
      ]);
    });

    it("pipelineById finds by id", () => {
      const store = useDeploymentStore();
      store.pipelines = [pipeline("a", "running"), pipeline("b", "paused")];
      expect(store.pipelineById("b")?.name).toBe("P b");
      expect(store.pipelineById("z")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("createPipeline chains getAllPipelines on success", async () => {
      const store = useDeploymentStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // create
        .mockResolvedValueOnce({
          success: true,
          data: [pipeline("n", "pending")],
        }); // get-all
      await store.createPipeline({ name: "n" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "dev-pipeline:create", {
        name: "n",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "dev-pipeline:get-all");
      expect(store.pipelines.map((p) => p.id)).toEqual(["n"]);
    });

    it("getAllPipelines populates the list", async () => {
      const store = useDeploymentStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [pipeline("a", "running"), pipeline("b", "success")],
      });
      await store.getAllPipelines();
      expect(store.pipelines.map((p) => p.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("getStatus sets currentPipeline and updates the list entry in place", async () => {
      const store = useDeploymentStore();
      store.pipelines = [pipeline("a", "running"), pipeline("b", "running")];
      mockInvoke.mockResolvedValue({
        success: true,
        data: pipeline("a", "success"),
      });
      await store.getStatus("a");
      expect(mockInvoke).toHaveBeenCalledWith("dev-pipeline:get-status", "a");
      expect(store.currentPipeline?.status).toBe("success");
      expect(store.pipelineById("a")?.status).toBe("success");
      expect(store.pipelineById("b")?.status).toBe("running");
    });

    it("startPipeline chains getStatus on success", async () => {
      const store = useDeploymentStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // start
        .mockResolvedValueOnce({
          success: true,
          data: pipeline("a", "running"),
        }); // get-status
      await store.startPipeline("a");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "dev-pipeline:start", "a");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "dev-pipeline:get-status",
        "a",
      );
    });

    it("approveGate forwards id + stageId and refreshes status", async () => {
      const store = useDeploymentStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // approve
        .mockResolvedValueOnce({
          success: true,
          data: pipeline("a", "running"),
        }); // get-status
      await store.approveGate("a", "s2");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "dev-pipeline:approve-gate",
        "a",
        "s2",
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "dev-pipeline:get-status",
        "a",
      );
    });

    it("getMetrics + getTemplates populate their slices", async () => {
      const store = useDeploymentStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: {
          totalRuns: 5,
          successRate: 0.8,
          avgDuration: 100,
          failuresByStage: {},
        },
      });
      await store.getMetrics();
      expect(store.metrics?.totalRuns).toBe(5);

      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [{ id: "t1", name: "CI", description: "", stages: [] }],
      });
      await store.getTemplates();
      expect(store.templates.map((t) => t.id)).toEqual(["t1"]);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("clears pipelines, templates, metrics and current", () => {
      const store = useDeploymentStore();
      store.currentPipeline = pipeline("a", "running");
      store.pipelines = [pipeline("a", "running")];
      store.templates = [{ id: "t", name: "x", description: "", stages: [] }];
      store.metrics = {
        totalRuns: 1,
        successRate: 1,
        avgDuration: 1,
        failuresByStage: {},
      };
      store.reset();
      expect(store.currentPipeline).toBeNull();
      expect(store.pipelines).toEqual([]);
      expect(store.templates).toEqual([]);
      expect(store.metrics).toBeNull();
    });
  });
});
