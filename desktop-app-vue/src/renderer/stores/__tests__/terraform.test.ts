/**
 * useTerraformStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeWorkspaces (status === 'active') / recentRuns (slice 10) /
 *    totalResources (sum of resources_added)
 *  - IPC actions (electronAPI.invoke mocked): fetchWorkspaces (populate / error),
 *    createWorkspace (chains fetchWorkspaces), planRun (chains fetchRuns),
 *    fetchRuns (populate)
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

import { useTerraformStore } from "../terraform";
import type { TerraformWorkspace, TerraformRun } from "../terraform";

function workspace(id: string, status: string): TerraformWorkspace {
  return {
    id,
    name: `W ${id}`,
    description: "",
    terraform_version: "1.7",
    working_directory: "/tf",
    auto_apply: 0,
    status,
    last_run_id: null,
    last_run_at: null,
    state_version: 1,
    variables: {},
    providers: ["aws"],
    created_at: 1700000000000,
  };
}

function run(id: string, resources_added: number): TerraformRun {
  return {
    id,
    workspace_id: "w1",
    run_type: "plan",
    status: "complete",
    plan_output: null,
    apply_output: null,
    resources_added,
    resources_changed: 0,
    resources_destroyed: 0,
    triggered_by: "user",
    started_at: null,
    completed_at: null,
    error_message: null,
  };
}

describe("useTerraformStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useTerraformStore();
      expect(store.workspaces).toEqual([]);
      expect(store.runs).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeWorkspaces filters status === 'active'", () => {
      const store = useTerraformStore();
      store.workspaces = [
        workspace("a", "active"),
        workspace("b", "archived"),
        workspace("c", "active"),
      ];
      expect(store.activeWorkspaces.map((w) => w.id)).toEqual(["a", "c"]);
    });

    it("recentRuns returns the first 10; totalResources sums resources_added", () => {
      const store = useTerraformStore();
      store.runs = Array.from({ length: 12 }, (_, i) => run(`r${i}`, 1));
      expect(store.recentRuns).toHaveLength(10);
      expect(store.recentRuns[0].id).toBe("r0");
      expect(store.totalResources).toBe(12);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchWorkspaces populates on success", async () => {
      const store = useTerraformStore();
      mockInvoke.mockResolvedValue({
        success: true,
        workspaces: [workspace("a", "active"), workspace("b", "archived")],
      });
      await store.fetchWorkspaces({ status: "active" });
      expect(mockInvoke).toHaveBeenCalledWith("terraform:list-workspaces", {
        status: "active",
      });
      expect(store.workspaces.map((w) => w.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchWorkspaces records the error on failure", async () => {
      const store = useTerraformStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchWorkspaces();
      expect(store.error).toBe("no svc");
    });

    it("createWorkspace chains fetchWorkspaces on success", async () => {
      const store = useTerraformStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // create
        .mockResolvedValueOnce({
          success: true,
          workspaces: [workspace("n", "active")],
        }); // list
      await store.createWorkspace("n", "desc", "1.7", ["aws"]);
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "terraform:create-workspace",
        {
          name: "n",
          description: "desc",
          terraformVersion: "1.7",
          providers: ["aws"],
        },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "terraform:list-workspaces",
        undefined,
      );
      expect(store.workspaces.map((w) => w.id)).toEqual(["n"]);
    });

    it("planRun chains fetchRuns for the workspace", async () => {
      const store = useTerraformStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // plan
        .mockResolvedValueOnce({ success: true, runs: [run("r1", 3)] }); // list-runs
      await store.planRun("w1", "plan", "user");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "terraform:plan-run", {
        workspaceId: "w1",
        runType: "plan",
        triggeredBy: "user",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "terraform:list-runs", {
        workspaceId: "w1",
        limit: undefined,
      });
      expect(store.runs).toHaveLength(1);
    });

    it("fetchRuns populates the run list", async () => {
      const store = useTerraformStore();
      mockInvoke.mockResolvedValue({
        success: true,
        runs: [run("r1", 1), run("r2", 2)],
      });
      await store.fetchRuns("w1", 20);
      expect(mockInvoke).toHaveBeenCalledWith("terraform:list-runs", {
        workspaceId: "w1",
        limit: 20,
      });
      expect(store.runs).toHaveLength(2);
    });
  });
});
