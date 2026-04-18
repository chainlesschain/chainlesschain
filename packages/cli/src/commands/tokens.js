/**
 * Token usage tracking commands
 * chainlesschain tokens [show|breakdown|recent|reset]
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getUsageStats,
  getTodayStats,
  getCostBreakdown,
  getRecentUsage,
  BUDGET_MATURITY_V2,
  USAGE_RECORD_LIFECYCLE_V2,
  getMaxActiveBudgetsPerOwnerV2,
  setMaxActiveBudgetsPerOwnerV2,
  getMaxPendingRecordsPerBudgetV2,
  setMaxPendingRecordsPerBudgetV2,
  getBudgetIdleMsV2,
  setBudgetIdleMsV2,
  getRecordStuckMsV2,
  setRecordStuckMsV2,
  registerBudgetV2,
  getBudgetV2,
  listBudgetsV2,
  setBudgetStatusV2,
  activateBudgetV2,
  suspendBudgetV2,
  archiveBudgetV2,
  touchBudgetV2,
  getActiveBudgetCountV2,
  createUsageRecordV2,
  getUsageRecordV2,
  listUsageRecordsV2,
  setUsageRecordStatusV2,
  recordUsageV2,
  billUsageV2,
  rejectUsageV2,
  refundUsageV2,
  getPendingRecordCountV2,
  autoSuspendIdleBudgetsV2,
  autoRejectStaleRecordsV2,
  getTokenTrackerStatsV2,
} from "../lib/token-tracker.js";
import {
  getCacheStats,
  clearCache,
  clearExpired,
} from "../lib/response-cache.js";

export function registerTokensCommand(program) {
  const tokens = program
    .command("tokens")
    .description("LLM token usage tracking and response cache");

  // tokens show (default)
  tokens
    .command("show", { isDefault: true })
    .description("Show token usage summary")
    .option("--period <period>", "Time period: today, week, month, all", "all")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        let statsOptions = {};
        const now = new Date();
        if (options.period === "today") {
          statsOptions.startDate = now.toISOString().slice(0, 10);
        } else if (options.period === "week") {
          const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
          statsOptions.startDate = weekAgo.toISOString().slice(0, 10);
        } else if (options.period === "month") {
          const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
          statsOptions.startDate = monthAgo.toISOString().slice(0, 10);
        }

        const stats = getUsageStats(db, statsOptions);
        const todayStats = getTodayStats(db);

        if (options.json) {
          console.log(JSON.stringify({ stats, today: todayStats }, null, 2));
        } else {
          logger.log(chalk.bold(`Token Usage (${options.period}):\n`));
          logger.log(`  Total calls:      ${chalk.cyan(stats.total_calls)}`);
          logger.log(
            `  Input tokens:     ${chalk.cyan(stats.total_input_tokens.toLocaleString())}`,
          );
          logger.log(
            `  Output tokens:    ${chalk.cyan(stats.total_output_tokens.toLocaleString())}`,
          );
          logger.log(
            `  Total tokens:     ${chalk.cyan(stats.total_tokens.toLocaleString())}`,
          );
          logger.log(
            `  Total cost:       ${chalk.yellow("$" + stats.total_cost_usd.toFixed(4))}`,
          );
          logger.log(
            `  Avg response:     ${chalk.gray(Math.round(stats.avg_response_time_ms) + "ms")}`,
          );

          if (options.period !== "today") {
            logger.log(chalk.bold("\n  Today:"));
            logger.log(
              `    Calls: ${chalk.cyan(todayStats.total_calls)}  Tokens: ${chalk.cyan(todayStats.total_tokens.toLocaleString())}  Cost: ${chalk.yellow("$" + todayStats.total_cost_usd.toFixed(4))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed to get token stats: ${err.message}`);
        process.exit(1);
      }
    });

  // tokens breakdown
  tokens
    .command("breakdown")
    .description("Show cost breakdown by provider/model")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const breakdown = getCostBreakdown(db);

        if (options.json) {
          console.log(JSON.stringify(breakdown, null, 2));
        } else if (breakdown.length === 0) {
          logger.info("No usage data yet");
        } else {
          logger.log(chalk.bold("Cost Breakdown:\n"));
          for (const row of breakdown) {
            logger.log(
              `  ${chalk.cyan(row.provider)}/${chalk.white(row.model)}`,
            );
            logger.log(
              `    Calls: ${row.calls}  Tokens: ${row.total_tokens.toLocaleString()}  Cost: ${chalk.yellow("$" + row.cost_usd.toFixed(4))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // tokens recent
  tokens
    .command("recent")
    .description("Show recent LLM calls")
    .option("-n, --limit <n>", "Number of entries", "10")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const entries = getRecentUsage(
          db,
          Math.max(1, parseInt(options.limit) || 10),
        );

        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No recent usage");
        } else {
          logger.log(chalk.bold("Recent LLM Calls:\n"));
          for (const e of entries) {
            logger.log(
              `  ${chalk.gray(e.created_at)}  ${chalk.cyan(e.provider)}/${chalk.white(e.model)}  ${e.total_tokens} tokens  ${chalk.yellow("$" + e.cost_usd.toFixed(4))}  ${chalk.gray(e.response_time_ms + "ms")}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // tokens cache
  tokens
    .command("cache")
    .description("Show response cache statistics")
    .option("--clear", "Clear all cached responses")
    .option("--cleanup", "Remove expired entries only")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (options.clear) {
          clearCache(db);
          logger.success("Response cache cleared");
        } else if (options.cleanup) {
          const removed = clearExpired(db);
          logger.success(`Removed ${removed} expired cache entries`);
        } else {
          const stats = getCacheStats(db);
          if (options.json) {
            console.log(JSON.stringify(stats, null, 2));
          } else {
            logger.log(chalk.bold("Response Cache:\n"));
            logger.log(`  Entries:        ${chalk.cyan(stats.total_entries)}`);
            logger.log(`  Total hits:     ${chalk.cyan(stats.total_hits)}`);
            logger.log(
              `  Tokens saved:   ${chalk.green(stats.total_tokens_saved.toLocaleString())}`,
            );
            logger.log(
              `  Expired:        ${chalk.gray(stats.expired_entries)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── V2 Surface ──

  const out = (json, obj) => {
    if (json) console.log(JSON.stringify(obj, null, 2));
    else console.log(JSON.stringify(obj, null, 2));
  };
  const tryRun = (fn) => {
    try {
      fn();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  };

  tokens
    .command("budget-maturities-v2")
    .description("List V2 budget maturity states")
    .action(() => out(true, Object.values(BUDGET_MATURITY_V2)));

  tokens
    .command("usage-record-lifecycles-v2")
    .description("List V2 usage record lifecycle states")
    .action(() => out(true, Object.values(USAGE_RECORD_LIFECYCLE_V2)));

  tokens
    .command("stats-v2")
    .description("V2 token-tracker stats")
    .action(() => out(true, getTokenTrackerStatsV2()));

  tokens
    .command("get-max-active-budgets-v2")
    .description("Get max active budgets per owner (V2)")
    .action(() =>
      out(true, { maxActiveBudgetsPerOwner: getMaxActiveBudgetsPerOwnerV2() }),
    );

  tokens
    .command("set-max-active-budgets-v2 <n>")
    .description("Set max active budgets per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveBudgetsPerOwnerV2(Number(n));
        out(true, {
          maxActiveBudgetsPerOwner: getMaxActiveBudgetsPerOwnerV2(),
        });
      }),
    );

  tokens
    .command("get-max-pending-records-v2")
    .description("Get max pending records per budget (V2)")
    .action(() =>
      out(true, {
        maxPendingRecordsPerBudget: getMaxPendingRecordsPerBudgetV2(),
      }),
    );

  tokens
    .command("set-max-pending-records-v2 <n>")
    .description("Set max pending records per budget (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingRecordsPerBudgetV2(Number(n));
        out(true, {
          maxPendingRecordsPerBudget: getMaxPendingRecordsPerBudgetV2(),
        });
      }),
    );

  tokens
    .command("get-budget-idle-ms-v2")
    .description("Get budget idle threshold (V2)")
    .action(() => out(true, { budgetIdleMs: getBudgetIdleMsV2() }));

  tokens
    .command("set-budget-idle-ms-v2 <ms>")
    .description("Set budget idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setBudgetIdleMsV2(Number(ms));
        out(true, { budgetIdleMs: getBudgetIdleMsV2() });
      }),
    );

  tokens
    .command("get-record-stuck-ms-v2")
    .description("Get record stuck threshold (V2)")
    .action(() => out(true, { recordStuckMs: getRecordStuckMsV2() }));

  tokens
    .command("set-record-stuck-ms-v2 <ms>")
    .description("Set record stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setRecordStuckMsV2(Number(ms));
        out(true, { recordStuckMs: getRecordStuckMsV2() });
      }),
    );

  tokens
    .command("active-budget-count-v2 <ownerId>")
    .description("Active budget count for owner (V2)")
    .action((ownerId) =>
      out(true, { ownerId, count: getActiveBudgetCountV2(ownerId) }),
    );

  tokens
    .command("pending-record-count-v2 <budgetId>")
    .description("Pending record count for budget (V2)")
    .action((budgetId) =>
      out(true, { budgetId, count: getPendingRecordCountV2(budgetId) }),
    );

  tokens
    .command("register-budget-v2 <id>")
    .description("Register a V2 budget")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-l, --label <label>", "budget label")
    .action((id, opts) =>
      tryRun(() =>
        out(
          true,
          registerBudgetV2(id, { ownerId: opts.owner, label: opts.label }),
        ),
      ),
    );

  tokens
    .command("get-budget-v2 <id>")
    .description("Get a V2 budget")
    .action((id) => out(true, getBudgetV2(id)));

  tokens
    .command("list-budgets-v2")
    .description("List V2 budgets")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(true, listBudgetsV2({ ownerId: opts.owner, status: opts.status })),
    );

  tokens
    .command("set-budget-status-v2 <id> <next>")
    .description("Set V2 budget status")
    .action((id, next) => tryRun(() => out(true, setBudgetStatusV2(id, next))));

  tokens
    .command("activate-budget-v2 <id>")
    .description("Activate a V2 budget")
    .action((id) => tryRun(() => out(true, activateBudgetV2(id))));

  tokens
    .command("suspend-budget-v2 <id>")
    .description("Suspend a V2 budget")
    .action((id) => tryRun(() => out(true, suspendBudgetV2(id))));

  tokens
    .command("archive-budget-v2 <id>")
    .description("Archive a V2 budget")
    .action((id) => tryRun(() => out(true, archiveBudgetV2(id))));

  tokens
    .command("touch-budget-v2 <id>")
    .description("Touch a V2 budget")
    .action((id) => tryRun(() => out(true, touchBudgetV2(id))));

  tokens
    .command("create-usage-record-v2 <id>")
    .description("Create a V2 usage record")
    .requiredOption("-b, --budget <id>", "budget id")
    .requiredOption("-u, --units <n>", "usage units")
    .action((id, opts) =>
      tryRun(() =>
        out(
          true,
          createUsageRecordV2(id, {
            budgetId: opts.budget,
            units: Number(opts.units),
          }),
        ),
      ),
    );

  tokens
    .command("get-usage-record-v2 <id>")
    .description("Get a V2 usage record")
    .action((id) => out(true, getUsageRecordV2(id)));

  tokens
    .command("list-usage-records-v2")
    .description("List V2 usage records")
    .option("-b, --budget <id>", "filter by budget")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(
        true,
        listUsageRecordsV2({ budgetId: opts.budget, status: opts.status }),
      ),
    );

  tokens
    .command("set-usage-record-status-v2 <id> <next>")
    .description("Set V2 usage record status")
    .action((id, next) =>
      tryRun(() => out(true, setUsageRecordStatusV2(id, next))),
    );

  tokens
    .command("record-usage-v2 <id>")
    .description("Mark V2 usage record recorded")
    .action((id) => tryRun(() => out(true, recordUsageV2(id))));

  tokens
    .command("bill-usage-v2 <id>")
    .description("Bill V2 usage record")
    .action((id) => tryRun(() => out(true, billUsageV2(id))));

  tokens
    .command("reject-usage-v2 <id>")
    .description("Reject V2 usage record")
    .action((id) => tryRun(() => out(true, rejectUsageV2(id))));

  tokens
    .command("refund-usage-v2 <id>")
    .description("Refund V2 usage record")
    .action((id) => tryRun(() => out(true, refundUsageV2(id))));

  tokens
    .command("auto-suspend-idle-budgets-v2")
    .description("Auto-suspend idle V2 budgets")
    .action(() => out(true, autoSuspendIdleBudgetsV2()));

  tokens
    .command("auto-reject-stale-records-v2")
    .description("Auto-reject stale V2 records")
    .action(() => out(true, autoRejectStaleRecordsV2()));
}
