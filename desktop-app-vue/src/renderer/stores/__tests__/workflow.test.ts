/**
 * useWorkflowStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: runningWorkflows / completedWorkflows / failedWorkflows /
 *    isCurrentRunning / isCurrentPaused / currentProgress
 *  - IPC actions (window.ipc.invoke stubbed): loadWorkflows (populate),
 *    createWorkflow (reload on success), deleteWorkflow (clears current when it
 *    matches), selectWorkflow(null) (clears current), pauseWorkflow,
 *    createAndStartWorkflow (records currentWorkflowId)
 *
 * NB: setup-style store calling (window as any).ipc.invoke directly and using
 * ant-design-vue's `message`, which we mock to keep tests headless.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { useWorkflowStore } from "../workflow";
import type { Workflow, WorkflowStatus } from "../workflow";

const mockInvoke = vi.fn();

function wf(workflowId: string, status: WorkflowStatus, percent = 0): Workflow {
  return {
    workflowId,
    name: `WF ${workflowId}`,
    overall: { status, percent },
  };
}

describe("useWorkflowStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true, data: [] });
    (window as any).ipc = { invoke: mockInvoke, on: vi.fn(), off: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).ipc;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useWorkflowStore();
      expect(store.workflows).toEqual([]);
      expect(store.currentWorkflowId).toBeNull();
      expect(store.currentWorkflow).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.recentLogs).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("running/completed/failed split workflows by overall.status", () => {
      const store = useWorkflowStore();
      store.workflows = [
        wf("a", "running"),
        wf("b", "completed"),
        wf("c", "failed"),
        wf("d", "running"),
      ];
      expect(store.runningWorkflows.map((w) => w.workflowId)).toEqual([
        "a",
        "d",
      ]);
      expect(store.completedWorkflows.map((w) => w.workflowId)).toEqual(["b"]);
      expect(store.failedWorkflows.map((w) => w.workflowId)).toEqual(["c"]);
    });

    it("isCurrentRunning / isCurrentPaused reflect currentWorkflow", () => {
      const store = useWorkflowStore();
      expect(store.isCurrentRunning).toBe(false);
      expect(store.isCurrentPaused).toBe(false);
      store.currentWorkflow = wf("a", "running");
      expect(store.isCurrentRunning).toBe(true);
      expect(store.isCurrentPaused).toBe(false);
      store.currentWorkflow = wf("a", "paused");
      expect(store.isCurrentRunning).toBe(false);
      expect(store.isCurrentPaused).toBe(true);
    });

    it("currentProgress reads overall.percent, defaulting to 0", () => {
      const store = useWorkflowStore();
      expect(store.currentProgress).toBe(0);
      store.currentWorkflow = wf("a", "running", 42);
      expect(store.currentProgress).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadWorkflows populates the list on success", async () => {
      const store = useWorkflowStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [wf("a", "running"), wf("b", "completed")],
      });
      await store.loadWorkflows();
      expect(mockInvoke).toHaveBeenCalledWith("workflow:get-all");
      expect(store.workflows.map((w) => w.workflowId)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("createWorkflow reloads the list and returns the new workflow", async () => {
      const store = useWorkflowStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: wf("new", "pending") })
        .mockResolvedValueOnce({ success: true, data: [wf("new", "pending")] });
      const created = await store.createWorkflow({ name: "x" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "workflow:create", {
        name: "x",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "workflow:get-all");
      expect(created?.workflowId).toBe("new");
      expect(store.workflows.map((w) => w.workflowId)).toEqual(["new"]);
    });

    it("createWorkflow returns null on failure", async () => {
      const store = useWorkflowStore();
      mockInvoke.mockResolvedValue({ success: false, error: "nope" });
      const created = await store.createWorkflow({ name: "x" });
      expect(created).toBeNull();
    });

    it("deleteWorkflow clears current selection when it matches", async () => {
      const store = useWorkflowStore();
      store.currentWorkflowId = "a";
      store.currentWorkflow = wf("a", "running");
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, data: [] });
      await store.deleteWorkflow("a");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "workflow:delete", {
        workflowId: "a",
      });
      expect(store.currentWorkflowId).toBeNull();
      expect(store.currentWorkflow).toBeNull();
    });

    it("selectWorkflow(null) clears the current workflow without IPC", async () => {
      const store = useWorkflowStore();
      store.currentWorkflow = wf("a", "running");
      await store.selectWorkflow(null);
      expect(store.currentWorkflowId).toBeNull();
      expect(store.currentWorkflow).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Control actions (pass-through IPC)
  // -------------------------------------------------------------------------

  describe("control actions", () => {
    it("pauseWorkflow forwards the id and returns the result", async () => {
      const store = useWorkflowStore();
      mockInvoke.mockResolvedValue({ success: true });
      const result = await store.pauseWorkflow("a");
      expect(mockInvoke).toHaveBeenCalledWith("workflow:pause", {
        workflowId: "a",
      });
      expect(result.success).toBe(true);
    });

    it("startWorkflow passes through the IPC result on failure", async () => {
      const store = useWorkflowStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      const result = await store.startWorkflow("a", { foo: 1 });
      expect(mockInvoke).toHaveBeenCalledWith("workflow:start", {
        workflowId: "a",
        input: { foo: 1 },
        context: {},
      });
      expect(result).toEqual({ success: false, error: "denied" });
    });

    it("createAndStartWorkflow records the new id and reloads", async () => {
      const store = useWorkflowStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { workflowId: "n1" } })
        .mockResolvedValueOnce({ success: true, data: [wf("n1", "running")] });
      const result = await store.createAndStartWorkflow({ name: "x" });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "workflow:create-and-start",
        { name: "x" },
      );
      expect(result?.workflowId).toBe("n1");
      expect(store.currentWorkflowId).toBe("n1");
    });
  });
});
