/**
 * Skill Marketplace commands (Phase 65)
 * chainlesschain marketplace status-types|invocation-statuses|publish|list|
 *                             show|status|record|invocations|stats
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureMarketplaceTables,
  listServiceStatus,
  listInvocationStatus,
  publishService,
  getService,
  listServices,
  updateServiceStatus,
  recordInvocation,
  listInvocations,
  getInvocationStats,
  // V2 (Phase 65)
  SERVICE_STATUS_V2,
  INVOCATION_STATUS_V2,
  PRICING_MODEL_V2,
  MARKETPLACE_DEFAULT_MAX_CONCURRENT_INVOCATIONS,
  setMaxConcurrentInvocations,
  getMaxConcurrentInvocations,
  getActiveInvocationCount,
  beginInvocationV2,
  startInvocation,
  completeInvocationV2,
  failInvocationV2,
  timeoutInvocationV2,
  setInvocationStatus,
  getMarketplaceStatsV2,
} from "../lib/skill-marketplace.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureMarketplaceTables(db);
  return db;
}

function _printService(s) {
  logger.log(
    `  ${chalk.bold("ID:")}           ${chalk.cyan(s.id.slice(0, 8))}`,
  );
  logger.log(`  ${chalk.bold("Name:")}         ${s.name} @ ${s.version}`);
  logger.log(`  ${chalk.bold("Status:")}       ${s.status}`);
  if (s.description) {
    logger.log(`  ${chalk.bold("Description:")}  ${s.description}`);
  }
  if (s.endpoint) {
    logger.log(`  ${chalk.bold("Endpoint:")}     ${s.endpoint}`);
  }
  if (s.owner) {
    logger.log(`  ${chalk.bold("Owner:")}        ${s.owner}`);
  }
  logger.log(`  ${chalk.bold("Invocations:")}  ${s.invocationCount}`);
}

export function registerMarketplaceCommand(program) {
  const mp = program
    .command("marketplace")
    .description(
      "Skill marketplace — publish skill services, record invocations, view stats",
    );

  mp.command("status-types")
    .description("List known service statuses")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = listServiceStatus();
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        for (const s of statuses) logger.log(`  ${chalk.cyan(s)}`);
      }
    });

  mp.command("invocation-statuses")
    .description("List known invocation statuses")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = listInvocationStatus();
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        for (const s of statuses) logger.log(`  ${chalk.cyan(s)}`);
      }
    });

  mp.command("publish <name>")
    .description("Publish a skill service")
    .option("-v, --version <v>", "Version", "1.0.0")
    .option("-d, --description <text>", "Description", "")
    .option("-e, --endpoint <url>", "Invocation endpoint")
    .option("-o, --owner <did>", "Service owner (DID)")
    .option("-p, --pricing <json>", "Pricing info (JSON)")
    .option(
      "-s, --status <s>",
      "Initial status (draft|published|deprecated|suspended)",
      "published",
    )
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const pricing = options.pricing ? JSON.parse(options.pricing) : null;
        const service = publishService(db, {
          name,
          version: options.version,
          description: options.description,
          endpoint: options.endpoint,
          owner: options.owner,
          pricing,
          status: options.status,
        });
        if (options.json) {
          console.log(JSON.stringify(service, null, 2));
        } else {
          logger.success("Service published");
          _printService(service);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("list")
    .description("List skill services")
    .option(
      "-s, --status <s>",
      "Filter by status (draft|published|deprecated|suspended)",
    )
    .option("-o, --owner <did>", "Filter by owner DID")
    .option("-n, --name <substring>", "Name substring filter")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listServices({
          status: options.status,
          owner: options.owner,
          name: options.name,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No services.");
        } else {
          for (const s of rows) {
            logger.log(
              `  ${chalk.cyan(s.id.slice(0, 8))} [${s.status.padEnd(10)}] ${chalk.bold(s.name.padEnd(22))} v${s.version.padEnd(8)} invocations=${s.invocationCount}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("show <service-id>")
    .description("Show full details of a skill service")
    .option("--json", "Output as JSON")
    .action(async (serviceId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const service = getService(serviceId);
        if (!service) {
          logger.error(`Service not found: ${serviceId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(service, null, 2));
        } else {
          _printService(service);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("status <service-id> <new-status>")
    .description(
      "Transition service status (draft|published|deprecated|suspended)",
    )
    .option("--json", "Output as JSON")
    .action(async (serviceId, newStatus, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const service = updateServiceStatus(db, serviceId, newStatus);
        if (options.json) {
          console.log(JSON.stringify(service, null, 2));
        } else {
          logger.success(`Status updated → ${service.status}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("record <service-id>")
    .description("Record a skill invocation against a published service")
    .option("-c, --caller <did>", "Caller DID")
    .option("-i, --input <json>", "Invocation input (JSON)")
    .option("-o, --output <json>", "Invocation output (JSON)")
    .option(
      "-s, --status <s>",
      "Status (pending|running|success|failed|timeout)",
      "success",
    )
    .option("-d, --duration-ms <n>", "Duration in ms", parseInt)
    .option("-e, --error <text>", "Error message when failed")
    .option("--json", "Output as JSON")
    .action(async (serviceId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const input = options.input ? JSON.parse(options.input) : null;
        const output = options.output ? JSON.parse(options.output) : null;
        const inv = recordInvocation(db, {
          serviceId,
          callerId: options.caller,
          input,
          output,
          status: options.status,
          durationMs: options.durationMs,
          error: options.error,
        });
        if (options.json) {
          console.log(JSON.stringify(inv, null, 2));
        } else {
          logger.success("Invocation recorded");
          logger.log(
            `  ${chalk.bold("ID:")}        ${chalk.cyan(inv.id.slice(0, 8))}`,
          );
          logger.log(
            `  ${chalk.bold("Service:")}   ${inv.serviceId.slice(0, 8)}`,
          );
          logger.log(`  ${chalk.bold("Status:")}    ${inv.status}`);
          if (inv.durationMs != null) {
            logger.log(`  ${chalk.bold("Duration:")}  ${inv.durationMs}ms`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("invocations")
    .description("List skill invocations")
    .option("-s, --service <id>", "Filter by service")
    .option("-c, --caller <did>", "Filter by caller")
    .option("-S, --status <s>", "Filter by status")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listInvocations({
          serviceId: options.service,
          callerId: options.caller,
          status: options.status,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No invocations.");
        } else {
          for (const i of rows) {
            const duration = i.durationMs != null ? `${i.durationMs}ms` : "-";
            logger.log(
              `  ${chalk.cyan(i.id.slice(0, 8))} svc=${i.serviceId.slice(0, 8)} [${i.status.padEnd(8)}] ${duration.padStart(7)} caller=${i.callerId || "anon"}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("stats")
    .description("Aggregate invocation stats (optionally scoped to a service)")
    .option("-s, --service <id>", "Scope to a single service")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const stats = getInvocationStats({ serviceId: options.service });
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Total:")}         ${stats.total}`);
          logger.log(
            `  ${chalk.bold("Success rate:")}  ${(stats.successRate * 100).toFixed(1)}%`,
          );
          logger.log(
            `  ${chalk.bold("Avg duration:")}  ${stats.avgDurationMs}ms (success-only)`,
          );
          logger.log(
            `  ${chalk.bold("Counts:")}        success=${stats.counts.success} failed=${stats.counts.failed} timeout=${stats.counts.timeout} pending=${stats.counts.pending} running=${stats.counts.running}`,
          );
          if (stats.scopedToService) {
            logger.log(
              `  ${chalk.bold("Scope:")}         service ${stats.scopedToService.slice(0, 8)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ── V2 (Phase 65) ───────────────────────────────────────── */

  mp.command("service-statuses-v2")
    .description("List V2 service statuses (frozen enum)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(SERVICE_STATUS_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  mp.command("invocation-statuses-v2")
    .description("List V2 invocation statuses (frozen enum)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(INVOCATION_STATUS_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  mp.command("pricing-models")
    .description("List V2 pricing models (frozen enum)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(PRICING_MODEL_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  mp.command("default-max-concurrent")
    .description("Show default per-service concurrency cap")
    .action(() => {
      logger.log(`  ${MARKETPLACE_DEFAULT_MAX_CONCURRENT_INVOCATIONS}`);
    });

  mp.command("max-concurrent")
    .description("Show current per-service concurrency cap")
    .action(() => {
      logger.log(`  ${getMaxConcurrentInvocations()}`);
    });

  mp.command("active-invocation-count [service-id]")
    .description(
      "Show count of PENDING + RUNNING invocations (all services by default)",
    )
    .action((serviceId) => {
      logger.log(`  ${getActiveInvocationCount(serviceId)}`);
    });

  mp.command("set-max-concurrent <n>")
    .description("Set the per-service concurrency cap")
    .action((n) => {
      try {
        const v = setMaxConcurrentInvocations(Number(n));
        logger.success(`Max concurrent invocations = ${v}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("begin-v2 <service-id>")
    .description("Begin a V2 invocation (creates PENDING, enforces cap)")
    .option("-c, --caller <id>", "Caller ID")
    .option("-i, --input <json>", "JSON-encoded input")
    .option("--json", "Output as JSON")
    .action(async (serviceId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        let input = null;
        if (options.input) {
          try {
            input = JSON.parse(options.input);
          } catch {
            input = options.input;
          }
        }
        const inv = beginInvocationV2(db, {
          serviceId,
          callerId: options.caller,
          input,
        });
        if (options.json) console.log(JSON.stringify(inv, null, 2));
        else {
          logger.success(`Invocation queued [${inv.status}]`);
          logger.log(`  ${chalk.bold("ID:")} ${chalk.cyan(inv.id)}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("start-invocation <invocation-id>")
    .description("Start a V2 invocation (PENDING → RUNNING)")
    .option("--json", "Output as JSON")
    .action(async (invocationId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = startInvocation(db, invocationId);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else logger.success(`Status = ${result.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("complete-invocation <invocation-id>")
    .description("Complete a V2 invocation (RUNNING → SUCCESS)")
    .option("-o, --output <json>", "JSON-encoded output")
    .option("-d, --duration-ms <n>", "Duration in milliseconds", parseInt)
    .option("--json", "Output as JSON")
    .action(async (invocationId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        let output = null;
        if (options.output) {
          try {
            output = JSON.parse(options.output);
          } catch {
            output = options.output;
          }
        }
        const result = completeInvocationV2(db, invocationId, {
          output,
          durationMs: options.durationMs,
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else logger.success(`Status = ${result.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("fail-invocation <invocation-id>")
    .description("Fail a V2 invocation")
    .option("-m, --message <msg>", "Error message")
    .option("-d, --duration-ms <n>", "Duration in milliseconds", parseInt)
    .action(async (invocationId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = failInvocationV2(db, invocationId, options.message, {
          durationMs: options.durationMs,
        });
        logger.success(`Status = ${result.status}`);
        if (result.error) logger.log(`  Error: ${result.error}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("timeout-invocation <invocation-id>")
    .description("Timeout a V2 invocation")
    .option("-d, --duration-ms <n>", "Duration in milliseconds", parseInt)
    .action(async (invocationId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = timeoutInvocationV2(db, invocationId, {
          durationMs: options.durationMs,
        });
        logger.success(`Status = ${result.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("set-invocation-status <invocation-id> <status>")
    .description("Set V2 invocation status via the state machine")
    .option("-m, --message <msg>", "Error message (FAILED/TIMEOUT)")
    .option("--json", "Output as JSON")
    .action(async (invocationId, status, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const patch = options.message ? { error: options.message } : {};
        const result = setInvocationStatus(db, invocationId, status, patch);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else logger.success(`Status = ${result.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  mp.command("stats-v2")
    .description("V2 aggregated stats")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const stats = getMarketplaceStatsV2();
        if (options.json) console.log(JSON.stringify(stats, null, 2));
        else {
          logger.log(
            `  ${chalk.bold("Services:")}       ${stats.totalServices}`,
          );
          logger.log(
            `  ${chalk.bold("Invocations:")}    ${stats.totalInvocations} (active: ${stats.activeInvocations})`,
          );
          logger.log(
            `  ${chalk.bold("Max concurrent:")} ${stats.maxConcurrentInvocations}`,
          );
          logger.log(`  ${chalk.bold("Services by status:")}`);
          for (const [k, v] of Object.entries(stats.servicesByStatus))
            logger.log(`    ${k.padEnd(12)} ${v}`);
          logger.log(`  ${chalk.bold("Services by pricing:")}`);
          for (const [k, v] of Object.entries(stats.servicesByPricing))
            logger.log(`    ${k.padEnd(14)} ${v}`);
          logger.log(`  ${chalk.bold("Invocations by status:")}`);
          for (const [k, v] of Object.entries(stats.invocationsByStatus))
            logger.log(`    ${k.padEnd(10)} ${v}`);
          logger.log(
            `  ${chalk.bold("Success rate:")}   ${(stats.successRate * 100).toFixed(1)}%`,
          );
          logger.log(
            `  ${chalk.bold("Avg duration:")}   ${stats.avgDurationMs}ms`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
