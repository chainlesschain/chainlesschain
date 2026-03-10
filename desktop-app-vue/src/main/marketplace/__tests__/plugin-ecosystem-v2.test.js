/**
 * PluginEcosystemV2 unit tests — Phase 99
 *
 * Covers: initialize, recommend, install, resolveDependencies, sandboxTest,
 *         aiReview, publish, getRevenue, configure
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
const { PluginEcosystemV2 } = require("../plugin-ecosystem-v2");

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
describe("PluginEcosystemV2", () => {
  let eco;
  let db;

  beforeEach(() => {
    eco = new PluginEcosystemV2();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(eco.initialized).toBe(false);
    expect(eco._plugins.size).toBe(0);
    expect(eco._installHistory).toHaveLength(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await eco.initialize(db);
    expect(eco.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await eco.initialize(db);
    await eco.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── publish ──────────────────────────────────────────────────────────────
  it("should publish a plugin", async () => {
    await eco.initialize(db);
    const result = eco.publish({
      name: "Cool Plugin",
      version: "1.0.0",
      author: "alice",
      category: "tools",
    });
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("Cool Plugin");
    expect(result.status).toBe("published");
  });

  it("should emit ecosystem:published event", async () => {
    await eco.initialize(db);
    const listener = vi.fn();
    eco.on("ecosystem:published", listener);
    eco.publish({ name: "Test Plugin" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test Plugin" }),
    );
  });

  // ── recommend ────────────────────────────────────────────────────────────
  it("should recommend plugins based on profile", async () => {
    await eco.initialize(db);
    eco.publish({ name: "Plugin A", category: "tools", id: "a" });
    eco.publish({ name: "Plugin B", category: "ai", id: "b" });
    const recs = eco.recommend({ categories: ["tools"] });
    expect(recs.length).toBeGreaterThan(0);
    // "tools" category plugin should score higher
    expect(recs[0].category).toBe("tools");
  });

  it("should return empty for empty ecosystem", async () => {
    await eco.initialize(db);
    const recs = eco.recommend({});
    expect(recs).toHaveLength(0);
  });

  it("should limit recommendations to 10", async () => {
    await eco.initialize(db);
    for (let i = 0; i < 15; i++) {
      eco.publish({ name: `Plugin ${i}`, id: `p${i}` });
    }
    const recs = eco.recommend({});
    expect(recs.length).toBeLessThanOrEqual(10);
  });

  // ── install ──────────────────────────────────────────────────────────────
  it("should install an existing plugin", async () => {
    await eco.initialize(db);
    const pub = eco.publish({ name: "Installable", id: "inst-1" });
    const result = await eco.install(pub.id);
    expect(result.installed).toBe(true);
    expect(result.name).toBe("Installable");
  });

  it("should throw when installing unknown plugin", async () => {
    await eco.initialize(db);
    await expect(eco.install("nonexistent")).rejects.toThrow("not found");
  });

  it("should increment download count", async () => {
    await eco.initialize(db);
    eco.publish({ name: "DL Test", id: "dl-1" });
    await eco.install("dl-1");
    await eco.install("dl-1");
    expect(eco._plugins.get("dl-1").downloads).toBe(2);
  });

  it("should emit ecosystem:installed event", async () => {
    await eco.initialize(db);
    eco.publish({ name: "Event Plugin", id: "ev-1" });
    const listener = vi.fn();
    eco.on("ecosystem:installed", listener);
    await eco.install("ev-1");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "ev-1" }),
    );
  });

  // ── resolveDependencies ──────────────────────────────────────────────────
  it("should resolve dependencies when all exist", async () => {
    await eco.initialize(db);
    eco.publish({ name: "dep-a", id: "dep-a" });
    eco.publish({ name: "main-plugin", id: "main", dependencies: ["dep-a"] });
    const result = eco.resolveDependencies("main");
    expect(result.resolved).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.canInstall).toBe(true);
  });

  it("should report conflicts for missing dependencies", async () => {
    await eco.initialize(db);
    eco.publish({
      name: "broken",
      id: "broken",
      dependencies: ["missing-dep"],
    });
    const result = eco.resolveDependencies("broken");
    expect(result.conflicts).toHaveLength(1);
    expect(result.canInstall).toBe(false);
  });

  it("should throw for unknown plugin dependency resolution", async () => {
    await eco.initialize(db);
    expect(() => eco.resolveDependencies("nonexistent")).toThrow("not found");
  });

  // ── sandboxTest ──────────────────────────────────────────────────────────
  it("should run sandbox tests on a plugin", async () => {
    await eco.initialize(db);
    eco.publish({ name: "Safe Plugin", id: "safe-1" });
    const result = await eco.sandboxTest("safe-1");
    expect(result.overall).toBe("passed");
    expect(result.tests).toHaveLength(3);
    expect(result.tests.every((t) => t.status === "passed")).toBe(true);
  });

  it("should throw for sandbox test of unknown plugin", async () => {
    await eco.initialize(db);
    await expect(eco.sandboxTest("nonexistent")).rejects.toThrow("not found");
  });

  // ── aiReview ─────────────────────────────────────────────────────────────
  it("should perform AI code review", async () => {
    await eco.initialize(db);
    eco.publish({ name: "Review Plugin", id: "rev-1" });
    const review = await eco.aiReview("rev-1");
    expect(review.id).toMatch(/^review-/);
    expect(review.score).toBeGreaterThan(0);
    expect(review.securityScore).toBeDefined();
    expect(review.suggestions.length).toBeGreaterThan(0);
  });

  it("should emit ecosystem:reviewed event", async () => {
    await eco.initialize(db);
    eco.publish({ name: "Rev Plugin", id: "rev-2" });
    const listener = vi.fn();
    eco.on("ecosystem:reviewed", listener);
    await eco.aiReview("rev-2");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "rev-2" }),
    );
  });

  it("should throw for AI review of unknown plugin", async () => {
    await eco.initialize(db);
    await expect(eco.aiReview("nonexistent")).rejects.toThrow("not found");
  });

  // ── getRevenue ───────────────────────────────────────────────────────────
  it("should return default revenue for unknown author", async () => {
    await eco.initialize(db);
    const revenue = eco.getRevenue("unknown-author");
    expect(revenue.total).toBe(0);
    expect(revenue.monthly).toBe(0);
  });

  // ── configure ────────────────────────────────────────────────────────────
  it("should emit ecosystem:configured event", async () => {
    await eco.initialize(db);
    const listener = vi.fn();
    eco.on("ecosystem:configured", listener);
    eco.configure({ maxPlugins: 100 });
    expect(listener).toHaveBeenCalled();
  });
});
