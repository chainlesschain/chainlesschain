/**
 * Audit log commands
 * chainlesschain audit log|search|stats|export|purge
 */

import chalk from "chalk";
import fs from "fs";
import { logger } from "../lib/logger.js";
import { numericOption } from "../lib/cli-numeric.js";
import { parseJsonOption } from "../lib/parse-json-option.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { getHomeDir } from "../lib/paths.js";
import {
  getAuditMtcDir,
  loadAuditMtcConfig,
  saveAuditMtcConfig,
  emitEvent as auditMtcEmit,
  closeBatch as auditMtcCloseBatch,
  reconcileCheck as auditMtcReconcileCheck,
  getStatus as auditMtcStatus,
} from "../lib/audit-mtc.js";
import {
  getRecentEvents,
  queryLogs,
  getStatistics,
  exportLogs,
  purgeLogs,
  EVENT_TYPES,
  RISK_LEVELS,
  // V2
  LOG_STATUS_V2,
  INTEGRITY_STATUS_V2,
  ALERT_STATUS_V2,
  EVENT_TYPES_V2,
  RISK_LEVELS_V2,
  AUDIT_DEFAULT_MAX_ALERTS_PER_ACTOR,
  AUDIT_DEFAULT_ARCHIVE_RETENTION_MS,
  AUDIT_DEFAULT_PURGE_RETENTION_MS,
  setMaxAlertsPerActor,
  setArchiveRetentionMs,
  setPurgeRetentionMs,
  getMaxAlertsPerActor,
  getArchiveRetentionMs,
  getPurgeRetentionMs,
  getOpenAlertCount,
  logEventV2,
  getLogStatusV2,
  setLogStatusV2,
  verifyChainV2,
  autoArchiveLogs,
  autoPurgeLogs,
  getAlertStatusV2,
  setAlertStatusV2,
  acknowledgeAlert,
  resolveAlert,
  dismissAlert,
  getAuditStatsV2,
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
          limit: numericOption(options.limit, {
            name: "--limit",
            integer: true,
            min: 0,
            fallback: 20,
          }),
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
          limit: numericOption(options.limit, {
            name: "--limit",
            integer: true,
            min: 0,
            fallback: 50,
          }),
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

        const filters = {
          limit: numericOption(options.limit, {
            name: "--limit",
            integer: true,
            min: 0,
            fallback: 10000,
          }),
        };
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

  // ─────────────────────────────────────────────────────────────
  // Phase 11 V2 — hash-chained integrity + log/alert lifecycle
  // ─────────────────────────────────────────────────────────────

  audit
    .command("log-statuses-v2")
    .description("List V2 log lifecycle states")
    .action(() => {
      for (const v of Object.values(LOG_STATUS_V2)) logger.log(v);
    });

  audit
    .command("integrity-statuses-v2")
    .description("List V2 integrity states")
    .action(() => {
      for (const v of Object.values(INTEGRITY_STATUS_V2)) logger.log(v);
    });

  audit
    .command("alert-statuses-v2")
    .description("List V2 alert lifecycle states")
    .action(() => {
      for (const v of Object.values(ALERT_STATUS_V2)) logger.log(v);
    });

  audit
    .command("event-types-v2")
    .description("List V2 event types")
    .action(() => {
      for (const v of EVENT_TYPES_V2) logger.log(v);
    });

  audit
    .command("risk-levels-v2")
    .description("List V2 risk levels")
    .action(() => {
      for (const v of RISK_LEVELS_V2) logger.log(v);
    });

  audit
    .command("default-max-alerts-per-actor")
    .description("Show default max alerts per actor")
    .action(() => logger.log(String(AUDIT_DEFAULT_MAX_ALERTS_PER_ACTOR)));

  audit
    .command("max-alerts-per-actor")
    .description("Show current max alerts per actor")
    .action(() => logger.log(String(getMaxAlertsPerActor())));

  audit
    .command("set-max-alerts-per-actor <n>")
    .description("Update max alerts per actor")
    .action((n) => {
      logger.log(String(setMaxAlertsPerActor(n)));
    });

  audit
    .command("default-archive-retention-ms")
    .description("Show default archive retention")
    .action(() => logger.log(String(AUDIT_DEFAULT_ARCHIVE_RETENTION_MS)));

  audit
    .command("archive-retention-ms")
    .description("Show current archive retention")
    .action(() => logger.log(String(getArchiveRetentionMs())));

  audit
    .command("set-archive-retention-ms <ms>")
    .description("Update archive retention (ms)")
    .action((ms) => {
      logger.log(String(setArchiveRetentionMs(ms)));
    });

  audit
    .command("default-purge-retention-ms")
    .description("Show default purge retention")
    .action(() => logger.log(String(AUDIT_DEFAULT_PURGE_RETENTION_MS)));

  audit
    .command("purge-retention-ms")
    .description("Show current purge retention")
    .action(() => logger.log(String(getPurgeRetentionMs())));

  audit
    .command("set-purge-retention-ms <ms>")
    .description("Update purge retention (ms)")
    .action((ms) => {
      logger.log(String(setPurgeRetentionMs(ms)));
    });

  audit
    .command("open-alert-count")
    .description("Count OPEN alerts (optionally scoped to actor)")
    .option("-a, --actor <actor>", "Scope to actor")
    .action((opts) => {
      logger.log(String(getOpenAlertCount(opts.actor)));
    });

  audit
    .command("log-event-v2 <log-id>")
    .description("V2: register a hash-chained log entry")
    .option("-t, --event-type <t>", "Event type (required)")
    .option("-o, --operation <op>", "Operation (required)")
    .option("-a, --actor <actor>", "Actor")
    .option("-x, --target <target>", "Target")
    .option("-d, --details <d>", "Details (JSON)")
    .option("-r, --risk-level <rl>", "Risk level")
    .option("-i, --ip-address <ip>", "IP address")
    .option("-u, --user-agent <ua>", "User agent")
    .action(async (logId, opts) => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const details = parseJsonOption(opts.details, "--details");
        const entry = logEventV2(db, {
          logId,
          eventType: opts.eventType,
          operation: opts.operation,
          actor: opts.actor,
          target: opts.target,
          details,
          riskLevel: opts.riskLevel,
          ipAddress: opts.ipAddress,
          userAgent: opts.userAgent,
        });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        await shutdown();
      }
    });

  audit
    .command("log-status-v2 <log-id>")
    .description("V2: show log status + integrity")
    .action((logId) => {
      const entry = getLogStatusV2(logId);
      if (!entry) {
        logger.log(chalk.yellow("(not found)"));
        return;
      }
      logger.log(JSON.stringify(entry, null, 2));
    });

  audit
    .command("set-log-status-v2 <log-id> <status>")
    .description("V2: transition log status (active|archived|purged)")
    .option("-r, --reason <reason>", "Reason")
    .action(async (logId, status, opts) => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const entry = setLogStatusV2(db, logId, status, {
          reason: opts.reason,
        });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        await shutdown();
      }
    });

  audit
    .command("verify-chain-v2")
    .description("V2: re-hash the chain and mark each entry verified/corrupted")
    .action(() => {
      const results = verifyChainV2();
      logger.log(JSON.stringify(results, null, 2));
    });

  audit
    .command("auto-archive-logs")
    .description("V2: bulk-flip stale ACTIVE logs → ARCHIVED")
    .action(async () => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const archived = autoArchiveLogs(db);
        logger.log(`Archived ${archived.length} log(s)`);
      } finally {
        await shutdown();
      }
    });

  audit
    .command("auto-purge-logs")
    .description("V2: bulk-flip stale ARCHIVED logs → PURGED")
    .action(async () => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const purged = autoPurgeLogs(db);
        logger.log(`Purged ${purged.length} log(s)`);
      } finally {
        await shutdown();
      }
    });

  audit
    .command("alert-status-v2 <alert-id>")
    .description("V2: show alert status")
    .action((alertId) => {
      const entry = getAlertStatusV2(alertId);
      if (!entry) {
        logger.log(chalk.yellow("(not found)"));
        return;
      }
      logger.log(JSON.stringify(entry, null, 2));
    });

  audit
    .command("set-alert-status-v2 <alert-id> <status>")
    .description(
      "V2: transition alert status (open|acknowledged|resolved|dismissed)",
    )
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <meta>", "Metadata (JSON)")
    .action(async (alertId, status, opts) => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const metadata = parseJsonOption(opts.metadata, "--metadata");
        const entry = setAlertStatusV2(db, alertId, status, {
          reason: opts.reason,
          metadata,
        });
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        await shutdown();
      }
    });

  audit
    .command("acknowledge-alert <alert-id>")
    .description("V2: shortcut → acknowledged")
    .option("-r, --reason <reason>", "Reason")
    .action(async (alertId, opts) => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const entry = acknowledgeAlert(db, alertId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        await shutdown();
      }
    });

  audit
    .command("resolve-alert <alert-id>")
    .description("V2: shortcut → resolved")
    .option("-r, --reason <reason>", "Reason")
    .action(async (alertId, opts) => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const entry = resolveAlert(db, alertId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        await shutdown();
      }
    });

  audit
    .command("dismiss-alert <alert-id>")
    .description("V2: shortcut → dismissed")
    .option("-r, --reason <reason>", "Reason")
    .action(async (alertId, opts) => {
      // await bootstrap() (it's async): the prior sync `bootstrap()` left an
      // unawaited Promise and raced teardown against an unresolved init.
      const db = (await bootstrap({ verbose: program.opts().verbose })).db;
      try {
        const entry = dismissAlert(db, alertId, opts.reason);
        logger.log(JSON.stringify(entry, null, 2));
      } finally {
        await shutdown();
      }
    });

  audit
    .command("stats-v2")
    .description("V2: all-enum-key stats snapshot")
    .action(() => {
      logger.log(JSON.stringify(getAuditStatsV2(), null, 2));
    });

  // ─────────────────────────────────────────────────────────────
  // Phase 2 audit MTC double-track (off-by-default scaffolding)
  // Design: docs/design/默克尔树证书_MTC_落地方案.md §6.3 + §14.2
  // Status (2026-05-01): Q-COMP-1 + Q-COMP-2 legal sign-off received.
  // Default stays enabled=false — each tenant decides when to switch on
  // via explicit `cc audit mtc enable`. No global flag-flip in code.
  // ─────────────────────────────────────────────────────────────
  registerAuditMtcSubcommands(audit);
}

