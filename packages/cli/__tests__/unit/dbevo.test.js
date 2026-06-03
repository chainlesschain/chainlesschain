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

  // Phase 80 V2
  SCHEMA_BASELINE_V2,
  MIGRATION_RUN_V2,
  DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB,
  DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB,
  DBEVO_DEFAULT_BASELINE_IDLE_MS,
  DBEVO_DEFAULT_MIGRATION_STUCK_MS,
  getDefaultMaxActiveBaselinesPerDbV2,
  getMaxActiveBaselinesPerDbV2,
  setMaxActiveBaselinesPerDbV2,
  getDefaultMaxRunningMigrationsPerDbV2,
  getMaxRunningMigrationsPerDbV2,
  setMaxRunningMigrationsPerDbV2,
  getDefaultBaselineIdleMsV2,
  getBaselineIdleMsV2,
  setBaselineIdleMsV2,
  getDefaultMigrationStuckMsV2,
  getMigrationStuckMsV2,
  setMigrationStuckMsV2,
  registerBaselineV2,
  getBaselineV2,
  setBaselineStatusV2,
  validateBaseline,
  activateBaseline,
  deprecateBaseline,
  retireBaseline,
  touchBaselineActivity,
  enqueueMigrationRunV2,
  getMigrationRunV2,
  setMigrationRunStatusV2,
  startMigrationRun,
  applyMigrationRun,
  failMigrationRun,
  rollbackMigrationRun,
  getActiveBaselineCount,
  getRunningMigrationCount,
  autoRetireIdleBaselines,
  autoFailStuckMigrationRuns,
  getDbEvoStatsV2,
  _resetStateV2,
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

/* ═════════════════════════════════════════════════════════ *
 *  Phase 80 V2 — Schema Baseline + Migration-Run Lifecycle
 * ═════════════════════════════════════════════════════════ */

