import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

import {
  MIGRATION_STATUS,
  MIGRATION_DIRECTION,
  SUGGESTION_TYPE,
  ensureDbEvoTables,
  registerMigration,
  listRegisteredMigrations,
  getCurrentVersion,
  getPendingMigrations,
  migrateUp,
  migrateDown,
  getMigrationHistory,
  getMigrationStatus,
  validateMigrations,
  logQuery,
  getQueryStats,
  setSlowQueryThreshold,
  clearQueryLog,
  analyzeQueries,
  listSuggestions,
  getSuggestion,
  applySuggestion,
  getDbEvoStats,
  _resetState,
} from "../../src/lib/dbevo.js";

describe("dbevo", () => {
  let db;

  beforeEach(() => {
    _resetState();
    db = new MockDatabase();
    ensureDbEvoTables(db);
  });

  /* ── Schema ──────────────────────────────────────── */

  describe("ensureDbEvoTables", () => {
    it("creates all three tables", () => {
      expect(db.tables.has("_migrations")).toBe(true);
      expect(db.tables.has("_query_log")).toBe(true);
      expect(db.tables.has("_index_suggestions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureDbEvoTables(db);
      expect(db.tables.has("_migrations")).toBe(true);
    });
  });

  /* ── Catalogs ────────────────────────────────────── */

  describe("catalogs", () => {
    it("has 3 migration statuses", () => {
      expect(Object.keys(MIGRATION_STATUS)).toHaveLength(3);
    });

    it("has 2 migration directions", () => {
      expect(Object.keys(MIGRATION_DIRECTION)).toHaveLength(2);
    });

    it("has 3 suggestion types", () => {
      expect(Object.keys(SUGGESTION_TYPE)).toHaveLength(3);
    });
  });

  /* ── Migration Registration ──────────────────────── */

  describe("registerMigration", () => {
    it("registers a migration with up SQL", () => {
      const r = registerMigration("001", {
        upSql: "CREATE TABLE foo (id TEXT)",
        description: "Add foo table",
      });
      expect(r.registered).toBe(true);
      expect(r.version).toBe("001");
      expect(r.checksum).toBeTruthy();
    });

    it("registers with up and down SQL", () => {
      const r = registerMigration("001", {
        upSql: "CREATE TABLE foo (id TEXT)",
        downSql: "DROP TABLE foo",
      });
      expect(r.registered).toBe(true);
    });

    it("rejects missing version", () => {
      const r = registerMigration("", { upSql: "CREATE TABLE x (id TEXT)" });
      expect(r.registered).toBe(false);
      expect(r.reason).toBe("missing_version");
    });

    it("rejects missing up SQL", () => {
      const r = registerMigration("001", {});
      expect(r.registered).toBe(false);
      expect(r.reason).toBe("missing_up_sql");
    });

    it("rejects duplicate version", () => {
      registerMigration("001", { upSql: "CREATE TABLE foo (id TEXT)" });
      const r = registerMigration("001", {
        upSql: "CREATE TABLE bar (id TEXT)",
      });
      expect(r.registered).toBe(false);
      expect(r.reason).toBe("duplicate_version");
    });
  });

  describe("listRegisteredMigrations", () => {
    it("lists registered migrations sorted by version", () => {
      registerMigration("002", { upSql: "ALTER TABLE foo ADD col TEXT" });
      registerMigration("001", {
        upSql: "CREATE TABLE foo (id TEXT)",
        downSql: "DROP TABLE foo",
      });
      const list = listRegisteredMigrations();
      expect(list).toHaveLength(2);
      expect(list[0].version).toBe("001");
      expect(list[0].hasDown).toBe(true);
      expect(list[1].version).toBe("002");
      expect(list[1].hasDown).toBe(false);
    });
  });

  /* ── Migration Execution ─────────────────────────── */

  describe("migrateUp", () => {
    beforeEach(() => {
      registerMigration("001", {
        upSql: "CREATE TABLE a (id TEXT)",
        downSql: "DROP TABLE a",
        description: "Add a",
      });
      registerMigration("002", {
        upSql: "CREATE TABLE b (id TEXT)",
        downSql: "DROP TABLE b",
        description: "Add b",
      });
      registerMigration("003", {
        upSql: "ALTER TABLE b ADD col TEXT",
        description: "Alter b",
      });
    });

    it("migrates all pending versions", () => {
      const r = migrateUp(db);
      expect(r.migrated).toBe(true);
      expect(r.count).toBe(3);
      expect(getCurrentVersion(db)).toBe("003");
    });

    it("migrates to target version", () => {
      const r = migrateUp(db, "002");
      expect(r.migrated).toBe(true);
      expect(r.count).toBe(2);
      expect(getCurrentVersion(db)).toBe("002");
    });

    it("returns no_pending when all migrated", () => {
      migrateUp(db);
      const r = migrateUp(db);
      expect(r.migrated).toBe(false);
      expect(r.reason).toBe("no_pending");
    });
  });

  describe("migrateDown", () => {
    beforeEach(() => {
      registerMigration("001", {
        upSql: "CREATE TABLE a (id TEXT)",
        downSql: "DROP TABLE a",
      });
      registerMigration("002", {
        upSql: "CREATE TABLE b (id TEXT)",
        downSql: "DROP TABLE b",
      });
      migrateUp(db);
    });

    it("rolls back current version", () => {
      const r = migrateDown(db);
      expect(r.rolledBack).toBe(true);
      expect(r.count).toBe(1);
      expect(r.results[0].version).toBe("002");
    });

    it("rolls back to target version", () => {
      registerMigration("003", {
        upSql: "ALTER TABLE b ADD col TEXT",
        downSql: "ALTER TABLE b DROP col",
      });
      migrateUp(db);
      const r = migrateDown(db, "001");
      expect(r.rolledBack).toBe(true);
      expect(r.count).toBe(2);
    });

    it("returns no_current_version when nothing migrated", () => {
      _resetState();
      db = new MockDatabase();
      ensureDbEvoTables(db);
      const r = migrateDown(db);
      expect(r.rolledBack).toBe(false);
      expect(r.reason).toBe("no_current_version");
    });

    it("rejects rollback when missing down SQL", () => {
      _resetState();
      db = new MockDatabase();
      ensureDbEvoTables(db);
      registerMigration("001", { upSql: "CREATE TABLE x (id TEXT)" }); // no downSql
      migrateUp(db);
      const r = migrateDown(db);
      expect(r.rolledBack).toBe(false);
      expect(r.reason).toBe("missing_down_migration");
    });
  });

  describe("getMigrationHistory", () => {
    it("returns history sorted by execution time", () => {
      registerMigration("001", {
        upSql: "CREATE TABLE a (id TEXT)",
        downSql: "DROP TABLE a",
      });
      registerMigration("002", {
        upSql: "CREATE TABLE b (id TEXT)",
        downSql: "DROP TABLE b",
      });
      migrateUp(db);
      const history = getMigrationHistory(db);
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].direction).toBe("up");
    });
  });

  describe("getMigrationStatus", () => {
    it("returns comprehensive status", () => {
      registerMigration("001", { upSql: "CREATE TABLE a (id TEXT)" });
      registerMigration("002", { upSql: "CREATE TABLE b (id TEXT)" });
      migrateUp(db, "001");
      const s = getMigrationStatus(db);
      expect(s.currentVersion).toBe("001");
      expect(s.pendingCount).toBe(1);
      expect(s.pendingVersions).toContain("002");
      expect(s.totalRegistered).toBe(2);
    });
  });

  describe("getCurrentVersion", () => {
    it("returns null when no migrations", () => {
      expect(getCurrentVersion(db)).toBeNull();
    });

    it("returns latest migrated version", () => {
      registerMigration("001", { upSql: "A" });
      registerMigration("002", { upSql: "B" });
      migrateUp(db);
      expect(getCurrentVersion(db)).toBe("002");
    });
  });

  describe("getPendingMigrations", () => {
    it("returns all when none migrated", () => {
      registerMigration("001", { upSql: "A" });
      registerMigration("002", { upSql: "B" });
      expect(getPendingMigrations(db)).toHaveLength(2);
    });

    it("returns only pending after partial migration", () => {
      registerMigration("001", { upSql: "A" });
      registerMigration("002", { upSql: "B" });
      migrateUp(db, "001");
      expect(getPendingMigrations(db)).toHaveLength(1);
    });
  });

  describe("validateMigrations", () => {
    it("returns valid for empty", () => {
      expect(validateMigrations().valid).toBe(true);
    });

    it("detects missing down migration", () => {
      registerMigration("001", { upSql: "A" });
      const r = validateMigrations();
      expect(r.valid).toBe(false);
      expect(r.issues[0].type).toBe("missing_down");
    });

    it("detects version gaps", () => {
      registerMigration("001", { upSql: "A", downSql: "B" });
      registerMigration("005", { upSql: "C", downSql: "D" });
      const r = validateMigrations();
      expect(r.valid).toBe(false);
      expect(r.issues.some((i) => i.type === "gap")).toBe(true);
    });
  });

  /* ── Query Logging ───────────────────────────────── */

  describe("logQuery", () => {
    it("logs a query", () => {
      const r = logQuery(db, "SELECT * FROM notes WHERE id = ?", 15, {
        source: "api",
      });
      expect(r.logged).toBe(true);
      expect(r.id).toBeTruthy();
      expect(r.isSlow).toBe(false);
    });

    it("marks slow queries", () => {
      const r = logQuery(db, "SELECT * FROM notes", 200);
      expect(r.isSlow).toBe(true);
    });

    it("rejects missing SQL", () => {
      const r = logQuery(db, "", 10);
      expect(r.logged).toBe(false);
      expect(r.reason).toBe("missing_sql");
    });

    it("rejects invalid duration", () => {
      const r = logQuery(db, "SELECT 1", -1);
      expect(r.logged).toBe(false);
      expect(r.reason).toBe("invalid_duration");
    });
  });

  describe("getQueryStats", () => {
    it("returns zeros when empty", () => {
      const s = getQueryStats(db);
      expect(s.totalQueries).toBe(0);
      expect(s.slowQueries).toBe(0);
      expect(s.avgDurationMs).toBe(0);
    });

    it("computes stats from logged queries", () => {
      logQuery(db, "SELECT * FROM notes", 50);
      logQuery(db, "SELECT * FROM notes WHERE id = ?", 200);
      logQuery(db, "INSERT INTO notes VALUES (?)", 30);
      const s = getQueryStats(db);
      expect(s.totalQueries).toBe(3);
      expect(s.slowQueries).toBe(1);
      expect(s.avgDurationMs).toBeGreaterThan(0);
      expect(s.maxDurationMs).toBe(200);
      expect(s.topSlow.length).toBeGreaterThan(0);
    });
  });

  describe("setSlowQueryThreshold", () => {
    it("sets threshold", () => {
      const r = setSlowQueryThreshold(50);
      expect(r.set).toBe(true);
      expect(r.thresholdMs).toBe(50);
      // Now a 60ms query should be slow
      const q = logQuery(db, "SELECT 1", 60);
      expect(q.isSlow).toBe(true);
    });

    it("rejects negative threshold", () => {
      expect(setSlowQueryThreshold(-1).set).toBe(false);
    });
  });

  describe("clearQueryLog", () => {
    it("clears all log entries", () => {
      logQuery(db, "SELECT 1", 10);
      logQuery(db, "SELECT 2", 20);
      const r = clearQueryLog(db);
      expect(r.cleared).toBe(true);
      expect(r.count).toBe(2);
      expect(getQueryStats(db).totalQueries).toBe(0);
    });
  });

  /* ── Index Optimization ──────────────────────────── */

  describe("analyzeQueries", () => {
    it("returns 0 suggestions when no slow queries", () => {
      logQuery(db, "SELECT * FROM notes", 10);
      const r = analyzeQueries(db);
      expect(r.analyzed).toBe(true);
      expect(r.suggestionsGenerated).toBe(0);
    });

    it("generates suggestions from slow queries", () => {
      // Log multiple slow queries hitting same WHERE column
      logQuery(db, "SELECT * FROM notes WHERE title = ?", 150);
      logQuery(db, "SELECT * FROM notes WHERE title LIKE ?", 200);
      logQuery(db, "SELECT * FROM notes WHERE title = ?", 180);

      const r = analyzeQueries(db);
      expect(r.analyzed).toBe(true);
      expect(r.suggestionsGenerated).toBeGreaterThanOrEqual(1);

      const sugs = listSuggestions(db);
      expect(sugs.length).toBeGreaterThanOrEqual(1);
      const titleSug = sugs.find((s) => s.columns.includes("title"));
      expect(titleSug).toBeTruthy();
      expect(titleSug.table_name).toBe("notes");
    });

    it("generates composite index suggestions", () => {
      // Multiple columns on same table
      logQuery(db, "SELECT * FROM users WHERE name = ? AND age > ?", 200);
      logQuery(db, "SELECT * FROM users WHERE name = ? AND age > ?", 300);
      logQuery(db, "SELECT * FROM users WHERE age > ?", 150);

      const r = analyzeQueries(db);
      expect(r.suggestionsGenerated).toBeGreaterThanOrEqual(1);

      const sugs = listSuggestions(db);
      const composite = sugs.find(
        (s) => s.suggestion_type === "composite_index",
      );
      expect(composite).toBeTruthy();
      expect(composite.columns).toContain("age");
      expect(composite.columns).toContain("name");
    });

    it("respects minQueryCount parameter", () => {
      logQuery(db, "SELECT * FROM notes WHERE id = ?", 200);
      // Only one slow query — shouldn't generate suggestion with minQueryCount=2
      const r = analyzeQueries(db, { minQueryCount: 2 });
      expect(r.suggestionsGenerated).toBe(0);
    });
  });

  describe("listSuggestions", () => {
    it("filters by applied status", () => {
      logQuery(db, "SELECT * FROM t WHERE a = ?", 200);
      logQuery(db, "SELECT * FROM t WHERE a = ?", 200);
      analyzeQueries(db);

      const pending = listSuggestions(db, { applied: false });
      expect(pending.length).toBeGreaterThanOrEqual(1);

      // Apply one
      applySuggestion(db, pending[0].id);
      const applied = listSuggestions(db, { applied: true });
      expect(applied.length).toBe(1);
    });
  });

  describe("getSuggestion", () => {
    it("returns null for unknown id", () => {
      expect(getSuggestion(db, "nope")).toBeNull();
    });
  });

  describe("applySuggestion", () => {
    it("marks suggestion as applied and returns SQL", () => {
      logQuery(db, "SELECT * FROM notes WHERE title = ?", 200);
      logQuery(db, "SELECT * FROM notes WHERE title = ?", 200);
      analyzeQueries(db);

      const sugs = listSuggestions(db);
      const sug = sugs.find((s) => s.columns === "title");
      expect(sug).toBeTruthy();

      const r = applySuggestion(db, sug.id);
      expect(r.applied).toBe(true);
      expect(r.indexSql).toContain("CREATE INDEX");
      expect(r.indexSql).toContain("notes");
      expect(r.indexSql).toContain("title");
    });

    it("rejects unknown suggestion", () => {
      expect(applySuggestion(db, "nope").reason).toBe("not_found");
    });

    it("rejects already applied suggestion", () => {
      logQuery(db, "SELECT * FROM x WHERE a = ?", 200);
      logQuery(db, "SELECT * FROM x WHERE a = ?", 200);
      analyzeQueries(db);
      const sugs = listSuggestions(db);
      applySuggestion(db, sugs[0].id);
      expect(applySuggestion(db, sugs[0].id).reason).toBe("already_applied");
    });
  });

  /* ── Stats ───────────────────────────────────────── */

  describe("getDbEvoStats", () => {
    it("returns zeros when empty", () => {
      const s = getDbEvoStats(db);
      expect(s.migrations.registered).toBe(0);
      expect(s.migrations.executed).toBe(0);
      expect(s.queryLog.total).toBe(0);
      expect(s.suggestions.total).toBe(0);
    });

    it("computes correct stats", () => {
      registerMigration("001", { upSql: "A" });
      registerMigration("002", { upSql: "B" });
      migrateUp(db, "001");

      logQuery(db, "SELECT * FROM t WHERE a = ?", 200);
      logQuery(db, "SELECT * FROM t WHERE a = ?", 150);
      logQuery(db, "SELECT * FROM t", 5);
      analyzeQueries(db);

      const s = getDbEvoStats(db);
      expect(s.migrations.registered).toBe(2);
      expect(s.migrations.executed).toBe(1);
      expect(s.migrations.pending).toBe(1);
      expect(s.migrations.currentVersion).toBe("001");
      expect(s.queryLog.total).toBe(3);
      expect(s.queryLog.slowQueries).toBe(2);
      expect(s.suggestions.total).toBeGreaterThanOrEqual(1);
      expect(s.suggestions.pending).toBeGreaterThanOrEqual(1);
    });
  });
});
