/**
 * Database management commands
 * chainlesschain db init|info|backup|restore|check|repair|reset
 */

import ora from "ora";
import chalk from "chalk";
import { createRequire } from "module";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";

const requireCjs = createRequire(import.meta.url);
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// SQLite driver loader for db check/repair. Cascades: native → wasm.
// Native (better-sqlite3) is fast but needs prebuilt binaries — fails on
// Apple Silicon w/o prebuilds, musl Linux, and some Node-version drift.
// WASM (sql.js) is pure JS+WASM, slower but always loadable.
// Inlined here rather than imported from core-db because the published
// @chainlesschain/core-db@0.1.0 doesn't export its loader; bumping core-db
// would have wider ripple, so we duplicate the cascade locally.
async function loadAnyDriver() {
  for (const pkg of ["better-sqlite3-multiple-ciphers", "better-sqlite3"]) {
    try {
      const Database = requireCjs(pkg);
      const probe = new Database(":memory:");
      probe.close();
      return { kind: "native", name: pkg, Database };
    } catch (_e) {
      /* try next */
    }
  }
  try {
    const initSqlJs = requireCjs("sql.js");
    const SQL = await initSqlJs();
    return { kind: "wasm", name: "sql.js", SQL };
  } catch (_e) {
    return null;
  }
}

// Run integrity check. Normalizes both driver shapes to { ok, diagnostics }.
// native: db.pragma("integrity_check") → [{integrity_check: "ok"}] or [{integrity_check: "*** in db ***\n..."}]
// wasm: db.exec("PRAGMA integrity_check") → [{columns: [...], values: [["ok"]]}]
async function runIntegrityCheck(driver, dbPath, checkName) {
  const fs = requireCjs("fs");
  if (driver.kind === "native") {
    const conn = new driver.Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    const rows = conn.pragma(checkName);
    conn.close();
    const lines = rows.map((r) => (r && r[checkName]) || JSON.stringify(r));
    return {
      ok: lines.length === 1 && lines[0] === "ok",
      diagnostics: lines,
    };
  }
  const buf = fs.readFileSync(dbPath);
  const conn = new driver.SQL.Database(buf);
  let res;
  try {
    res = conn.exec(`PRAGMA ${checkName}`);
  } finally {
    conn.close();
  }
  const lines = (res[0]?.values || []).map((v) => String(v[0]));
  return {
    ok: lines.length === 1 && lines[0] === "ok",
    diagnostics: lines,
  };
}

