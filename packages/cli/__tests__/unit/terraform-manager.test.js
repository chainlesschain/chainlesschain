import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureTerraformTables,
  listWorkspaces,
  createWorkspace,
  planRun,
  listRuns,
  _resetState,
  // V2 surface
  RUN_STATUS_V2,
  RUN_TYPE_V2,
  WORKSPACE_STATUS_V2,
  TERRAFORM_DEFAULT_MAX_CONCURRENT,
  setMaxConcurrentRuns,
  getMaxConcurrentRuns,
  createWorkspaceV2,
  setWorkspaceStatus,
  archiveWorkspace,
  planRunV2,
  setRunStatus,
  cancelRun,
  failRun,
  getActiveRunCount,
  getTerraformStatsV2,
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

/* ══════════════════════════════════════════════════════════════
 * V2 Canonical Surface — Phase 56
 * ══════════════════════════════════════════════════════════════ */
describe("terraform-manager V2 (Phase 56)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureTerraformTables(db);
  });

  describe("frozen enums", () => {
    it("RUN_STATUS_V2 has 9 states", () => {
      expect(Object.isFrozen(RUN_STATUS_V2)).toBe(true);
      expect(Object.values(RUN_STATUS_V2).sort()).toEqual(
        [
          "applied",
          "applying",
          "cancelled",
          "destroyed",
          "destroying",
          "errored",
          "pending",
          "planned",
          "planning",
        ].sort(),
      );
    });

    it("RUN_TYPE_V2 has 3 types", () => {
      expect(Object.isFrozen(RUN_TYPE_V2)).toBe(true);
      expect(Object.values(RUN_TYPE_V2).sort()).toEqual(
        ["apply", "destroy", "plan"].sort(),
      );
    });

    it("WORKSPACE_STATUS_V2 has 3 states", () => {
      expect(Object.isFrozen(WORKSPACE_STATUS_V2)).toBe(true);
      expect(Object.values(WORKSPACE_STATUS_V2).sort()).toEqual(
        ["active", "archived", "locked"].sort(),
      );
    });

    it("exports TERRAFORM_DEFAULT_MAX_CONCURRENT=5", () => {
      expect(TERRAFORM_DEFAULT_MAX_CONCURRENT).toBe(5);
    });
  });

  describe("concurrency limit controls", () => {
    it("defaults to 5 max concurrent runs", () => {
      expect(getMaxConcurrentRuns()).toBe(5);
    });

    it("setMaxConcurrentRuns updates and returns the new value", () => {
      expect(setMaxConcurrentRuns(3)).toBe(3);
      expect(getMaxConcurrentRuns()).toBe(3);
    });

    it("rejects zero or negative", () => {
      expect(() => setMaxConcurrentRuns(0)).toThrow(/positive integer/);
      expect(() => setMaxConcurrentRuns(-1)).toThrow(/positive integer/);
    });

    it("rejects non-number", () => {
      expect(() => setMaxConcurrentRuns("5")).toThrow(/positive integer/);
      expect(() => setMaxConcurrentRuns(NaN)).toThrow(/positive integer/);
    });

    it("floors non-integer", () => {
      expect(setMaxConcurrentRuns(3.7)).toBe(3);
    });

    it("_resetState restores default", () => {
      setMaxConcurrentRuns(10);
      _resetState();
      expect(getMaxConcurrentRuns()).toBe(5);
    });
  });

  describe("createWorkspaceV2", () => {
    it("creates workspace with defaults", () => {
      const ws = createWorkspaceV2(db, { name: "prod" });
      expect(ws.name).toBe("prod");
      expect(ws.status).toBe(WORKSPACE_STATUS_V2.ACTIVE);
    });

    it("rejects missing name", () => {
      expect(() => createWorkspaceV2(db, {})).toThrow(/required/);
    });

    it("rejects duplicate names", () => {
      createWorkspaceV2(db, { name: "prod" });
      expect(() => createWorkspaceV2(db, { name: "prod" })).toThrow(
        /already exists/,
      );
    });

    it("honors custom options", () => {
      const ws = createWorkspaceV2(db, {
        name: "staging",
        description: "Staging env",
        terraformVersion: "1.8.0",
        autoApply: true,
        providers: ["hashicorp/aws", "hashicorp/google"],
      });
      expect(ws.description).toBe("Staging env");
      expect(ws.terraformVersion).toBe("1.8.0");
      expect(ws.autoApply).toBe(true);
      expect(ws.providers).toEqual(["hashicorp/aws", "hashicorp/google"]);
    });
  });

  describe("setWorkspaceStatus state machine", () => {
    it("active → locked is valid", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const result = setWorkspaceStatus(db, ws.id, WORKSPACE_STATUS_V2.LOCKED);
      expect(result.status).toBe("locked");
    });

    it("active → archived is valid", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      setWorkspaceStatus(db, ws.id, WORKSPACE_STATUS_V2.ARCHIVED);
      expect(listWorkspaces()[0].status).toBe("archived");
    });

    it("locked → active is valid", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      setWorkspaceStatus(db, ws.id, WORKSPACE_STATUS_V2.LOCKED);
      setWorkspaceStatus(db, ws.id, WORKSPACE_STATUS_V2.ACTIVE);
      expect(listWorkspaces()[0].status).toBe("active");
    });

    it("archived → active is valid (unarchive)", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      archiveWorkspace(db, ws.id);
      setWorkspaceStatus(db, ws.id, WORKSPACE_STATUS_V2.ACTIVE);
      expect(listWorkspaces()[0].status).toBe("active");
    });

    it("archived → locked is invalid", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      archiveWorkspace(db, ws.id);
      expect(() =>
        setWorkspaceStatus(db, ws.id, WORKSPACE_STATUS_V2.LOCKED),
      ).toThrow(/Invalid workspace status transition/);
    });

    it("rejects unknown status", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      expect(() => setWorkspaceStatus(db, ws.id, "purgatory")).toThrow(
        /Unknown workspace status/,
      );
    });

    it("rejects unknown workspace", () => {
      expect(() =>
        setWorkspaceStatus(db, "nope", WORKSPACE_STATUS_V2.LOCKED),
      ).toThrow(/Workspace not found/);
    });
  });

  describe("archiveWorkspace convenience", () => {
    it("transitions active → archived", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const result = archiveWorkspace(db, ws.id);
      expect(result.status).toBe("archived");
    });
  });

  describe("planRunV2", () => {
    it("rejects archived workspace", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      archiveWorkspace(db, ws.id);
      expect(() => planRunV2(db, { workspaceId: ws.id })).toThrow(
        /archived workspace/,
      );
    });

    it("rejects unknown run type", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      expect(() =>
        planRunV2(db, { workspaceId: ws.id, runType: "obliterate" }),
      ).toThrow(/Unknown run type/);
    });

    it("rejects unknown workspace", () => {
      expect(() => planRunV2(db, { workspaceId: "nope" })).toThrow(
        /Workspace not found/,
      );
    });

    it("defaults to plan runType", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const run = planRunV2(db, { workspaceId: ws.id });
      expect(run.runType).toBe("plan");
      expect(run.status).toBe(RUN_STATUS_V2.PENDING);
    });

    it("accepts apply and destroy", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const apply = planRunV2(db, { workspaceId: ws.id, runType: "apply" });
      expect(apply.runType).toBe("apply");
    });

    it("honors triggeredBy", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const run = planRunV2(db, {
        workspaceId: ws.id,
        triggeredBy: "alice",
      });
      expect(run.triggeredBy).toBe("alice");
    });

    it("enforces concurrency limit", () => {
      setMaxConcurrentRuns(2);
      const ws = createWorkspaceV2(db, { name: "w" });
      planRunV2(db, { workspaceId: ws.id });
      planRunV2(db, { workspaceId: ws.id });
      expect(() => planRunV2(db, { workspaceId: ws.id })).toThrow(
        /Max concurrent runs reached/,
      );
    });

    it("concurrency slots free up after terminal transitions", () => {
      setMaxConcurrentRuns(1);
      const ws = createWorkspaceV2(db, { name: "w" });
      const r1 = planRunV2(db, { workspaceId: ws.id });
      // Terminate r1
      setRunStatus(db, r1.id, RUN_STATUS_V2.CANCELLED);
      // Should allow another run now
      const r2 = planRunV2(db, { workspaceId: ws.id });
      expect(r2.id).toBeDefined();
    });
  });

  describe("setRunStatus state machine", () => {
    let ws;
    beforeEach(() => {
      ws = createWorkspaceV2(db, { name: "w" });
    });

    it("pending → planning is valid", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      const result = setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      expect(result.status).toBe("planning");
    });

    it("full apply lifecycle pending→planning→planned→applying→applied", () => {
      const run = planRunV2(db, { workspaceId: ws.id, runType: "apply" });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNED, {
        planOutput: "+ 3 to add",
      });
      setRunStatus(db, run.id, RUN_STATUS_V2.APPLYING);
      const applied = setRunStatus(db, run.id, RUN_STATUS_V2.APPLIED, {
        applyOutput: "Apply complete",
        resourcesAdded: 3,
      });
      expect(applied.status).toBe("applied");
      expect(applied.planOutput).toBe("+ 3 to add");
      expect(applied.applyOutput).toBe("Apply complete");
      expect(applied.resourcesAdded).toBe(3);
      expect(applied.completedAt).toBeTruthy();
    });

    it("full destroy lifecycle pending→planning→planned→destroying→destroyed", () => {
      const run = planRunV2(db, { workspaceId: ws.id, runType: "destroy" });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNED);
      setRunStatus(db, run.id, RUN_STATUS_V2.DESTROYING);
      const destroyed = setRunStatus(db, run.id, RUN_STATUS_V2.DESTROYED, {
        resourcesDestroyed: 5,
      });
      expect(destroyed.status).toBe("destroyed");
      expect(destroyed.resourcesDestroyed).toBe(5);
    });

    it("bumps workspace.stateVersion on APPLIED", () => {
      const run = planRunV2(db, { workspaceId: ws.id, runType: "apply" });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNED);
      setRunStatus(db, run.id, RUN_STATUS_V2.APPLYING);
      setRunStatus(db, run.id, RUN_STATUS_V2.APPLIED);
      expect(listWorkspaces()[0].stateVersion).toBe(1);
      expect(listWorkspaces()[0].lastRunId).toBe(run.id);
    });

    it("bumps workspace.stateVersion on DESTROYED", () => {
      const run = planRunV2(db, { workspaceId: ws.id, runType: "destroy" });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNED);
      setRunStatus(db, run.id, RUN_STATUS_V2.DESTROYING);
      setRunStatus(db, run.id, RUN_STATUS_V2.DESTROYED);
      expect(listWorkspaces()[0].stateVersion).toBe(1);
    });

    it("does not bump stateVersion on ERRORED", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, run.id, RUN_STATUS_V2.ERRORED, {
        errorMessage: "boom",
      });
      expect(listWorkspaces()[0].stateVersion).toBe(0);
    });

    it("rejects invalid transition planned → applied (skip applying)", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNED);
      expect(() => setRunStatus(db, run.id, RUN_STATUS_V2.APPLIED)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("rejects further transitions from terminal state", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      setRunStatus(db, run.id, RUN_STATUS_V2.CANCELLED);
      expect(() => setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("rejects unknown run status", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      expect(() => setRunStatus(db, run.id, "zombied")).toThrow(
        /Unknown run status/,
      );
    });

    it("rejects unknown runId", () => {
      expect(() => setRunStatus(db, "nope", RUN_STATUS_V2.PLANNING)).toThrow(
        /Run not found/,
      );
    });

    it("terminal status sets completedAt", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      const cancelled = setRunStatus(db, run.id, RUN_STATUS_V2.CANCELLED);
      expect(cancelled.completedAt).toBeTruthy();
      expect(typeof cancelled.completedAt).toBe("string");
    });

    it("non-terminal status does not set completedAt", () => {
      const run = planRunV2(db, { workspaceId: ws.id });
      const planning = setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      expect(planning.completedAt).toBeNull();
    });
  });

  describe("cancelRun convenience", () => {
    it("cancels a pending run", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const run = planRunV2(db, { workspaceId: ws.id });
      const result = cancelRun(db, run.id);
      expect(result.status).toBe("cancelled");
    });
  });

  describe("failRun convenience", () => {
    it("fails a run and records error message", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const run = planRunV2(db, { workspaceId: ws.id });
      setRunStatus(db, run.id, RUN_STATUS_V2.PLANNING);
      const result = failRun(db, run.id, "provider timeout");
      expect(result.status).toBe("errored");
      expect(result.errorMessage).toBe("provider timeout");
    });
  });

  describe("getActiveRunCount", () => {
    it("counts pending/planning/applying/destroying", () => {
      const ws = createWorkspaceV2(db, { name: "w" });
      const r1 = planRunV2(db, { workspaceId: ws.id });
      const r2 = planRunV2(db, { workspaceId: ws.id });
      expect(getActiveRunCount()).toBe(2);
      setRunStatus(db, r1.id, RUN_STATUS_V2.CANCELLED);
      expect(getActiveRunCount()).toBe(1);
      setRunStatus(db, r2.id, RUN_STATUS_V2.PLANNING);
      expect(getActiveRunCount()).toBe(1);
    });
  });

  describe("getTerraformStatsV2", () => {
    it("returns zero-state shape with all enum keys", () => {
      const stats = getTerraformStatsV2();
      expect(stats.totalWorkspaces).toBe(0);
      expect(stats.totalRuns).toBe(0);
      expect(stats.activeRuns).toBe(0);
      expect(stats.maxConcurrentRuns).toBe(5);
      for (const s of Object.values(WORKSPACE_STATUS_V2)) {
        expect(stats.workspacesByStatus[s]).toBe(0);
      }
      for (const s of Object.values(RUN_STATUS_V2)) {
        expect(stats.runsByStatus[s]).toBe(0);
      }
      for (const t of Object.values(RUN_TYPE_V2)) {
        expect(stats.runsByType[t]).toBe(0);
      }
      expect(stats.totalResources).toEqual({
        added: 0,
        changed: 0,
        destroyed: 0,
      });
    });

    it("aggregates correctly after activity", () => {
      const ws1 = createWorkspaceV2(db, { name: "a" });
      createWorkspaceV2(db, { name: "b" });
      archiveWorkspace(db, ws1.id);

      const ws2 = createWorkspaceV2(db, { name: "c" });
      const r1 = planRunV2(db, { workspaceId: ws2.id, runType: "apply" });
      setRunStatus(db, r1.id, RUN_STATUS_V2.PLANNING);
      setRunStatus(db, r1.id, RUN_STATUS_V2.PLANNED);
      setRunStatus(db, r1.id, RUN_STATUS_V2.APPLYING);
      setRunStatus(db, r1.id, RUN_STATUS_V2.APPLIED, {
        resourcesAdded: 4,
        resourcesChanged: 2,
      });
      const r2 = planRunV2(db, { workspaceId: ws2.id, runType: "destroy" });
      // r2 stays pending

      const stats = getTerraformStatsV2();
      expect(stats.totalWorkspaces).toBe(3);
      expect(stats.totalRuns).toBe(2);
      expect(stats.activeRuns).toBe(1);
      expect(stats.workspacesByStatus.archived).toBe(1);
      expect(stats.workspacesByStatus.active).toBe(2);
      expect(stats.runsByStatus.applied).toBe(1);
      expect(stats.runsByStatus.pending).toBe(1);
      expect(stats.runsByType.apply).toBe(1);
      expect(stats.runsByType.destroy).toBe(1);
      expect(stats.totalResources.added).toBe(4);
      expect(stats.totalResources.changed).toBe(2);
    });
  });
});
