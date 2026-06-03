/**
 * useInferenceNetworkStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: onlineNodes (status === 'online') / nodeCount
 *  - IPC actions (electronAPI.invoke mocked): registerNode (chains fetchNodes),
 *    fetchNodes (populate), submitTask (pass-through), getTaskStatus (pass-through),
 *    startFederatedRound (pass-through), fetchNetworkStats (store whole result)
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

import { useInferenceNetworkStore } from "../inferenceNetwork";

describe("useInferenceNetworkStore", () => {
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
      const store = useInferenceNetworkStore();
      expect(store.nodes).toEqual([]);
      expect(store.tasks).toEqual([]);
      expect(store.networkStats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("onlineNodes filters status === 'online'; nodeCount counts all", () => {
      const store = useInferenceNetworkStore();
      store.nodes = [
        { id: "a", status: "online" },
        { id: "b", status: "offline" },
        { id: "c", status: "online" },
      ];
      expect(store.onlineNodes.map((n: any) => n.id)).toEqual(["a", "c"]);
      expect(store.nodeCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("registerNode chains fetchNodes on success", async () => {
      const store = useInferenceNetworkStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // register
        .mockResolvedValueOnce({
          success: true,
          nodes: [{ id: "a", status: "online" }],
        }); // list
      await store.registerNode({ gpu: "a100" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "inference:register-node", {
        gpu: "a100",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "inference:list-nodes",
        undefined,
      );
      expect(store.nodes).toHaveLength(1);
      expect(store.loading).toBe(false);
    });

    it("fetchNodes populates on success", async () => {
      const store = useInferenceNetworkStore();
      mockInvoke.mockResolvedValue({
        success: true,
        nodes: [{ id: "a" }, { id: "b" }],
      });
      await store.fetchNodes({ region: "us" });
      expect(mockInvoke).toHaveBeenCalledWith("inference:list-nodes", {
        region: "us",
      });
      expect(store.nodes).toHaveLength(2);
    });

    it("submitTask + getTaskStatus pass results through", async () => {
      const store = useInferenceNetworkStore();
      mockInvoke.mockResolvedValueOnce({ success: true, taskId: "t1" });
      expect(await store.submitTask({ model: "llama" })).toEqual({
        success: true,
        taskId: "t1",
      });
      expect(mockInvoke).toHaveBeenLastCalledWith("inference:submit-task", {
        model: "llama",
      });

      mockInvoke.mockResolvedValueOnce({ success: true, status: "running" });
      expect(await store.getTaskStatus("t1")).toEqual({
        success: true,
        status: "running",
      });
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "inference:get-task-status",
        "t1",
      );
    });

    it("startFederatedRound passes the result through", async () => {
      const store = useInferenceNetworkStore();
      mockInvoke.mockResolvedValue({ success: true, round: 3 });
      const result = await store.startFederatedRound({ taskId: "t1" });
      expect(mockInvoke).toHaveBeenCalledWith(
        "inference:start-federated-round",
        { taskId: "t1" },
      );
      expect(result).toEqual({ success: true, round: 3 });
    });

    it("fetchNetworkStats stores the whole result on success", async () => {
      const store = useInferenceNetworkStore();
      mockInvoke.mockResolvedValue({
        success: true,
        totalNodes: 10,
        onlineNodes: 7,
      });
      await store.fetchNetworkStats();
      expect(mockInvoke).toHaveBeenCalledWith("inference:get-network-stats");
      expect(store.networkStats).toMatchObject({
        totalNodes: 10,
        onlineNodes: 7,
      });
    });
  });
});
