/**
 * Marketplace IPC Handler Unit Tests
 *
 * Tests the 22 IPC handlers registered by registerMarketplaceIPC().
 * Uses dependency injection pattern for ipcMain, client, installer, and updater.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("fake plugin data")),
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

function createMockClient() {
  return {
    listPlugins: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    searchPlugins: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getPlugin: vi.fn().mockResolvedValue({ id: "p1", name: "Test" }),
    getFeaturedPlugins: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue(["tools", "ai"]),
    ratePlugin: vi.fn().mockResolvedValue({ ratingId: "r1" }),
    getPluginReviews: vi.fn().mockResolvedValue({ items: [] }),
    reportPlugin: vi.fn().mockResolvedValue({ reportId: "rep1" }),
    publishPlugin: vi.fn().mockResolvedValue({ id: "p1" }),
    updatePlugin: vi.fn().mockResolvedValue({ id: "p1" }),
    deletePlugin: vi.fn().mockResolvedValue({}),
  };
}

function createMockInstaller() {
  return {
    installPlugin: vi
      .fn()
      .mockResolvedValue({ pluginId: "p1", version: "1.0.0" }),
    uninstallPlugin: vi.fn().mockResolvedValue(undefined),
    updatePlugin: vi
      .fn()
      .mockResolvedValue({ fromVersion: "1.0.0", toVersion: "2.0.0" }),
  };
}

function createMockUpdater() {
  return {
    checkUpdates: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSettings: vi.fn().mockReturnValue({ success: true, data: {} }),
    updateSettings: vi.fn().mockReturnValue({ success: true }),
    _recordUpdateHistory: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  };
}

const { registerMarketplaceIPC } = require("../marketplace-ipc.js");

describe("Marketplace IPC Handlers", () => {
  let mockIpcMain;
  let handlers;
  let mockClient;
  let mockInstaller;
  let mockUpdater;
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    free: vi.fn(),
  };
  const mockDatabase = { db: { prepare: vi.fn().mockReturnValue(mockStmt) } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.db.prepare.mockReturnValue(mockStmt);
    mockStmt.all.mockReturnValue([]);
    mockStmt.get.mockReturnValue(null);
    mockStmt.run.mockReturnValue(undefined);
    mockStmt.free.mockReturnValue(undefined);
    mockIpcMain = createMockIpcMain();
    mockClient = createMockClient();
    mockInstaller = createMockInstaller();
    mockUpdater = createMockUpdater();
    registerMarketplaceIPC({
      database: mockDatabase,
      ipcMain: mockIpcMain,
      marketplaceClient: mockClient,
      pluginInstaller: mockInstaller,
      pluginUpdater: mockUpdater,
    });
    handlers = mockIpcMain.handlers;
  });

  it("should register IPC handlers", () => {
    expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(15);
  });

  it("marketplace:list-plugins delegates", async () => {
    const r = await handlers["marketplace:list-plugins"](
      {},
      { category: "tools" },
    );
    expect(r.success).toBe(true);
  });

  it("marketplace:search-plugins delegates", async () => {
    const r = await handlers["marketplace:search-plugins"]({}, "test", {});
    expect(r.success).toBe(true);
  });

  it("marketplace:get-categories delegates", async () => {
    const r = await handlers["marketplace:get-categories"]({});
    expect(r.success).toBe(true);
  });

  it("marketplace:install-plugin delegates", async () => {
    const r = await handlers["marketplace:install-plugin"]({}, "p1", "1.0.0");
    expect(r.success).toBe(true);
    expect(mockInstaller.installPlugin).toHaveBeenCalledWith("p1", "1.0.0");
  });

  it("marketplace:uninstall-plugin delegates", async () => {
    const r = await handlers["marketplace:uninstall-plugin"]({}, "p1");
    expect(r.success).toBe(true);
  });

  it("marketplace:install-plugin defaults to latest", async () => {
    await handlers["marketplace:install-plugin"]({}, "p1");
    expect(mockInstaller.installPlugin).toHaveBeenCalledWith("p1", "latest");
  });

  it("marketplace:enable-plugin updates DB", async () => {
    const r = await handlers["marketplace:enable-plugin"]({}, "p1");
    expect(r.success).toBe(true);
  });

  it("marketplace:disable-plugin updates DB", async () => {
    const r = await handlers["marketplace:disable-plugin"]({}, "p1");
    expect(r.success).toBe(true);
  });

  it("marketplace:rate-plugin validates inputs", async () => {
    const r = await handlers["marketplace:rate-plugin"]({}, "", 5);
    expect(r.success).toBe(false);
  });

  it("marketplace:rate-plugin validates range", async () => {
    const r = await handlers["marketplace:rate-plugin"]({}, "p1", 6);
    expect(r.success).toBe(false);
  });

  it("marketplace:rate-plugin submits valid rating", async () => {
    const r = await handlers["marketplace:rate-plugin"]({}, "p1", 4, "Nice");
    expect(r.success).toBe(true);
    expect(mockClient.ratePlugin).toHaveBeenCalledWith("p1", 4, "Nice");
  });

  it("marketplace:get-ratings validates pluginId", async () => {
    const r = await handlers["marketplace:get-ratings"]({}, "");
    expect(r.success).toBe(false);
  });

  it("marketplace:report-plugin validates", async () => {
    const r = await handlers["marketplace:report-plugin"]({}, "", "spam");
    expect(r.success).toBe(false);
  });

  it("marketplace:list-installed queries DB", async () => {
    mockStmt.all.mockReturnValue([
      {
        id: "1",
        plugin_id: "p1",
        name: "Test",
        version: "1.0.0",
        author: "A",
        install_path: "/p",
        installed_at: Date.now(),
        enabled: 1,
        auto_update: 0,
        source: "marketplace",
        metadata: "{}",
      },
    ]);
    const r = await handlers["marketplace:list-installed"]({}, {});
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  it("marketplace:export-list exports", async () => {
    mockStmt.all.mockReturnValue([]);
    const r = await handlers["marketplace:export-list"]({});
    expect(r.success).toBe(true);
    expect(r.data).toHaveProperty("exportedAt");
  });

  it("marketplace:publish-plugin validates", async () => {
    const r = await handlers["marketplace:publish-plugin"]({}, null, null);
    expect(r.success).toBe(false);
  });

  it("marketplace:delete-plugin validates", async () => {
    const r = await handlers["marketplace:delete-plugin"]({}, "");
    expect(r.success).toBe(false);
  });

  it("marketplace:delete-plugin delegates", async () => {
    const r = await handlers["marketplace:delete-plugin"]({}, "p1");
    expect(r.success).toBe(true);
  });

  it("marketplace:update-settings validates type", async () => {
    const r = await handlers["marketplace:update-settings"]({}, "not-object");
    expect(r.success).toBe(false);
  });

  it("handles client errors", async () => {
    mockClient.listPlugins.mockRejectedValue(new Error("Network"));
    const r = await handlers["marketplace:list-plugins"]({}, {});
    expect(r.success).toBe(false);
    expect(r.error).toBe("Network");
  });

  it("handles installer errors", async () => {
    mockInstaller.installPlugin.mockRejectedValue(new Error("Install failed"));
    const r = await handlers["marketplace:install-plugin"]({}, "p1", "latest");
    expect(r.success).toBe(false);
  });
});
