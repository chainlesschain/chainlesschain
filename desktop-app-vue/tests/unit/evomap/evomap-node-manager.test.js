/**
 * Unit tests for EvoMapNodeManager
 * @module evomap/evomap-node-manager.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let EvoMapNodeManager, getEvoMapNodeManager;

describe("EvoMapNodeManager", () => {
  let mockDb;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => "/mock/userData") },
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    }));

    mockDb = {
      exec: vi.fn(),
      run: vi.fn(),
      prepare: vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      })),
      saveToFile: vi.fn(),
    };

    const mod = await import("../../../src/main/evomap/evomap-node-manager.js");
    EvoMapNodeManager = mod.EvoMapNodeManager;
    getEvoMapNodeManager = mod.getEvoMapNodeManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // Constructor
  // ============================================================

  describe("constructor", () => {
    it("should initialize with default state", () => {
      const nm = new EvoMapNodeManager();
      expect(nm.initialized).toBe(false);
      expect(nm._nodeId).toBeNull();
      expect(nm._credits).toBe(0);
      expect(nm._reputation).toBe(0);
      expect(nm._registered).toBe(false);
      expect(nm._lastHeartbeat).toBeNull();
      expect(nm._heartbeatTimer).toBeNull();
    });

    it("should be an EventEmitter", () => {
      const nm = new EvoMapNodeManager();
      expect(typeof nm.on).toBe("function");
      expect(typeof nm.emit).toBe("function");
    });
  });

  // ============================================================
  // Initialize
  // ============================================================

  describe("initialize()", () => {
    it("should set db and call _ensureTables", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      expect(nm.db).toBe(mockDb);
      expect(nm.initialized).toBe(true);
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it("should skip if already initialized", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      await nm.initialize(mockDb, null);
      // exec only called once
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
    });

    it("should load persisted node state", async () => {
      const row = {
        node_id: "node_existing",
        credits: 50,
        reputation: 0.8,
        heartbeat_interval_ms: 60000,
        last_heartbeat: "2025-01-01T00:00:00Z",
        registered_at: "2025-01-01T00:00:00Z",
      };
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => row),
        all: vi.fn(() => []),
      });

      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      expect(nm._nodeId).toBe("node_existing");
      expect(nm._credits).toBe(50);
      expect(nm._registered).toBe(true);
    });
  });

  // ============================================================
  // _ensureTables
  // ============================================================

  describe("_ensureTables()", () => {
    it("should execute CREATE TABLE statements", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS evomap_node");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS evomap_assets");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS evomap_sync_log");
    });

    it("should call saveToFile if available", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      expect(mockDb.saveToFile).toHaveBeenCalled();
    });

    it("should not crash if db is null", () => {
      const nm = new EvoMapNodeManager();
      nm._ensureTables(); // no db set
    });
  });

  // ============================================================
  // getOrCreateNodeId
  // ============================================================

  describe("getOrCreateNodeId()", () => {
    it("should generate a node_<hex> ID", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const id = nm.getOrCreateNodeId();
      expect(id).toMatch(/^node_[a-f0-9]+$/);
    });

    it("should return cached ID on second call", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const id1 = nm.getOrCreateNodeId();
      const id2 = nm.getOrCreateNodeId();
      expect(id1).toBe(id2);
    });

    it("should persist to DB", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      nm.getOrCreateNodeId();

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO evomap_node"),
        expect.any(Array),
      );
    });
  });

  // ============================================================
  // registerNode
  // ============================================================

  describe("registerNode()", () => {
    it("should call client.hello and update state", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const mockClient = {
        setSenderId: vi.fn(),
        hello: vi.fn().mockResolvedValue({
          success: true,
          data: {
            credits: 100,
            claim_code: "CC_001",
            heartbeat_interval_ms: 60000,
          },
        }),
      };

      const result = await nm.registerNode(mockClient);

      expect(result.success).toBe(true);
      expect(nm._registered).toBe(true);
      expect(nm._credits).toBe(100);
      expect(mockClient.setSenderId).toHaveBeenCalled();
    });

    it("should return error when no client", async () => {
      const nm = new EvoMapNodeManager();
      const result = await nm.registerNode(null);
      expect(result.success).toBe(false);
    });

    it("should return error on hello failure", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const mockClient = {
        setSenderId: vi.fn(),
        hello: vi
          .fn()
          .mockResolvedValue({ success: false, error: "Hub unreachable" }),
      };

      const result = await nm.registerNode(mockClient);
      expect(result.success).toBe(false);
    });

    it("should emit registered event", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const registered = vi.fn();
      nm.on("registered", registered);

      const mockClient = {
        setSenderId: vi.fn(),
        hello: vi.fn().mockResolvedValue({
          success: true,
          data: { credits: 50, claim_code: "CC" },
        }),
      };

      await nm.registerNode(mockClient);
      expect(registered).toHaveBeenCalledWith(
        expect.objectContaining({ credits: 50 }),
      );
    });
  });

  // ============================================================
  // getNodeStatus
  // ============================================================

  describe("getNodeStatus()", () => {
    it("should return all status fields", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const status = nm.getNodeStatus();
      expect(status).toHaveProperty("nodeId");
      expect(status).toHaveProperty("credits");
      expect(status).toHaveProperty("reputation");
      expect(status).toHaveProperty("registered");
      expect(status).toHaveProperty("lastHeartbeat");
      expect(status).toHaveProperty("heartbeatInterval");
      expect(status).toHaveProperty("initialized");
    });
  });

  // ============================================================
  // Heartbeat
  // ============================================================

  describe("startHeartbeat / stopHeartbeat", () => {
    it("should start and stop heartbeat timer", async () => {
      vi.useFakeTimers();
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      const mockClient = {};
      nm.startHeartbeat(mockClient);
      expect(nm._heartbeatTimer).not.toBeNull();

      nm.stopHeartbeat();
      expect(nm._heartbeatTimer).toBeNull();
      vi.useRealTimers();
    });

    it("should not start if already running", async () => {
      vi.useFakeTimers();
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      nm.startHeartbeat({});
      const timer1 = nm._heartbeatTimer;
      nm.startHeartbeat({});
      expect(nm._heartbeatTimer).toBe(timer1);

      nm.stopHeartbeat();
      vi.useRealTimers();
    });
  });

  describe("_heartbeatLoop()", () => {
    it("should update credits on successful heartbeat", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      nm._nodeId = "node_test";

      const heartbeatFn = vi.fn();
      nm.on("heartbeat", heartbeatFn);

      nm._heartbeatClient = {
        hello: vi.fn().mockResolvedValue({
          success: true,
          data: { credits: 200 },
        }),
      };

      await nm._heartbeatLoop();

      expect(nm._credits).toBe(200);
      expect(nm._lastHeartbeat).toBeDefined();
      expect(heartbeatFn).toHaveBeenCalled();
    });

    it("should emit offline on failure", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      nm._nodeId = "node_test";

      const offlineFn = vi.fn();
      nm.on("offline", offlineFn);

      nm._heartbeatClient = {
        hello: vi.fn().mockResolvedValue({ success: false, error: "timeout" }),
      };

      await nm._heartbeatLoop();
      expect(offlineFn).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Credits
  // ============================================================

  describe("refreshCredits()", () => {
    it("should refresh credits from hub", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      nm._nodeId = "node_test";

      const mockClient = {
        getNodeInfo: vi.fn().mockResolvedValue({
          success: true,
          data: { credits: 75, reputation: 0.9 },
        }),
      };

      const credits = await nm.refreshCredits(mockClient);
      expect(credits).toBe(75);
      expect(nm._reputation).toBe(0.9);
    });

    it("should return current credits if no client", async () => {
      const nm = new EvoMapNodeManager();
      nm._credits = 10;
      const credits = await nm.refreshCredits(null);
      expect(credits).toBe(10);
    });
  });

  describe("getCredits()", () => {
    it("should return current credits", () => {
      const nm = new EvoMapNodeManager();
      nm._credits = 42;
      expect(nm.getCredits()).toBe(42);
    });
  });

  // ============================================================
  // Shutdown
  // ============================================================

  describe("shutdown()", () => {
    it("should stop heartbeat and set initialized false", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);
      expect(nm.initialized).toBe(true);

      await nm.shutdown();
      expect(nm.initialized).toBe(false);
    });
  });

  // ============================================================
  // _logSync
  // ============================================================

  describe("_logSync()", () => {
    it("should insert sync log entry", async () => {
      const nm = new EvoMapNodeManager();
      await nm.initialize(mockDb, null);

      nm._logSync("heartbeat", null, "success", { credits: 100 });
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO evomap_sync_log"),
        expect.any(Array),
      );
    });
  });

  // ============================================================
  // Singleton
  // ============================================================

  describe("getEvoMapNodeManager()", () => {
    it("should return a singleton instance", () => {
      const instance = getEvoMapNodeManager();
      expect(instance).toBeInstanceOf(EvoMapNodeManager);
    });
  });
});
