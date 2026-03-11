/**
 * Sync commands
 * chainlesschain sync status|push|pull|conflicts|resolve|log|clear
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getSyncStatus,
  pushResources,
  pullResources,
  getConflicts,
  resolveConflict,
  getSyncLog,
  clearSyncData,
  registerResource,
  getAllSyncStates,
} from "../lib/sync-manager.js";

export function registerSyncCommand(program) {
  const sync = program
    .command("sync")
    .description("File and knowledge synchronization");

  // sync status
  sync
    .command("status", { isDefault: true })
    .description("Show sync status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const status = getSyncStatus(db);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          logger.log(chalk.bold("Sync Status:\n"));
          logger.log(`  ${chalk.bold("Resources:")}  ${status.totalResources}`);
          logger.log(
            `  ${chalk.bold("Pending:")}    ${chalk.yellow(status.pending)}`,
          );
          logger.log(
            `  ${chalk.bold("Synced:")}     ${chalk.green(status.synced)}`,
          );
          logger.log(
            `  ${chalk.bold("Conflicts:")}  ${status.conflicts > 0 ? chalk.red(status.conflicts) : "0"}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync push
  sync
    .command("push")
    .description("Push local changes to remote")
    .option("--type <type>", "Resource type to push")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = pushResources(db, options.type);
        logger.success(`Pushed ${result.pushed}/${result.total} resources`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync pull
  sync
    .command("pull")
    .description("Pull remote changes to local")
    .option("--type <type>", "Resource type to pull")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = pullResources(db, options.type);
        logger.success(
          `Checked ${result.checked} resources, updated ${result.updated}`,
        );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync conflicts
  sync
    .command("conflicts")
    .description("Show sync conflicts")
    .option("--all", "Include resolved conflicts")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const conflicts = getConflicts(db, { resolved: options.all });

        if (options.json) {
          console.log(JSON.stringify(conflicts, null, 2));
        } else if (conflicts.length === 0) {
          logger.info("No conflicts");
        } else {
          logger.log(chalk.bold(`Conflicts (${conflicts.length}):\n`));
          for (const c of conflicts) {
            const resolved = c.resolution
              ? chalk.green("[resolved]")
              : chalk.red("[unresolved]");
            logger.log(`  ${chalk.cyan(c.id)} ${resolved}`);
            logger.log(
              `    ${chalk.gray(`${c.resource_type}/${c.resource_id}`)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync resolve
  sync
    .command("resolve")
    .description("Resolve a sync conflict")
    .argument("<conflict-id>", "Conflict ID")
    .option("--use <side>", "Use local or remote version", "local")
    .action(async (conflictId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = resolveConflict(db, conflictId, options.use);

        if (ok) {
          logger.success(`Conflict resolved (${options.use})`);
        } else {
          logger.error(`Conflict not found: ${conflictId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync log
  sync
    .command("log")
    .description("Show sync operation log")
    .option("--limit <n>", "Number of entries", "20")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const entries = getSyncLog(db, { limit: parseInt(options.limit) });

        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No sync log entries");
        } else {
          logger.log(chalk.bold(`Sync Log (${entries.length}):\n`));
          for (const e of entries) {
            const statusColor =
              e.status === "success" ? chalk.green : chalk.red;
            logger.log(
              `  ${chalk.gray(e.created_at)} ${chalk.bold(e.operation)} ${statusColor(e.status)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync clear
  sync
    .command("clear")
    .description("Clear all sync data")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Clear all sync data? This cannot be undone.",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        clearSyncData(db);
        logger.success("Sync data cleared");
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
