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
 * NB: the fixed workflowManager preload capability and ant-design-vue's
 * `message` are mocked to keep tests headless.
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
const mockOn = vi.fn((_channel: string, _handler: any) => vi.fn());

const workflowManager = {
  getAll: () => mockInvoke("workflow:get-all"),
  create: (options: any) => mockInvoke("workflow:create", options),
  createAndStart: (options: any) =>
    mockInvoke("workflow:create-and-start", options),
  start: (workflowId: string, input: any, context: any) =>
    mockInvoke("workflow:start", { workflowId, input, context }),
  pause: (workflowId: string) => mockInvoke("workflow:pause", { workflowId }),
  resume: (workflowId: string) => mockInvoke("workflow:resume", { workflowId }),
  cancel: (workflowId: string, reason: string) =>
    mockInvoke("workflow:cancel", { workflowId, reason }),
  retry: (workflowId: string) => mockInvoke("workflow:retry", { workflowId }),
  delete: (workflowId: string) => mockInvoke("workflow:delete", { workflowId }),
  getStatus: (workflowId: string) =>
    mockInvoke("workflow:get-status", { workflowId }),
  overrideGate: (workflowId: string, gateId: string, reason: string) =>
    mockInvoke("workflow:override-gate", { workflowId, gateId, reason }),
  onProgress: (handler: any) => mockOn("workflow:progress", handler),
  onComplete: (handler: any) => mockOn("workflow:complete", handler),
  onError: (handler: any) => mockOn("workflow:error", handler),
};

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
    mockOn.mockClear();
    (window as any).electronAPI = { workflowManager };
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

    it("retains reconciliation authority when cancellation cannot be proven", async () => {
      const store = useWorkflowStore();
      store.currentWorkflowId = "canonical";
      store.currentWorkflow = wf("canonical", "running");
      mockInvoke.mockResolvedValueOnce({
        success: false,
        code: "CC_GRAPH_RECONCILIATION_REQUIRED",
        reconciliationRequired: true,
        error: "Graph effect outcome requires reconciliation",
        data: {
          workflowId: "canonical",
          overall: { status: "reconciliation_required", percent: 0 },
          authoritySource: "graph_kernel",
          graphAuthority: { status: "reconciliation_required" },
          reconciliationRequired: true,
        },
      });

      const result = await store.cancelWorkflow("canonical", "stop");

      expect(mockInvoke).toHaveBeenCalledWith("workflow:cancel", {
        workflowId: "canonical",
        reason: "stop",
      });
      expect(result).toMatchObject({
        success: false,
        reconciliationRequired: true,
      });
      expect(store.currentWorkflow).toMatchObject({
        overall: { status: "reconciliation_required" },
        authoritySource: "graph_kernel",
        reconciliationRequired: true,
      });
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

    it("retains canonical writer and reconciliation fields from status", async () => {
      const store = useWorkflowStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: {
          workflowId: "canonical",
          authorityMode: "canonical",
          authoritySource: "graph_kernel",
          graphRunId: "desktop-workflow:canonical",
          graphAuthority: {
            authorityGeneration: 4,
            writerId: "desktop-workflow-writer",
            eventHead: `sha256:${"a".repeat(64)}`,
            projectionVersion: 1,
          },
          reconciliationRequired: true,
        },
      });

      await store.selectWorkflow("canonical");

      expect(mockInvoke).toHaveBeenCalledWith("workflow:get-status", {
        workflowId: "canonical",
      });
      expect(store.currentWorkflow).toMatchObject({
        authorityMode: "canonical",
        authoritySource: "graph_kernel",
        graphRunId: "desktop-workflow:canonical",
        graphAuthority: {
          authorityGeneration: 4,
          writerId: "desktop-workflow-writer",
        },
        reconciliationRequired: true,
      });
    });
  });
});
