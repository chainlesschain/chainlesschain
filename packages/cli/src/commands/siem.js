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
  SIEM_FORMAT,
  SIEM_TARGET_TYPE,
  SIEM_SEVERITY,
  SIEM_TARGET_STATUS,
  SIEM_DEFAULT_BATCH_SIZE,
  severityToCEF,
  formatLog,
  addTargetV2,
  removeTarget,
  setTargetStatus,
  exportLogsV2,
  getSIEMStatsV2,
  listTargetsByStatus,
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

  // ═══════════════════════════════════════════════════════════════
  // V2 Canonical Subcommands (Phase 51)
  // ═══════════════════════════════════════════════════════════════

  siem
    .command("formats")
    .description("List SIEM export formats (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(SIEM_FORMAT), null, 2));
    });

  siem
    .command("target-types")
    .description("List SIEM target types (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(SIEM_TARGET_TYPE), null, 2));
    });

  siem
    .command("severities")
    .description("List SIEM severity levels (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(SIEM_SEVERITY), null, 2));
    });

  siem
    .command("statuses")
    .description("List SIEM target statuses (V2)")
    .action(() => {
      console.log(JSON.stringify(Object.values(SIEM_TARGET_STATUS), null, 2));
    });

  siem
    .command("default-batch-size")
    .description("Show default SIEM batch size (V2)")
    .action(() => {
      console.log(JSON.stringify({ batchSize: SIEM_DEFAULT_BATCH_SIZE }));
    });

  siem
    .command("severity-cef <severity>")
    .description("Map a SIEM severity to its CEF integer (0-10)")
    .action((severity) => {
      try {
        console.log(JSON.stringify({ severity, cef: severityToCEF(severity) }));
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("format-log <format>")
    .description("Format a JSON log payload as cef|leef|json")
    .option("-l, --log <json>", "Log object as JSON", "{}")
    .action((format, options) => {
      try {
        const log = JSON.parse(options.log);
        const result = formatLog(format, log);
        console.log(
          typeof result === "string" ? result : JSON.stringify(result, null, 2),
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("add-target-v2")
    .description("Add a SIEM target via canonical options (V2)")
    .option("-t, --type <type>", "Target type")
    .option("-u, --url <url>", "Target URL")
    .option("-f, --format <fmt>", "Export format", "json")
    .option("-c, --config <json>", "Config JSON", "{}")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        let config = {};
        try {
          config = JSON.parse(options.config);
        } catch (_err) {
          logger.error("Invalid --config JSON");
          process.exit(1);
        }
        const target = addTargetV2(db, {
          type: options.type,
          url: options.url,
          format: options.format,
          config,
        });
        console.log(JSON.stringify(target, null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("remove-target <target-id>")
    .description("Remove a SIEM target (V2)")
    .action(async (targetId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        console.log(JSON.stringify(removeTarget(db, targetId), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("set-status <target-id> <status>")
    .description("Transition a SIEM target's status (V2)")
    .action(async (targetId, status) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        console.log(
          JSON.stringify(setTargetStatus(db, targetId, status), null, 2),
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("export-v2 <target-id>")
    .description("Batch-export logs to a target (V2)")
    .option("-l, --logs <json>", "Logs as JSON array", "[]")
    .option("-b, --batch-size <n>", "Batch size override")
    .action(async (targetId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        let logs = [];
        try {
          logs = JSON.parse(options.logs);
        } catch (_err) {
          logger.error("Invalid --logs JSON");
          process.exit(1);
        }
        const r = exportLogsV2(db, {
          targetId,
          logs,
          batchSize: options.batchSize ? Number(options.batchSize) : undefined,
        });
        console.log(JSON.stringify(r, null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("stats-v2")
    .description("Show extended SIEM stats (byFormat/byType/byStatus, V2)")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        console.log(JSON.stringify(getSIEMStatsV2(), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  siem
    .command("by-status <status>")
    .description("List SIEM targets filtered by status (V2)")
    .action(async (status) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSIEMTables(db);

        console.log(JSON.stringify(listTargetsByStatus(status), null, 2));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
