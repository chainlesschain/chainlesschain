/**
 * IPFS IPC Handler Unit Tests
 *
 * Tests the 18 IPC handlers registered by registerIPFSIPC().
 * Uses dependency injection pattern for ipcMain and manager.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// We don't need to mock ipfs-manager.js since we inject the manager directly

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

function createMockManager() {
  return {
    initialize: vi.fn(),
    startNode: vi.fn(),
    stopNode: vi.fn(),
    getNodeStatus: vi.fn().mockReturnValue({ running: true, mode: "embedded" }),
    addContent: vi.fn(),
    addFile: vi.fn(),
    getContent: vi.fn(),
    getFile: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    listPins: vi.fn(),
    getStorageStats: vi.fn(),
    garbageCollect: vi.fn(),
    setQuota: vi.fn(),
    setMode: vi.fn(),
    addKnowledgeAttachment: vi.fn(),
    getKnowledgeAttachment: vi.fn(),
    mode: "embedded",
    config: {
      gatewayUrl: "http://localhost:8080",
      storageQuotaBytes: 1073741824,
      externalApiUrl: null,
      encryptionEnabled: false,
    },
  };
}

const { registerIPFSIPC } = require("../ipfs-ipc.js");

describe("IPFS IPC Handlers", () => {
  let mockIpcMain;
  let handlers;
  let mockManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain = createMockIpcMain();
    mockManager = createMockManager();
    registerIPFSIPC({ ipcMain: mockIpcMain, manager: mockManager });
    handlers = mockIpcMain.handlers;
  });

  it("should register all 18 IPC handlers", () => {
    expect(Object.keys(handlers)).toHaveLength(18);
  });

  it("should register all expected channel names", () => {
    const expected = [
      "ipfs:initialize",
      "ipfs:start-node",
      "ipfs:stop-node",
      "ipfs:get-node-status",
      "ipfs:add-content",
      "ipfs:add-file",
      "ipfs:get-content",
      "ipfs:get-file",
      "ipfs:pin",
      "ipfs:unpin",
      "ipfs:list-pins",
      "ipfs:get-storage-stats",
      "ipfs:garbage-collect",
      "ipfs:set-quota",
      "ipfs:set-mode",
      "ipfs:add-knowledge-attachment",
      "ipfs:get-knowledge-attachment",
      "ipfs:get-config",
    ];
    for (const ch of expected) {
      expect(handlers[ch]).toBeDefined();
    }
  });

  it("ipfs:initialize should call manager.initialize and startNode", async () => {
    mockManager.initialize.mockResolvedValue(undefined);
    mockManager.startNode.mockResolvedValue(undefined);
    const result = await handlers["ipfs:initialize"]({}, { mode: "embedded" });
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("mode");
    expect(result.data).toHaveProperty("nodeStatus");
  });

  it("ipfs:initialize should return error on failure", async () => {
    mockManager.initialize.mockRejectedValue(new Error("Init failed"));
    const result = await handlers["ipfs:initialize"]({}, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Init failed");
  });

  it("ipfs:start-node should return node status", async () => {
    mockManager.startNode.mockResolvedValue(undefined);
    const result = await handlers["ipfs:start-node"]();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ running: true, mode: "embedded" });
  });

  it("ipfs:start-node error handling", async () => {
    mockManager.startNode.mockRejectedValue(new Error("Start failed"));
    const result = await handlers["ipfs:start-node"]();
    expect(result.success).toBe(false);
    expect(result.error).toBe("Start failed");
  });

  it("ipfs:stop-node should call manager.stopNode", async () => {
    mockManager.stopNode.mockResolvedValue(undefined);
    const result = await handlers["ipfs:stop-node"]();
    expect(result.success).toBe(true);
    expect(mockManager.stopNode).toHaveBeenCalled();
  });

  it("ipfs:get-node-status should return status", async () => {
    const result = await handlers["ipfs:get-node-status"]();
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ running: true, mode: "embedded" });
  });

  it("ipfs:add-content should pass content and options", async () => {
    mockManager.addContent.mockResolvedValue({ cid: "QmTest", size: 100 });
    const result = await handlers["ipfs:add-content"](
      {},
      { content: "hello", options: { pin: true } },
    );
    expect(result.success).toBe(true);
    expect(mockManager.addContent).toHaveBeenCalledWith("hello", { pin: true });
  });

  it("ipfs:add-content uses empty options when null", async () => {
    mockManager.addContent.mockResolvedValue({ cid: "Qm" });
    await handlers["ipfs:add-content"]({}, { content: "data", options: null });
    expect(mockManager.addContent).toHaveBeenCalledWith("data", {});
  });

  it("ipfs:add-file should pass filePath", async () => {
    mockManager.addFile.mockResolvedValue({ cid: "QmFile" });
    const result = await handlers["ipfs:add-file"](
      {},
      { filePath: "/file.txt", options: {} },
    );
    expect(result.success).toBe(true);
  });

  it("ipfs:get-content converts Buffer to base64", async () => {
    const buf = Buffer.from("test content");
    mockManager.getContent.mockResolvedValue({
      content: buf,
      metadata: { cid: "QmTest" },
    });
    const result = await handlers["ipfs:get-content"](
      {},
      { cid: "QmTest", options: {} },
    );
    expect(result.success).toBe(true);
    expect(result.data.content).toBe(buf.toString("base64"));
    expect(result.data.contentEncoding).toBe("base64");
  });

  it("ipfs:get-file delegates", async () => {
    mockManager.getFile.mockResolvedValue({ path: "/out.txt" });
    const result = await handlers["ipfs:get-file"](
      {},
      { cid: "Qm", outputPath: "/out.txt" },
    );
    expect(result.success).toBe(true);
  });

  it("ipfs:pin delegates", async () => {
    mockManager.pin.mockResolvedValue({ pinned: true });
    const result = await handlers["ipfs:pin"]({}, "Qm123");
    expect(result.success).toBe(true);
  });

  it("ipfs:unpin delegates", async () => {
    mockManager.unpin.mockResolvedValue({ unpinned: true });
    const result = await handlers["ipfs:unpin"]({}, "Qm123");
    expect(result.success).toBe(true);
  });

  it("ipfs:list-pins delegates", async () => {
    mockManager.listPins.mockResolvedValue([{ cid: "QmA" }]);
    const result = await handlers["ipfs:list-pins"]({}, { limit: 10 });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it("ipfs:get-storage-stats returns stats", async () => {
    mockManager.getStorageStats.mockResolvedValue({ totalSize: 1000 });
    const result = await handlers["ipfs:get-storage-stats"]();
    expect(result.success).toBe(true);
    expect(result.data.totalSize).toBe(1000);
  });

  it("ipfs:get-storage-stats error handling", async () => {
    mockManager.getStorageStats.mockRejectedValue(new Error("DB error"));
    const result = await handlers["ipfs:get-storage-stats"]();
    expect(result.success).toBe(false);
    expect(result.error).toBe("DB error");
  });

  it("ipfs:garbage-collect delegates", async () => {
    mockManager.garbageCollect.mockResolvedValue({ removed: 3 });
    const result = await handlers["ipfs:garbage-collect"]();
    expect(result.success).toBe(true);
    expect(result.data.removed).toBe(3);
  });

  it("ipfs:garbage-collect error handling", async () => {
    mockManager.garbageCollect.mockRejectedValue(new Error("GC failed"));
    const result = await handlers["ipfs:garbage-collect"]();
    expect(result.success).toBe(false);
  });

  it("ipfs:set-quota should set and return quota", async () => {
    mockManager.setQuota.mockResolvedValue(undefined);
    mockManager.config.storageQuotaBytes = 2147483648;
    const result = await handlers["ipfs:set-quota"]({}, 2147483648);
    expect(result.success).toBe(true);
    expect(result.data.quotaBytes).toBe(2147483648);
  });

  it("ipfs:set-mode should set mode", async () => {
    mockManager.setMode.mockResolvedValue(undefined);
    mockManager.mode = "external";
    const result = await handlers["ipfs:set-mode"]({}, "external");
    expect(result.success).toBe(true);
    expect(result.data.mode).toBe("external");
  });

  it("ipfs:add-knowledge-attachment delegates", async () => {
    mockManager.addKnowledgeAttachment.mockResolvedValue({ cid: "QmK" });
    const result = await handlers["ipfs:add-knowledge-attachment"](
      {},
      {
        knowledgeId: "n1",
        content: "data",
        metadata: { type: "img" },
      },
    );
    expect(result.success).toBe(true);
    expect(mockManager.addKnowledgeAttachment).toHaveBeenCalledWith(
      "n1",
      "data",
      { type: "img" },
    );
  });

  it("ipfs:get-knowledge-attachment converts to base64", async () => {
    const buf = Buffer.from("attachment");
    mockManager.getKnowledgeAttachment.mockResolvedValue({
      content: buf,
      metadata: {},
    });
    const result = await handlers["ipfs:get-knowledge-attachment"](
      {},
      { knowledgeId: "n1", cid: "Qm" },
    );
    expect(result.success).toBe(true);
    expect(result.data.content).toBe(buf.toString("base64"));
    expect(result.data.contentEncoding).toBe("base64");
  });

  it("ipfs:get-config returns config", async () => {
    mockManager.mode = "embedded";
    const result = await handlers["ipfs:get-config"]();
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("gatewayUrl");
    expect(result.data).toHaveProperty("mode");
    expect(result.data).toHaveProperty("encryptionEnabled");
  });
});
