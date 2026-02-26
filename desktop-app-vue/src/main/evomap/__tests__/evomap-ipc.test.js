/**
 * EvoMap IPC Handler Unit Tests
 *
 * Tests the 25 IPC handlers registered by registerEvoMapIPC().
 * Uses dependency injection pattern for ipcMain, nodeManager, client, and bridge.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../config/unified-config-manager.js", () => ({
  getUnifiedConfigManager: vi.fn(() => ({
    set: vi.fn(),
    get: vi.fn(),
  })),
}));

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

function createMockNodeManager(initialized = true) {
  return {
    initialized,
    registerNode: vi
      .fn()
      .mockResolvedValue({ success: true, data: { nodeId: "n1" } }),
    getNodeStatus: vi
      .fn()
      .mockReturnValue({ nodeId: "n1", credits: 100, registered: true }),
    refreshCredits: vi.fn().mockResolvedValue(200),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    getOrCreateNodeId: vi.fn().mockReturnValue("n1"),
  };
}

function createMockClient() {
  return {
    searchAssets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAssetDetail: vi
      .fn()
      .mockResolvedValue({ success: true, data: { id: "a1" } }),
    getTrending: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getRankedAssets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    listTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
    claimTask: vi
      .fn()
      .mockResolvedValue({ success: true, data: { taskId: "t1" } }),
    completeTask: vi.fn().mockResolvedValue({ success: true }),
    getNodeInfo: vi
      .fn()
      .mockResolvedValue({ success: true, data: { tasks: ["t1"] } }),
    getConfig: vi.fn().mockReturnValue({ hubUrl: "http://hub" }),
    setHubUrl: vi.fn(),
  };
}

function createMockBridge(initialized = true) {
  return {
    initialized,
    publishInstinct: vi
      .fn()
      .mockResolvedValue({ success: true, data: { assetId: "a1" } }),
    publishDecision: vi
      .fn()
      .mockResolvedValue({ success: true, data: { assetId: "a2" } }),
    publishBundle: vi
      .fn()
      .mockResolvedValue({ success: true, data: { assetId: "a3" } }),
    autoPublishEligible: vi.fn().mockResolvedValue({ published: 2 }),
    approvePublish: vi.fn().mockResolvedValue({ success: true }),
    fetchRelevantAssets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    importAsSkill: vi.fn().mockResolvedValue({ success: true }),
    importAsInstinct: vi.fn().mockResolvedValue({ success: true }),
    getLocalAssets: vi.fn().mockReturnValue([{ id: "la1" }]),
    getConfig: vi.fn().mockReturnValue({ autoPublish: false }),
    setConfig: vi.fn(),
    getSyncLog: vi
      .fn()
      .mockReturnValue([{ action: "publish", ts: Date.now() }]),
  };
}

const { registerEvoMapIPC, EVOMAP_CHANNELS } = require("../evomap-ipc.js");

describe("EvoMap IPC Handlers", () => {
  let mockIpcMain;
  let handlers;
  let mockNodeManager;
  let mockClient;
  let mockBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain = createMockIpcMain();
    mockNodeManager = createMockNodeManager();
    mockClient = createMockClient();
    mockBridge = createMockBridge();
    registerEvoMapIPC({
      ipcMain: mockIpcMain,
      nodeManager: mockNodeManager,
      client: mockClient,
      bridge: mockBridge,
    });
    handlers = mockIpcMain.handlers;
  });

  // ============================================================
  // Registration
  // ============================================================

  it("should register all 25 IPC handlers", () => {
    expect(Object.keys(handlers)).toHaveLength(25);
  });

  it("should register all expected channel names", () => {
    for (const ch of EVOMAP_CHANNELS) {
      expect(handlers[ch]).toBeDefined();
    }
  });

  it("EVOMAP_CHANNELS has 25 entries", () => {
    expect(EVOMAP_CHANNELS).toHaveLength(25);
  });

  // ============================================================
  // Node Management (5 handlers)
  // ============================================================

  it("evomap:register delegates to nodeManager", async () => {
    const r = await handlers["evomap:register"]();
    expect(r.success).toBe(true);
    expect(mockNodeManager.registerNode).toHaveBeenCalledWith(mockClient);
  });

  it("evomap:register fails when nodeManager not initialized", async () => {
    const ipc2 = createMockIpcMain();
    const uninitNM = createMockNodeManager(false);
    registerEvoMapIPC({
      ipcMain: ipc2,
      nodeManager: uninitNM,
      client: mockClient,
      bridge: mockBridge,
    });
    const r = await ipc2.handlers["evomap:register"]();
    expect(r.success).toBe(false);
    expect(r.error).toContain("not initialized");
  });

  it("evomap:get-status returns node status", async () => {
    const r = await handlers["evomap:get-status"]();
    expect(r.success).toBe(true);
    expect(r.data).toHaveProperty("nodeId");
    expect(r.data).toHaveProperty("credits");
  });

  it("evomap:refresh-credits delegates", async () => {
    const r = await handlers["evomap:refresh-credits"]();
    expect(r.success).toBe(true);
    expect(r.data.credits).toBe(200);
  });

  it("evomap:start-heartbeat delegates", async () => {
    const r = await handlers["evomap:start-heartbeat"]();
    expect(r.success).toBe(true);
    expect(mockNodeManager.startHeartbeat).toHaveBeenCalledWith(mockClient);
  });

  it("evomap:stop-heartbeat delegates", async () => {
    const r = await handlers["evomap:stop-heartbeat"]();
    expect(r.success).toBe(true);
    expect(mockNodeManager.stopHeartbeat).toHaveBeenCalled();
  });

  // ============================================================
  // Asset Publishing (5 handlers)
  // ============================================================

  it("evomap:publish-instinct delegates", async () => {
    const r = await handlers["evomap:publish-instinct"]({}, "inst1");
    expect(r.success).toBe(true);
    expect(mockBridge.publishInstinct).toHaveBeenCalledWith("inst1");
  });

  it("evomap:publish-instinct fails when bridge not initialized", async () => {
    const ipc2 = createMockIpcMain();
    const uninitBridge = createMockBridge(false);
    registerEvoMapIPC({
      ipcMain: ipc2,
      nodeManager: mockNodeManager,
      client: mockClient,
      bridge: uninitBridge,
    });
    const r = await ipc2.handlers["evomap:publish-instinct"]({}, "inst1");
    expect(r.success).toBe(false);
    expect(r.error).toContain("not initialized");
  });

  it("evomap:publish-decision delegates", async () => {
    const r = await handlers["evomap:publish-decision"]({}, "dec1");
    expect(r.success).toBe(true);
    expect(mockBridge.publishDecision).toHaveBeenCalledWith("dec1");
  });

  it("evomap:publish-bundle delegates", async () => {
    const gene = { id: "g1" };
    const capsule = { id: "c1" };
    const event = { type: "mutation" };
    const r = await handlers["evomap:publish-bundle"]({}, gene, capsule, event);
    expect(r.success).toBe(true);
    expect(mockBridge.publishBundle).toHaveBeenCalledWith(gene, capsule, event);
  });

  it("evomap:auto-publish delegates", async () => {
    const r = await handlers["evomap:auto-publish"]();
    expect(r.success).toBe(true);
    expect(r.data).toHaveProperty("published");
  });

  it("evomap:approve-publish delegates", async () => {
    const r = await handlers["evomap:approve-publish"]({}, "rev1");
    expect(r.success).toBe(true);
    expect(mockBridge.approvePublish).toHaveBeenCalledWith("rev1");
  });

  // ============================================================
  // Asset Discovery (5 handlers)
  // ============================================================

  it("evomap:search-assets delegates to client", async () => {
    const r = await handlers["evomap:search-assets"](
      {},
      ["sig1"],
      "gene",
      "relevance",
    );
    expect(r.success).toBe(true);
    expect(mockClient.searchAssets).toHaveBeenCalledWith(
      ["sig1"],
      "gene",
      "relevance",
    );
  });

  it("evomap:fetch-relevant delegates to bridge", async () => {
    const r = await handlers["evomap:fetch-relevant"]({}, ["sig1"], "capsule");
    expect(r.success).toBe(true);
    expect(mockBridge.fetchRelevantAssets).toHaveBeenCalledWith(
      ["sig1"],
      "capsule",
    );
  });

  it("evomap:get-asset-detail delegates to client", async () => {
    const r = await handlers["evomap:get-asset-detail"]({}, "a1");
    expect(r.success).toBe(true);
    expect(mockClient.getAssetDetail).toHaveBeenCalledWith("a1");
  });

  it("evomap:get-trending delegates to client", async () => {
    const r = await handlers["evomap:get-trending"]();
    expect(r.success).toBe(true);
    expect(mockClient.getTrending).toHaveBeenCalled();
  });

  it("evomap:get-ranked delegates to client", async () => {
    const r = await handlers["evomap:get-ranked"]({}, "gene", 10);
    expect(r.success).toBe(true);
    expect(mockClient.getRankedAssets).toHaveBeenCalledWith("gene", 10);
  });

  // ============================================================
  // Import (3 handlers)
  // ============================================================

  it("evomap:import-as-skill delegates", async () => {
    const r = await handlers["evomap:import-as-skill"]({}, "a1");
    expect(r.success).toBe(true);
    expect(mockBridge.importAsSkill).toHaveBeenCalledWith("a1");
  });

  it("evomap:import-as-instinct delegates", async () => {
    const r = await handlers["evomap:import-as-instinct"]({}, "a1");
    expect(r.success).toBe(true);
    expect(mockBridge.importAsInstinct).toHaveBeenCalledWith("a1");
  });

  it("evomap:get-local-assets delegates", async () => {
    const r = await handlers["evomap:get-local-assets"]({}, { type: "gene" });
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(mockBridge.getLocalAssets).toHaveBeenCalledWith({ type: "gene" });
  });

  it("evomap:get-local-assets uses empty filters when null", async () => {
    const r = await handlers["evomap:get-local-assets"]({}, null);
    expect(r.success).toBe(true);
    expect(mockBridge.getLocalAssets).toHaveBeenCalledWith({});
  });

  // ============================================================
  // Task/Bounty (4 handlers)
  // ============================================================

  it("evomap:list-tasks delegates to client", async () => {
    const r = await handlers["evomap:list-tasks"]({}, 50, 10);
    expect(r.success).toBe(true);
    expect(mockClient.listTasks).toHaveBeenCalledWith(50, 10);
  });

  it("evomap:claim-task delegates to client", async () => {
    const r = await handlers["evomap:claim-task"]({}, "t1");
    expect(r.success).toBe(true);
    expect(mockClient.claimTask).toHaveBeenCalledWith("t1");
  });

  it("evomap:complete-task delegates to client", async () => {
    const r = await handlers["evomap:complete-task"]({}, "t1", "a1");
    expect(r.success).toBe(true);
    expect(mockClient.completeTask).toHaveBeenCalledWith("t1", "a1");
  });

  it("evomap:get-my-tasks returns tasks from node info", async () => {
    const r = await handlers["evomap:get-my-tasks"]();
    expect(r.success).toBe(true);
    expect(r.data.tasks).toEqual(["t1"]);
    expect(mockNodeManager.getOrCreateNodeId).toHaveBeenCalled();
  });

  it("evomap:get-my-tasks fails when nodeManager not initialized", async () => {
    const ipc2 = createMockIpcMain();
    const uninitNM = createMockNodeManager(false);
    registerEvoMapIPC({
      ipcMain: ipc2,
      nodeManager: uninitNM,
      client: mockClient,
      bridge: mockBridge,
    });
    const r = await ipc2.handlers["evomap:get-my-tasks"]();
    expect(r.success).toBe(false);
  });

  // ============================================================
  // Config & Stats (3 handlers)
  // ============================================================

  it("evomap:get-config returns combined config", async () => {
    const r = await handlers["evomap:get-config"]();
    expect(r.success).toBe(true);
    expect(r.data).toHaveProperty("evomap");
    expect(r.data).toHaveProperty("client");
  });

  it("evomap:update-config sets config on bridge and client", async () => {
    const r = await handlers["evomap:update-config"](
      {},
      { hubUrl: "http://new", autoPublish: true },
    );
    expect(r.success).toBe(true);
    expect(mockBridge.setConfig).toHaveBeenCalledWith({
      hubUrl: "http://new",
      autoPublish: true,
    });
    expect(mockClient.setHubUrl).toHaveBeenCalledWith("http://new");
  });

  it("evomap:update-config without hubUrl does not call setHubUrl", async () => {
    const r = await handlers["evomap:update-config"](
      {},
      { autoPublish: false },
    );
    expect(r.success).toBe(true);
    expect(mockClient.setHubUrl).not.toHaveBeenCalled();
  });

  it("evomap:get-sync-log delegates", async () => {
    const r = await handlers["evomap:get-sync-log"]({}, 20);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(mockBridge.getSyncLog).toHaveBeenCalledWith(20);
  });

  it("evomap:get-sync-log defaults to 50", async () => {
    const r = await handlers["evomap:get-sync-log"]({}, undefined);
    expect(r.success).toBe(true);
    expect(mockBridge.getSyncLog).toHaveBeenCalledWith(50);
  });

  // ============================================================
  // Error Handling
  // ============================================================

  it("handles nodeManager error", async () => {
    mockNodeManager.registerNode.mockRejectedValue(new Error("Network error"));
    const r = await handlers["evomap:register"]();
    expect(r.success).toBe(false);
    expect(r.error).toBe("Network error");
  });

  it("handles client error", async () => {
    mockClient.searchAssets.mockRejectedValue(new Error("Timeout"));
    const r = await handlers["evomap:search-assets"](
      {},
      [],
      "gene",
      "relevance",
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("Timeout");
  });

  it("handles bridge error", async () => {
    mockBridge.publishInstinct.mockRejectedValue(new Error("Publish failed"));
    const r = await handlers["evomap:publish-instinct"]({}, "inst1");
    expect(r.success).toBe(false);
    expect(r.error).toBe("Publish failed");
  });
});
