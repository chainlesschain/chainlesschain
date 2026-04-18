import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSyncTables,
  computeChecksum,
  registerResource,
  getSyncState,
  getAllSyncStates,
  updateSyncState,
  createConflict,
  getConflicts,
  resolveConflict,
  logSyncOperation,
  getSyncLog,
  getSyncStatus,
  pushResources,
  pullResources,
  clearSyncData,
} from "../../src/lib/sync-manager.js";

describe("Sync Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureSyncTables ─────────────────────────────────

  describe("ensureSyncTables", () => {
    it("should create sync tables", () => {
      ensureSyncTables(db);
      expect(db.tables.has("sync_state")).toBe(true);
      expect(db.tables.has("sync_conflicts")).toBe(true);
      expect(db.tables.has("sync_log")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureSyncTables(db);
      ensureSyncTables(db);
      expect(db.tables.has("sync_state")).toBe(true);
    });
  });

  // ─── computeChecksum ──────────────────────────────────

  describe("computeChecksum", () => {
    it("should compute SHA-256 checksum", () => {
      const hash = computeChecksum("hello world");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should be consistent for same input", () => {
      expect(computeChecksum("test")).toBe(computeChecksum("test"));
    });

    it("should be different for different input", () => {
      expect(computeChecksum("a")).not.toBe(computeChecksum("b"));
    });
  });

  // ─── registerResource ─────────────────────────────────

  describe("registerResource", () => {
    it("should register a resource", () => {
      const r = registerResource(db, "note", "note-1", "abc123");
      expect(r.id).toMatch(/^sync-/);
      expect(r.resourceType).toBe("note");
      expect(r.resourceId).toBe("note-1");
      expect(r.status).toBe("pending");
    });
  });

  // ─── getSyncState ─────────────────────────────────────

  describe("getSyncState", () => {
    it("should get sync state for a resource", () => {
      registerResource(db, "note", "note-1", "abc");
      const state = getSyncState(db, "note", "note-1");
      expect(state).toBeDefined();
      expect(state.resource_type).toBe("note");
    });

    it("should return null for non-existent resource", () => {
      ensureSyncTables(db);
      expect(getSyncState(db, "note", "nope")).toBeNull();
    });
  });

  // ─── getAllSyncStates ──────────────────────────────────

  describe("getAllSyncStates", () => {
    it("should list all sync states", () => {
      registerResource(db, "note", "note-1");
      registerResource(db, "note", "note-2");
      const states = getAllSyncStates(db);
      expect(states).toHaveLength(2);
    });

    it("should filter by status", () => {
      registerResource(db, "note", "note-1");
      const states = getAllSyncStates(db, { status: "pending" });
      expect(states).toHaveLength(1);
    });

    it("should return empty array when no states", () => {
      ensureSyncTables(db);
      expect(getAllSyncStates(db)).toHaveLength(0);
    });
  });

  // ─── updateSyncState ──────────────────────────────────

  describe("updateSyncState", () => {
    it("should update sync state", () => {
      const r = registerResource(db, "note", "note-1");
      const ok = updateSyncState(db, r.id, { status: "synced" });
      expect(ok).toBe(true);
    });
  });

  // ─── createConflict / getConflicts / resolveConflict ──

  describe("createConflict", () => {
    it("should create a conflict record", () => {
      const conflict = createConflict(
        db,
        "note",
        "note-1",
        { text: "local" },
        { text: "remote" },
      );
      expect(conflict.id).toMatch(/^conflict-/);
      expect(conflict.status).toBe("unresolved");
    });
  });

  describe("getConflicts", () => {
    it("should list unresolved conflicts", () => {
      createConflict(db, "note", "note-1", "local", "remote");
      const conflicts = getConflicts(db);
      expect(conflicts).toHaveLength(1);
    });

    it("should return empty when no conflicts", () => {
      ensureSyncTables(db);
      expect(getConflicts(db)).toHaveLength(0);
    });
  });

  describe("resolveConflict", () => {
    it("should resolve a conflict", () => {
      const conflict = createConflict(db, "note", "note-1", "local", "remote");
      const ok = resolveConflict(db, conflict.id, "local");
      expect(ok).toBe(true);
    });

    it("should return false for non-existent conflict", () => {
      ensureSyncTables(db);
      expect(resolveConflict(db, "conflict-nope", "local")).toBe(false);
    });
  });

  // ─── logSyncOperation / getSyncLog ────────────────────

  describe("logSyncOperation", () => {
    it("should log a sync operation", () => {
      const log = logSyncOperation(db, "push", "note", "note-1", "success");
      expect(log.id).toMatch(/^slog-/);
      expect(log.operation).toBe("push");
    });
  });

  describe("getSyncLog", () => {
    it("should list log entries", () => {
      logSyncOperation(db, "push", "note", "note-1", "success");
      logSyncOperation(db, "pull", null, null, "success");
      const logs = getSyncLog(db);
      expect(logs).toHaveLength(2);
    });

    it("should return empty when no logs", () => {
      ensureSyncTables(db);
      expect(getSyncLog(db)).toHaveLength(0);
    });
  });

  // ─── getSyncStatus ────────────────────────────────────

  describe("getSyncStatus", () => {
    it("should return sync status summary", () => {
      registerResource(db, "note", "note-1");
      const status = getSyncStatus(db);
      expect(status.totalResources).toBe(1);
      expect(status.pending).toBe(1);
      expect(status.synced).toBe(0);
      expect(status.conflicts).toBe(0);
    });

    it("should count conflicts", () => {
      createConflict(db, "note", "note-1", "local", "remote");
      const status = getSyncStatus(db);
      expect(status.conflicts).toBe(1);
    });
  });

  // ─── pushResources / pullResources ────────────────────

  describe("pushResources", () => {
    it("should push pending resources", () => {
      registerResource(db, "note", "note-1");
      registerResource(db, "note", "note-2");
      const result = pushResources(db);
      expect(result.pushed).toBe(2);
    });

    it("should return zero when nothing to push", () => {
      ensureSyncTables(db);
      const result = pushResources(db);
      expect(result.pushed).toBe(0);
    });
  });

  describe("pullResources", () => {
    it("should check for remote updates", () => {
      const result = pullResources(db);
      expect(result.checked).toBeDefined();
      expect(result.updated).toBe(0);
    });
  });

  // ─── clearSyncData ────────────────────────────────────

  describe("clearSyncData", () => {
    it("should clear all sync data", () => {
      registerResource(db, "note", "note-1");
      logSyncOperation(db, "push", "note", "note-1", "success");
      createConflict(db, "note", "note-1", "local", "remote");
      clearSyncData(db);

      const status = getSyncStatus(db);
      expect(status.totalResources).toBe(0);
      expect(status.conflicts).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// V2 Surface tests — Sync Manager governance layer
// ═══════════════════════════════════════════════════════════════

import {
  RESOURCE_MATURITY_V2,
  SYNC_RUN_V2,
  SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER,
  SYNC_DEFAULT_MAX_RUNNING_RUNS_PER_RESOURCE,
  SYNC_DEFAULT_RESOURCE_IDLE_MS,
  SYNC_DEFAULT_RUN_STUCK_MS,
  getMaxActiveResourcesPerOwnerV2,
  setMaxActiveResourcesPerOwnerV2,
  getMaxRunningRunsPerResourceV2,
  setMaxRunningRunsPerResourceV2,
  getResourceIdleMsV2,
  setResourceIdleMsV2,
  getRunStuckMsV2,
  setRunStuckMsV2,
  getActiveResourceCountV2,
  getRunningRunCountV2,
  registerResourceV2,
  getResourceV2,
  listResourcesV2,
  setResourceStatusV2,
  activateResourceV2,
  pauseResourceV2,
  archiveResourceV2,
  touchResourceV2,
  createSyncRunV2,
  getSyncRunV2,
  listSyncRunsV2,
  setSyncRunStatusV2,
  startSyncRunV2,
  succeedSyncRunV2,
  failSyncRunV2,
  cancelSyncRunV2,
  autoArchiveIdleResourcesV2,
  autoFailStuckSyncRunsV2,
  getSyncManagerStatsV2,
  _resetStateSyncManagerV2,
} from "../../src/lib/sync-manager.js";

describe("Sync Manager V2", () => {
  beforeEach(() => _resetStateSyncManagerV2());

  describe("enums + defaults", () => {
    it("RESOURCE_MATURITY_V2 frozen 4 states", () => {
      expect(Object.values(RESOURCE_MATURITY_V2).sort()).toEqual([
        "active",
        "archived",
        "paused",
        "pending",
      ]);
      expect(Object.isFrozen(RESOURCE_MATURITY_V2)).toBe(true);
    });
    it("SYNC_RUN_V2 frozen 5 states", () => {
      expect(Object.values(SYNC_RUN_V2).sort()).toEqual([
        "cancelled",
        "failed",
        "queued",
        "running",
        "succeeded",
      ]);
      expect(Object.isFrozen(SYNC_RUN_V2)).toBe(true);
    });
    it("default config", () => {
      expect(SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER).toBe(200);
      expect(SYNC_DEFAULT_MAX_RUNNING_RUNS_PER_RESOURCE).toBe(1);
      expect(SYNC_DEFAULT_RESOURCE_IDLE_MS).toBe(1000 * 60 * 60 * 24 * 30);
      expect(SYNC_DEFAULT_RUN_STUCK_MS).toBe(1000 * 60 * 15);
    });
  });

  describe("config setters", () => {
    it("max-active-resources rejects non-positive", () => {
      expect(() => setMaxActiveResourcesPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveResourcesPerOwnerV2(-1)).toThrow();
      setMaxActiveResourcesPerOwnerV2(50);
      expect(getMaxActiveResourcesPerOwnerV2()).toBe(50);
    });
    it("max-running-runs floors non-integer", () => {
      setMaxRunningRunsPerResourceV2(3.9);
      expect(getMaxRunningRunsPerResourceV2()).toBe(3);
    });
    it("resource-idle-ms + run-stuck-ms setters", () => {
      setResourceIdleMsV2(1000);
      setRunStuckMsV2(500);
      expect(getResourceIdleMsV2()).toBe(1000);
      expect(getRunStuckMsV2()).toBe(500);
    });
  });

  describe("registerResourceV2", () => {
    it("creates pending resource", () => {
      const r = registerResourceV2("r1", {
        owner: "alice",
        kind: "file",
        now: 100,
      });
      expect(r.status).toBe("pending");
      expect(r.owner).toBe("alice");
      expect(r.kind).toBe("file");
      expect(r.createdAt).toBe(100);
      expect(r.activatedAt).toBeNull();
    });
    it("rejects bad inputs", () => {
      expect(() => registerResourceV2("")).toThrow();
      expect(() => registerResourceV2("r1", { kind: "file" })).toThrow();
      expect(() => registerResourceV2("r1", { owner: "x" })).toThrow();
    });
    it("rejects duplicate", () => {
      registerResourceV2("r1", { owner: "a", kind: "file" });
      expect(() =>
        registerResourceV2("r1", { owner: "a", kind: "file" }),
      ).toThrow();
    });
    it("returns defensive copy", () => {
      const r = registerResourceV2("r1", {
        owner: "a",
        kind: "file",
        metadata: { tag: "x" },
      });
      r.metadata.tag = "MUTATED";
      const fresh = getResourceV2("r1");
      expect(fresh.metadata.tag).toBe("x");
    });
  });

  describe("resource lifecycle", () => {
    beforeEach(() =>
      registerResourceV2("r1", { owner: "a", kind: "file", now: 0 }),
    );
    it("pending → active stamps activatedAt", () => {
      const r = activateResourceV2("r1", { now: 50 });
      expect(r.status).toBe("active");
      expect(r.activatedAt).toBe(50);
    });
    it("activatedAt stamp-once across paused→active recovery", () => {
      activateResourceV2("r1", { now: 50 });
      pauseResourceV2("r1", { now: 60 });
      const r = activateResourceV2("r1", { now: 70 });
      expect(r.activatedAt).toBe(50);
    });
    it("archived terminal sticks", () => {
      archiveResourceV2("r1", { now: 100 });
      expect(() => activateResourceV2("r1", { now: 200 })).toThrow(/terminal/);
    });
    it("rejects illegal transitions", () => {
      expect(() => setResourceStatusV2("r1", "paused")).toThrow(/cannot/);
      expect(() => setResourceStatusV2("r1", "bogus")).toThrow(/unknown/);
    });
    it("paused→active is recovery (no cap charge for new pendings)", () => {
      // recovery exempt from cap; verified in the cap test below
      activateResourceV2("r1", { now: 1 });
      pauseResourceV2("r1", { now: 2 });
      const r = activateResourceV2("r1", { now: 3 });
      expect(r.status).toBe("active");
    });
  });

  describe("per-owner active-resource cap", () => {
    it("enforces on pending→active only", () => {
      setMaxActiveResourcesPerOwnerV2(2);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      registerResourceV2("r2", { owner: "a", kind: "file" });
      registerResourceV2("r3", { owner: "a", kind: "file" });
      activateResourceV2("r1");
      activateResourceV2("r2");
      expect(() => activateResourceV2("r3")).toThrow(/active-resource cap/);
    });
    it("recovery transition (paused→active) exempt from cap", () => {
      setMaxActiveResourcesPerOwnerV2(2);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      registerResourceV2("r2", { owner: "a", kind: "file" });
      activateResourceV2("r1");
      activateResourceV2("r2");
      pauseResourceV2("r1");
      // r2 still active = at cap; r1 recovers without penalty
      activateResourceV2("r1");
      expect(getActiveResourceCountV2("a")).toBe(2);
    });
  });

  describe("touchResourceV2", () => {
    it("updates lastSeenAt", () => {
      registerResourceV2("r1", { owner: "a", kind: "file", now: 0 });
      const r = touchResourceV2("r1", { now: 999 });
      expect(r.lastSeenAt).toBe(999);
    });
    it("throws if not found", () => {
      expect(() => touchResourceV2("nope")).toThrow(/not found/);
    });
  });

  describe("createSyncRunV2", () => {
    it("creates queued run", () => {
      registerResourceV2("r1", { owner: "a", kind: "file" });
      const j = createSyncRunV2("j1", { resourceId: "r1", now: 100 });
      expect(j.status).toBe("queued");
      expect(j.resourceId).toBe("r1");
      expect(j.kind).toBe("push");
      expect(j.startedAt).toBeNull();
    });
    it("rejects bad inputs / duplicates", () => {
      expect(() => createSyncRunV2("")).toThrow();
      expect(() => createSyncRunV2("j1", {})).toThrow();
      createSyncRunV2("j1", { resourceId: "r1" });
      expect(() => createSyncRunV2("j1", { resourceId: "r1" })).toThrow();
    });
  });

  describe("sync-run lifecycle", () => {
    beforeEach(() => {
      registerResourceV2("r1", { owner: "a", kind: "file" });
      createSyncRunV2("j1", { resourceId: "r1", now: 0 });
    });
    it("queued → running stamps startedAt", () => {
      const j = startSyncRunV2("j1", { now: 50 });
      expect(j.status).toBe("running");
      expect(j.startedAt).toBe(50);
    });
    it("running terminal stamps finishedAt", () => {
      startSyncRunV2("j1", { now: 50 });
      const j = succeedSyncRunV2("j1", { now: 100 });
      expect(j.status).toBe("succeeded");
      expect(j.finishedAt).toBe(100);
      expect(j.startedAt).toBe(50);
    });
    it("failed/cancelled also stamp finishedAt", () => {
      startSyncRunV2("j1", { now: 50 });
      const f = failSyncRunV2("j1", { now: 80 });
      expect(f.finishedAt).toBe(80);
    });
    it("cancelled from queued (without start) is allowed", () => {
      const j = cancelSyncRunV2("j1", { now: 30 });
      expect(j.status).toBe("cancelled");
      expect(j.finishedAt).toBe(30);
      expect(j.startedAt).toBeNull();
    });
    it("terminal sticks", () => {
      startSyncRunV2("j1");
      succeedSyncRunV2("j1");
      expect(() => failSyncRunV2("j1")).toThrow(/terminal/);
    });
    it("rejects illegal transitions", () => {
      expect(() => succeedSyncRunV2("j1")).toThrow(/cannot/);
      expect(() => setSyncRunStatusV2("j1", "bogus")).toThrow(/unknown/);
    });
  });

  describe("per-resource running-sync cap", () => {
    it("enforces on queued→running", () => {
      setMaxRunningRunsPerResourceV2(1);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      createSyncRunV2("j1", { resourceId: "r1" });
      createSyncRunV2("j2", { resourceId: "r1" });
      startSyncRunV2("j1");
      expect(() => startSyncRunV2("j2")).toThrow(/running-run cap/);
    });
    it("count releases when run completes", () => {
      setMaxRunningRunsPerResourceV2(1);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      createSyncRunV2("j1", { resourceId: "r1" });
      createSyncRunV2("j2", { resourceId: "r1" });
      startSyncRunV2("j1");
      succeedSyncRunV2("j1");
      // now slot available
      const j = startSyncRunV2("j2");
      expect(j.status).toBe("running");
    });
  });

  describe("listResourcesV2 / listSyncRunsV2", () => {
    it("filters by owner / kind / status", () => {
      registerResourceV2("r1", { owner: "a", kind: "file" });
      registerResourceV2("r2", { owner: "b", kind: "file" });
      registerResourceV2("r3", { owner: "a", kind: "note" });
      activateResourceV2("r1");
      expect(listResourcesV2({ owner: "a" })).toHaveLength(2);
      expect(listResourcesV2({ kind: "file" })).toHaveLength(2);
      expect(listResourcesV2({ status: "active" })).toHaveLength(1);
    });
    it("filters runs by resource / status", () => {
      registerResourceV2("r1", { owner: "a", kind: "file" });
      createSyncRunV2("j1", { resourceId: "r1" });
      createSyncRunV2("j2", { resourceId: "r1" });
      startSyncRunV2("j1");
      expect(listSyncRunsV2({ resourceId: "r1" })).toHaveLength(2);
      expect(listSyncRunsV2({ status: "running" })).toHaveLength(1);
    });
  });

  describe("autoArchiveIdleResourcesV2", () => {
    it("archives idle non-pending non-archived resources", () => {
      setResourceIdleMsV2(100);
      registerResourceV2("r1", { owner: "a", kind: "file", now: 0 });
      registerResourceV2("r2", { owner: "a", kind: "file", now: 0 });
      activateResourceV2("r1", { now: 0 });
      activateResourceV2("r2", { now: 0 });
      const flipped = autoArchiveIdleResourcesV2({ now: 200 });
      expect(flipped).toHaveLength(2);
      expect(flipped.every((r) => r.status === "archived")).toBe(true);
    });
    it("skips pending and archived", () => {
      setResourceIdleMsV2(100);
      registerResourceV2("r1", { owner: "a", kind: "file", now: 0 });
      // r1 stays pending
      const flipped = autoArchiveIdleResourcesV2({ now: 1000 });
      expect(flipped).toHaveLength(0);
    });
    it("preserves archivedAt", () => {
      setResourceIdleMsV2(50);
      registerResourceV2("r1", { owner: "a", kind: "file", now: 0 });
      activateResourceV2("r1", { now: 0 });
      autoArchiveIdleResourcesV2({ now: 200 });
      expect(getResourceV2("r1").archivedAt).toBe(200);
    });
  });

  describe("autoFailStuckSyncRunsV2", () => {
    it("fails running runs past stuck threshold", () => {
      setRunStuckMsV2(100);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      createSyncRunV2("j1", { resourceId: "r1", now: 0 });
      startSyncRunV2("j1", { now: 0 });
      const flipped = autoFailStuckSyncRunsV2({ now: 200 });
      expect(flipped).toHaveLength(1);
      expect(flipped[0].status).toBe("failed");
      expect(flipped[0].finishedAt).toBe(200);
    });
    it("skips queued/terminal runs", () => {
      setRunStuckMsV2(100);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      createSyncRunV2("j1", { resourceId: "r1", now: 0 });
      // never started
      const flipped = autoFailStuckSyncRunsV2({ now: 1000 });
      expect(flipped).toHaveLength(0);
    });
  });

  describe("getSyncManagerStatsV2", () => {
    it("zero-init contains all enum keys", () => {
      const s = getSyncManagerStatsV2();
      expect(s.totalResourcesV2).toBe(0);
      expect(s.totalSyncRunsV2).toBe(0);
      expect(s.resourcesByStatus.pending).toBe(0);
      expect(s.resourcesByStatus.active).toBe(0);
      expect(s.resourcesByStatus.paused).toBe(0);
      expect(s.resourcesByStatus.archived).toBe(0);
      expect(s.runsByStatus.queued).toBe(0);
      expect(s.runsByStatus.running).toBe(0);
      expect(s.runsByStatus.succeeded).toBe(0);
      expect(s.runsByStatus.failed).toBe(0);
      expect(s.runsByStatus.cancelled).toBe(0);
    });
    it("reflects live state", () => {
      registerResourceV2("r1", { owner: "a", kind: "file" });
      activateResourceV2("r1");
      createSyncRunV2("j1", { resourceId: "r1" });
      startSyncRunV2("j1");
      const s = getSyncManagerStatsV2();
      expect(s.resourcesByStatus.active).toBe(1);
      expect(s.runsByStatus.running).toBe(1);
    });
  });

  describe("_resetStateSyncManagerV2", () => {
    it("clears state and restores defaults", () => {
      setMaxActiveResourcesPerOwnerV2(1);
      registerResourceV2("r1", { owner: "a", kind: "file" });
      _resetStateSyncManagerV2();
      expect(getMaxActiveResourcesPerOwnerV2()).toBe(
        SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER,
      );
      expect(getResourceV2("r1")).toBeNull();
    });
  });
});
