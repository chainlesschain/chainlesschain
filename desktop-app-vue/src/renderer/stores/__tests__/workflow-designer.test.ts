/**
 * useWorkflowDesignerStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state
 *  - loadWorkflows() populates list
 *  - createWorkflow() triggers refresh, returns new id, rejects on envelope failure
 *  - loadWorkflow() writes currentWorkflow + nodes + edges
 *  - addNode / addConnection return generated id; removeNode prunes edges
 *  - updateNode merges data; updateNodePosition replaces position
 *  - saveWorkflow posts current state via workflow:save
 *  - executeWorkflow fails fast when no current workflow
 *  - loadTemplates populates templates
 *  - importPipeline returns new workflow id
 *  - deleteWorkflow triggers refresh + clears current if matching
 *  - listenToExecution path: ipcRenderer.on wires step handlers
 *  - cleanupListeners unregisters
 *  - Getters: availableSkillNodes / executingNodes / completedNodes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWorkflowDesignerStore } from "../workflow-designer";

describe("useWorkflowDesignerStore", () => {
  let invoke: ReturnType<typeof vi.fn>;
  let ipcOn: ReturnType<typeof vi.fn>;
  let ipcRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = vi.fn();
    ipcOn = vi.fn();
    ipcRemove = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
    (window as unknown as { electron: unknown }).electron = {
      ipcRenderer: { on: ipcOn, removeListener: ipcRemove },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it("initializes with empty collections", () => {
    const store = useWorkflowDesignerStore();
    expect(store.workflows).toEqual([]);
    expect(store.currentWorkflow).toBeNull();
    expect(store.nodes).toEqual([]);
    expect(store.edges).toEqual([]);
    expect(store.selectedNode).toBeNull();
    expect(store.executionState).toBeNull();
    expect(store.debugLog).toEqual([]);
    expect(store.templates).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.nodeStatuses).toEqual({});
  });

  it("loadWorkflows() success populates workflows", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: [{ id: "w1", name: "A" }],
    });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflows();
    expect(store.workflows).toHaveLength(1);
    expect(store.loading).toBe(false);
    expect(invoke).toHaveBeenCalledWith("workflow:list");
  });

  it("createWorkflow() returns new id and refreshes list", async () => {
    invoke
      .mockResolvedValueOnce({ success: true, data: { id: "new-1" } })
      .mockResolvedValueOnce({ success: true, data: [{ id: "new-1" }] });
    const store = useWorkflowDesignerStore();
    const id = await store.createWorkflow({ name: "X" });
    expect(id).toBe("new-1");
    expect(store.workflows).toHaveLength(1);
  });

  it("createWorkflow() throws when envelope failure", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "quota" });
    const store = useWorkflowDesignerStore();
    await expect(store.createWorkflow()).rejects.toThrow("quota");
    expect(store.error).toBe("quota");
  });

  it("loadWorkflow() writes currentWorkflow + copies nodes/edges", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: {
        id: "w1",
        name: "n",
        nodes: [
          { id: "n1", type: "skill", position: { x: 0, y: 0 }, data: {} },
        ],
        edges: [{ id: "e1", source: "n1", target: "n2" }],
      },
    });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    expect(store.currentWorkflow?.id).toBe("w1");
    expect(store.nodes).toHaveLength(1);
    expect(store.edges).toHaveLength(1);
    expect(store.loading).toBe(false);
  });

  it("addNode generates id when not provided + appends", () => {
    const store = useWorkflowDesignerStore();
    const id1 = store.addNode({ type: "skill" });
    const id2 = store.addNode({ id: "fixed", type: "start" });
    expect(id1).toMatch(/^node-/);
    expect(id2).toBe("fixed");
    expect(store.nodes).toHaveLength(2);
    expect(store.nodes[0].position).toEqual({ x: 250, y: 200 });
  });

  it("addConnection creates an edge with generated id", () => {
    const store = useWorkflowDesignerStore();
    const id = store.addConnection({ source: "a", target: "b" });
    expect(id).toMatch(/^edge-/);
    expect(store.edges).toHaveLength(1);
    expect(store.edges[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("removeNode drops node + any touching edges", () => {
    const store = useWorkflowDesignerStore();
    store.addNode({ id: "a", type: "skill" });
    store.addNode({ id: "b", type: "skill" });
    store.addConnection({ id: "e1", source: "a", target: "b" });
    store.addConnection({ id: "e2", source: "b", target: "c" });
    store.removeNode("a");
    expect(store.nodes.map((n) => n.id)).toEqual(["b"]);
    expect(store.edges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("updateNode merges new data keys", () => {
    const store = useWorkflowDesignerStore();
    store.addNode({ id: "a", type: "skill", data: { k: 1 } });
    store.updateNode("a", { extra: "v" });
    expect(store.nodes[0].data).toEqual({ k: 1, extra: "v" });
  });

  it("updateNodePosition replaces the node position", () => {
    const store = useWorkflowDesignerStore();
    store.addNode({ id: "a", type: "skill" });
    store.updateNodePosition("a", { x: 99, y: 99 });
    expect(store.nodes[0].position).toEqual({ x: 99, y: 99 });
  });

  it("saveWorkflow is a no-op without currentWorkflow", async () => {
    const store = useWorkflowDesignerStore();
    await store.saveWorkflow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("saveWorkflow posts current state through workflow:save", async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "w1",
          name: "n",
          description: "d",
          variables: {},
          nodes: [],
          edges: [],
        },
      })
      .mockResolvedValueOnce({ success: true });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    store.addNode({ id: "a", type: "skill" });
    await store.saveWorkflow();
    const last = invoke.mock.calls.at(-1);
    expect(last?.[0]).toBe("workflow:save");
    expect(last?.[1]).toMatchObject({
      workflowId: "w1",
      updates: expect.objectContaining({ nodes: expect.any(Array) }),
    });
  });

  it("executeWorkflow no-ops without currentWorkflow", async () => {
    const store = useWorkflowDesignerStore();
    await store.executeWorkflow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("executeWorkflow success stores executionState + wires listeners", async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "w1",
          nodes: [
            { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
            { id: "a", type: "skill", position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          executionId: "run1",
          state: "completed",
          currentStepIndex: 0,
          totalSteps: 1,
          stepResults: [],
          duration: 5,
        },
      });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    await store.executeWorkflow({ input: 1 });
    expect(store.executionState?.executionId).toBe("run1");
    expect(ipcOn).toHaveBeenCalledWith(
      "workflow:step:started",
      expect.any(Function),
    );
    // Non-start/end nodes start in 'pending'
    expect(store.nodeStatuses.a).toBe("pending");
  });

  it("listenToExecution step handlers mark node status", async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "w1",
          nodes: [
            { id: "a", type: "skill", position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          executionId: "r",
          state: "running",
          currentStepIndex: 0,
          totalSteps: 1,
          stepResults: [],
          duration: 0,
        },
      });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    await store.executeWorkflow();
    const startedCall = ipcOn.mock.calls.find(
      (c) => c[0] === "workflow:step:started",
    );
    const completedCall = ipcOn.mock.calls.find(
      (c) => c[0] === "workflow:step:completed",
    );
    const failedCall = ipcOn.mock.calls.find(
      (c) => c[0] === "workflow:step:failed",
    );
    startedCall?.[1](null, { nodeId: "a" });
    expect(store.nodeStatuses.a).toBe("running");
    completedCall?.[1](null, { nodeId: "a" });
    expect(store.nodeStatuses.a).toBe("completed");
    failedCall?.[1](null, { nodeId: "a" });
    expect(store.nodeStatuses.a).toBe("failed");
  });

  it("cleanupListeners removes each registered handler", async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: { id: "w1", nodes: [], edges: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          executionId: "r",
          state: "ok",
          currentStepIndex: 0,
          totalSteps: 0,
          stepResults: [],
          duration: 0,
        },
      });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    await store.executeWorkflow();
    store.cleanupListeners();
    expect(ipcRemove).toHaveBeenCalledWith(
      "workflow:step:started",
      expect.any(Function),
    );
  });

  it("loadTemplates populates templates", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: [{ id: "t1", name: "T" }],
    });
    const store = useWorkflowDesignerStore();
    await store.loadTemplates();
    expect(store.templates).toHaveLength(1);
  });

  it("importPipeline returns new workflowId + refreshes list", async () => {
    invoke
      .mockResolvedValueOnce({ success: true, data: { workflowId: "w-imp" } })
      .mockResolvedValueOnce({ success: true, data: [] });
    const store = useWorkflowDesignerStore();
    const id = await store.importPipeline("p1");
    expect(id).toBe("w-imp");
  });

  it("importPipeline returns null on envelope failure", async () => {
    invoke.mockResolvedValueOnce({ success: false });
    const store = useWorkflowDesignerStore();
    const id = await store.importPipeline("p1");
    expect(id).toBeNull();
  });

  it("exportPipeline returns null without currentWorkflow", async () => {
    const store = useWorkflowDesignerStore();
    expect(await store.exportPipeline()).toBeNull();
  });

  it("exportPipeline returns data on success", async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: { id: "w1", nodes: [], edges: [] },
      })
      .mockResolvedValueOnce({ success: true, data: { schema: "v1" } });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    expect(await store.exportPipeline()).toEqual({ schema: "v1" });
  });

  it("deleteWorkflow clears current if matching and refreshes", async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: { id: "w1", nodes: [], edges: [] },
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: [] });
    const store = useWorkflowDesignerStore();
    await store.loadWorkflow("w1");
    await store.deleteWorkflow("w1");
    expect(store.currentWorkflow).toBeNull();
    expect(store.nodes).toEqual([]);
  });

  it("availableSkillNodes getter filters to type='skill'", () => {
    const store = useWorkflowDesignerStore();
    store.addNode({ id: "s", type: "start" });
    store.addNode({ id: "a", type: "skill" });
    store.addNode({ id: "b", type: "skill" });
    expect(store.availableSkillNodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("completedNodes getter reads stepResults.stepName", async () => {
    const store = useWorkflowDesignerStore();
    store.executionState = {
      executionId: "r",
      state: "ok",
      currentStepIndex: 0,
      totalSteps: 0,
      stepResults: [{ stepName: "a" }, { stepName: "b" }],
      duration: 0,
    };
    expect(store.completedNodes).toEqual(["a", "b"]);
  });
});
