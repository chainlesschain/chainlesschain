/**
 * Tenant SaaS commands (Phase 97)
 * chainlesschain tenant plans|metrics|create|configure|list|show|delete|
 *                       record|usage|subscribe|subscription|cancel|
 *                       subscriptions|check-quota|stats|export|import
 */

import fs from "fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureTenantTables,
  listPlans,
  listMetrics,
  createTenant,
  configureTenant,
  getTenant,
  listTenants,
  deleteTenant,
  recordUsage,
  getUsage,
  subscribe,
  getActiveSubscription,
  cancelSubscription,
  listSubscriptions,
  checkQuota,
  getSaasStats,
  exportTenant,
  importTenant,
} from "../lib/tenant-saas.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureTenantTables(db);
  return db;
}

function _printTenant(t) {
  logger.log(`  ${chalk.bold("ID:")}         ${chalk.cyan(t.id)}`);
  logger.log(`  ${chalk.bold("Name:")}       ${t.name}`);
  logger.log(`  ${chalk.bold("Slug:")}       ${chalk.yellow(t.slug)}`);
  logger.log(`  ${chalk.bold("Plan:")}       ${chalk.magenta(t.plan)}`);
  logger.log(`  ${chalk.bold("Status:")}     ${t.status}`);
  if (t.ownerId) {
    logger.log(`  ${chalk.bold("Owner:")}      ${t.ownerId}`);
  }
  if (t.config) {
    logger.log(`  ${chalk.bold("Config:")}     ${JSON.stringify(t.config)}`);
  }
  if (t.deletedAt) {
    logger.log(
      `  ${chalk.bold("Deleted:")}    ${new Date(t.deletedAt).toISOString()}`,
    );
  }
}

function _printSubscription(sub) {
  logger.log(`  ${chalk.bold("ID:")}         ${chalk.cyan(sub.id)}`);
  logger.log(`  ${chalk.bold("Plan:")}       ${chalk.magenta(sub.plan)}`);
  logger.log(`  ${chalk.bold("Status:")}     ${sub.status}`);
  logger.log(
    `  ${chalk.bold("Started:")}    ${new Date(sub.startedAt).toISOString()}`,
  );
  if (sub.expiresAt) {
    logger.log(
      `  ${chalk.bold("Expires:")}    ${new Date(sub.expiresAt).toISOString()}`,
    );
  }
  if (sub.amount !== null && sub.amount !== undefined) {
    logger.log(`  ${chalk.bold("Amount:")}     ${sub.amount}`);
  }
}