// Best-effort row salvage. Handles both native and wasm drivers.
// onTable(name, copied, lost, err?) is called for each table for live progress.
// Returns { stats: {tables, rowsCopied, rowsLost, schemasFailed} }.
async function salvageDatabase(driver, srcPath, dstPath, onTable) {
  const fs = requireCjs("fs");
  const stats = { tables: 0, rowsCopied: 0, rowsLost: 0, schemasFailed: 0 };

  if (driver.kind === "native") {
    const src = new driver.Database(srcPath, {
      readonly: true,
      fileMustExist: true,
    });
    const dst = new driver.Database(dstPath);
    dst.pragma("journal_mode = WAL");
    try {
      const schemaRows = src
        .prepare(
          "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY (type='table') DESC, name",
        )
        .all();
      for (const r of schemaRows) {
        try {
          dst.exec(r.sql);
        } catch (e) {
          stats.schemasFailed++;
        }
      }
      const tables = src
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((t) => t.name);
      for (const t of tables) {
        let copied = 0;
        let lost = 0;
        let err = null;
        try {
          const cols = src
            .prepare(`PRAGMA table_info(${quoteIdent(t)})`)
            .all()
            .map((c) => c.name);
          if (cols.length === 0) {
            stats.tables++;
            onTable(t, 0, 0, "no columns");
            continue;
          }
          const colList = cols.map(quoteIdent).join(",");
          const placeholders = cols.map(() => "?").join(",");
          const insert = dst.prepare(
            `INSERT OR IGNORE INTO ${quoteIdent(t)} (${colList}) VALUES (${placeholders})`,
          );
          const iter = src
            .prepare(`SELECT ${colList} FROM ${quoteIdent(t)}`)
            .iterate();
          while (true) {
            let next;
            try {
              next = iter.next();
            } catch (_e) {
              lost++;
              break;
            }
            if (next.done) break;
            try {
              insert.run(...cols.map((c) => next.value[c]));
              copied++;
            } catch (_e) {
              lost++;
            }
          }
          try {
            iter.return && iter.return();
          } catch (_e) {
            /* swallow */
          }
        } catch (e) {
          err = e.message;
        }
        stats.tables++;
        stats.rowsCopied += copied;
        stats.rowsLost += lost;
        onTable(t, copied, lost, err);
      }
    } finally {
      try {
        src.close();
      } catch (_e) {
        /* swallow */
      }
      try {
        dst.close();
      } catch (_e) {
        /* swallow */
      }
    }
    return { stats };
  }

  // wasm path
  const buf = fs.readFileSync(srcPath);
  const src = new driver.SQL.Database(buf);
  const dst = new driver.SQL.Database();
  try {
    let schemaRows = [];
    try {
      const r = src.exec(
        "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY (type='table') DESC, name",
      );
      schemaRows = (r[0]?.values || []).map((v) => ({
        type: v[0],
        name: v[1],
        sql: v[2],
      }));
    } catch (_e) {
      /* sqlite_master unreadable */
    }
    for (const r of schemaRows) {
      try {
        dst.exec(r.sql);
      } catch (_e) {
        stats.schemasFailed++;
      }
    }
    let tables = [];
    try {
      const r = src.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      tables = (r[0]?.values || []).map((v) => v[0]);
    } catch (_e) {
      /* tables unreadable */
    }
    for (const t of tables) {
      let copied = 0;
      let lost = 0;
      let err = null;
      try {
        const ti = src.exec(`PRAGMA table_info(${quoteIdent(t)})`);
        const cols = (ti[0]?.values || []).map((v) => v[1]);
        if (cols.length === 0) {
          stats.tables++;
          onTable(t, 0, 0, "no columns");
          continue;
        }
        const colList = cols.map(quoteIdent).join(",");
        const placeholders = cols.map(() => "?").join(",");
        const insertSql = `INSERT OR IGNORE INTO ${quoteIdent(t)} (${colList}) VALUES (${placeholders})`;
        const insertStmt = dst.prepare(insertSql);
        const selectStmt = src.prepare(
          `SELECT ${colList} FROM ${quoteIdent(t)}`,
        );
        try {
          while (true) {
            let stepped;
            try {
              stepped = selectStmt.step();
            } catch (_e) {
              lost++;
              break;
            }
            if (!stepped) break;
            let row;
            try {
              row = selectStmt.get();
            } catch (_e) {
              lost++;
              continue;
            }
            try {
              insertStmt.run(row);
            } catch (_e) {
              lost++;
            }
          }
        } finally {
          try {
            selectStmt.free();
          } catch (_e) {
            /* swallow */
          }
          try {
            insertStmt.free();
          } catch (_e) {
            /* swallow */
          }
        }
      } catch (e) {
        err = e.message;
      }
      stats.tables++;
      stats.rowsCopied += copied;
      stats.rowsLost += lost;
      onTable(t, copied, lost, err);
    }
    // Persist wasm in-memory DB to disk.
    const outBuf = dst.export();
    fs.writeFileSync(dstPath, Buffer.from(outBuf));
  } finally {
    try {
      src.close();
    } catch (_e) {
      /* swallow */
    }
    try {
      dst.close();
    } catch (_e) {
      /* swallow */
    }
  }
  return { stats };
}

