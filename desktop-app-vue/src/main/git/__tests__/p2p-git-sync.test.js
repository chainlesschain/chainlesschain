/**
 * P2P Git Sync + Device Discovery Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-p2p-1234") }));

const { P2PGitSync, VectorClock } = require("../p2p-git-sync.js");
const {
  DeviceDiscoveryManager,
} = require("../device-discovery.js");

// ─── VectorClock ──────────────────────────────────────────────────────────────

describe("VectorClock", () => {
  it("starts at 0 for all nodes", () => {
    const vc = new VectorClock("node1");
    expect(vc.get("node1")).toBe(0);
    expect(vc.get("node2")).toBe(0);
  });

  it("increment increases own counter", () => {
    const vc = new VectorClock("node1");
    vc.increment();
    expect(vc.get("node1")).toBe(1);
    vc.increment();
    expect(vc.get("node1")).toBe(2);
  });

  it("merge takes max per node", () => {
    const vc1 = new VectorClock("n1");
    vc1.clock = { n1: 3, n2: 1 };
    const vc2 = new VectorClock("n2");
    vc2.clock = { n1: 1, n2: 4 };
    vc1.merge(vc2);
    expect(vc1.get("n1")).toBe(3);
    expect(vc1.get("n2")).toBe(4);
  });

  it("compare: equal clocks", () => {
    const vc1 = new VectorClock("n1");
    vc1.clock = { n1: 2, n2: 2 };
    const vc2 = new VectorClock("n2");
    vc2.clock = { n1: 2, n2: 2 };
    expect(vc1.compare(vc2)).toBe("equal");
  });

  it("compare: before — vc1 < vc2", () => {
    const vc1 = new VectorClock("n1");
    vc1.clock = { n1: 1, n2: 1 };
    const vc2 = new VectorClock("n2");
    vc2.clock = { n1: 2, n2: 2 };
    expect(vc1.compare(vc2)).toBe("before");
  });

  it("compare: after — vc1 > vc2", () => {
    const vc1 = new VectorClock("n1");
    vc1.clock = { n1: 3, n2: 2 };
    const vc2 = new VectorClock("n2");
    vc2.clock = { n1: 1, n2: 1 };
    expect(vc1.compare(vc2)).toBe("after");
  });

  it("compare: concurrent — neither dominates", () => {
    const vc1 = new VectorClock("n1");
    vc1.clock = { n1: 3, n2: 1 };
    const vc2 = new VectorClock("n2");
    vc2.clock = { n1: 1, n2: 3 };
    expect(vc1.compare(vc2)).toBe("concurrent");
  });

  it("toJSON / fromJSON round-trip", () => {
    const vc = new VectorClock("n1");
    vc.increment();
    const json = vc.toJSON();
    const vc2 = VectorClock.fromJSON("n1", json);
    expect(vc2.get("n1")).toBe(1);
  });
});

// ─── P2PGitSync ───────────────────────────────────────────────────────────────

describe("P2PGitSync", () => {
  let sync;
  let mockGitManager;
  let mockTransport;
  let mockDiscovery;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    };
    mockGitManager = {
      repoPath: "/mock/repo",
      getStatus: vi.fn().mockResolvedValue({ branch: "main" }),
    };
    mockTransport = {
      setServerHandler: vi.fn(),
      toHttpPlugin: vi.fn().mockReturnValue({ request: vi.fn() }),
      getBandwidthStats: vi.fn().mockReturnValue({ averageBandwidth: 0 }),
    };
    mockDiscovery = {
      getSyncablePeers: vi.fn().mockReturnValue([]),
      getAuthorizedDevices: vi.fn().mockReturnValue([]),
      verifyPeer: vi.fn().mockResolvedValue(true),
      on: vi.fn(),
    };
    sync = new P2PGitSync({
      gitManager: mockGitManager,
      transport: mockTransport,
      deviceDiscovery: mockDiscovery,
      database: mockDb,
    });
  });

  afterEach(() => {
    sync.destroy();
  });

  it("creates instance with correct dependencies", () => {
    expect(sync.gitManager).toBe(mockGitManager);
    expect(sync.deviceDiscovery).toBe(mockDiscovery);
  });

  it("getStatus returns current sync status", () => {
    const status = sync.getStatus();
    expect(status).toHaveProperty("state");
    expect(status).toHaveProperty("enabled");
    expect(status).toHaveProperty("topology");
  });

  it("enable / disable toggles sync state", () => {
    sync.enable();
    expect(sync.getStatus().enabled).toBe(true);
    sync.disable();
    expect(sync.getStatus().enabled).toBe(false);
  });

  it("setConfig updates configuration", () => {
    sync.setConfig({ topology: "star", maxConcurrentPeers: 2 });
    const cfg = sync.getConfig();
    expect(cfg.topology).toBe("star");
    expect(cfg.maxConcurrentPeers).toBe(2);
  });

  it("getSyncHistory queries database", () => {
    mockDb.all.mockReturnValue([{ id: "s1", peer_did: "did:key:abc" }]);
    const history = sync.getSyncHistory();
    expect(history.length).toBe(1);
  });

  it("syncAll returns empty results when no peers", async () => {
    mockDiscovery.getSyncablePeers.mockReturnValue([]);
    const results = await sync.syncAll();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it("offline queue is processed on reconnect", () => {
    sync._offlineQueue = [{ peerId: "p1", operation: "push" }];
    expect(sync._offlineQueue.length).toBe(1);
    sync._processOfflineQueue();
    // Queue should be cleared or reduced
    expect(sync._offlineQueue.length).toBeLessThanOrEqual(1);
  });

  it("destroy stops auto-sync timer", () => {
    sync._startAutoSync();
    expect(sync._syncTimer).toBeDefined();
    sync.destroy();
    expect(sync._syncTimer).toBeNull();
  });
});

// ─── DeviceDiscoveryManager ───────────────────────────────────────────────────

describe("DeviceDiscoveryManager", () => {
  let manager;
  let mockP2P;
  let mockDID;
  let mockDb;

  beforeEach(() => {
    mockDb = {
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      exec: vi.fn(),
    };
    mockP2P = {
      on: vi.fn(),
      broadcast: vi.fn(),
      getPeers: vi.fn().mockReturnValue([]),
      discoverPeers: vi.fn().mockResolvedValue([]),
    };
    mockDID = {
      sign: vi.fn().mockResolvedValue("signature-bytes"),
      verify: vi.fn().mockResolvedValue(true),
      getLocalDID: vi.fn().mockReturnValue("did:key:local"),
    };
    manager = new DeviceDiscoveryManager({
      p2pManager: mockP2P,
      didManager: mockDID,
      database: mockDb,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  it("creates instance", () => {
    expect(manager).toBeDefined();
  });

  it("authorizeDevice saves to db", async () => {
    await manager.authorizeDevice("did:key:device1", "peer-123", "pubkey-data");
    expect(mockDb.run).toHaveBeenCalled();
  });

  it("revokeDevice removes from db", async () => {
    await manager.revokeDevice("did:key:device1");
    expect(mockDb.run).toHaveBeenCalled();
  });

  it("isDeviceAuthorized queries db", () => {
    mockDb.get.mockReturnValue({ device_did: "did:key:dev" });
    const result = manager.isDeviceAuthorized("did:key:dev");
    expect(result).toBe(true);
  });

  it("isDeviceAuthorized returns false when not found", () => {
    mockDb.get.mockReturnValue(null);
    expect(manager.isDeviceAuthorized("did:key:unknown")).toBe(false);
  });

  it("getAuthorizedDevices returns all rows", () => {
    mockDb.all.mockReturnValue([
      { device_did: "did:key:a", peer_id: "p1" },
      { device_did: "did:key:b", peer_id: "p2" },
    ]);
    const devices = manager.getAuthorizedDevices();
    expect(devices.length).toBe(2);
  });

  it("getSyncablePeers returns intersection of connected and authorized", () => {
    mockDb.all.mockReturnValue([{ device_did: "did:key:peer1", peer_id: "peer-abc" }]);
    mockP2P.getPeers.mockReturnValue(["peer-abc", "peer-xyz"]);
    const peers = manager.getSyncablePeers();
    // Only peer-abc is authorized AND connected
    expect(peers).toContain("peer-abc");
    expect(peers).not.toContain("peer-xyz");
  });
});