describe("dbevo V2 (Phase 80)", () => {
  beforeEach(() => {
    _resetStateV2();
  });

  describe("enums", () => {
    it("SCHEMA_BASELINE_V2 has 5 frozen states", () => {
      expect(Object.keys(SCHEMA_BASELINE_V2)).toHaveLength(5);
      expect(Object.isFrozen(SCHEMA_BASELINE_V2)).toBe(true);
      expect(SCHEMA_BASELINE_V2.DRAFT).toBe("draft");
      expect(SCHEMA_BASELINE_V2.RETIRED).toBe("retired");
    });

    it("MIGRATION_RUN_V2 has 5 frozen states", () => {
      expect(Object.keys(MIGRATION_RUN_V2)).toHaveLength(5);
      expect(Object.isFrozen(MIGRATION_RUN_V2)).toBe(true);
      expect(MIGRATION_RUN_V2.APPLIED).toBe("applied");
      expect(MIGRATION_RUN_V2.ROLLED_BACK).toBe("rolled_back");
    });
  });

  describe("config + setters", () => {
    it("exposes defaults", () => {
      expect(getDefaultMaxActiveBaselinesPerDbV2()).toBe(
        DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB,
      );
      expect(getDefaultMaxRunningMigrationsPerDbV2()).toBe(
        DBEVO_DEFAULT_MAX_RUNNING_MIGRATIONS_PER_DB,
      );
      expect(getDefaultBaselineIdleMsV2()).toBe(DBEVO_DEFAULT_BASELINE_IDLE_MS);
      expect(getDefaultMigrationStuckMsV2()).toBe(
        DBEVO_DEFAULT_MIGRATION_STUCK_MS,
      );
    });

    it("getters + setters validate positive", () => {
      expect(setMaxActiveBaselinesPerDbV2(3)).toBe(3);
      expect(getMaxActiveBaselinesPerDbV2()).toBe(3);
      expect(setMaxRunningMigrationsPerDbV2(4)).toBe(4);
      expect(getMaxRunningMigrationsPerDbV2()).toBe(4);
      expect(setBaselineIdleMsV2(10000)).toBe(10000);
      expect(setMigrationStuckMsV2(5000)).toBe(5000);
      expect(() => setMaxActiveBaselinesPerDbV2(0)).toThrow(/positive/);
      expect(() => setMigrationStuckMsV2(-1)).toThrow(/positive/);
    });
  });

  describe("registerBaselineV2", () => {
    it("registers with draft default", () => {
      const b = registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "primary",
        version: "1.0.0",
      });
      expect(b.status).toBe("draft");
      expect(b.version).toBe("1.0.0");
    });

    it("validates required", () => {
      expect(() => registerBaselineV2(null, {})).toThrow(/baselineId/);
      expect(() => registerBaselineV2(null, { baselineId: "b" })).toThrow(
        /databaseId/,
      );
      expect(() =>
        registerBaselineV2(null, { baselineId: "b", databaseId: "d" }),
      ).toThrow(/version/);
    });

    it("rejects duplicate + invalid/terminal initial", () => {
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
      });
      expect(() =>
        registerBaselineV2(null, {
          baselineId: "b1",
          databaseId: "d",
          version: "1",
        }),
      ).toThrow(/already exists/);
      expect(() =>
        registerBaselineV2(null, {
          baselineId: "b2",
          databaseId: "d",
          version: "1",
          initialStatus: "galaxy",
        }),
      ).toThrow(/Invalid initial status/);
      expect(() =>
        registerBaselineV2(null, {
          baselineId: "b2",
          databaseId: "d",
          version: "1",
          initialStatus: "retired",
        }),
      ).toThrow(/terminal/);
    });

    it("enforces active cap on register", () => {
      setMaxActiveBaselinesPerDbV2(1);
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
        initialStatus: "active",
      });
      expect(() =>
        registerBaselineV2(null, {
          baselineId: "b2",
          databaseId: "d",
          version: "2",
          initialStatus: "active",
        }),
      ).toThrow(/cap/);
    });
  });

  describe("setBaselineStatusV2 + shortcuts", () => {
    beforeEach(() => {
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
      });
    });

    it("draft → validated → active → deprecated → active", () => {
      validateBaseline(null, "b1");
      activateBaseline(null, "b1");
      deprecateBaseline(null, "b1");
      activateBaseline(null, "b1");
      expect(getBaselineV2("b1").status).toBe("active");
    });

    it("any → retired (terminal)", () => {
      retireBaseline(null, "b1");
      expect(() => validateBaseline(null, "b1")).toThrow(/Invalid transition/);
    });

    it("rejects unknown + invalid transition + invalid status", () => {
      expect(() => activateBaseline(null, "nope")).toThrow(/Unknown/);
      expect(() => activateBaseline(null, "b1")).toThrow(/Invalid transition/);
      expect(() => setBaselineStatusV2(null, "b1", "galaxy")).toThrow(
        /Invalid status/,
      );
    });

    it("enforces active cap on re-activate", () => {
      setMaxActiveBaselinesPerDbV2(1);
      validateBaseline(null, "b1");
      activateBaseline(null, "b1");
      registerBaselineV2(null, {
        baselineId: "b2",
        databaseId: "d",
        version: "2",
      });
      validateBaseline(null, "b2");
      expect(() => activateBaseline(null, "b2")).toThrow(/cap/);
    });

    it("merges reason + metadata patch", () => {
      const r = setBaselineStatusV2(null, "b1", "validated", {
        reason: "ok",
        metadata: { k: "v" },
      });
      expect(r.lastReason).toBe("ok");
      expect(r.metadata.k).toBe("v");
    });
  });

  describe("touchBaselineActivity", () => {
    it("updates lastTouchedAt", async () => {
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
      });
      const before = getBaselineV2("b1").lastTouchedAt;
      await new Promise((r) => setTimeout(r, 2));
      const r = touchBaselineActivity("b1");
      expect(r.lastTouchedAt).toBeGreaterThanOrEqual(before);
    });

    it("throws unknown", () => {
      expect(() => touchBaselineActivity("nope")).toThrow(/Unknown/);
    });
  });

  describe("enqueueMigrationRunV2 + lifecycle", () => {
    it("enqueues queued", () => {
      const r = enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "001",
        direction: "up",
      });
      expect(r.status).toBe("queued");
    });

    it("validates required + direction + duplicate", () => {
      expect(() => enqueueMigrationRunV2(null, {})).toThrow(/runId/);
      expect(() => enqueueMigrationRunV2(null, { runId: "r" })).toThrow(
        /databaseId/,
      );
      expect(() =>
        enqueueMigrationRunV2(null, { runId: "r", databaseId: "d" }),
      ).toThrow(/migrationId/);
      expect(() =>
        enqueueMigrationRunV2(null, {
          runId: "r",
          databaseId: "d",
          migrationId: "m",
        }),
      ).toThrow(/direction/);
      expect(() =>
        enqueueMigrationRunV2(null, {
          runId: "r",
          databaseId: "d",
          migrationId: "m",
          direction: "sideways",
        }),
      ).toThrow(/Invalid direction/);
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      expect(() =>
        enqueueMigrationRunV2(null, {
          runId: "r1",
          databaseId: "d",
          migrationId: "m",
          direction: "up",
        }),
      ).toThrow(/already exists/);
    });

    it("queued → running → applied → rolled_back", () => {
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      const s = startMigrationRun(null, "r1");
      expect(s.status).toBe("running");
      expect(s.startedAt).toBeGreaterThan(0);
      applyMigrationRun(null, "r1");
      rollbackMigrationRun(null, "r1");
      expect(getMigrationRunV2("r1").status).toBe("rolled_back");
    });

    it("queued → failed (no running)", () => {
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      failMigrationRun(null, "r1");
      expect(getMigrationRunV2("r1").status).toBe("failed");
    });

    it("running → failed / rolled_back both valid", () => {
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      startMigrationRun(null, "r1");
      failMigrationRun(null, "r1");
      expect(getMigrationRunV2("r1").status).toBe("failed");

      enqueueMigrationRunV2(null, {
        runId: "r2",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      startMigrationRun(null, "r2");
      rollbackMigrationRun(null, "r2");
      expect(getMigrationRunV2("r2").status).toBe("rolled_back");
    });

    it("failed + rolled_back terminal", () => {
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      failMigrationRun(null, "r1");
      expect(() => startMigrationRun(null, "r1")).toThrow(/Invalid transition/);
    });

    it("startedAt stamp-once", () => {
      setMaxRunningMigrationsPerDbV2(2);
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      const s1 = startMigrationRun(null, "r1");
      applyMigrationRun(null, "r1");
      // applied→rolled_back preserves startedAt (no stamp-once on rolled_back)
      const rb = rollbackMigrationRun(null, "r1");
      expect(rb.startedAt).toBe(s1.startedAt);
    });

    it("enforces running cap", () => {
      setMaxRunningMigrationsPerDbV2(1);
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m1",
        direction: "up",
      });
      enqueueMigrationRunV2(null, {
        runId: "r2",
        databaseId: "d",
        migrationId: "m2",
        direction: "up",
      });
      startMigrationRun(null, "r1");
      expect(() => startMigrationRun(null, "r2")).toThrow(/cap/);
    });

    it("rejects unknown run", () => {
      expect(() => startMigrationRun(null, "nope")).toThrow(/Unknown run/);
    });
  });

  describe("counts", () => {
    it("active baselines per db", () => {
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d1",
        version: "1",
        initialStatus: "active",
      });
      registerBaselineV2(null, {
        baselineId: "b2",
        databaseId: "d2",
        version: "1",
        initialStatus: "active",
      });
      expect(getActiveBaselineCount()).toBe(2);
      expect(getActiveBaselineCount("d1")).toBe(1);
      expect(getActiveBaselineCount("dX")).toBe(0);
    });

    it("running migrations per db", () => {
      setMaxRunningMigrationsPerDbV2(5);
      for (const id of ["r1", "r2"]) {
        enqueueMigrationRunV2(null, {
          runId: id,
          databaseId: "d1",
          migrationId: "m",
          direction: "up",
        });
        startMigrationRun(null, id);
      }
      enqueueMigrationRunV2(null, {
        runId: "r3",
        databaseId: "d2",
        migrationId: "m",
        direction: "up",
      });
      startMigrationRun(null, "r3");
      expect(getRunningMigrationCount()).toBe(3);
      expect(getRunningMigrationCount("d1")).toBe(2);
      expect(getRunningMigrationCount("d2")).toBe(1);
    });
  });

  describe("autoRetireIdleBaselines", () => {
    it("flips draft/validated/deprecated when idle; skips active/retired", () => {
      registerBaselineV2(null, {
        baselineId: "b-draft",
        databaseId: "d",
        version: "1",
      });
      registerBaselineV2(null, {
        baselineId: "b-val",
        databaseId: "d",
        version: "2",
      });
      validateBaseline(null, "b-val");
      registerBaselineV2(null, {
        baselineId: "b-active",
        databaseId: "d",
        version: "3",
      });
      validateBaseline(null, "b-active");
      activateBaseline(null, "b-active");
      registerBaselineV2(null, {
        baselineId: "b-dep",
        databaseId: "d",
        version: "4",
      });
      validateBaseline(null, "b-dep");
      setMaxActiveBaselinesPerDbV2(5);
      activateBaseline(null, "b-dep");
      deprecateBaseline(null, "b-dep");
      const now = Date.now() + DBEVO_DEFAULT_BASELINE_IDLE_MS + 1;
      const r = autoRetireIdleBaselines(null, now);
      expect(r.count).toBe(3);
      expect(r.flipped.sort()).toEqual(["b-dep", "b-draft", "b-val"]);
      expect(getBaselineV2("b-active").status).toBe("active");
    });

    it("skips when fresh", () => {
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
      });
      const r = autoRetireIdleBaselines(null);
      expect(r.count).toBe(0);
    });
  });

  describe("autoFailStuckMigrationRuns", () => {
    it("flips only RUNNING based on startedAt anchor", () => {
      setMaxRunningMigrationsPerDbV2(5);
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      enqueueMigrationRunV2(null, {
        runId: "r2",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      startMigrationRun(null, "r1");
      startMigrationRun(null, "r2");
      applyMigrationRun(null, "r1"); // r1 leaves RUNNING
      const now = Date.now() + DBEVO_DEFAULT_MIGRATION_STUCK_MS + 1;
      const r = autoFailStuckMigrationRuns(null, now);
      expect(r.count).toBe(1);
      expect(r.flipped).toEqual(["r2"]);
      expect(getMigrationRunV2("r1").status).toBe("applied");
      expect(getMigrationRunV2("r2").status).toBe("failed");
    });

    it("skips queued (never stamped startedAt)", () => {
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      const now = Date.now() + DBEVO_DEFAULT_MIGRATION_STUCK_MS + 1;
      const r = autoFailStuckMigrationRuns(null, now);
      expect(r.count).toBe(0);
    });
  });

  describe("getDbEvoStatsV2", () => {
    it("zero-initializes all enum keys + reports config", () => {
      const s = getDbEvoStatsV2();
      expect(s.totalBaselinesV2).toBe(0);
      expect(s.totalRunsV2).toBe(0);
      for (const k of Object.values(SCHEMA_BASELINE_V2))
        expect(s.baselinesByStatus[k]).toBe(0);
      for (const k of Object.values(MIGRATION_RUN_V2))
        expect(s.runsByStatus[k]).toBe(0);
      expect(s.maxActiveBaselinesPerDb).toBe(
        DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB,
      );
    });

    it("reflects current state", () => {
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
      });
      validateBaseline(null, "b1");
      enqueueMigrationRunV2(null, {
        runId: "r1",
        databaseId: "d",
        migrationId: "m",
        direction: "up",
      });
      startMigrationRun(null, "r1");
      const s = getDbEvoStatsV2();
      expect(s.baselinesByStatus.validated).toBe(1);
      expect(s.runsByStatus.running).toBe(1);
    });
  });

  describe("_resetStateV2", () => {
    it("clears maps + restores config defaults", () => {
      setMaxActiveBaselinesPerDbV2(9);
      registerBaselineV2(null, {
        baselineId: "b1",
        databaseId: "d",
        version: "1",
      });
      _resetStateV2();
      expect(getMaxActiveBaselinesPerDbV2()).toBe(
        DBEVO_DEFAULT_MAX_ACTIVE_BASELINES_PER_DB,
      );
      expect(getBaselineV2("b1")).toBeNull();
    });
  });
});
