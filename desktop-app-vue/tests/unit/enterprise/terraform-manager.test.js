import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-terraform-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let TerraformManager,
  getTerraformManager,
  RUN_STATUS,
  RUN_TYPES,
  WORKSPACE_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod = await import("../../../src/main/enterprise/terraform-manager.js");
  TerraformManager = mod.TerraformManager;
  getTerraformManager = mod.getTerraformManager;
  RUN_STATUS = mod.RUN_STATUS;
  RUN_TYPES = mod.RUN_TYPES;
  WORKSPACE_STATUS = mod.WORKSPACE_STATUS;
});

describe("Constants", () => {
  it("should define RUN_STATUS", () => {
    expect(RUN_STATUS.PENDING).toBe("pending");
    expect(RUN_STATUS.PLANNING).toBe("planning");
    expect(RUN_STATUS.PLANNED).toBe("planned");
    expect(RUN_STATUS.APPLIED).toBe("applied");
    expect(RUN_STATUS.ERRORED).toBe("errored");
  });

  it("should define RUN_TYPES", () => {
    expect(RUN_TYPES.PLAN).toBe("plan");
    expect(RUN_TYPES.APPLY).toBe("apply");
    expect(RUN_TYPES.DESTROY).toBe("destroy");
  });

  it("should define WORKSPACE_STATUS", () => {
    expect(WORKSPACE_STATUS.ACTIVE).toBe("active");
    expect(WORKSPACE_STATUS.LOCKED).toBe("locked");
    expect(WORKSPACE_STATUS.ARCHIVED).toBe("archived");
  });
});

describe("TerraformManager", () => {
  let manager;

  beforeEach(() => {
    manager = new TerraformManager({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._workspaces).toBeInstanceOf(Map);
      expect(manager._runs).toBeInstanceOf(Map);
      expect(manager._maxConcurrentRuns).toBe(3);
      expect(manager._activeRunCount).toBe(0);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should load workspaces from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        {
          id: "ws1",
          name: "production",
          status: "active",
          variables: "{}",
          providers: '["aws"]',
        },
      ]);
      await manager.initialize();
      expect(manager._workspaces.size).toBe(1);
    });
  });

  describe("_ensureTables()", () => {
    it("should create terraform tables", () => {
      manager._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS terraform_workspaces");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS terraform_runs");
    });

    it("should not throw if database is null", () => {
      const m = new TerraformManager(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  describe("createWorkspace()", () => {
    it("should throw if name is missing", async () => {
      await expect(manager.createWorkspace({})).rejects.toThrow(
        "Workspace name is required",
      );
    });

    it("should throw for duplicate name", async () => {
      manager._workspaces.set("ws1", { name: "production" });
      await expect(
        manager.createWorkspace({ name: "production" }),
      ).rejects.toThrow("Workspace already exists");
    });

    it("should create workspace with defaults", async () => {
      const ws = await manager.createWorkspace({ name: "staging" });
      expect(ws.name).toBe("staging");
      expect(ws.terraform_version).toBe("1.9.0");
      expect(ws.status).toBe("active");
      expect(ws.state_version).toBe(0);
      expect(manager._workspaces.has(ws.id)).toBe(true);
    });

    it("should accept custom parameters", async () => {
      const ws = await manager.createWorkspace({
        name: "custom",
        description: "Custom workspace",
        terraformVersion: "1.8.0",
        providers: ["hashicorp/gcp"],
      });
      expect(ws.terraform_version).toBe("1.8.0");
      expect(ws.providers).toEqual(["hashicorp/gcp"]);
    });

    it("should persist to DB", async () => {
      await manager.createWorkspace({ name: "test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("listWorkspaces()", () => {
    it("should return workspaces from in-memory", async () => {
      const m = new TerraformManager(null);
      m._workspaces.set("ws1", { id: "ws1", name: "prod", status: "active" });
      m._workspaces.set("ws2", {
        id: "ws2",
        name: "staging",
        status: "active",
      });
      const workspaces = await m.listWorkspaces();
      expect(workspaces).toHaveLength(2);
    });

    it("should filter by status", async () => {
      const m = new TerraformManager(null);
      m._workspaces.set("ws1", { id: "ws1", status: "active" });
      m._workspaces.set("ws2", { id: "ws2", status: "archived" });
      const workspaces = await m.listWorkspaces({ status: "active" });
      expect(workspaces).toHaveLength(1);
    });
  });

  describe("planRun()", () => {
    it("should throw if workspaceId is missing", async () => {
      await expect(manager.planRun({})).rejects.toThrow(
        "Workspace ID is required",
      );
    });

    it("should throw if workspace not found", async () => {
      await expect(
        manager.planRun({ workspaceId: "nonexistent" }),
      ).rejects.toThrow("Workspace not found");
    });

    it("should throw if workspace is locked", async () => {
      manager._workspaces.set("ws1", {
        id: "ws1",
        name: "test",
        status: "locked",
      });
      await expect(manager.planRun({ workspaceId: "ws1" })).rejects.toThrow(
        "Workspace is locked",
      );
    });

    it("should throw for invalid run type", async () => {
      manager._workspaces.set("ws1", {
        id: "ws1",
        name: "test",
        status: "active",
      });
      await expect(
        manager.planRun({ workspaceId: "ws1", runType: "invalid" }),
      ).rejects.toThrow("Invalid run type");
    });

    it("should execute plan run", async () => {
      manager._workspaces.set("ws1", {
        id: "ws1",
        name: "test",
        status: "active",
        state_version: 0,
      });
      const run = await manager.planRun({ workspaceId: "ws1" });
      expect(run.run_type).toBe("plan");
      expect(run.status).toBe("planned");
      expect(run.resources_added).toBeGreaterThanOrEqual(0);
      expect(run.plan_output).toBeDefined();
    });

    it("should execute apply run", async () => {
      manager._workspaces.set("ws1", {
        id: "ws1",
        name: "test",
        status: "active",
        state_version: 0,
      });
      const run = await manager.planRun({
        workspaceId: "ws1",
        runType: "apply",
      });
      expect(run.status).toBe("applied");
      expect(run.apply_output).toBeDefined();
    });

    it("should update workspace last_run_id", async () => {
      const ws = {
        id: "ws1",
        name: "test",
        status: "active",
        state_version: 0,
      };
      manager._workspaces.set("ws1", ws);
      await manager.planRun({ workspaceId: "ws1" });
      expect(ws.last_run_id).toBeDefined();
      expect(ws.state_version).toBe(1);
    });
  });

  describe("listRuns()", () => {
    it("should return runs from in-memory", async () => {
      const m = new TerraformManager(null);
      m._runs.set("r1", { id: "r1", workspace_id: "ws1" });
      const runs = await m.listRuns();
      expect(runs).toHaveLength(1);
    });

    it("should filter by workspaceId", async () => {
      const m = new TerraformManager(null);
      m._runs.set("r1", { id: "r1", workspace_id: "ws1" });
      m._runs.set("r2", { id: "r2", workspace_id: "ws2" });
      const runs = await m.listRuns({ workspaceId: "ws1" });
      expect(runs).toHaveLength(1);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._workspaces.set("ws1", {});
      manager._runs.set("r1", {});
      await manager.close();
      expect(manager._workspaces.size).toBe(0);
      expect(manager._runs.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getTerraformManager singleton", () => {
    it("should return an instance", () => {
      const instance = getTerraformManager();
      expect(instance).toBeInstanceOf(TerraformManager);
    });
  });
});
