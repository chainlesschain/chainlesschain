/**
 * `cc dbevo` — CLI surface for Phase 80 Database Evolution Framework.
 */

import { Command } from "commander";

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

  // Phase 80 V2
  SCHEMA_BASELINE_V2,
  MIGRATION_RUN_V2,
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
} from "../lib/dbevo.js";

function _parseMetaV2(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("--metadata must be valid JSON");
  }
}

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

export function registerDbEvoCommand(program) {
  const dbevo = new Command("dbevo")
    .description("Database evolution & migration framework (Phase 80)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureDbEvoTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  dbevo
    .command("migration-statuses")
    .description("List migration statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(MIGRATION_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  dbevo
    .command("directions")
    .description("List migration directions")
    .option("--json", "JSON output")
    .action((opts) => {
      const dirs = Object.values(MIGRATION_DIRECTION);
      if (opts.json) return console.log(JSON.stringify(dirs, null, 2));
      for (const d of dirs) console.log(`  ${d}`);
    });

  dbevo
    .command("suggestion-types")
    .description("List index suggestion types")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(SUGGESTION_TYPE);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types) console.log(`  ${t}`);
    });

  /* ── Migration Registration ──────────────────────── */

  dbevo
    .command("register <version>")
    .description("Register a migration version")
    .requiredOption("-u, --up <sql>", "Up migration SQL")
    .option("-d, --down <sql>", "Down migration SQL")
    .option("--description <text>", "Migration description")
    .option("--json", "JSON output")
    .action((version, opts) => {
      const result = registerMigration(version, {
        description: opts.description,
        upSql: opts.up,
        downSql: opts.down,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.registered) {
        console.log(
          `Migration registered: ${version} (checksum: ${result.checksum})`,
        );
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  dbevo
    .command("registered")
    .description("List registered migrations")
    .option("--json", "JSON output")
    .action((opts) => {
      const migs = listRegisteredMigrations();
      if (opts.json) return console.log(JSON.stringify(migs, null, 2));
      if (migs.length === 0) return console.log("No migrations registered.");
      for (const m of migs) {
        console.log(
          `  ${m.version.padEnd(12)} ${(m.description || "").padEnd(30)} ${m.hasDown ? "up/down" : "up only"} ${m.checksum}`,
        );
      }
    });

  dbevo
    .command("validate")
    .description("Validate registered migrations")
    .option("--json", "JSON output")
    .action((opts) => {
      const result = validateMigrations();
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.valid) {
        console.log("All migrations valid.");
      } else {
        console.log("Issues found:");
        for (const issue of result.issues) {
          if (issue.type === "gap") {
            console.log(
              `  Gap between versions ${issue.between[0]} and ${issue.between[1]}`,
            );
          } else if (issue.type === "missing_down") {
            console.log(
              `  Missing down migration for version ${issue.version}`,
            );
          }
        }
      }
    });

  /* ── Migration Execution ─────────────────────────── */

  dbevo
    .command("status")
    .description("Show migration status")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const s = getMigrationStatus(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Current version:  ${s.currentVersion || "(none)"}`);
      console.log(`Registered:       ${s.totalRegistered}`);
      console.log(`Executed:         ${s.totalExecuted}`);
      console.log(`Pending:          ${s.pendingCount}`);
      if (s.pendingVersions.length > 0) {
        console.log(`Pending versions: ${s.pendingVersions.join(", ")}`);
      }
    });

  dbevo
    .command("up")
    .description("Migrate up (apply pending migrations)")
    .option("-t, --target <version>", "Target version")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const result = migrateUp(db, opts.target);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.migrated) {
        console.log(`Migrated ${result.count} version(s):`);
        for (const r of result.results) {
          console.log(`  ${r.version} — ${r.status}`);
        }
      } else {
        console.log(`No migrations to run: ${result.reason}`);
      }
    });

  dbevo
    .command("down")
    .description("Rollback migrations")
    .option("-t, --target <version>", "Target version to rollback to")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const result = migrateDown(db, opts.target);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.rolledBack) {
        console.log(`Rolled back ${result.count} version(s):`);
        for (const r of result.results) {
          console.log(`  ${r.version} — ${r.status}`);
        }
      } else {
        console.log(`Cannot rollback: ${result.reason}`);
        if (result.versions) {
          console.log(`  Missing down for: ${result.versions.join(", ")}`);
        }
      }
    });

  dbevo
    .command("history")
    .description("Show migration history")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const history = getMigrationHistory(db, { limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(history, null, 2));
      if (history.length === 0) return console.log("No migration history.");
      for (const h of history) {
        const dir = h.direction === "up" ? "UP  " : "DOWN";
        console.log(
          `  ${dir} ${h.version.padEnd(12)} ${h.status.padEnd(12)} ${h.duration_ms}ms  ${new Date(h.executed_at).toISOString().slice(0, 19)}`,
        );
      }
    });

  /* ── Query Logging ───────────────────────────────── */

  dbevo
    .command("query-log <sql> <duration-ms>")
    .description("Log a query with duration")
    .option("-s, --source <source>", "Query source")
    .option("-p, --params <json>", "Query params JSON")
    .option("--json", "JSON output")
    .action((sql, durationMs, opts) => {
      const db = _dbFromCtx(dbevo);
      const params = opts.params ? JSON.parse(opts.params) : undefined;
      const result = logQuery(db, sql, parseFloat(durationMs), {
        params,
        source: opts.source,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.logged) {
        console.log(
          `Query logged: ${result.id.slice(0, 8)}${result.isSlow ? " (SLOW)" : ""}`,
        );
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  dbevo
    .command("query-stats")
    .description("Show query statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const s = getQueryStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Total queries:  ${s.totalQueries}`);
      console.log(
        `Slow queries:   ${s.slowQueries} (threshold: ${s.slowQueryThresholdMs}ms)`,
      );
      console.log(`Avg duration:   ${s.avgDurationMs}ms`);
      console.log(`Max duration:   ${s.maxDurationMs}ms`);
      if (s.topSlow.length > 0) {
        console.log("Top slow queries:");
        for (const q of s.topSlow.slice(0, 5)) {
          console.log(
            `  ${String(q.durationMs).padEnd(8)}ms  ${q.sql.slice(0, 60)}`,
          );
        }
      }
    });

  dbevo
    .command("slow-threshold <ms>")
    .description("Set slow query threshold")
    .option("--json", "JSON output")
    .action((ms, opts) => {
      const result = setSlowQueryThreshold(parseFloat(ms));
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.set) {
        console.log(`Slow query threshold set to ${result.thresholdMs}ms`);
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  dbevo
    .command("query-clear")
    .description("Clear query log")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const result = clearQueryLog(db);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Cleared ${result.count} log entries.`);
    });

  /* ── Index Optimization ──────────────────────────── */

  dbevo
    .command("analyze")
    .description("Analyze slow queries and generate index suggestions")
    .option("--min-count <n>", "Min query count for suggestion", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const result = analyzeQueries(db, { minQueryCount: opts.minCount });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Analyzed ${result.slowQueriesAnalyzed || 0} slow queries.`);
      console.log(`Generated ${result.suggestionsGenerated} new suggestions.`);
    });

  dbevo
    .command("suggestions")
    .description("List index suggestions")
    .option("-a, --applied", "Only applied")
    .option("-p, --pending", "Only pending")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const applied = opts.applied ? true : opts.pending ? false : undefined;
      const sugs = listSuggestions(db, { applied });
      if (opts.json) return console.log(JSON.stringify(sugs, null, 2));
      if (sugs.length === 0) return console.log("No suggestions.");
      for (const s of sugs) {
        const status = s.applied ? "APPLIED" : "PENDING";
        console.log(
          `  ${status.padEnd(8)} ${s.table_name.padEnd(20)} ${s.columns.padEnd(20)} ${s.suggestion_type.padEnd(18)} queries:${s.query_count} ${s.id.slice(0, 8)}`,
        );
      }
    });

  dbevo
    .command("suggestion-show <id>")
    .description("Show suggestion details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(dbevo);
      const s = getSuggestion(db, id);
      if (!s) return console.log("Suggestion not found.");
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`ID:          ${s.id}`);
      console.log(`Table:       ${s.table_name}`);
      console.log(`Columns:     ${s.columns}`);
      console.log(`Type:        ${s.suggestion_type}`);
      console.log(
        `Improvement: ${(s.estimated_improvement * 100).toFixed(0)}%`,
      );
      console.log(`Queries:     ${s.query_count}`);
      console.log(`Applied:     ${s.applied ? "YES" : "NO"}`);
    });

  dbevo
    .command("apply <id>")
    .description("Apply an index suggestion")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(dbevo);
      const result = applySuggestion(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.applied) {
        console.log("Suggestion applied.");
        console.log(`  SQL: ${result.indexSql}`);
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  /* ── Stats ───────────────────────────────────────── */

  dbevo
    .command("stats")
    .description("Database evolution statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(dbevo);
      const s = getDbEvoStats(db);
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Migrations:  ${s.migrations.registered} registered, ${s.migrations.executed} executed, ${s.migrations.pending} pending`,
      );
      console.log(`  Current:   ${s.migrations.currentVersion || "(none)"}`);
      console.log(
        `Query log:   ${s.queryLog.total} total, ${s.queryLog.slowQueries} slow (threshold: ${s.queryLog.thresholdMs}ms)`,
      );
      console.log(
        `Suggestions: ${s.suggestions.total} total, ${s.suggestions.pending} pending, ${s.suggestions.applied} applied`,
      );
    });

  /* ═══════════════════════════════════════════════════ *
   *  Phase 80 V2 — Schema Baseline + Migration Run
   * ═══════════════════════════════════════════════════ */

  dbevo
    .command("schema-baselines-v2")
    .description("List V2 baseline states")
    .option("--json", "JSON output")
    .action((opts) => {
      const xs = Object.values(SCHEMA_BASELINE_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  dbevo
    .command("migration-runs-v2")
    .description("List V2 migration-run states")
    .option("--json", "JSON output")
    .action((opts) => {
      const xs = Object.values(MIGRATION_RUN_V2);
      if (opts.json) return console.log(JSON.stringify(xs, null, 2));
      for (const x of xs) console.log(`  ${x}`);
    });

  dbevo
    .command("default-max-active-baselines-per-db")
    .description("Default active-baseline cap")
    .action(() => console.log(getDefaultMaxActiveBaselinesPerDbV2()));
  dbevo
    .command("max-active-baselines-per-db")
    .description("Current active-baseline cap")
    .action(() => console.log(getMaxActiveBaselinesPerDbV2()));
  dbevo
    .command("set-max-active-baselines-per-db <n>")
    .description("Set active-baseline cap")
    .action((n) => console.log(setMaxActiveBaselinesPerDbV2(n)));

  dbevo
    .command("default-max-running-migrations-per-db")
    .description("Default running-migration cap")
    .action(() => console.log(getDefaultMaxRunningMigrationsPerDbV2()));
  dbevo
    .command("max-running-migrations-per-db")
    .description("Current running-migration cap")
    .action(() => console.log(getMaxRunningMigrationsPerDbV2()));
  dbevo
    .command("set-max-running-migrations-per-db <n>")
    .description("Set running-migration cap")
    .action((n) => console.log(setMaxRunningMigrationsPerDbV2(n)));

  dbevo
    .command("default-baseline-idle-ms")
    .description("Default baseline idle ms")
    .action(() => console.log(getDefaultBaselineIdleMsV2()));
  dbevo
    .command("baseline-idle-ms")
    .description("Current baseline idle ms")
    .action(() => console.log(getBaselineIdleMsV2()));
  dbevo
    .command("set-baseline-idle-ms <ms>")
    .description("Set baseline idle ms")
    .action((ms) => console.log(setBaselineIdleMsV2(ms)));

  dbevo
    .command("default-migration-stuck-ms")
    .description("Default migration stuck ms")
    .action(() => console.log(getDefaultMigrationStuckMsV2()));
  dbevo
    .command("migration-stuck-ms")
    .description("Current migration stuck ms")
    .action(() => console.log(getMigrationStuckMsV2()));
  dbevo
    .command("set-migration-stuck-ms <ms>")
    .description("Set migration stuck ms")
    .action((ms) => console.log(setMigrationStuckMsV2(ms)));

  dbevo
    .command("active-baseline-count")
    .description("Count of ACTIVE baselines")
    .option("-d, --database <id>", "filter by database")
    .action((opts) => console.log(getActiveBaselineCount(opts.database)));

  dbevo
    .command("running-migration-count")
    .description("Count of RUNNING migration runs")
    .option("-d, --database <id>", "filter by database")
    .action((opts) => console.log(getRunningMigrationCount(opts.database)));

  // ── Baseline CRUD ──────────────────────────────────

  dbevo
    .command("register-baseline-v2 <baseline-id>")
    .description("Register a V2 baseline")
    .requiredOption("-d, --database <id>", "database id")
    .requiredOption("-v, --version <ver>", "schema version")
    .option("-i, --initial-status <s>", "initial status")
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const r = registerBaselineV2(null, {
        baselineId: id,
        databaseId: opts.database,
        version: opts.version,
        initialStatus: opts.initialStatus,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  dbevo
    .command("baseline-v2 <baseline-id>")
    .description("Get a V2 baseline")
    .action((id) => {
      const r = getBaselineV2(id);
      if (!r) {
        console.error(`Unknown baseline: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(r, null, 2));
    });

  dbevo
    .command("set-baseline-status-v2 <baseline-id> <status>")
    .description("Transition baseline status")
    .option("-r, --reason <text>", "reason")
    .option("--metadata <json>", "metadata JSON")
    .action((id, status, opts) => {
      const r = setBaselineStatusV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["validate-baseline", validateBaseline],
    ["activate-baseline", activateBaseline],
    ["deprecate-baseline", deprecateBaseline],
    ["retire-baseline", retireBaseline],
  ]) {
    dbevo
      .command(`${name} <baseline-id>`)
      .description(`Transition baseline (${name})`)
      .option("-r, --reason <text>", "reason")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  dbevo
    .command("touch-baseline-activity <baseline-id>")
    .description("Bump lastTouchedAt")
    .action((id) => {
      const r = touchBaselineActivity(id);
      console.log(JSON.stringify(r, null, 2));
    });

  // ── Migration Run CRUD ─────────────────────────────

  dbevo
    .command("enqueue-migration-run-v2 <run-id>")
    .description("Enqueue a V2 migration run")
    .requiredOption("-d, --database <id>", "database id")
    .requiredOption("-m, --migration <id>", "migration id")
    .requiredOption("--direction <up|down>", "direction")
    .option("--metadata <json>", "metadata JSON")
    .action((id, opts) => {
      const r = enqueueMigrationRunV2(null, {
        runId: id,
        databaseId: opts.database,
        migrationId: opts.migration,
        direction: opts.direction,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  dbevo
    .command("migration-run-v2 <run-id>")
    .description("Get a V2 migration run")
    .action((id) => {
      const r = getMigrationRunV2(id);
      if (!r) {
        console.error(`Unknown run: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(r, null, 2));
    });

  dbevo
    .command("set-migration-run-status-v2 <run-id> <status>")
    .description("Transition migration-run status")
    .option("-r, --reason <text>", "reason")
    .option("--metadata <json>", "metadata JSON")
    .action((id, status, opts) => {
      const r = setMigrationRunStatusV2(null, id, status, {
        reason: opts.reason,
        metadata: _parseMetaV2(opts.metadata),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  for (const [name, fn] of [
    ["start-migration-run", startMigrationRun],
    ["apply-migration-run", applyMigrationRun],
    ["fail-migration-run", failMigrationRun],
    ["rollback-migration-run", rollbackMigrationRun],
  ]) {
    dbevo
      .command(`${name} <run-id>`)
      .description(`Transition migration run (${name})`)
      .option("-r, --reason <text>", "reason")
      .action((id, opts) => {
        const r = fn(null, id, opts.reason);
        console.log(JSON.stringify(r, null, 2));
      });
  }

  dbevo
    .command("auto-retire-idle-baselines")
    .description("Flip idle draft/validated/deprecated → RETIRED")
    .action(() =>
      console.log(JSON.stringify(autoRetireIdleBaselines(null), null, 2)),
    );

  dbevo
    .command("auto-fail-stuck-migration-runs")
    .description("Flip stuck RUNNING → FAILED")
    .action(() =>
      console.log(JSON.stringify(autoFailStuckMigrationRuns(null), null, 2)),
    );

  dbevo
    .command("stats-v2")
    .description("V2 stats snapshot")
    .action(() => console.log(JSON.stringify(getDbEvoStatsV2(), null, 2)));

  program.addCommand(dbevo);
}

// === Iter23 V2 governance overlay ===
export function registerDbevogovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "dbevo");
  if (!parent) return;
  const L = async () => await import("../lib/dbevo.js");
  parent
    .command("dbevogov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.DBEVOGOV_PROFILE_MATURITY_V2,
            migrationLifecycle: m.DBEVOGOV_MIGRATION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveDbevogovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingDbevogovMigrationsPerProfileV2(),
            idleMs: m.getDbevogovProfileIdleMsV2(),
            stuckMs: m.getDbevogovMigrationStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveDbevogovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dbevogov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingDbevogovMigrationsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dbevogov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setDbevogovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dbevogov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setDbevogovMigrationStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dbevogov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--schema <v>", "schema")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerDbevogovProfileV2({ id, owner, schema: o.schema }),
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateDbevogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).pauseDbevogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveDbevogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchDbevogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getDbevogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listDbevogovProfilesV2(), null, 2),
      );
    });
  parent
    .command("dbevogov-create-migration-v2 <id> <profileId>")
    .description("Create migration")
    .option("--version <v>", "version")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createDbevogovMigrationV2({ id, profileId, version: o.version }),
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-applying-migration-v2 <id>")
    .description("Mark migration as applying")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).applyingDbevogovMigrationV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-complete-migration-v2 <id>")
    .description("Complete migration")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeMigrationDbevogovV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-fail-migration-v2 <id> [reason]")
    .description("Fail migration")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).failDbevogovMigrationV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-cancel-migration-v2 <id> [reason]")
    .description("Cancel migration")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelDbevogovMigrationV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-get-migration-v2 <id>")
    .description("Get migration")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getDbevogovMigrationV2(id), null, 2),
      );
    });
  parent
    .command("dbevogov-list-migrations-v2")
    .description("List migrations")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listDbevogovMigrationsV2(), null, 2),
      );
    });
  parent
    .command("dbevogov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleDbevogovProfilesV2(), null, 2),
      );
    });
  parent
    .command("dbevogov-auto-fail-stuck-v2")
    .description("Auto-fail stuck migrations")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoFailStuckDbevogovMigrationsV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("dbevogov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getDbevoGovStatsV2(), null, 2));
    });
}
