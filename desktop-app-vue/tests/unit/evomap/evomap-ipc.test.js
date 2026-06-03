/**
 * Unit tests for EvoMap IPC handlers
 * @module evomap/evomap-ipc.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron module before imports
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

// Mock logger to avoid errors
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

let registerEvoMapIPC, unregisterEvoMapIPC, EVOMAP_CHANNELS;

describe("EvoMapIPC", () => {
  let mockIpcMain;
  let mockNodeManager, mockClient, mockBridge;

  beforeEach(async () => {
    vi.resetModules();

    // Create our own ipcMain mock to pass via deps.ipcMain
    mockIpcMain = {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    };

    mockNodeManager = {
      initialized: true,
      registerNode: vi
        .fn()
        .mockResolvedValue({ success: true, data: { credits: 100 } }),
      getNodeStatus: vi
        .fn()
        .mockReturnValue({
          nodeId: "node_test",
          credits: 50,
          registered: true,
        }),
      refreshCredits: vi.fn().mockResolvedValue(75),
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      getOrCreateNodeId: vi.fn().mockReturnValue("node_test"),
    };

    mockClient = {
      searchAssets: vi
        .fn()
        .mockResolvedValue({ success: true, data: { assets: [] } }),
      getAssetDetail: vi.fn().mockResolvedValue({ success: true, data: {} }),
      getTrending: vi
        .fn()
        .mockResolvedValue({ success: true, data: { assets: [] } }),
      getRankedAssets: vi.fn().mockResolvedValue({ success: true, data: [] }),
      listTasks: vi
        .fn()
        .mockResolvedValue({ success: true, data: { tasks: [] } }),
      claimTask: vi.fn().mockResolvedValue({ success: true }),
      completeTask: vi.fn().mockResolvedValue({ success: true }),
      getNodeInfo: vi
        .fn()
        .mockResolvedValue({ success: true, data: { tasks: [] } }),
      getConfig: vi.fn().mockReturnValue({ hubUrl: "http://test" }),
      setHubUrl: vi.fn(),
    };

    mockBridge = {
      initialized: true,
      publishInstinct: vi.fn().mockResolvedValue({ success: true }),
      publishDecision: vi.fn().mockResolvedValue({ success: true }),
      publishBundle: vi.fn().mockResolvedValue({ success: true }),
      autoPublishEligible: vi
        .fn()
        .mockResolvedValue({ published: 1, skipped: 0, errors: 0 }),
      approvePublish: vi.fn().mockResolvedValue({ success: true }),
      fetchRelevantAssets: vi
        .fn()
        .mockResolvedValue({ success: true, data: { assets: [] } }),
      importAsSkill: vi.fn().mockResolvedValue({ success: true }),
      importAsInstinct: vi.fn().mockResolvedValue({ success: true }),
      getLocalAssets: vi.fn().mockReturnValue([]),
      getConfig: vi.fn().mockReturnValue({}),
      setConfig: vi.fn(),
      getSyncLog: vi.fn().mockReturnValue([]),
    };

    const mod = await import("../../../src/main/evomap/evomap-ipc.js");
    registerEvoMapIPC = mod.registerEvoMapIPC;
    unregisterEvoMapIPC = mod.unregisterEvoMapIPC;
    EVOMAP_CHANNELS = mod.EVOMAP_CHANNELS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("EVOMAP_CHANNELS", () => {
    it("should have 25 channels", () => {
      expect(EVOMAP_CHANNELS).toHaveLength(25);
    });

    it("should include node management channels", () => {
      expect(EVOMAP_CHANNELS).toContain("evomap:register");
      expect(EVOMAP_CHANNELS).toContain("evomap:get-status");
      expect(EVOMAP_CHANNELS).toContain("evomap:refresh-credits");
      expect(EVOMAP_CHANNELS).toContain("evomap:start-heartbeat");
      expect(EVOMAP_CHANNELS).toContain("evomap:stop-heartbeat");
    });

    it("should include publishing channels", () => {
      expect(EVOMAP_CHANNELS).toContain("evomap:publish-instinct");
      expect(EVOMAP_CHANNELS).toContain("evomap:publish-decision");
      expect(EVOMAP_CHANNELS).toContain("evomap:publish-bundle");
      expect(EVOMAP_CHANNELS).toContain("evomap:auto-publish");
      expect(EVOMAP_CHANNELS).toContain("evomap:approve-publish");
    });

    it("should include discovery channels", () => {
      expect(EVOMAP_CHANNELS).toContain("evomap:search-assets");
      expect(EVOMAP_CHANNELS).toContain("evomap:fetch-relevant");
      expect(EVOMAP_CHANNELS).toContain("evomap:get-trending");
    });

    it("should include import channels", () => {
      expect(EVOMAP_CHANNELS).toContain("evomap:import-as-skill");
      expect(EVOMAP_CHANNELS).toContain("evomap:import-as-instinct");
      expect(EVOMAP_CHANNELS).toContain("evomap:get-local-assets");
    });

    it("should include config channels", () => {
      expect(EVOMAP_CHANNELS).toContain("evomap:get-config");
      expect(EVOMAP_CHANNELS).toContain("evomap:update-config");
      expect(EVOMAP_CHANNELS).toContain("evomap:get-sync-log");
    });
  });

  describe("registerEvoMapIPC", () => {
    it("should register 25 handlers and return count", () => {
      // Pass ipcMain directly via deps to avoid require('electron') issues
      const result = registerEvoMapIPC({
        ipcMain: mockIpcMain,
        nodeManager: mockNodeManager,
        client: mockClient,
        bridge: mockBridge,
      });

      expect(result.handlerCount).toBe(25);
      expect(mockIpcMain.handle).toHaveBeenCalledTimes(25);
    });

    it("should register all expected channels", () => {
      registerEvoMapIPC({
        ipcMain: mockIpcMain,
        nodeManager: mockNodeManager,
        client: mockClient,
        bridge: mockBridge,
      });

      const registeredChannels = mockIpcMain.handle.mock.calls.map((c) => c[0]);
      for (const channel of EVOMAP_CHANNELS) {
        expect(registeredChannels).toContain(channel);
      }
    });
  });

  describe("unregisterEvoMapIPC", () => {
    // unregisterEvoMapIPC uses require('electron').ipcMain internally
    // We can't easily inject it, so just test that it doesn't throw
    // when the electron mock is available
    it("should be a function", () => {
      expect(typeof unregisterEvoMapIPC).toBe("function");
    });
  });

  describe("handler behavior", () => {
    let handlers;

    beforeEach(() => {
      registerEvoMapIPC({
        ipcMain: mockIpcMain,
        nodeManager: mockNodeManager,
        client: mockClient,
        bridge: mockBridge,
      });

      // Collect all registered handlers by channel name
      handlers = {};
      for (const [channel, handler] of mockIpcMain.handle.mock.calls) {
        handlers[channel] = handler;
      }
    });

    // Node management handlers

    it("evomap:register should call nodeManager.registerNode", async () => {
      const result = await handlers["evomap:register"]({});
      expect(result.success).toBe(true);
      expect(mockNodeManager.registerNode).toHaveBeenCalledWith(mockClient);
    });

    it("evomap:register should return error when not initialized", async () => {
      mockNodeManager.initialized = false;
      const result = await handlers["evomap:register"]({});
      expect(result.success).toBe(false);
      expect(result.error).toContain("not initialized");
    });

    it("evomap:get-status should return node status", async () => {
      const result = await handlers["evomap:get-status"]({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        nodeId: "node_test",
        credits: 50,
        registered: true,
      });
    });

    it("evomap:refresh-credits should return credits", async () => {
      const result = await handlers["evomap:refresh-credits"]({});
      expect(result.success).toBe(true);
      expect(result.data.credits).toBe(75);
    });

    it("evomap:start-heartbeat should call startHeartbeat", async () => {
      const result = await handlers["evomap:start-heartbeat"]({});
      expect(result.success).toBe(true);
      expect(mockNodeManager.startHeartbeat).toHaveBeenCalledWith(mockClient);
    });

    it("evomap:stop-heartbeat should call stopHeartbeat", async () => {
      const result = await handlers["evomap:stop-heartbeat"]({});
      expect(result.success).toBe(true);
      expect(mockNodeManager.stopHeartbeat).toHaveBeenCalled();
    });

    // Publishing handlers

    it("evomap:publish-instinct should call bridge.publishInstinct", async () => {
      const result = await handlers["evomap:publish-instinct"]({}, "inst_1");
      expect(result.success).toBe(true);
      expect(mockBridge.publishInstinct).toHaveBeenCalledWith("inst_1");
    });

    it("evomap:publish-decision should call bridge.publishDecision", async () => {
      const result = await handlers["evomap:publish-decision"]({}, "dec_1");
      expect(result.success).toBe(true);
      expect(mockBridge.publishDecision).toHaveBeenCalledWith("dec_1");
    });

    it("evomap:publish-bundle should call bridge.publishBundle", async () => {
      const gene = { type: "Gene" };
      const capsule = { type: "Capsule" };
      const ev = { type: "EvolutionEvent" };
      const result = await handlers["evomap:publish-bundle"](
        {},
        gene,
        capsule,
        ev,
      );
      expect(result.success).toBe(true);
      expect(mockBridge.publishBundle).toHaveBeenCalledWith(gene, capsule, ev);
    });

    it("evomap:auto-publish should call bridge.autoPublishEligible", async () => {
      const result = await handlers["evomap:auto-publish"]({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ published: 1, skipped: 0, errors: 0 });
    });

    it("evomap:approve-publish should call bridge.approvePublish", async () => {
      const result = await handlers["evomap:approve-publish"]({}, "review_1");
      expect(result.success).toBe(true);
      expect(mockBridge.approvePublish).toHaveBeenCalledWith("review_1");
    });

    // Discovery handlers

    it("evomap:search-assets should call client.searchAssets", async () => {
      const result = await handlers["evomap:search-assets"](
        {},
        ["test"],
        "Gene",
        "relevance",
      );
      expect(result.success).toBe(true);
      expect(mockClient.searchAssets).toHaveBeenCalledWith(
        ["test"],
        "Gene",
        "relevance",
      );
    });

    it("evomap:fetch-relevant should call bridge.fetchRelevantAssets", async () => {
      const result = await handlers["evomap:fetch-relevant"](
        {},
        ["test"],
        "Gene",
      );
      expect(result.success).toBe(true);
      expect(mockBridge.fetchRelevantAssets).toHaveBeenCalledWith(
        ["test"],
        "Gene",
      );
    });

    it("evomap:get-trending should call client.getTrending", async () => {
      const result = await handlers["evomap:get-trending"]({});
      expect(result.success).toBe(true);
      expect(mockClient.getTrending).toHaveBeenCalled();
    });

    it("evomap:get-ranked should call client.getRankedAssets", async () => {
      const result = await handlers["evomap:get-ranked"]({}, "Gene", 10);
      expect(result.success).toBe(true);
      expect(mockClient.getRankedAssets).toHaveBeenCalledWith("Gene", 10);
    });

    // Import handlers

    it("evomap:import-as-skill should call bridge.importAsSkill", async () => {
      const result = await handlers["evomap:import-as-skill"]({}, "asset_1");
      expect(result.success).toBe(true);
      expect(mockBridge.importAsSkill).toHaveBeenCalledWith("asset_1");
    });

    it("evomap:import-as-instinct should call bridge.importAsInstinct", async () => {
      const result = await handlers["evomap:import-as-instinct"]({}, "asset_1");
      expect(result.success).toBe(true);
      expect(mockBridge.importAsInstinct).toHaveBeenCalledWith("asset_1");
    });

    it("evomap:get-local-assets should call bridge.getLocalAssets", async () => {
      const result = await handlers["evomap:get-local-assets"](
        {},
        { direction: "published" },
      );
      expect(result.success).toBe(true);
      expect(mockBridge.getLocalAssets).toHaveBeenCalledWith({
        direction: "published",
      });
    });

    // Config handlers

    it("evomap:get-config should return config from bridge and client", async () => {
      const result = await handlers["evomap:get-config"]({});
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("evomap");
      expect(result.data).toHaveProperty("client");
    });

    it("evomap:update-config should call bridge.setConfig", async () => {
      const newConfig = { hubUrl: "http://new-hub" };
      const result = await handlers["evomap:update-config"]({}, newConfig);
      expect(result.success).toBe(true);
      expect(mockBridge.setConfig).toHaveBeenCalledWith(newConfig);
      expect(mockClient.setHubUrl).toHaveBeenCalledWith("http://new-hub");
    });

    it("evomap:get-sync-log should call bridge.getSyncLog", async () => {
      const result = await handlers["evomap:get-sync-log"]({}, 20);
      expect(result.success).toBe(true);
      expect(mockBridge.getSyncLog).toHaveBeenCalledWith(20);
    });

    // Error handling

    it("should catch errors and return failure", async () => {
      mockNodeManager.registerNode.mockRejectedValue(
        new Error("Unexpected error"),
      );
      const result = await handlers["evomap:register"]({});
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unexpected error");
    });

    it("evomap:publish-instinct should check bridge initialized", async () => {
      mockBridge.initialized = false;
      const result = await handlers["evomap:publish-instinct"]({}, "inst_1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not initialized");
    });

    it("evomap:fetch-relevant should check bridge initialized", async () => {
      mockBridge.initialized = false;
      const result = await handlers["evomap:fetch-relevant"]({}, ["test"]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not initialized");
    });
  });
});
