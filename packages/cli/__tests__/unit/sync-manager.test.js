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
