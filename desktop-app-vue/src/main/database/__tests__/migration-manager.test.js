import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { MigrationManager } = require("../migration-manager");

describe("MigrationManager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new MigrationManager();
    db = createMockDB();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with empty state", () => {
      expect(manager.db).toBeNull();
      expect(manager.initialized).toBe(false);
      expect(manager._migrations.size).toBe(0);
      expect(manager._applied.size).toBe(0);
    });
  });

  describe("initialize", () => {
    it("should create migration table and load applied migrations", async () => {
      await manager.initialize(db);
      expect(db.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS _migrations"),
      );
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id FROM _migrations"),
      );
      expect(manager.initialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await manager.initialize(db);
      await manager.initialize(db);
      expect(db.exec).toHaveBeenCalledTimes(1);
    });

    it("should load previously applied migrations", async () => {
      db._prep.all.mockReturnValue([{ id: "m1" }, { id: "m2" }]);
      await manager.initialize(db);
      expect(manager._applied.has("m1")).toBe(true);
      expect(manager._applied.has("m2")).toBe(true);
    });
  });

  describe("register", () => {
    it("should register a migration", () => {
      manager.register("001-create-users", {
        version: "1.0.0",
        name: "Create users table",
        up: vi.fn(),
        down: vi.fn(),
      });
      expect(manager._migrations.has("001-create-users")).toBe(true);
    });

    it("should default version and name", () => {
      manager.register("002-add-col", { up: vi.fn() });
      const m = manager._migrations.get("002-add-col");
      expect(m.version).toBe("1.0.0");
      expect(m.name).toBe("002-add-col");
      expect(m.down).toBeNull();
      expect(m.dependencies).toEqual([]);
    });
  });

  describe("runAll", () => {
    it("should run pending migrations in order", async () => {
      await manager.initialize(db);
      const upA = vi.fn();
      const upB = vi.fn();
      manager.register("001", { up: upA });
      manager.register("002", { up: upB });
      const result = await manager.runAll();
      expect(result.applied).toBe(2);
      expect(result.errors).toEqual([]);
      expect(upA).toHaveBeenCalledWith(db);
      expect(upB).toHaveBeenCalledWith(db);
    });

    it("should skip already applied migrations", async () => {
      db._prep.all.mockReturnValue([{ id: "001" }]);
      await manager.initialize(db);
      const up = vi.fn();
      manager.register("001", { up });
      manager.register("002", { up: vi.fn() });
      await manager.runAll();
      expect(up).not.toHaveBeenCalled();
    });

    it("should return no-op result when nothing pending", async () => {
      await manager.initialize(db);
      const result = await manager.runAll();
      expect(result).toEqual({ applied: 0, skipped: 0, errors: [] });
    });

    it("should stop on first error and report it", async () => {
      await manager.initialize(db);
      manager.register("001", {
        up: vi.fn().mockRejectedValue(new Error("fail")),
      });
      manager.register("002", { up: vi.fn() });
      const result = await manager.runAll();
      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe("fail");
    });

    it("should fail when dependency is not yet applied", async () => {
      await manager.initialize(db);
      manager.register("002", { up: vi.fn(), dependencies: ["001"] });
      const result = await manager.runAll();
      expect(result.errors[0].error).toContain(
        "Dependency '001' not yet applied",
      );
    });

    it("should emit migration:applied event", async () => {
      await manager.initialize(db);
      manager.register("001", { up: vi.fn() });
      const spy = vi.fn();
      manager.on("migration:applied", spy);
      await manager.runAll();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "001" }));
    });

    it("should emit migration:error event on failure", async () => {
      await manager.initialize(db);
      manager.register("001", {
        up: vi.fn().mockRejectedValue(new Error("oops")),
      });
      const spy = vi.fn();
      manager.on("migration:error", spy);
      await manager.runAll();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "001", error: "oops" }),
      );
    });

    it("should record applied migration in DB", async () => {
      await manager.initialize(db);
      manager.register("001", { up: vi.fn(), version: "2.0.0", name: "test" });
      await manager.runAll();
      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO _migrations"),
      );
    });
  });

  describe("rollback", () => {
    it("should run the down function and update DB", async () => {
      await manager.initialize(db);
      const down = vi.fn();
      manager.register("001", { up: vi.fn(), down });
      await manager.runAll();
      const result = await manager.rollback("001");
      expect(result.success).toBe(true);
      expect(down).toHaveBeenCalledWith(db);
      expect(manager._applied.has("001")).toBe(false);
    });

    it("should fail for unknown migration", async () => {
      const result = await manager.rollback("missing");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail if migration not applied", async () => {
      manager.register("001", { up: vi.fn(), down: vi.fn() });
      const result = await manager.rollback("001");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not applied");
    });

    it("should fail if migration has no down function", async () => {
      await manager.initialize(db);
      manager.register("001", { up: vi.fn() });
      await manager.runAll();
      const result = await manager.rollback("001");
      expect(result.success).toBe(false);
      expect(result.error).toContain("no down function");
    });

    it("should handle down function errors", async () => {
      await manager.initialize(db);
      manager.register("001", {
        up: vi.fn(),
        down: vi.fn().mockRejectedValue(new Error("rollback fail")),
      });
      await manager.runAll();
      const result = await manager.rollback("001");
      expect(result.success).toBe(false);
      expect(result.error).toBe("rollback fail");
    });

    it("should emit migration:rolled_back event", async () => {
      await manager.initialize(db);
      manager.register("001", { up: vi.fn(), down: vi.fn() });
      await manager.runAll();
      const spy = vi.fn();
      manager.on("migration:rolled_back", spy);
      await manager.rollback("001");
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "001" }));
    });
  });

  describe("getStatus", () => {
    it("should return status of all migrations", async () => {
      await manager.initialize(db);
      manager.register("001", { up: vi.fn(), down: vi.fn(), version: "1.0.0" });
      manager.register("002", { up: vi.fn() });
      await manager.runAll();
      const status = manager.getStatus();
      expect(status.total).toBe(2);
      expect(status.applied).toBe(2);
      expect(status.pending).toBe(0);
      expect(status.migrations[0].hasDown).toBe(true);
      expect(status.migrations[1].hasDown).toBe(false);
    });
  });
});
