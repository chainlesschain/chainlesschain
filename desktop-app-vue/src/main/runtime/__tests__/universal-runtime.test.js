/**
 * UniversalRuntime unit tests — Phase 98
 *
 * Covers: initialize, loadPlugin, unloadPlugin, hotUpdate, profile,
 *         syncState, getState, getPlatformInfo, configure, healthCheck, getMetrics
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { UniversalRuntime } = require("../universal-runtime");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("UniversalRuntime", () => {
  let runtime;
  let db;

  beforeEach(() => {
    runtime = new UniversalRuntime();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(runtime.initialized).toBe(false);
    expect(runtime._plugins.size).toBe(0);
    expect(runtime._metrics.pluginsLoaded).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await runtime.initialize(db);
    expect(runtime.initialized).toBe(true);
    expect(runtime._startTime).toBeDefined();
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await runtime.initialize(db);
    await runtime.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── loadPlugin ───────────────────────────────────────────────────────────
  it("should load a plugin", async () => {
    await runtime.initialize(db);
    const result = await runtime.loadPlugin({
      id: "my-plugin",
      name: "Test Plugin",
      version: "2.0.0",
    });
    expect(result.id).toBe("my-plugin");
    expect(result.name).toBe("Test Plugin");
    expect(result.version).toBe("2.0.0");
    expect(result.status).toBe("loaded");
  });

  it("should increment pluginsLoaded metric", async () => {
    await runtime.initialize(db);
    await runtime.loadPlugin({ name: "P1" });
    await runtime.loadPlugin({ name: "P2" });
    expect(runtime._metrics.pluginsLoaded).toBe(2);
  });

  it("should emit runtime:plugin-loaded event", async () => {
    await runtime.initialize(db);
    const listener = vi.fn();
    runtime.on("runtime:plugin-loaded", listener);
    await runtime.loadPlugin({ name: "Test" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test" }),
    );
  });

  it("should generate id if not provided", async () => {
    await runtime.initialize(db);
    const result = await runtime.loadPlugin({ name: "AutoID" });
    expect(result.id).toMatch(/^plugin-/);
  });

  // ── unloadPlugin ─────────────────────────────────────────────────────────
  it("should unload an existing plugin", async () => {
    await runtime.initialize(db);
    const plugin = await runtime.loadPlugin({ id: "p1", name: "Test" });
    const result = runtime.unloadPlugin(plugin.id);
    expect(result).toBe(true);
    expect(runtime._plugins.has("p1")).toBe(false);
  });

  it("should return false for unknown plugin unload", async () => {
    await runtime.initialize(db);
    expect(runtime.unloadPlugin("nonexistent")).toBe(false);
  });

  it("should emit runtime:plugin-unloaded event", async () => {
    await runtime.initialize(db);
    const plugin = await runtime.loadPlugin({ id: "p1", name: "Test" });
    const listener = vi.fn();
    runtime.on("runtime:plugin-unloaded", listener);
    runtime.unloadPlugin(plugin.id);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
    );
  });

  // ── hotUpdate ────────────────────────────────────────────────────────────
  it("should hot-update a plugin version", async () => {
    await runtime.initialize(db);
    await runtime.loadPlugin({ id: "p1", name: "Test", version: "1.0.0" });
    const update = await runtime.hotUpdate("p1", "2.0.0");
    expect(update.fromVersion).toBe("1.0.0");
    expect(update.toVersion).toBe("2.0.0");
    expect(update.status).toBe("completed");
  });

  it("should throw when hot-updating unknown plugin", async () => {
    await runtime.initialize(db);
    await expect(runtime.hotUpdate("nonexistent", "2.0.0")).rejects.toThrow(
      "not found",
    );
  });

  it("should increment hotUpdates metric", async () => {
    await runtime.initialize(db);
    await runtime.loadPlugin({ id: "p1", name: "Test", version: "1.0.0" });
    await runtime.hotUpdate("p1", "2.0.0");
    expect(runtime._metrics.hotUpdates).toBe(1);
  });

  it("should emit runtime:hot-updated event", async () => {
    await runtime.initialize(db);
    await runtime.loadPlugin({ id: "p1", name: "Test", version: "1.0.0" });
    const listener = vi.fn();
    runtime.on("runtime:hot-updated", listener);
    await runtime.hotUpdate("p1", "2.0.0");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ fromVersion: "1.0.0", toVersion: "2.0.0" }),
    );
  });

  // ── profile ──────────────────────────────────────────────────────────────
  it("should profile CPU usage", async () => {
    await runtime.initialize(db);
    const result = await runtime.profile("cpu", 1000);
    expect(result.type).toBe("cpu");
    expect(result.duration).toBe(1000);
    expect(result.data.cpu).toBeDefined();
  });

  it("should profile memory usage", async () => {
    await runtime.initialize(db);
    const result = await runtime.profile("memory");
    expect(result.data.memory).toBeDefined();
    expect(result.data.memory.heapUsed).toBeDefined();
  });

  // ── syncState / getState ─────────────────────────────────────────────────
  it("should sync and retrieve state", async () => {
    await runtime.initialize(db);
    runtime.syncState("theme", "dark");
    const state = runtime.getState("theme");
    expect(state.value).toBe("dark");
    expect(state.updatedAt).toBeDefined();
  });

  it("should return null for unknown state key", async () => {
    await runtime.initialize(db);
    expect(runtime.getState("nonexistent")).toBeNull();
  });

  it("should emit runtime:state-synced event", async () => {
    await runtime.initialize(db);
    const listener = vi.fn();
    runtime.on("runtime:state-synced", listener);
    runtime.syncState("key", "value");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ key: "key" }),
    );
  });

  // ── getPlatformInfo ──────────────────────────────────────────────────────
  it("should return platform information", async () => {
    await runtime.initialize(db);
    const info = runtime.getPlatformInfo();
    expect(info.platform).toBeDefined();
    expect(info.arch).toBeDefined();
    expect(info.nodeVersion).toBeDefined();
    expect(info.pid).toBeDefined();
  });

  // ── configure ────────────────────────────────────────────────────────────
  it("should emit runtime:configured event", async () => {
    await runtime.initialize(db);
    const listener = vi.fn();
    runtime.on("runtime:configured", listener);
    runtime.configure({ maxPlugins: 50 });
    expect(listener).toHaveBeenCalled();
  });

  // ── healthCheck ──────────────────────────────────────────────────────────
  it("should return healthy status", async () => {
    await runtime.initialize(db);
    const health = runtime.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.memory).toBeDefined();
    expect(health.plugins).toBe(0);
  });

  // ── getMetrics ───────────────────────────────────────────────────────────
  it("should return metrics", async () => {
    await runtime.initialize(db);
    await runtime.loadPlugin({ name: "P1" });
    runtime.syncState("k", "v");
    const metrics = runtime.getMetrics();
    expect(metrics.pluginsLoaded).toBe(1);
    expect(metrics.activePlugins).toBe(1);
    expect(metrics.syncKeys).toBe(1);
    expect(metrics.uptime).toBeGreaterThanOrEqual(0);
  });
});
