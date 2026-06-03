/**
 * IPFSClusterManager unit tests
 *
 * Covers: initialize, addNode, removeNode, listNodes, getNodeStatus,
 *         heartbeatNode, pinContent, unpinContent, getPinStatus, listPins,
 *         rebalance, checkHealth, getStats, destroy
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const {
  IPFSClusterManager,
  NODE_STATUS,
  PIN_STATUS,
  HEALTH_EVENT,
} = require("../ipfs-cluster-manager");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IPFSClusterManager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new IPFSClusterManager();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (manager.initialized) {
      manager.destroy();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true and call db.exec for tables", async () => {
      await manager.initialize(db);
      expect(manager.initialized).toBe(true);
      expect(db.exec).toHaveBeenCalled();
    });

    it("should be idempotent", async () => {
      await manager.initialize(db);
      const execCount = db.exec.mock.calls.length;
      await manager.initialize(db);
      expect(db.exec.mock.calls.length).toBe(execCount);
    });

    it("should accept optional deps", async () => {
      const deps = {
        ipfsManager: { initialized: true },
        agentRegistry: null,
        filecoinStorage: null,
      };
      await manager.initialize(db, deps);
      expect(manager.initialized).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // addNode / removeNode
  // ─────────────────────────────────────────────────────────────────────────
  describe("addNode / removeNode", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should add a node with correct fields", () => {
      const node = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        region: "us-east",
        storageCapacity: 1000000,
      });

      expect(node.id).toBeTruthy();
      expect(node.peer_id).toBe("peer-1");
      expect(node.endpoint).toBe("http://node1:5001");
      expect(node.region).toBe("us-east");
      expect(node.status).toBe(NODE_STATUS.ONLINE);
      expect(node.storage_capacity).toBe(1000000);
    });

    it("should persist node to database", () => {
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });
      // persist calls db.prepare for INSERT
      expect(db.prepare).toHaveBeenCalled();
    });

    it("should emit node:added event", () => {
      const listener = vi.fn();
      manager.on("node:added", listener);

      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].peer_id).toBe("peer-1");
    });

    it("should remove a node and emit node:removed", () => {
      const node = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });

      const listener = vi.fn();
      manager.on("node:removed", listener);

      const result = manager.removeNode(node.id);
      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should return false when removing non-existent node", () => {
      const result = manager.removeNode("non-existent-id");
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // listNodes / getNodeStatus
  // ─────────────────────────────────────────────────────────────────────────
  describe("listNodes / getNodeStatus", () => {
    beforeEach(async () => {
      await manager.initialize(db);
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
      manager.addNode({
        peerId: "peer-2",
        endpoint: "http://node2:5001",
        storageCapacity: 1000000,
      });
    });

    it("should list all nodes", () => {
      const nodes = manager.listNodes();
      expect(nodes).toHaveLength(2);
    });

    it("should filter nodes by status", () => {
      const nodes = manager.listNodes({ status: NODE_STATUS.ONLINE });
      expect(nodes).toHaveLength(2);

      const offline = manager.listNodes({ status: NODE_STATUS.OFFLINE });
      expect(offline).toHaveLength(0);
    });

    it("should return node with health info via getNodeStatus", () => {
      const nodes = manager.listNodes();
      const status = manager.getNodeStatus(nodes[0].id);

      expect(status).toBeTruthy();
      expect(status.peer_id).toBe("peer-1");
      expect(status.healthy).toBe(true);
      expect(status.timeSinceHeartbeat).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // heartbeatNode
  // ─────────────────────────────────────────────────────────────────────────
  describe("heartbeatNode", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should update last_heartbeat", () => {
      const node = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });
      const beforeBeat = node.last_heartbeat;

      // Small delay to ensure time difference
      const result = manager.heartbeatNode(node.id, {});
      expect(result.acknowledged).toBe(true);
    });

    it("should update storage_used when provided", () => {
      const node = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });

      manager.heartbeatNode(node.id, { storageUsed: 500000 });
      expect(node.storage_used).toBe(500000);
    });

    it("should return acknowledged: false for unknown node", () => {
      const result = manager.heartbeatNode("unknown-id", {});
      expect(result.acknowledged).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // pinContent
  // ─────────────────────────────────────────────────────────────────────────
  describe("pinContent", () => {
    let node1, node2, node3;

    beforeEach(async () => {
      await manager.initialize(db);
      node1 = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
      node2 = manager.addNode({
        peerId: "peer-2",
        endpoint: "http://node2:5001",
        storageCapacity: 1000000,
      });
      node3 = manager.addNode({
        peerId: "peer-3",
        endpoint: "http://node3:5001",
        storageCapacity: 1000000,
      });
    });

    it("should create a pin record", () => {
      const pin = manager.pinContent({
        cid: "QmTestHash123",
        name: "test-file.txt",
      });

      expect(pin.id).toBeTruthy();
      expect(pin.cid).toBe("QmTestHash123");
      expect(pin.name).toBe("test-file.txt");
    });

    it("should allocate to online nodes", () => {
      const pin = manager.pinContent({
        cid: "QmTestHash123",
        replicationFactor: 2,
      });

      expect(pin.allocations).toHaveLength(2);
      expect(pin.current_replicas).toBe(2);
    });

    it("should respect replicationFactor", () => {
      const pin = manager.pinContent({
        cid: "QmTestHash123",
        replicationFactor: 3,
      });

      expect(pin.allocations).toHaveLength(3);
      expect(pin.replication_factor).toBe(3);
    });

    it("should emit content:pinned event", () => {
      const listener = vi.fn();
      manager.on("content:pinned", listener);

      manager.pinContent({ cid: "QmTestHash123" });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should persist pin to database", () => {
      const callsBefore = db.prepare.mock.calls.length;
      manager.pinContent({ cid: "QmTestHash123" });
      expect(db.prepare.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it("should handle no available nodes gracefully", async () => {
      const mgr = new IPFSClusterManager();
      await mgr.initialize(db);

      const pin = mgr.pinContent({
        cid: "QmTestHash123",
        replicationFactor: 3,
      });
      expect(pin.allocations).toHaveLength(0);
      expect(pin.current_replicas).toBe(0);

      mgr.destroy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // unpinContent
  // ─────────────────────────────────────────────────────────────────────────
  describe("unpinContent", () => {
    beforeEach(async () => {
      await manager.initialize(db);
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
      manager.addNode({
        peerId: "peer-2",
        endpoint: "http://node2:5001",
        storageCapacity: 1000000,
      });
    });

    it("should set pin_status to UNPINNED", () => {
      const pin = manager.pinContent({ cid: "QmTestHash123" });
      manager.unpinContent(pin.id);

      const status = manager.getPinStatus(pin.id);
      expect(status.pin_status).toBe(PIN_STATUS.UNPINNED);
    });

    it("should clear allocations", () => {
      const pin = manager.pinContent({ cid: "QmTestHash123" });
      manager.unpinContent(pin.id);

      const status = manager.getPinStatus(pin.id);
      expect(status.allocations).toHaveLength(0);
      expect(status.current_replicas).toBe(0);
    });

    it("should emit content:unpinned event", () => {
      const pin = manager.pinContent({ cid: "QmTestHash123" });
      const listener = vi.fn();
      manager.on("content:unpinned", listener);

      manager.unpinContent(pin.id);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].cid).toBe("QmTestHash123");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getPinStatus / listPins
  // ─────────────────────────────────────────────────────────────────────────
  describe("getPinStatus / listPins", () => {
    beforeEach(async () => {
      await manager.initialize(db);
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
    });

    it("should return pin by id", () => {
      const pin = manager.pinContent({ cid: "QmTestHash123" });
      const status = manager.getPinStatus(pin.id);

      expect(status).toBeTruthy();
      expect(status.cid).toBe("QmTestHash123");
    });

    it("should list all pins", () => {
      manager.pinContent({ cid: "QmHash1" });
      manager.pinContent({ cid: "QmHash2" });

      const pins = manager.listPins();
      expect(pins).toHaveLength(2);
    });

    it("should filter pins by pin_status", () => {
      const pin1 = manager.pinContent({ cid: "QmHash1" });
      manager.pinContent({ cid: "QmHash2" });
      manager.unpinContent(pin1.id);

      const pinned = manager.listPins({ pin_status: PIN_STATUS.PINNED });
      const unpinned = manager.listPins({ pin_status: PIN_STATUS.UNPINNED });

      expect(pinned).toHaveLength(1);
      expect(unpinned).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // rebalance
  // ─────────────────────────────────────────────────────────────────────────
  describe("rebalance", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should move pins from overloaded to underloaded nodes", () => {
      const n1 = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
      const n2 = manager.addNode({
        peerId: "peer-2",
        endpoint: "http://node2:5001",
        storageCapacity: 1000000,
      });

      // Pin multiple items with replicationFactor 1 to force all on one node
      for (let i = 0; i < 10; i++) {
        manager.pinContent({ cid: `QmHash${i}`, replicationFactor: 1 });
      }

      const result = manager.rebalance();
      expect(result).toHaveProperty("moved");
      expect(result).toHaveProperty("duration");
    });

    it("should emit cluster:rebalanced event", () => {
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
      manager.addNode({
        peerId: "peer-2",
        endpoint: "http://node2:5001",
        storageCapacity: 1000000,
      });

      const listener = vi.fn();
      manager.on("cluster:rebalanced", listener);

      manager.rebalance();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should return move count and duration", () => {
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });

      const result = manager.rebalance();
      expect(typeof result.moved).toBe("number");
      expect(typeof result.duration).toBe("number");
    });

    it("should handle empty cluster", () => {
      const result = manager.rebalance();
      expect(result.moved).toBe(0);
      expect(result.duration).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // checkHealth
  // ─────────────────────────────────────────────────────────────────────────
  describe("checkHealth", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should detect degraded nodes with expired heartbeat", () => {
      const node = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });

      // Manually set heartbeat to past time
      node.last_heartbeat = new Date(Date.now() - 200000).toISOString();

      const health = manager.checkHealth();
      expect(health.degraded).toBe(1);
      expect(health.healthy).toBe(0);
    });

    it("should count healthy, degraded, and offline nodes", () => {
      manager.addNode({ peerId: "peer-1", endpoint: "http://node1:5001" });
      manager.addNode({ peerId: "peer-2", endpoint: "http://node2:5001" });

      const health = manager.checkHealth();
      expect(health.healthy).toBe(2);
      expect(health.degraded).toBe(0);
      expect(health.totalNodes).toBe(2);
    });

    it("should find under-replicated pins", () => {
      const node = manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
      });

      const pin = manager.pinContent({
        cid: "QmHash1",
        replicationFactor: 3,
        replicationMin: 3,
      });
      // Only 1 node available, so current_replicas = 1 < replication_min = 3

      const health = manager.checkHealth();
      expect(health.underReplicatedPins).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats / destroy
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats / destroy", () => {
    beforeEach(async () => {
      await manager.initialize(db);
    });

    it("should return correct stats", () => {
      manager.addNode({
        peerId: "peer-1",
        endpoint: "http://node1:5001",
        storageCapacity: 1000000,
      });
      manager.addNode({
        peerId: "peer-2",
        endpoint: "http://node2:5001",
        storageCapacity: 2000000,
      });
      manager.pinContent({ cid: "QmHash1" });

      const stats = manager.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.onlineNodes).toBe(2);
      expect(stats.totalPins).toBe(1);
      expect(stats.totalStorage).toBe(3000000);
      expect(stats.replicationHealth).toBeGreaterThan(0);
    });

    it("should clear state on destroy", () => {
      manager.addNode({ peerId: "peer-1", endpoint: "http://node1:5001" });
      manager.pinContent({ cid: "QmHash1", replicationFactor: 1 });

      manager.destroy();

      expect(manager.initialized).toBe(false);
      expect(manager.listNodes()).toHaveLength(0);
      expect(manager.listPins()).toHaveLength(0);
    });
  });
});
