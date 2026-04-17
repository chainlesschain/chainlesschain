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
} from "../lib/dbevo.js";

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

  program.addCommand(dbevo);
}