export function registerDbCommand(program) {
  const db = program.command("db").description("Database management");

  // db init
  db.command("init")
    .description("Initialize the database")
    .option("--path <path>", "Custom database path")
    .option("--force", "Overwrite existing database")
    .action(async (options) => {
      const spinner = ora("Initializing database...").start();
      try {
        const ctx = await bootstrap({
          dbPath: options.path,
          verbose: program.opts().verbose,
        });

        if (!ctx.db) {
          spinner.fail("Failed to initialize database");
          process.exit(1);
        }

        const info = ctx.db.getInfo();
        spinner.succeed("Database initialized");
        logger.log(`  Path: ${chalk.cyan(info.path)}`);
        logger.log(`  Driver: ${chalk.cyan(info.driver)}`);
        logger.log(`  Tables: ${chalk.cyan(info.tableCount)}`);

        await shutdown();
      } catch (err) {
        spinner.fail(`Database init failed: ${err.message}`);
        process.exit(1);
      }
    });

  // db info
  db.command("info")
    .description("Show database information")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });

        if (!ctx.db) {
          logger.error("No database available");
          process.exit(1);
        }

        const info = ctx.db.getInfo();

        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          logger.log(chalk.bold("Database Info:"));
          logger.log(`  Path:       ${chalk.cyan(info.path)}`);
          logger.log(`  Driver:     ${chalk.cyan(info.driver)}`);
          logger.log(
            `  Encrypted:  ${info.encrypted ? chalk.green("Yes") : chalk.gray("No")}`,
          );
          logger.log(`  Size:       ${chalk.cyan(info.fileSizeMB + " MB")}`);
          logger.log(`  Tables:     ${chalk.cyan(info.tableCount)}`);
          if (info.tables.length > 0) {
            logger.log(
              `  Table list: ${chalk.gray(info.tables.slice(0, 10).join(", "))}${info.tables.length > 10 ? "..." : ""}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to get db info: ${err.message}`);
        process.exit(1);
      }
    });

  // db backup
  db.command("backup")
    .description("Create database backup")
    .argument("[output]", "Backup file path")
    .action(async (output) => {
      const spinner = ora("Creating backup...").start();
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });

        if (!ctx.db) {
          spinner.fail("No database to backup");
          process.exit(1);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath =
          output || `${ctx.env.dataDir}/chainlesschain.db.backup.${timestamp}`;

        ctx.db.backup(backupPath);
        spinner.succeed(`Backup created: ${chalk.cyan(backupPath)}`);

        await shutdown();
      } catch (err) {
        spinner.fail(`Backup failed: ${err.message}`);
        process.exit(1);
      }
    });

  // db restore
  db.command("restore")
    .description("Restore database from backup")
    .argument("<backup>", "Backup file path")
    .option("--force", "Skip confirmation")
    .action(async (backup, options) => {
      try {
        const fs = await import("fs");
        if (!fs.existsSync(backup)) {
          logger.error(`Backup file not found: ${backup}`);
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "This will overwrite the current database. Continue?",
          });
          if (!ok) {
            logger.info("Restore cancelled");
            return;
          }
        }

        const ctx = await bootstrap({
          skipDb: true,
          verbose: program.opts().verbose,
        });
        const dbPath = `${ctx.env.dataDir}/chainlesschain.db`;

        fs.copyFileSync(backup, dbPath);
        logger.success(`Database restored from ${chalk.cyan(backup)}`);

        await shutdown();
      } catch (err) {
        logger.error(`Restore failed: ${err.message}`);
        process.exit(1);
      }
    });

  // db check — PRAGMA integrity_check (read-only, exits 2 on corruption)
  db.command("check")
    .description("Run SQLite integrity check on the database")
    .option("--quick", "Run quick_check (faster, less thorough)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      let exitCode = 0;
      try {
        const ctx = await bootstrap({
          skipDb: true,
          verbose: program.opts().verbose,
        });
        const fs = await import("fs");
        const dbPath = `${ctx.env.dataDir}/chainlesschain.db`;
        if (!fs.existsSync(dbPath)) {
          logger.error(`Database file not found: ${dbPath}`);
          await shutdown();
          process.exit(1);
        }
        const driver = await loadAnyDriver();
        if (!driver) {
          logger.error(
            "No SQLite driver available. Install better-sqlite3 or sql.js.",
          );
          await shutdown();
          process.exit(1);
        }
        const checkName = options.quick ? "quick_check" : "integrity_check";
        const { ok, diagnostics } = await runIntegrityCheck(
          driver,
          dbPath,
          checkName,
        );
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok,
                check: checkName,
                path: dbPath,
                driver: driver.name,
                diagnostics,
              },
              null,
              2,
            ),
          );
        } else if (ok) {
          logger.success(
            `Database integrity OK (${checkName} via ${driver.name}): ${chalk.cyan(dbPath)}`,
          );
        } else {
          logger.error(
            `Database is CORRUPT (${checkName} via ${driver.name}): ${chalk.cyan(dbPath)}`,
          );
          for (const msg of diagnostics) {
            const lines = String(msg).split("\n").slice(0, 20);
            for (const line of lines) console.log("  " + line);
          }
          console.log("");
          logger.warn("Recovery options:");
          console.log(
            "  cc db repair   – best-effort row salvage into a new file",
          );
          console.log("  cc db reset    – back up corrupt DB and start fresh");
        }
        exitCode = ok ? 0 : 2;
        await shutdown();
      } catch (err) {
        logger.error(`Database check failed: ${err.message}`);
        exitCode = 1;
      }
      process.exit(exitCode);
    });

  // db reset — rename corrupt DB + WAL/SHM to .bak.<timestamp>; next CLI run creates fresh
  db.command("reset")
    .description(
      "Back up the database (and WAL sidecar) and start fresh next run",
    )
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({
          skipDb: true,
          verbose: program.opts().verbose,
        });
        const fs = await import("fs");
        const dbPath = `${ctx.env.dataDir}/chainlesschain.db`;
        if (!fs.existsSync(dbPath)) {
          logger.info(`No database to reset: ${dbPath} does not exist`);
          await shutdown();
          return;
        }
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Back up and remove ${dbPath}? Next CLI command will create a fresh DB.`,
            default: false,
          });
          if (!ok) {
            logger.info("Reset cancelled");
            await shutdown();
            return;
          }
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const backed = [];
        for (const ext of ["", "-wal", "-shm"]) {
          const src = dbPath + ext;
          if (fs.existsSync(src)) {
            const dest = `${src}.bak.${ts}`;
            fs.renameSync(src, dest);
            backed.push(dest);
          }
        }
        if (backed.length === 0) {
          logger.info("Nothing to back up");
        } else {
          logger.success("Database reset. Backups created:");
          for (const b of backed) console.log("  " + chalk.cyan(b));
        }
        await shutdown();
      } catch (err) {
        logger.error(`Reset failed: ${err.message}`);
        process.exit(1);
      }
    });

  // db repair — best-effort row salvage from corrupt DB into a fresh file.
  // Walks each table individually; rows on broken pages throw and are counted
  // as lost rather than aborting the whole salvage. Output is a sibling file
  // chainlesschain.db.recovered.<ts> — operator can swap it in via reset+restore.
  db.command("repair")
    .description("Best-effort row salvage from a corrupt DB into a new file")
    .option("--out <path>", "Output path for recovered DB")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({
          skipDb: true,
          verbose: program.opts().verbose,
        });
        const fs = await import("fs");
        const dbPath = `${ctx.env.dataDir}/chainlesschain.db`;
        if (!fs.existsSync(dbPath)) {
          logger.error(`Database file not found: ${dbPath}`);
          await shutdown();
          process.exit(1);
        }
        const driver = await loadAnyDriver();
        if (!driver) {
          logger.error(
            "No SQLite driver available. Install better-sqlite3 or sql.js.",
          );
          await shutdown();
          process.exit(1);
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const outPath = options.out || `${dbPath}.recovered.${ts}`;
        if (fs.existsSync(outPath)) {
          logger.error(`Output path already exists: ${outPath}`);
          await shutdown();
          process.exit(1);
        }
        logger.info(
          `Salvaging ${chalk.cyan(dbPath)} → ${chalk.cyan(outPath)} (driver: ${driver.name})`,
        );

        const { stats } = await salvageDatabase(
          driver,
          dbPath,
          outPath,
          (name, copied, lost, err) => {
            const tag = err
              ? chalk.red(err)
              : lost > 0
                ? chalk.yellow(`${copied} copied, ${lost} lost`)
                : copied === 0
                  ? chalk.gray(`${copied} copied`)
                  : chalk.green(`${copied} copied`);
            console.log(`  ${name.padEnd(28)} ${tag}`);
          },
        );

        logger.log("");
        logger.success(`Recovered DB written to ${chalk.cyan(outPath)}`);
        logger.log(`  Tables processed: ${stats.tables}`);
        logger.log(`  Rows copied:      ${chalk.green(stats.rowsCopied)}`);
        logger.log(
          `  Rows lost:        ${stats.rowsLost > 0 ? chalk.yellow(stats.rowsLost) : 0}`,
        );
        logger.log(`  Schemas failed:   ${stats.schemasFailed}`);
        logger.log("");
        logger.info("To use the recovered DB:");
        console.log(`  cc db reset --force`);
        console.log(`  cc db restore ${outPath} --force`);
        await shutdown();
      } catch (err) {
        logger.error(`Repair failed: ${err.message}`);
        process.exit(1);
      }
    });
}
