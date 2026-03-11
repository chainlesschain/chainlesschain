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
}
