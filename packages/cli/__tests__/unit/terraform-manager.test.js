import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureTerraformTables,
  listWorkspaces,
  createWorkspace,
  planRun,
  listRuns,
  _resetState,
} from "../../src/lib/terraform-manager.js";

describe("terraform-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureTerraformTables(db);
  });

  describe("ensureTerraformTables", () => {
    it("creates terraform_workspaces and terraform_runs tables", () => {
      expect(db.tables.has("terraform_workspaces")).toBe(true);
      expect(db.tables.has("terraform_runs")).toBe(true);
    });

    it("is idempotent", () => {
      ensureTerraformTables(db);
      expect(db.tables.has("terraform_workspaces")).toBe(true);
    });
  });

  describe("createWorkspace", () => {
    it("creates a workspace with defaults", () => {
      const ws = createWorkspace(db, "production");
      expect(ws.id).toBeDefined();
      expect(ws.name).toBe("production");
      expect(ws.terraformVersion).toBe("1.9.0");
      expect(ws.status).toBe("active");
      expect(ws.stateVersion).toBe(0);
      expect(ws.providers).toEqual(["hashicorp/aws"]);
    });

    it("throws on missing name", () => {
      expect(() => createWorkspace(db, "")).toThrow(
        "Workspace name is required",
      );
    });

    it("accepts custom options", () => {
      const ws = createWorkspace(db, "staging", {
        description: "Staging env",
        terraformVersion: "1.8.0",
        autoApply: true,
      });
      expect(ws.description).toBe("Staging env");
      expect(ws.terraformVersion).toBe("1.8.0");
      expect(ws.autoApply).toBe(true);
    });

    it("persists to database", () => {
      createWorkspace(db, "test");
      const rows = db.data.get("terraform_workspaces") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique IDs", () => {
      const ws1 = createWorkspace(db, "a");
      const ws2 = createWorkspace(db, "b");
      expect(ws1.id).not.toBe(ws2.id);
    });
  });

  describe("listWorkspaces", () => {
    it("returns empty initially", () => {
      expect(listWorkspaces()).toEqual([]);
    });

    it("lists all workspaces", () => {
      createWorkspace(db, "a");
      createWorkspace(db, "b");
      expect(listWorkspaces().length).toBe(2);
    });

    it("filters by status", () => {
      createWorkspace(db, "active-ws");
      expect(listWorkspaces({ status: "active" }).length).toBe(1);
      expect(listWorkspaces({ status: "archived" }).length).toBe(0);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) createWorkspace(db, `ws-${i}`);
      expect(listWorkspaces({ limit: 3 }).length).toBe(3);
    });
  });

  describe("planRun", () => {
    it("creates a plan run", () => {
      const ws = createWorkspace(db, "test");
      const run = planRun(db, ws.id);
      expect(run.id).toBeDefined();
      expect(run.workspaceId).toBe(ws.id);
      expect(run.runType).toBe("plan");
      expect(run.status).toBe("planned");
      expect(run.resourcesAdded).toBeGreaterThanOrEqual(1);
      expect(run.planOutput).toContain("to add");
    });

    it("throws on unknown workspace", () => {
      expect(() => planRun(db, "nonexistent")).toThrow("Workspace not found");
    });

    it("increments state version", () => {
      const ws = createWorkspace(db, "test");
      planRun(db, ws.id);
      planRun(db, ws.id);
      const workspaces = listWorkspaces();
      expect(workspaces[0].stateVersion).toBe(2);
    });

    it("supports destroy run type", () => {
      const ws = createWorkspace(db, "test");
      const run = planRun(db, ws.id, { runType: "destroy" });
      expect(run.runType).toBe("destroy");
      expect(run.resourcesDestroyed).toBeGreaterThanOrEqual(1);
    });

    it("persists to database", () => {
      const ws = createWorkspace(db, "test");
      planRun(db, ws.id);
      const rows = db.data.get("terraform_runs") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("listRuns", () => {
    it("returns empty initially", () => {
      expect(listRuns()).toEqual([]);
    });

    it("filters by workspace", () => {
      const ws1 = createWorkspace(db, "a");
      const ws2 = createWorkspace(db, "b");
      planRun(db, ws1.id);
      planRun(db, ws2.id);
      expect(listRuns({ workspaceId: ws1.id }).length).toBe(1);
    });
  });
});