function resolveAuditMtcDir(opts) {
  const home = (opts && opts.configDir) || getHomeDir();
  return getAuditMtcDir(home);
}

function registerAuditMtcSubcommands(audit) {
  const mtc = audit
    .command("mtc")
    .description(
      "Audit MTC double-track (Phase 2 scaffolding, default disabled)",
    );

  mtc
    .command("status")
    .description("Show audit MTC config + queue depth + last batch info")
    .option(
      "--config-dir <dir>",
      "Override config root (default: ~/.chainlesschain)",
    )
    .option("--json", "Output as JSON")
    .action((opts) => {
      try {
        const dir = resolveAuditMtcDir(opts);
        const s = auditMtcStatus(dir);
        if (opts.json) {
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        const enabled = s.config.enabled
          ? chalk.green("enabled")
          : chalk.cyan(
              "disabled (ready — run `cc audit mtc enable` to activate)",
            );
        logger.log(chalk.bold("Audit MTC status:"));
        logger.log(`  ${chalk.bold("State:")}            ${enabled}`);
        logger.log(
          `  ${chalk.bold("Batch interval:")}   ${s.config.batch_interval_seconds}s`,
        );
        logger.log(
          `  ${chalk.bold("Namespace:")}        ${s.config.namespace_prefix}`,
        );
        logger.log(`  ${chalk.bold("Issuer:")}           ${s.config.issuer}`);
        logger.log(
          `  ${chalk.bold("Staging events:")}   ${s.staging.count}` +
            (s.staging.malformed
              ? chalk.red(` (${s.staging.malformed} malformed)`)
              : ""),
        );
        if (s.staging.oldest_queued_at) {
          logger.log(
            `  ${chalk.bold("Oldest queued:")}    ${s.staging.oldest_queued_at}`,
          );
        }
        logger.log(`  ${chalk.bold("Closed batches:")}   ${s.batches.count}`);
        if (s.batches.last_batch_id) {
          logger.log(
            `  ${chalk.bold("Last batch id:")}    ${s.batches.last_batch_id}`,
          );
          logger.log(
            `  ${chalk.bold("Last closed at:")}   ${s.batches.last_closed_at}`,
          );
          logger.log(
            `  ${chalk.bold("Last tree size:")}   ${s.batches.last_tree_size}`,
          );
          logger.log(
            `  ${chalk.bold("Last tree head:")}   ${s.batches.last_tree_head_id}`,
          );
        }
      } catch (err) {
        logger.error(`audit mtc status failed: ${err.message}`);
        process.exit(1);
      }
    });

  mtc
    .command("config")
    .description("Show audit MTC config")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const cfg = loadAuditMtcConfig(resolveAuditMtcDir(opts));
      if (opts.json) {
        console.log(JSON.stringify(cfg, null, 2));
      } else {
        logger.log(JSON.stringify(cfg, null, 2));
      }
    });

  mtc
    .command("enable")
    .description(
      "Enable audit MTC for this tenant (legal sign-off cleared 2026-05-01 — see landing plan §14.2)",
    )
    .option("--config-dir <dir>", "Override config root")
    .option(
      "--namespace <ns>",
      "Set namespace prefix (e.g. mtc/v1/audit/org-acme)",
    )
    .option("--issuer <issuer>", "Set MTCA issuer string")
    .option("--interval <seconds>", "Batch interval (default: 3600)", (v) =>
      parseInt(v, 10),
    )
    .action((opts) => {
      try {
        const patch = { enabled: true };
        if (opts.namespace) patch.namespace_prefix = opts.namespace;
        if (opts.issuer) patch.issuer = opts.issuer;
        if (opts.interval) patch.batch_interval_seconds = opts.interval;
        const cfg = saveAuditMtcConfig(resolveAuditMtcDir(opts), patch);
        logger.success(
          `audit MTC enabled (interval=${cfg.batch_interval_seconds}s, namespace=${cfg.namespace_prefix})`,
        );
        logger.log(
          chalk.cyan(
            "  Q-COMP-1 + Q-COMP-2 legal sign-off cleared 2026-05-01. Confirm your namespace + issuer match your tenant before emitting events.",
          ),
        );
      } catch (err) {
        logger.error(`audit mtc enable failed: ${err.message}`);
        process.exit(1);
      }
    });

  mtc
    .command("disable")
    .description("Disable audit MTC emit (existing batches remain on disk)")
    .option("--config-dir <dir>", "Override config root")
    .action((opts) => {
      try {
        saveAuditMtcConfig(resolveAuditMtcDir(opts), { enabled: false });
        logger.success("audit MTC disabled");
      } catch (err) {
        logger.error(`audit mtc disable failed: ${err.message}`);
        process.exit(1);
      }
    });

  mtc
    .command("set-interval <seconds>")
    .description("Set batch interval seconds (60 strict, 3600 lenient)")
    .option("--config-dir <dir>", "Override config root")
    .action((seconds, opts) => {
      try {
        const cfg = saveAuditMtcConfig(resolveAuditMtcDir(opts), {
          batch_interval_seconds: parseInt(seconds, 10),
        });
        logger.success(`batch interval set to ${cfg.batch_interval_seconds}s`);
      } catch (err) {
        logger.error(`audit mtc set-interval failed: ${err.message}`);
        process.exit(1);
      }
    });

  mtc
    .command("emit")
    .description(
      "Emit one audit event (Track 1: realtime Ed25519 + queue for next batch)",
    )
    .requiredOption("-t, --type <t>", "Event type")
    .requiredOption("-o, --operation <op>", "Operation")
    .option("-a, --actor <actor>", "Actor")
    .option("-x, --target <target>", "Target")
    .option("-d, --details <json>", "Details (JSON string)")
    .option("-r, --risk-level <rl>", "Risk level (low/medium/high/critical)")
    .option("--occurred-at <iso>", "Override event timestamp")
    .option("--force", "Bypass enabled-flag check (admin/CI use)")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "Output as JSON")
    .action((opts) => {
      try {
        const body = {
          event_type: opts.type,
          operation: opts.operation,
          actor: opts.actor,
          target: opts.target,
          risk_level: opts.riskLevel,
          occurred_at: opts.occurredAt,
        };
        if (opts.details) {
          body.details = parseJsonOption(opts.details, "--details");
        }
        const r = auditMtcEmit(resolveAuditMtcDir(opts), body, {
          requireEnabled: !opts.force,
        });
        if (opts.json) {
          console.log(
            JSON.stringify(
              { ok: true, event_id: r.eventId, path: r.path },
              null,
              2,
            ),
          );
        } else {
          logger.success(`event emitted: ${r.eventId}`);
          logger.log(`  ${chalk.bold("Staging file:")} ${r.path}`);
        }
      } catch (err) {
        if (err.code === "AUDIT_MTC_DISABLED") {
          logger.error(err.message);
          process.exit(2);
        }
        logger.error(`audit mtc emit failed: ${err.message}`);
        process.exit(1);
      }
    });

  mtc
    .command("reconcile")
    .description(
      "Close current batch: build Merkle tree, sign root, write envelopes (idempotent)",
    )
    .option("--namespace <ns>", "Override namespace prefix")
    .option("--issuer <issuer>", "Override MTCA issuer")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "Output as JSON")
    .action((opts) => {
      try {
        const r = auditMtcCloseBatch(resolveAuditMtcDir(opts), {
          namespace: opts.namespace,
          issuer: opts.issuer,
        });
        if (opts.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (r.skipped) {
          logger.info(`skipped: ${r.reason}`);
          if (r.malformed && r.malformed.length) {
            logger.warn(`  ${r.malformed.length} malformed file(s) skipped`);
          }
          return;
        }
        logger.success(
          `batch ${r.batchId} closed — ${r.treeSize} event(s), tree_head_id=${r.treeHeadId}`,
        );
        logger.log(`  ${chalk.bold("Namespace:")} ${r.namespace}`);
        logger.log(`  ${chalk.bold("Batch dir:")} ${r.batchDir}`);
      } catch (err) {
        logger.error(`audit mtc reconcile failed: ${err.message}`);
        process.exit(1);
      }
    });

  mtc
    .command("reconcile-check <event-id>")
    .description("Check whether an event has been batched (and where)")
    .option("--config-dir <dir>", "Override config root")
    .option("--json", "Output as JSON")
    .action((eventId, opts) => {
      try {
        const r = auditMtcReconcileCheck(resolveAuditMtcDir(opts), eventId);
        if (opts.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (r.found) {
          logger.success(`event ${eventId} found in batch ${r.batchId}`);
          logger.log(`  ${chalk.bold("Tree head:")}  ${r.treeHeadId}`);
          logger.log(`  ${chalk.bold("Namespace:")}  ${r.namespace}`);
          logger.log(`  ${chalk.bold("Leaf index:")} ${r.leafIndex}`);
          logger.log(`  ${chalk.bold("Envelope:")}   ${r.envelopePath}`);
        } else if (r.staging) {
          logger.warn(
            `event ${eventId} is in staging (not yet batched). Run 'cc audit mtc reconcile'.`,
          );
          process.exit(3);
        } else {
          logger.error(`event ${eventId} not found in any batch or staging`);
          process.exit(2);
        }
      } catch (err) {
        logger.error(`audit mtc reconcile-check failed: ${err.message}`);
        process.exit(1);
      }
    });
}

// === Iter16 V2 governance overlay ===
export function registerAuditGovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "audit");
  if (!parent) return;
  const L = async () => await import("../lib/audit-logger.js");
  parent
    .command("aud-gov-enums-v2")
    .description("Show V2 enums (aud maturity + write lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.AUD_PROFILE_MATURITY_V2,
            writeLifecycle: m.AUD_WRITE_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("aud-gov-config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveAudProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingAudWritesPerProfileV2(),
            idleMs: m.getAudProfileIdleMsV2(),
            stuckMs: m.getAudWriteStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("aud-gov-set-max-active-v2 <n>")
    .description("Set max active profiles per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActiveAudProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aud-gov-set-max-pending-v2 <n>")
    .description("Set max pending writes per profile")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingAudWritesPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aud-gov-set-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setAudProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aud-gov-set-stuck-ms-v2 <n>")
    .description("Set write stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setAudWriteStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("aud-gov-register-v2 <id> <owner>")
    .description("Register V2 aud profile")
    .option("--level <v>", "level")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerAudProfileV2({ id, owner, level: o.level }),
          null,
          2,
        ),
      );
    });
  parent
    .command("aud-gov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activateAudProfileV2(id), null, 2));
    });
  parent
    .command("aud-gov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.suspendAudProfileV2(id), null, 2));
    });
  parent
    .command("aud-gov-archive-v2 <id>")
    .description("Archive profile (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archiveAudProfileV2(id), null, 2));
    });
  parent
    .command("aud-gov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchAudProfileV2(id), null, 2));
    });
  parent
    .command("aud-gov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getAudProfileV2(id), null, 2));
    });
  parent
    .command("aud-gov-list-v2")
    .description("List profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listAudProfilesV2(), null, 2));
    });
  parent
    .command("aud-gov-create-write-v2 <id> <profileId>")
    .description("Create write (queued)")
    .option("--key <v>", "key")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createAudWriteV2({ id, profileId, key: o.key }),
          null,
          2,
        ),
      );
    });
  parent
    .command("aud-gov-writing-write-v2 <id>")
    .description("Mark write as writing")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.writingAudWriteV2(id), null, 2));
    });
  parent
    .command("aud-gov-complete-write-v2 <id>")
    .description("Write OK")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.writeOkAudV2(id), null, 2));
    });
  parent
    .command("aud-gov-fail-write-v2 <id> [reason]")
    .description("Fail write")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.failAudWriteV2(id, reason), null, 2));
    });
  parent
    .command("aud-gov-cancel-write-v2 <id> [reason]")
    .description("Cancel write")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.cancelAudWriteV2(id, reason), null, 2));
    });
  parent
    .command("aud-gov-get-write-v2 <id>")
    .description("Get write")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getAudWriteV2(id), null, 2));
    });
  parent
    .command("aud-gov-list-writes-v2")
    .description("List writes")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listAudWritesV2(), null, 2));
    });
  parent
    .command("aud-gov-auto-suspend-idle-v2")
    .description("Auto-suspend idle profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoSuspendIdleAudProfilesV2(), null, 2));
    });
  parent
    .command("aud-gov-auto-fail-stuck-v2")
    .description("Auto-fail stuck writes")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoFailStuckAudWritesV2(), null, 2));
    });
  parent
    .command("aud-gov-gov-stats-v2")
    .description("V2 gov aggregate stats")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.getAuditLoggerGovStatsV2(), null, 2));
    });
}
