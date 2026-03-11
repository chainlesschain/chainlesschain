/**
 * Database management commands
 * chainlesschain db init|info|backup|restore|migrate
 */

import ora from "ora";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";

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
}
