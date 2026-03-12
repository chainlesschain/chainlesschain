/**
 * SIEM commands
 * chainlesschain siem targets|add-target|export|stats
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureSIEMTables,
  listTargets,
  addTarget,
  exportLogs,
  getSIEMStats,
} from "../lib/siem-exporter.js";

export function registerSiemCommand(program) {
  const siem = program
    .command("siem")
    .description("SIEM integration — log export to external targets");

  // siem targets
  siem
    .command("targets")
    .description("List SIEM export targets")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        const targets = listTargets();
        if (options.json) {
          console.log(JSON.stringify(targets, null, 2));
        } else if (targets.length === 0) {
          logger.info("No SIEM targets configured.");
        } else {
          for (const t of targets) {
            logger.log(
              `  ${chalk.cyan(t.id.slice(0, 8))} ${t.type} → ${t.url} [${t.format}] exported=${t.exportedCount}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // siem add-target
  siem
    .command("add-target <type> <url>")
    .description(
      "Add a SIEM target (splunk_hec, elasticsearch, azure_sentinel)",
    )
    .option("-f, --format <fmt>", "Export format: json, cef, leef", "json")
    .action(async (type, url, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        const target = addTarget(db, type, url, options.format);
        logger.success("SIEM target added");
        logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(target.id)}`);
        logger.log(`  ${chalk.bold("Type:")}   ${target.type}`);
        logger.log(`  ${chalk.bold("URL:")}    ${target.url}`);
        logger.log(`  ${chalk.bold("Format:")} ${target.format}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // siem export
  siem
    .command("export <target-id>")
    .description("Export logs to a SIEM target")
    .action(async (targetId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        // Export with simulated log batch
        const result = exportLogs(db, targetId, [
          {
            id: `log-${Date.now()}`,
            level: "info",
            message: "CLI export test",
          },
        ]);
        logger.success(`Exported ${result.exported} log(s)`);
        logger.log(
          `  ${chalk.bold("Last ID:")} ${chalk.cyan(result.lastId || "N/A")}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // siem stats
  siem
    .command("stats")
    .description("Show SIEM export statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        const stats = getSIEMStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else if (stats.length === 0) {
          logger.info("No SIEM targets configured.");
        } else {
          for (const s of stats) {
            logger.log(
              `  ${chalk.cyan(s.id.slice(0, 8))} ${s.type} [${s.format}] exported=${s.exportedCount} status=${s.status}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
