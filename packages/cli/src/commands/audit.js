/**
 * Audit log commands
 * chainlesschain audit log|search|stats|export|purge
 */

import chalk from "chalk";
import fs from "fs";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getRecentEvents,
  queryLogs,
  getStatistics,
  exportLogs,
  purgeLogs,
  EVENT_TYPES,
  RISK_LEVELS,
} from "../lib/audit-logger.js";

const RISK_COLORS = {
  low: chalk.gray,
  medium: chalk.yellow,
  high: chalk.red,
  critical: chalk.bgRed.white,
};

function formatLogEntry(log) {
  const riskColor = RISK_COLORS[log.risk_level] || chalk.gray;
  const status = log.success ? chalk.green("OK") : chalk.red("FAIL");
  const time = log.created_at || "";

  return [
    `  ${chalk.gray(log.id.slice(0, 8))} ${chalk.gray(time)}`,
    `    ${chalk.cyan(log.event_type.padEnd(12))} ${chalk.white(log.operation)} ${status} ${riskColor(`[${log.risk_level}]`)}`,
    log.actor ? `    ${chalk.gray("actor:")} ${log.actor}` : null,
    log.target ? `    ${chalk.gray("target:")} ${log.target}` : null,
    log.error_message
      ? `    ${chalk.red("error:")} ${log.error_message}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function registerAuditCommand(program) {
  const audit = program
    .command("audit")
    .description("Audit log — security event tracking and compliance");

  // audit log (default)
  audit
    .command("log", { isDefault: true })
    .description("Show recent audit events")
    .option("-n, --limit <n>", "Number of events to show", "20")
    .option("--type <type>", "Filter by event type")
    .option("--risk <level>", "Filter by risk level")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const filters = {
          limit: parseInt(options.limit) || 20,
        };
        if (options.type) filters.eventType = options.type;
        if (options.risk) filters.riskLevel = options.risk;

        const logs = queryLogs(db, filters);

        if (options.json) {
          console.log(JSON.stringify(logs, null, 2));
        } else if (logs.length === 0) {
          logger.info("No audit events found");
        } else {
          logger.log(chalk.bold(`Audit Log (${logs.length} events):\n`));
          for (const log of logs) {
            logger.log(formatLogEntry(log));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // audit search
  audit
    .command("search")
    .description("Search audit logs")
    .argument("<query>", "Search query")
    .option("-n, --limit <n>", "Max results", "50")
    .option("--type <type>", "Filter by event type")
    .option("--risk <level>", "Filter by risk level")
    .option("--from <date>", "Start date (ISO 8601)")
    .option("--to <date>", "End date (ISO 8601)")
    .option("--failures", "Show only failed events")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const filters = {
          search: query,
          limit: parseInt(options.limit) || 50,
        };
        if (options.type) filters.eventType = options.type;
        if (options.risk) filters.riskLevel = options.risk;
        if (options.from) filters.startDate = options.from;
        if (options.to) filters.endDate = options.to;
        if (options.failures) filters.success = false;

        const logs = queryLogs(db, filters);

        if (options.json) {
          console.log(JSON.stringify(logs, null, 2));
        } else if (logs.length === 0) {
          logger.info(`No audit events matching "${query}"`);
        } else {
          logger.log(chalk.bold(`Search Results (${logs.length}):\n`));
          for (const log of logs) {
            logger.log(formatLogEntry(log));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // audit stats
  audit
    .command("stats")
    .description("Show audit statistics")
    .option("--from <date>", "Start date")
    .option("--to <date>", "End date")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const stats = getStatistics(db, options.from, options.to);

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(chalk.bold("Audit Statistics:\n"));
          logger.log(`  ${chalk.bold("Total events:")}   ${stats.total}`);
          logger.log(
            `  ${chalk.bold("Failures:")}       ${chalk.red(stats.failures)}`,
          );
          logger.log(
            `  ${chalk.bold("High risk:")}      ${chalk.red(stats.highRisk)}`,
          );

          if (Object.keys(stats.byEventType).length > 0) {
            logger.log(`\n  ${chalk.bold("By Event Type:")}`);
            for (const [type, count] of Object.entries(stats.byEventType)) {
              logger.log(`    ${chalk.cyan(type.padEnd(15))} ${count}`);
            }
          }

          if (Object.keys(stats.byRiskLevel).length > 0) {
            logger.log(`\n  ${chalk.bold("By Risk Level:")}`);
            for (const [level, count] of Object.entries(stats.byRiskLevel)) {
              const color = RISK_COLORS[level] || chalk.gray;
              logger.log(`    ${color(level.padEnd(15))} ${count}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // audit export
  audit
    .command("export")
    .description("Export audit logs to file")
    .option("-o, --output <path>", "Output file path")
    .option("-f, --format <fmt>", "Format: json or csv", "json")
    .option("--from <date>", "Start date")
    .option("--to <date>", "End date")
    .option("-n, --limit <n>", "Max events", "10000")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const filters = { limit: parseInt(options.limit) || 10000 };
        if (options.from) filters.startDate = options.from;
        if (options.to) filters.endDate = options.to;

        const data = exportLogs(db, options.format, filters);

        if (options.output) {
          fs.writeFileSync(options.output, data, "utf8");
          logger.success(`Exported to ${options.output}`);
        } else {
          console.log(data);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // audit purge
  audit
    .command("purge")
    .description("Delete old audit logs")
    .option("--days <n>", "Keep logs from last N days", "90")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        const days = parseInt(options.days) || 90;

        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete audit logs older than ${days} days? This cannot be undone.`,
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
        const deleted = purgeLogs(db, days);
        logger.success(`Purged ${deleted} old audit events`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // audit types
  audit
    .command("types")
    .description("List available event types and risk levels")
    .action(async () => {
      logger.log(chalk.bold("Event Types:\n"));
      for (const [key, value] of Object.entries(EVENT_TYPES)) {
        logger.log(`  ${chalk.cyan(value.padEnd(15))} ${chalk.gray(key)}`);
      }
      logger.log(chalk.bold("\nRisk Levels:\n"));
      for (const [key, value] of Object.entries(RISK_LEVELS)) {
        const color = RISK_COLORS[value] || chalk.gray;
        logger.log(`  ${color(value.padEnd(15))} ${chalk.gray(key)}`);
      }
    });
}