export function registerTenantCommand(program) {
  const tenant = program
    .command("tenant")
    .description(
      "Multi-tenant SaaS — tenants, usage metering, subscriptions, quotas",
    );

  tenant
    .command("plans")
    .description("List available subscription plans")
    .option("--json", "Output as JSON")
    .action((options) => {
      const plans = listPlans();
      if (options.json) {
        console.log(JSON.stringify(plans, null, 2));
      } else {
        for (const p of plans) {
          const fee = p.monthlyFee === null ? "custom" : `¥${p.monthlyFee}/mo`;
          logger.log(
            `  ${chalk.cyan(p.id.padEnd(11))} ${chalk.yellow(p.name.padEnd(11))} ${fee}`,
          );
          const q = p.quotas;
          const fmt = (v) => (v === null ? "unlimited" : v);
          logger.log(
            `    api_calls: ${fmt(q.api_calls)}, storage: ${fmt(q.storage_bytes)}, ai: ${fmt(q.ai_requests)}`,
          );
        }
      }
    });

  tenant
    .command("metrics")
    .description("List tracked usage metrics")
    .option("--json", "Output as JSON")
    .action((options) => {
      const metrics = listMetrics();
      if (options.json) {
        console.log(JSON.stringify(metrics, null, 2));
      } else {
        for (const m of metrics) {
          logger.log(`  ${chalk.cyan(m.id.padEnd(16))} ${m.name} (${m.unit})`);
        }
      }
    });

  tenant
    .command("create <name> <slug>")
    .description("Create a tenant")
    .option(
      "-p, --plan <plan>",
      "Plan id (free/starter/pro/enterprise)",
      "free",
    )
    .option("-o, --owner <id>", "Owner user id")
    .option("-c, --config <json>", "Config JSON")
    .option("--json", "Output as JSON")
    .action(async (name, slug, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const config = options.config ? JSON.parse(options.config) : null;
        const t = createTenant(db, {
          name,
          slug,
          plan: options.plan,
          ownerId: options.owner,
          config,
        });
        if (options.json) {
          console.log(JSON.stringify(t, null, 2));
        } else {
          logger.success(`Tenant created: ${name}`);
          _printTenant(t);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("configure <tenant-id>")
    .description("Update tenant config / plan / status / name")
    .option("-c, --config <json>", "Config JSON")
    .option("-p, --plan <plan>", "Change plan")
    .option("-s, --status <status>", "active | suspended")
    .option("-n, --name <name>", "Rename tenant")
    .option("--json", "Output as JSON")
    .action(async (tenantId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const updates = {};
        if (options.config !== undefined) {
          updates.config = JSON.parse(options.config);
        }
        if (options.plan !== undefined) updates.plan = options.plan;
        if (options.status !== undefined) updates.status = options.status;
        if (options.name !== undefined) updates.name = options.name;
        const t = configureTenant(db, tenantId, updates);
        if (options.json) {
          console.log(JSON.stringify(t, null, 2));
        } else {
          logger.success("Tenant updated");
          _printTenant(t);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("list")
    .description("List tenants")
    .option("-s, --status <status>", "Filter by status")
    .option("-p, --plan <plan>", "Filter by plan")
    .option("-o, --owner <substr>", "Filter by owner substring")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listTenants({
          status: options.status,
          plan: options.plan,
          ownerSubstr: options.owner,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No tenants.");
        } else {
          for (const t of rows) {
            logger.log(
              `  ${chalk.cyan(t.id.slice(0, 8))} ${chalk.yellow(t.slug.padEnd(20))} ${chalk.magenta(t.plan.padEnd(11))} ${t.status.padEnd(9)} ${t.name}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("show <tenant-id>")
    .description("Show tenant details")
    .option("--json", "Output as JSON")
    .action(async (tenantId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const t = getTenant(tenantId);
        if (!t) {
          logger.error(`Tenant not found: ${tenantId}`);
          process.exit(1);
        }
        const active = getActiveSubscription(tenantId);
        if (options.json) {
          console.log(
            JSON.stringify({ tenant: t, activeSubscription: active }, null, 2),
          );
        } else {
          _printTenant(t);
          if (active) {
            logger.log("");
            logger.log(chalk.bold("Active subscription:"));
            _printSubscription(active);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("delete <tenant-id>")
    .description(
      "Delete a tenant (soft by default; --hard cascades everything)",
    )
    .option("--hard", "Hard delete — removes all data")
    .action(async (tenantId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = deleteTenant(db, tenantId, {
          hardDelete: !!options.hard,
        });
        if (result.hard) {
          logger.success(`Tenant hard-deleted (cascaded): ${tenantId}`);
        } else {
          logger.success(`Tenant soft-deleted: ${tenantId}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("record <tenant-id> <metric> <value>")
    .description("Record a usage sample")
    .option("-P, --period <period>", "Period (YYYY-MM), defaults to current")
    .option("--json", "Output as JSON")
    .action(async (tenantId, metric, value, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const rec = recordUsage(db, tenantId, metric, parseFloat(value), {
          period: options.period,
        });
        if (options.json) {
          console.log(JSON.stringify(rec, null, 2));
        } else {
          logger.success(
            `Recorded ${rec.value} ${rec.metric} for period ${rec.period}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("usage <tenant-id>")
    .description("Aggregate usage for a tenant")
    .option("-P, --period <period>", "Filter by period (YYYY-MM)")
    .option("-m, --metric <metric>", "Filter by metric")
    .option("--json", "Output as JSON")
    .action(async (tenantId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const u = getUsage(tenantId, {
          period: options.period,
          metric: options.metric,
        });
        if (options.json) {
          console.log(JSON.stringify(u, null, 2));
        } else {
          logger.log(
            `${chalk.bold("Period:")}      ${u.period || "<all>"}  ${chalk.bold("Records:")} ${u.recordCount}`,
          );
          for (const [m, v] of Object.entries(u.byMetric)) {
            logger.log(`  ${chalk.cyan(m.padEnd(16))} ${v}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("subscribe <tenant-id>")
    .description("Start a new subscription (cancels any prior active one)")
    .requiredOption("-p, --plan <plan>", "Plan id")
    .option("-a, --amount <n>", "Override amount", parseFloat)
    .option("-d, --duration-ms <ms>", "Duration in ms (default 30d)", parseInt)
    .option("--json", "Output as JSON")
    .action(async (tenantId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const sub = subscribe(db, tenantId, options.plan, {
          amount: options.amount,
          durationMs: options.durationMs,
        });
        if (options.json) {
          console.log(JSON.stringify(sub, null, 2));
        } else {
          logger.success(`Subscribed to ${sub.plan}`);
          _printSubscription(sub);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("subscription <tenant-id>")
    .description("Show the active subscription for a tenant")
    .option("--json", "Output as JSON")
    .action(async (tenantId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const sub = getActiveSubscription(tenantId);
        if (!sub) {
          if (options.json) console.log("null");
          else logger.info("No active subscription");
          await shutdown();
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(sub, null, 2));
        } else {
          _printSubscription(sub);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("cancel <tenant-id>")
    .description("Cancel the active subscription")
    .action(async (tenantId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const sub = cancelSubscription(db, tenantId);
        logger.success(`Subscription ${sub.id} cancelled`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("subscriptions")
    .description("List subscriptions")
    .option("-t, --tenant-id <id>", "Filter by tenant")
    .option("-s, --status <status>", "Filter by status")
    .option("-p, --plan <plan>", "Filter by plan")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listSubscriptions({
          tenantId: options.tenantId,
          status: options.status,
          plan: options.plan,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No subscriptions.");
        } else {
          for (const s of rows) {
            logger.log(
              `  ${chalk.cyan(s.id.slice(0, 8))} ${chalk.magenta(s.plan.padEnd(11))} ${s.status.padEnd(10)} tenant=${s.tenantId.slice(0, 8)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("check-quota <tenant-id> <metric>")
    .description("Check a tenant's quota usage against their active plan")
    .option("-P, --period <period>", "Period (YYYY-MM)")
    .option("--json", "Output as JSON")
    .action(async (tenantId, metric, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const q = checkQuota(tenantId, metric, { period: options.period });
        if (options.json) {
          console.log(JSON.stringify(q, null, 2));
        } else {
          const limitStr = q.unlimited ? "unlimited" : String(q.limit);
          const remainingStr = q.unlimited ? "unlimited" : String(q.remaining);
          const color = q.exceeded ? chalk.red : chalk.green;
          logger.log(
            `  ${chalk.bold("Plan:")}       ${q.plan}  ${chalk.bold("Period:")} ${q.period}`,
          );
          logger.log(
            `  ${chalk.bold("Metric:")}     ${chalk.cyan(q.metric)}  ${chalk.bold("Used:")} ${q.used} / ${limitStr}`,
          );
          logger.log(
            `  ${chalk.bold("Remaining:")}  ${remainingStr}  ${color(q.exceeded ? "EXCEEDED" : "OK")}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("stats")
    .description("SaaS-wide statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const stats = getSaasStats();
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`${chalk.bold("Tenants:")}          ${stats.tenantCount}`);
          logger.log(
            `${chalk.bold("Subscriptions:")}    ${stats.subscriptionCount} (active: ${stats.activeSubscriptions})`,
          );
          logger.log(
            `${chalk.bold("Usage records:")}    ${stats.usageRecordCount}`,
          );
          logger.log(chalk.bold("By status:"));
          for (const [s, n] of Object.entries(stats.byStatus)) {
            logger.log(`  ${s.padEnd(12)} ${n}`);
          }
          logger.log(chalk.bold("By plan:"));
          for (const [p, n] of Object.entries(stats.byPlan)) {
            logger.log(`  ${p.padEnd(12)} ${n}`);
          }
          logger.log(chalk.bold("Total usage:"));
          for (const [m, v] of Object.entries(stats.totalUsage)) {
            logger.log(`  ${m.padEnd(16)} ${v}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("export <tenant-id> [output-file]")
    .description("Export tenant + subscriptions + usage as JSON")
    .action(async (tenantId, outputFile) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const dump = exportTenant(tenantId);
        const json = JSON.stringify(dump, null, 2);
        if (outputFile) {
          fs.writeFileSync(outputFile, json, "utf-8");
          logger.success(`Exported to ${outputFile}`);
        } else {
          console.log(json);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  tenant
    .command("import <input-file>")
    .description("Import tenant snapshot from JSON file")
    .action(async (inputFile) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const json = fs.readFileSync(inputFile, "utf-8");
        const data = JSON.parse(json);
        const result = importTenant(db, data);
        if (result.tenantId === null) {
          logger.error(
            `Import skipped: ${result.reason || "tenant not importable"}`,
          );
          process.exit(2);
        }
        logger.success(
          `Imported tenant ${result.tenantId} ` +
            `(${result.importedSubscriptions} subs, ${result.importedUsage} usage records)`,
        );
        if (result.skippedSubscriptions || result.skippedUsage) {
          logger.info(
            `Skipped: ${result.skippedSubscriptions} subs, ${result.skippedUsage} usage`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
