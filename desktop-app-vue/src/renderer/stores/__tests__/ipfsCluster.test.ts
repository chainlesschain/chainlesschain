/**
 * useIPFSClusterStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: onlineNodes (status === 'online') / pinnedItems
 *    (pin_status === 'pinned') / storageUsedPercent (ratio + divide-by-zero guard)
 *  - IPC actions (electronAPI.invoke mocked): loadNodes (populate / error),
 *    addNode (push), removeNode (filter out), pinContent (push), unpinContent
 *    (in-place status update), loadPins (populate), rebalance (chains loadNodes +
 *    loadPins), loadStats (set stats)
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

import { useIPFSClusterStore } from "../ipfsCluster";
import type { ClusterNode, ClusterPin } from "../ipfsCluster";

function node(id: string, status: string): ClusterNode {
  return {
    id,
    peer_id: `peer-${id}`,
    endpoint: "/ip4/1.2.3.4",
    status,
    region: null,
    storage_capacity: 1000,
    storage_used: 100,
    pin_count: 0,
    last_heartbeat: "2026-01-01",
    joined_at: "2026-01-01",
    metadata: {},
  };
}

function pin(id: string, pin_status: string): ClusterPin {
  return {
    id,
    cid: `Qm${id}`,
    name: null,
    replication_factor: 3,
    replication_min: 2,
    current_replicas: 3,
    pin_status,
    allocations: ["a", "b", "c"],
    metadata: {},
    priority: 0,
    expire_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

describe("useIPFSClusterStore", () => {
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
      const store = useIPFSClusterStore();
      expect(store.nodes).toEqual([]);
      expect(store.pins).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.health).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("onlineNodes / pinnedItems filter by status", () => {
      const store = useIPFSClusterStore();
      store.nodes = [
        node("a", "online"),
        node("b", "offline"),
        node("c", "online"),
      ];
      store.pins = [
        pin("p1", "pinned"),
        pin("p2", "pinning"),
        pin("p3", "pinned"),
      ];
      expect(store.onlineNodes.map((n) => n.id)).toEqual(["a", "c"]);
      expect(store.pinnedItems.map((p) => p.id)).toEqual(["p1", "p3"]);
    });

    it("storageUsedPercent computes the ratio and guards divide-by-zero", () => {
      const store = useIPFSClusterStore();
      expect(store.storageUsedPercent).toBe(0); // no stats
      store.stats = {
        totalNodes: 1,
        onlineNodes: 1,
        totalPins: 0,
        pinnedContent: 0,
        totalStorage: 200,
        usedStorage: 50,
        replicationHealth: 1,
      };
      expect(store.storageUsedPercent).toBe(25);
      store.stats = { ...store.stats, totalStorage: 0 };
      expect(store.storageUsedPercent).toBe(0); // guard
    });
  });

  // -------------------------------------------------------------------------
  // Node actions
  // -------------------------------------------------------------------------

  describe("node actions", () => {
    it("loadNodes populates on success", async () => {
      const store = useIPFSClusterStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [node("a", "online"), node("b", "offline")],
      });
      await store.loadNodes({ status: "online" });
      expect(mockInvoke).toHaveBeenCalledWith("ipfs-cluster:list-nodes", {
        status: "online",
      });
      expect(store.nodes.map((n) => n.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("loadNodes records the error on failure", async () => {
      const store = useIPFSClusterStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.loadNodes();
      expect(store.error).toBe("no svc");
    });

    it("addNode pushes the returned node", async () => {
      const store = useIPFSClusterStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: node("n", "online"),
      });
      await store.addNode({ peerId: "p", endpoint: "/ip4/0.0.0.0" });
      expect(store.nodes.map((n) => n.id)).toEqual(["n"]);
    });

    it("removeNode filters out the node on success", async () => {
      const store = useIPFSClusterStore();
      store.nodes = [node("a", "online"), node("b", "online")];
      mockInvoke.mockResolvedValue({ success: true });
      await store.removeNode("a");
      expect(mockInvoke).toHaveBeenCalledWith("ipfs-cluster:remove-node", "a");
      expect(store.nodes.map((n) => n.id)).toEqual(["b"]);
    });
  });

  // -------------------------------------------------------------------------
  // Pin actions + rebalance + stats
  // -------------------------------------------------------------------------

  describe("pin actions + rebalance + stats", () => {
    it("pinContent pushes the new pin", async () => {
      const store = useIPFSClusterStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: pin("p1", "pinning"),
      });
      await store.pinContent({ cid: "Qm..." });
      expect(store.pins.map((p) => p.id)).toEqual(["p1"]);
    });

    it("unpinContent updates the pin status in place", async () => {
      const store = useIPFSClusterStore();
      store.pins = [pin("p1", "pinned")];
      mockInvoke.mockResolvedValue({ success: true });
      await store.unpinContent("p1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "ipfs-cluster:unpin-content",
        "p1",
      );
      expect(store.pins[0].pin_status).toBe("unpinned");
      expect(store.pins[0].current_replicas).toBe(0);
      expect(store.pins[0].allocations).toEqual([]);
    });

    it("rebalance chains loadNodes + loadPins on success", async () => {
      const store = useIPFSClusterStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // rebalance
        .mockResolvedValueOnce({ success: true, data: [node("a", "online")] }) // nodes
        .mockResolvedValueOnce({ success: true, data: [pin("p1", "pinned")] }); // pins
      await store.rebalance();
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "ipfs-cluster:rebalance");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "ipfs-cluster:list-nodes",
        undefined,
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        3,
        "ipfs-cluster:list-pins",
        undefined,
      );
      expect(store.nodes).toHaveLength(1);
      expect(store.pins).toHaveLength(1);
    });

    it("loadStats stores stats on success", async () => {
      const store = useIPFSClusterStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { totalNodes: 5, onlineNodes: 4 },
      });
      await store.loadStats();
      expect(mockInvoke).toHaveBeenCalledWith("ipfs-cluster:get-stats");
      expect(store.stats?.totalNodes).toBe(5);
    });
  });
});
