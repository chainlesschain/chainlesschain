/**
 * AppBuilder unit tests — Phase 93
 *
 * Covers: initialize, createApp, saveDesign, preview, publish, listComponents,
 *         addDataSource, testConnection, getVersions, rollback, exportApp
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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
const { AppBuilder } = require("../app-builder");

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
describe("AppBuilder", () => {
  let builder;
  let db;

  beforeEach(() => {
    builder = new AppBuilder();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(builder.initialized).toBe(false);
    expect(builder._apps.size).toBe(0);
    expect(builder._components.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize and load default components", async () => {
    await builder.initialize(db);
    expect(builder.initialized).toBe(true);
    expect(builder._components.size).toBeGreaterThan(0);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await builder.initialize(db);
    await builder.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── createApp ────────────────────────────────────────────────────────────
  it("should create an app", async () => {
    await builder.initialize(db);
    const result = builder.createApp({
      name: "My App",
      description: "Test app",
    });
    expect(result.id).toBeTruthy();
    expect(result.name).toBe("My App");
    expect(result.status).toBe("draft");
  });

  it("should emit lowcode:app-created event", async () => {
    await builder.initialize(db);
    const listener = vi.fn();
    builder.on("lowcode:app-created", listener);
    builder.createApp({ name: "Test" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test" }),
    );
  });

  it("should use custom id if provided", async () => {
    await builder.initialize(db);
    const result = builder.createApp({ id: "custom-id", name: "Test" });
    expect(result.id).toBe("custom-id");
  });

  // ── saveDesign ───────────────────────────────────────────────────────────
  it("should save design and increment version", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    const design = { pages: [{ id: "page-1", components: [] }] };
    const result = builder.saveDesign(app.id, design);
    expect(result.version).toBe(2);
    expect(result.appId).toBe(app.id);
  });

  it("should throw when saving design for unknown app", async () => {
    await builder.initialize(db);
    expect(() => builder.saveDesign("unknown", {})).toThrow("not found");
  });

  it("should emit lowcode:design-saved event", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    const listener = vi.fn();
    builder.on("lowcode:design-saved", listener);
    builder.saveDesign(app.id, {});
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ appId: app.id }),
    );
  });

  // ── preview ──────────────────────────────────────────────────────────────
  it("should return preview data for existing app", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Preview Test" });
    const preview = builder.preview(app.id);
    expect(preview.appId).toBe(app.id);
    expect(preview.previewUrl).toContain(app.id);
  });

  it("should throw for preview of unknown app", async () => {
    await builder.initialize(db);
    expect(() => builder.preview("unknown")).toThrow("not found");
  });

  // ── publish ──────────────────────────────────────────────────────────────
  it("should publish an app", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Publish Test" });
    const result = builder.publish(app.id);
    expect(result.status).toBe("published");
  });

  it("should emit lowcode:app-published event", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    const listener = vi.fn();
    builder.on("lowcode:app-published", listener);
    builder.publish(app.id);
    expect(listener).toHaveBeenCalled();
  });

  // ── listComponents ───────────────────────────────────────────────────────
  it("should list default components", async () => {
    await builder.initialize(db);
    const components = builder.listComponents();
    expect(components.length).toBe(15);
    expect(components.find((c) => c.id === "form")).toBeDefined();
    expect(components.find((c) => c.id === "table")).toBeDefined();
  });

  // ── addDataSource ────────────────────────────────────────────────────────
  it("should add a data source", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    const ds = builder.addDataSource(app.id, "Users DB", "postgresql", {
      host: "localhost",
    });
    expect(ds.id).toMatch(/^ds-/);
    expect(ds.name).toBe("Users DB");
    expect(ds.type).toBe("postgresql");
  });

  // ── testConnection ───────────────────────────────────────────────────────
  it("should test connection for existing data source", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    const ds = builder.addDataSource(app.id, "DB", "mysql", {});
    const result = builder.testConnection(ds.id);
    expect(result.success).toBe(true);
    expect(result.type).toBe("mysql");
  });

  it("should fail connection test for unknown data source", async () => {
    await builder.initialize(db);
    const result = builder.testConnection("unknown");
    expect(result.success).toBe(false);
  });

  // ── getVersions ──────────────────────────────────────────────────────────
  it("should return versions after saving design", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    builder.saveDesign(app.id, { pages: [] });
    const versions = builder.getVersions(app.id);
    expect(versions.length).toBe(1);
  });

  it("should return empty array for app with no versions", async () => {
    await builder.initialize(db);
    expect(builder.getVersions("unknown")).toEqual([]);
  });

  // ── rollback ─────────────────────────────────────────────────────────────
  it("should rollback to a specific version", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    const design1 = { pages: ["v2"] };
    builder.saveDesign(app.id, design1);
    const result = builder.rollback(app.id, 2);
    expect(result.restoredVersion).toBe(2);
  });

  it("should throw for unknown version in rollback", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Test" });
    expect(() => builder.rollback(app.id, 999)).toThrow("Version not found");
  });

  // ── exportApp ────────────────────────────────────────────────────────────
  it("should export app with data sources", async () => {
    await builder.initialize(db);
    const app = builder.createApp({ name: "Export Test" });
    builder.addDataSource(app.id, "DB", "sqlite", {});
    const exported = builder.exportApp(app.id);
    expect(exported.name).toBe("Export Test");
    expect(exported.dataSources).toHaveLength(1);
    expect(exported.exportedAt).toBeDefined();
  });

  it("should return null for unknown app export", async () => {
    await builder.initialize(db);
    expect(builder.exportApp("unknown")).toBeNull();
  });
});
